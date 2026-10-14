<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildCommands, commandForKey, passesTerminal } from './commands'
import CommandPalette from './components/CommandPalette.vue'
import CommitDetail from './components/CommitDetail.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { comboFromEvent, resolveKeymap } from './keymap'
import { useSettings } from './stores/settings'
import { focusSearchRequest, paletteOpen, settingsOpen, terminalOpen } from './ui'
import Icon from './components/Icon.vue'
import ConflictView from './components/ConflictView.vue'
import CommitList from './components/CommitList.vue'
import DiffView from './components/DiffView.vue'
import OperationBar from './components/OperationBar.vue'
import Sidebar from './components/Sidebar.vue'
import PromptDialog from './components/PromptDialog.vue'
import RebaseDialog from './components/RebaseDialog.vue'
import TabStrip from './components/TabStrip.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import WorkdirPanel from './components/WorkdirPanel.vue'
import { ask, isSecretPrompt } from './prompt'
import { useRepo, WIP } from './stores/repo'
import { useTabs } from './stores/tabs'

const repo = useRepo()
const tabs = useTabs()
const settings = useSettings()
const recent = ref<string[]>([])

onMounted(async () => {
  await settings.load()
  recent.value = await window.gitspynx.recentRepos()
  await tabs.restore()
})

// Shortcuts: one window-level dispatcher over the command list and the (customizable) keymap.
const commands = buildCommands({ repo, tabs, settings, pickRepo: () => pick() })
const keymap = computed(() => resolveKeymap(commands, settings.settings.keymap))

