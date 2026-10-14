<script setup lang="ts">
import { computed } from 'vue'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const NAMES = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-Pick', revert: 'Revert', am: 'Patch (git am)' }
const conflicts = computed(() => repo.status.filter((f) => f.conflicted).length)
</script>

<template>
  <div v-if="repo.info?.operation" class="bar" role="status">
    <strong>{{ NAMES[repo.info.operation] }} läuft</strong>
    <span v-if="conflicts" class="warn">{{ conflicts }} {{ conflicts === 1 ? 'Konflikt' : 'Konflikte' }} offen</span>
    <span v-else class="dim">Alle Konflikte gelöst</span>
    <span class="spacer" />
    <button class="primary" :disabled="conflicts > 0 || !!repo.busy" @click="repo.continueOp()">Fortsetzen</button>
    <button v-if="repo.info.operation !== 'merge'" :disabled="!!repo.busy" @click="repo.skipOp()">Commit überspringen</button>
    <button :disabled="!!repo.busy" @click="repo.abortOp()">{{ NAMES[repo.info.operation] }} abbrechen</button>
  </div>
</template>

<style scoped>
.bar {
  grid-area: op;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--lane-1) 14%, var(--bg-panel));
  border-bottom: 1px solid var(--border);
}
.spacer { flex: 1; }
.warn { color: var(--danger); }
.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.primary:disabled { opacity: 0.45; }
</style>
