import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { type FSWatcher, watch } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiffTarget, GitspynxApi, RepoChange } from '../shared/types'
import { commit, GitError, openRepo, readCommit, readFileDiff, readLog, readStatus, stage, unstage } from './git'

const recentFile = () => join(app.getPath('userData'), 'recent.json')
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
  if (!Array.isArray(v) || v.length === 0 || v.length > 10000) throw new GitError('invalid argument')
  return v.map(str)
}

function diffTarget(v: unknown): DiffTarget {
  const t = v as Record<string, unknown> | null
  if (t && typeof t.sha === 'string') return { path: str(t.path), sha: t.sha }
  if (t && typeof t.staged === 'boolean') return { path: str(t.path), staged: t.staged }
  throw new GitError('invalid argument')
}

// One watched repository at a time; changes are debounced and pushed to the window.
// ponytail: single repo watcher, one per tab once tabs exist (M8)
let watcher: FSWatcher | null = null
function watchRepo(path: string, win: Electron.WebContents) {
  watcher?.close()
  let timer: NodeJS.Timeout | undefined
  let git = false
  watcher = watch(path, { recursive: true }, (_event, file) => {
    const f = String(file ?? '')
    if (f.startsWith('.git/objects/') || f.endsWith('.lock')) return
    git ||= f === '.git' || f.startsWith('.git/')
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!win.isDestroyed()) win.send('repo:changed', { repo: path, git } satisfies RepoChange)
      git = false
    }, 300)
  })
  watcher.on('error', () => watcher?.close())
}

function knownRepo(v: unknown): string {
  const path = str(v)
  if (!opened.has(path)) throw new GitError('repository not opened')
  return path
}

// The renderer may only open what the user picked or opened before (recent list).
async function allowedPath(v: unknown): Promise<string> {
  const path = str(v)
  if (picked.has(path) || opened.has(path) || (await loadRecent()).includes(path)) return path
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
  async openRepo(sender, path) {
    const info = await openRepo(await allowedPath(path))
    opened.set(info.path, info.tips)
    await remember(info.path)
    watchRepo(info.path, sender)
    return info
  },
  readLog: (_s, repo, skip, limit) => {
    const path = knownRepo(repo)
    return readLog(path, opened.get(path)!, int(skip, 1e7), int(limit, 10000))
  },
  readCommit: (_s, repo, sha) => readCommit(knownRepo(repo), str(sha)),
  readStatus: (_s, repo) => readStatus(knownRepo(repo)),
  stage: (_s, repo, p) => stage(knownRepo(repo), paths(p)),
  unstage: (_s, repo, p) => unstage(knownRepo(repo), paths(p)),
  readFileDiff: (_s, repo, target) => readFileDiff(knownRepo(repo), diffTarget(target)),
  commit: (_s, repo, message, amend) => commit(knownRepo(repo), str(message), amend === true)
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
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit())
