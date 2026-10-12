<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const result = ref('')
watch(
  () => repo.conflict,
  (c) => (result.value = c?.versions.merged ?? c?.versions.ours ?? ''),
  { immediate: true }
)

// During a rebase git's "ours" is the branch being rebased onto, "theirs" the replayed commit.
const labels = computed(() =>
  repo.info?.operation === 'rebase'
    ? { ours: 'Basis des Rebase (Ziel-Branch)', theirs: 'Dein Commit' }
    : { ours: `Aktueller Stand (${repo.info?.head.branch ?? 'HEAD'})`, theirs: 'Eingehende Änderung' }
)
const hasMarkers = computed(() => /^(<{7}|\|{7}|={7}|>{7})( |\r?$)/m.test(result.value))
const binary = computed(() => repo.conflict?.versions.binary ?? false)
</script>

<template>
  <section v-if="repo.conflict" class="conflict" aria-label="Konflikt auflösen">
    <header>
      <strong class="mono">{{ repo.conflict.path }}</strong>
      <button @click="repo.conflict = null">Schließen</button>
    </header>
    <div class="sides">
      <div class="side">
        <div class="label">
          <span>{{ labels.ours }}</span>
          <button :disabled="repo.conflict.versions.ours === null" @click="repo.resolve({ side: 'ours' })">Übernehmen</button>
        </div>
        <pre class="mono">{{ binary ? '(Binärdatei)' : repo.conflict.versions.ours ?? '(Datei gelöscht)' }}</pre>
      </div>
      <div class="side">
        <div class="label">
          <span>{{ labels.theirs }}</span>
          <button :disabled="repo.conflict.versions.theirs === null" @click="repo.resolve({ side: 'theirs' })">Übernehmen</button>
        </div>
        <pre class="mono">{{ binary ? '(Binärdatei)' : repo.conflict.versions.theirs ?? '(Datei gelöscht)' }}</pre>
      </div>
    </div>
    <div v-if="binary" class="result note dim">Binärdatei: bitte eine Seite übernehmen.</div>
    <div v-else class="result">
      <div class="label">
        <span>Ergebnis</span>
        <span v-if="hasMarkers" class="warn">enthält noch Konfliktmarker</span>
        <button class="primary" @click="repo.resolve({ content: result })">Als gelöst markieren</button>
      </div>
      <textarea v-model="result" class="mono" spellcheck="false" aria-label="Aufgelöster Dateiinhalt" />
    </div>
  </section>
</template>

<style scoped>
.conflict { display: grid; grid-template-rows: auto 1fr 1fr; min-height: 0; }
header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; border-bottom: 1px solid var(--border); }
.sides { display: grid; grid-template-columns: 1fr 1fr; min-height: 0; border-bottom: 1px solid var(--border); }
.side { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.side + .side { border-left: 1px solid var(--border); }
.label { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: var(--bg-panel); font-size: 12px; font-weight: 600; }
.label span:first-child { flex: 1; }
.label button { padding: 1px 8px; font-size: 12px; font-weight: normal; }
pre { flex: 1; margin: 0; padding: 8px 12px; overflow: auto; user-select: text; line-height: 20px; }
.result { display: flex; flex-direction: column; min-height: 0; }
textarea {
  flex: 1;
  border: 0;
  resize: none;
  padding: 8px 12px;
  background: var(--bg);
  color: var(--text);
  line-height: 20px;
  outline: none;
}
.warn { color: var(--danger); font-weight: normal; }
.note { padding: 16px; }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
