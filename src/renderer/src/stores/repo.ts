import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { Commit, CommitDetail, DiffTarget, FileDiff, FileStatus, RepoInfo } from '../../../shared/types'
import { layoutGraph } from '../graph/layout'
import { ask } from '../prompt'

const PAGE = 2000
export const WIP = 'WIP' // pseudo selection for the working directory

export const useRepo = defineStore('repo', () => {
  const info = ref<RepoInfo | null>(null)
  const commits = shallowRef<Commit[]>([])
  const complete = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selected = ref<string | null>(null)
  const detail = ref<CommitDetail | null>(null)
  const status = ref<FileStatus[]>([])
  const diffTarget = shallowRef<DiffTarget | null>(null) // shallow: identity is compared to drop stale diffs
  const diff = ref<FileDiff | null>(null)
  // Bumped whenever the loaded history is replaced; results of older requests are dropped.
  let generation = 0

  const graph = computed(() => layoutGraph(commits.value))
  const refsBySha = computed(() => {
    const map = new Map<string, RepoInfo['refs']>()
    for (const r of info.value?.refs ?? []) map.set(r.target, [...(map.get(r.target) ?? []), r])
    return map
  })
  const staged = computed(() => status.value.filter((f) => f.staged))
  const unstaged = computed(() => status.value.filter((f) => f.unstaged))

  function report(e: unknown) {
    error.value = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
  }

  async function guard(fn: () => Promise<void>) {
    error.value = null
    try {
      await fn()
    } catch (e) {
      report(e)
    }
  }

  // Reads repo state and the first pages again; keepCount keeps at least that many commits loaded.
  const open = (path: string, keepCount = 0) =>
    guard(async () => {
      const gen = ++generation
      loading.value = true
      try {
        const next = await window.gitspynx.openRepo(path)
        const [first, files] = await Promise.all([
          window.gitspynx.readLog(next.path, 0, Math.max(PAGE, keepCount)),
          window.gitspynx.readStatus(next.path)
        ])
        if (gen !== generation) return
        const samePath = info.value?.path === next.path
        info.value = next
        commits.value = first
        status.value = files
        complete.value = first.length < Math.max(PAGE, keepCount)
        if (!samePath) {
          selected.value = null
          detail.value = null
          diffTarget.value = null
          diff.value = null
        }
      } finally {
        if (gen === generation) loading.value = false
      }
    })

  const refresh = () => info.value && open(info.value.path, commits.value.length)

  const loadMore = () =>
    guard(async () => {
      if (!info.value || loading.value || complete.value) return
      const gen = generation
      loading.value = true
      try {
        const page = await window.gitspynx.readLog(info.value.path, commits.value.length, PAGE)
        if (gen !== generation) return
        commits.value = [...commits.value, ...page]
        complete.value = page.length < PAGE
      } finally {
        if (gen === generation) loading.value = false
      }
    })

  const select = (sha: string) =>
    guard(async () => {
      if (!info.value) return
      selected.value = sha
      if (sha === WIP) return
      const d = await window.gitspynx.readCommit(info.value.path, sha)
      if (selected.value === sha) detail.value = d // ignore stale responses
    })

  const refreshStatus = () =>
    guard(async () => {
      if (!info.value) return
      status.value = await window.gitspynx.readStatus(info.value.path)
      const t = diffTarget.value
      if (!t || 'sha' in t) return
      // A file that moved between staged/unstaged keeps its diff open on the side it is now on.
      const f = status.value.find((s) => s.path === t.path)
      const stillThere = f && (t.staged ? f.staged : f.unstaged)
      const other = f && (t.staged ? f.unstaged : f.staged)
      await openDiff(!stillThere && other ? { path: t.path, staged: !t.staged } : t)
    })

  const openDiff = (target: DiffTarget) =>
    guard(async () => {
      if (!info.value) return
      diffTarget.value = target
      const d = await window.gitspynx.readFileDiff(info.value.path, target)
      if (diffTarget.value === target) diff.value = d
    })

  const closeDiff = () => {
    diffTarget.value = null
    diff.value = null
  }

  const stage = (paths: string[]) =>
    guard(async () => {
      await window.gitspynx.stage(info.value!.path, paths)
      await refreshStatus()
    })

  const unstage = (paths: string[]) =>
    guard(async () => {
      await window.gitspynx.unstage(info.value!.path, paths)
      await refreshStatus()
    })

  async function commit(message: string, amend: boolean): Promise<boolean> {
    error.value = null
    try {
      await window.gitspynx.commit(info.value!.path, message, amend)
      closeDiff()
      await refresh()
      return true
    } catch (e) {
      report(e)
      return false
    }
  }

  // Runs a ref-changing operation, then reloads history.
  const mutate = (op: (repo: string) => Promise<void>) =>
    guard(async () => {
      if (!info.value) return
      try {
        await op(info.value.path)
      } finally {
        await refresh()
      }
    })

  const checkoutBranch = (name: string) => mutate((r) => window.gitspynx.checkout(r, name))

  async function createBranch(start: string) {
    const name = await ask('Neuer Branch', '', 'Erstellen und auschecken')
    if (name) await mutate((r) => window.gitspynx.createBranch(r, name, start, true))
  }

  async function renameBranch(from: string) {
    const to = await ask(`Branch „${from}“ umbenennen`, from, 'Umbenennen')
    if (to && to !== from) await mutate((r) => window.gitspynx.renameBranch(r, from, to))
  }

  async function deleteBranch(name: string) {
    if (!(await window.gitspynx.confirm(`Branch „${name}“ löschen?`, '', 'Löschen'))) return
    await mutate(async (r) => {
      try {
        await window.gitspynx.deleteBranch(r, name, false)
      } catch (e) {
        if (!/not fully merged/.test(String(e))) throw e
        const force = await window.gitspynx.confirm(
          `„${name}“ ist nicht vollständig gemergt.`,
          'Commits, die nur auf diesem Branch liegen, sind danach nur noch über das Reflog erreichbar.',
          'Trotzdem löschen'
        )
        if (force) await window.gitspynx.deleteBranch(r, name, true)
      }
    })
  }

  const close = () => {
    generation++
    loading.value = false
    info.value = null
    commits.value = []
    status.value = []
    closeDiff()
  }

  return {
    info, commits, complete, loading, error, selected, detail, status, staged, unstaged, diffTarget, diff,
    graph, refsBySha, open, refresh, loadMore, select, refreshStatus, openDiff, closeDiff, stage, unstage, commit, close,
    checkoutBranch, createBranch, renameBranch, deleteBranch
  }
})
