<script setup lang="ts">
import { computed } from 'vue'
import type { Ref } from '../../../shared/types'
import type { Worktree } from '../../../shared/types'
import { useRepo } from '../stores/repo'
import { useTabs } from '../stores/tabs'

const repo = useRepo()
const tabs = useTabs()
const checkedOutElsewhere = (r: Ref) => repo.info?.worktrees.some((t) => !t.main && t.branch === r.name) ?? false
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
    ...(r.kind === 'local' && !isHead(r) && !checkedOutElsewhere(r) ? [{ id: 'worktree', label: 'Worktree für diesen Branch anlegen…' }] : []),
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
  else if (id === 'worktree') openNewWorktree(r.name, null)
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

async function openNewWorktree(branch: string, fromSha: string | null) {
  const path = await repo.addWorktree(branch, fromSha)
  if (path) await tabs.openPath(path)
}

const name = (path: string) => path.split(/[\\/]/).pop()

async function worktreeMenu(t: Worktree) {
  const current = t.path === repo.info?.path
  const id = await window.gitspynx.showContextMenu([
    { id: 'open', label: 'Als Tab öffnen', enabled: !current && !t.prunable },
    { separator: true },
    ...(t.prunable ? [{ id: 'prune', label: 'Verwaiste Worktrees aufräumen' }] : []),
    { id: 'remove', label: 'Entfernen…', enabled: !t.main && !current }
  ])
  if (id === 'open') tabs.openPath(t.path)
  else if (id === 'prune') repo.pruneWorktrees()
  else if (id === 'remove' && (await repo.removeWorktree(t.path))) {
    const i = tabs.tabs.indexOf(t.path)
    if (i !== -1) tabs.closeTab(i)
  }
}

const SUB_STATE = { ok: '', uninitialized: 'nicht initialisiert', modified: 'anderer Commit', conflict: 'Konflikt' }
const subPath = (p: string) => `${repo.info!.path}/${p}`

async function submoduleMenu(path: string, initialized: boolean) {
  const id = await window.gitspynx.showContextMenu([
    { id: 'update', label: initialized ? 'Aktualisieren' : 'Initialisieren', enabled: !repo.busy },
    { id: 'open', label: 'Als Tab öffnen', enabled: initialized },
    { separator: true },
    { id: 'all', label: 'Alle Submodule aktualisieren', enabled: !repo.busy }
  ])
  if (id === 'update') repo.updateSubmodules([path])
  else if (id === 'open') tabs.openPath(subPath(path))
  else if (id === 'all') repo.updateSubmodules()
}

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
    <section v-if="(repo.info?.worktrees.length ?? 0) > 1">
      <h3>Worktrees <span class="dim">{{ repo.info!.worktrees.length }}</span></h3>
      <button
        v-for="t in repo.info!.worktrees"
        :key="t.path"
        class="item"
        :class="{ head: t.path === repo.info?.path, hidden: t.prunable }"
        :title="`${t.path}${t.prunable ? ' (Ordner fehlt)' : ''} – Doppelklick öffnet als Tab`"
        @dblclick="!t.prunable && t.path !== repo.info?.path && tabs.openPath(t.path)"
        @contextmenu.prevent="worktreeMenu(t)"
      >
        <span class="name">{{ t.branch ?? 'detached' }}</span>
        <span class="dim">{{ t.main ? 'Haupt' : name(t.path) }}</span>
      </button>
    </section>
    <section v-if="repo.info?.submodules.length">
      <h3>Submodule <span class="dim">{{ repo.info.submodules.length }}</span></h3>
      <button
        v-for="s in repo.info.submodules"
        :key="s.path"
        class="item"
        :class="{ hidden: s.state === 'uninitialized' }"
        :title="s.state === 'uninitialized' ? `${s.path} – Doppelklick initialisiert` : `${s.path} – Doppelklick öffnet als Tab`"
        @dblclick="s.state === 'uninitialized' ? repo.updateSubmodules([s.path]) : tabs.openPath(subPath(s.path))"
        @contextmenu.prevent="submoduleMenu(s.path, s.state !== 'uninitialized')"
      >
        <span class="name">{{ s.path }}</span>
        <span v-if="SUB_STATE[s.state]" class="dim">{{ SUB_STATE[s.state] }}</span>
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
