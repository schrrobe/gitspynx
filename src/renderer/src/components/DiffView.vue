<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { hunkKey } from '../../../shared/hunk'
import { offsetOf, rowIndex, visibleRows } from '../diffRows'
import { keepSelection, type LinePos, type LineSelection, moveCursor, selectRange, toggleLine } from '../diffSelection'
import { useRepo } from '../stores/repo'

const repo = useRepo()

const title = computed(() => {
  const t = repo.diffTarget
  if (!t) return ''
  return 'sha' in t ? `${t.path} @ ${t.sha.slice(0, 7)}` : `${t.path} (${t.staged ? 'gestaged' : 'nicht gestaged'})`
})
// Virtualized like the commit list: only the rows in view exist in the DOM, any diff size works.
const body = ref<HTMLElement>()
const scrollTop = ref(0)
const viewHeight = ref(600)
const index = computed(() => rowIndex((repo.diff?.hunks ?? []).map((h) => h.lines.length)))
const rows = computed(() => visibleRows(index.value, Math.max(0, scrollTop.value - 200), viewHeight.value + 400))
function onScroll() {
  scrollTop.value = body.value?.scrollTop ?? 0
  viewHeight.value = body.value?.clientHeight ?? viewHeight.value
}
const resize = new ResizeObserver(onScroll)
watch(body, (el, old) => {
  if (old) resize.unobserve(old)
  if (el) resize.observe(el)
})
watch(() => repo.diffTarget, () => body.value && (body.value.scrollTop = 0)) // another file: start at the top
function ensureVisible(pos: LinePos) {
  const el = body.value
  if (!el) return
  const top = offsetOf(index.value, pos)
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + 18 > el.scrollTop + el.clientHeight) el.scrollTop = top + 18 - el.clientHeight
}

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
const selection = ref<LineSelection>(new Map())
const anchor = ref<LinePos | null>(null) // last clicked/toggled line, start of Shift ranges
const cursor = ref<LinePos | null>(null) // keyboard position
watch(
  () => repo.diff,
  (next, prev) => {
    selection.value = keepSelection(selection.value, prev, next)
    if (!selection.value.size) anchor.value = cursor.value = null
  }
)
const selectedCount = computed(() => [...selection.value.values()].reduce((n, s) => n + s.size, 0))
const isPicked = (hunk: number, line: number) => selection.value.get(hunk)?.has(line) ?? false
const lineId = (p: LinePos) => `diff-line-${p.hunk}-${p.line}`

// Click toggles a line; Shift-click adds every changed line from the last one, across hunks.
function pick(pos: LinePos, range: boolean) {
  if (!lineSelectable.value || !repo.diff || repo.diff.hunks[pos.hunk].lines[pos.line].type === ' ') return
  selection.value = range && anchor.value ? selectRange(selection.value, repo.diff, anchor.value, pos) : toggleLine(selection.value, repo.diff, pos.hunk, pos.line)
  anchor.value = cursor.value = pos
}

// Keyboard: ↑/↓ move over changed lines, Shift extends, Space toggles, Enter stages the selection.
function onBodyKey(e: KeyboardEvent) {
  if (!lineSelectable.value || !repo.diff || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const next = moveCursor(repo.diff, cursor.value, e.key === 'ArrowDown' ? 1 : -1)
    if (!next) return
    if (e.shiftKey) selection.value = selectRange(selection.value, repo.diff, anchor.value ?? cursor.value ?? next, next)
    if (!e.shiftKey || !anchor.value) anchor.value = e.shiftKey ? (cursor.value ?? next) : next
    cursor.value = next
    ensureVisible(next)
  } else if (e.key === ' ' && cursor.value) pick(cursor.value, false)
  else if (e.key === 'Enter' && selectedCount.value) void stageSelected()
  else return
  e.preventDefault()
  e.stopPropagation()
}

const selectionAsHunks = () => {
  const d = repo.diff!
  return [...selection.value].map(([hunk, lines]) => ({ hunk, hunkHeader: d.hunks[hunk].header, hunkLines: hunkKey(d.hunks[hunk]), lines: [...lines] }))
}
function discardHunk(hunk: number) {
  const h = repo.diff!.hunks[hunk]
  void repo.discardHunks([{ hunk, hunkHeader: h.header, hunkLines: hunkKey(h) }])
}

function stageHunk(hunk: number) {
  const h = repo.diff!.hunks[hunk]
  repo.stageHunk({ hunk, hunkHeader: h.header, hunkLines: hunkKey(h) })
}

// Bottom-up: staging a hunk leaves the headers of the hunks above it unchanged, so each later
// call still matches what main reads.
async function stageSelected() {
  const diff = repo.diff
  if (!diff) return
  for (const [hunk, lines] of [...selection.value].sort(([a], [b]) => b - a)) {
    const h = diff.hunks[hunk]
    await repo.stageHunk({ hunk, hunkHeader: h.header, hunkLines: hunkKey(h), lines: [...lines] })
    if (repo.error) return
  }
}

