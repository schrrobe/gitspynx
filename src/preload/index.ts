import { contextBridge, ipcRenderer } from 'electron'
import type { GitspynxApi, GitspynxBridge, RepoChange } from '../shared/types'

const methods: (keyof GitspynxApi)[] = [
  'pickRepo',
  'recentRepos',
  'openRepo',
  'closeRepo',
  'getSession',
  'saveTabs',
  'saveWorkspace',
  'deleteWorkspace',
  'getSettings',
  'saveSettings',
  'readLog',
  'readCommit',
  'readStatus',
  'stage',
  'unstage',
  'readFileDiff',
  'stageHunk',
  'readRebasePlan',
  'interactiveRebase',
  'commit',
  'createBranch',
  'checkout',
  'renameBranch',
  'deleteBranch',
  'fetch',
  'pull',
  'push',
  'deleteRemoteBranch',
  'merge',
  'rebase',
  'cherryPick',
  'continueOperation',
  'skipOperation',
  'abortOperation',
  'stashPush',
  'stashApply',
  'stashDrop',
  'readConflict',
  'resolveConflict',
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
