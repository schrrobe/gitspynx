<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Command } from '../commands'
import { displayCombo } from '../keymap'
import { fuzzyRank } from '../palette'
import { useRepo } from '../stores/repo'
import { useTabs } from '../stores/tabs'
import { paletteOpen } from '../ui'

const props = defineProps<{ commands: Command[]; shortcuts: Map<string, string> }>()
const repo = useRepo()
const tabs = useTabs()
const dialog = ref<HTMLDialogElement>()
const input = ref<HTMLInputElement>()
const query = ref('')
const cursor = ref(0)

interface Entry {
  key: string
  title: string
  hint?: string
  run: () => unknown
}

// Commands plus one "Checkout" entry per branch of the open repository and one per workspace.
const entries = computed<Entry[]>(() => [
  ...props.commands
    .filter((c) => c.id !== 'palette.open' && (c.enabled?.() ?? true))
    .map((c) => ({ key: c.id, title: c.title, hint: props.shortcuts.get(c.id), run: c.run })),
  ...(repo.info?.refs ?? [])
    // a remote copy of the current branch would just switch to it again
    .filter((r) => (r.kind === 'local' || r.kind === 'remote') && (r.kind === 'local' ? r.name : r.name.split('/').slice(1).join('/')) !== repo.info?.head.branch)
    .map((r) => ({ key: r.fullName, title: `Checkout: ${r.name}`, run: () => repo.checkoutBranch(r.name) })),
  ...tabs.workspaces.map((w) => ({ key: `workspace:${w.name}`, title: `Workspace öffnen: ${w.name}`, run: () => tabs.openWorkspace(w) }))
])
const results = computed(() => fuzzyRank(entries.value, query.value, (e) => e.title).slice(0, 50))
watch(results, () => (cursor.value = 0))
watch(cursor, async (i) => {
  await nextTick()
  document.getElementById(`palette-${i}`)?.scrollIntoView({ block: 'nearest' })
})

watch(paletteOpen, async (open) => {
  if (!open) return dialog.value?.close()
  query.value = ''
  dialog.value?.showModal()
  await nextTick()
  input.value?.focus()
})

function close() {
  paletteOpen.value = false
}

function run(entry: Entry | undefined) {
  if (!entry) return
  close()
  entry.run()
}

function onEnter(e: KeyboardEvent) {
  if (e.isComposing) return // IME confirming a character
  e.preventDefault()
  run(results.value[cursor.value])
}

function move(delta: number) {
  const n = results.value.length
  if (n) cursor.value = (cursor.value + delta + n) % n
}
</script>

<template>
  <dialog ref="dialog" class="palette" aria-label="Befehlspalette" @cancel.prevent="close" @click.self="close">
    <input
      ref="input"
      v-model="query"
      placeholder="Befehl oder Branch suchen…"
      aria-label="Befehl suchen"
      role="combobox"
      aria-expanded="true"
      aria-controls="palette-list"
      :aria-activedescendant="results[cursor] ? `palette-${cursor}` : undefined"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter="onEnter"
    />
    <ul id="palette-list" role="listbox">
      <li
        v-for="(e, i) in results"
        :id="`palette-${i}`"
        :key="e.key"
        role="option"
        :aria-selected="i === cursor"
        :class="{ active: i === cursor }"
        @mousemove="cursor = i"
        @click="run(e)"
      >
        <span>{{ e.title }}</span>
        <kbd v-if="e.hint">{{ displayCombo(e.hint) }}</kbd>
      </li>
    </ul>
    <p v-if="!results.length" class="empty dim" role="status">Nichts gefunden</p>
  </dialog>
</template>

<style scoped>
.palette {
  margin-top: 12vh;
  width: min(560px, calc(100vw - 32px));
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.35);
}
.palette::backdrop { background: rgb(0 0 0 / 0.25); }
input {
  width: 100%;
  font: inherit;
  font-size: 15px;
  padding: 12px 14px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  outline: none;
}
ul { list-style: none; margin: 0; padding: 4px; max-height: 50vh; overflow-y: auto; }
li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; border-radius: 6px; cursor: default; }
li.active { background: var(--bg-selected); }
kbd { font: 12px ui-monospace, Menlo, monospace; color: var(--text-dim); }
.empty { text-align: center; margin: 0; padding: 6px 10px 10px; }
</style>
