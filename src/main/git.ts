import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { Commit, CommitDetail, ConflictVersions, DiffTarget, FileDiff, FileStatus, HunkSelection, Operation, RebaseCommit, RebaseStep, RepoInfo, Resolution, Submodule, UndoStep, Worktree, LfsInfo } from '../shared/types'
import { hunkKey } from '../shared/hunk'
import { buildPatch } from './patch'
import { LOG_FORMAT, parseDiff, parseLfsPatterns, parseLog, parseNameStatus, parseRefs, parseStatus, parseWorktrees, REF_FORMAT } from './parse'

export class GitError extends Error {
  constructor(message: string, readonly code: number | null = null, readonly stderr = '') {
    super(message)
  }
}

interface Result {
  code: number
  stdout: string
}

const MAX_OUTPUT = 256 * 1024 * 1024

// Runs git without a shell. Exit codes listed in okCodes are returned instead of thrown.
// A timeout kills git's whole process group (ssh, credential helpers, hooks included).
export function run(args: string[], cwd: string, okCodes = [0], stdin?: string, timeout = 0, env: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (!existsSync(cwd)) return reject(new GitError(`folder not found: ${cwd}`))
    const child = spawn('git', ['--no-optional-locks', ...args], {
      cwd,
      detached: timeout > 0 && process.platform !== 'win32', // own process group for the timer
      // English messages for the few checks that match git output; never wait for an editor
      // (continue keeps the prepared message). Hooks inherit only these.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_MESSAGES: 'C', GIT_EDITOR: 'true', ...env }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let failure: GitError | null = null
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']) // whole tree
        else if (child.pid && timeout > 0) process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch {
        child.kill(sig)
      }
    }
    let hardKill: NodeJS.Timeout | undefined
    const stop = (e: GitError) => {
      failure ??= e
      signal('SIGTERM')
      hardKill ??= setTimeout(() => signal('SIGKILL'), 3000) // for processes that ignore SIGTERM
    }
    const timer = timeout > 0 ? setTimeout(() => stop(new GitError(`git ${args[0]} timed out after ${timeout / 1000}s`)), timeout) : undefined
    child.stdout.on('data', (d: Buffer) => {
      size += d.length
      if (size > MAX_OUTPUT) stop(new GitError(`git ${args[0]} output too large`))
      else out.push(d)
    })
    let errSize = 0
    child.stderr.on('data', (d: Buffer) => {
      errSize += d.length
      if (errSize <= 1024 * 1024) err.push(d) // enough for any message; progress spam is dropped
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new GitError(e.code === 'ENOENT' ? 'git executable not found — is git installed?' : e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      clearTimeout(hardKill)
      const stderr = Buffer.concat(err).toString()
      if (failure) return reject(new GitError(failure.message, code, stderr))
      const exit = code ?? -1
      if (okCodes.includes(exit)) return resolve({ code: exit, stdout: Buffer.concat(out).toString() })
      const message = /git-lfs[^\n]*(command )?not found|'lfs' is not a git command/.test(stderr)
        ? 'git-lfs was not found on the app\'s PATH — install Git LFS or make it available to GUI apps'
        : stderr.trim() || `git ${args[0]} failed (${exit})`
      reject(new GitError(message, exit, stderr))
    })
    child.stdin.on('error', () => {}) // EPIPE when git exits without reading stdin; exit code tells the story
    child.stdin.end(stdin)
  })
}

// Revisions come from the renderer; anything option-like or exotic is rejected.
export function assertRevision(rev: string): void {
  if (!/^[0-9a-f]{4,64}$/i.test(rev) && !/^HEAD(~\d+)?$/.test(rev)) {
    throw new GitError(`invalid revision: ${rev}`)
  }
}

export async function openRepo(dir: string): Promise<RepoInfo> {
  const probe = await run(['rev-parse', '--is-bare-repository', '--is-inside-git-dir'], dir).catch((e: GitError) => {
    throw new GitError(/not a git repository/.test(e.message) ? `not a git repository: ${dir}` : e.message)
  })
  const [bare, insideGitDir] = probe.stdout.trim().split('\n')
  if (bare === 'true') throw new GitError('bare repositories are not supported (no working tree)')
  // Accept the .git directory itself and open its work tree; anything deeper is ambiguous.
  if (insideGitDir === 'true' && basename(dir) !== '.git') throw new GitError('choose the working tree, not a folder inside the .git directory')
  const cwd = insideGitDir === 'true' ? dirname(dir) : dir
  const path = (await run(['rev-parse', '--show-toplevel'], cwd)).stdout.trim()
  const [branch, sha, refsOut] = await Promise.all([
    run(['symbolic-ref', '-q', '--short', 'HEAD'], path, [0, 1]),
    run(['rev-parse', '-q', '--verify', 'HEAD'], path, [0, 1]),
    run(['for-each-ref', `--format=${REF_FORMAT}`], path)
  ])
  const refs = parseRefs(refsOut.stdout)
  const head = { branch: branch.stdout.trim() || null, sha: sha.stdout.trim() || null }
  // Stashes are listed separately; their internal index/untracked commits are not history.
  const tips = [...new Set([...(head.sha ? [head.sha] : []), ...refs.filter((r) => r.kind !== 'stash').map((r) => r.target)])]
  // A broken work tree entry must not keep the repository from opening.
  const [operation, stashes, worktrees, submodules] = await Promise.all([
    currentOperation(path),
    listStashes(path),
    listWorktrees(path).catch(() => []),
    listSubmodules(path).catch(() => []) // e.g. a broken .gitmodules must not block opening
  ])
  const lfs = (await lfsPatterns(path)).length ? await lfsInfo(path).catch(() => null) : null
  return { path, head, refs, tips, operation, stashes, worktrees, submodules, lfs }
}

