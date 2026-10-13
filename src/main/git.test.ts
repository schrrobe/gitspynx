import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { rebaseState, setIdleHold, assertNewWorktreeBranch,
  abortOperation,
  lfsInfo,
  lfsTrack,
  lfsUntrack,
  listSubmodules,
  updateSubmodules,
  addWorktree,
  listWorktrees,
  pruneWorktrees,
  removeWorktree,
  applyUndo,
  readHead,
  assertRevision,
  cherryPick,
  continueOperation,
  currentOperation,
  merge,
  readConflict,
  readRebasePlan,
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
  interactiveRebase,
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
  stageHunk,
  stashApply,
  stashDrop,
  stashPush,
  listStashes,
  unstage
} from './git'
import { parseWorktrees } from './parse'
import { hunkKey } from '../shared/hunk'

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
  it('reports whether git-lfs is available', async () => {
    let installed = true
    try {
      execFileSync('git', ['lfs', 'version'], { stdio: 'ignore' })
    } catch {
      installed = false
    }
    expect((await openRepo(dir)).lfsAvailable).toBe(installed)
  })

  it('opens a repository from a subdirectory and reports head and refs', async () => {
    const info = await openRepo(join(dir, '.git'))
    expect(info.path).toBe(realpathSync.native(g('rev-parse', '--show-toplevel'))) // native form on Windows
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

  it('escalates to SIGKILL when git ignores the timeout signal', async () => {
    const t0 = Date.now()
    await expect(run(['-c', 'alias.stubborn=!trap "" TERM; sleep 30', 'stubborn'], dir, [0], undefined, 300)).rejects.toThrow(/timed out/)
    expect(Date.now() - t0).toBeLessThan(8000)
  }, 15_000)

  it('stops a command that shows no progress for the idle limit, unless a prompt holds it', async () => {
    const quiet = ['-c', 'alias.quiet=!sleep 5', 'quiet']
    const t0 = Date.now()
    await expect(run(quiet, dir, [0], undefined, 0, {}, 300)).rejects.toThrow(/no progress/)
    expect(Date.now() - t0).toBeLessThan(4000)
    const chatty = ['-c', 'alias.chatty=!for i in 1 2 3 4 5 6; do echo tick >&2; sleep 0.1; done', 'chatty']
    await expect(run(chatty, dir, [0], undefined, 0, {}, 400)).resolves.toBeTruthy()
    let held = true
    setIdleHold(() => held) // e.g. a password dialog is open
    try {
      const short = ['-c', 'alias.short=!sleep 1', 'short']
      await expect(run(short, dir, [0], undefined, 0, {}, 300)).resolves.toBeTruthy()
    } finally {
      held = false
      setIdleHold(() => false)
    }
  }, 15_000)

  it('keeps the end of a long stderr, where git puts the actual error', async () => {
    const noisy = 'alias.noisy=!head -c 1500000 /dev/zero | tr "\\0" x >&2; echo REAL_ERROR >&2; exit 1'
    await expect(run(['-c', noisy, 'noisy'], dir)).rejects.toThrow(/REAL_ERROR/)
  })

  it.skipIf(process.platform === 'win32')('kills the whole process tree on timeout', async () => { // ps-based check
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
  }, 120_000) // creates 12000 files; slow on Windows runners (hit 30 s there)

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

  it('honours pull.ff=false for merge pulls', async () => {
    at(a, 'switch', '-q', 'main')
    at(a, 'pull', '-q', '--rebase')
    at(b, 'pull', '-q', '--rebase')
    at(b, 'commit', '-q', '--allow-empty', '-m', 'ff-able')
    at(b, 'push', '-q')
    at(a, 'config', 'pull.ff', 'no') // any boolean spelling git accepts
    await pull(a, 'merge')
    expect(at(a, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2) // a merge commit, as configured
    at(a, 'config', '--unset', 'pull.ff')
    at(a, 'reset', '-q', '--hard', 'origin/main')
  })

  it('reports conflicts of a pull instead of failing', async () => {
    at(a, 'switch', '-q', 'main')
    writeFileSync(join(b, 'clash.txt'), 'b\n')
    at(b, 'add', '.')
    at(b, 'commit', '-q', '-m', 'b clash')
    at(b, 'push', '-q')
    writeFileSync(join(a, 'clash.txt'), 'a\n')
    at(a, 'add', '.')
    at(a, 'commit', '-q', '-m', 'a clash')
    expect(await pull(a, 'merge')).toBe('conflicts')
    at(a, 'merge', '--abort')
    at(a, 'reset', '-q', '--hard', 'origin/main')
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

  it('pulls with rebase like git pull --rebase after an upstream force-push', async () => {
    at(a, 'switch', '-q', 'main')
    at(a, 'pull', '-q', '--rebase')
    at(a, 'push', '-q')
    at(b, 'fetch', '-q')
    at(b, 'switch', '-q', 'main')
    at(b, 'reset', '-q', '--hard', 'origin/main')
    at(b, 'commit', '-q', '--allow-empty', '-m', 'u3')
    at(b, 'push', '-q')
    at(a, 'pull', '-q', '--rebase')
    at(a, 'commit', '-q', '--allow-empty', '-m', 'mine')
    at(b, 'commit', '-q', '--amend', '--allow-empty', '-m', 'u3-rewritten')
    at(b, 'push', '-q', '--force')
    await pull(a, 'rebase')
    expect(at(a, 'log', '-3', '--format=%s').split('\n')).toEqual(['mine', 'u3-rewritten', at(b, 'log', '-1', '--format=%s', 'HEAD~1')])
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

  it('never discards unstaged work when continuing a rebase', async () => {
    write('g.txt', 'g0\n')
    m('add', 'g.txt')
    m('commit', '-q', '-m', 'add g')
    m('switch', '-q', 'side')
    expect(await rebase(md, 'main')).toBe('conflicts')
    await resolveConflict(md, 'f.txt', { side: 'ours' }) // resolution equals HEAD: commit becomes empty
    write('g.txt', 'precious edit\n') // tracked file edited while stopped, not staged
    await continueOperation(md).catch(() => {})
    expect(readFileSync(join(md, 'g.txt'), 'utf8')).toBe('precious edit\n')
    m('checkout', '--', 'g.txt')
    if ((await openRepo(md)).operation) await abortOperation(md)
    m('switch', '-q', 'main')
    m('reset', '-q', '--hard', 'HEAD~1')
  })

  it('reports a refused operation as an error, not as conflicts', async () => {
    expect(await merge(md, 'side')).toBe('conflicts')
    await expect(cherryPick(md, m('rev-parse', 'clean'))).rejects.toBeInstanceOf(GitError)
    await abortOperation(md)
  })

  it('reports a stopped git am as its own operation and aborts it', async () => {
    m('switch', '-q', 'side')
    const patch = execFileSync('git', ['format-patch', '-1', '--stdout'], { cwd: md, env }).toString()
    m('switch', '-q', 'main')
    try {
      execFileSync('git', ['am', '-q'], { cwd: md, env, input: patch, stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      // stops: the patch does not apply on main
    }
    expect(await currentOperation(md)).toBe('am')
    await abortOperation(md)
    expect(await currentOperation(md)).toBeNull()
  })

  it('tells which branch a stopped rebase rewrites and where it started', async () => {
    m('switch', '-q', 'side')
    const before = m('rev-parse', 'HEAD')
    expect(await rebase(md, 'main')).toBe('conflicts')
    try {
      expect(await rebaseState(md)).toEqual({ branch: 'side', origHead: before })
    } finally {
      await abortOperation(md)
      m('switch', '-q', 'main')
    }
    expect(await rebaseState(md)).toBeNull()
  })

  it('continues even when GIT_EDITOR points to a failing editor', async () => {
    const saved = process.env.GIT_EDITOR
    process.env.GIT_EDITOR = 'false'
    try {
      m('switch', '-q', 'side')
      expect(await rebase(md, 'main')).toBe('conflicts')
      await resolveConflict(md, 'f.txt', { content: 'one\nBOTH\nthree\n' })
      expect(await continueOperation(md)).toBe('ok')
      expect((await openRepo(md)).operation).toBeNull()
    } finally {
      if (saved === undefined) delete process.env.GIT_EDITOR
      else process.env.GIT_EDITOR = saved
      if (await currentOperation(md)) await abortOperation(md)
      else m('reset', '-q', '--hard', 'ORIG_HEAD')
      m('switch', '-q', 'main')
    }
  })

  it('flags binary conflicts and refuses text resolution for them', async () => {
    m('switch', '-q', '-c', 'bin-a', 'main~1')
    writeFileSync(join(md, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0xff, 0x01]))
    m('add', '.')
    m('commit', '-q', '-m', 'bin a')
    m('switch', '-q', '-c', 'bin-b', 'main~1')
    writeFileSync(join(md, 'img.bin'), Buffer.from([0x89, 0x50, 0x00, 0xfe, 0x02]))
    m('add', '.')
    m('commit', '-q', '-m', 'bin b')
    expect(await merge(md, 'bin-a')).toBe('conflicts')
    expect((await readConflict(md, 'img.bin')).binary).toBe(true)
    await expect(resolveConflict(md, 'img.bin', { content: 'x' })).rejects.toThrow(/binary/)
    await resolveConflict(md, 'img.bin', { side: 'theirs' })
    expect([...readFileSync(join(md, 'img.bin'))]).toEqual([0x89, 0x50, 0x00, 0xff, 0x01])
    await abortOperation(md)
    m('switch', '-q', 'main')
  })

  it('keeps CRLF line endings when resolving with edited text', async () => {
    m('switch', '-q', '-c', 'crlf-a', 'main~1')
    write('w.txt', 'a\r\nb\r\n')
    m('add', '.')
    m('commit', '-q', '-m', 'crlf a')
    m('switch', '-q', '-c', 'crlf-b', 'main~1')
    write('w.txt', 'a\r\nc\r\n')
    m('add', '.')
    m('commit', '-q', '-m', 'crlf b')
    expect(await merge(md, 'crlf-a')).toBe('conflicts')
    await resolveConflict(md, 'w.txt', { content: 'a\nbc\n' }) // textarea normalises to LF
    expect(readFileSync(join(md, 'w.txt'), 'utf8')).toBe('a\r\nbc\r\n')
    await abortOperation(md)
    m('switch', '-q', 'main')
  })

  it('only resolves paths that are actually in conflict', async () => {
    await expect(resolveConflict(md, 'f.txt', { content: 'overwritten' })).rejects.toThrow(/not in conflict/)
    expect(m('status', '--porcelain')).toBe('')
  })

  it('refuses to write conflict content through a symlink', async () => {
    const target = join(tmpdir(), `gitspynx-symlink-target-${process.pid}`)
    expect(await merge(md, 'side')).toBe('conflicts')
    try {
      rmSync(join(md, 'f.txt'))
      symlinkSync(target, join(md, 'f.txt'))
      await expect(resolveConflict(md, 'f.txt', { content: 'x' })).rejects.toThrow(/symlink/)
      expect(existsSync(target)).toBe(false)
    } finally {
      rmSync(join(md, 'f.txt'), { force: true })
      rmSync(target, { force: true })
      await abortOperation(md)
    }
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

describe('stashes', () => {
  let sd: string
  const s = (...args: string[]) => execFileSync('git', args, { cwd: sd, env }).toString().trim()
  const write = (f: string, c: string) => writeFileSync(join(sd, f), c)

  beforeAll(() => {
    sd = mkdtempSync(join(tmpdir(), 'gitspynx-stash-'))
    s('init', '-q', '-b', 'main')
    write('t.txt', 'base\n')
    s('add', '.')
    s('commit', '-q', '-m', 'base')
  })
  afterAll(() => rmSync(sd, { recursive: true, force: true }))

  it('stashes tracked and untracked changes with a message and lists them newest first', async () => {
    write('t.txt', 'changed\n')
    write('new.txt', 'untracked\n')
    await stashPush(sd, 'first stash')
    expect(s('status', '--porcelain')).toBe('')
    write('t.txt', 'second\n')
    await stashPush(sd, '-looks like an option')
    const list = await listStashes(sd)
    expect(list.map((x) => x.subject)).toEqual(['On main: -looks like an option', 'On main: first stash'])
    expect(list[0].sha).toBe(s('rev-parse', 'stash@{0}'))
  })

  it('does not list stash internals as history', async () => {
    const info = await openRepo(sd)
    expect(info.tips).not.toContain(s('rev-parse', 'stash@{0}'))
    expect(info.stashes).toHaveLength(2)
  })

  it('applies a stash by id and keeps it, pops and drops by id', async () => {
    const [newest, older] = await listStashes(sd)
    expect(await stashApply(sd, older.sha, false)).toBe('ok')
    expect(readFileSync(join(sd, 'new.txt'), 'utf8')).toBe('untracked\n')
    expect(await listStashes(sd)).toHaveLength(2)
    s('reset', '-q', '--hard')
    s('clean', '-qfd')
    expect(await stashApply(sd, older.sha, true)).toBe('ok')
    expect((await listStashes(sd)).map((x) => x.sha)).toEqual([newest.sha])
    s('reset', '-q', '--hard')
    s('clean', '-qfd')
    await stashDrop(sd, newest.sha)
    expect(await listStashes(sd)).toEqual([])
  })

  it('reports conflicts when applying onto conflicting changes and refuses unknown stashes', async () => {
    write('t.txt', 'stashed side\n')
    await stashPush(sd, 'will conflict')
    write('t.txt', 'committed side\n')
    s('commit', '-q', '-am', 'diverge')
    const [st] = await listStashes(sd)
    expect(await stashApply(sd, st.sha, true)).toBe('conflicts')
    expect(await listStashes(sd)).toHaveLength(1) // pop keeps the stash when it conflicts
    s('reset', '-q', '--hard')
    await expect(stashDrop(sd, 'a'.repeat(40))).rejects.toThrow(/no longer exists/)
  })

  it('refuses to stash when there is nothing to stash', async () => {
    await expect(stashPush(sd, '')).rejects.toThrow(/nothing to stash/)
  })
})

describe('hunk and line staging', () => {
  let hd: string
  const h = (...args: string[]) => execFileSync('git', args, { cwd: hd, env }).toString()
  const lines = (n: number, change: (i: number) => string | null = () => null) =>
    Array.from({ length: n }, (_, i) => change(i) ?? `line ${i}`).join('\n') + '\n'

  beforeAll(() => {
    hd = mkdtempSync(join(tmpdir(), 'gitspynx-hunk-'))
    h('init', '-q', '-b', 'main')
    writeFileSync(join(hd, 'f.txt'), lines(30))
    h('add', '.')
    h('commit', '-q', '-m', 'base')
  })
  afterAll(() => rmSync(hd, { recursive: true, force: true }))
  const reset = () => h('reset', '-q', '--hard')

  it('stages one of two hunks', async () => {
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 1 ? 'CHANGED 1' : i === 25 ? 'CHANGED 25' : null)))
    const d = await readFileDiff(hd, { path: 'f.txt', staged: false })
    expect(d.hunks).toHaveLength(2)
    await stageHunk(hd, { path: 'f.txt', staged: false, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]) })
    expect(h('diff', '--cached')).toContain('+CHANGED 1')
    expect(h('diff', '--cached')).not.toContain('CHANGED 25')
    expect(h('diff')).toContain('+CHANGED 25')
    reset()
  })

  it('stages a single added line and unstages it again', async () => {
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 10 ? 'line 10\nADD A\nADD B' : null)))
    const d = await readFileDiff(hd, { path: 'f.txt', staged: false })
    const idx = d.hunks[0].lines.findIndex((l) => l.text === 'ADD B')
    await stageHunk(hd, { path: 'f.txt', staged: false, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]), lines: [idx] })
    expect(h('show', ':f.txt')).toContain('line 10\nADD B\nline 11')
    expect(h('show', ':f.txt')).not.toContain('ADD A')
    const s = await readFileDiff(hd, { path: 'f.txt', staged: true })
    const sIdx = s.hunks[0].lines.findIndex((l) => l.text === 'ADD B')
    await stageHunk(hd, { path: 'f.txt', staged: true, hunk: 0, hunkHeader: s.hunks[0].header, hunkLines: hunkKey(s.hunks[0]), lines: [sIdx] })
    expect(h('diff', '--cached')).toBe('')
    expect(readFileSync(join(hd, 'f.txt'), 'utf8')).toContain('ADD A\nADD B') // work tree untouched
    reset()
  })

  it('refuses when the diff changed since it was shown', async () => {
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 3 ? 'X' : null)))
    const d = await readFileDiff(hd, { path: 'f.txt', staged: false })
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 3 ? 'X' : i === 4 ? 'Y' : null)))
    await expect(stageHunk(hd, { path: 'f.txt', staged: false, hunk: 0, hunkHeader: d.hunks[0].header + 'x', hunkLines: hunkKey(d.hunks[0]) })).rejects.toThrow(/changed/)
    reset()
  })

  it('refuses when lines changed under an unchanged hunk header', async () => {
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 3 ? 'SEEN' : null)))
    const d = await readFileDiff(hd, { path: 'f.txt', staged: false })
    writeFileSync(join(hd, 'f.txt'), lines(30, (i) => (i === 3 ? 'UNSEEN' : null)))
    const sel = { path: 'f.txt', staged: false, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]) }
    await expect(stageHunk(hd, sel)).rejects.toThrow(/changed/)
    reset()
  })

  it('refuses partial staging of added and deleted files with a clear message', async () => {
    writeFileSync(join(hd, 'new.txt'), 'a\nb\n')
    h('add', 'new.txt')
    const n = await readFileDiff(hd, { path: 'new.txt', staged: true })
    await expect(stageHunk(hd, { path: 'new.txt', staged: true, hunk: 0, hunkHeader: n.hunks[0].header, hunkLines: hunkKey(n.hunks[0]), lines: [0] })).rejects.toThrow(/as a whole/)
    h('rm', '-q', '--cached', 'new.txt')
    rmSync(join(hd, 'new.txt'))
    rmSync(join(hd, 'f.txt'))
    const del = await readFileDiff(hd, { path: 'f.txt', staged: false })
    await expect(stageHunk(hd, { path: 'f.txt', staged: false, hunk: 0, hunkHeader: del.hunks[0].header, hunkLines: hunkKey(del.hunks[0]), lines: [0] })).rejects.toThrow(/as a whole/)
    reset()
  })

  it('unstages a staged rename completely', async () => {
    h('mv', 'f.txt', 'g.txt')
    const d = await readFileDiff(hd, { path: 'g.txt', staged: true })
    await stageHunk(hd, { path: 'g.txt', staged: true, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]) })
    expect(h('diff', '--cached', '--name-status')).toBe('')
    rmSync(join(hd, 'g.txt'))
    reset()
  })

  it('refuses line staging for untracked files', async () => {
    writeFileSync(join(hd, 'new.txt'), 'a\nb\n')
    const d = await readFileDiff(hd, { path: 'new.txt', staged: false })
    await expect(stageHunk(hd, { path: 'new.txt', staged: false, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]), lines: [0] })).rejects.toThrow(/untracked/)
    rmSync(join(hd, 'new.txt'))
  })
})

