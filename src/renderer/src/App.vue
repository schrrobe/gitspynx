<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { buildCommands, commandForKey } from './commands'
import CommandPalette from './components/CommandPalette.vue'
import CommitDetail from './components/CommitDetail.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import { comboFromEvent, resolveKeymap } from './keymap'
import { useSettings } from './stores/settings'
import { settingsOpen } from './ui'
import ConflictView from './components/ConflictView.vue'
import CommitList from './components/CommitList.vue'
import DiffView from './components/DiffView.vue'
import OperationBar from './components/OperationBar.vue'
import Sidebar from './components/Sidebar.vue'
import PromptDialog from './components/PromptDialog.vue'
import RebaseDialog from './components/RebaseDialog.vue'
import TabStrip from './components/TabStrip.vue'
import WorkdirPanel from './components/WorkdirPanel.vue'
import { ask } from './prompt'
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
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

// File changes on disk: refs/HEAD changes reload history, work tree/index changes only the status.
const stopWatching = window.gitspynx.onRepoChanged(({ repo: path, kind }) => {
  if (path !== repo.info?.path) return
  if (kind === 'history') repo.refresh()
  else repo.refreshStatus()
})
onUnmounted(stopWatching)

const headRef = computed(() => repo.info?.refs.find((r) => r.kind === 'local' && r.name === repo.info?.head.branch))

async function pullMenu() {
  const mode = await window.gitspynx.showContextMenu([
    { id: 'ff-only', label: 'Pull (nur Fast-Forward)' },
    { id: 'rebase', label: 'Pull mit Rebase' },
    { id: 'merge', label: 'Pull mit Merge' }
  ])
  if (mode) repo.pullBranch(mode as 'ff-only' | 'rebase' | 'merge')
}

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
      <strong>{{ repo.info.path.split('/').pop() }}</strong>
      <span class="dim">{{ repo.info.head.branch ?? 'detached HEAD' }}</span>
      <span class="spacer" />
      <span v-if="repo.error" class="error" role="alert">{{ repo.error }}</span>
      <span v-else-if="repo.notice" class="notice" role="status">{{ repo.notice }}</span>
      <div class="group" role="group" aria-label="Verlauf">
        <button :disabled="!!repo.busy || !repo.undoLabel" :title="repo.undoLabel ? `Rückgängig: ${repo.undoLabel}` : 'Nichts rückgängig zu machen'" aria-label="Rückgängig" @click="repo.undo()">↶</button>
        <button :disabled="!!repo.busy || !repo.redoLabel" :title="repo.redoLabel ? `Wiederholen: ${repo.redoLabel}` : 'Nichts zu wiederholen'" aria-label="Wiederholen" @click="repo.redo()">↷</button>
      </div>
      <div class="group" role="group" aria-label="Remote">
        <button :disabled="!!repo.busy" @click="repo.fetchAll()">{{ repo.busy === 'fetch' ? 'Fetch…' : 'Fetch' }}</button>
        <button :disabled="!!repo.busy || !repo.info.head.branch" title="Rechtsklick: Pull-Modus wählen" @click="repo.pullBranch(settings.settings.pullMode)" @contextmenu.prevent="pullMenu">
          {{ repo.busy === 'pull' ? 'Pull…' : 'Pull' }}<span v-if="headRef?.behind" class="count"> ↓{{ headRef.behind }}</span>
        </button>
        <button :disabled="!!repo.busy || !repo.info.head.branch" @click="repo.pushBranch()">
          {{ repo.busy === 'push' ? 'Push…' : 'Push' }}<span v-if="headRef?.ahead" class="count"> ↑{{ headRef.ahead }}</span>
        </button>
      </div>
      <div class="group" role="group" aria-label="Stash">
        <button :disabled="!!repo.busy || !repo.status.length" title="Rechtsklick: mit Nachricht" @click="repo.stash()" @contextmenu.prevent="stashWithMessage">Stash</button>
        <button :disabled="!!repo.busy || !repo.info.stashes.length" @click="repo.popLatestStash()">Pop</button>
      </div>
      <button @click="repo.refresh()">Aktualisieren</button>
      <button @click="pick">Öffnen…</button>
      <button @click="closeRepo">Schließen</button>
      <button aria-label="Einstellungen" title="Einstellungen" @click="settingsOpen = true">⚙</button>
    </header>
    <OperationBar />
    <Sidebar class="sidebar" />
    <ConflictView v-if="repo.conflict" class="list" />
    <DiffView v-else-if="repo.diffTarget" class="list" />
    <!-- keyed per repository: search text, commit drafts and amend state never carry over to another tab -->
    <CommitList v-show="!repo.diffTarget && !repo.conflict" :key="repo.info.path" class="list" />
    <WorkdirPanel v-if="repo.selected === WIP" :key="repo.info.path" class="detail" />
    <CommitDetail v-else class="detail" />
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
.notice { color: var(--lane-1); }
.shell {
  display: grid;
  grid-template: 'tabs tabs tabs' auto 'bar bar bar' 44px 'op op op' auto 'side list detail' 1fr / 220px 1fr 340px;
  height: 100%;
}
.toolbar {
  grid-area: bar;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.spacer { flex: 1; }
.group { display: flex; }
.group button { border-radius: 0; margin-left: -1px; }
.group button:first-child { border-radius: 6px 0 0 6px; margin-left: 0; }
.group button:last-child { border-radius: 0 6px 6px 0; }
.group button:hover { position: relative; }
.count { color: var(--accent); font-variant-numeric: tabular-nums; }
.sidebar { grid-area: side; }
.list { grid-area: list; }
.detail { grid-area: detail; min-height: 0; }
.list { min-width: 0; min-height: 0; }
</style>
