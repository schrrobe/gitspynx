<script setup lang="ts">
import { computed, ref } from 'vue'
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
  return repo.commits.slice(start, end).map((c, i) => ({ c, row: rows[start + i], top: (start + i) * ROW }))
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
    { separator: true },
    { id: 'copy', label: 'SHA kopieren' }
  ])
  if (id === 'create') repo.createBranch(sha)
  else if (id === 'cherry-pick') repo.cherryPick(sha)
  else if (id === 'merge') repo.mergeInto(sha)
  else if (id === 'rebase') repo.rebaseOnto(sha)
  else if (id === 'copy') navigator.clipboard.writeText(sha)
}

function move(delta: number) {
  const list = repo.commits
  const i = list.findIndex((c) => c.sha === repo.selected)
  const next = list[Math.min(list.length - 1, Math.max(0, i + delta))]
  if (!next) return
  repo.select(next.sha)
  const el = scroller.value!
  const top = list.indexOf(next) * ROW
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
}
</script>

<template>
  <div class="wrap">
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
        :class="{ selected: v.c.sha === repo.selected }"
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
