import { execFile } from 'node:child_process'
import type { Commit, CommitDetail, RepoInfo } from '../shared/types'
import { LOG_FORMAT, parseLog, parseNameStatus, parseRefs, REF_FORMAT, US } from './parse'

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
export function run(args: string[], cwd: string, okCodes = [0]): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['--no-optional-locks', ...args],
      {
        cwd,
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
      },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0
        if (okCodes.includes(code)) return resolve({ code, stdout })
        reject(new GitError(stderr.trim() || err?.message || 'git failed', code, stderr))
      }
    )
  })
}

// Revisions come from the renderer; anything option-like or exotic is rejected.
export function assertRevision(rev: string): void {
  if (!/^[0-9a-f]{4,64}$/i.test(rev) && !/^HEAD(~\d+)?$/.test(rev)) {
    throw new GitError(`invalid revision: ${rev}`)
  }
}

export async function openRepo(dir: string): Promise<RepoInfo> {
  // A .git directory is accepted too; resolve to the work tree.
  const { stdout: isGitDir } = await run(['rev-parse', '--is-inside-git-dir'], dir).catch(() => {
    throw new GitError(`not a git repository: ${dir}`)
  })
  const cwd = isGitDir.trim() === 'true' ? `${dir}/..` : dir
  const path = (await run(['rev-parse', '--show-toplevel'], cwd)).stdout.trim()
  const [branch, sha, refs] = await Promise.all([
    run(['symbolic-ref', '-q', '--short', 'HEAD'], path, [0, 1]),
    run(['rev-parse', '-q', '--verify', 'HEAD'], path, [0, 1]),
    run(['for-each-ref', `--format=${REF_FORMAT}`], path)
  ])
  return {
    path,
    head: { branch: branch.stdout.trim() || null, sha: sha.stdout.trim() || null },
    refs: parseRefs(refs.stdout)
  }
}

export async function readLog(repo: string, skip: number, limit: number): Promise<Commit[]> {
  const { stdout } = await run(
    ['log', '--all', '--topo-order', `--format=${LOG_FORMAT}`, `--skip=${skip}`, `-n${limit}`],
    repo,
    [0, 128] // 128: unborn HEAD / no commits yet
  )
  return parseLog(stdout)
}

const DETAIL_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s', '%cn', '%ct', '%b'].join('%x1f')

export async function readCommit(repo: string, rev: string): Promise<CommitDetail> {
  assertRevision(rev)
  const [meta, files] = await Promise.all([
    run(['show', '-s', `--format=${DETAIL_FORMAT}`, rev, '--'], repo),
    run(['diff-tree', '-r', '--root', '-m', '--first-parent', '--no-commit-id', '--name-status', '-z', rev, '--'], repo)
  ])
  const [sha, parents, author, email, date, subject, committer, committerDate, body] = meta.stdout.split(US)
  return {
    sha,
    parents: parents ? parents.split(' ') : [],
    author,
    email,
    date: Number(date),
    subject,
    committer,
    committerDate: Number(committerDate),
    body: body.trimEnd(),
    files: parseNameStatus(files.stdout)
  }
}