describe('interactive rebase', () => {
  let rd: string
  const r = (...args: string[]) => execFileSync('git', args, { cwd: rd, env }).toString().trim()
  let base: string
  let c1: string, c2: string, c3: string

  beforeEach(() => {
    rd = mkdtempSync(join(tmpdir(), 'gitspynx-irebase-'))
    r('init', '-q', '-b', 'main')
    writeFileSync(join(rd, 'base.txt'), 'base\n')
    r('add', '.')
    r('commit', '-q', '-m', 'base')
    base = r('rev-parse', 'HEAD')
    for (const n of [1, 2, 3]) {
      writeFileSync(join(rd, `f${n}.txt`), `${n}\n`)
      r('add', '.')
      r('commit', '-q', '-m', `commit ${n}`)
    }
    ;[c1, c2, c3] = ['HEAD~2', 'HEAD~1', 'HEAD'].map((x) => r('rev-parse', x))
  })
  afterEach(() => rmSync(rd, { recursive: true, force: true }))
  const subjects = () => r('log', '--format=%s', `${base}..HEAD`).split('\n').filter(Boolean)

  it('lists the commits after the base, oldest first', async () => {
    expect((await readRebasePlan(rd, base)).map((c) => c.subject)).toEqual(['commit 1', 'commit 2', 'commit 3'])
  })

  it('reorders, rewords, squashes, fixes up and drops', async () => {
    const result = await interactiveRebase(rd, base, [
      { sha: c3, action: 'reword', message: 'third, reworded' },
      { sha: c1, action: 'pick' },
      { sha: c2, action: 'squash' }
    ])
    expect(result).toBe('ok')
    expect(subjects()).toEqual(['commit 1', 'third, reworded'])
    expect(r('log', '-1', '--format=%B')).toContain('commit 2')
    expect(r('ls-files').split('\n').sort()).toEqual(['base.txt', 'f1.txt', 'f2.txt', 'f3.txt'])

    await interactiveRebase(rd, base, [
      { sha: r('rev-parse', 'HEAD~1'), action: 'pick' },
      { sha: r('rev-parse', 'HEAD'), action: 'drop' }
    ])
    expect(subjects()).toEqual(['third, reworded'])
  })

  it('fixup keeps the first message', async () => {
    await interactiveRebase(rd, base, [
      { sha: c1, action: 'pick' },
      { sha: c2, action: 'fixup' },
      { sha: c3, action: 'pick' }
    ])
    expect(subjects()).toEqual(['commit 3', 'commit 1'])
    expect(r('log', '-1', '--format=%B', 'HEAD~1')).toBe('commit 1')
  })

  it('rejects plans that do not match the commits after the base', async () => {
    await expect(interactiveRebase(rd, base, [{ sha: c1, action: 'pick' }, { sha: c2, action: 'pick' }])).rejects.toThrow(/plan/)
    await expect(
      interactiveRebase(rd, base, [{ sha: c1, action: 'pick' }, { sha: c2, action: 'pick' }, { sha: base, action: 'pick' }])
    ).rejects.toThrow(/plan/)
    await expect(
      interactiveRebase(rd, base, [{ sha: c1, action: 'squash' }, { sha: c2, action: 'pick' }, { sha: c3, action: 'pick' }])
    ).rejects.toThrow(/first/)
    await expect(
      interactiveRebase(rd, base, [{ sha: c1, action: 'reword', message: ' ' }, { sha: c2, action: 'pick' }, { sha: c3, action: 'pick' }])
    ).rejects.toThrow(/message/)
  })

  it('refuses ranges containing merge commits', async () => {
    r('switch', '-q', '-c', 'side', c1)
    writeFileSync(join(rd, 'side.txt'), 's\n')
    r('add', '.')
    r('commit', '-q', '-m', 'side')
    r('switch', '-q', 'main')
    r('merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    await expect(readRebasePlan(rd, base)).rejects.toThrow(/merge/)
  })

  it('offers the full message (subject and body) for rewording', async () => {
    r('commit', '-q', '--allow-empty', '-m', 'with body', '-m', 'body line')
    const plan = await readRebasePlan(rd, base)
    expect(plan.at(-1)!.message).toBe('with body\n\nbody line')
  })

  it('applies the plan even when GIT_SEQUENCE_EDITOR is set in the environment', async () => {
    const saved = process.env.GIT_SEQUENCE_EDITOR
    process.env.GIT_SEQUENCE_EDITOR = 'true'
    try {
      await interactiveRebase(rd, base, [
        { sha: c1, action: 'pick' },
        { sha: c2, action: 'drop' },
        { sha: c3, action: 'pick' }
      ])
      expect(subjects()).toEqual(['commit 3', 'commit 1'])
    } finally {
      if (saved === undefined) delete process.env.GIT_SEQUENCE_EDITOR
      else process.env.GIT_SEQUENCE_EDITOR = saved
    }
  })

  it('stops at an edit step, keeps an amend made there and continues', async () => {
    expect(await interactiveRebase(rd, base, [{ sha: c1, action: 'edit' }, { sha: c2, action: 'pick' }, { sha: c3, action: 'pick' }])).toBe('ok')
    expect(await currentOperation(rd)).toBe('rebase')
    expect(r('log', '-1', '--format=%s')).toBe('commit 1')
    r('commit', '-q', '--amend', '-m', 'commit 1 (edited)')
    expect(await continueOperation(rd)).toBe('ok')
    expect(await currentOperation(rd)).toBeNull()
    expect(r('log', '--format=%s', `${base}..HEAD`).split('\n')).toEqual(['commit 3', 'commit 2', 'commit 1 (edited)'])
  })

  it('reports a rejected reword and does not drop it on continue', async () => {
    writeFileSync(join(rd, '.git', 'hooks', 'commit-msg'), '#!/bin/sh\ngrep -q "^ok:" "$1" || { echo "message must start with ok:" >&2; exit 1; }\n', { mode: 0o755 })
    await expect(interactiveRebase(rd, base, [
      { sha: c1, action: 'reword', message: 'not ok' },
      { sha: c2, action: 'pick' },
      { sha: c3, action: 'pick' }
    ])).rejects.toThrow(/must start with ok/)
    expect((await openRepo(rd)).operation).toBe('rebase')
    await expect(continueOperation(rd)).rejects.toThrow(/must start with ok/) // the reword runs again instead of being skipped
    await abortOperation(rd)
    expect(subjects()).toEqual(['commit 3', 'commit 2', 'commit 1'])
  })

  it('stops on conflicts like any rebase', async () => {
    writeFileSync(join(rd, 'f1.txt'), 'changed by 3\n')
    r('commit', '-q', '-am', 'commit 4 touches f1')
    const c4 = r('rev-parse', 'HEAD')
    // move commit 4 before commit 1: f1.txt does not exist yet there
    const result = await interactiveRebase(rd, base, [
      { sha: c4, action: 'pick' },
      { sha: c1, action: 'pick' },
      { sha: c2, action: 'pick' },
      { sha: c3, action: 'pick' }
    ])
    expect(result).toBe('conflicts')
    expect((await openRepo(rd)).operation).toBe('rebase')
    await abortOperation(rd)
  })
})

describe('undo actions', () => {
  let ud: string
  const u = (...args: string[]) => execFileSync('git', args, { cwd: ud, env }).toString().trim()
  let first: string, second: string

  beforeAll(() => {
    ud = mkdtempSync(join(tmpdir(), 'gitspynx-undo-'))
    u('init', '-q', '-b', 'main')
    writeFileSync(join(ud, 'a.txt'), '1\n')
    u('add', '.')
    u('commit', '-q', '-m', 'first')
    first = u('rev-parse', 'HEAD')
    writeFileSync(join(ud, 'a.txt'), '2\n')
    u('commit', '-q', '-am', 'second')
    second = u('rev-parse', 'HEAD')
  })
  afterAll(() => rmSync(ud, { recursive: true, force: true }))

  it('moves HEAD back softly (undo commit) and forward again (redo), keeping changes staged', async () => {
    await applyUndo(ud, [{ type: 'reset', expect: second, to: first, mode: 'soft', branch: 'main' }])
    expect(u('rev-parse', 'HEAD')).toBe(first)
    expect(u('diff', '--cached', '--name-only')).toBe('a.txt')
    await applyUndo(ud, [{ type: 'reset', expect: first, to: second, mode: 'soft', branch: 'main' }])
    expect(u('rev-parse', 'HEAD')).toBe(second)
    expect(u('status', '--porcelain')).toBe('')
  })

  it('refuses when HEAD is no longer where the action left it', async () => {
    await expect(applyUndo(ud, [{ type: 'reset', expect: first, to: first, mode: 'soft', branch: 'main' }])).rejects.toThrow(/changed/)
  })

  it('keeps local changes with mode keep and refuses to overwrite them', async () => {
    writeFileSync(join(ud, 'b.txt'), 'untracked\n')
    await applyUndo(ud, [{ type: 'reset', expect: second, to: first, mode: 'keep', branch: 'main' }])
    expect(readFileSync(join(ud, 'b.txt'), 'utf8')).toBe('untracked\n')
    await applyUndo(ud, [{ type: 'reset', expect: first, to: second, mode: 'keep', branch: 'main' }])
    writeFileSync(join(ud, 'a.txt'), 'local edit\n')
    await expect(applyUndo(ud, [{ type: 'reset', expect: second, to: first, mode: 'keep', branch: 'main' }])).rejects.toBeInstanceOf(GitError)
    expect(readFileSync(join(ud, 'a.txt'), 'utf8')).toBe('local edit\n')
    u('checkout', '--', 'a.txt')
    rmSync(join(ud, 'b.txt'))
  })

  it('recreates a deleted branch and deletes it again only at the expected commit', async () => {
    await applyUndo(ud, [{ type: 'createBranch', name: 'gone', sha: first }])
    expect(u('rev-parse', 'gone')).toBe(first)
    await expect(applyUndo(ud, [{ type: 'deleteBranch', name: 'gone', expect: second }])).rejects.toThrow(/changed/)
    await applyUndo(ud, [{ type: 'deleteBranch', name: 'gone', expect: first }])
    expect(u('branch', '--list', 'gone')).toBe('')
  })

  it('runs several steps in order (undo "create branch and switch")', async () => {
    u('switch', '-q', '-c', 'feature')
    await applyUndo(ud, [
      { type: 'checkout', branch: 'main' },
      { type: 'deleteBranch', name: 'feature', expect: second }
    ])
    expect(u('branch', '--show-current')).toBe('main')
    expect(u('branch', '--list', 'feature')).toBe('')
  })

  it('refuses while a merge, rebase or cherry-pick is in progress', async () => {
    u('switch', '-q', '-c', 'clash', first)
    writeFileSync(join(ud, 'a.txt'), 'clash\n')
    u('commit', '-q', '-am', 'clash')
    u('switch', '-q', 'main')
    await expect(merge(ud, 'clash')).resolves.toBe('conflicts')
    await expect(applyUndo(ud, [{ type: 'reset', expect: second, to: first, mode: 'soft', branch: 'main' }])).rejects.toThrow(/in progress/)
    await abortOperation(ud)
    u('branch', '-D', 'clash')
  })

  it('refuses to move a different branch that happens to be at the same commit', async () => {
    u('switch', '-q', '-c', 'twin')
    await expect(applyUndo(ud, [{ type: 'reset', expect: second, to: first, mode: 'soft', branch: 'main' }])).rejects.toThrow(/cannot be undone/)
    expect(u('rev-parse', 'twin')).toBe(second)
    u('switch', '-q', 'main')
    u('branch', '-D', 'twin')
  })

  it('reads HEAD (commit and branch) straight from git', async () => {
    expect(await readHead(ud)).toEqual({ sha: second, branch: 'main' })
  })

  it('renames branches back', async () => {
    u('branch', 'old-name')
    await applyUndo(ud, [{ type: 'renameBranch', from: 'old-name', to: 'new-name' }])
    expect(u('branch', '--list', 'new-name')).toBe('new-name')
    u('branch', '-D', 'new-name')
  })
})

describe('worktrees', () => {
  let root: string
  let main: string
  const w = (...args: string[]) => execFileSync('git', args, { cwd: main, env }).toString().trim()

  beforeAll(() => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-wt-')))
    main = join(root, 'main')
    mkdirSync(main)
    w('init', '-q', '-b', 'main')
    w('commit', '-q', '--allow-empty', '-m', 'one')
    w('branch', 'feature')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lists the main work tree', async () => {
    expect(await listWorktrees(main)).toEqual([{ path: main, head: w('rev-parse', 'HEAD'), branch: 'main', main: true, locked: false, prunable: false }])
  })

  it('checks a new worktree branch before any folder is chosen', async () => {
    await expect(assertNewWorktreeBranch(main, 'main', 'HEAD')).rejects.toThrow(/already exists/)
    await expect(assertNewWorktreeBranch(main, 'bad..name', 'HEAD')).rejects.toThrow(/invalid branch name/)
    await expect(assertNewWorktreeBranch(main, 'main', null)).resolves.toBeUndefined()
  })

  it('adds work trees for an existing and for a new branch', async () => {
    await addWorktree(main, join(root, 'wt-feature'), 'feature', null)
    await addWorktree(main, join(root, 'wt-new'), 'new-branch', w('rev-parse', 'HEAD'))
    const list = await listWorktrees(main)
    expect(list.map((t) => [t.path, t.branch, t.main])).toEqual([
      [main, 'main', true],
      [join(root, 'wt-feature'), 'feature', false],
      [join(root, 'wt-new'), 'new-branch', false]
    ])
  })

  it('refuses to remove a work tree with local changes unless forced', async () => {
    writeFileSync(join(root, 'wt-feature', 'dirty.txt'), 'x')
    await expect(removeWorktree(main, join(root, 'wt-feature'), false)).rejects.toThrow(/untracked|modified/)
    await removeWorktree(main, join(root, 'wt-feature'), true)
    expect((await listWorktrees(main)).map((t) => t.path)).not.toContain(join(root, 'wt-feature'))
  })

  it('refuses to remove the main work tree or an unknown path', async () => {
    await expect(removeWorktree(main, main, true)).rejects.toThrow(/main work tree/)
    await expect(removeWorktree(main, join(root, 'nope'), true)).rejects.toThrow(/not a work tree/)
  })

  it('marks a work tree whose folder is gone as prunable, and prunes it', async () => {
    rmSync(join(root, 'wt-new'), { recursive: true })
    expect((await listWorktrees(main)).find((t) => t.branch === 'new-branch')?.prunable).toBe(true)
    await pruneWorktrees(main)
    expect((await listWorktrees(main)).map((t) => t.branch)).toEqual(['main'])
  })

  it('still opens the repository when the work tree list cannot be read', async () => {
    const broken = join(main, '.git', 'worktrees', 'broken')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'commondir'), '')
    writeFileSync(join(broken, 'gitdir'), join(root, 'gone', '.git') + '\n')
    writeFileSync(join(broken, 'HEAD'), 'ref: refs/heads/main\n')
    try {
      const info = await openRepo(main)
      expect(info.path).toBe(main)
    } finally {
      rmSync(broken, { recursive: true, force: true })
    }
  })

  it('parses the newline-separated porcelain format of older git versions', () => {
    const out = ['worktree /a', 'HEAD abc', 'branch refs/heads/main', '', 'worktree /b c', 'HEAD def', 'detached', 'locked', ''].join('\n')
    expect(parseWorktrees(out, '\n')).toEqual([
      { path: '/a', head: 'abc', branch: 'main', main: true, locked: false, prunable: false },
      { path: '/b c', head: 'def', branch: null, main: false, locked: true, prunable: false }
    ])
  })

  it('reports work trees in the repository info', async () => {
    expect((await openRepo(main)).worktrees.map((t) => t.branch)).toEqual(['main'])
  })
})

