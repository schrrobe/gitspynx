<script setup lang="ts">
import { computed } from 'vue'
import type { FileChange } from '../../../shared/types'
import { initials } from '../graphLabels'
import { buildTree, flattenTree } from '../refTree'
import { useRepo } from '../stores/repo'
import { fileView } from '../ui'
import Icon from './Icon.vue'

// GitKraken-style commit panel: short sha, message card, author/committer with avatar, parents,
// a change summary and the files as paths or as a folder tree.
const repo = useRepo()
const fmt = new Intl.DateTimeFormat('de', { day: '2-digit', month: '2-digit', year: 'numeric' })
const time = new Intl.DateTimeFormat('de', { hour: '2-digit', minute: '2-digit' })
const when = (secs: number) => `${fmt.format(secs * 1000)} @ ${time.format(secs * 1000)}`
// a stable lane color per person
const colorOf = (key: string) => `var(--lane-${[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 10})`

const STATUS: Record<string, { icon: string; word: string; cls: string }> = {
  M: { icon: 'pencil', word: 'modified', cls: 'mod' },
  A: { icon: 'plus', word: 'added', cls: 'add' },
  D: { icon: 'file', word: 'deleted', cls: 'del' },
  R: { icon: 'chevron-right', word: 'renamed', cls: 'ren' },
  C: { icon: 'chevron-right', word: 'copied', cls: 'ren' },
  T: { icon: 'pencil', word: 'type changed', cls: 'mod' }
}
const statusOf = (f: FileChange) => STATUS[f.status] ?? STATUS.M
const summary = computed(() => {
  const counts = new Map<string, number>()
  for (const f of repo.detail?.files ?? []) counts.set(statusOf(f).word, (counts.get(statusOf(f).word) ?? 0) + 1)
  return [...counts].map(([word, n]) => ({ word, n, cls: Object.values(STATUS).find((s) => s.word === word)!.cls, icon: Object.values(STATUS).find((s) => s.word === word)!.icon }))
})
const dir = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')
const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const tree = computed(() => flattenTree(buildTree(repo.detail?.files ?? [], '', (f) => f.path), new Set()))
const copySha = () => repo.detail && navigator.clipboard.writeText(repo.detail.sha)
</script>

