<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { hunkKey } from '../../../shared/hunk'
import { keepSelection, type LineSelection } from '../diffSelection'
import { useRepo } from '../stores/repo'

const MAX_LINES = 5000 // ponytail: plain DOM rows, virtualize like CommitList if huge diffs matter
const repo = useRepo()

const title = computed(() => {
  const t = repo.diffTarget
  if (!t) return ''
  return 'sha' in t ? `${t.path} @ ${t.sha.slice(0, 7)}` : `${t.path} (${t.staged ? 'gestaged' : 'nicht gestaged'})`
})
const total = computed(() => repo.diff?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0)
const hunks = computed(() => {
  let left = MAX_LINES
  return (repo.diff?.hunks ?? []).map((h) => {
    const lines = h.lines.slice(0, Math.max(0, left))
    left -= lines.length
    return { header: h.header, lines }
  })
})

// Hunk/line staging for working-directory diffs of tracked files.
const stageable = computed(() => {
  const t = repo.diffTarget
  if (!t || 'sha' in t || repo.diff?.binary) return false
  return repo.status.find((f) => f.path === t.path)?.unstaged !== '?'
})
// Added, deleted and renamed files are staged as a whole (no line selection).
const lineSelectable = computed(() => {
  const t = repo.diffTarget
  if (!stageable.value || !t || 'sha' in t) return false
  if (repo.diff?.header.some((h) => /^(new|deleted) file mode/.test(h))) return false
  return !(t.staged && repo.status.find((f) => f.path === t.path)?.oldPath)
})
const staged = computed(() => !!repo.diffTarget && !('sha' in repo.diffTarget) && repo.diffTarget.staged)
const selection = ref<LineSelection | null>(null)
let anchor = -1
watch(() => repo.diff, (next, prev) => (selection.value = keepSelection(selection.value, prev, next)))

function toggleLine(hunk: number, line: number, type: string, range: boolean) {
  if (!lineSelectable.value || type === ' ') return
  const current = selection.value?.hunk === hunk ? new Set(selection.value.lines) : new Set<number>()
  if (range && anchor !== -1 && selection.value?.hunk === hunk) {
    const lines = repo.diff!.hunks[hunk].lines
    for (let i = Math.min(anchor, line); i <= Math.max(anchor, line); i++) if (lines[i].type !== ' ') current.add(i)
  } else if (!current.delete(line)) current.add(line)
  anchor = line
  selection.value = current.size ? { hunk, lines: current } : null
}

function stageHunk(hunk: number, onlySelected: boolean) {
  const h = repo.diff!.hunks[hunk]
  const lines = onlySelected && selection.value?.hunk === hunk ? [...selection.value.lines] : undefined
  repo.stageHunk({ hunk, hunkHeader: h.header, hunkLines: hunkKey(h), lines })
}

// Esc closes the diff unless it belongs to a dialog or a text field.
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if ((e.target as HTMLElement | null)?.closest('input, textarea, dialog')) return
  repo.closeDiff()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <section class="diff" aria-label="Diff">
    <header>
      <strong class="mono">{{ title }}</strong>
      <button aria-label="Diff schließen (Esc)" @click="repo.closeDiff()">Schließen</button>
    </header>
    <div v-if="!repo.diff" class="note dim">Lade…</div>
    <div v-else-if="repo.diff.binary" class="note dim">Binärdatei – kein Text-Diff.</div>
    <div v-else-if="!repo.diff.hunks.length" class="note dim">Keine Änderungen.</div>
    <div v-else class="body mono">
      <template v-for="(h, i) in hunks" :key="i">
        <div class="hunk">
          <span class="dim">{{ h.header }}</span>
          <template v-if="stageable">
            <button v-if="selection?.hunk === i" :disabled="!!repo.busy" @click="stageHunk(i, true)">
              {{ staged ? 'Zeilen unstagen' : 'Zeilen stagen' }} ({{ selection.lines.size }})
            </button>
            <button :disabled="!!repo.busy" @click="stageHunk(i, false)">{{ staged ? 'Hunk unstagen' : 'Hunk stagen' }}</button>
          </template>
        </div>
        <div
          v-for="(l, j) in h.lines"
          :key="j"
          class="line"
          :class="{ add: l.type === '+', del: l.type === '-', pickable: lineSelectable && l.type !== ' ', picked: selection?.hunk === i && selection.lines.has(j) }"
          @click="toggleLine(i, j, l.type, $event.shiftKey)"
        >
          <span class="no">{{ l.oldNo ?? '' }}</span>
          <span class="no">{{ l.newNo ?? '' }}</span>
          <span class="sign">{{ l.type === ' ' ? '' : l.type }}</span>
          <span class="text">{{ l.text }}</span>
        </div>
      </template>
      <div v-if="total > MAX_LINES" class="note dim">{{ total - MAX_LINES }} weitere Zeilen ausgeblendet.</div>
    </div>
  </section>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; min-height: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; overflow: auto; user-select: text; line-height: 20px; }
.hunk { display: flex; align-items: center; gap: 8px; padding: 3px 12px; background: var(--bg-panel); border-block: 1px solid var(--border); }
.hunk span { flex: 1; }
.hunk button { padding: 0 8px; font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.line.pickable { cursor: pointer; }
.line.picked { box-shadow: inset 3px 0 0 var(--accent); filter: brightness(1.12); }
.line { display: flex; white-space: pre; min-width: max-content; }
.line.add { background: color-mix(in srgb, var(--lane-2) 16%, transparent); }
.line.del { background: color-mix(in srgb, var(--danger) 16%, transparent); }
.no { width: 48px; flex: none; text-align: right; padding-right: 8px; color: var(--text-dim); user-select: none; }
.sign { width: 16px; flex: none; text-align: center; user-select: none; }
.text { padding-right: 16px; }
.note { padding: 16px; }
</style>
