import { contextBridge, ipcRenderer } from 'electron'
import type { GitspynxApi } from '../shared/types'

const methods: (keyof GitspynxApi)[] = ['pickRepo', 'recentRepos', 'openRepo', 'readLog', 'readCommit']

const api = Object.fromEntries(
  methods.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`api:${m}`, ...args)])
) as unknown as GitspynxApi

contextBridge.exposeInMainWorld('gitspynx', api)
