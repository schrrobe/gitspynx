<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Command } from '../commands'
import { comboFromEvent, displayCombo, normalizeCombo, resolveKeymap } from '../keymap'
import { useSettings } from '../stores/settings'
import { settingsOpen } from '../ui'

const props = defineProps<{ commands: Command[] }>()
const store = useSettings()
const dialog = ref<HTMLDialogElement>()

watch(settingsOpen, (open) => (open ? dialog.value?.showModal() : dialog.value?.close()))

const keymap = computed(() => resolveKeymap(props.commands, store.settings.keymap))
const conflictIds = computed(() => new Set(keymap.value.conflicts.flatMap(([, ids]) => ids)))

// Shortcut fields: typing a combo while focused records it; Backspace clears; Esc leaves.
function record(e: KeyboardEvent, c: Command) {
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) return // keep keyboard navigation
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') return (e.target as HTMLElement).blur()
  if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey) return setKey(c, '')
  const combo = comboFromEvent(e)
  if (combo) setKey(c, combo)
}

function setKey(c: Command, combo: string) {
  const next = { ...store.settings.keymap }
  const defaults = [c.keys ?? []].flat()
  if (defaults.length === 1 && combo === normalizeCombo(defaults[0])) delete next[c.id]
  else next[c.id] = combo
  store.save({ keymap: next })
}

function resetKey(c: Command) {
  const next = { ...store.settings.keymap }
  delete next[c.id]
  store.save({ keymap: next })
}
</script>

<template>
  <dialog ref="dialog" class="settings" aria-label="Einstellungen" @cancel.prevent="settingsOpen = false" @close="settingsOpen = false">
    <header>
      <h2>Einstellungen</h2>
      <button @click="settingsOpen = false">Fertig</button>
    </header>
    <section class="grid">
      <label for="set-theme">Theme</label>
      <select id="set-theme" :value="store.settings.theme" @change="store.save({ theme: ($event.target as HTMLSelectElement).value as 'system' })">
        <option value="system">Wie System</option>
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
      </select>
      <label for="set-zoom">Zoom</label>
      <select id="set-zoom" :value="store.settings.zoom" @change="store.save({ zoom: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="z in [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]" :key="z" :value="z">{{ Math.round(z * 100) }} %</option>
      </select>
      <label for="set-pull">Pull-Button</label>
      <select id="set-pull" :value="store.settings.pullMode" @change="store.save({ pullMode: ($event.target as HTMLSelectElement).value as 'ff-only' })">
        <option value="ff-only">Nur Fast-Forward</option>
        <option value="rebase">Rebase</option>
        <option value="merge">Merge</option>
      </select>
    </section>
    <h3>Tastenkürzel</h3>
    <p class="dim hint">In ein Feld klicken und die neue Kombination drücken. Rücktaste entfernt das Kürzel.</p>
    <table>
      <tbody>
        <tr v-for="c in commands" :key="c.id">
          <td>{{ c.title }}</td>
          <td>
            <input
              class="combo"
              :class="{ conflict: conflictIds.has(c.id) }"
              :value="keymap.byCommand.get(c.id) ? displayCombo(keymap.byCommand.get(c.id)!) : ''"
              :aria-label="`Tastenkürzel für ${c.title}`"
              placeholder="–"
              readonly
              @keydown="record($event, c)"
            />
          </td>
          <td>
            <button v-if="c.id in store.settings.keymap" class="reset" :aria-label="`${c.title}: Standard wiederherstellen`" @click="resetKey(c)">
              Standard
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="keymap.conflicts.length" class="warn">Rot markierte Kürzel sind doppelt belegt; es gilt jeweils der erste Befehl.</p>
  </dialog>
</template>

<style scoped>
.settings {
  width: min(640px, calc(100vw - 32px));
  max-height: 80vh;
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.35);
}
.settings::backdrop { background: rgb(0 0 0 / 0.3); }
header { display: flex; justify-content: space-between; align-items: center; }
h2 { font-size: 16px; margin: 0; }
h3 { font-size: 12px; text-transform: uppercase; margin: 20px 0 4px; }
.grid { display: grid; grid-template-columns: 140px 220px; gap: 8px 12px; align-items: center; margin-top: 16px; }
select, .combo {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
}
.hint { margin: 0 0 8px; font-size: 12px; }
table { width: 100%; border-collapse: collapse; }
td { padding: 3px 4px; }
td:first-child { width: 60%; }
.combo { width: 140px; cursor: pointer; font-family: ui-monospace, Menlo, monospace; }
.combo:focus { outline: none; border-color: var(--accent); }
.combo.conflict { border-color: var(--danger); color: var(--danger); }
.reset { padding: 1px 8px; font-size: 12px; }
.warn { color: var(--danger); font-size: 12px; }
</style>
