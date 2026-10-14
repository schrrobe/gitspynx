import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RepoInfo, Session } from '../../../shared/types'
import { useRepo } from './repo'
import { tabLabels, useTabs } from './tabs'

let saved: { tabs: string[]; active: number }[]
let session: Session
let opens: string[]
let logTips: (string[] | undefined)[]

const infoFor = (path: string): RepoInfo => ({
  path,
  head: { branch: 'main', sha: `${path}-head` },
  refs: [{ name: 'topic', fullName: 'refs/heads/topic', kind: 'local', target: `${path}-topic` }],
  tips: [`${path}-head`, `${path}-topic`],
  operation: null,
  stashes: [],
  worktrees: [],
  submodules: [],
  lfs: null,
  lfsAvailable: false
})

beforeEach(() => {
  setActivePinia(createPinia())
  saved = []
  opens = []
  logTips = []
  session = { tabs: [], active: 0, workspaces: [] }
  ;(globalThis as unknown as { window: unknown }).window = {
    gitspynx: {
      openRepo: async (p: string) => {
        if (p.startsWith('/bad')) throw new Error('not a git repository')
        opens.push(p)
        return infoFor(p)
      },
      closeRepo: async () => {},
      readLog: async (_r: string, _s: number, _l: number, tips?: string[]) => (logTips.push(tips), []),
      readStatus: async () => [],
      readCommit: async (_r: string, sha: string) => ({ sha }),
      getSession: async () => session,
      // structuredClone like Electron IPC: reactive proxies would fail here
      saveTabs: async (tabs: string[], active: number) => void saved.push(structuredClone({ tabs, active })),
      saveWorkspace: async (name: string, repos: string[]) => ({ ...session, workspaces: [{ name, repos: structuredClone(repos) }] }),
      deleteWorkspace: async () => ({ ...session, workspaces: [] })
    }
  }
})

