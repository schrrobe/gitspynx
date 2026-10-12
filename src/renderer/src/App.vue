<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import CommitDetail from './components/CommitDetail.vue'
import CommitList from './components/CommitList.vue'
import DiffView from './components/DiffView.vue'
import Sidebar from './components/Sidebar.vue'
import PromptDialog from './components/PromptDialog.vue'
import WorkdirPanel from './components/WorkdirPanel.vue'
import { useRepo, WIP } from './stores/repo'

const repo = useRepo()
const recent = ref<string[]>([])

onMounted(async () => (recent.value = await window.gitspynx.recentRepos()))

// File changes on disk: refs/HEAD changes reload history, work tree changes only the status.
const stopWatching = window.gitspynx.onRepoChanged(({ repo: path, git }) => {
  if (path !== repo.info?.path) return
  if (git) repo.refresh()
  else repo.refreshStatus()
})
onUnmounted(stopWatching)

async function pick() {
  const path = await window.gitspynx.pickRepo()
  if (path) await repo.open(path)
}
</script>

<template>
  <div v-if="!repo.info" class="welcome">
    <h1>gitspynx</h1>
    <button :disabled="repo.loading" @click="pick">Repository öffnen…</button>
    <p v-if="repo.error" class="error" role="alert">{{ repo.error }}</p>
    <section v-if="recent.length">
      <h2 class="dim">Zuletzt geöffnet</h2>
      <ul>
        <li v-for="p in recent" :key="p">
          <a href="#" @click.prevent="repo.open(p)">{{ p }}</a>
        </li>
      </ul>
    </section>
  </div>

  <div v-else class="shell">
    <header class="toolbar">
      <strong>{{ repo.info.path.split('/').pop() }}</strong>
      <span class="dim">{{ repo.info.head.branch ?? 'detached HEAD' }}</span>
      <span class="spacer" />
      <span v-if="repo.error" class="error" role="alert">{{ repo.error }}</span>
      <button @click="repo.refresh()">Aktualisieren</button>
      <button @click="pick">Öffnen…</button>
      <button @click="repo.close()">Schließen</button>
    </header>
    <Sidebar class="sidebar" />
    <DiffView v-if="repo.diffTarget" class="list" />
    <CommitList v-else class="list" />
    <WorkdirPanel v-if="repo.selected === WIP" class="detail" />
    <CommitDetail v-else class="detail" />
  </div>
  <PromptDialog />
</template>

<style scoped>
.welcome { max-width: 560px; margin: 0 auto; padding: 15vh 16px 0; }
.welcome h1 { font-weight: 600; letter-spacing: -0.02em; }
.welcome h2 { font-size: 12px; text-transform: uppercase; margin-top: 32px; }
.welcome ul { list-style: none; padding: 0; }
.welcome li { padding: 4px 0; }
.welcome a { color: var(--accent); text-decoration: none; word-break: break-all; }
.error { color: var(--danger); }
.shell {
  display: grid;
  grid-template: 'bar bar bar' 44px 'side list detail' 1fr / 220px 1fr 340px;
  height: 100%;
}
.toolbar {
  grid-area: bar;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.spacer { flex: 1; }
.sidebar { grid-area: side; }
.list { grid-area: list; }
.detail { grid-area: detail; min-height: 0; }
.list { min-width: 0; min-height: 0; }
</style>
