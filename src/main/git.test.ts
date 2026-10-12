import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  abortOperation,
  assertRevision,
  cherryPick,
  continueOperation,
  merge,
  readConflict,
  rebase,
  resolveConflict,
  skipOperation,
  checkout,
  commit,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  fetchAll,
  GitError,
  isRejectedPush,
  openRepo,
  pull,
  push,
  readCommit,
  readFileDiff,
  readLog,
  readStatus,
  renameBranch,
  run,
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

  it('reports renames in commit details', async () => {
    g('mv', 'a.txt', 'renamed.txt')
    g('commit', '-q', '-m', 'rename')
    const d = await readCommit(dir, 'HEAD')
    g('reset', '-q', '--hard', 'HEAD~1')
    expect(d.files).toEqual([{ status: 'R', path: 'renamed.txt', oldPath: 'a.txt' }])
  })

  it('says so when the repository folder is gone', async () => {
    await expect(run(['status'], join(dir, 'does-not-exist'))).rejects.toThrow(/folder not found/)
  })

  it('kills the whole process tree on timeout', async () => {
    const marker = `sleep 7.${process.pid}`
    await expect(run(['-c', `alias.hang=!${marker}; true`, 'hang'], dir, [0], undefined, 300)).rejects.toThrow(/timed out/)
    await new Promise((r) => setTimeout(r, 200))
    const left = execFileSync('ps', ['-axo', 'command']).toString().split('\n').filter((l) => l.startsWith(marker))
    expect(left).toEqual([])
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

  it('lets hooks use glob pathspecs', async () => {
    writeFileSync(join(wd, 'code.ts'), 'x')
    const out = join(wd, '..', `${basename(wd)}-hook.txt`)
    writeFileSync(join(wd, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\ngit diff --cached --name-only -- '*.ts' > '${out}'\n`, { mode: 0o755 })
    await stage(wd, ['code.ts'])
    await commit(wd, 'with hook', false)
    rmSync(join(wd, '.git', 'hooks', 'pre-commit'))
    expect(readFileSync(out, 'utf8').trim()).toBe('code.ts')
    rmSync(out)
  })

  it('stages and unstages more paths than fit on a command line', async () => {
    const many = join(wd, 'many')
    mkdirSync(many)
    const names = Array.from({ length: 12000 }, (_, i) => `many/${'x'.repeat(90)}${i}`)
    for (const n of names) writeFileSync(join(wd, n), '')
    await stage(wd, names)
    expect((await readStatus(wd)).filter((f) => f.staged === 'A' && f.path.startsWith('many/'))).toHaveLength(12000)
    await unstage(wd, names)
    expect((await readStatus(wd)).filter((f) => f.staged && f.path.startsWith('many/'))).toHaveLength(0)
    rmSync(many, { recursive: true })
  })

  it('unstages a file that was staged and then modified before the first commit', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'gitspynx-unborn-'))
    execFileSync('git', ['init', '-q'], { cwd: fresh, env })
    writeFileSync(join(fresh, 'x.txt'), 'one')
    await stage(fresh, ['x.txt'])
    writeFileSync(join(fresh, 'x.txt'), 'two')
    await unstage(fresh, ['x.txt'])
    expect(await readStatus(fresh)).toEqual([{ path: 'x.txt', staged: null, unstaged: '?', conflicted: false }])
    rmSync(fresh, { recursive: true })
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

  it('switches to the existing local branch when a remote branch is checked out again', async () => {
    await checkout(bd, 'main')
    await checkout(bd, 'origin/topic') // local topic exists since the previous test
    expect(b('branch', '--show-current')).toBe('topic')
    await checkout(bd, 'main')
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

describe('remotes', () => {
  let root: string
  let remote: string
  let a: string // clone used through the API
  let b: string // second clone simulating a colleague
  const at = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env }).toString().trim()

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'gitspynx-remote-'))
    remote = join(root, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env })
    const seed = join(root, 'seed')
    execFileSync('git', ['clone', '-q', remote, seed], { env })
    at(seed, 'commit', '-q', '--allow-empty', '-m', 'seed')
    at(seed, 'push', '-q', 'origin', 'main')
    a = join(root, 'a')
    b = join(root, 'b')
    execFileSync('git', ['clone', '-q', remote, a], { env })
    execFileSync('git', ['clone', '-q', remote, b], { env })
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('fetches new commits and pulls them fast-forward', async () => {
    at(b, 'commit', '-q', '--allow-empty', '-m', 'from b')
    at(b, 'push', '-q', 'origin', 'main')
    await fetchAll(a)
    expect(at(a, 'rev-list', '--count', 'main..origin/main')).toBe('1')
    await pull(a, 'ff-only')
    expect(at(a, 'log', '-1', '--format=%s')).toBe('from b')
  })

  it('pushes the current branch and sets an upstream for a new branch', async () => {
    at(a, 'switch', '-q', '-c', 'topic')
    at(a, 'commit', '-q', '--allow-empty', '-m', 'topic work')
    await push(a, false)
    expect(at(a, 'rev-parse', '--abbrev-ref', 'topic@{upstream}')).toBe('origin/topic')
    expect(at(remote, 'log', '-1', '--format=%s', 'topic')).toBe('topic work')
  })

  it('reports a rejected push and force-pushes an amended own commit', async () => {
    at(a, 'commit', '--amend', '-q', '--allow-empty', '-m', 'topic work rewritten')
    await fetchAll(a)
    const err = await push(a, false).catch((e) => e)
    expect(err).toBeInstanceOf(GitError)
    expect(isRejectedPush(err)).toBe(true)
    await push(a, true)
    expect(at(remote, 'log', '-1', '--format=%s', 'topic')).toBe('topic work rewritten')
  })

  it('refuses ff-only pull when histories diverged', async () => {
    at(b, 'fetch', '-q')
    at(b, 'switch', '-q', 'main')
    at(b, 'commit', '-q', '--allow-empty', '-m', 'b main again')
    at(b, 'push', '-q', 'origin', 'main')
    at(a, 'switch', '-q', 'main')
    at(a, 'commit', '-q', '--allow-empty', '-m', 'a main local')
    await expect(pull(a, 'ff-only')).rejects.toBeInstanceOf(GitError)
    await pull(a, 'rebase')
    expect(at(a, 'log', '-2', '--format=%s').split('\n')).toEqual(['a main local', 'b main again'])
  })

  it('never pushes a branch onto a differently named upstream', async () => {
    at(a, 'fetch', '-q')
    at(a, 'switch', '-q', '-c', 'my-fix', '--track', 'origin/main')
    at(a, 'commit', '-q', '--allow-empty', '-m', 'fix meant for review')
    const before = at(remote, 'rev-parse', 'main')
    const err = await push(a, false).catch((e) => e)
    expect(err).toBeInstanceOf(GitError)
    expect(isRejectedPush(err)).toBe(false) // no force offer
    expect(at(remote, 'rev-parse', 'main')).toBe(before)
    at(a, 'switch', '-q', 'main')
  })

  it('refuses a forced push that would drop commits seen only through fetch', async () => {
    at(a, 'switch', '-q', 'main')
    at(a, 'pull', '-q', '--rebase')
    at(a, 'push', '-q')
    at(b, 'pull', '-q', '--rebase')
    at(b, 'commit', '-q', '--allow-empty', '-m', 'colleague work')
    at(b, 'push', '-q')
    at(a, 'commit', '-q', '--allow-empty', '-m', 'mine, diverged')
    await fetchAll(a) // remote-tracking ref now includes the colleague commit
    expect(isRejectedPush(await push(a, false).catch((e) => e))).toBe(true)
    await expect(push(a, true)).rejects.toBeInstanceOf(GitError)
    expect(at(remote, 'log', '-1', '--format=%s', 'main')).toBe('colleague work')
  })

  it('deletes a branch on the remote', async () => {
    await deleteRemoteBranch(a, 'origin/topic')
    expect(at(remote, 'branch', '--list', 'topic')).toBe('')
  })

  it('fails with a clear message when there is no remote', async () => {
    const lonely = mkdtempSync(join(tmpdir(), 'gitspynx-noremote-'))
    at(lonely, 'init', '-q', '-b', 'main')
    at(lonely, 'commit', '-q', '--allow-empty', '-m', 'x')
    await expect(push(lonely, false)).rejects.toThrow(/no remote/)
    rmSync(lonely, { recursive: true })
  })
})

describe('merge, rebase, cherry-pick and conflicts', () => {
  let md: string
  const m = (...args: string[]) => execFileSync('git', args, { cwd: md, env }).toString().trim()
  const write = (f: string, c: string) => writeFileSync(join(md, f), c)

  // main: base -> main-change ; side: base -> side-change (both edit f.txt line 2)
  beforeAll(() => {
    md = mkdtempSync(join(tmpdir(), 'gitspynx-merge-'))
    m('init', '-q', '-b', 'main')
    write('f.txt', 'one\ntwo\nthree\n')
    m('add', '.')
    m('commit', '-q', '-m', 'base')
    m('switch', '-q', '-c', 'side')
    write('f.txt', 'one\nSIDE\nthree\n')
    m('commit', '-q', '-am', 'side-change')
    m('switch', '-q', 'main')
    write('f.txt', 'one\nMAIN\nthree\n')
    m('commit', '-q', '-am', 'main-change')
    m('switch', '-q', '-c', 'clean', 'main~1')
    write('other.txt', 'x\n')
    m('add', '.')
    m('commit', '-q', '-m', 'clean-change')
    m('switch', '-q', 'main')
  })
  afterAll(() => rmSync(md, { recursive: true, force: true }))

  it('merges cleanly', async () => {
    expect(await merge(md, 'clean')).toBe('ok')
    expect(m('log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    m('reset', '-q', '--hard', 'HEAD~1')
  })

  it('stops on conflicts, exposes the three versions and completes after resolving', async () => {
    expect(await merge(md, 'side')).toBe('conflicts')
    expect((await openRepo(md)).operation).toBe('merge')
    expect((await readStatus(md)).find((f) => f.path === 'f.txt')?.conflicted).toBe(true)
    const c = await readConflict(md, 'f.txt')
    expect(c.base).toBe('one\ntwo\nthree\n')
    expect(c.ours).toBe('one\nMAIN\nthree\n')
    expect(c.theirs).toBe('one\nSIDE\nthree\n')
    expect(c.merged).toContain('<<<<<<<')
    await resolveConflict(md, 'f.txt', { content: 'one\nMAIN+SIDE\nthree\n' })
    await continueOperation(md)
    expect((await openRepo(md)).operation).toBeNull()
    expect(m('show', 'HEAD:f.txt')).toBe('one\nMAIN+SIDE\nthree')
    expect(m('log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    m('reset', '-q', '--hard', 'HEAD~1')
  })

  it('aborts a conflicted merge', async () => {
    const head = m('rev-parse', 'HEAD')
    expect(await merge(md, 'side')).toBe('conflicts')
    await abortOperation(md)
    expect((await openRepo(md)).operation).toBeNull()
    expect(m('rev-parse', 'HEAD')).toBe(head)
    expect(m('status', '--porcelain')).toBe('')
  })

  it('rebases with a conflict resolved by taking one side', async () => {
    m('switch', '-q', 'side')
    expect(await rebase(md, 'main')).toBe('conflicts')
    expect((await openRepo(md)).operation).toBe('rebase')
    await resolveConflict(md, 'f.txt', { side: 'theirs' }) // during rebase: theirs = the commit being replayed
    await continueOperation(md)
    expect((await openRepo(md)).operation).toBeNull()
    expect(m('log', '--format=%s', '-3').split('\n')).toEqual(['side-change', 'main-change', 'base'])
    expect(m('show', 'HEAD:f.txt')).toBe('one\nSIDE\nthree')
    m('reset', '-q', '--hard', 'ORIG_HEAD')
    m('switch', '-q', 'main')
  })

  it('skips a conflicting commit during a rebase', async () => {
    m('switch', '-q', 'side')
    expect(await rebase(md, 'main')).toBe('conflicts')
    await skipOperation(md)
    expect((await openRepo(md)).operation).toBeNull()
    expect(m('rev-parse', 'HEAD')).toBe(m('rev-parse', 'main'))
    m('reset', '-q', '--hard', 'ORIG_HEAD')
    m('switch', '-q', 'main')
  })

  it('cherry-picks a commit and stops on conflicts', async () => {
    expect(await cherryPick(md, m('rev-parse', 'clean'))).toBe('ok')
    expect(m('log', '-1', '--format=%s')).toBe('clean-change')
    m('reset', '-q', '--hard', 'HEAD~1')
    expect(await cherryPick(md, m('rev-parse', 'side'))).toBe('conflicts')
    expect((await openRepo(md)).operation).toBe('cherry-pick')
    await resolveConflict(md, 'f.txt', { side: 'ours' })
    await continueOperation(md) // resolved to HEAD's content: nothing left to commit
    expect((await openRepo(md)).operation).toBeNull()
    expect(m('log', '-1', '--format=%s')).toBe('main-change')
  })

  it('only resolves paths that are actually in conflict', async () => {
    await expect(resolveConflict(md, 'f.txt', { content: 'overwritten' })).rejects.toThrow(/not in conflict/)
    expect(m('status', '--porcelain')).toBe('')
  })

  it('refuses to write conflict content through a symlink', async () => {
    expect(await merge(md, 'side')).toBe('conflicts')
    rmSync(join(md, 'f.txt'))
    symlinkSync('/tmp/gitspynx-should-not-exist', join(md, 'f.txt'))
    await expect(resolveConflict(md, 'f.txt', { content: 'x' })).rejects.toThrow(/symlink/)
    expect(existsSync('/tmp/gitspynx-should-not-exist')).toBe(false)
    rmSync(join(md, 'f.txt'))
    await abortOperation(md)
  })

  it('refuses to resolve paths outside the repository', async () => {
    await expect(resolveConflict(md, '../evil.txt', { content: 'x' })).rejects.toBeInstanceOf(GitError)
    await expect(readConflict(md, '../../etc/passwd')).rejects.toBeInstanceOf(GitError)
  })

  it('reports a failure that is not a conflict as an error', async () => {
    write('f.txt', 'dirty\n')
    await expect(merge(md, 'side')).rejects.toBeInstanceOf(GitError)
    m('checkout', '--', 'f.txt')
  })
})
