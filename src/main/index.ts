import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { type DiffTarget, type GitspynxApi, type HunkSelection, type RebaseStep, type UndoStep, MAX_LOG_PAGE, type MenuItem, type RepoChange, type Resolution, type Session } from '../shared/types'
import {
  abortOperation,
  addWorktree,
  applyUndo,
  checkout,
  cherryPick,
  continueOperation,
  commit,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  fetchAll,
  GitError,
  gitDirsOutside,
  interactiveRebase,
  isRejectedPush,
  merge,
  openRepo,
  pruneWorktrees,
  pull,
  push,
  readCommit,
  readConflict,
  readHead,
  readRebasePlan,
  readFileDiff,
  readLog,
  readStatus,
  rebase,
  removeWorktree,
  renameBranch,
  resolveConflict,
  skipOperation,
  stage,
  stageHunk,
  stashApply,
  stashDrop,
  stashPush,
  unstage
} from './git'
import { parseSettings, type Settings } from '../shared/settings'
import { jsonFile, latestOnly, sessionFile, withoutWorkspace, withTabs, withWorkspace } from './session'
import { type RepoWatcher, watchRepo } from './watch'

const recentFile = () => join(app.getPath('userData'), 'recent.json')
let sessionStore: ReturnType<typeof sessionFile> | null = null
const store = () => (sessionStore ??= sessionFile(join(app.getPath('userData'), 'session.json')))
const loadSession = () => store().load()
const storeSession = (next: Session) => store().save(next)
const opens = latestOnly() // overlapping openRepo calls: only the newest re-targets the watcher
let settingsStore: ReturnType<typeof jsonFile<Settings>> | null = null
const settings = () => (settingsStore ??= jsonFile(join(app.getPath('userData'), 'settings.json'), parseSettings))

// Theme also drives native menus and dialogs; zoom applies to every window.
function applySettings(s: Settings) {
  nativeTheme.themeSource = s.theme
  for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(s.zoom)
}

// Paths a session may contain: repos opened this run, or already stored in the session.
async function knownToSession(): Promise<(path: string) => boolean> {
  const s = await loadSession()
  const stored = new Set([...s.tabs, ...s.workspaces.flatMap((w) => w.repos)])
  return (p) => opened.has(p) || stored.has(p)
}
const picked = new Set<string>() // folders the user chose in the dialog this session
const opened = new Map<string, string[]>() // opened repo -> log tips; only these may be queried

async function loadRecent(): Promise<string[]> {
  try {
    const list: unknown = JSON.parse(await readFile(recentFile(), 'utf8'))
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

async function remember(path: string) {
  const list = [path, ...(await loadRecent()).filter((p) => p !== path)].slice(0, 10)
  await writeFile(recentFile(), JSON.stringify(list))
}

function str(v: unknown): string {
  if (typeof v !== 'string' || !v) throw new GitError('invalid argument')
  return v
}

function int(v: unknown, max: number): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw new GitError('invalid argument')
  return v as number
}

function paths(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 1_000_000) throw new GitError('invalid argument')
  return v.map(str)
}

function diffTarget(v: unknown): DiffTarget {
  const t = v as Record<string, unknown> | null
  if (t && typeof t.sha === 'string') return { path: str(t.path), sha: t.sha }
  if (t && typeof t.staged === 'boolean') return { path: str(t.path), staged: t.staged }
  throw new GitError('invalid argument')
}

function hunkSelection(v: unknown): HunkSelection {
  const h = v as Record<string, unknown> | null
  if (!h || typeof h.staged !== 'boolean' || typeof h.hunkHeader !== 'string' || typeof h.hunkLines !== 'string')
    throw new GitError('invalid argument')
  const lines = h.lines === undefined ? undefined : Array.isArray(h.lines) ? h.lines.map((n) => int(n, 1_000_000)) : null
  if (lines === null) throw new GitError('invalid argument')
  return { path: str(h.path), staged: h.staged, hunk: int(h.hunk, 100_000), hunkHeader: h.hunkHeader, hunkLines: h.hunkLines, lines }
}

const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop'] as const
function rebaseSteps(v: unknown): RebaseStep[] {
  if (!Array.isArray(v) || v.length > 10_000) throw new GitError('invalid argument')
  return v.map((x) => {
    const s = x as Record<string, unknown> | null
    if (!s || !ACTIONS.includes(s.action as RebaseStep['action'])) throw new GitError('invalid argument')
    const message = typeof s.message === 'string' ? s.message.slice(0, 100_000) : undefined
    return { sha: str(s.sha), action: s.action as RebaseStep['action'], message }
  })
}

function undoSteps(v: unknown): UndoStep[] {
  if (!Array.isArray(v) || v.length > 10) throw new GitError('invalid argument')
  return v.map((x): UndoStep => {
    const s = x as Record<string, unknown> | null
    switch (s?.type) {
      case 'reset':
        if (s.mode !== 'soft' && s.mode !== 'keep') break
        return { type: 'reset', expect: str(s.expect), to: str(s.to), mode: s.mode, branch: s.branch === null ? null : str(s.branch) }
      case 'checkout':
        return { type: 'checkout', branch: str(s.branch) }
      case 'createBranch':
        return { type: 'createBranch', name: str(s.name), sha: str(s.sha) }
      case 'deleteBranch':
        return { type: 'deleteBranch', name: str(s.name), expect: str(s.expect) }
      case 'renameBranch':
        return { type: 'renameBranch', from: str(s.from), to: str(s.to) }
    }
    throw new GitError('invalid argument')
  })
}

