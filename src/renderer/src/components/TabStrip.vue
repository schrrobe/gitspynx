<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { ask } from '../prompt'
import { useTabs } from '../stores/tabs'

const emit = defineEmits<{ add: [] }>()
const tabs = useTabs()
const name = (path: string) => path.split(/[\\/]/).pop()

async function saveWorkspace() {
  const n = await ask('Offene Tabs als Workspace speichern', '', 'Speichern')
  if (n) await tabs.saveWorkspace(n)
}

// Ctrl+Tab / Ctrl+Shift+Tab cycle through tabs
const onKey = (e: KeyboardEvent) => {
  if (!e.ctrlKey || e.key !== 'Tab' || tabs.tabs.length < 2) return
  e.preventDefault()
  const n = tabs.tabs.length
  tabs.activate((tabs.active + (e.shiftKey ? n - 1 : 1)) % n)
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="strip" role="tablist" aria-label="Offene Repositories">
    <div
      v-for="(path, i) in tabs.tabs"
      :key="path"
      class="tab"
      role="tab"
      :aria-selected="i === tabs.active"
      :class="{ active: i === tabs.active }"
      :title="path"
      tabindex="0"
      @click="tabs.activate(i)"
      @keydown.enter="tabs.activate(i)"
      @auxclick.middle="tabs.closeTab(i)"
    >
      <span class="label">{{ name(path) }}</span>
      <button class="close" :aria-label="`${name(path)} schließen`" @click.stop="tabs.closeTab(i)">×</button>
    </div>
    <button class="add" aria-label="Repository öffnen" title="Repository öffnen" @click="emit('add')">+</button>
    <span class="spacer" />
    <button v-if="tabs.tabs.length > 1" class="ws" @click="saveWorkspace">Als Workspace speichern…</button>
  </div>
</template>

<style scoped>
.strip { grid-area: tabs; display: flex; align-items: flex-end; gap: 2px; padding: 4px 8px 0; background: var(--bg); border-bottom: 1px solid var(--border); min-width: 0; overflow-x: auto; }
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 4px 6px 4px 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  color: var(--text-dim);
  cursor: default;
}
.tab:hover { background: var(--bg-hover); }
.tab.active { background: var(--bg-panel); border-color: var(--border); color: var(--text); margin-bottom: -1px; padding-bottom: 5px; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.close { border: 0; background: none; padding: 0 4px; line-height: 1; color: inherit; visibility: hidden; }
.tab:hover .close, .tab.active .close, .close:focus-visible { visibility: visible; }
.close:hover { color: var(--danger); }
.add { border: 0; background: none; padding: 2px 8px; font-size: 16px; line-height: 1; margin-bottom: 3px; }
.spacer { flex: 1; }
.ws { padding: 1px 8px; font-size: 12px; margin-bottom: 4px; }
</style>
