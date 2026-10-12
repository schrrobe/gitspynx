<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { focusSearchRequest } from '../ui'
import { nextHit as nextHitIndex, searchCommits } from '../search'
import { useRepo, WIP } from '../stores/repo'
import GraphCell from './GraphCell.vue'

const ROW = 28
const OVERSCAN = 10
const repo = useRepo()
const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const height = ref(800)
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const visible = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN)
  const end = Math.min(repo.commits.length, Math.ceil((scrollTop.value + height.value) / ROW) + OVERSCAN)
  const rows = repo.graph.rows
  return repo.commits.slice(start, end).map((c, i) => ({ c, index: start + i, row: rows[start + i], top: (start + i) * ROW }))
})

function onScroll() {
  const el = scroller.value!
  scrollTop.value = el.scrollTop
  height.value = el.clientHeight
  if (el.scrollTop + el.clientHeight > el.scrollHeight - ROW * 50) repo.loadMore()
}

async function menu(sha: string) {
  repo.select(sha)
  const head = repo.info?.head.branch
  const onHead = sha === repo.info?.head.sha
  const id = await window.gitspynx.showContextMenu([
    { id: 'create', label: 'Branch hier erstellen…' },
    ...(head && !onHead && !repo.info?.operation
      ? [
          { separator: true as const },
          { id: 'cherry-pick', label: `Cherry-Pick auf „${head}“` },
          { id: 'merge', label: `In „${head}“ mergen` },
          { id: 'rebase', label: `„${head}“ hierauf rebasen…` }
        ]
      : []),
    ...(head && !onHead && !repo.info?.operation ? [{ id: 'interactive', label: 'Interaktiver Rebase ab hier…' }] : []),
    { separator: true },
    { id: 'copy', label: 'SHA kopieren' }
  ])
  if (id === 'create') repo.createBranch(sha)
  else if (id === 'cherry-pick') repo.cherryPick(sha)
  else if (id === 'merge') repo.mergeInto(sha)
  else if (id === 'rebase') repo.rebaseOnto(sha)
  else if (id === 'interactive') repo.openRebasePlan(sha)
  else if (id === 'copy') navigator.clipboard.writeText(sha)
}

function reveal(index: number) {
  const el = scroller.value!
  const top = index * ROW
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
}

function move(delta: number) {
  const list = repo.commits
  const i = list.findIndex((c) => c.sha === repo.selected)
  const index = Math.min(list.length - 1, Math.max(0, i + delta))
  if (!list[index]) return
  repo.select(list[index].sha)
  reveal(index)
}

// Search: matching rows are highlighted, Enter / Shift+Enter walks through them.
const query = ref('')
const searchInput = ref<HTMLInputElement>()
const hits = computed(() => searchCommits(repo.commits, query.value))
const hitSet = computed(() => new Set(hits.value))
// Position is derived from the selection, so paging or refreshing history never resets it.
const selectedIndex = computed(() => repo.commits.findIndex((c) => c.sha === repo.selected))
const position = computed(() => hits.value.indexOf(selectedIndex.value))

function nextHit(delta: 1 | -1) {
  const index = nextHitIndex(hits.value, selectedIndex.value, delta)
  if (index === -1) return
  repo.select(repo.commits[index].sha)
  reveal(index)
}

// The "Commits suchen" command (Mod+F by default) asks for focus.
watch(focusSearchRequest, async () => {
  await nextTick() // the list may just have been shown again (diff/conflict view closed)
  searchInput.value?.focus()
  searchInput.value?.select()
})
</script>

