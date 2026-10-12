<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
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
        <div class="hunk dim">{{ h.header }}</div>
        <div v-for="(l, j) in h.lines" :key="j" class="line" :class="{ add: l.type === '+', del: l.type === '-' }">
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
.hunk { padding: 4px 12px; background: var(--bg-panel); border-block: 1px solid var(--border); }
.line { display: flex; white-space: pre; min-width: max-content; }
.line.add { background: color-mix(in srgb, var(--lane-2) 16%, transparent); }
.line.del { background: color-mix(in srgb, var(--danger) 16%, transparent); }
.no { width: 48px; flex: none; text-align: right; padding-right: 8px; color: var(--text-dim); user-select: none; }
.sign { width: 16px; flex: none; text-align: center; user-select: none; }
.text { padding-right: 16px; }
.note { padding: 16px; }
</style>
