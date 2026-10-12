import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GitspynxApi } from '../shared/types'
import { GitError, openRepo, readCommit, readLog } from './git'

const recentFile = () => join(app.getPath('userData'), 'recent.json')
const opened = new Set<string>() // only repos the user opened may be queried

async function loadRecent(): Promise<string[]> {
  try {
    return JSON.parse(await readFile(recentFile(), 'utf8'))
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

function knownRepo(v: unknown): string {
  const path = str(v)
  if (!opened.has(path)) throw new GitError('repository not opened')
  return path
}

const handlers: { [K in keyof GitspynxApi]: (...args: unknown[]) => ReturnType<GitspynxApi[K]> } = {
  async pickRepo() {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  },
  recentRepos: loadRecent,
  async openRepo(path) {
    const info = await openRepo(str(path))
    opened.add(info.path)
    await remember(info.path)
    return info
  },
  readLog: (repo, skip, limit) => readLog(knownRepo(repo), int(skip, 1e7), int(limit, 10000)),
  readCommit: (repo, sha) => readCommit(knownRepo(repo), str(sha))
}

for (const [name, fn] of Object.entries(handlers)) {
  ipcMain.handle(`api:${name}`, (_e, ...args) => (fn as (...a: unknown[]) => unknown)(...args))
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
