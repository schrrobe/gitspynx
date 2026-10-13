import type { useRepo } from './stores/repo'
import type { useSettings } from './stores/settings'
import type { useTabs } from './stores/tabs'
import { WIP } from './stores/repo'
import { isMac } from './keymap'
import { focusSearchRequest, paletteOpen, settingsOpen, terminalOpen } from './ui'

export interface Command {
  id: string
  title: string
  keys?: string | string[] // default combo(s), see keymap.ts
  repeatable?: boolean // may fire on key repeat (zoom); others fire once per press
  notInTextFields?: boolean // the combo keeps its text-editing meaning in inputs (Mod+Z)
  enabled?: () => boolean
  run: () => unknown
}

// The command a key press triggers, if any: plain keys (no Mod/Ctrl) stay with text fields, key
// repeat only drives repeatable commands (holding Mod+W must not close every tab).
// The terminal keeps keys for the shell; these app shortcuts reach the app from there. On macOS
// Cmd combos never mean anything to a shell; elsewhere Ctrl+W, Ctrl+R … do.
const THROUGH_TERMINAL = new Set(['tab.next', 'tab.prev', 'terminal.toggle', 'palette.open'])
export const passesTerminal = (command: Command | undefined, combo: string, mac = isMac) =>
  !!command && (THROUGH_TERMINAL.has(command.id) || (mac && combo.includes('Mod')))

export function commandForKey(
  combo: string,
  e: { repeat: boolean; inTextField: boolean },
  commands: Command[],
  byCombo: Map<string, string>
): Command | undefined {
  if (e.inTextField && !/^(Mod|Ctrl)\+/.test(combo)) return undefined
  const command = commands.find((c) => c.id === byCombo.get(combo))
  if (!command || (e.repeat && !command.repeatable) || (e.inTextField && command.notInTextFields) || command.enabled?.() === false)
    return undefined
  return command
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
  const onBranch = () => idle() && !!repo.info?.head.branch // pull/push need a branch, not a detached HEAD
  const zoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => z >= settings.settings.zoom)
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? 2 : i) + dir))]
    return settings.save({ zoom: next })
  }
  return [
    { id: 'palette.open', title: 'Befehlspalette', keys: 'Mod+Shift+P', run: () => (paletteOpen.value = true) },
    { id: 'settings.open', title: 'Einstellungen', keys: 'Mod+,', run: () => (settingsOpen.value = true) },
    { id: 'repo.open', title: 'Repository öffnen…', keys: 'Mod+O', run: pickRepo },
    // without tabs the shortcut closes the window, as everywhere else
    { id: 'tab.close', title: 'Tab schließen', keys: 'Mod+W', run: () => (tabs.tabs.length ? tabs.closeTab(tabs.active) : window.close()) },
    { id: 'tab.next', title: 'Nächster Tab', keys: 'Ctrl+Tab', enabled: () => tabs.tabs.length > 1, run: () => tabs.activate((tabs.active + 1) % tabs.tabs.length) },
    {
      id: 'tab.prev',
      title: 'Vorheriger Tab',
      keys: 'Ctrl+Shift+Tab',
      enabled: () => tabs.tabs.length > 1,
      run: () => tabs.activate((tabs.active + tabs.tabs.length - 1) % tabs.tabs.length)
    },
    {
      id: 'edit.undo',
      title: 'Rückgängig',
      keys: 'Mod+Z',
      notInTextFields: true,
      enabled: () => idle() && !repo.undoing && !repo.info?.operation && !!repo.undoLabel,
      run: () => repo.undo()
    },
    {
      id: 'edit.redo',
      title: 'Wiederholen',
      keys: 'Mod+Shift+Z',
      notInTextFields: true,
      enabled: () => idle() && !repo.undoing && !repo.info?.operation && !!repo.redoLabel,
      run: () => repo.redo()
    },
    { id: 'terminal.toggle', title: 'Terminal ein-/ausblenden', keys: 'Ctrl+`', enabled: open, run: () => (terminalOpen.value = !terminalOpen.value) },
    { id: 'repo.refresh', title: 'Aktualisieren', keys: 'Mod+R', enabled: open, run: () => repo.refresh() },
    { id: 'repo.fetch', title: 'Fetch', keys: 'Mod+L', enabled: idle, run: () => repo.fetchAll() },
    { id: 'repo.pull', title: 'Pull', keys: 'Mod+Shift+L', enabled: onBranch, run: () => repo.pullBranch(settings.settings.pullMode) },
    { id: 'repo.push', title: 'Push', keys: 'Mod+Shift+K', enabled: onBranch, run: () => repo.pushBranch() },
    {
      id: 'submodules.update',
      title: 'Alle Submodule initialisieren/aktualisieren',
      enabled: () => idle() && !!repo.info?.submodules.length,
      run: () => repo.updateSubmodules()
    },
    { id: 'lfs.track', title: 'Git LFS: Muster tracken…', enabled: () => idle() && !!repo.info?.lfsAvailable, run: () => repo.lfsTrack() },
    { id: 'lfs.pull', title: 'Git LFS: Dateien holen', enabled: () => idle() && !!repo.info?.lfs?.installed, run: () => repo.lfsPull() },
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
      enabled: () => open() && !repo.conflict, // the conflict editor's unsaved result would be lost
      run: () => {
        repo.closeDiff()
        repo.conflict = null
        focusSearchRequest.value++
      }
    },
    { id: 'view.zoomIn', title: 'Vergrößern', keys: ['Mod+=', 'Mod+Plus'], repeatable: true, run: () => zoom(1) },
    { id: 'view.zoomOut', title: 'Verkleinern', keys: 'Mod+-', repeatable: true, run: () => zoom(-1) },
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
