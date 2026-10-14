<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Ref } from '../../../shared/types'
import type { Submodule, Worktree } from '../../../shared/types'
import { flattenTree, refTree } from '../refTree'
import { useRepo } from '../stores/repo'
import { useTabs } from '../stores/tabs'
import { sidebarCollapsed } from '../ui'
import Icon from './Icon.vue'

const repo = useRepo()
const tabs = useTabs()
// in any other worktree, including the main one when this tab is a linked worktree
const checkedOutElsewhere = (r: Ref) => repo.info?.worktrees.some((t) => t.path !== repo.info?.path && t.branch === r.name) ?? false
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
  else if (id === 'merge') repo.mergeInto(repo.revFor(r)) // a full refname would end up in the merge message
  else if (id === 'rebase') repo.rebaseOnto(repo.revFor(r))
  else if (id === 'worktree') openNewWorktree(r.name, null)
  else if (id === 'hide') repo.toggleHidden(r.fullName)
  else if (id === 'solo') repo.toggleSolo(r.fullName)
}

function open(r: Ref) {
  if ((r.kind === 'local' && !isHead(r)) || r.kind === 'remote') repo.checkoutBranch(r.name)
}

// GitKraken-style sections: collapsible, with icon and count; branches as folder trees. What is
// collapsed (sections, folders) is kept across tab switches.
const filter = ref('')
const collapsed = sidebarCollapsed
const toggle = (key: string) => {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}
const folderKeys = (section: string) => new Set([...collapsed.value].filter((k) => k.startsWith(`${section}:`)).map((k) => k.slice(section.length + 1)))
const sections = computed(() => {
  const refs = repo.info?.refs ?? []
  const of = (kind: Ref['kind']) => refs.filter((r) => r.kind === kind)
  return [
    { key: 'local', title: 'Local', icon: 'laptop', refs: of('local') },
    { key: 'remote', title: 'Remote', icon: 'cloud', refs: of('remote') },
    { key: 'tags', title: 'Tags', icon: 'tag', refs: of('tag') }
  ]
    .filter((s) => s.refs.length)
    .map((s) => ({ ...s, rows: flattenTree(refTree(s.refs, filter.value), folderKeys(s.key)) }))
})
const viewing = computed(() => sections.value.reduce((n, s) => n + s.rows.filter((r) => r.kind === 'ref').length, 0))
const matches = (text: string) => !filter.value.trim() || text.toLowerCase().includes(filter.value.trim().toLowerCase())

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
    ...(t.main ? [] : [{ id: 'lock', label: t.locked ? 'Entsperren' : 'Sperren (vor Aufräumen und Verschieben schützen)' }]),
    { id: 'move', label: 'Verschieben…', enabled: !t.main && !current && !t.locked && !t.prunable },
    { id: 'remove', label: t.locked ? 'Entfernen… (erst entsperren)' : 'Entfernen…', enabled: !t.main && !current && !t.locked }
  ])
  if (id === 'open') tabs.openPath(t.path)
  else if (id === 'lock') repo.lockWorktree(t.path, !t.locked)
  else if (id === 'move') {
    const to = await repo.moveWorktree(t.path)
    const i = tabs.tabs.indexOf(t.path)
    if (to && i !== -1) {
      await tabs.closeTab(i) // its old folder is gone; open it at the new place
      await tabs.openPath(to)
    }
  }
  else if (id === 'prune') repo.pruneWorktrees()
  else if (id === 'remove' && (await repo.removeWorktree(t.path))) {
    const i = tabs.tabs.indexOf(t.path)
    if (i !== -1) tabs.closeTab(i)
  }
}

const SUB_STATE = { ok: '', uninitialized: 'nicht initialisiert', modified: 'anderer Commit', conflict: 'Konflikt', unmapped: 'nicht in .gitmodules' }
const subPath = (p: string) => `${repo.info!.path}/${p}`

