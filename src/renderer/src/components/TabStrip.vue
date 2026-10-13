<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { ask } from '../prompt'
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
  <div class="strip">
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
          <span v-if="repo.backgroundErrors.has(path)" class="failed" aria-label="Fehler" />{{ labels[i] }}
        </button>
        <button class="close" tabindex="-1" aria-hidden="true" :aria-label="`${labels[i]} schließen`" @click="tabs.closeTab(i)">×</button>
      </div>
    </div>
    <button class="add" aria-label="Repository öffnen" title="Repository öffnen" @click="emit('add')">+</button>
    <span class="spacer" />
    <button v-if="tabs.tabs.length > 1" class="ws" @click="saveWorkspace">Als Workspace speichern…</button>
  </div>
</template>

<style scoped>
.strip { grid-area: tabs; display: flex; align-items: flex-end; gap: 2px; padding: 4px 8px 0; background: var(--bg); border-bottom: 1px solid var(--border); min-width: 0; }
/* scrolls on its own so + stays reachable; 1px overlap lets the active tab cover the border */
.tabs { display: flex; align-items: flex-end; gap: 2px; min-width: 0; overflow-x: auto; overflow-y: hidden; margin-bottom: -1px; scrollbar-width: none; }
.tab {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  max-width: 220px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  color: var(--text-dim);
}
.tab:hover { background: var(--bg-hover); }
.tab.active { background: var(--bg-panel); border-color: var(--border); color: var(--text); padding-bottom: 1px; }
.label { border: 0; background: none; color: inherit; padding: 4px 4px 4px 12px; cursor: default; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.failed { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--danger); margin-right: 6px; vertical-align: 1px; }
.close { border: 0; background: none; padding: 0 6px 0 4px; line-height: 1; color: inherit; visibility: hidden; }
.tab:hover .close, .tab.active .close { visibility: visible; }
.close:hover { color: var(--danger); }
.add { flex-shrink: 0; border: 0; background: none; padding: 2px 8px; font-size: 16px; line-height: 1; margin-bottom: 3px; }
.spacer { flex: 1; }
.ws { flex-shrink: 0; padding: 1px 8px; font-size: 12px; margin-bottom: 4px; }
</style>
