import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { type DiffTarget, type GitspynxApi, type HunkSelection, type RebaseStep, type UndoStep, MAX_LOG_PAGE, type MenuItem, type RepoChange, type Resolution, type Session } from '../shared/types'
import { setIdleHold, setGitEnv, assertNewWorktreeBranch,
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
  lfsPull,
  lfsTrack,
  lfsUntrack,
  listSubmodules,
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
  unstage,
  updateSubmodules
} from './git'
import { parseSettings, type Settings } from '../shared/settings'
import { startAskpass } from './askpass'
import { jsonFile, latestOnly, sessionFile, withoutWorkspace, withTabs, withWorkspace } from './session'
import { createTerminals, mergePath, shellEnv } from './terminal'
import { keepWatching, type RepoWatcher, watchRepo } from './watch'

const recentFile = () => join(app.getPath('userData'), 'recent.json')
let sessionStore: ReturnType<typeof sessionFile> | null = null
const store = () => (sessionStore ??= sessionFile(join(app.getPath('userData'), 'session.json')))
const loadSession = () => store().load()
const storeSession = (next: Session) => store().save(next)
// Login shell so PATH etc. match the user's terminal even when the app was started from the Dock.
const shell = process.platform === 'win32' ? (process.env.COMSPEC ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/sh')
// node-pty is loaded on first use: a broken native build then only disables the terminal.
let ptyModule: typeof import('node-pty') | null = null
const terminals = createTerminals(
  (cwd, cols, rows) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily: native module, only needed once a terminal opens
    ptyModule ??= require('node-pty') as typeof import('node-pty')
    const env = shellEnv(process.env, app.getAppPath(), process.platform)
    return ptyModule.spawn(shell, process.platform === 'win32' ? [] : ['-l'], { name: 'xterm-256color', cwd, cols, rows, env })
  },
  (owner, channel, id, payload) => {
    const wc = BrowserWindow.getAllWindows().map((w) => w.webContents).find((w) => w.id === owner)
    if (wc && !wc.isDestroyed()) wc.send(channel, id, payload)
  }
)
const terminalOwners = new Set<number>() // windows whose terminals die with them
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

