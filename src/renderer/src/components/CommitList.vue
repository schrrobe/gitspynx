<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { focusSearchRequest, listScroll } from '../ui'
import { nextHit as nextHitIndex, searchCommits } from '../search'
import { ask } from '../prompt'
import { useRepo, WIP } from '../stores/repo'
import { useTabs } from '../stores/tabs'
import { graphColumnPx, LANE_PX } from '../graph/column'
import { initials, refPills, relativeTime } from '../graphLabels'
import type { ListColumn } from '../../../shared/settings'
import Icon from './Icon.vue'
import { useSettings } from '../stores/settings'
import GraphCell from './GraphCell.vue'

const ROW = 28
const OVERSCAN = 10
const repo = useRepo()
const tabs = useTabs()
const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const height = ref(800)
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

// Graph column: capped automatically, resizable with the handle (drag, ←/→, double-click = auto).
const settings = useSettings()
const dragPx = ref<number | null>(null) // live width while dragging
const naturalPx = computed(() => repo.graph.width * LANE_PX)
const columnPx = computed(() => graphColumnPx(repo.graph.width, dragPx.value ?? settings.settings.graphWidth))
const clampPx = (px: number) => Math.round(Math.min(naturalPx.value, Math.max(2 * LANE_PX, px)))
function startResize(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const [x0, w0] = [e.clientX, columnPx.value]
  const move = (m: PointerEvent) => (dragPx.value = clampPx(w0 + m.clientX - x0))
  const up = () => {
    el.removeEventListener('pointermove', move)
    if (dragPx.value !== null) void settings.save({ graphWidth: dragPx.value })
    dragPx.value = null
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up, { once: true })
}
function resizeKey(e: KeyboardEvent) {
  const step = { ArrowLeft: -LANE_PX, ArrowRight: LANE_PX }[e.key]
  if (step === undefined) return
  e.preventDefault()
  void settings.save({ graphWidth: clampPx(columnPx.value + step) })
}

const REFS_W = 190 // BRANCH / TAG column
const visible = computed(() => {
  const start = Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN)
  const end = Math.min(repo.commits.length, Math.ceil((scrollTop.value + height.value) / ROW) + OVERSCAN)
  const rows = repo.graph.rows
  const now = Date.now() / 1000
  const head = repo.info?.head.branch ?? null
  return repo.commits.slice(start, end).map((c, i) => {
    const index = start + i
    const when = relativeTime(c.date, now)
    const prev = repo.commits[index - 1]
    // like GitKraken: the relative time where it changes from the row above
    const showWhen = !prev || relativeTime(prev.date, now) !== when
    const pills = refPills(repo.refsBySha.get(c.sha) ?? [], head)
    return { c, index, row: rows[index], top: index * ROW, pills, when: showWhen ? when : '', initials: initials(c.author), merge: c.parents.length > 1 }
  })
})
const columns = computed(() => new Set<ListColumn>(settings.settings.listColumns))
const graphPx = computed(() => Math.max(columnPx.value + 8, 64)) // room for the GRAPH heading
async function columnsMenu() {
  const labels: Record<ListColumn, string> = { author: 'Autor', date: 'Datum', sha: 'SHA' }
  const id = await window.gitspynx.showContextMenu((Object.keys(labels) as ListColumn[]).map((c) => ({ id: c, label: `${columns.value.has(c) ? '✓ ' : ''}${labels[c]}` })))
  if (!id) return
  const next = new Set(columns.value)
  if (!next.delete(id as ListColumn)) next.add(id as ListColumn)
  void settings.save({ listColumns: [...next] })
}

// Each repository keeps its scroll position across tab switches.
onMounted(() => {
  const saved = repo.info && listScroll.get(repo.info.path)
  if (saved && scroller.value) scroller.value.scrollTop = saved
  onScroll()
})

