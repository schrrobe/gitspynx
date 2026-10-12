import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertRevision,
  checkout,
  commit,
  createBranch,
  deleteBranch,
  GitError,
  openRepo,
  readCommit,
  readFileDiff,
  readLog,
  readStatus,
  renameBranch,
  stage,
  unstage
} from './git'

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 't@example.com'
}
Object.assign(process.env, env) // run() inherits process.env: isolate from the user's git config
let dir: string
const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, env }).toString().trim()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitspynx-'))
  g('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), '1')
  g('add', '.')
  g('commit', '-q', '-m', 'first')
  g('switch', '-q', '-c', 'topic')
  writeFileSync(join(dir, 'b.txt'), '2')
  g('add', '.')
  g('commit', '-q', '-m', 'on topic')
  g('switch', '-q', 'main')
  g('merge', '-q', '--no-ff', '-m', 'merge topic', 'topic')
  g('tag', '-a', 'v1', '-m', 'release')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('git backend', () => {
  it('opens a repository from a subdirectory and reports head and refs', async () => {
    const info = await openRepo(join(dir, '.git'))
    expect(info.path).toBe(g('rev-parse', '--show-toplevel'))
    expect(info.head).toEqual({ branch: 'main', sha: g('rev-parse', 'HEAD') })
    expect(info.refs.map((r) => r.name).sort()).toEqual(['main', 'topic', 'v1'])
    expect(info.refs.find((r) => r.name === 'v1')!.target).toBe(g('rev-parse', 'HEAD'))
  })

  it('rejects a directory that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'gitspynx-plain-'))
    await expect(openRepo(plain)).rejects.toBeInstanceOf(GitError)
    rmSync(plain, { recursive: true })
  })

  it('reads the log in topological order with paging', async () => {
    const { tips } = await openRepo(dir)
    const all = await readLog(dir, tips, 0, 100)
    expect(all.map((c) => c.subject)).toEqual(['merge topic', 'on topic', 'first'])
    expect(all[0].parents).toHaveLength(2)
    expect((await readLog(dir, tips, 1, 1)).map((c) => c.subject)).toEqual(['on topic'])
  })

  it('pages over the tips captured when the repo was opened', async () => {
    const { tips } = await openRepo(dir)
    g('commit', '-q', '--allow-empty', '-m', 'made later in a terminal')
    const page = await readLog(dir, tips, 0, 1)
    g('reset', '-q', '--hard', 'HEAD~1')
    expect(page.map((c) => c.subject)).toEqual(['merge topic'])
  })

  it('keeps separator characters inside subjects and bodies', async () => {
    g('commit', '-q', '--allow-empty', '-m', 'odd \x1e subject', '-m', 'body \x1f text')
    const { tips } = await openRepo(dir)
    const [top] = await readLog(dir, tips, 0, 1)
    const detail = await readCommit(dir, 'HEAD')
    g('reset', '-q', '--hard', 'HEAD~1')
    expect(top.subject).toBe('odd \x1e subject')
    expect(detail.body).toBe('body \x1f text')
  })

  it('returns no commits for a repository without commits', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gitspynx-empty-'))
    execFileSync('git', ['init', '-q'], { cwd: empty, env })
    const info = await openRepo(empty)
    expect(info.head.sha).toBeNull()
    expect(await readLog(empty, info.tips, 0, 10)).toEqual([])
    rmSync(empty, { recursive: true })
  })

  it('refuses bare repositories and git-internal directories', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'gitspynx-bare-'))
    execFileSync('git', ['init', '-q', '--bare'], { cwd: bare, env })
    await expect(openRepo(bare)).rejects.toThrow(/bare/)
    rmSync(bare, { recursive: true })
    await expect(openRepo(join(dir, '.git', 'refs'))).rejects.toThrow(/inside the \.git directory/)
  })

  it('does not open a surrounding repository for a nested bare repo', async () => {
    const nested = join(dir, '.git', 'nested.git')
    mkdirSync(nested)
    execFileSync('git', ['init', '-q', '--bare'], { cwd: nested, env })
    await expect(openRepo(nested)).rejects.toThrow(/bare/)
    rmSync(nested, { recursive: true })
  })

  it('reads commit details with files changed against the first parent', async () => {
    const merge = await readCommit(dir, 'HEAD')
    expect(merge.subject).toBe('merge topic')
    expect(merge.files).toEqual([{ status: 'A', path: 'b.txt' }])
    const root = await readCommit(dir, 'HEAD~1')
    expect(root.files).toEqual([{ status: 'A', path: 'a.txt' }])
  })

  it('refuses revisions that could be read as options', () => {
    expect(() => assertRevision('--output=/tmp/x')).toThrow(GitError)
    expect(() => assertRevision('a'.repeat(40))).not.toThrow()
  })
})

