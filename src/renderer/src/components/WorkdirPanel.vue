<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FileStatus } from '../../../shared/types'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const summary = ref('')
const description = ref('')
const amend = ref(false)
const busy = ref(false)

const canCommit = computed(() => summary.value.trim() && (repo.staged.length || amend.value) && !busy.value)
const isOpen = (f: FileStatus, staged: boolean) =>
  repo.diffTarget && !('sha' in repo.diffTarget) && repo.diffTarget.path === f.path && repo.diffTarget.staged === staged

// Ticking amend on an empty form prefills the last commit's message.
watch(amend, async (on) => {
  if (!on || !repo.info?.head.sha) return
  if (summary.value || description.value) return
  const last = await window.gitspynx.readCommit(repo.info.path, repo.info.head.sha)
  summary.value = last.subject
  description.value = last.body
})

async function submit() {
  if (!canCommit.value) return
  busy.value = true
  const message = description.value.trim() ? `${summary.value.trim()}\n\n${description.value.trim()}` : summary.value.trim()
  if (await repo.commit(message, amend.value)) {
    summary.value = ''
    description.value = ''
    amend.value = false
  }
  busy.value = false
}
</script>

<template>
  <aside class="workdir" aria-label="Arbeitsverzeichnis">
    <section class="files">
      <header>
        <h3>Nicht gestaged <span class="dim">{{ repo.unstaged.length }}</span></h3>
        <button v-if="repo.unstaged.length" @click="repo.stage(repo.unstaged.map((f) => f.path))">Alle stagen</button>
      </header>
      <ul>
        <li v-for="f in repo.unstaged" :key="f.path" :class="{ open: isOpen(f, false) }">
          <button class="file" :title="f.path" @click="repo.openDiff({ path: f.path, staged: false })">
            <span class="status mono" :class="f.unstaged === '?' ? 'A' : f.unstaged">{{ f.unstaged === '?' ? '+' : f.unstaged }}</span>
            <span class="path">{{ f.path }}</span>
          </button>
          <button class="act" :aria-label="`${f.path} stagen`" @click="repo.stage([f.path])">Stage</button>
        </li>
      </ul>
    </section>

    <section class="files">
      <header>
        <h3>Gestaged <span class="dim">{{ repo.staged.length }}</span></h3>
        <button v-if="repo.staged.length" @click="repo.unstage(repo.staged.map((f) => f.path))">Alle unstagen</button>
      </header>
      <ul>
        <li v-for="f in repo.staged" :key="f.path" :class="{ open: isOpen(f, true) }">
          <button class="file" :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path" @click="repo.openDiff({ path: f.path, staged: true })">
            <span class="status mono" :class="f.staged ?? ''">{{ f.staged }}</span>
            <span class="path">{{ f.path }}</span>
          </button>
          <button class="act" :aria-label="`${f.path} unstagen`" @click="repo.unstage([f.path])">Unstage</button>
        </li>
      </ul>
    </section>

    <form class="commit" @submit.prevent="submit" @keydown.meta.enter.prevent="submit" @keydown.ctrl.enter.prevent="submit">
      <input v-model="summary" placeholder="Zusammenfassung" aria-label="Commit-Zusammenfassung" maxlength="200" />
      <textarea v-model="description" placeholder="Beschreibung (optional)" aria-label="Commit-Beschreibung" rows="4" />
      <label><input v-model="amend" type="checkbox" :disabled="!repo.info?.head.sha" /> Letzten Commit ändern (amend)</label>
      <button type="submit" class="primary" :disabled="!canCommit">
        {{ amend ? 'Commit ändern' : `Commit (${repo.staged.length})` }}
      </button>
    </form>
  </aside>
</template>

<style scoped>
.workdir { display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--bg-panel); min-height: 0; }
.files { flex: 1; min-height: 0; overflow-y: auto; border-bottom: 1px solid var(--border); }
.files header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 4px; position: sticky; top: 0; background: var(--bg-panel); }
.files header button { padding: 1px 8px; font-size: 12px; }
h3 { font-size: 11px; text-transform: uppercase; margin: 0; }
ul { list-style: none; margin: 0; padding: 0 0 8px; }
li { display: flex; align-items: center; }
li:hover, li.open { background: var(--bg-hover); }
.file { flex: 1; min-width: 0; display: flex; gap: 8px; border: 0; border-radius: 0; background: none; padding: 3px 12px; text-align: left; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.act { visibility: hidden; padding: 0 8px; margin-right: 8px; font-size: 12px; }
li:hover .act, li.open .act, .act:focus-visible { visibility: visible; }
.status { width: 14px; text-align: center; flex: none; }
.status.A { color: var(--lane-2); }
.status.M { color: var(--lane-1); }
.status.D { color: var(--danger); }
.status.R { color: var(--lane-0); }
.status.U { color: var(--danger); font-weight: 700; }
.commit { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
input:not([type]), textarea {
  font: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  resize: vertical;
  user-select: text;
}
input:not([type]):focus, textarea:focus { outline: none; border-color: var(--accent); }
label { display: flex; gap: 6px; align-items: center; color: var(--text-dim); }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; padding: 6px 12px; }
.primary:disabled { opacity: 0.45; cursor: default; }
</style>
