import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Commit, CommitDetail, RepoInfo } from '../../../shared/types'
import { layoutGraph } from '../graph/layout'

const PAGE = 2000

export const useRepo = defineStore('repo', () => {
  const info = ref<RepoInfo | null>(null)
  const commits = shallowRef<Commit[]>([])
  const complete = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selected = ref<string | null>(null)
  const detail = ref<CommitDetail | null>(null)

  const graph = computed(() => layoutGraph(commits.value))
  const refsBySha = computed(() => {
    const map = new Map<string, RepoInfo['refs']>()
    for (const r of info.value?.refs ?? []) map.set(r.target, [...(map.get(r.target) ?? []), r])
    return map
  })

  async function guard(fn: () => Promise<void>) {
    error.value = null
    try {
      await fn()
    } catch (e) {
      error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
    }
  }

  const open = (path: string) =>
    guard(async () => {
      loading.value = true
      try {
        const next = await window.gitspynx.openRepo(path)
        const first = await window.gitspynx.readLog(next.path, 0, PAGE)
        info.value = next
        commits.value = first
        complete.value = first.length < PAGE
        selected.value = null
        detail.value = null
      } finally {
        loading.value = false
      }
    })

  const loadMore = () =>
    guard(async () => {
      if (!info.value || loading.value || complete.value) return
      loading.value = true
      try {
        const page = await window.gitspynx.readLog(info.value.path, commits.value.length, PAGE)
        commits.value = [...commits.value, ...page]
        complete.value = page.length < PAGE
      } finally {
        loading.value = false
      }
    })

  const select = (sha: string) =>
    guard(async () => {
      if (!info.value) return
      selected.value = sha
      const d = await window.gitspynx.readCommit(info.value.path, sha)
      if (selected.value === sha) detail.value = d // ignore stale responses
    })

  const close = () => {
    info.value = null
    commits.value = []
  }

  return { info, commits, complete, loading, error, selected, detail, graph, refsBySha, open, loadMore, select, close }
})
