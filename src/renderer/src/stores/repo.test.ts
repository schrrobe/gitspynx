import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Commit, RepoInfo } from '../../../shared/types'
import { MAX_LOG_PAGE } from '../../../shared/types'
import { useRepo, WIP } from './repo'

const info: RepoInfo = { path: '/r', head: { branch: 'main', sha: 'a0' }, refs: [], tips: ['a0'], operation: null, stashes: [], worktrees: [] }
const page = (prefix: string, n = 2000): Commit[] =>
  Array.from({ length: n }, (_, i) => ({
    sha: `${prefix}${i}`,
    parents: i < n - 1 ? [`${prefix}${i + 1}`] : [],
    author: 'a',
    email: 'a@x',
    date: 0,
    subject: `${prefix}${i}`
  }))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let logCalls: { skip: number; d: ReturnType<typeof deferred<Commit[]>> }[]

beforeEach(() => {
  setActivePinia(createPinia())
  logCalls = []
  ;(globalThis as unknown as { window: unknown }).window = {
    gitspynx: {
      openRepo: async () => info,
      closeRepo: async () => {},
      readHead: async () => ({ sha: 'a0', branch: 'main' }),
      readStatus: async () => [],
      readFileDiff: async () => ({ binary: false, hunks: [] }),
      readLog: (_repo: string, skip: number) => {
        const d = deferred<Commit[]>()
        logCalls.push({ skip, d })
        return d.promise
      }
    }
  }
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('repo store', () => {
  it('drops a page that was still loading when the repo was reopened', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('old'))
    await first

    const more = repo.loadMore()
    await flush()
    const reopen = repo.open('/r')
    await flush()
    logCalls[2].d.resolve(page('new'))
    await reopen
    logCalls[1].d.resolve(page('stale'))
    await more

    expect(repo.commits.map((c) => c.sha)).toEqual(page('new').map((c) => c.sha))
    expect(repo.loading).toBe(false)
  })

  it('stays loading while a reopen is in flight even if an older page finishes', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('old'))
    await first

    const more = repo.loadMore()
    await flush()
    const reopen = repo.open('/r')
    await flush()
    logCalls[1].d.resolve(page('stale'))
    await more
    expect(repo.loading).toBe(true)

    logCalls[2].d.resolve(page('new'))
    await reopen
    expect(repo.loading).toBe(false)
  })

  it('shows the diff for the file that was opened', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    await repo.openDiff({ path: 'f1', staged: false })
    expect(repo.diff).toEqual({ binary: false, hunks: [] })
  })

  it('follows an open diff to the staged side when the file gets staged', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    await repo.openDiff({ path: 'f1', staged: false })
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    w.gitspynx.stage = async () => {}
    w.gitspynx.readStatus = async () => [{ path: 'f1', staged: 'M', unstaged: null, conflicted: false }]
    await repo.stage(['f1'])
    expect(repo.diffTarget).toEqual({ path: 'f1', staged: true })
  })

  describe('deleteBranch', () => {
    async function openedRepo() {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      return repo
    }
    function mockApi(confirms: boolean[], unmerged: boolean) {
      const calls: [string, boolean][] = []
      const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
      w.gitspynx.confirm = async () => confirms.shift() ?? false
      w.gitspynx.deleteBranch = async (_r: string, name: string, force: boolean) => {
        calls.push([name, force])
        if (unmerged && !force) throw new Error("error: the branch 'x' is not fully merged")
      }
      w.gitspynx.readLog = async () => page('c', 3)
      return calls
    }

    it('does nothing when the first confirmation is cancelled', async () => {
      const repo = await openedRepo()
      const calls = mockApi([false], false)
      await repo.deleteBranch('x')
      expect(calls).toEqual([])
    })

    it('asks again and forces when the branch is not fully merged', async () => {
      const repo = await openedRepo()
      const calls = mockApi([true, true], true)
      await repo.deleteBranch('x')
      expect(calls).toEqual([['x', false], ['x', true]])
      expect(repo.error).toBeNull()
    })

    it('keeps the branch when forcing is declined', async () => {
      const repo = await openedRepo()
      const calls = mockApi([true, false], true)
      await repo.deleteBranch('x')
      expect(calls).toEqual([['x', false]])
    })
  })

  describe('pushBranch', () => {
    async function setup(results: ('ok' | 'rejected')[], confirms: boolean[]) {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      const calls: boolean[] = []
      const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
      w.gitspynx.push = async (_r: string, force: boolean) => (calls.push(force), results.shift())
      w.gitspynx.confirm = async () => confirms.shift() ?? false
      w.gitspynx.readLog = async () => page('c', 3)
      return { repo, calls }
    }

    it('pushes once when the remote accepts', async () => {
      const { repo, calls } = await setup(['ok'], [])
      await repo.pushBranch()
      expect(calls).toEqual([false])
      expect(repo.busy).toBeNull()
    })

    it('offers a force-with-lease push after a rejection', async () => {
      const { repo, calls } = await setup(['rejected', 'ok'], [true])
      await repo.pushBranch()
      expect(calls).toEqual([false, true])
    })

    it('does not force when the user declines', async () => {
      const { repo, calls } = await setup(['rejected'], [false])
      await repo.pushBranch()
      expect(calls).toEqual([false])
      expect(repo.error).toBeNull()
    })
  })

  it('coalesces status refreshes that arrive while one is running', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    const pending: ReturnType<typeof deferred<never[]>>[] = []
    w.gitspynx.readStatus = () => {
      const d = deferred<never[]>()
      pending.push(d)
      return d.promise
    }
    const runs = [repo.refreshStatus(), repo.refreshStatus(), repo.refreshStatus()]
    await flush()
    expect(pending).toHaveLength(1)
    pending[0].resolve([])
    await flush()
    expect(pending).toHaveLength(2) // one follow-up for all calls that came in meanwhile
    pending[1].resolve([])
    await Promise.all(runs)
    expect(pending).toHaveLength(2)
  })

  it('unstages both sides of a staged rename', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    let unstaged: string[] = []
    w.gitspynx.unstage = async (_r: string, paths: string[]) => void (unstaged = paths)
    await repo.unstageFiles([{ path: 'new.ts', oldPath: 'old.ts', staged: 'R', unstaged: null, conflicted: false }])
    expect(unstaged.sort()).toEqual(['new.ts', 'old.ts'])
  })

  describe('consistency', () => {
    async function opened() {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      return { repo, w: (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window }
    }

    it('ignores errors from a commit selection that is no longer current', async () => {
      const { repo, w } = await opened()
      const slow = deferred<never>()
      w.gitspynx.readCommit = (_r: string, sha: string) => (sha === 'old' ? slow.promise : Promise.resolve({ sha }))
      const a = repo.select('old')
      await repo.select('new')
      ;(slow as unknown as { resolve: (v: unknown) => void }).resolve(Promise.reject(new Error('boom')))
      await a
      expect(repo.error).toBeNull()
    })

    it('drops a status response that belongs to a repo closed meanwhile', async () => {
      const { repo, w } = await opened()
      const late = deferred<unknown[]>()
      w.gitspynx.readStatus = () => late.promise
      const run = repo.refreshStatus()
      repo.close()
      late.resolve([{ path: 'x', staged: 'M', unstaged: null, conflicted: false }])
      await run
      expect(repo.status).toEqual([])
    })

    it('blocks other repository operations while a network operation runs', async () => {
      const { repo, w } = await opened()
      const push = deferred<'ok'>()
      w.gitspynx.push = () => push.promise
      let checkedOut = false
      w.gitspynx.checkout = async () => void (checkedOut = true)
      w.gitspynx.readLog = async () => page('c', 3)
      const p = repo.pushBranch()
      await flush()
      await repo.checkoutBranch('other')
      expect(checkedOut).toBe(false)
      push.resolve('ok')
      await p
    })
  })

  describe('operations', () => {
    async function opened() {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
      w.gitspynx.readLog = async () => page('c', 3)
      return { repo, w }
    }

    it('shows the working directory when a merge stops on conflicts', async () => {
      const { repo, w } = await opened()
      w.gitspynx.merge = async () => 'conflicts'
      await repo.mergeInto('side')
      expect(repo.selected).toBe(WIP)
    })

    it('asks before aborting and keeps everything when declined', async () => {
      const { repo, w } = await opened()
      let aborted = false
      let okLabel = ''
      w.gitspynx.confirm = async (_m: string, _d: string, ok: string) => ((okLabel = ok), false)
      w.gitspynx.abortOperation = async () => void (aborted = true)
      w.gitspynx.readConflict = async () => ({ base: 'b', ours: 'o', theirs: 't', merged: 'm', binary: false })
      await repo.openConflict('f.txt')
      await repo.abortOp()
      expect(aborted).toBe(false)
      expect(repo.conflict).not.toBeNull() // edits in the conflict view survive a declined abort
      expect(okLabel).not.toBe('Abbrechen') // must differ from the dialog's cancel button
    })

    it('resolves a conflict and closes the conflict view', async () => {
      const { repo, w } = await opened()
      let resolved: unknown = null
      w.gitspynx.readConflict = async () => ({ base: 'b', ours: 'o', theirs: 't', merged: 'm' })
      w.gitspynx.resolveConflict = async (_r: string, path: string, res: unknown) => void (resolved = [path, res])
      await repo.openConflict('f.txt')
      expect(repo.conflict?.versions.ours).toBe('o')
      await repo.resolve({ side: 'theirs' })
      expect(resolved).toEqual(['f.txt', { side: 'theirs' }])
      expect(repo.conflict).toBeNull()
    })
  })

  describe('stashes', () => {
    async function opened(stashes: { sha: string }[]) {
      const repo = useRepo()
      ;(globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window.gitspynx.openRepo = async () => ({ ...info, stashes })
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
      w.gitspynx.readLog = async () => page('c', 3)
      return { repo, w }
    }

    it('pops the newest stash from the toolbar', async () => {
      const { repo, w } = await opened([{ sha: 's1' }, { sha: 's0' }])
      let call: unknown = null
      w.gitspynx.stashApply = async (_r: string, sha: string, pop: boolean) => ((call = [sha, pop]), 'ok')
      await repo.popLatestStash()
      expect(call).toEqual(['s1', true])
    })

    it('asks before dropping a stash', async () => {
      const { repo, w } = await opened([{ sha: 's1' }])
      let dropped = false
      w.gitspynx.confirm = async () => false
      w.gitspynx.stashDrop = async () => void (dropped = true)
      await repo.dropStash('s1')
      expect(dropped).toBe(false)
    })

    it('shows the working directory when applying a stash conflicts', async () => {
      const { repo, w } = await opened([{ sha: 's1' }])
      w.gitspynx.stashApply = async () => 'conflicts'
      await repo.applyStash('s1', false)
      expect(repo.selected).toBe(WIP)
    })
  })

  describe('branch filters', () => {
    const refs = [
      { name: 'main', fullName: 'refs/heads/main', kind: 'local', target: 'a0' },
      { name: 'topic', fullName: 'refs/heads/topic', kind: 'local', target: 't0' },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', target: 'o0' }
    ]
    async function opened() {
      const repo = useRepo()
      const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
      w.gitspynx.openRepo = async () => ({ ...info, refs, tips: ['a0', 't0', 'o0'] })
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      const tipsSeen: unknown[] = []
      w.gitspynx.readLog = async (_r: string, _s: number, _l: number, tips?: string[]) => (tipsSeen.push(tips), page('c', 3))
      return { repo, tipsSeen }
    }

    it('hides a branch by reloading history without its tip, keeping HEAD', async () => {
      const { repo, tipsSeen } = await opened()
      await repo.toggleHidden('refs/heads/topic')
      expect(tipsSeen.at(-1)).toEqual(['a0', 'o0'])
      await repo.toggleHidden('refs/heads/topic')
      expect(tipsSeen.at(-1)).toBeUndefined() // back to the full snapshot
    })

    it('solos a branch: only its tip', async () => {
      const { repo, tipsSeen } = await opened()
      await repo.toggleSolo('refs/heads/topic')
      expect(tipsSeen.at(-1)).toEqual(['t0'])
      await repo.resetFilters()
      expect(tipsSeen.at(-1)).toBeUndefined()
    })
  })

  describe('review 4', () => {
    const w = () => (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window

    it('caps how many commits a refresh re-reads', async () => {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 2000))
      await first
      repo.commits = page('big', MAX_LOG_PAGE + 5000)
      let limit = 0
      w().gitspynx.readLog = async (_r: string, _s: number, l: number) => ((limit = l), page('c', 10))
      await repo.refresh()
      expect(limit).toBe(MAX_LOG_PAGE)
    })

    it('resets branch filters when another repository is opened', async () => {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      w().gitspynx.readLog = async () => page('c', 3)
      await repo.toggleSolo('refs/heads/main')
      w().gitspynx.openRepo = async () => ({ ...info, path: '/other' })
      await repo.open('/other')
      expect(repo.solo).toBeNull()
      expect(repo.hidden.size).toBe(0)
    })

    it('hides the upstream together with a local branch', async () => {
      const repo = useRepo()
      w().gitspynx.openRepo = async () => ({
        ...info,
        refs: [
          { name: 'topic', fullName: 'refs/heads/topic', kind: 'local', target: 't0', upstream: 'origin/topic' },
          { name: 'origin/topic', fullName: 'refs/remotes/origin/topic', kind: 'remote', target: 't0' }
        ]
      })
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      w().gitspynx.readLog = async () => page('c', 3)
      await repo.toggleHidden('refs/heads/topic')
      expect([...repo.hidden].sort()).toEqual(['refs/heads/topic', 'refs/remotes/origin/topic'])
      await repo.toggleHidden('refs/heads/topic')
      expect(repo.hidden.size).toBe(0)
    })

    it('tells the user that a conflicting pop kept the stash', async () => {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      w().gitspynx.readLog = async () => page('c', 3)
      w().gitspynx.stashApply = async () => 'conflicts'
      await repo.applyStash('s1', true)
      expect(repo.notice).toMatch(/Stash wurde behalten/)
    })
  })

  describe('review 5', () => {
    const w = () => (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window

    it('does not expose an incoming tab\'s filters before its history has loaded', async () => {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      w().gitspynx.openRepo = async (p: string) => ({ ...info, path: p })
      const switching = repo.open('/b', 0, { selected: null, hidden: [], solo: 'refs/heads/topic' })
      await flush()
      expect(repo.viewState().solo).toBeNull() // still /r's view while /b loads
      logCalls[1].d.resolve(page('b', 3))
      await switching
      expect(repo.solo).toBe('refs/heads/topic')
    })

    it('scopes a running network operation to its repository', async () => {
      const repo = useRepo()
      const first = repo.open('/r')
      await flush()
      logCalls[0].d.resolve(page('c', 3))
      await first
      const fetch = deferred<void>()
      w().gitspynx.fetch = () => fetch.promise
      const running = repo.fetchAll()
      await flush()
      expect(repo.busy).toBe('fetch')
      w().gitspynx.openRepo = async (p: string) => ({ ...info, path: p })
      w().gitspynx.readLog = async () => page('b', 3)
      await repo.open('/b')
      expect(repo.busy).toBeNull() // /b is not busy
      ;(fetch as unknown as { resolve: (v: unknown) => void }).resolve(Promise.reject(new Error('network down')))
      await running
      expect(repo.error).toBeNull() // /r's failure is not shown on /b
    })
  })

  describe('undo/redo', () => {
    const w = () => (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    let head = 'a0'
    let applied: unknown[][]

    async function opened() {
      head = 'a0'
      applied = []
      w().gitspynx.openRepo = async () => ({ ...info, head: { branch: 'main', sha: head } })
      w().gitspynx.readHead = async () => ({ sha: head, branch: 'main' })
      w().gitspynx.readLog = async () => page('c', 3)
      w().gitspynx.commit = async () => void (head = 'b1')
      w().gitspynx.applyUndo = async (_r: string, steps: unknown[]) => {
        applied.push(steps)
        const last = steps.at(-1) as { type: string; to?: string }
        if (last.type === 'reset') head = last.to!
      }
      const repo = useRepo()
      await repo.open('/r')
      return repo
    }

    it('records a commit and undoes / redoes it with a soft reset', async () => {
      const repo = await opened()
      await repo.commit('Add feature\n\nbody', false)
      expect(repo.undoLabel).toBe('Commit „Add feature“')
      await repo.undo()
      expect(applied.at(-1)).toEqual([{ type: 'reset', expect: 'b1', to: 'a0', mode: 'soft', branch: 'main' }])
      expect(repo.undoLabel).toBeNull()
      expect(repo.redoLabel).toBe('Commit „Add feature“')
      await repo.redo()
      expect(applied.at(-1)).toEqual([{ type: 'reset', expect: 'a0', to: 'b1', mode: 'soft', branch: 'main' }])
      expect(repo.undoLabel).toBe('Commit „Add feature“')
    })

    it('drops the redo history when a new action is recorded', async () => {
      const repo = await opened()
      await repo.commit('one', false)
      await repo.undo()
      w().gitspynx.commit = async () => void (head = 'c2')
      await repo.commit('two', false)
      expect(repo.redoLabel).toBeNull()
    })

    it('records from git even when a newer reload overtook the action\'s own', async () => {
      const repo = await opened()
      w().gitspynx.openRepo = async () => ({ ...info, head: { branch: 'main', sha: 'a0' } }) // stale store view
      await repo.commit('one', false)
      expect(repo.undoLabel).toBe('Commit „one“')
    })

    it('keeps an entry whose undo failed only temporarily', async () => {
      const repo = await opened()
      await repo.commit('one', false)
      w().gitspynx.applyUndo = async () => {
        throw new Error('error: Entry a.txt not uptodate. Cannot merge.')
      }
      await repo.undo()
      expect(repo.error).toMatch(/not uptodate/)
      expect(repo.undoLabel).toBe('Commit „one“')
    })

    it('forgets an entry whose undo was refused', async () => {
      const repo = await opened()
      await repo.commit('one', false)
      w().gitspynx.applyUndo = async () => {
        throw new Error('the repository changed since this action — it cannot be undone')
      }
      await repo.undo()
      expect(repo.error).toMatch(/cannot be undone/)
      expect(repo.undoLabel).toBeNull()
      expect(repo.redoLabel).toBeNull()
    })
  })

  it('shows the error of a failed repository operation after the reload', async () => {
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    w.gitspynx.openRepo = async () => info
    w.gitspynx.readLog = async () => page('c', 3)
    w.gitspynx.checkout = async () => {
      throw new Error("error: Your local changes would be overwritten by checkout")
    }
    const repo = useRepo()
    await repo.open('/r')
    await repo.checkoutBranch('other')
    expect(repo.error).toMatch(/would be overwritten/)
  })

  describe('worktrees', () => {
    const w = () => (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    async function opened(confirms: boolean[], dirty: boolean) {
      w().gitspynx.openRepo = async () => info
      w().gitspynx.readLog = async () => page('c', 3)
      w().gitspynx.confirm = async () => confirms.shift() ?? false
      const calls: [string, boolean][] = []
      w().gitspynx.removeWorktree = async (_r: string, path: string, force: boolean) => {
        calls.push([path, force])
        if (dirty && !force) throw new Error("fatal: '/wt' contains modified or untracked files, use --force to delete it")
      }
      const repo = useRepo()
      await repo.open('/r')
      return { repo, calls }
    }

    it('asks before removing a work tree', async () => {
      const { repo, calls } = await opened([false], false)
      expect(await repo.removeWorktree('/wt')).toBe(false)
      expect(calls).toEqual([])
    })

    it('asks again and forces when the work tree has local changes', async () => {
      const { repo, calls } = await opened([true, true], true)
      expect(await repo.removeWorktree('/wt')).toBe(true)
      expect(calls).toEqual([['/wt', false], ['/wt', true]])
      expect(repo.error).toBeNull()
    })
  })
})