// Pages over a fixed set of tips so commits made between pages cannot shift the order.
export async function readLog(repo: string, tips: string[], skip: number, limit: number): Promise<Commit[]> {
  if (!tips.length) return []
  const args = ['log', '--stdin', '-z', '--topo-order', `--format=${LOG_FORMAT}`, `--skip=${skip}`, `-n${limit}`, '--']
  return parseLog((await run(args, repo, [0], tips.join('\n') + '\n')).stdout)
}

const DETAIL_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%cn', '%ct', '%b'].join('%x00') // body last

export async function readCommit(repo: string, rev: string): Promise<CommitDetail> {
  assertRevision(rev)
  const [meta, files] = await Promise.all([
    run(['show', '-s', `--format=${DETAIL_FORMAT}`, rev, '--'], repo),
    run(['diff-tree', '-r', '-M', '--root', '-m', '--first-parent', '--no-commit-id', '--name-status', '-z', rev, '--'], repo)
  ])
  const [sha, parents, author, email, date, subject, committer, committerDate, ...body] = meta.stdout.split('\0')
  return {
    sha,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    date: Number(date),
    subject,
    committer,
    committerDate: Number(committerDate),
    body: body.join('\0').trimEnd(),
    files: parseNameStatus(files.stdout)
  }
}

export async function readStatus(repo: string): Promise<FileStatus[]> {
  const { stdout } = await run(['status', '--porcelain=v2', '-z', '--untracked-files=all'], repo)
  return parseStatus(stdout)
}

// Renderer-supplied paths: literal (no globs or :(magic)) and passed on stdin (no argv size limit).
// Only for commands that run no hooks, so hooks never inherit GIT_LITERAL_PATHSPECS.
const LITERAL = '--literal-pathspecs'
const FROM_STDIN = ['--pathspec-from-file=-', '--pathspec-file-nul']

export async function stage(repo: string, paths: string[]): Promise<void> {
  await run([LITERAL, 'add', '-A', ...FROM_STDIN], repo, [0], paths.join('\0'))
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  const head = await run(['rev-parse', '-q', '--verify', 'HEAD'], repo, [0, 1])
  // no commit yet: rm --cached (-f: keep going if the work tree differs from the index, like restore does)
  const args = head.code === 1 ? ['rm', '--cached', '-r', '-q', '-f'] : ['restore', '--staged']
  await run([LITERAL, ...args, ...FROM_STDIN], repo, [0], paths.join('\0'))
}

const DIFF_OPTS = ['--no-color', '--no-ext-diff']

export async function readFileDiff(repo: string, target: DiffTarget): Promise<FileDiff> {
  const { path } = target
  if ('sha' in target) {
    assertRevision(target.sha)
    const args = [LITERAL, 'diff-tree', '-p', '--root', '-m', '--first-parent', '--no-commit-id', ...DIFF_OPTS, target.sha, '--', path]
    return parseDiff((await run(args, repo)).stdout)
  }
  if (target.staged) return parseDiff((await run([LITERAL, 'diff', '--cached', ...DIFF_OPTS, '--', path], repo)).stdout)
  const tracked = (await run([LITERAL, 'ls-files', '--', path], repo)).stdout !== ''
  if (tracked) return parseDiff((await run([LITERAL, 'diff', ...DIFF_OPTS, '--', path], repo)).stdout)
  return parseDiff((await run(['diff', '--no-index', ...DIFF_OPTS, '--', '/dev/null', path], repo, [0, 1])).stdout)
}

export async function commit(repo: string, message: string, amend: boolean): Promise<void> {
  if (!message.trim()) throw new GitError('commit message is empty')
  await run(['commit', '-F', '-', ...(amend ? ['--amend'] : [])], repo, [0], message)
}