describe('submodules', () => {
  let root: string
  let sup: string
  let clone: string
  const at = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env } }).toString().trim()
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    // git restricts file:// submodules by default; allow it for this local fixture only
    for (const [k, v] of Object.entries({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' })) {
      saved[k] = process.env[k]
      process.env[k] = v
    }
    root = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-sub-')))
    const lib = join(root, 'lib')
    mkdirSync(lib)
    at(lib, 'init', '-q', '-b', 'main')
    writeFileSync(join(lib, 'lib.txt'), '1\n')
    at(lib, 'add', '.')
    at(lib, 'commit', '-q', '-m', 'lib one')
    sup = join(root, 'super')
    mkdirSync(sup)
    at(sup, 'init', '-q', '-b', 'main')
    at(sup, 'submodule', 'add', '-q', lib, 'deps/lib')
    at(sup, 'commit', '-q', '-m', 'add submodule')
    clone = join(root, 'clone')
    at(root, 'clone', '-q', sup, clone)
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('lists an uninitialized submodule of a fresh clone', async () => {
    expect(await listSubmodules(clone)).toEqual([{ path: 'deps/lib', sha: at(sup, 'rev-parse', 'HEAD:deps/lib'), state: 'uninitialized' }])
    expect((await openRepo(clone)).submodules.map((s) => s.state)).toEqual(['uninitialized'])
  })

  it('initializes and updates submodules', async () => {
    await updateSubmodules(clone, ['deps/lib'])
    expect((await listSubmodules(clone))[0].state).toBe('ok')
    expect(readFileSync(join(clone, 'deps', 'lib', 'lib.txt'), 'utf8')).toBe('1\n')
  })

  it('reports a submodule checked out at another commit as modified, and updates it back', async () => {
    const sub = join(clone, 'deps', 'lib')
    writeFileSync(join(sub, 'lib.txt'), '2\n')
    at(sub, 'commit', '-q', '-am', 'local lib change')
    expect((await listSubmodules(clone))[0].state).toBe('modified')
    await updateSubmodules(clone, [])
    expect((await listSubmodules(clone))[0].state).toBe('ok')
  })

  it('handles paths with parentheses and gitlinks without a .gitmodules entry', async () => {
    const lib = join(root, 'lib')
    at(clone, 'submodule', 'add', '-q', lib, 'odd (x)')
    const embedded = join(clone, 'embedded')
    mkdirSync(embedded)
    at(embedded, 'init', '-q', '-b', 'main')
    at(embedded, 'commit', '-q', '--allow-empty', '-m', 'e')
    at(clone, 'add', 'embedded') // a gitlink with no .gitmodules mapping
    const list = await listSubmodules(clone)
    expect(list.map((x) => [x.path, x.state]).sort()).toEqual([
      ['deps/lib', 'ok'],
      ['embedded', 'unmapped'], // no .gitmodules entry: openable, not updatable
      ['odd (x)', 'ok']
    ])
    at(clone, 'rm', '-q', '-f', '--cached', 'embedded')
    rmSync(embedded, { recursive: true, force: true })
  })

  it('updates all without initializing submodules the user left uninitialized', async () => {
    const fresh = join(root, 'fresh')
    at(root, 'clone', '-q', sup, fresh)
    await updateSubmodules(fresh, [])
    expect((await listSubmodules(fresh))[0].state).toBe('uninitialized')
  })

  it('does not hand literal-pathspec mode to submodule hooks', async () => {
    const sub = join(clone, 'deps', 'lib')
    const hook = join(clone, '.git', 'modules', 'deps', 'lib', 'hooks', 'post-checkout')
    const out = join(root, 'hook-env.txt')
    writeFileSync(hook, `#!/bin/sh\necho "\${GIT_LITERAL_PATHSPECS:-unset}" > '${out}'\n`, { mode: 0o755 })
    at(sub, 'commit', '-q', '--allow-empty', '-m', 'moves the submodule away from the recorded commit')
    await updateSubmodules(clone, ['deps/lib']) // checks the recorded commit out again: post-checkout runs
    rmSync(hook)
    expect(readFileSync(out, 'utf8').trim()).toBe('unset')
  })

  it('refuses to stage a submodule whose only change is uncommitted work inside it', async () => {
    writeFileSync(join(clone, 'deps', 'lib', 'lib.txt'), 'dirty inside\n')
    const d = await readFileDiff(clone, { path: 'deps/lib', staged: false })
    await expect(stageHunk(clone, { path: 'deps/lib', staged: false, hunk: 0, hunkHeader: d.hunks[0].header, hunkLines: hunkKey(d.hunks[0]) })).rejects.toThrow(/inside the submodule/)
    at(join(clone, 'deps', 'lib'), 'checkout', '--', 'lib.txt')
  })

  it('lists submodules nested in an initialized one and initializes them in their parent', async () => {
    // lib gains a submodule of its own after super recorded it
    const nested = join(root, 'nested-src')
    mkdirSync(nested)
    at(nested, 'init', '-q', '-b', 'main')
    at(nested, 'commit', '-q', '--allow-empty', '-m', 'nested one')
    const lib2 = join(root, 'lib2')
    at(root, 'clone', '-q', join(root, 'lib'), lib2)
    at(lib2, 'submodule', 'add', '-q', nested, 'deps/nested')
    at(lib2, 'commit', '-q', '-m', 'add nested')
    const top = join(root, 'top')
    mkdirSync(top)
    at(top, 'init', '-q', '-b', 'main')
    at(top, 'submodule', 'add', '-q', lib2, 'deps/lib2')
    at(top, 'commit', '-q', '-m', 'add lib2')
    const fresh = join(root, 'top-clone')
    at(root, 'clone', '-q', top, fresh)
    at(fresh, 'submodule', 'update', '-q', '--init') // not recursive: the nested one stays uninitialized
    const list = await listSubmodules(fresh)
    expect(list.map((s) => [s.path, s.state, s.parent ?? null])).toEqual([
      ['deps/lib2', 'ok', null],
      ['deps/lib2/deps/nested', 'uninitialized', 'deps/lib2']
    ])
    await updateSubmodules(fresh, ['deps/lib2/deps/nested'])
    expect((await listSubmodules(fresh)).find((s) => s.path === 'deps/lib2/deps/nested')?.state).toBe('ok')
  })

  it('lists an embedded repository that has no .gitmodules entry', async () => {
    const host = join(root, 'host')
    mkdirSync(join(host, 'vendor', 'x'), { recursive: true })
    at(host, 'init', '-q', '-b', 'main')
    at(join(host, 'vendor', 'x'), 'init', '-q', '-b', 'main')
    at(join(host, 'vendor', 'x'), 'commit', '-q', '--allow-empty', '-m', 'inner')
    at(host, '-c', 'advice.addEmbeddedRepo=false', 'add', 'vendor/x')
    at(host, 'commit', '-q', '-m', 'embed')
    expect((await listSubmodules(host)).map((s) => [s.path, s.state])).toEqual([['vendor/x', 'unmapped']])
    await expect(updateSubmodules(host, ['vendor/x'])).rejects.toThrow(/no .gitmodules entry/)
  })

  it('returns no submodules for a repository without any', async () => {
    expect(await listSubmodules(join(root, 'lib'))).toEqual([])
  })
})

