<script setup lang="ts">
import { computed } from 'vue'
import type { Ref } from '../../../shared/types'
import { useRepo } from '../stores/repo'

const repo = useRepo()
const sections = computed(() => {
  const refs = repo.info?.refs ?? []
  const of = (kind: Ref['kind']) => refs.filter((r) => r.kind === kind)
  return [
    { title: 'Lokal', refs: of('local') },
    { title: 'Remote', refs: of('remote') },
    { title: 'Tags', refs: of('tag') },
    { title: 'Stash', refs: of('stash') }
  ].filter((s) => s.refs.length)
})
</script>

<template>
  <nav class="sidebar" aria-label="Referenzen">
    <section v-for="s in sections" :key="s.title">
      <h3>{{ s.title }} <span class="dim">{{ s.refs.length }}</span></h3>
      <button
        v-for="r in s.refs"
        :key="r.fullName"
        class="item"
        :class="{ head: r.kind === 'local' && r.name === repo.info?.head.branch }"
        :title="r.fullName"
        @click="repo.select(r.target)"
      >
        <span class="name">{{ r.name }}</span>
        <span v-if="r.ahead || r.behind" class="dim mono">↑{{ r.ahead }} ↓{{ r.behind }}</span>
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
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
