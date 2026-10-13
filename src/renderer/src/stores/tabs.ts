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
  let seq = 0 // newest tab action; older ones don't touch the highlight when they finish late

  // The highlight follows the repository actually shown; with nothing shown it stays put. A
  // repository whose tab is gone (its replacement failed to open) is not shown any more.
  function syncActive() {
    const shown = repo.info?.path
    const i = shown ? tabs.value.indexOf(shown) : -1
    if (i !== -1) active.value = i
    else if (shown) {
      const error = repo.error
      repo.close()
      repo.error = error
    }
  }

  // IPC structured-clones arguments; Vue's reactive proxies can't be cloned, so send plain copies.
  const persist = () => window.gitspynx.saveTabs([...tabs.value], active.value)
  const remember = () => repo.info && views.set(repo.info.path, repo.viewState())

  async function restore() {
    const s = await window.gitspynx.getSession()
    workspaces.value = s.workspaces
    if (tabs.value.length) return // the user opened something while the session was loading
    tabs.value = s.tabs
    active.value = s.active
    const my = ++seq
    if (tabs.value.length) await repo.open(tabs.value[active.value])
    if (my === seq) syncActive()
  }

  async function activate(index: number) {
    const path = tabs.value[index]
    if (!path || (index === active.value && repo.info?.path === path)) return
    remember()
    const my = ++seq
    if (!repo.info) active.value = index // nothing shown: highlight the tab being opened
    await repo.open(path, 0, views.get(path))
    if (my !== seq) return
    syncActive()
    await persist()
  }

  // Opens a folder (picked or recent) and shows it as a tab; a failed open adds nothing.
  async function openPath(path: string) {
    const existing = tabs.value.indexOf(path)
    if (existing !== -1) return activate(existing)
    remember()
    const my = ++seq
    await repo.open(path, 0, (root) => views.get(root)) // a subfolder of an open tab gets its view back
    if (my !== seq || repo.error || !repo.info) return
    if (!tabs.value.includes(repo.info.path)) tabs.value = [...tabs.value, repo.info.path]
    syncActive()
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
      const my = ++seq
      await repo.open(next, 0, views.get(next))
      if (my === seq) syncActive()
    } else if (index < active.value) {
      active.value--
    }
    await persist()
  }

  async function saveWorkspace(name: string) {
    if (workspaces.value.some((w) => w.name === name) && !(await window.gitspynx.confirm(`Workspace „${name}“ ersetzen?`, '', 'Ersetzen'))) return
    workspaces.value = (await window.gitspynx.saveWorkspace(name, [...tabs.value])).workspaces
  }

  async function deleteWorkspace(name: string) {
    workspaces.value = (await window.gitspynx.deleteWorkspace(name)).workspaces
  }

  async function openWorkspace(ws: Workspace) {
    remember()
    tabs.value = [...ws.repos]
    active.value = 0
    const my = ++seq
    if (tabs.value.length) await repo.open(tabs.value[0], 0, views.get(tabs.value[0]))
    if (my === seq) syncActive()
    await persist()
  }

  return { tabs, active, workspaces, restore, activate, openPath, closeTab, saveWorkspace, deleteWorkspace, openWorkspace }
})