const hasLfs = (() => {
  try {
    execFileSync('git', ['lfs', 'version'])
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasLfs)('lfs', () => {
  let ld: string
  const l = (...args: string[]) => execFileSync('git', args, { cwd: ld, env }).toString().trim()

  beforeAll(() => {
    ld = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-lfs-')))
    l('init', '-q', '-b', 'main')
    l('commit', '-q', '--allow-empty', '-m', 'one')
  })
  afterAll(() => rmSync(ld, { recursive: true, force: true }))

  it('reports no LFS for a repository that does not use it', async () => {
    expect((await openRepo(ld)).lfs).toBeNull()
  })

  it('tracks a pattern (setting LFS up for the repository) and stores matching files as pointers', async () => {
    await lfsTrack(ld, '*.bin')
    expect(readFileSync(join(ld, '.gitattributes'), 'utf8')).toContain('*.bin filter=lfs')
    const info = await lfsInfo(ld)
    expect(info).toMatchObject({ installed: true, patterns: ['*.bin'] })
    writeFileSync(join(ld, 'big.bin'), Buffer.alloc(1024, 7))
    l('add', '.')
    l('commit', '-q', '-m', 'lfs file')
    expect(l('show', 'HEAD:big.bin')).toContain('version https://git-lfs.github.com/spec/v1')
    expect((await openRepo(ld)).lfs?.patterns).toEqual(['*.bin'])
  }, 30_000) // git-lfs is slow on Windows runners

  it('untracks a pattern', async () => {
    await lfsUntrack(ld, '*.bin')
    expect((await lfsInfo(ld)).patterns).toEqual([])
  })

  it('rejects patterns that could be read as options, span lines or are negated', async () => {
    await expect(lfsTrack(ld, '--no-modify-attrs')).rejects.toBeInstanceOf(GitError)
    await expect(lfsTrack(ld, '*.a\n*.b')).rejects.toBeInstanceOf(GitError)
    await expect(lfsTrack(ld, '!*.bin')).rejects.toBeInstanceOf(GitError) // git ignores negative attribute patterns
  })

  it('does not write hooks when a repository using LFS is opened', async () => {
    const fresh = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-lfs-open-')))
    execFileSync('git', ['init', '-q'], { cwd: fresh, env })
    writeFileSync(join(fresh, '.gitattributes'), '*.bin filter=lfs diff=lfs merge=lfs -text\n')
    const info = await openRepo(fresh)
    expect(info.lfs?.patterns).toEqual(['*.bin'])
    expect(existsSync(join(fresh, '.git', 'hooks', 'pre-push'))).toBe(false)
    rmSync(fresh, { recursive: true })
  })

  it('tracks the first pattern in a repository that already has its own pre-push hook', async () => {
    const hooked = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-lfs-hook-')))
    execFileSync('git', ['init', '-q'], { cwd: hooked, env })
    writeFileSync(join(hooked, '.git', 'hooks', 'pre-push'), '#!/bin/sh\necho mine\n', { mode: 0o755 })
    await lfsTrack(hooked, '*.psd')
    expect(readFileSync(join(hooked, '.gitattributes'), 'utf8')).toContain('*.psd filter=lfs')
    expect(readFileSync(join(hooked, '.git', 'hooks', 'pre-push'), 'utf8')).toContain('echo mine') // left alone
    rmSync(hooked, { recursive: true })
  })
})

describe('open points 8–12', () => {
  let od: string
  const o = (...args: string[]) => execFileSync('git', args, { cwd: od, env }).toString().trim()
  beforeEach(() => {
    od = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-open-')))
    o('init', '-q', '-b', 'main')
    writeFileSync(join(od, 'a.txt'), '1\n')
    o('add', '.')
    o('commit', '-q', '-m', 'one')
  })
  afterEach(() => rmSync(od, { recursive: true, force: true }))

  it('keeps the base of a stash in the history when no branch reaches it any more', async () => {
    o('switch', '-q', '-c', 'tmp')
    o('commit', '-q', '--allow-empty', '-m', 'only on tmp')
    const base = o('rev-parse', 'HEAD')
    writeFileSync(join(od, 'a.txt'), 'wip\n')
    o('stash', 'push', '-q', '-m', 'wip')
    o('switch', '-q', 'main')
    o('branch', '-q', '-D', 'tmp')
    const info = await openRepo(od)
    const log = await readLog(od, info.tips, 0, 100)
    expect(log.map((c) => c.sha)).toContain(base)
  })

  it('keeps unrelated staged changes when a merge is undone (reset --keep)', async () => {
    const before = o('rev-parse', 'HEAD')
    o('switch', '-q', '-c', 'side')
    writeFileSync(join(od, 'side.txt'), 'side\n')
    o('add', '.')
    o('commit', '-q', '-m', 'side')
    o('switch', '-q', 'main')
    o('merge', '-q', '--no-ff', '--no-edit', 'side')
    const merged = o('rev-parse', 'HEAD')
    writeFileSync(join(od, 'staged.txt'), 'staged\n')
    o('add', 'staged.txt')
    await applyUndo(od, [{ type: 'reset', expect: merged, to: before, mode: 'keep', branch: 'main' }])
    expect(o('rev-parse', 'HEAD')).toBe(before)
    expect(o('diff', '--cached', '--name-only')).toBe('staged.txt')
  })

  it('keeps branches pointing into the rebased range up to date with rebase.updateRefs', async () => {
    const base = o('rev-parse', 'HEAD')
    o('commit', '-q', '--allow-empty', '-m', 'c1')
    o('branch', 'stacked')
    o('commit', '-q', '--allow-empty', '-m', 'c2')
    o('config', 'rebase.updateRefs', 'true')
    const [c1, c2] = [o('rev-parse', 'HEAD~1'), o('rev-parse', 'HEAD')]
    await interactiveRebase(od, base, [
      { sha: c1, action: 'reword', message: 'c1 renamed' },
      { sha: c2, action: 'pick' }
    ])
    expect(o('log', '-1', '--format=%s', 'stacked')).toBe('c1 renamed')
    expect(o('rev-parse', 'stacked')).toBe(o('rev-parse', 'HEAD~1'))
  })

  it('reports submodules that git skips because of update = none', async () => {
    const lib = join(od, '..', `${basename(od)}-lib`)
    mkdirSync(lib)
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: lib, env })
      execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'lib'], { cwd: lib, env })
      o('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', lib, 'deps/lib')
      o('config', '-f', '.gitmodules', 'submodule.deps/lib.update', 'none')
      o('commit', '-q', '-am', 'add lib')
      const skipped = await updateSubmodules(od, ['deps/lib'])
      expect(skipped).toEqual(['deps/lib'])
    } finally {
      rmSync(lib, { recursive: true, force: true })
    }
  })
})