function onScroll() {
  const el = scroller.value!
  scrollTop.value = el.scrollTop
  if (repo.info) listScroll.set(repo.info.path, el.scrollTop)
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
    // also for the newest commit: undoing what is already pushed without rewriting history
    ...(head && !repo.info?.operation ? [{ id: 'revert', label: `Commit rückgängig machen (Revert auf „${head}“)` }] : []),
    { id: 'worktree', label: 'Worktree mit neuem Branch hier anlegen…', enabled: !repo.busy },
    { separator: true },
    { id: 'copy', label: 'SHA kopieren' }
  ])
  if (id === 'create') repo.createBranch(sha)
  else if (id === 'cherry-pick') repo.cherryPick(sha)
  else if (id === 'revert') repo.revertCommit(sha)
  else if (id === 'merge') repo.mergeInto(sha)
  else if (id === 'rebase') repo.rebaseOnto(sha)
  else if (id === 'interactive') repo.openRebasePlan(sha)
  else if (id === 'worktree') {
    const branch = await ask('Name des neuen Branches für den Worktree', '', 'Weiter')
    const path = branch && (await repo.addWorktree(branch, sha))
    if (path) await tabs.openPath(path)
  }
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
// 'code': commits whose changes contain the text (git log -S, "re:" = regex on changed lines)
const mode = ref<'meta' | 'code'>('meta')
const contentShas = ref<Set<string> | null>(null)
const searching = ref(false)
let searchSeq = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch([query, mode], () => {
  clearTimeout(searchTimer)
  const my = ++searchSeq
  contentShas.value = null
  if (mode.value !== 'code' || !query.value.trim()) return void (searching.value = false)
  searching.value = true
  searchTimer = setTimeout(async () => {
    const shas = await repo.searchContent(query.value)
    if (my !== searchSeq) return // a newer query is on its way
    contentShas.value = shas
    searching.value = false
  }, 400)
})
const hits = computed(() => {
  if (mode.value === 'meta') return searchCommits(repo.commits, query.value)
  const shas = contentShas.value
  return shas ? repo.commits.flatMap((c, i) => (shas.has(c.sha) ? [i] : [])) : []
})
const notLoaded = computed(() => (contentShas.value ? contentShas.value.size - hits.value.length : 0))
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
// Hidden until asked for (Search button, Mod+F), as in GitKraken; Esc clears, then closes.
const searchOpen = ref(false)
function searchEsc() {
  if (query.value) query.value = ''
  else {
    searchOpen.value = false
    scroller.value?.focus()
  }
}
watch(focusSearchRequest, async () => {
  searchOpen.value = true
  await nextTick() // the list may just have been shown again (diff/conflict view closed)
  searchInput.value?.focus()
  searchInput.value?.select()
})
</script>

<template>
  <div class="wrap">
  <div v-if="searchOpen || query" class="search">
    <select v-model="mode" aria-label="Suchen in" title="Suchen in">
      <option value="meta">Nachricht/Autor/SHA</option>
      <option value="code">Code (Änderungen)</option>
    </select>
    <input
      ref="searchInput"
      v-model="query"
      type="search"