// Branch names come from the renderer: no option-like names, and git's own ref-name rules.
export async function assertBranchName(repo: string, name: string): Promise<void> {
  if (name.startsWith('-')) throw new GitError(`invalid branch name: ${name}`)
  const { code } = await run(['check-ref-format', '--branch', name], repo, [0, 1, 128])
  if (code !== 0) throw new GitError(`invalid branch name: ${name}`)
}

export async function createBranch(repo: string, name: string, start: string, switchTo: boolean): Promise<void> {
  await assertBranchName(repo, name)
  assertRevision(start)
  await run(switchTo ? ['switch', '-c', name, start] : ['branch', name, start], repo)
}

const hasLocalBranch = async (repo: string, name: string) =>
  (await run(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], repo, [0, 1])).code === 0

// Local branch: switch to it. Remote branch (e.g. origin/topic): switch to the local branch of
// the same name if there is one, else create a tracking branch.
export async function checkout(repo: string, branch: string): Promise<void> {
  await assertBranchName(repo, branch)
  if (await hasLocalBranch(repo, branch)) return void (await run(['switch', branch], repo))
  const remote = (await remotes(repo)).find((r) => branch.startsWith(`${r}/`))
  const local = remote && branch.slice(remote.length + 1)
  if (local && (await hasLocalBranch(repo, local))) return void (await run(['switch', local], repo))
  await run(['switch', '--track', branch], repo)
}

export async function renameBranch(repo: string, from: string, to: string): Promise<void> {
  await assertBranchName(repo, from)
  await assertBranchName(repo, to)
  await run(['branch', '-m', from, to], repo)
}

export async function deleteBranch(repo: string, name: string, force: boolean): Promise<void> {
  await assertBranchName(repo, name)
  await run(['branch', force ? '-D' : '-d', name], repo)
}

const NETWORK_TIMEOUT = 120_000 // fetch: stalls are failures
const PUSH_TIMEOUT = 600_000 // push may legitimately upload a lot

export async function fetchAll(repo: string): Promise<void> {
  await run(['fetch', '--all', '--prune', '--quiet'], repo, [0], undefined, NETWORK_TIMEOUT)
}

export type PullMode = 'ff-only' | 'rebase' | 'merge'

// Fetch (network, time-limited) then integrate locally without a timer, so a slow merge or
// rebase is never killed halfway.
export async function pull(repo: string, mode: PullMode): Promise<'ok' | 'conflicts'> {
  const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo, [0, 128])
  if (upstream.code !== 0) throw new GitError('the current branch has no upstream branch')
  await run(['fetch', '--quiet'], repo, [0], undefined, NETWORK_TIMEOUT)
  // No explicit upstream argument: git then uses it with --fork-point, exactly like `git pull`.
  // A merge pull honours pull.ff like `git pull` does.
  const pullFf = await config(repo, 'pull.ff')
  const ff = pullFf === 'only' ? ['--ff-only'] : pullFf === 'false' ? ['--no-ff'] : []
  const integrate = { 'ff-only': ['merge', '--ff-only'], rebase: ['rebase'], merge: ['merge', '--no-edit', ...ff] }[mode]
  return mayConflict(repo, integrate)
}

async function remotes(repo: string): Promise<string[]> {
  return (await run(['remote'], repo)).stdout.split('\n').filter(Boolean)
}

async function config(repo: string, key: string): Promise<string> {
  return (await run(['config', '--get', key], repo, [0, 1])).stdout.trim()
}

// With an upstream, plain `git push` so git applies push.default, pushRemote and its
// name-mismatch protection. Without one, publish under the same name with -u.
// Force uses --force-if-includes so commits only seen via fetch are never overwritten.
export async function push(repo: string, force: boolean): Promise<void> {
  const branch = (await run(['symbolic-ref', '-q', '--short', 'HEAD'], repo, [0, 1])).stdout.trim()
  if (!branch) throw new GitError('cannot push a detached HEAD')
  const lease = force ? ['--force-with-lease', '--force-if-includes'] : []
  const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo, [0, 128])
  if (upstream.code === 0) {
    await run(['push', ...lease], repo, [0], undefined, PUSH_TIMEOUT)
    return
  }
  const all = await remotes(repo)
  if (!all.length) throw new GitError('no remote configured')
  const target = (await config(repo, 'remote.pushDefault')) || (all.includes('origin') ? 'origin' : all[0])
  await run(['push', '-u', ...lease, target, 'HEAD'], repo, [0], undefined, PUSH_TIMEOUT)
}

export function isRejectedPush(e: unknown): boolean {
  return e instanceof GitError && /\[rejected\]|non-fast-forward|fetch first|stale info/.test(e.stderr)
}

// remoteBranch like "origin/feature/x"
export async function deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void> {
  const remote = (await remotes(repo)).find((r) => remoteBranch.startsWith(`${r}/`))
  if (!remote) throw new GitError(`unknown remote branch: ${remoteBranch}`)
  const branch = remoteBranch.slice(remote.length + 1)
  await assertBranchName(repo, branch)
  await run(['push', remote, '--delete', `refs/heads/${branch}`], repo, [0], undefined, PUSH_TIMEOUT)
}