describe('deferred fixes: backend', () => {
  let dd: string
  const d = (...args: string[]) => execFileSync('git', args, { cwd: dd, env }).toString().trim()
  beforeEach(() => {
    dd = realpathSync.native(mkdtempSync(join(tmpdir(), 'gitspynx-def-')))
    d('init', '-q', '-b', 'main')
    writeFileSync(join(dd, 'a.txt'), '1\n')
    d('add', '.')
    d('commit', '-q', '-m', 'one')
  })
  afterEach(() => rmSync(dd, { recursive: true, force: true }))

  it('restores the staged state when applying a stash', async () => {
    writeFileSync(join(dd, 'a.txt'), '2\n')
    d('add', 'a.txt')
    await stashPush(dd, 'staged')
    const [st] = await listStashes(dd)
    await stashApply(dd, st.sha, true)
    expect(d('diff', '--cached', '--name-only')).toBe('a.txt')
  })

  it('stashes untracked files even when status hides them', async () => {
    d('config', 'status.showUntrackedFiles', 'no')
    writeFileSync(join(dd, 'only-untracked.txt'), 'x')
    await stashPush(dd, '')
    expect(await listStashes(dd)).toHaveLength(1)
  })

  it('explains a stash that collides with an existing untracked file', async () => {
    writeFileSync(join(dd, 'u.txt'), 'stashed\n')
    await stashPush(dd, '')
    writeFileSync(join(dd, 'u.txt'), 'in the way\n')
    const [st] = await listStashes(dd)
    await expect(stashApply(dd, st.sha, false)).rejects.toThrow(/already exist/)
  })

  it('does not stage a mode change together with selected lines', async () => {
    writeFileSync(join(dd, 'a.txt'), '1\nadded\n')
    execFileSync('chmod', ['+x', join(dd, 'a.txt')])
    const diff = await readFileDiff(dd, { path: 'a.txt', staged: false })
    const idx = diff.hunks[0].lines.findIndex((l) => l.text === 'added')
    await stageHunk(dd, { path: 'a.txt', staged: false, hunk: 0, hunkHeader: diff.hunks[0].header, hunkLines: hunkKey(diff.hunks[0]), lines: [idx] })
    expect(d('diff', '--cached', '--summary')).not.toContain('mode change')
    expect(d('show', ':a.txt')).toBe('1\nadded')
  })

  it('merges and rebases by full ref name when a tag has the same name as a branch', async () => {
    d('switch', '-q', '-c', 'twin')
    d('commit', '-q', '--allow-empty', '-m', 'on branch twin')
    d('switch', '-q', 'main')
    d('tag', 'twin', 'HEAD') // tag "twin" points at main's commit
    expect(await merge(dd, 'refs/heads/twin')).toBe('ok')
    expect(d('log', '-1', '--format=%s')).toBe('on branch twin')
  })

  it('checks every step of a multi-step undo before changing anything', async () => {
    d('switch', '-q', '-c', 'feature')
    const tip = d('rev-parse', 'HEAD')
    d('commit', '-q', '--allow-empty', '-m', 'moved on')
    await expect(applyUndo(dd, [{ type: 'checkout', branch: 'main' }, { type: 'deleteBranch', name: 'feature', expect: tip }])).rejects.toThrow(/cannot be undone/)
    expect(d('branch', '--show-current')).toBe('feature') // the checkout did not run
  })

  it('restores the upstream when recreating a deleted branch', async () => {
    await applyUndo(dd, [{ type: 'createBranch', name: 'back', sha: d('rev-parse', 'HEAD'), upstream: { remote: 'origin', merge: 'refs/heads/back' } }])
    expect(d('config', '--get', 'branch.back.remote')).toBe('origin')
    expect(d('config', '--get', 'branch.back.merge')).toBe('refs/heads/back')
  })

  it('resolves a conflict by deleting the file', async () => {
    d('switch', '-q', '-c', 'del')
    d('rm', '-q', 'a.txt')
    d('commit', '-q', '-m', 'delete a')
    d('switch', '-q', 'main')
    writeFileSync(join(dd, 'a.txt'), 'changed\n')
    d('commit', '-q', '-am', 'change a')
    expect(await merge(dd, 'del')).toBe('conflicts')
    await resolveConflict(dd, 'a.txt', { delete: true })
    expect(existsSync(join(dd, 'a.txt'))).toBe(false)
    expect(d('ls-files', '-u')).toBe('')
    await abortOperation(dd)
  })

  it('leaves no interactive-rebase files behind after a finished rebase', async () => {
    d('commit', '-q', '--allow-empty', '-m', 'two')
    const base = d('rev-parse', 'HEAD~1')
    await interactiveRebase(dd, base, [{ sha: d('rev-parse', 'HEAD'), action: 'reword', message: 'two, reworded' }])
    expect(existsSync(join(dd, '.git', 'gitspynx-rebase'))).toBe(false)
  })

  it('does not touch rebase files when a rebase is already running', async () => {
    mkdirSync(join(dd, '.git', 'gitspynx-rebase'), { recursive: true })
    writeFileSync(join(dd, '.git', 'gitspynx-rebase', 'message-0'), 'keep me')
    mkdirSync(join(dd, '.git', 'rebase-merge'), { recursive: true }) // looks like a rebase in progress
    await expect(interactiveRebase(dd, d('rev-parse', 'HEAD'), [])).rejects.toThrow(/in progress/)
    expect(readFileSync(join(dd, '.git', 'gitspynx-rebase', 'message-0'), 'utf8')).toBe('keep me')
    rmSync(join(dd, '.git', 'rebase-merge'), { recursive: true })
  })
})