// Esc closes the diff unless it belongs to a dialog or a text field.
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if ((e.target as HTMLElement | null)?.closest('input, textarea, dialog')) return
  repo.closeDiff()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  resize.disconnect()
})
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
    <template v-else>
      <div v-if="lineSelectable && selectedCount" class="selbar">
        <span>{{ selectedCount }} {{ selectedCount === 1 ? 'Zeile' : 'Zeilen' }} markiert</span>
        <button :disabled="!!repo.busy" @click="stageSelected">{{ staged ? 'Markierte unstagen' : 'Markierte stagen' }} (Enter)</button>
        <button v-if="!staged" class="danger" :disabled="!!repo.busy" @click="repo.discardHunks(selectionAsHunks())">Markierte verwerfen…</button>
        <button @click="selection = new Map()">Auswahl aufheben</button>
      </div>
      <div
        ref="body"
        class="body mono"
        :tabindex="lineSelectable ? 0 : -1"
        :aria-label="lineSelectable ? 'Diff – ↑/↓ wählt eine geänderte Zeile, Shift erweitert, Leertaste markiert, Enter stagt die markierten Zeilen' : 'Diff'"
        :aria-activedescendant="cursor ? lineId(cursor) : undefined"
        @scroll.passive="onScroll"
        @keydown="onBodyKey"
        @focus="!cursor && repo.diff && (cursor = moveCursor(repo.diff, null, 1))"
      >
        <div class="spacer" :style="{ height: `${index.total}px` }">
          <template v-for="r in rows" :key="`${r.hunk}:${r.line}`">
            <div v-if="r.line < 0" class="hunk" :style="{ top: `${r.top}px` }">
              <span class="dim">{{ repo.diff.hunks[r.hunk].header }}</span>
              <button v-if="stageable && !staged" class="danger" :disabled="!!repo.busy" title="Änderungen dieses Hunks im Arbeitsverzeichnis verwerfen" @click="discardHunk(r.hunk)">Verwerfen…</button>
              <button v-if="stageable" :disabled="!!repo.busy" @click="stageHunk(r.hunk)">{{ staged ? 'Hunk unstagen' : 'Hunk stagen' }}</button>
            </div>
            <div
              v-else
              :id="lineId(r)"
              class="line"
              :style="{ top: `${r.top}px` }"
              :class="{
                add: repo.diff.hunks[r.hunk].lines[r.line].type === '+',
                del: repo.diff.hunks[r.hunk].lines[r.line].type === '-',
                pickable: lineSelectable && repo.diff.hunks[r.hunk].lines[r.line].type !== ' ',
                picked: isPicked(r.hunk, r.line),
                cursor: cursor?.hunk === r.hunk && cursor.line === r.line
              }"
              @click="pick({ hunk: r.hunk, line: r.line }, $event.shiftKey)"
              @mousedown="$event.shiftKey && lineSelectable && $event.preventDefault()"
            >
              <span class="no">{{ repo.diff.hunks[r.hunk].lines[r.line].oldNo ?? '' }}</span>
              <span class="no">{{ repo.diff.hunks[r.hunk].lines[r.line].newNo ?? '' }}</span>
              <span class="sign">{{ repo.diff.hunks[r.hunk].lines[r.line].type === ' ' ? '' : repo.diff.hunks[r.hunk].lines[r.line].type }}</span>
              <span class="text">{{ repo.diff.hunks[r.hunk].lines[r.line].text }}</span>
            </div>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.diff { display: flex; flex-direction: column; min-height: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px; border-bottom: 1px solid var(--border); }
header strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { flex: 1; min-height: 0; overflow: auto; user-select: text; line-height: 18px; }
/* fixed row heights (diffRows.ts): HUNK_H 30, LINE_H 18 */
.spacer { position: relative; min-width: 100%; }
.hunk, .line { position: absolute; left: 0; min-width: 100%; box-sizing: border-box; }
.hunk { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: var(--bg-panel); border-block: 1px solid var(--border); }
.hunk span { flex: 1; }
.hunk button { padding: 0 8px; font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.line.pickable { cursor: pointer; }
.selbar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; background: var(--bg-selected); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.selbar span { flex: 1; }
.danger:hover:not(:disabled) { border-color: var(--danger); color: var(--danger); }
.body:focus { outline: none; }
.body:focus .line.cursor { outline: 1px dashed var(--accent); outline-offset: -1px; }
.line.picked { box-shadow: inset 3px 0 0 var(--accent); filter: brightness(1.12); }
.line { height: 18px; display: flex; white-space: pre; }
.line.add { background: color-mix(in srgb, var(--lane-2) 16%, transparent); }
.line.del { background: color-mix(in srgb, var(--danger) 16%, transparent); }
.no { width: 48px; flex: none; text-align: right; padding-right: 8px; color: var(--text-dim); user-select: none; }
.sign { width: 16px; flex: none; text-align: center; user-select: none; }
.text { padding-right: 16px; }
.note { padding: 16px; }
</style>