// Git directories that live outside the work tree (linked worktrees, submodules), so a
// watcher on the work tree alone would miss ref and index changes.
export async function gitDirsOutside(path: string): Promise<string[]> {
  const out = (await run(['rev-parse', '--absolute-git-dir', '--git-common-dir'], path)).stdout.trim().split('\n')
  const dirs = [...new Set(out.map((d) => resolve(path, d)))]
  return dirs.filter((d) => d !== join(path, '.git') && !d.startsWith(path + sep))
}

// ---- merge, rebase, cherry-pick ----

const OPERATION_MARKERS: [string, Operation][] = [
  ['rebase-merge', 'rebase'],
  ['rebase-apply/applying', 'am'], // git am shares rebase-apply with the old rebase backend
  ['rebase-apply', 'rebase'],
  ['MERGE_HEAD', 'merge'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'],
  ['REVERT_HEAD', 'revert']
]

export async function currentOperation(repo: string): Promise<Operation | null> {
  const args = OPERATION_MARKERS.flatMap(([file]) => ['--git-path', file])
  const paths = (await run(['rev-parse', ...args], repo)).stdout.trim().split('\n')
  const i = paths.findIndex((p) => existsSync(resolve(repo, p)))
  return i === -1 ? null : OPERATION_MARKERS[i][1]
}

const hasUnmerged = async (repo: string) => (await run(['ls-files', '-u'], repo)).stdout !== ''

// Runs a command that may stop on conflicts. 'conflicts' only if this command produced them (or
// started an operation that now waits); a refusal with conflicts already present is an error.
// A stop for any other reason (a hook rejecting a reworded message, an empty pick) is reported
// as the error it is; the operation bar then offers continue/skip/abort.
async function mayConflict(repo: string, args: string[], env: Record<string, string> = {}): Promise<'ok' | 'conflicts'> {
  const unmergedBefore = await hasUnmerged(repo)
  try {
    await run(args, repo, [0], undefined, 0, env)
    return 'ok'
  } catch (e) {
    if (!unmergedBefore && (await hasUnmerged(repo))) return 'conflicts'
    throw e
  }
}

export async function merge(repo: string, rev: string): Promise<'ok' | 'conflicts'> {
  await assertRef(repo, rev)
  return mayConflict(repo, ['merge', '--no-edit', rev])
}

export async function rebase(repo: string, onto: string): Promise<'ok' | 'conflicts'> {
  await assertRef(repo, onto)
  return mayConflict(repo, ['rebase', onto])
}

export async function cherryPick(repo: string, sha: string): Promise<'ok' | 'conflicts'> {
  assertRevision(sha)
  const parents = (await run(['rev-list', '--parents', '-n1', sha], repo)).stdout.trim().split(' ').length - 1
  return mayConflict(repo, ['cherry-pick', ...(parents > 1 ? ['-m', '1'] : []), sha])
}

// Branch/ref names or commit ids from the renderer.
async function assertRef(repo: string, rev: string): Promise<void> {
  if (/^[0-9a-f]{4,64}$/i.test(rev)) return
  await assertBranchName(repo, rev)
}

export async function continueOperation(repo: string): Promise<'ok' | 'conflicts'> {
  const op = await currentOperation(repo)
  if (!op) throw new GitError('no operation in progress')
  if (op === 'merge') return mayConflict(repo, ['commit', '--no-edit'])
  // A step whose resolution matches HEAD leaves nothing to commit: skip it like git suggests, but
  // only if index and work tree both equal HEAD — `rebase --skip` resets the work tree.
  const cleanAtHead = (await run(['diff', '--quiet', 'HEAD'], repo, [0, 1])).code === 0
  // Only a stopped pick can be skipped; a failed exec step (rescheduled) must run again instead.
  const stoppedOn = { rebase: 'REBASE_HEAD', 'cherry-pick': 'CHERRY_PICK_HEAD', revert: 'REVERT_HEAD', am: null }[op]
  const stoppedPick = !!stoppedOn && (await run(['rev-parse', '-q', '--verify', stoppedOn], repo, [0, 1])).code === 0
  if (cleanAtHead && stoppedPick && !(await hasUnmerged(repo))) return mayConflict(repo, [op, '--skip'])
  return mayConflict(repo, [op, '--continue'])
}

export async function abortOperation(repo: string): Promise<void> {
  const op = await currentOperation(repo)
  if (!op) throw new GitError('no operation in progress')
  await run([op, '--abort'], repo)
}

export async function skipOperation(repo: string): Promise<'ok' | 'conflicts'> {
  const op = await currentOperation(repo)
  if (op !== 'rebase' && op !== 'cherry-pick' && op !== 'revert' && op !== 'am') throw new GitError('nothing to skip')
  return mayConflict(repo, [op, '--skip'])
}

// Renderer paths that are opened directly on disk: inside the work tree and actually unmerged.
async function conflictedFile(repo: string, path: string): Promise<string> {
  const full = resolve(repo, path)
  if (!full.startsWith(repo + sep)) throw new GitError(`path outside repository: ${path}`)
  if (!(await run([LITERAL, 'ls-files', '-u', '--', path], repo)).stdout) throw new GitError(`not in conflict: ${path}`)
  return full
}

async function indexStage(repo: string, n: 1 | 2 | 3, path: string): Promise<string | null> {
  const { code, stdout } = await run(['show', `:${n}:${path}`], repo, [0, 128])
  return code === 0 ? stdout : null
}

async function stages(repo: string, path: string) {
  const [base, ours, theirs] = await Promise.all([1, 2, 3].map((n) => indexStage(repo, n as 1 | 2 | 3, path)))
  const versions = [base, ours, theirs]
  return {
    base,
    ours,
    theirs,
    binary: versions.some((v) => v?.includes('\0')), // same heuristic git uses
    crlf: versions.some((v) => v?.includes('\r\n'))
  }
}

export async function readConflict(repo: string, path: string): Promise<ConflictVersions> {
  const full = await conflictedFile(repo, path)
  const [{ base, ours, theirs, binary }, merged] = await Promise.all([stages(repo, path), readFile(full, 'utf8').catch(() => null)])
  return { base, ours, theirs, merged, binary }
}

export async function resolveConflict(repo: string, path: string, resolution: Resolution): Promise<void> {
  const full = await conflictedFile(repo, path)
  if ('delete' in resolution) {
    await run([LITERAL, 'rm', '-q', '--', path], repo)
    return
  }
  if ('content' in resolution) {
    const st = await lstat(full).catch(() => null)
    if (st?.isSymbolicLink()) throw new GitError(`refusing to write through a symlink: ${path}`)
    const { binary, crlf } = await stages(repo, path)
    if (binary) throw new GitError(`binary file: choose a side instead of editing ${path}`)
    // Text edited in the UI arrives with LF only; keep the file's CRLF style.
    await writeFile(full, crlf ? resolution.content.replace(/\r?\n/g, '\r\n') : resolution.content)
  } else {
    await run([LITERAL, 'checkout', `--${resolution.side}`, '--', path], repo)
  }
  await stage(repo, [path])
}

// ---- stashes (addressed by commit id; stash@{n} shifts whenever the list changes) ----

export async function listStashes(repo: string): Promise<Commit[]> {
  return parseLog((await run(['stash', 'list', '-z', `--format=${LOG_FORMAT}`], repo)).stdout)
}

async function stashRef(repo: string, sha: string): Promise<string> {
  assertRevision(sha)
  const i = (await listStashes(repo)).findIndex((s) => s.sha === sha)
  if (i === -1) throw new GitError('stash no longer exists')
  return `stash@{${i}}`
}

// Stashes tracked and untracked changes (git's "WIP on <branch>" message when empty).
// "Nothing to stash" is decided by git itself (refs/stash unchanged), not by a status check that
// misses e.g. untracked files hidden by status.showUntrackedFiles=no.
export async function stashPush(repo: string, message: string): Promise<void> {
  const top = async () => (await run(['rev-parse', '-q', '--verify', 'refs/stash'], repo, [0, 1])).stdout.trim()
  const before = await top()
  await run(['stash', 'push', '--include-untracked', ...(message ? [`--message=${message}`] : [])], repo)
  if ((await top()) === before) throw new GitError('nothing to stash')
}

// --index restores what was staged; git refuses it when the index would conflict, then the
// changes are applied without restoring the staging.
export async function stashApply(repo: string, sha: string, pop: boolean): Promise<'ok' | 'conflicts'> {
  const ref = await stashRef(repo, sha)
  try {
    return await mayConflict(repo, ['stash', pop ? 'pop' : 'apply', '--index', ref])
  } catch (e) {
    if (!/without --index|Conflicts in index/.test(String(e))) throw e
    return mayConflict(repo, ['stash', pop ? 'pop' : 'apply', ref])
  }
}

export async function stashDrop(repo: string, sha: string): Promise<void> {
  await run(['stash', 'drop', await stashRef(repo, sha)], repo)
}

// Stages (from the unstaged diff) or unstages (from the staged diff, applied in reverse) one hunk
// or some of its lines. The patch is rebuilt here from the current diff; the renderer only names
// the hunk, and a changed hunk header means the user looked at an outdated diff.
export async function stageHunk(repo: string, sel: HunkSelection): Promise<void> {
  if (!sel.staged && !(await run([LITERAL, 'ls-files', '--', sel.path], repo)).stdout)
    throw new GitError('untracked files can only be staged as a whole')
  if (sel.staged) {
    // A staged rename is a deletion plus an addition; unstaging only the new path would leave the
    // deletion staged.
    const renamed = (await readStatus(repo)).find((f) => f.path === sel.path && f.oldPath)
    if (renamed && sel.lines) throw new GitError('renamed files can only be unstaged as a whole')
    if (renamed) return unstage(repo, [renamed.path, renamed.oldPath!])
  }
  const diff = await readFileDiff(repo, { path: sel.path, staged: sel.staged })
  const hunk = diff.hunks[sel.hunk]
  if (!hunk || hunk.header !== sel.hunkHeader || hunkKey(hunk) !== sel.hunkLines)
    throw new GitError('the diff changed meanwhile — please review it again')
  const changed = hunk.lines.filter((l) => l.type !== ' ').map((l) => l.text)
  if (changed.length && changed.every((t) => /^Subproject commit [0-9a-f]+(-dirty)?$/.test(t)) && new Set(changed.map((t) => t.replace(/-dirty$/, ''))).size === 1)
    throw new GitError('nothing to stage: the change is uncommitted work inside the submodule — commit it there first')
  if (sel.lines && diff.header.some((h) => /^(new|deleted) file mode/.test(h)))
    throw new GitError('added or deleted files can only be staged as a whole')
  let patch: string
  try {
    patch = buildPatch(diff, sel.hunk, sel.lines, sel.staged)
  } catch (e) {
    throw new GitError((e as Error).message)
  }
  await run(['apply', '--cached', '--recount', ...(sel.staged ? ['--reverse'] : []), '-'], repo, [0], patch)
}

// ---- interactive rebase ----

export async function readRebasePlan(repo: string, base: string): Promise<RebaseCommit[]> {
  assertRevision(base)
  if ((await run(['merge-base', '--is-ancestor', base, 'HEAD'], repo, [0, 1])).code !== 0)
    throw new GitError('the selected commit is not an ancestor of HEAD')
  if ((await run(['rev-list', '--merges', `${base}..HEAD`], repo)).stdout.trim())
    throw new GitError('the range contains merge commits; rebasing merges interactively is not supported')
  const f = (await run(['log', '-z', '--reverse', '--format=%H%x00%s%x00%B', `${base}..HEAD`], repo)).stdout.split('\0')
  const commits: RebaseCommit[] = []
  for (let i = 0; i + 3 <= f.length; i += 3) commits.push({ sha: f[i], subject: f[i + 1], message: f[i + 2].trimEnd() })
  return commits
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

// Runs `git rebase -i base` with a todo list built here from a validated plan (exactly the commits
// after base, each once). git gets the list through sequence.editor = "cp <our file>"; rewording
// is a pick followed by an amend with the new message from a file. Files live in the git dir
// because a rebase that stops on conflicts still needs them when it continues.
export async function interactiveRebase(repo: string, base: string, steps: RebaseStep[]): Promise<'ok' | 'conflicts'> {
  const commits = await readRebasePlan(repo, base)
  const expected = new Set(commits.map((c) => c.sha))
  const seen = new Set(steps.map((s) => s.sha))
  if (steps.length !== expected.size || seen.size !== steps.length || steps.some((s) => !expected.has(s.sha)))
    throw new GitError('the rebase plan does not match the commits after the selected commit')
  const first = steps.find((s) => s.action !== 'drop')
  if (first && (first.action === 'squash' || first.action === 'fixup'))
    throw new GitError('the first commit cannot be squashed or fixed up into a previous one')
  if (steps.some((s) => s.action === 'reword' && !s.message?.trim())) throw new GitError('reword needs a commit message')

  const op = await currentOperation(repo)
  if (op) throw new GitError(`a ${op} is in progress — finish or abort it first`)
  const dir = resolve(repo, (await run(['rev-parse', '--git-path', 'gitspynx-rebase'], repo)).stdout.trim())
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const todo: string[] = []
  for (const [i, s] of steps.entries()) {
    if (s.action !== 'reword') {
      todo.push(`${s.action} ${s.sha}`)
      continue
    }
    const msg = join(dir, `message-${i}`)
    await writeFile(msg, s.message!.trim() + '\n')
    todo.push(`pick ${s.sha}`, `exec git commit --amend --only --allow-empty --quiet -F ${shellQuote(msg)}`)
  }
  const todoFile = join(dir, 'todo')
  await writeFile(todoFile, todo.join('\n') + '\n')
  // GIT_SEQUENCE_EDITOR (env) wins over any configured or inherited editor; a failed exec
  // (e.g. a commit-msg hook rejecting the new message) is rescheduled instead of lost.
  const result = await mayConflict(repo, ['rebase', '-i', '--reschedule-failed-exec', base], { GIT_SEQUENCE_EDITOR: `cp ${shellQuote(todoFile)}` })
  if (result === 'ok') await rm(dir, { recursive: true, force: true }) // still needed while stopped
  return result
}

// ---- undo / redo ----

// Executes the steps of an undo or redo in order. Every step first checks that the repository is
// still in the state the recorded action left it in; otherwise nothing more is changed.
// Everything that can be checked before the first step runs, so a multi-step entry is not left
// half applied (e.g. switched branch, then refused to delete the moved branch).
async function precheckUndo(repo: string, steps: UndoStep[]): Promise<void> {
  const gone = () => new GitError('the repository changed since this action — it cannot be undone')
  for (const [i, step] of steps.entries()) {
    if (step.type === 'deleteBranch') {
      const at = (await run(['rev-parse', '-q', '--verify', `refs/heads/${step.name}`], repo, [0, 1])).stdout.trim()
      if (at !== step.expect) throw gone()
    } else if (step.type === 'reset' && i === 0) {
      const head = await readHead(repo)
      if (head.sha !== step.expect || head.branch !== step.branch) throw gone()
    }
  }
}

// HEAD as git sees it now (the renderer's view may lag behind a reload).
export async function readHead(repo: string): Promise<{ sha: string | null; branch: string | null }> {
  const [sha, branch] = await Promise.all([
    run(['rev-parse', '-q', '--verify', 'HEAD'], repo, [0, 1]),
    run(['symbolic-ref', '-q', '--short', 'HEAD'], repo, [0, 1])
  ])
  return { sha: sha.stdout.trim() || null, branch: branch.stdout.trim() || null }
}

// Messages containing "cannot be undone" mean the recorded state is gone for good (the renderer
// then forgets the entry); any other failure may be temporary (local changes, a lock).
export async function applyUndo(repo: string, steps: UndoStep[]): Promise<void> {
  const op = await currentOperation(repo)
  if (op) throw new GitError(`a ${op} is in progress — finish or abort it first`)
  await precheckUndo(repo, steps)
  for (const step of steps) {
    switch (step.type) {
      case 'reset': {
        assertRevision(step.expect)
        assertRevision(step.to)
        const head = await readHead(repo)
        if (head.sha !== step.expect || head.branch !== step.branch)
          throw new GitError('the repository changed since this action — it cannot be undone')
        // soft: keep the undone commit's changes staged; keep: like reset --hard but refuses to
        // touch files with local changes
        await run(['reset', step.mode === 'soft' ? '--soft' : '--keep', step.to], repo)
        break
      }
      case 'checkout':
        await checkout(repo, step.branch)
        break
      case 'createBranch':
        await assertBranchName(repo, step.name)
        assertRevision(step.sha)
        await run(['branch', step.name, step.sha], repo)
        if (step.upstream) {
          await run(['config', `branch.${step.name}.remote`, step.upstream.remote], repo)
          await run(['config', `branch.${step.name}.merge`, step.upstream.merge], repo)
        }
        break
      case 'deleteBranch': {
        await assertBranchName(repo, step.name)
        const at = (await run(['rev-parse', '-q', '--verify', `refs/heads/${step.name}`], repo, [0, 1])).stdout.trim()
        if (at !== step.expect) throw new GitError('the branch changed since this action — it cannot be undone')
        await run(['branch', '-D', step.name], repo)
        break
      }
      case 'renameBranch':
        await renameBranch(repo, step.from, step.to)
        break
    }
  }
}

// ---- worktrees ----

// -z needs git 2.36; older versions get the newline format (paths with newlines are then ambiguous).
export async function listWorktrees(repo: string): Promise<Worktree[]> {
  try {
    return parseWorktrees((await run(['worktree', 'list', '--porcelain', '-z'], repo)).stdout)
  } catch (e) {
    if ((e as GitError).code !== 129) throw e // 129: unknown option
    return parseWorktrees((await run(['worktree', 'list', '--porcelain'], repo)).stdout, '\n')
  }
}

// fromSha given: create the branch there; otherwise check out the existing branch.
// fromSha set: a new branch is created, so the name must be free.
export async function assertNewWorktreeBranch(repo: string, branch: string, fromSha: string | null): Promise<void> {
  await assertBranchName(repo, branch)
  if (fromSha && (await hasLocalBranch(repo, branch))) throw new GitError(`a branch named '${branch}' already exists`)
}

export async function addWorktree(repo: string, path: string, branch: string, fromSha: string | null): Promise<void> {
  if (!isAbsolute(path)) throw new GitError('work tree path must be absolute')
  await assertNewWorktreeBranch(repo, branch, fromSha)
  if (fromSha) assertRevision(fromSha)
  await run(fromSha ? ['worktree', 'add', '-b', branch, path, fromSha] : ['worktree', 'add', path, branch], repo)
}

export async function removeWorktree(repo: string, path: string, force: boolean): Promise<void> {
  const tree = (await listWorktrees(repo)).find((t) => t.path === path)
  if (!tree) throw new GitError(`not a work tree of this repository: ${path}`)
  if (tree.main) throw new GitError('the main work tree cannot be removed')
  await run(['worktree', 'remove', ...(force ? ['--force'] : []), path], repo)
}

export async function pruneWorktrees(repo: string): Promise<void> {
  await run(['worktree', 'prune'], repo)
}

// ---- submodules ----

// From the index (cheap: no per-submodule `git describe` like `submodule status`): gitlinks are
// mode 160000; initialized = has a .git; modified = checked-out commit differs from the recorded one.
export async function listSubmodules(repo: string): Promise<Submodule[]> {
  // ponytail: no .gitmodules → skip reading the whole index; embedded repos without a mapping are then not listed
  if (!existsSync(join(repo, '.gitmodules'))) return []
  const [index, changed] = await Promise.all([
    run(['ls-files', '-s', '-z'], repo),
    run(['diff-files', '--ignore-submodules=dirty', '--name-only', '-z'], repo)
  ])
  const modified = new Set(changed.stdout.split('\0'))
  const byPath = new Map<string, Submodule>()
  for (const entry of index.stdout.split('\0')) {
    const m = /^160000 ([0-9a-f]+) (\d)\t(.*)$/s.exec(entry)
    if (!m) continue
    const [, sha, stage, path] = m
    if (stage !== '0') {
      byPath.set(path, { path, sha, state: 'conflict' })
      continue
    }
    const state = !existsSync(join(repo, path, '.git')) ? 'uninitialized' : modified.has(path) ? 'modified' : 'ok'
    byPath.set(path, { path, sha, state })
  }
  return [...byPath.values()]
}

// Given paths: initialize (if needed) and update just those. Empty: update the initialized ones
// only, so submodules left uninitialized on purpose are not cloned. Paths are passed as
// :(literal) pathspecs (a global --literal-pathspecs would leak into submodule hooks). No
// wall-clock limit (an initial clone can take long); HTTP transfers that stall are aborted.
// ponytail: an SSH transfer that stalls is only stopped by the 30 min backstop
export async function updateSubmodules(repo: string, paths: string[]): Promise<void> {
  const stall = ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=60']
  const args = paths.length
    ? [...stall, 'submodule', 'update', '--init', '--recursive', '--', ...paths.map((p) => `:(literal)${p}`)]
    : [...stall, 'submodule', 'update', '--recursive']
  await run(args, repo, [0], undefined, 30 * 60_000)
}

// ---- Git LFS ----

// Read from the top-level .gitattributes directly: listing via `git lfs track` would install
// missing LFS hooks as a side effect (even into a tracked core.hooksPath folder).
async function lfsPatterns(repo: string): Promise<string[]> {
  return readFile(join(repo, '.gitattributes'), 'utf8').then(parseLfsPatterns, () => [])
}

export async function lfsInfo(repo: string): Promise<LfsInfo> {
  const [version, patterns, filter] = await Promise.all([
    run(['lfs', 'version'], repo, [0, 1, 128, 129]).catch(() => ({ code: -1, stdout: '' })),
    lfsPatterns(repo),
    config(repo, 'filter.lfs.process')
  ])
  return { installed: version.code === 0, configured: !!filter, patterns }
}

// Sets the LFS filters up for this repository if neither the user (git lfs install) nor an
// earlier call did. --skip-repo: existing hooks (husky, own pre-push) are left alone.
async function ensureLfsConfigured(repo: string): Promise<void> {
  if (!(await config(repo, 'filter.lfs.process'))) await run(['lfs', 'install', '--local', '--skip-repo'], repo)
}

// "!" would write a negative attribute pattern, which git ignores: tracking would silently do nothing.
function assertLfsPattern(pattern: string) {
  if (!pattern.trim() || /^[-!]/.test(pattern) || /[\n\r\0]/.test(pattern) || pattern.length > 500)
    throw new GitError(`invalid LFS pattern: ${pattern}`)
}

export async function lfsTrack(repo: string, pattern: string): Promise<void> {
  assertLfsPattern(pattern)
  await ensureLfsConfigured(repo)
  await run(['lfs', 'track', '--', pattern], repo)
}

export async function lfsUntrack(repo: string, pattern: string): Promise<void> {
  assertLfsPattern(pattern)
  await run(['lfs', 'untrack', '--', pattern], repo)
}

// Downloads LFS objects for the checked-out commit and replaces pointer files with their content.
// (Without configured filters `git lfs pull` skips the checkout and still exits 0.)
export async function lfsPull(repo: string): Promise<void> {
  await ensureLfsConfigured(repo)
  await run(['lfs', 'pull'], repo, [0], undefined, 30 * 60_000)
}