function resolution(v: unknown): Resolution {
  const r = v as Record<string, unknown> | null
  if (r && typeof r.content === 'string') return { content: r.content }
  if (r && (r.side === 'ours' || r.side === 'theirs')) return { side: r.side }
  throw new GitError('invalid argument')
}

function menuItems(v: unknown): MenuItem[] {
  if (!Array.isArray(v) || v.length > 50) throw new GitError('invalid argument')
  return v.map((i) => {
    if (i && i.separator === true) return { separator: true } as const
    return { id: str(i?.id), label: str(i?.label).slice(0, 200), enabled: i?.enabled !== false }
  })
}

function popupMenu(sender: Electron.WebContents, items: MenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    const menu = Menu.buildFromTemplate(
      items.map((i) =>
        'separator' in i ? { type: 'separator' } : { label: i.label, enabled: i.enabled, click: () => resolve(i.id) }
      )
    )
    const window = BrowserWindow.fromWebContents(sender) ?? undefined
    // The close callback can run before the click handler; resolving null later lets a click win.
    menu.popup({ window, callback: () => setTimeout(() => resolve(null), 100) })
  })
}

// One watched repository at a time, kept across refreshes of the same repo, dropped on close
// or error (the next refresh starts a new one).
// ponytail: single repo watcher, one per tab once tabs exist (M8)
let watched: { path: string; watcher: RepoWatcher } | null = null
function unwatch() {
  watched?.watcher.close()
  watched = null
}
async function watchOpenRepo(path: string, win: Electron.WebContents) {
  if (watched?.path === path) return
  unwatch()
  const watcher = watchRepo(
    path,
    await gitDirsOutside(path),
    (kind) => !win.isDestroyed() && win.send('repo:changed', { repo: path, kind } satisfies RepoChange),
    () => watched?.watcher === watcher && unwatch()
  )
  watched = { path, watcher }
}

function knownRepo(v: unknown): string {
  const path = str(v)
  if (!opened.has(path)) throw new GitError('repository not opened')
  return path
}

// The renderer may only open what the user picked or opened before (recent list).
async function allowedPath(v: unknown): Promise<string> {
  const path = str(v)
  if (picked.has(path) || opened.has(path) || (await loadRecent()).includes(path) || (await knownToSession())(path)) return path
  throw new GitError('choose the repository with the open dialog first')
}

type Handlers = { [K in keyof GitspynxApi]: (sender: Electron.WebContents, ...args: unknown[]) => ReturnType<GitspynxApi[K]> }

