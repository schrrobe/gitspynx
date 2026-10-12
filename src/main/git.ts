import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { Commit, CommitDetail, DiffTarget, FileDiff, FileStatus, RepoInfo } from '../shared/types'
import { LOG_FORMAT, parseDiff, parseLog, parseNameStatus, parseRefs, parseStatus, REF_FORMAT } from './parse'

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
export function run(args: string[], cwd: string, okCodes = [0], stdin?: string, timeout = 0): Promise<Result> {
  return new Promise((resolve, reject) => {
    if (!existsSync(cwd)) return reject(new GitError(`folder not found: ${cwd}`))
    const child = spawn('git', ['--no-optional-locks', ...args], {
      cwd,
      detached: timeout > 0 && process.platform !== 'win32', // own process group for the timer
      // English messages for the few checks that match git output; hooks inherit only this
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_MESSAGES: 'C' }
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let failure: GitError | null = null
    const stop = (e: GitError) => {
      failure ??= e
      try {
        if (child.pid && timeout > 0 && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    }
    const timer = timeout > 0 ? setTimeout(() => stop(new GitError(`git ${args[0]} timed out after ${timeout / 1000}s`)), timeout) : undefined
    child.stdout.on('data', (d: Buffer) => {
      size += d.length
      if (size > MAX_OUTPUT) stop(new GitError(`git ${args[0]} output too large`))
      else out.push(d)
    })
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new GitError(e.code === 'ENOENT' ? 'git executable not found — is git installed?' : e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stderr = Buffer.concat(err).toString()
      if (failure) return reject(new GitError(failure.message, code, stderr))
      const exit = code ?? -1
      if (okCodes.includes(exit)) return resolve({ code: exit, stdout: Buffer.concat(out).toString() })
      reject(new GitError(stderr.trim() || `git ${args[0]} failed (${exit})`, exit, stderr))
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
  const tips = [...new Set([...(head.sha ? [head.sha] : []), ...refs.map((r) => r.target)])]
  return { path, head, refs, tips }
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
export async function pull(repo: string, mode: PullMode): Promise<void> {
  const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repo, [0, 128])
  if (upstream.code !== 0) throw new GitError('the current branch has no upstream branch')
  await run(['fetch', '--quiet'], repo, [0], undefined, NETWORK_TIMEOUT)
  const integrate = { 'ff-only': ['merge', '--ff-only'], rebase: ['rebase'], merge: ['merge', '--no-edit'] }[mode]
  await run([...integrate, '@{upstream}'], repo)
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