<template>
  <aside class="detail" aria-label="Commit-Details">
    <template v-if="repo.detail">
      <header class="head">
        <button class="sha" title="SHA kopieren" @click="copySha">commit: <span class="mono">{{ repo.detail.sha.slice(0, 7) }}</span></button>
      </header>
      <div class="message">
        <h2>{{ repo.detail.subject }}</h2>
        <pre v-if="repo.detail.body" class="body">{{ repo.detail.body }}</pre>
      </div>
      <div class="people">
        <div class="person">
          <span class="avatar" :style="{ background: colorOf(repo.detail.email) }">{{ initials(repo.detail.author) }}</span>
          <div>
            <div class="who" :title="repo.detail.email">{{ repo.detail.author }}</div>
            <div class="dim">authored {{ when(repo.detail.date) }}</div>
          </div>
          <div class="parents">
            <span class="dim">{{ repo.detail.parents.length > 1 ? 'parents:' : 'parent:' }}</span>
            <a v-for="p in repo.detail.parents" :key="p" href="#" class="mono" @click.prevent="repo.select(p)">{{ p.slice(0, 7) }}</a>
            <span v-if="!repo.detail.parents.length" class="dim">–</span>
          </div>
        </div>
        <div v-if="repo.detail.committer !== repo.detail.author" class="person">
          <span class="avatar" :style="{ background: colorOf(repo.detail.committer) }">{{ initials(repo.detail.committer) }}</span>
          <div>
            <div class="who">{{ repo.detail.committer }}</div>
            <div class="dim">committed</div>
          </div>
        </div>
      </div>
      <div class="changes">
        <span v-for="s in summary" :key="s.word" class="sum" :class="s.cls"><Icon :name="s.icon" :size="13" />{{ s.n }} {{ s.word }}</span>
        <span class="spacer" />
        <span class="toggle" role="group" aria-label="Dateiansicht">
          <button :class="{ on: fileView === 'path' }" :aria-pressed="fileView === 'path'" @click="fileView = 'path'"><Icon name="list" :size="13" />Path</button>
          <button :class="{ on: fileView === 'tree' }" :aria-pressed="fileView === 'tree'" @click="fileView = 'tree'"><Icon name="tree" :size="13" />Tree</button>
        </span>
      </div>
      <ul class="files">
        <template v-if="fileView === 'path'">
          <li v-for="f in repo.detail.files" :key="f.path">
            <button class="file" :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path" @click="repo.openDiff({ path: f.path, sha: repo.detail!.sha })">
              <Icon :name="statusOf(f).icon" :size="13" class="st" :class="statusOf(f).cls" />
              <span class="path"><span class="dir">{{ dir(f.path) }}</span>{{ base(f.path) }}</span>
            </button>
          </li>
        </template>
        <template v-else>
          <li v-for="n in tree" :key="n.kind === 'ref' ? n.ref.path : `d:${n.path}`">
            <span v-if="n.kind === 'folder'" class="folder" :style="{ paddingLeft: `${12 + n.depth * 16}px` }"><Icon name="folder" :size="13" />{{ n.name }}</span>
            <button v-else class="file" :style="{ paddingLeft: `${12 + n.depth * 16}px` }" :title="n.ref.path" @click="repo.openDiff({ path: n.ref.path, sha: repo.detail!.sha })">
              <Icon :name="statusOf(n.ref).icon" :size="13" class="st" :class="statusOf(n.ref).cls" />
              <span class="path">{{ n.label }}</span>
            </button>
          </li>
        </template>
      </ul>
    </template>
    <p v-else class="dim empty">Commit auswählen.</p>
  </aside>
</template>

<style scoped>
.detail { overflow-y: auto; border-left: 1px solid var(--border); background: var(--bg-panel); }
.head { display: flex; align-items: center; height: 38px; padding: 0 14px; border-bottom: 1px solid var(--border); }
.sha { border: 0; background: none; padding: 0; color: var(--text); font-size: 14px; }
.sha:hover .mono { color: var(--accent); }
.message { margin: 12px; padding: 12px 14px; background: var(--bg-graph); border: 1px solid var(--border); border-radius: 6px; user-select: text; }
h2 { font-size: 17px; font-weight: 500; line-height: 1.35; margin: 0; }
.body { white-space: pre-wrap; font: inherit; color: var(--text-dim); margin: 10px 0 0; }
.people { padding: 0 14px; display: flex; flex-direction: column; gap: 12px; }
.person { display: flex; align-items: center; gap: 10px; }
.avatar { flex: none; width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #0d1015; font-size: 13px; }
.who { font-size: 14px; }
.parents { margin-left: auto; align-self: flex-start; display: flex; gap: 6px; }
.parents a { color: var(--text); text-decoration: none; }
.parents a:hover { color: var(--accent); }
.changes { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 16px 14px 6px; }
.sum { display: inline-flex; align-items: center; gap: 4px; }
.spacer { flex: 1; }
.toggle { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
.toggle button { display: flex; align-items: center; gap: 4px; border: 0; border-radius: 0; background: none; padding: 2px 8px; font-size: 12px; color: var(--text-dim); }
.toggle button.on { background: var(--bg-selected); color: var(--text); }
.files { list-style: none; margin: 0; padding: 0 0 12px; }
.file { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; border-radius: 0; background: none; padding: 4px 14px; text-align: left; }
.file:hover { background: var(--bg-hover); }
.folder { display: flex; align-items: center; gap: 6px; padding: 4px 14px; color: var(--text-dim); }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.dir { color: var(--text-dim); }
.mod { color: var(--lane-7); }
.add { color: var(--ok); }
.del { color: var(--danger); }
.ren { color: var(--lane-0); }
.empty { padding: 16px; }
</style>