:placeholder="mode === 'code' ? 'Text in Änderungen (re: für regulären Ausdruck)' : 'Commits suchen – Nachricht, Autor, SHA'"
      aria-label="Commits suchen"
      @keydown.enter.exact.prevent="nextHit(1)"
      @keydown.shift.enter.prevent="nextHit(-1)"
      @keydown.esc="searchEsc"
    />
    <template v-if="query.trim()">
      <span class="dim count">{{ searching ? 'sucht…' : hits.length ? `${position + 1 || '–'}/${hits.length}` : 'keine Treffer' }}</span>
      <span v-if="notLoaded > 0" class="dim">+{{ notLoaded }} nicht geladen</span>
      <button :disabled="!hits.length" aria-label="Vorheriger Treffer" @click="nextHit(-1)">↑</button>
      <button :disabled="!hits.length" aria-label="Nächster Treffer" @click="nextHit(1)">↓</button>
      <button v-if="!repo.complete" :disabled="repo.loading" :title="`Nur ${repo.commits.length} geladene Commits durchsucht`" @click="repo.loadAll()">
        Alle laden
      </button>
    </template>
    <button class="close-search" aria-label="Suche schließen" title="Suche schließen (Esc)" @click="query = ''; searchOpen = false">×</button>
  </div>
  <div class="list">
  <div class="colhead" :style="{ '--refs-w': `${REFS_W}px`, '--graph-w': `${graphPx}px` }">
    <span class="refs">Branch / Tag</span>
    <span class="graph">Graph</span>
    <span class="subject">Commit Message</span>
    <span v-if="columns.has('author')" class="author">Autor</span>
    <span v-if="columns.has('date')" class="date">Datum</span>
    <span v-if="columns.has('sha')" class="sha">SHA</span>
    <button class="cols" aria-label="Spalten" title="Spalten ein-/ausblenden" @click="columnsMenu"><Icon name="settings" :size="14" /></button>
  </div>
  <!-- uncommitted changes as the first graph row ("// WIP"), as in GitKraken -->
  <button v-if="repo.status.length" class="wip" :class="{ selected: repo.selected === WIP }" :style="{ '--refs-w': `${REFS_W}px`, '--graph-w': `${graphPx}px` }" @click="repo.select(WIP)">
    <span class="refs" />
    <span class="graph"><span class="wip-dot" aria-hidden="true"><Icon name="pencil" :size="11" /></span></span>
    <span class="subject"><span class="wip-label">// WIP</span><span class="dim">{{ repo.status.length }} {{ repo.status.length === 1 ? 'Datei' : 'Dateien' }} geändert</span></span>
  </button>
  <div
    v-if="repo.commits.length && naturalPx > 2 * LANE_PX"
    class="graph-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="Breite der Graph-Spalte (←/→, Doppelklick: automatisch)"
    :aria-valuenow="columnPx"
    :aria-valuemin="2 * LANE_PX"
    :aria-valuemax="naturalPx"
    tabindex="0"
    title="Ziehen: Graph-Spalte breiter/schmaler · Doppelklick: automatisch"
    :style="{ left: `${REFS_W + graphPx}px` }"
    @pointerdown.prevent="startResize"
    @dblclick="settings.save({ graphWidth: null })"
    @keydown="resizeKey"
  />
  <div
    ref="scroller"
    class="scroller"
    tabindex="0"
    role="listbox"
    aria-label="Commits"
    :style="{ '--refs-w': `${REFS_W}px`, '--graph-w': `${graphPx}px` }"
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
        :class="{ selected: v.c.sha === repo.selected, hit: hitSet.has(v.index), dimmed: query.trim() && !hitSet.has(v.index), labelled: v.pills.length }"
        :style="{ transform: `translateY(${v.top}px)`, '--lane': `var(--lane-${v.row.color})` }"
        @click="repo.select(v.c.sha)"
        @contextmenu.prevent="menu(v.c.sha)"
      >
        <span class="refs">
          <span
            v-for="p in v.pills.slice(0, 1)"
            :key="p.label"
            class="ref"
            :class="{ head: p.head, tag: p.tag }"
            :title="p.refs.map((r) => r.fullName).join('\n')"
          >
            <Icon v-if="p.head" name="check" :size="12" />
            <span class="ref-name">{{ p.label }}</span>
            <Icon v-if="p.local && !p.head" name="laptop" :size="12" />
            <Icon v-if="p.remote" name="cloud" :size="12" />
            <Icon v-if="p.tag" name="tag" :size="12" />
          </span>
          <span v-if="v.pills.length > 1" class="more" :title="v.pills.slice(1).map((p) => p.label).join('\n')">+{{ v.pills.length - 1 }}</span>
        </span>
        <GraphCell :row="v.row" :column-px="columnPx" :initials="v.initials" :merge="v.merge" />
        <span class="subject">
          <span class="text">{{ v.c.subject }}</span>
          <span v-if="v.when" class="when">{{ v.when }}</span>
        </span>
        <span v-if="columns.has('author')" class="author dim">{{ v.c.author }}</span>
        <span v-if="columns.has('date')" class="date dim">{{ dateFmt.format(v.c.date * 1000) }}</span>
        <span v-if="columns.has('sha')" class="sha dim mono">{{ v.c.sha.slice(0, 7) }}</span>
      </div>
    </div>
    <p v-if="!repo.commits.length && !repo.loading" class="empty dim">Noch keine Commits.</p>
  </div>
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
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  user-select: text;
}
.search input:focus { outline: none; border-color: var(--accent); }
.search button { padding: 1px 8px; }
.search select { font: inherit; color: var(--text); background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; padding: 2px 4px; }
.count { font-variant-numeric: tabular-nums; min-width: 72px; text-align: right; }
.row.hit .subject { font-weight: 600; }
.row.dimmed { opacity: 0.45; }
.list { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
.scroller { flex: 1; overflow: auto; position: relative; outline: none; }
.graph-handle { position: absolute; top: 0; bottom: 0; width: 7px; margin-left: -3px; z-index: 2; cursor: col-resize; }
.graph-handle:hover, .graph-handle:focus-visible { background: color-mix(in srgb, var(--accent) 35%, transparent); outline: none; }
.wip { display: flex; align-items: center; height: 28px; flex: none; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; background: var(--bg-graph); padding: 0 12px 0 0; text-align: left; }
.wip:hover { background: var(--bg-hover); }
.wip.selected { background: var(--bg-selected); }
.wip .refs { width: var(--refs-w); flex: none; }
.wip .graph { width: var(--graph-w); flex: none; display: flex; padding-left: 4px; }
.wip-dot { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px dashed var(--text-dim); color: var(--text-dim); }
.wip .subject { flex: 1; display: flex; gap: 10px; align-items: center; padding-left: 10px; border-left: 3px solid var(--text-dim); height: 100%; }
.wip-label { color: var(--text-dim); font-style: italic; }
.close-search { border: 0; background: none; padding: 0 6px; font-size: 15px; color: var(--text-dim); }
.spacer { position: relative; }
/* column header, as in GitKraken: BRANCH / TAG · GRAPH · COMMIT MESSAGE (+ optional columns) */
.colhead { display: flex; align-items: center; height: 26px; flex: none; padding-right: 12px; border-bottom: 1px solid var(--border); background: var(--bg-panel); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-dim); font-family: ui-monospace, Menlo, monospace; }
.colhead .refs { width: var(--refs-w); flex: none; padding-left: 10px; }
.colhead .graph { width: var(--graph-w); flex: none; padding-left: 6px; border-left: 1px solid var(--border); }
.colhead .subject { flex: 1; padding-left: 10px; border-left: 1px solid var(--border); }
.cols { border: 0; background: none; padding: 2px 4px; color: var(--text-dim); display: flex; }
.cols:hover { color: var(--text); }
.scroller { background: var(--bg-graph); }
.row {
  position: absolute;
  left: 0;
  right: 0;
  height: 28px;
  display: flex;
  align-items: center;
  padding-right: 12px;
  white-space: nowrap;
  cursor: default;
  /* tinted in the commit's lane color across branch/tag and graph, like GitKraken */
  background: linear-gradient(90deg, color-mix(in srgb, var(--lane) 8%, transparent) 0 calc(var(--refs-w) + var(--graph-w)), transparent 0);
}
.row.labelled { background: linear-gradient(90deg, color-mix(in srgb, var(--lane) 16%, transparent) 0 calc(var(--refs-w) + var(--graph-w)), transparent 0); }
.row:hover { background-color: var(--bg-hover); }
.row.selected { background: color-mix(in srgb, var(--lane) 28%, var(--bg-selected)); }
.row svg { flex: none; margin: 0 4px; }
.row .refs { width: var(--refs-w); flex: none; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 8px; overflow: hidden; }
.row .ref {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: calc(var(--refs-w) - 44px);
  height: 21px;
  padding: 0 6px;
  margin: 0;
  border: 0;
  border-radius: 3px;
  background: color-mix(in srgb, var(--lane) 38%, var(--bg-graph));
  color: var(--text);
  font-size: 12px;
  font-style: normal;
}
.row .ref.head { background: color-mix(in srgb, var(--lane) 58%, var(--bg-graph)); font-weight: 600; }
.row .ref.tag { background: color-mix(in srgb, var(--lane) 22%, var(--bg-graph)); }
.row .ref svg { margin: 0; }
.ref-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.more { font-size: 11px; color: var(--text-dim); }
.row .subject { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 100%; padding-left: 10px; border-left: 3px solid color-mix(in srgb, var(--lane) 75%, transparent); }
.subject .text { overflow: hidden; text-overflow: ellipsis; }
.when { margin-left: auto; flex: none; font-size: 11px; color: var(--text-dim); background: var(--bg-panel); border-radius: 3px; padding: 0 5px; line-height: 16px; }
.author { width: 140px; flex: none; overflow: hidden; text-overflow: ellipsis; padding-left: 10px; }
.date { width: 150px; flex: none; padding-left: 10px; }
.sha { width: 70px; flex: none; padding-left: 10px; }
.empty { padding: 24px; }
</style>
