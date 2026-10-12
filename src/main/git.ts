import { execFile } from 'node:child_process'
import { basename, dirname } from 'node:path'
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

// Runs git without a shell. Exit codes listed in okCodes are returned instead of thrown.
export function run(args: string[], cwd: string, okCodes = [0], stdin?: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        // literal pathspecs: renderer-supplied paths never act as globs or :(magic)
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', LC_ALL: 'C' }
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
        if (okCodes.includes(code)) return resolve({ code, stdout })
        reject(new GitError(stderr.trim() || err?.message || 'git failed', code, stderr))
      }
    )
    child.stdin?.end(stdin)
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
    run(['diff-tree', '-r', '--root', '-m', '--first-parent', '--no-commit-id', '--name-status', '-z', rev, '--'], repo)
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

export async function stage(repo: string, paths: string[]): Promise<void> {
  await run(['add', '-A', '--', ...paths], repo)
}

export async function unstage(repo: string, paths: string[]): Promise<void> {
  const head = await run(['rev-parse', '-q', '--verify', 'HEAD'], repo, [0, 1])
  if (head.code === 1) await run(['rm', '--cached', '-r', '-q', '--', ...paths], repo) // no commit yet
  else await run(['restore', '--staged', '--', ...paths], repo)
}

const DIFF_OPTS = ['--no-color', '--no-ext-diff']

export async function readFileDiff(repo: string, target: DiffTarget): Promise<FileDiff> {
  const { path } = target
  if ('sha' in target) {
    assertRevision(target.sha)
    const args = ['diff-tree', '-p', '--root', '-m', '--first-parent', '--no-commit-id', ...DIFF_OPTS, target.sha, '--', path]
    return parseDiff((await run(args, repo)).stdout)
  }
  if (target.staged) return parseDiff((await run(['diff', '--cached', ...DIFF_OPTS, '--', path], repo)).stdout)
  const tracked = (await run(['ls-files', '--', path], repo)).stdout !== ''
  if (tracked) return parseDiff((await run(['diff', ...DIFF_OPTS, '--', path], repo)).stdout)
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

// Local branch: switch to it. Remote branch (e.g. origin/topic): create a tracking branch.
export async function checkout(repo: string, branch: string): Promise<void> {
  await assertBranchName(repo, branch)
  const local = await run(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repo, [0, 1])
  await run(local.code === 0 ? ['switch', branch] : ['switch', '--track', branch], repo)
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
