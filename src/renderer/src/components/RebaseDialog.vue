<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RebaseAction } from '../../../shared/types'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const dialog = ref<HTMLDialogElement>()
// Newest first like the graph; git gets the reverse (oldest first).
const rows = ref<{ sha: string; subject: string; action: RebaseAction; message: string }[]>([])

const ACTIONS: { value: RebaseAction; label: string }[] = [
  { value: 'pick', label: 'Übernehmen' },
  { value: 'reword', label: 'Nachricht ändern' },
  { value: 'edit', label: 'Bearbeiten (hier anhalten)' },
  { value: 'squash', label: 'Squash (mit vorherigem, Nachrichten zusammen)' },
  { value: 'fixup', label: 'Fixup (mit vorherigem, Nachricht verwerfen)' },
  { value: 'drop', label: 'Verwerfen' }
]

watch(
  () => repo.rebasePlan,
  (plan) => {
    if (!plan) return dialog.value?.close()
    rows.value = [...plan.commits].reverse().map((c) => ({ sha: c.sha, subject: c.subject, action: 'pick', message: c.message }))
    dialog.value?.showModal()
  }
)

function moveTo(from: number, to: number) {
  if (to < 0 || to >= rows.value.length || from === to) return
  const next = [...rows.value]
  next.splice(to, 0, ...next.splice(from, 1))
  rows.value = next
}
const move = (i: number, delta: number) => moveTo(i, i + delta)

// Drag & drop reordering (the ↑/↓ buttons do the same by keyboard).
const dragFrom = ref<number | null>(null)
const dragOver = ref<number | null>(null)
function drop(i: number) {
  if (dragFrom.value !== null) moveTo(dragFrom.value, i)
  dragFrom.value = dragOver.value = null
}

// Same checks main does, shown before starting.
const problem = computed(() => {
  const oldestKept = [...rows.value].reverse().find((r) => r.action !== 'drop')
  if (oldestKept && (oldestKept.action === 'squash' || oldestKept.action === 'fixup'))
    return 'Der älteste übernommene Commit kann nicht mit einem vorherigen zusammengeführt werden.'
  if (rows.value.some((r) => r.action === 'reword' && !r.message.trim())) return 'Eine geänderte Nachricht darf nicht leer sein.'
  if (rows.value.every((r) => r.action === 'drop')) return 'Alle Commits zu verwerfen ist ein Reset, kein Rebase.'
  return null
})

// With an upstream, the commits beyond "ahead" are already on the remote.
const pushed = computed(() => {
  const head = repo.info?.refs.find((r) => r.kind === 'local' && r.name === repo.info?.head.branch)
  return !!head?.upstream && rows.value.length > (head.ahead ?? 0)
})

function start() {
  if (problem.value) return
  repo.startRebase(
    [...rows.value].reverse().map((r) => ({ sha: r.sha, action: r.action, ...(r.action === 'reword' ? { message: r.message } : {}) }))
  )
}

function cancel() {
  repo.rebasePlan = null
}
</script>

<template>
  <dialog ref="dialog" class="rebase" aria-label="Interaktiver Rebase" @cancel.prevent="cancel">
    <header>
      <h2>Interaktiver Rebase</h2>
      <span class="dim">{{ rows.length }} Commits auf {{ repo.rebasePlan?.base.slice(0, 7) }} neu anwenden</span>
    </header>
    <p class="dim hint">Neuester oben. Zum Umsortieren ziehen oder ↑/↓ nutzen. Squash und Fixup fassen einen Commit mit dem darunter liegenden zusammen; „Bearbeiten" hält danach an.</p>
    <ol>
      <li
        v-for="(r, i) in rows"
        :key="r.sha"
        :class="{ dropped: r.action === 'drop', dragging: dragFrom === i, over: dragOver === i && dragFrom !== i }"
        draggable="true"
        @dragstart="dragFrom = i"
        @dragover.prevent="dragOver = i"
        @dragleave="dragOver === i && (dragOver = null)"
        @drop.prevent="drop(i)"
        @dragend="dragFrom = dragOver = null"
      >
        <span class="grip" aria-hidden="true" title="Ziehen zum Umsortieren">⠿</span>
        <div class="order">
          <button :disabled="i === 0" :aria-label="`${r.subject} nach oben`" @click="move(i, -1)">↑</button>
          <button :disabled="i === rows.length - 1" :aria-label="`${r.subject} nach unten`" @click="move(i, 1)">↓</button>
        </div>
        <select v-model="r.action" :aria-label="`Aktion für ${r.subject}`">
          <option v-for="a in ACTIONS" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
        <div class="text">
          <textarea v-if="r.action === 'reword'" v-model="r.message" rows="3" :aria-label="`Neue Nachricht für ${r.subject}`" />
          <span v-else class="subject">{{ r.subject }}</span>
          <span class="sha mono dim">{{ r.sha.slice(0, 7) }}</span>
        </div>
      </li>
    </ol>
    <p v-if="pushed" class="dim hint">Einige dieser Commits sind schon gepusht; danach ist ein Force-Push nötig.</p>
    <p v-if="problem" class="warn" role="alert">{{ problem }}</p>
    <p v-else-if="repo.error" class="warn" role="alert">{{ repo.error }}</p>
    <footer>
      <button @click="cancel">Abbrechen</button>
      <button class="primary" :disabled="!!problem" @click="start">Rebase starten</button>
    </footer>
  </dialog>
</template>

<style scoped>
.rebase {
  width: min(760px, calc(100vw - 32px));
  max-height: 85vh;
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  color: var(--text);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.35);
}
.rebase::backdrop { background: rgb(0 0 0 / 0.3); }
header { display: flex; align-items: baseline; gap: 12px; }
h2 { font-size: 16px; margin: 0; }
.hint { font-size: 12px; margin: 6px 0 10px; }
ol { list-style: none; margin: 0; padding: 0; max-height: 55vh; overflow-y: auto; }
li { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); }
li.dropped .subject { text-decoration: line-through; opacity: 0.5; }
li.dragging { opacity: 0.4; }
li.over { box-shadow: inset 0 2px 0 var(--accent); }
.grip { cursor: grab; color: var(--text-dim); padding: 0 2px; }
.order { display: flex; gap: 2px; }
.order button { padding: 0 6px; }
select, textarea {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
}
select { width: 190px; }
.text { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.text textarea { flex: 1; resize: vertical; font-family: inherit; }
.subject { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.warn { color: var(--danger); font-size: 12px; }
footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.primary:disabled { opacity: 0.45; }
</style>