// An unmapped gitlink (embedded repository without .gitmodules entry) can be opened, not updated.
async function submoduleMenu(s: Submodule) {
  const path = s.path
  const initialized = s.state !== 'uninitialized'
  const id = await window.gitspynx.showContextMenu([
    s.state === 'unmapped'
      ? { id: 'update', label: 'Aktualisieren (ohne .gitmodules-Eintrag nicht möglich)', enabled: false }
      : { id: 'update', label: initialized ? 'Aktualisieren' : 'Initialisieren', enabled: !repo.busy },
    { id: 'open', label: 'Als Tab öffnen', enabled: initialized },
    { separator: true },
    { id: 'all', label: 'Alle Submodule aktualisieren', enabled: !repo.busy },
    { id: 'sync', label: 'URLs aus .gitmodules übernehmen', enabled: !repo.busy },
    { id: 'add', label: 'Submodul hinzufügen…', enabled: !repo.busy },
    ...(s.parent || s.state === 'unmapped' ? [] : [{ separator: true as const }, { id: 'remove', label: 'Entfernen…', enabled: !repo.busy }])
  ])
  if (id === 'update') repo.updateSubmodules([path])
  else if (id === 'open') tabs.openPath(subPath(path))
  else if (id === 'all') repo.updateSubmodules()
  else if (id === 'sync') repo.syncSubmodules()
  else if (id === 'add') repo.addSubmodule()
  else if (id === 'remove') repo.removeSubmodule(path)
}