const ACTIONS = ['pick', 'reword', 'edit', 'squash', 'fixup', 'drop'] as const
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
      case 'createBranch': {
        const up = s.upstream as Record<string, unknown> | undefined
        const upstream = up ? { remote: str(up.remote), merge: str(up.merge) } : undefined
        if (upstream && (/^-|[\s\0]/.test(upstream.remote) || !/^refs\//.test(upstream.merge))) break
        return { type: 'createBranch', name: str(s.name), sha: str(s.sha), ...(upstream ? { upstream } : {}) }
      }
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
  if (r && r.delete === true) return { delete: true }
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
let watchSeq = 0
async function watchOpenRepo(path: string, win: Electron.WebContents) {
  if (watched?.path === path) return
  unwatch()
  const my = ++watchSeq
  const outside = await gitDirsOutside(path)
  if (my !== watchSeq) return // a newer open takes over
  unwatch() // an older open that finished first
  // restarted on its own after a failure (see keepWatching)
  const watcher = keepWatching((onError) =>
    watchRepo(path, outside, (kind) => !win.isDestroyed() && win.send('repo:changed', { repo: path, kind } satisfies RepoChange), onError)
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

// Credential prompts of git/ssh are asked in the focused window; the answer comes back through
// askpassReply, accepted only from that window.
const askpassPending = new Map<number, { owner: number; resolve: (answer: string | null) => void }>()
let askpassSeq = 0
function askInWindow(prompt: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return Promise.resolve(null)
  const id = ++askpassSeq
  const contents = win.webContents
  return new Promise((resolve) => {
    const gone = () => finish(null)
    const finish = (answer: string | null) => {
      askpassPending.delete(id)
      contents.off('destroyed', gone)
      resolve(answer)
    }
    askpassPending.set(id, { owner: contents.id, resolve: finish })
    contents.once('destroyed', gone)
    contents.send('askpass:request', id, prompt)
  })
}

const handlers: Handlers = {
  async askpassReply(sender, id, answer) {
    const pending = askpassPending.get(int(id, 1e9))
    if (!pending || pending.owner !== sender.id) return
    pending.resolve(typeof answer === 'string' && answer.length <= 10_000 ? answer : null)
  },
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
    // same string the renderer builds (git paths use "/" on every platform)
    for (const s of info.submodules) if (s.state !== 'uninitialized') picked.add(`${info.path}/${s.path}`)
    await remember(info.path)
    if (opens.isLatest(request)) await watchOpenRepo(info.path, sender)
    return info
  },
  readLog: (_s, repo, skip, limit, tips) => {
    const path = knownRepo(repo)
    const snapshot = opened.get(path)!
    // a filter may only narrow the snapshot taken at open
    if (tips !== undefined && !Array.isArray(tips)) throw new GitError('invalid argument')
    const wanted = new Set(tips as string[] | undefined)
    const chosen = tips === undefined ? snapshot : snapshot.filter((t) => wanted.has(t))
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
    await assertNewWorktreeBranch(path, name, fromSha === null ? null : str(fromSha)) // before asking for a folder
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
  lfsTrack: (_s, repo, pattern) => lfsTrack(knownRepo(repo), str(pattern)),
  lfsUntrack: (_s, repo, pattern) => lfsUntrack(knownRepo(repo), str(pattern)),
  lfsPull: (_s, repo) => lfsPull(knownRepo(repo)),
  terminalStart: async (sender, repo, cols, rows) => {
    if (!terminalOwners.has(sender.id)) {
      terminalOwners.add(sender.id)
      const id = sender.id
      sender.once('destroyed', () => (terminals.killAll(id), terminalOwners.delete(id)))
      // a reloaded or crashed renderer cannot reach its shells any more
      sender.on('render-process-gone', () => terminals.killAll(id))
      sender.on('did-start-navigation', (d) => d.isMainFrame && !d.isSameDocument && terminals.killAll(id))
    }
    return terminals.start(sender.id, knownRepo(repo), int(cols, 100_000), int(rows, 100_000))
  },
  terminalWrite: async (sender, id, data) => {
    if (typeof data !== 'string' || data.length > 1_000_000) throw new GitError('invalid argument')
    terminals.write(sender.id, int(id, 1e9), data)
  },
  terminalResize: async (sender, id, cols, rows) => terminals.resize(sender.id, int(id, 1e9), int(cols, 100_000), int(rows, 100_000)),
  terminalKill: async (sender, id) => terminals.kill(sender.id, int(id, 1e9)),
  terminalAck: async (sender, id, chars) => terminals.ack(sender.id, int(id, 1e9), int(chars, 1e9)),
  async updateSubmodules(_s, repo, p) {
    const path = knownRepo(repo)
    if (!Array.isArray(p)) throw new GitError('invalid argument')
    const known = new Set((await listSubmodules(path)).map((s) => s.path))
    const requested = p.map(str)
    if (requested.some((x) => !known.has(x))) throw new GitError('unknown submodule')
    return updateSubmodules(path, requested)
  },
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

// Theme and zoom are set before the first paint; the window shows once that paint is ready.
async function createWindow() {
  const s = await settings().load()
  nativeTheme.themeSource = s.theme
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'gitspynx',
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff',
    webPreferences: {
      zoomFactor: s.zoom,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win.show())
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
      {
        label: 'Bearbeiten',
        submenu: [
          { role: 'undo', label: 'Rückgängig' },
          { role: 'redo', label: 'Wiederholen' },
          { type: 'separator' },
          { role: 'cut', label: 'Ausschneiden' },
          { role: 'copy', label: 'Kopieren' },
          { role: 'paste', label: 'Einsetzen' },
          { role: 'selectAll', label: 'Alles auswählen' }
        ]
      },
      { label: 'Ansicht', submenu: [{ role: 'toggleDevTools', label: 'Entwicklertools' }, { role: 'togglefullscreen', label: 'Vollbild' }] },
      {
        label: 'Fenster',
        submenu: [
          { role: 'minimize', label: 'Minimieren' },
          ...(mac
            ? [{ role: 'zoom' as const, label: 'Zoomen' }, { type: 'separator' as const }, { role: 'front' as const, label: 'Alle nach vorne bringen' }]
            : [{ role: 'quit' as const, label: 'Beenden' }])
        ]
      }
    ])
  )
}

// Apps started from the Dock/launcher get a minimal PATH (no Homebrew, so no git-lfs, gpg, …).
// Take the login shell's PATH once, so git and its helpers find what the user's terminal finds.
function adoptLoginShellPath(): Promise<void> {
  if (process.platform === 'win32') return Promise.resolve()
  return new Promise((resolve) => {
    execFile(shell, ['-lc', 'printf "__GITSPYNX_PATH__%s" "$PATH"'], { timeout: 3000 }, (err, stdout) => {
      const login = !err && stdout.split('__GITSPYNX_PATH__').pop()
      if (login) process.env.PATH = mergePath(process.env.PATH ?? '', login.trim(), ':')
      resolve()
    })
  })
}

app.whenReady().then(async () => {
  setMenu()
  await adoptLoginShellPath()
  await createWindow()
  // without it git still works; credentials then come only from helpers and the SSH agent
  await startAskpass(join(app.getPath('userData'), 'askpass'), process.execPath, askInWindow).then(
    (askpass) => {
      setGitEnv(askpass.env)
      setIdleHold(() => askpassPending.size > 0) // typing a password is not a stalled transfer
      app.once('will-quit', askpass.close) // removes the socket file
    },
    (e) => console.error('askpass unavailable:', e)
  )
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && void createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