<template>
  <div class="wrap">
  <div class="search">
    <input
      ref="searchInput"
      v-model="query"
      type="search"
      placeholder="Commits suchen – Nachricht, Autor, SHA"
      aria-label="Commits suchen"
      @keydown.enter.exact.prevent="nextHit(1)"
      @keydown.shift.enter.prevent="nextHit(-1)"
      @keydown.esc="query = ''"
    />
    <template v-if="query.trim()">
      <span class="dim count">{{ hits.length ? `${position + 1 || '–'}/${hits.length}` : 'keine Treffer' }}</span>
      <button :disabled="!hits.length" aria-label="Vorheriger Treffer" @click="nextHit(-1)">↑</button>
      <button :disabled="!hits.length" aria-label="Nächster Treffer" @click="nextHit(1)">↓</button>
      <button v-if="!repo.complete" :disabled="repo.loading" :title="`Nur ${repo.commits.length} geladene Commits durchsucht`" @click="repo.loadAll()">
        Alle laden
      </button>
    </template>
  </div>
  <button v-if="repo.status.length" class="wip" :class="{ selected: repo.selected === WIP }" @click="repo.select(WIP)">
    <span class="wip-dot" aria-hidden="true" />
    <span>Arbeitsverzeichnis</span>
    <span class="dim">{{ repo.status.length }} {{ repo.status.length === 1 ? 'Datei' : 'Dateien' }} geändert</span>
  </button>
  <div
    ref="scroller"
    class="scroller"
    tabindex="0"
    role="listbox"
    aria-label="Commits"
    @scroll.passive="onScroll"
    @keydown.down.prevent="move(1)"
    @keydown.up.prevent="move(-1)"
  >
    <div :style="{ height: `${repo.commits.length * ROW}px` }" class="spacer">
      <div
        v-for="v in visible"
        :key="v.c.sha"
        class="row"
        role="option"
        :aria-selected="v.c.sha === repo.selected"
        :class="{ selected: v.c.sha === repo.selected, hit: hitSet.has(v.index), dimmed: query.trim() && !hitSet.has(v.index) }"
        :style="{ transform: `translateY(${v.top}px)` }"
        @click="repo.select(v.c.sha)"
        @contextmenu.prevent="menu(v.c.sha)"
      >
        <GraphCell :row="v.row" :width="repo.graph.width" />
        <span class="subject">
          <span
            v-for="r in repo.refsBySha.get(v.c.sha) ?? []"
            :key="r.fullName"
            class="ref"
            :class="[r.kind, { head: r.kind === 'local' && r.name === repo.info?.head.branch }]"
          >{{ r.name }}</span>
          {{ v.c.subject }}
        </span>
        <span class="author dim">{{ v.c.author }}</span>
        <span class="date dim">{{ dateFmt.format(v.c.date * 1000) }}</span>
        <span class="sha dim mono">{{ v.c.sha.slice(0, 7) }}</span>
      </div>
    </div>
    <p v-if="!repo.commits.length && !repo.loading" class="empty dim">Noch keine Commits.</p>
  </div>
  </div>
</template>

<style scoped>
.wrap { display: flex; flex-direction: column; }
.search { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border); flex: none; }
.search input {
  flex: 1;
  font: inherit;
  color: var(--text);
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  user-select: text;
}
.search input:focus { outline: none; border-color: var(--accent); }
.search button { padding: 1px 8px; }
.count { font-variant-numeric: tabular-nums; min-width: 72px; text-align: right; }
.row.hit .subject { font-weight: 600; }
.row.dimmed { opacity: 0.45; }
.scroller { flex: 1; overflow: auto; position: relative; outline: none; }
.wip {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  flex: none;
  border: 0;
  border-bottom: 1px dashed var(--border);
  border-radius: 0;
  background: none;
  padding: 0 12px 0 8px;
  text-align: left;
}
.wip:hover { background: var(--bg-hover); }
.wip.selected { background: var(--bg-selected); }
.wip-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px dashed var(--text-dim); }
.spacer { position: relative; }
.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 12px;
  white-space: nowrap;
  cursor: default;
}
.row:hover { background: var(--bg-hover); }
.row.selected { background: var(--bg-selected); }
.row svg { flex: none; margin-left: 4px; }
.subject { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.author { width: 140px; overflow: hidden; text-overflow: ellipsis; }
.date { width: 150px; }
.sha { width: 60px; }
.empty { padding: 24px; }
</style>
