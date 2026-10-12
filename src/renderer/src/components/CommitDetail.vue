<script setup lang="ts">
import { useRepo } from '../stores/repo'

const repo = useRepo()
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })
</script>

<template>
  <aside class="detail" aria-label="Commit-Details">
    <template v-if="repo.detail">
      <h2>{{ repo.detail.subject }}</h2>
      <pre v-if="repo.detail.body" class="body">{{ repo.detail.body }}</pre>
      <dl>
        <dt>Commit</dt>
        <dd class="mono" style="user-select: text">{{ repo.detail.sha }}</dd>
        <dt>Autor</dt>
        <dd>{{ repo.detail.author }} <span class="dim">&lt;{{ repo.detail.email }}&gt;</span></dd>
        <dd class="dim">{{ fmt.format(repo.detail.date * 1000) }}</dd>
        <template v-if="repo.detail.committer !== repo.detail.author">
          <dt>Committer</dt>
          <dd>{{ repo.detail.committer }}</dd>
        </template>
        <dt>Eltern</dt>
        <dd>
          <a v-for="p in repo.detail.parents" :key="p" href="#" class="mono" @click.prevent="repo.select(p)">{{ p.slice(0, 7) }} </a>
          <span v-if="!repo.detail.parents.length" class="dim">keine (Root-Commit)</span>
        </dd>
      </dl>
      <h3>{{ repo.detail.files.length }} Dateien</h3>
      <ul class="files">
        <li v-for="f in repo.detail.files" :key="f.path">
          <button class="file" :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path" @click="repo.openDiff({ path: f.path, sha: repo.detail!.sha })">
            <span class="status mono" :class="f.status">{{ f.status }}</span>
            <span class="path">{{ f.path }}</span>
          </button>
        </li>
      </ul>
    </template>
    <p v-else class="dim">Commit auswählen.</p>
  </aside>
</template>

<style scoped>
.detail { overflow-y: auto; border-left: 1px solid var(--border); background: var(--bg-panel); padding: 12px 16px; }
h2 { font-size: 15px; margin: 0 0 8px; user-select: text; }
h3 { font-size: 11px; text-transform: uppercase; margin: 16px 0 6px; }
.body { white-space: pre-wrap; font: inherit; color: var(--text-dim); user-select: text; }
dl { margin: 0; }
dt { font-size: 11px; color: var(--text-dim); margin-top: 8px; }
dd { margin: 0; word-break: break-all; }
a { color: var(--accent); text-decoration: none; }
.files { list-style: none; padding: 0; margin: 0; }
.file { display: flex; gap: 8px; width: 100%; border: 0; border-radius: 0; background: none; padding: 2px 4px; text-align: left; }
.file:hover { background: var(--bg-hover); }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status { width: 14px; text-align: center; }
.status.A { color: var(--lane-2); }
.status.M { color: var(--lane-1); }
.status.D { color: var(--danger); }
.status.R { color: var(--lane-0); }
</style>