const handlers: Handlers = {
  async pickRepo() {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (res.canceled) return null
    picked.add(res.filePaths[0])
    return res.filePaths[0]
  },
  recentRepos: () => loadRecent(),
  async closeRepo() {
    unwatch()
  },
  getSession: () => loadSession(),
  getSettings: () => settings().load(),
  async saveSettings(_s, raw) {
    const next = parseSettings(raw)
    await settings().save(next)
    applySettings(next)
    return next
  },
  async saveTabs(_s, tabs, active) {
    if (!Array.isArray(tabs)) throw new GitError('invalid argument')
    await storeSession(withTabs(await loadSession(), tabs.map(str), int(active, 1000), await knownToSession()))
  },
  async saveWorkspace(_s, name, repos) {
    if (!Array.isArray(repos)) throw new GitError('invalid argument')
    const next = withWorkspace(await loadSession(), str(name), repos.map(str), await knownToSession())
    await storeSession(next)
    return next
  },
  async deleteWorkspace(_s, name) {
    const next = withoutWorkspace(await loadSession(), str(name))
    await storeSession(next)
    return next
  },
  async openRepo(sender, path) {
    const request = opens.next()
    const info = await openRepo(await allowedPath(path))
    opened.set(info.path, info.tips)
    for (const t of info.worktrees) picked.add(t.path) // reported by git: may be opened as tabs
    await remember(info.path)
    if (opens.isLatest(request)) await watchOpenRepo(info.path, sender)
    return info
  },
  readLog: (_s, repo, skip, limit, tips) => {
    const path = knownRepo(repo)
    const snapshot = opened.get(path)!
    // a filter may only narrow the snapshot taken at open
    if (tips !== undefined && !Array.isArray(tips)) throw new GitError('invalid argument')
    const chosen = tips === undefined ? snapshot : snapshot.filter((t) => tips.includes(t))
    return readLog(path, chosen, int(skip, 1e7), int(limit, MAX_LOG_PAGE))
  },
  readCommit: (_s, repo, sha) => readCommit(knownRepo(repo), str(sha)),
  readStatus: (_s, repo) => readStatus(knownRepo(repo)),
  stage: (_s, repo, p) => stage(knownRepo(repo), paths(p)),
  unstage: (_s, repo, p) => unstage(knownRepo(repo), paths(p)),
  readFileDiff: (_s, repo, target) => readFileDiff(knownRepo(repo), diffTarget(target)),
  stageHunk: (_s, repo, sel) => stageHunk(knownRepo(repo), hunkSelection(sel)),
  readRebasePlan: (_s, repo, base) => readRebasePlan(knownRepo(repo), str(base)),
  interactiveRebase: (_s, repo, base, steps) => interactiveRebase(knownRepo(repo), str(base), rebaseSteps(steps)),
  applyUndo: (_s, repo, steps) => applyUndo(knownRepo(repo), undoSteps(steps)),
  readHead: (_s, repo) => readHead(knownRepo(repo)),
  async addWorktree(sender, repo, branch, fromSha) {
    const path = knownRepo(repo)
    const name = str(branch)
    const window = BrowserWindow.fromWebContents(sender) ?? undefined
    const res = await dialog.showSaveDialog(window!, {
      title: `Worktree für „${name}“ anlegen`,
      defaultPath: join(dirname(path), `${basename(path)}-${name.replace(/[\\/]/g, '-')}`),
      buttonLabel: 'Worktree anlegen',
      properties: ['createDirectory']
    })
    if (res.canceled || !res.filePath) return null
    await addWorktree(path, res.filePath, name, fromSha === null ? null : str(fromSha))
    picked.add(res.filePath) // the renderer may open it as a tab
    return res.filePath
  },
  removeWorktree: (_s, repo, path, force) => removeWorktree(knownRepo(repo), str(path), force === true),
  pruneWorktrees: (_s, repo) => pruneWorktrees(knownRepo(repo)),
  commit: (_s, repo, message, amend) => commit(knownRepo(repo), str(message), amend === true),
  createBranch: (_s, repo, name, start, switchTo) => createBranch(knownRepo(repo), str(name), str(start), switchTo === true),
  checkout: (_s, repo, branch) => checkout(knownRepo(repo), str(branch)),
  renameBranch: (_s, repo, from, to) => renameBranch(knownRepo(repo), str(from), str(to)),
  deleteBranch: (_s, repo, name, force) => deleteBranch(knownRepo(repo), str(name), force === true),
  fetch: (_s, repo) => fetchAll(knownRepo(repo)),
  pull(_s, repo, mode) {
    if (mode !== 'ff-only' && mode !== 'rebase' && mode !== 'merge') throw new GitError('invalid argument')
    return pull(knownRepo(repo), mode)
  },
  async push(_s, repo, force) {
    try {
      await push(knownRepo(repo), force === true)
      return 'ok'
    } catch (e) {
      if (isRejectedPush(e)) return 'rejected'
      throw e
    }
  },
  deleteRemoteBranch: (_s, repo, name) => deleteRemoteBranch(knownRepo(repo), str(name)),
  merge: (_s, repo, rev) => merge(knownRepo(repo), str(rev)),
  rebase: (_s, repo, onto) => rebase(knownRepo(repo), str(onto)),
  cherryPick: (_s, repo, sha) => cherryPick(knownRepo(repo), str(sha)),
  continueOperation: (_s, repo) => continueOperation(knownRepo(repo)),
  skipOperation: (_s, repo) => skipOperation(knownRepo(repo)),
  abortOperation: (_s, repo) => abortOperation(knownRepo(repo)),
  stashPush: (_s, repo, message) => stashPush(knownRepo(repo), typeof message === 'string' ? message.slice(0, 2000) : ''),
  stashApply: (_s, repo, sha, pop) => stashApply(knownRepo(repo), str(sha), pop === true),
  stashDrop: (_s, repo, sha) => stashDrop(knownRepo(repo), str(sha)),
  readConflict: (_s, repo, path) => readConflict(knownRepo(repo), str(path)),
  resolveConflict: (_s, repo, path, r) => resolveConflict(knownRepo(repo), str(path), resolution(r)),
  showContextMenu: (sender, items) => popupMenu(sender, menuItems(items)),
  async confirm(sender, message, detail, okLabel) {
    const window = BrowserWindow.fromWebContents(sender)!
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      message: str(message),
      detail: typeof detail === 'string' ? detail : '',
      buttons: [str(okLabel), 'Abbrechen'],
      defaultId: 1,
      cancelId: 1
    })
    return response === 0
  }
}

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`api:${name}`, (e, ...args) => (fn as (s: Electron.WebContents, ...a: unknown[]) => unknown)(e.sender, ...args))
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'gitspynx',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('did-finish-load', async () => applySettings(await settings().load()))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Own menu: no Close Window on Cmd+W (closes a tab instead) and no built-in zoom/reload
// accelerators; those are app commands with configurable shortcuts.
function setMenu() {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      { role: 'editMenu' },
      { label: 'Ansicht', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
      { label: 'Fenster', submenu: [{ role: 'minimize' }, { role: 'zoom' }, ...(mac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [{ role: 'quit' as const }])] }
    ])
  )
}

app.whenReady().then(() => {
  setMenu()
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
