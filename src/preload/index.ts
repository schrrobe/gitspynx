import { contextBridge, ipcRenderer } from 'electron'
import type { GitspynxApi, GitspynxBridge, RepoChange } from '../shared/types'

const methods: (keyof GitspynxApi)[] = [
  'pickRepo',
  'recentRepos',
  'openRepo',
  'readLog',
  'readCommit',
  'readStatus',
  'stage',
  'unstage',
  'readFileDiff',
  'commit',
  'createBranch',
  'checkout',
  'renameBranch',
  'deleteBranch',
  'fetch',
  'pull',
  'push',
  'deleteRemoteBranch',
  'showContextMenu',
  'confirm'
]

const api = Object.fromEntries(
  methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`api:${m}`, ...args)])
) as unknown as GitspynxApi

const bridge: GitspynxBridge = {
  ...api,
  onRepoChanged(cb) {
    const listener = (_e: unknown, change: RepoChange) => cb(change)
    ipcRenderer.on('repo:changed', listener)
    return () => ipcRenderer.off('repo:changed', listener)
  }
}

contextBridge.exposeInMainWorld('gitspynx', bridge)
