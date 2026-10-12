import type { useRepo } from './stores/repo'
import type { useSettings } from './stores/settings'
import type { useTabs } from './stores/tabs'
import { WIP } from './stores/repo'
import { focusSearchRequest, paletteOpen, settingsOpen } from './ui'

export interface Command {
  id: string
  title: string
  keys?: string // default combo, see keymap.ts
  enabled?: () => boolean
  run: () => unknown
}

interface Context {
  repo: ReturnType<typeof useRepo>
  tabs: ReturnType<typeof useTabs>
  settings: ReturnType<typeof useSettings>
  pickRepo: () => unknown
}

const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

// Every user action that can have a shortcut or appear in the command palette.
export function buildCommands({ repo, tabs, settings, pickRepo }: Context): Command[] {
  const open = () => !!repo.info
  const idle = () => open() && !repo.busy
  const zoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= settings.settings.zoom)
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? 2 : i) + dir))]
    return settings.save({ zoom: next })
  }
  return [
    { id: 'palette.open', title: 'Befehlspalette', keys: 'Mod+Shift+P', run: () => (paletteOpen.value = true) },
    { id: 'settings.open', title: 'Einstellungen', keys: 'Mod+,', run: () => (settingsOpen.value = true) },
    { id: 'repo.open', title: 'Repository öffnen…', keys: 'Mod+O', run: pickRepo },
    { id: 'tab.close', title: 'Tab schließen', keys: 'Mod+W', enabled: () => tabs.tabs.length > 0, run: () => tabs.closeTab(tabs.active) },
    { id: 'tab.next', title: 'Nächster Tab', keys: 'Ctrl+Tab', enabled: () => tabs.tabs.length > 1, run: () => tabs.activate((tabs.active + 1) % tabs.tabs.length) },
    {
      id: 'tab.prev',
      title: 'Vorheriger Tab',
      keys: 'Ctrl+Shift+Tab',
      enabled: () => tabs.tabs.length > 1,
      run: () => tabs.activate((tabs.active + tabs.tabs.length - 1) % tabs.tabs.length)
    },
    { id: 'repo.refresh', title: 'Aktualisieren', keys: 'Mod+R', enabled: open, run: () => repo.refresh() },
    { id: 'repo.fetch', title: 'Fetch', keys: 'Mod+L', enabled: idle, run: () => repo.fetchAll() },
    { id: 'repo.pull', title: 'Pull', keys: 'Mod+Shift+L', enabled: idle, run: () => repo.pullBranch(settings.settings.pullMode) },
    { id: 'repo.push', title: 'Push', keys: 'Mod+Shift+K', enabled: idle, run: () => repo.pushBranch() },
    { id: 'repo.stash', title: 'Stash', enabled: () => idle() && repo.status.length > 0, run: () => repo.stash() },
    { id: 'repo.pop', title: 'Stash anwenden und löschen (Pop)', enabled: () => idle() && !!repo.info?.stashes.length, run: () => repo.popLatestStash() },
    {
      id: 'workdir.stageAll',
      title: 'Alle Änderungen stagen',
      keys: 'Mod+Shift+S',
      enabled: () => idle() && repo.unstaged.some((f) => !f.conflicted),
      run: () => repo.stage(repo.unstaged.filter((f) => !f.conflicted).map((f) => f.path))
    },
    { id: 'workdir.show', title: 'Arbeitsverzeichnis / Commit-Nachricht', keys: 'Mod+Shift+M', enabled: open, run: () => repo.select(WIP) },
    {
      id: 'branch.create',
      title: 'Branch an HEAD erstellen…',
      keys: 'Mod+B',
      enabled: () => idle() && !!repo.info?.head.sha,
      run: () => repo.createBranch(repo.info!.head.sha!)
    },
    {
      id: 'search.focus',
      title: 'Commits suchen',
      keys: 'Mod+F',
      enabled: open,
      run: () => {
        repo.closeDiff()
        repo.conflict = null
        focusSearchRequest.value++
      }
    },
    { id: 'view.zoomIn', title: 'Vergrößern', keys: 'Mod+=', run: () => zoom(1) },
    { id: 'view.zoomOut', title: 'Verkleinern', keys: 'Mod+-', run: () => zoom(-1) },
    { id: 'view.zoomReset', title: 'Originalgröße', keys: 'Mod+0', run: () => settings.save({ zoom: 1 }) },
    {
      id: 'view.toggleTheme',
      title: 'Hell/Dunkel umschalten',
      run: () => {
        const dark = settings.settings.theme === 'dark' || (settings.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
        return settings.save({ theme: dark ? 'light' : 'dark' })
      }
    }
  ]
}
