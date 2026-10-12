import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Workspace } from '../../../shared/types'
import { useRepo, type View } from './repo'

// Open repositories as tabs. Only the active tab is loaded; the others keep a remembered view
// (selection, filters) and reload when activated.
// ponytail: inactive tabs reload from scratch on activation; cache per-tab history if switching feels slow
export const useTabs = defineStore('tabs', () => {
  const repo = useRepo()
  const tabs = ref<string[]>([])
  const active = ref(0)
  const workspaces = ref<Workspace[]>([])
  const views = new Map<string, View>()

  // IPC structured-clones arguments; Vue's reactive proxies can't be cloned, so send plain copies.
  const persist = () => window.gitspynx.saveTabs([...tabs.value], active.value)
  const remember = () => repo.info && views.set(repo.info.path, repo.viewState())

  async function restore() {
    const s = await window.gitspynx.getSession()
    workspaces.value = s.workspaces
    if (tabs.value.length) return // the user opened something while the session was loading
    tabs.value = s.tabs
    active.value = s.active
    if (tabs.value.length) await repo.open(tabs.value[active.value])
  }

  async function activate(index: number) {
    const path = tabs.value[index]
    if (!path || (index === active.value && repo.info?.path === path)) return
    remember()
    active.value = index
    await repo.open(path, 0, views.get(path))
    await persist()
  }

  // Opens a folder (picked or recent) and shows it as a tab; a failed open adds nothing.
  async function openPath(path: string) {
    const existing = tabs.value.indexOf(path)
    if (existing !== -1) return activate(existing)
    remember()
    await repo.open(path)
    if (repo.error || !repo.info) return
    const index = tabs.value.indexOf(repo.info.path)
    if (index === -1) tabs.value = [...tabs.value, repo.info.path]
    active.value = index === -1 ? tabs.value.length - 1 : index
    await persist()
  }

  async function closeTab(index: number) {
    const [path] = tabs.value.splice(index, 1)
    tabs.value = [...tabs.value]
    views.delete(path)
    if (!tabs.value.length) {
      active.value = 0
      repo.close()
    } else if (index === active.value) {
      active.value = Math.min(index, tabs.value.length - 1)
      const next = tabs.value[active.value]
      await repo.open(next, 0, views.get(next))
    } else if (index < active.value) {
      active.value--
    }
    await persist()
  }

  async function saveWorkspace(name: string) {
    workspaces.value = (await window.gitspynx.saveWorkspace(name, [...tabs.value])).workspaces
  }

  async function deleteWorkspace(name: string) {
    workspaces.value = (await window.gitspynx.deleteWorkspace(name)).workspaces
  }

  async function openWorkspace(ws: Workspace) {
    remember()
    tabs.value = [...ws.repos]
    active.value = 0
    if (tabs.value.length) await repo.open(tabs.value[0], 0, views.get(tabs.value[0]))
    await persist()
  }

  return { tabs, active, workspaces, restore, activate, openPath, closeTab, saveWorkspace, deleteWorkspace, openWorkspace }
})