async function lfsMenu(pattern: string) {
  const id = await window.gitspynx.showContextMenu([{ id: 'untrack', label: `„${pattern}“ nicht mehr über LFS speichern` }])
  if (id === 'untrack') repo.lfsUntrack(pattern)
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
    <div class="viewing">
      <span>Viewing <strong>{{ viewing }}</strong></span>
    </div>
    <label class="search">
      <input v-model="filter" type="search" placeholder="Filter" aria-label="Branches, Tags, Stashes filtern" @keydown.esc="filter = ''" />
      <Icon name="search" :size="15" />
    </label>
    <section v-for="s in sections" :key="s.key">
      <button class="heading" :aria-expanded="!collapsed.has(s.key)" @click="toggle(s.key)">
        <Icon :name="collapsed.has(s.key) ? 'chevron-right' : 'chevron'" :size="14" class="chev" />
        <Icon :name="s.icon" :size="15" />
        <span class="title">{{ s.title }}</span>
        <span class="count">{{ s.refs.length }}</span>
      </button>
      <template v-if="!collapsed.has(s.key)">
        <template v-for="n in s.rows" :key="n.kind === 'ref' ? n.ref.fullName : `folder:${n.path}`">
          <button v-if="n.kind === 'folder'" class="item folder" :style="{ paddingLeft: `${22 + n.depth * 16}px` }" :aria-expanded="!collapsed.has(`${s.key}:${n.path}`)" @click="toggle(`${s.key}:${n.path}`)">
            <Icon :name="s.key === 'remote' && n.depth === 0 ? 'cloud' : 'folder'" :size="14" class="dim" />
            <span class="name">{{ n.name }}</span>
          </button>
          <button
            v-else
            class="item"
            :class="{ head: isHead(n.ref), hidden: repo.hidden.has(n.ref.fullName), solo: repo.solo === n.ref.fullName }"
            :style="{ paddingLeft: `${22 + n.depth * 16}px` }"
            :title="`${n.ref.fullName} – Doppelklick zum Auschecken`"
            @click="repo.select(n.ref.target)"
            @dblclick="open(n.ref)"
            @contextmenu.prevent="menu(n.ref)"
          >
            <Icon v-if="isHead(n.ref)" name="check" :size="14" class="mark" />
            <Icon v-else :name="s.key === 'tags' ? 'tag' : 'branch'" :size="14" class="dim" />
            <span class="name" :data-full="n.ref.name">{{ n.label }}</span>
            <span v-if="n.ref.ahead || n.ref.behind" class="dim mono">↑{{ n.ref.ahead }} ↓{{ n.ref.behind }}</span>
          </button>
        </template>
      </template>
    </section>
    <section v-if="(repo.info?.worktrees.length ?? 0) > 1">
      <button class="heading" :aria-expanded="!collapsed.has('worktrees')" @click="toggle('worktrees')">
        <Icon :name="collapsed.has('worktrees') ? 'chevron-right' : 'chevron'" :size="14" class="chev" /><Icon name="worktree" :size="15" />
        <span class="title">Worktrees</span><span class="count">{{ repo.info!.worktrees.length }}</span>
      </button>
      <button
        v-for="t in collapsed.has('worktrees') ? [] : repo.info!.worktrees.filter((w) => matches(w.branch ?? w.path))"
        :key="t.path"
        class="item"
        :class="{ head: t.path === repo.info?.path, hidden: t.prunable }"
        :title="`${t.path}${t.prunable ? ' (Ordner fehlt)' : ''} – Doppelklick öffnet als Tab`"
        @dblclick="!t.prunable && t.path !== repo.info?.path && tabs.openPath(t.path)"
        @contextmenu.prevent="worktreeMenu(t)"
      >
        <span class="name">{{ t.branch ?? 'detached' }}</span>
        <span class="dim">{{ t.main ? 'Haupt' : name(t.path) }}{{ t.locked ? ' · gesperrt' : '' }}</span>
      </button>
    </section>
    <section v-if="repo.info?.submodules.length">
      <button class="heading" :aria-expanded="!collapsed.has('submodules')" @click="toggle('submodules')">
        <Icon :name="collapsed.has('submodules') ? 'chevron-right' : 'chevron'" :size="14" class="chev" /><Icon name="submodule" :size="15" />
        <span class="title">Submodule{{ repo.busy === 'submodules' ? ' · wird aktualisiert…' : '' }}</span><span class="count">{{ repo.info.submodules.length }}</span>
      </button>
      <button
        v-for="s in collapsed.has('submodules') ? [] : repo.info.submodules.filter((x) => matches(x.path))"
        :key="s.path"
        class="item"
        :class="{ hidden: s.state === 'uninitialized', nested: !!s.parent }"
        :title="s.state === 'uninitialized' ? `${s.path} – Doppelklick initialisiert` : s.state === 'unmapped' ? `${s.path} – eingebettetes Repository ohne Eintrag in .gitmodules; Doppelklick öffnet als Tab` : `${s.path} – Doppelklick öffnet als Tab`"
        @dblclick="s.state === 'uninitialized' ? repo.updateSubmodules([s.path]) : tabs.openPath(subPath(s.path))"
        @contextmenu.prevent="submoduleMenu(s)"
      >
        <span class="name">{{ s.parent ? s.path.slice(s.parent.length + 1) : s.path }}</span>
        <span v-if="SUB_STATE[s.state]" class="dim">{{ SUB_STATE[s.state] }}</span>
      </button>
    </section>
    <section v-if="repo.info?.lfs">
      <button class="heading" @click="toggle('lfs')">
        <Icon :name="collapsed.has('lfs') ? 'chevron-right' : 'chevron'" :size="14" class="chev" /><Icon name="file" :size="15" />
        <span class="title">Git LFS</span><span class="count">{{ repo.info.lfs.patterns.length }}</span>
      </button>
      <template v-if="!collapsed.has('lfs')">
      <p v-if="!repo.info.lfs.installed" class="note warn">git-lfs wurde nicht gefunden – LFS-Dateien bleiben Platzhalter. Git LFS installieren und gitspynx neu starten.</p>
      <p v-else-if="!repo.info.lfs.configured" class="note dim">LFS ist nicht eingerichtet (git lfs install).</p>
      <button v-for="p in repo.info.lfs.patterns" :key="p" class="item" :title="`${p} – Rechtsklick für Optionen`" @contextmenu.prevent="lfsMenu(p)">
        <span class="name mono">{{ p }}</span>
      </button>
      <div v-if="repo.info.lfs.installed" class="actions">
        <button :disabled="!!repo.busy" @click="repo.lfsTrack()">Muster hinzufügen…</button>
        <button :disabled="!!repo.busy" @click="repo.lfsPull()">{{ repo.busy === 'lfs' ? 'Lädt…' : 'Dateien holen' }}</button>
      </div>
      </template>
    </section>
    <section v-if="repo.info?.stashes.length">
      <button class="heading" :aria-expanded="!collapsed.has('stashes')" @click="toggle('stashes')">
        <Icon :name="collapsed.has('stashes') ? 'chevron-right' : 'chevron'" :size="14" class="chev" /><Icon name="stash" :size="15" />
        <span class="title">Stashes</span><span class="count">{{ repo.info.stashes.length }}</span>
      </button>
      <button
        v-for="st in collapsed.has('stashes') ? [] : repo.info.stashes.filter((x) => matches(x.subject))"
        :key="st.sha"
        class="item"
        :title="`${st.subject} – Doppelklick zum Anwenden`"
        @click="repo.select(st.sha)"
        @dblclick="repo.applyStash(st.sha, false)"
        @contextmenu.prevent="stashMenu(st.sha)"
      >
        <Icon name="stash" :size="14" class="dim" />
        <span class="name">{{ st.subject.replace(/^On [^:]+: /, '') }}</span>
      </button>
    </section>
  </nav>
</template>

<style scoped>
.sidebar { overflow-y: auto; border-right: 1px solid var(--border); background: var(--bg-panel); padding: 6px 0 12px; }
.viewing { padding: 4px 14px 6px; color: var(--text-dim); }
.viewing strong { color: var(--accent); font-weight: 600; }
.search { position: relative; display: block; margin: 0 10px 8px; color: var(--text-dim); }
.search input { width: 100%; font: inherit; color: var(--text); background: var(--bg-input); border: 1px solid var(--border); border-radius: 4px; padding: 4px 28px 4px 8px; }
.search input:focus { outline: none; border-color: var(--accent); }
.search svg { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; }
section { border-top: 1px solid var(--border); }
.heading { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; border-radius: 0; background: none; padding: 8px 12px 8px 8px; text-align: left; color: var(--text-dim); }
.heading:hover { background: var(--bg-hover); color: var(--text); }
.heading .title { flex: 1; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text); }
.heading .count { color: var(--accent); font-variant-numeric: tabular-nums; font-size: 12px; }
.item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: 0;
  border-radius: 0;
  background: none;
  padding: 4px 12px 4px 22px;
  text-align: left;
}
.item:hover { background: var(--bg-hover); }
.item.head { background: color-mix(in srgb, var(--ok) 26%, transparent); }
.item.head .name { font-weight: 600; }
.mark { color: var(--ok); }
.item.hidden .name { text-decoration: line-through; opacity: 0.5; }
.item.solo .name { color: var(--lane-7); font-weight: 600; }
.item.folder .name { color: var(--text-dim); }
.item.nested { padding-left: 38px; } /* inside the submodule listed above it */
.item > .dim:last-child:not(:first-child) { margin-left: auto; }
.note { margin: 2px 12px 4px 22px; font-size: 12px; }
.note.warn { color: var(--danger); }
.actions { display: flex; gap: 6px; padding: 4px 12px 6px 22px; }
.actions button { padding: 1px 8px; font-size: 12px; }
.filter { display: flex; align-items: center; justify-content: space-between; margin: 0 8px 6px; padding: 4px 8px; border-radius: 6px; background: var(--bg-hover); font-size: 12px; }
.filter button { padding: 0 8px; font-size: 12px; }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
