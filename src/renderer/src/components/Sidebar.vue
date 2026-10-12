<script setup lang="ts">
import { computed } from 'vue'
import type { Ref } from '../../../shared/types'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const isHead = (r: Ref) => r.kind === 'local' && r.name === repo.info?.head.branch

async function menu(r: Ref) {
  const branch = r.kind === 'local' || r.kind === 'remote'
  const head = repo.info?.head.branch
  const id = await window.gitspynx.showContextMenu([
    ...(branch ? [{ id: 'checkout', label: r.kind === 'remote' ? 'Als lokalen Branch auschecken' : 'Auschecken', enabled: !isHead(r) }] : []),
    { id: 'create', label: 'Branch hier erstellen…' },
    ...(branch && !isHead(r) && head && !repo.info?.operation
      ? [
          { separator: true as const },
          { id: 'merge', label: `„${r.name}“ in „${head}“ mergen` },
          { id: 'rebase', label: `„${head}“ auf „${r.name}“ rebasen…` }
        ]
      : []),
    ...(r.kind === 'local'
      ? [{ id: 'rename', label: 'Umbenennen…' }, { separator: true as const }, { id: 'delete', label: 'Löschen…', enabled: !isHead(r) }]
      : []),
    ...(r.kind === 'remote' ? [{ separator: true as const }, { id: 'delete-remote', label: 'Auf Remote löschen…' }] : []),
    { separator: true },
    {
      id: 'hide',
      label: repo.hidden.has(r.fullName) ? 'Wieder einblenden' : r.kind === 'local' && r.upstream ? `Im Graph ausblenden (mit ${r.upstream})` : 'Im Graph ausblenden',
      enabled: !isHead(r)
    },
    { id: 'solo', label: repo.solo === r.fullName ? 'Solo beenden' : 'Nur diesen Branch zeigen (Solo)' }
  ])
  if (id === 'checkout') repo.checkoutBranch(r.name)
  else if (id === 'create') repo.createBranch(r.target)
  else if (id === 'rename') repo.renameBranch(r.name)
  else if (id === 'delete') repo.deleteBranch(r.name)
  else if (id === 'delete-remote') repo.deleteRemoteBranch(r.name)
  else if (id === 'merge') repo.mergeInto(r.name)
  else if (id === 'rebase') repo.rebaseOnto(r.name)
  else if (id === 'hide') repo.toggleHidden(r.fullName)
  else if (id === 'solo') repo.toggleSolo(r.fullName)
}

function open(r: Ref) {
  if ((r.kind === 'local' && !isHead(r)) || r.kind === 'remote') repo.checkoutBranch(r.name)
}

const sections = computed(() => {
  const refs = repo.info?.refs ?? []
  const of = (kind: Ref['kind']) => refs.filter((r) => r.kind === kind)
  return [
    { title: 'Lokal', refs: of('local') },
    { title: 'Remote', refs: of('remote') },
    { title: 'Tags', refs: of('tag') }
  ].filter((s) => s.refs.length)
})

async function stashMenu(sha: string) {
  repo.select(sha)
  const id = await window.gitspynx.showContextMenu([
    { id: 'apply', label: 'Anwenden' },
    { id: 'pop', label: 'Anwenden und löschen (Pop)' },
    { separator: true },
    { id: 'drop', label: 'Löschen…' }
  ])
  if (id === 'apply') repo.applyStash(sha, false)
  else if (id === 'pop') repo.applyStash(sha, true)
  else if (id === 'drop') repo.dropStash(sha)
}
</script>

<template>
  <nav class="sidebar" aria-label="Referenzen">
    <div v-if="repo.solo || repo.hidden.size" class="filter">
      <span>{{ repo.solo ? 'Solo aktiv' : `${repo.hidden.size} ausgeblendet` }}</span>
      <button @click="repo.resetFilters()">Zurücksetzen</button>
    </div>
    <section v-for="s in sections" :key="s.title">
      <h3>{{ s.title }} <span class="dim">{{ s.refs.length }}</span></h3>
      <button
        v-for="r in s.refs"
        :key="r.fullName"
        class="item"
        :class="{ head: isHead(r), hidden: repo.hidden.has(r.fullName), solo: repo.solo === r.fullName }"
        :title="`${r.fullName} – Doppelklick zum Auschecken`"
        @click="repo.select(r.target)"
        @dblclick="open(r)"
        @contextmenu.prevent="menu(r)"
      >
        <span class="name">{{ r.name }}</span>
        <span v-if="r.ahead || r.behind" class="dim mono">↑{{ r.ahead }} ↓{{ r.behind }}</span>
      </button>
    </section>
    <section v-if="repo.info?.stashes.length">
      <h3>Stashes <span class="dim">{{ repo.info.stashes.length }}</span></h3>
      <button
        v-for="st in repo.info.stashes"
        :key="st.sha"
        class="item"
        :title="`${st.subject} – Doppelklick zum Anwenden`"
        @click="repo.select(st.sha)"
        @dblclick="repo.applyStash(st.sha, false)"
        @contextmenu.prevent="stashMenu(st.sha)"
      >
        <span class="name">{{ st.subject.replace(/^On [^:]+: /, '') }}</span>
      </button>
    </section>
  </nav>
</template>

<style scoped>
.sidebar { overflow-y: auto; border-right: 1px solid var(--border); background: var(--bg-panel); padding: 8px 0; }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; margin: 12px 12px 4px; font-weight: 600; }
.item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 3px 12px 3px 20px;
  text-align: left;
}
.item:hover { background: var(--bg-hover); }
.item.head .name { color: var(--accent); font-weight: 600; }
.item.hidden .name { text-decoration: line-through; opacity: 0.5; }
.item.solo .name { color: var(--lane-1); font-weight: 600; }
.filter { display: flex; align-items: center; justify-content: space-between; margin: 0 8px 4px; padding: 4px 8px; border-radius: 6px; background: var(--bg-hover); font-size: 12px; }
.filter button { padding: 0 8px; font-size: 12px; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
