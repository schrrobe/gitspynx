<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { isMac } from '../keymap'
import { ask } from '../prompt'
import { settingsOpen } from '../ui'
import Icon from './Icon.vue'
import { useRepo } from '../stores/repo'
import { tabLabels, useTabs } from '../stores/tabs'

const emit = defineEmits<{ add: [] }>()
const tabs = useTabs()
const repo = useRepo()
const labels = computed(() => tabLabels(tabs.tabs))
const els: (HTMLButtonElement | null)[] = [] // by tab index

// The active tab stays visible when tabs overflow.
watch(
  () => [tabs.active, tabs.tabs.length],
  async () => {
    await nextTick()
    els[tabs.active]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
)

// Arrow keys move focus between tabs (Enter/Space activates), Delete closes the focused tab.
function onKey(e: KeyboardEvent, i: number) {
  const n = tabs.tabs.length
  const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key]
  if (to !== undefined) {
    e.preventDefault()
    els[(to + n) % n]?.focus()
  } else if (e.key === 'Delete') {
    e.preventDefault()
    void tabs.closeTab(i).then(() => els[tabs.active]?.focus()) // keep keyboard focus in the strip
  }
}

async function saveWorkspace() {
  const n = await ask('Offene Tabs als Workspace speichern', '', 'Speichern')
  if (n) await tabs.saveWorkspace(n)
}
</script>

<template>
  <div class="strip" :class="{ mac: isMac }">
    <div class="tabs" role="tablist" aria-label="Offene Repositories">
      <div
        v-for="(path, i) in tabs.tabs"
        :key="path"
        class="tab"
        :class="{ active: i === tabs.active }"
        :title="repo.backgroundErrors.has(path) ? `${path}\nFehler: ${repo.backgroundErrors.get(path)}` : path"
        @auxclick.middle="tabs.closeTab(i)"
      >
        <button
          :ref="(el) => el && (els[i] = el as HTMLButtonElement)"
          class="label"
          role="tab"
          :aria-selected="i === tabs.active"
          :tabindex="i === tabs.active ? 0 : -1"
          aria-keyshortcuts="Delete"
          @click="tabs.activate(i)"
          @keydown="onKey($event, i)"
        >
          <Icon name="branch" :size="14" class="repo-icon" /><span v-if="repo.backgroundErrors.has(path)" class="failed" aria-label="Fehler" />{{ labels[i] }}
        </button>
        <button class="close" tabindex="-1" aria-hidden="true" :aria-label="`${labels[i]} schließen`" @click="tabs.closeTab(i)">×</button>
      </div>
    </div>
    <button class="add" aria-label="Repository öffnen" title="Repository öffnen" @click="emit('add')"><Icon name="plus" :size="16" /></button>
    <span class="spacer" />
    <button v-if="tabs.tabs.length > 1" class="ws" @click="saveWorkspace">Als Workspace speichern…</button>
    <button class="gear" aria-label="Einstellungen" title="Einstellungen" @click="settingsOpen = true"><Icon name="settings" :size="17" /></button>
  </div>
</template>

<style scoped>
/* the darkest bar; on macOS it is the window's title bar (draggable, room for the traffic lights) */
.strip { grid-area: tabs; display: flex; align-items: stretch; height: 38px; background: var(--bg-titlebar); border-bottom: 1px solid var(--border); min-width: 0; padding-right: 6px; }
.strip.mac { padding-left: 78px; -webkit-app-region: drag; }
.strip button, .tab { -webkit-app-region: no-drag; }
.tabs { display: flex; align-items: stretch; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.tab {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  max-width: 190px;
  border-right: 1px solid var(--border);
  color: var(--text-dim);
}
.tab:hover { background: var(--bg-hover); color: var(--text); }
.tab.active { background: var(--bg-toolbar); color: var(--text); box-shadow: inset 0 2px 0 var(--accent); }
.label { display: flex; align-items: center; gap: 7px; border: 0; background: none; color: inherit; padding: 0 6px 0 14px; height: 100%; cursor: default; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.repo-icon { flex: none; opacity: 0.7; }
.close { border: 0; background: none; padding: 0 10px 0 4px; line-height: 1; color: inherit; visibility: hidden; font-size: 15px; }
.tab:hover .close, .tab.active .close { visibility: visible; }
.close:hover { color: var(--danger); }
.failed { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); flex: none; }
.add, .gear { flex-shrink: 0; display: flex; align-items: center; border: 0; background: none; padding: 0 10px; color: var(--text-dim); }
.add:hover, .gear:hover { color: var(--text); }
.spacer { flex: 1; }
.ws { flex-shrink: 0; align-self: center; padding: 2px 8px; font-size: 12px; }
</style>