describe('tabs', () => {
  it('opens repositories as tabs without duplicates and persists them', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.openPath('/b')
    await tabs.openPath('/a')
    expect(tabs.tabs).toEqual(['/a', '/b'])
    expect(tabs.active).toBe(0)
    expect(saved.at(-1)).toEqual({ tabs: ['/a', '/b'], active: 0 })
  })

  it('does not add a tab when opening fails', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.openPath('/bad')
    expect(tabs.tabs).toEqual(['/a'])
    expect(useRepo().info?.path).toBe('/a')
  })

  it('remembers selection and filters per tab', async () => {
    const tabs = useTabs()
    const repo = useRepo()
    await tabs.openPath('/a')
    await repo.toggleSolo('refs/heads/topic')
    await repo.select('x1')
    await tabs.openPath('/b')
    expect(repo.solo).toBeNull()
    await tabs.activate(0)
    expect(repo.solo).toBe('refs/heads/topic')
    expect(logTips.at(-1)).toEqual(['/a-topic'])
    expect(repo.selected).toBe('x1')
  })

  it('closing the active tab activates its neighbour, closing the last one closes the repo', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.openPath('/b')
    await tabs.closeTab(1)
    expect(tabs.tabs).toEqual(['/a'])
    expect(useRepo().info?.path).toBe('/a')
    await tabs.closeTab(0)
    expect(tabs.tabs).toEqual([])
    expect(useRepo().info).toBeNull()
  })

  it('restores the stored session on start', async () => {
    session = { tabs: ['/a', '/b'], active: 1, workspaces: [] }
    const tabs = useTabs()
    await tabs.restore()
    expect(tabs.tabs).toEqual(['/a', '/b'])
    expect(opens).toEqual(['/b']) // only the active tab is loaded
  })

  it('saves the open tabs as a workspace and opens a workspace as tabs', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.openPath('/b')
    await tabs.saveWorkspace('Team')
    expect(tabs.workspaces).toEqual([{ name: 'Team', repos: ['/a', '/b'] }])
    await tabs.closeTab(0)
    await tabs.closeTab(0)
    await tabs.openWorkspace({ name: 'Team', repos: ['/a', '/b'] })
    expect(tabs.tabs).toEqual(['/a', '/b'])
    expect(useRepo().info?.path).toBe('/a')
  })

  it('keeps a tab opened while the stored session is still loading', async () => {
    let release!: (s: Session) => void
    ;(globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window.gitspynx.getSession = () =>
      new Promise<Session>((r) => (release = r))
    const tabs = useTabs()
    const restoring = tabs.restore()
    await tabs.openPath('/a')
    release({ tabs: [], active: 0, workspaces: [{ name: 'W', repos: ['/x'] }] })
    await restoring
    expect(tabs.tabs).toEqual(['/a'])
    expect(tabs.workspaces).toEqual([{ name: 'W', repos: ['/x'] }])
  })

  describe('review 5', () => {
    const api = () => (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window.gitspynx
    // readLog for one path waits until released
    function slowLog(path: string) {
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const plain = api().readLog as (...a: unknown[]) => Promise<unknown>
      api().readLog = async (r: string, ...rest: unknown[]) => {
        if (r === path) await gate
        return plain(r, ...rest)
      }
      return release
    }

    it('keeps the highlighted tab in line with the shown repo when an older open finishes last', async () => {
      const tabs = useTabs()
      await tabs.openPath('/a')
      await tabs.openPath('/b')
      const releaseD = slowLog('/d')
      const releaseA = slowLog('/a')
      const opening = tabs.openPath('/d')
      const activating = tabs.activate(0) // /a loads slowly too
      await new Promise((r) => setTimeout(r, 0))
      releaseD() // the superseded open finishes while /a is still loading
      await opening
      releaseA()
      await activating
      expect(useRepo().info?.path).toBe('/a')
      expect(tabs.tabs[tabs.active]).toBe('/a')
    })

    it('keeps highlighting the shown repo when activating a broken tab fails', async () => {
      session = { tabs: ['/a', '/bad'], active: 0, workspaces: [] }
      const tabs = useTabs()
      await tabs.restore()
      await tabs.activate(1)
      expect(useRepo().info?.path).toBe('/a')
      expect(tabs.active).toBe(0)
    })

    it('keeps all restored tabs reachable when the active one cannot be opened', async () => {
      session = { tabs: ['/a', '/bad', '/c'], active: 1, workspaces: [] }
      const tabs = useTabs()
      await tabs.restore()
      expect(tabs.tabs).toEqual(['/a', '/bad', '/c'])
      await tabs.activate(2)
      expect(useRepo().info?.path).toBe('/c')
      expect(tabs.active).toBe(2)
    })
  })

  it('shows no repository without a tab when a workspace\'s first repo cannot be opened', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.openWorkspace({ name: 'W', repos: ['/bad', '/c'] })
    expect(tabs.tabs).toEqual(['/bad', '/c'])
    expect(useRepo().info).toBeNull() // /a is not a tab any more
    expect(useRepo().error).toMatch(/not a git repository/)
  })

  it('restores the remembered view when a subfolder of an open tab is picked', async () => {
    const tabs = useTabs()
    const repo = useRepo()
    await tabs.openPath('/a')
    await repo.toggleSolo('refs/heads/topic')
    await tabs.openPath('/b')
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    w.gitspynx.openRepo = async (p: string) => infoFor(p.replace(/\/sub$/, ''))
    await tabs.openPath('/a/sub')
    expect(tabs.tabs).toEqual(['/a', '/b'])
    expect(tabs.active).toBe(0)
    expect(repo.solo).toBe('refs/heads/topic')
  })

  it('asks before replacing a workspace of the same name', async () => {
    const tabs = useTabs()
    await tabs.openPath('/a')
    await tabs.saveWorkspace('w')
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    let asked = 0
    w.gitspynx.confirm = async () => (asked++, false)
    await tabs.openPath('/b')
    await tabs.saveWorkspace('w')
    expect(asked).toBe(1)
    expect(tabs.workspaces[0].repos).toEqual(['/a'])
  })

  it('labels same-named repositories with their parent folder', () => {
    expect(tabLabels(['/w/a/app', '/w/b/app', '/w/c/tool'])).toEqual(['app — a', 'app — b', 'tool'])
  })
})