function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || document.querySelector('dialog[open]')) return // dialogs handle their own keys
  const combo = comboFromEvent(e)
  if (!combo || e.isComposing) return
  const inTextField = !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select')
  const command = commandForKey(combo, { repeat: e.repeat, inTextField }, commands, keymap.value.byCombo)
  if (!command) return
  e.preventDefault()
  command.run()
}
// Keys the terminal hands back to the app (they then bubble to onKey).
function passKey(e: KeyboardEvent) {
  const combo = comboFromEvent(e)
  return !!combo && passesTerminal(commandForKey(combo, { repeat: e.repeat, inTextField: true }, commands, keymap.value.byCombo), combo)
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// File changes on disk: refs/HEAD changes reload history, work tree/index changes only the status.
const stopWatching = window.gitspynx.onRepoChanged(({ repo: path, kind }) => {
  if (path !== repo.info?.path) return
  if (kind === 'history') repo.refresh(true)
  else repo.refreshStatus()
})
onUnmounted(stopWatching)

// git or ssh needs a password, passphrase or confirmation; cancel makes the operation fail
const stopAskpass = window.gitspynx.onAskpass(async (id, prompt) => {
  const answer = await ask(prompt.trim(), '', 'OK', isSecretPrompt(prompt))
  void window.gitspynx.askpassReply(id, answer)
})
onUnmounted(stopAskpass)

const headRef = computed(() => repo.info?.refs.find((r) => r.kind === 'local' && r.name === repo.info?.head.branch))

// Pull's ▾ menu (as in GitKraken): fetch, the three pull modes, and which one the button uses.
async function pullMenu() {
  const current = settings.settings.pullMode
  const id = await window.gitspynx.showContextMenu([
    { id: 'fetch', label: 'Fetch (alle Remotes)' },
    { separator: true },
    { id: 'ff-only', label: 'Pull (nur Fast-Forward)' },
    { id: 'rebase', label: 'Pull mit Rebase' },
    { id: 'merge', label: 'Pull mit Merge' },
    { separator: true },
    { id: 'default:ff-only', label: `${current === 'ff-only' ? '✓ ' : ''}Standard: nur Fast-Forward` },
    { id: 'default:rebase', label: `${current === 'rebase' ? '✓ ' : ''}Standard: Rebase` },
    { id: 'default:merge', label: `${current === 'merge' ? '✓ ' : ''}Standard: Merge` }
  ])
  if (id === 'fetch') repo.fetchAll()
  else if (id?.startsWith('default:')) settings.save({ pullMode: id.slice(8) as 'ff-only' })
  else if (id) repo.pullBranch(id as 'ff-only' | 'rebase' | 'merge')
}

// Repository and branch pickers at the left of the toolbar.
async function repoMenu() {
  const others = tabs.tabs.filter((p) => p !== repo.info?.path)
  const id = await window.gitspynx.showContextMenu([
    ...others.map((p) => ({ id: `tab:${p}`, label: p.split(/[\\/]/).pop() ?? p })),
    ...(others.length ? [{ separator: true as const }] : []),
    { id: 'open', label: 'Repository öffnen…' },
    { id: 'close', label: 'Repository schließen' }
  ])
  if (id?.startsWith('tab:')) tabs.activate(tabs.tabs.indexOf(id.slice(4)))
  else if (id === 'open') pick()
  else if (id === 'close') closeRepo()
}
async function branchMenu() {
  const head = repo.info?.head.branch
  const local = (repo.info?.refs ?? []).filter((r) => r.kind === 'local')
  const id = await window.gitspynx.showContextMenu([
    ...local.map((r) => ({ id: `co:${r.name}`, label: `${r.name === head ? '✓ ' : ''}${r.name}`, enabled: r.name !== head })),
    { separator: true },
    { id: 'new', label: 'Neuer Branch hier…' }
  ])
  if (id?.startsWith('co:')) repo.checkoutBranch(id.slice(3))
  else if (id === 'new' && repo.info?.head.sha) repo.createBranch(repo.info.head.sha)
}
const busyLabel = (kind: string, label: string) => (repo.busy === kind ? `${label}…` : label)

async function stashWithMessage() {
  const message = await ask('Stash-Nachricht', '', 'Stashen')
  if (message) repo.stash(message)
}

async function closeRepo() {
  await tabs.closeTab(tabs.active)
  recent.value = await window.gitspynx.recentRepos()
}

async function pick() {
  const path = await window.gitspynx.pickRepo()
  if (path) await tabs.openPath(path)
}

async function deleteWorkspace(name: string) {
  if (await window.gitspynx.confirm(`Workspace „${name}“ löschen?`, 'Die Repositories selbst bleiben unverändert.', 'Workspace löschen'))
    await tabs.deleteWorkspace(name)
}
</script>

<template>
  <TabStrip v-if="!repo.info && tabs.tabs.length" class="welcome-tabs" @add="pick" />
  <div v-if="!repo.info" class="welcome">
    <h1>gitspynx</h1>
    <div class="actions">
      <button :disabled="repo.loading" @click="pick">Repository öffnen…</button>
      <button @click="settingsOpen = true">Einstellungen</button>
    </div>
    <p v-if="repo.error" class="error" role="alert">{{ repo.error }}</p>
    <section v-if="tabs.workspaces.length">
      <h2 class="dim">Workspaces</h2>
      <ul>
        <li v-for="ws in tabs.workspaces" :key="ws.name" class="ws">
          <a href="#" :title="ws.repos.join('\n')" @click.prevent="tabs.openWorkspace(ws)">{{ ws.name }}</a>
          <span class="dim">{{ ws.repos.length }} Repositories</span>
          <button class="del" :aria-label="`Workspace ${ws.name} löschen`" @click="deleteWorkspace(ws.name)">×</button>
        </li>
      </ul>
    </section>
    <section v-if="recent.length">
      <h2 class="dim">Zuletzt geöffnet</h2>
      <ul>
        <li v-for="p in recent" :key="p">
          <a href="#" @click.prevent="tabs.openPath(p)">{{ p }}</a>
        </li>
      </ul>
    </section>
  </div>

  <div v-else class="shell">
    <TabStrip @add="pick" />
    <header class="toolbar">
      <div class="where">
        <button class="picker" title="Repository wechseln, öffnen, schließen" @click="repoMenu">
          <span class="caption">repository</span>
          <span class="value">{{ repo.info.path.split(/[\\/]/).pop() }}<Icon name="chevron" :size="14" /></span>
        </button>
        <Icon name="chevron-right" :size="16" class="dim" />
        <button class="picker" title="Branch wechseln" @click="branchMenu">
          <span class="caption">branch</span>
          <span class="value branch-name">{{ repo.info.head.branch ?? 'detached HEAD' }}<Icon name="chevron" :size="14" /></span>
        </button>
      </div>
      <div class="tools">
        <button class="tool" :disabled="!!repo.busy || repo.undoing || !!repo.info.operation || !repo.undoLabel" :title="repo.undoLabel ? `Rückgängig: ${repo.undoLabel}` : 'Nichts rückgängig zu machen'" aria-label="Rückgängig" @click="repo.undo()">
          <span class="caption">Undo</span><Icon name="undo" :size="20" />
        </button>
        <button class="tool" :disabled="!!repo.busy || repo.undoing || !!repo.info.operation || !repo.redoLabel" :title="repo.redoLabel ? `Wiederholen: ${repo.redoLabel}` : 'Nichts zu wiederholen'" aria-label="Wiederholen" @click="repo.redo()">
          <span class="caption">Redo</span><Icon name="redo" :size="20" />
        </button>
        <span class="split">
          <button class="tool" :disabled="!!repo.busy || !repo.info.head.branch" :title="`Pull (${settings.settings.pullMode === 'ff-only' ? 'nur Fast-Forward' : settings.settings.pullMode === 'rebase' ? 'Rebase' : 'Merge'})`" aria-label="Pull" @click="repo.pullBranch(settings.settings.pullMode)" @contextmenu.prevent="pullMenu">
            <span class="caption">{{ busyLabel('pull', 'Pull') }}</span><Icon name="pull" :size="20" /><span v-if="headRef?.behind" class="badge">{{ headRef.behind }}</span>
          </button>
          <button class="caret" :disabled="!!repo.busy" aria-label="Fetch und Pull-Optionen" title="Fetch und Pull-Optionen" @click="pullMenu"><Icon name="chevron" :size="14" /></button>
        </span>
        <button class="tool" :disabled="!!repo.busy || !repo.info.head.branch" aria-label="Push" @click="repo.pushBranch()">
          <span class="caption">{{ busyLabel('push', 'Push') }}</span><Icon name="push" :size="20" /><span v-if="headRef?.ahead" class="badge">{{ headRef.ahead }}</span>
        </button>
        <button class="tool" :disabled="!!repo.busy || !repo.info.head.sha" title="Neuer Branch am aktuellen Commit" aria-label="Branch" @click="repo.createBranch(repo.info.head.sha!)">
          <span class="caption">Branch</span><Icon name="branch" :size="20" />
        </button>
        <button class="tool" :disabled="!!repo.busy || !repo.status.length" title="Stash (Rechtsklick: mit Nachricht)" aria-label="Stash" @click="repo.stash()" @contextmenu.prevent="stashWithMessage">
          <span class="caption">Stash</span><Icon name="stash" :size="20" />
        </button>
        <button class="tool" :disabled="!!repo.busy || !repo.info.stashes.length" aria-label="Pop" @click="repo.popLatestStash()">
          <span class="caption">Pop</span><Icon name="pop" :size="20" />
        </button>
        <span class="divider" />
        <button class="tool" :class="{ on: terminalOpen }" :aria-pressed="terminalOpen" title="Terminal ein-/ausblenden (Shells laufen weiter)" aria-label="Terminal" @click="terminalOpen = !terminalOpen">
          <span class="caption">Terminal</span><Icon name="terminal" :size="20" />
        </button>
      </div>
      <div class="right">
        <button class="tool" title="Befehlspalette" aria-label="Actions" @click="paletteOpen = true"><span class="caption">Actions</span><Icon name="actions" :size="20" /></button>
        <button class="tool" title="Commits suchen" aria-label="Search" @click="focusSearchRequest++"><span class="caption">Search</span><Icon name="search" :size="20" /></button>
      </div>
    </header>
    <OperationBar />
    <Sidebar class="sidebar" />
    <ConflictView v-if="repo.conflict" class="list" />
    <DiffView v-else-if="repo.diffTarget" class="list" />
    <!-- keyed per repository: search text, commit drafts and amend state never carry over to another tab -->
    <CommitList v-show="!repo.diffTarget && !repo.conflict" :key="repo.info.path" class="list" />
    <WorkdirPanel v-if="repo.selected === WIP" :key="repo.info.path" class="detail" />
    <CommitDetail v-else class="detail" />
    <!-- v-show: hiding the panel keeps the shells running -->
    <TerminalPanel v-show="terminalOpen" :visible="terminalOpen" :pass-key="passKey" />
    <footer class="statusbar">
      <span v-if="repo.error" class="error" role="alert">{{ repo.error }}</span>
      <span v-else-if="repo.notice" class="notice" role="status">{{ repo.notice }}</span>
      <span v-else-if="repo.busy" class="dim">{{ { fetch: 'Fetch läuft…', pull: 'Pull läuft…', push: 'Push läuft…', submodules: 'Submodule werden aktualisiert…', lfs: 'LFS-Dateien werden geholt…' }[repo.busy] }}</span>
      <span class="spacer" />
      <span class="dim">{{ repo.commits.length }}{{ repo.complete ? '' : '+' }} Commits</span>
      <button class="zoom" title="Zoom (Einstellungen)" @click="settingsOpen = true">{{ Math.round(settings.settings.zoom * 100) }} %</button>
    </footer>
  </div>
  <PromptDialog />
  <RebaseDialog />
  <CommandPalette :commands="commands" :shortcuts="keymap.byCommand" />
  <SettingsDialog :commands="commands" />
</template>

<style scoped>
.welcome { max-width: 560px; margin: 0 auto; padding: 15vh 16px 0; }
.welcome h1 { font-weight: 600; letter-spacing: -0.02em; }
.welcome .actions { display: flex; gap: 8px; }
.welcome h2 { font-size: 12px; text-transform: uppercase; margin-top: 32px; }
.welcome ul { list-style: none; padding: 0; }
.welcome li { padding: 4px 0; }
.welcome a { color: var(--accent); text-decoration: none; word-break: break-all; }
.welcome .ws { display: flex; align-items: center; gap: 10px; }
.welcome .del { border: 0; background: none; padding: 0 6px; color: var(--text-dim); }
.welcome .del:hover { color: var(--danger); }
.error { color: var(--danger); }
.notice { color: var(--lane-7); }
.shell {
  display: grid;
  grid-template: 'tabs tabs tabs' auto 'bar bar bar' auto 'op op op' auto 'side list detail' 1fr 'term term term' auto 'status status status' auto / 260px 1fr 360px;
  height: 100%;
}
/* toolbar: pickers left, labelled icon tools in the middle, actions right (GitKraken layout) */
.toolbar {
  grid-area: bar;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
}
.where { display: flex; align-items: center; gap: 4px; min-width: 0; }
.picker { display: flex; flex-direction: column; align-items: flex-start; border: 0; background: none; padding: 2px 8px; border-radius: 6px; min-width: 0; }
.picker:hover { background: var(--bg-hover); }
.picker .caption, .tool .caption { font-size: 11px; color: var(--text-dim); line-height: 14px; }
.picker .value { display: flex; align-items: center; gap: 4px; font-size: 15px; font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tools, .right { display: flex; align-items: center; gap: 2px; }
.right { justify-content: flex-end; }
.tool { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 52px; border: 0; background: none; padding: 3px 8px; border-radius: 6px; color: var(--text); }
.tool:hover:not(:disabled) { background: var(--bg-hover); }
.tool:disabled { opacity: 0.4; cursor: default; }
.tool.on { color: var(--accent); }
.split { display: flex; align-items: flex-end; }
.caret { border: 0; background: none; padding: 4px 2px; margin-left: -8px; border-radius: 4px; color: var(--text-dim); }
.caret:hover:not(:disabled) { background: var(--bg-hover); color: var(--text); }
.badge { position: absolute; top: 14px; right: 6px; min-width: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: #fff; font-size: 10px; line-height: 16px; font-variant-numeric: tabular-nums; }
.divider { width: 1px; height: 32px; background: var(--border); margin: 0 6px; }
.statusbar { grid-area: status; display: flex; align-items: center; gap: 12px; height: 24px; padding: 0 10px; background: var(--bg-titlebar); border-top: 1px solid var(--border); font-size: 12px; min-width: 0; }
.statusbar > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.statusbar .zoom { border: 0; background: none; padding: 0 4px; font-size: 12px; color: var(--text-dim); }
.spacer { flex: 1; }
.sidebar { grid-area: side; }
.list { grid-area: list; }
.detail { grid-area: detail; min-height: 0; }
.list { min-width: 0; min-height: 0; }
</style>