describe('working directory', () => {
  let wd: string
  const w = (...args: string[]) => execFileSync('git', args, { cwd: wd, env }).toString().trim()

  beforeAll(() => {
    wd = mkdtempSync(join(tmpdir(), 'gitspynx-wd-'))
    w('init', '-q', '-b', 'main')
  })
  afterAll(() => rmSync(wd, { recursive: true, force: true }))

  it('stages and unstages in a repository without commits', async () => {
    writeFileSync(join(wd, 'first.txt'), 'hello\n')
    await stage(wd, ['first.txt'])
    expect(await readStatus(wd)).toEqual([{ path: 'first.txt', staged: 'A', unstaged: null, conflicted: false }])
    await unstage(wd, ['first.txt'])
    expect(await readStatus(wd)).toEqual([{ path: 'first.txt', staged: null, unstaged: '?', conflicted: false }])
  })

  it('commits staged changes and amends the last commit', async () => {
    await stage(wd, ['first.txt'])
    await commit(wd, 'initial\n\nbody text', false)
    expect(w('log', '-1', '--format=%s|%b')).toBe('initial|body text')
    writeFileSync(join(wd, 'second.txt'), 'x\n')
    await stage(wd, ['second.txt'])
    await commit(wd, 'initial, amended', true)
    expect(w('rev-list', '--count', 'HEAD')).toBe('1')
    expect(w('show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean)).toEqual([
      'initial, amended',
      'first.txt',
      'second.txt'
    ])
  })

  it('stages a deletion', async () => {
    rmSync(join(wd, 'second.txt'))
    await stage(wd, ['second.txt'])
    expect(await readStatus(wd)).toEqual([{ path: 'second.txt', staged: 'D', unstaged: null, conflicted: false }])
    await unstage(wd, ['second.txt'])
    expect(await readStatus(wd)).toEqual([{ path: 'second.txt', staged: null, unstaged: 'D', conflicted: false }])
  })

  it('diffs unstaged, staged and untracked files', async () => {
    writeFileSync(join(wd, 'first.txt'), 'hello\nworld\n')
    const unstaged = await readFileDiff(wd, { path: 'first.txt', staged: false })
    expect(unstaged.hunks[0].lines.map((l) => l.type + l.text)).toEqual([' hello', '+world'])
    expect((await readFileDiff(wd, { path: 'first.txt', staged: true })).hunks).toEqual([])
    writeFileSync(join(wd, 'new.txt'), 'a\nb\n')
    const untracked = await readFileDiff(wd, { path: 'new.txt', staged: false })
    expect(untracked.hunks[0].lines.map((l) => l.type + l.text)).toEqual(['+a', '+b'])
  })

  it('diffs a file inside a commit against its first parent', async () => {
    const d = await readFileDiff(wd, { path: 'first.txt', sha: w('rev-parse', 'HEAD') })
    expect(d.hunks[0].lines.map((l) => l.type + l.text)).toEqual(['+hello'])
  })

  it('treats a path that looks like an option as a literal path', async () => {
    writeFileSync(join(wd, '--force'), 'x')
    await stage(wd, ['--force'])
    expect((await readStatus(wd)).find((f) => f.path === '--force')?.staged).toBe('A')
  })

  it('refuses to commit with an empty message', async () => {
    await expect(commit(wd, '   \n', false)).rejects.toBeInstanceOf(GitError)
  })
})

describe('branches', () => {
  let bd: string
  const b = (...args: string[]) => execFileSync('git', args, { cwd: bd, env }).toString().trim()

  beforeAll(() => {
    bd = mkdtempSync(join(tmpdir(), 'gitspynx-br-'))
    b('init', '-q', '-b', 'main')
    writeFileSync(join(bd, 'a.txt'), '1')
    b('add', '.')
    b('commit', '-q', '-m', 'one')
  })
  afterAll(() => rmSync(bd, { recursive: true, force: true }))

  it('creates a branch at a commit, optionally checking it out', async () => {
    const head = b('rev-parse', 'HEAD')
    await createBranch(bd, 'feature/x', head, false)
    expect(b('rev-parse', 'feature/x')).toBe(head)
    expect(b('branch', '--show-current')).toBe('main')
    await createBranch(bd, 'work', head, true)
    expect(b('branch', '--show-current')).toBe('work')
  })

  it('switches to a local branch and to a remote branch via a tracking branch', async () => {
    await checkout(bd, 'main')
    expect(b('branch', '--show-current')).toBe('main')
    b('remote', 'add', 'origin', 'https://example.invalid/repo.git')
    b('update-ref', 'refs/remotes/origin/topic', 'HEAD')
    await checkout(bd, 'origin/topic')
    expect(b('branch', '--show-current')).toBe('topic')
    expect(b('rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/topic')
  })

  it('renames and deletes branches', async () => {
    await renameBranch(bd, 'feature/x', 'feature/y')
    expect(b('branch', '--list', 'feature/*')).toBe('feature/y')
    await deleteBranch(bd, 'feature/y', false)
    expect(b('branch', '--list', 'feature/*')).toBe('')
  })

  it('refuses to delete an unmerged branch unless forced', async () => {
    await createBranch(bd, 'unmerged', b('rev-parse', 'HEAD'), true)
    b('commit', '-q', '--allow-empty', '-m', 'only here')
    await checkout(bd, 'main')
    await expect(deleteBranch(bd, 'unmerged', false)).rejects.toThrow(/not fully merged/)
    await deleteBranch(bd, 'unmerged', true)
    expect(b('branch', '--list', 'unmerged')).toBe('')
  })

  it('rejects invalid or option-like branch names', async () => {
    const head = b('rev-parse', 'HEAD')
    await expect(createBranch(bd, '-D', head, false)).rejects.toBeInstanceOf(GitError)
    await expect(createBranch(bd, 'bad..name', head, false)).rejects.toBeInstanceOf(GitError)
    await expect(checkout(bd, '--orphan=x')).rejects.toBeInstanceOf(GitError)
  })
})
