import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { type Commit, type CommitDetail, type ConflictVersions, type DiffTarget, type FileDiff, type FileStatus, type HunkSelection, MAX_LOG_PAGE, type RepoInfo, type Resolution } from '../../../shared/types'
import { layoutGraph } from '../graph/layout'
import { ask } from '../prompt'

const PAGE = 2000

export interface View {
  selected: string | null
  hidden: string[]
  solo: string | null
}
export const WIP = 'WIP' // pseudo selection for the working directory

export const useRepo = defineStore('repo', () => {
  const info = ref<RepoInfo | null>(null)
  const commits = shallowRef<Commit[]>([])
  const complete = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null) // non-error information for the toolbar
  const selected = ref<string | null>(null)
  const detail = ref<CommitDetail | null>(null)
  const status = ref<FileStatus[]>([])
  const diffTarget = shallowRef<DiffTarget | null>(null) // shallow: identity is compared to drop stale diffs
  const diff = ref<FileDiff | null>(null)
  type NetworkKind = 'fetch' | 'pull' | 'push'
  const busyByPath = shallowRef(new Map<string, NetworkKind>()) // running network operation per repo
  const busy = computed(() => (info.value && busyByPath.value.get(info.value.path)) || null)
  const conflict = shallowRef<{ path: string; versions: ConflictVersions } | null>(null)
  const hidden = shallowRef(new Set<string>()) // fullNames of refs whose history is hidden
  const solo = ref<string | null>(null) // fullName of the only ref shown
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
    notice.value = null
    try {
      await fn()
    } catch (e) {
      report(e)
    }
  }

  // undefined = the whole snapshot; otherwise the tips that remain visible under the filters
  function tipsFor(repo: RepoInfo, hiddenRefs = hidden.value, soloRef = solo.value): string[] | undefined {
    if (soloRef) {
      const r = repo.refs.find((x) => x.fullName === soloRef)
      if (r) return [r.target]
    }
    if (!hiddenRefs.size) return undefined
    const visible = new Set(repo.refs.filter((r) => r.kind !== 'stash' && !hiddenRefs.has(r.fullName)).map((r) => r.target))
    if (repo.head.sha) visible.add(repo.head.sha)
    return repo.tips.filter((t) => visible.has(t))
  }

  // What a tab remembers when it is left: selection and branch filters.
  const viewState = (): View => ({ selected: selected.value, hidden: [...hidden.value], solo: solo.value })

  // Reads repo state and the first pages again; keepCount keeps at least that many commits loaded;
  // view restores a tab's remembered selection and filters.
  const open = (path: string, keepCount = 0, view?: View) =>
    guard(async () => {
      const gen = ++generation
      loading.value = true
      try {
        const next = await window.gitspynx.openRepo(path)
        // Filters belong to the repository they were set in; they only become visible once this
        // load wins, so a tab switched away from meanwhile never remembers another tab's filters.
        const switching = next.path !== info.value?.path
        const nextHidden = switching ? new Set(view?.hidden) : hidden.value
        const nextSolo = switching ? (view?.solo ?? null) : solo.value
        const limit = Math.min(Math.max(PAGE, keepCount), MAX_LOG_PAGE)
        const [first, files] = await Promise.all([
          window.gitspynx.readLog(next.path, 0, limit, tipsFor(next, nextHidden, nextSolo)),
          window.gitspynx.readStatus(next.path)
        ])
        if (gen !== generation) return
        hidden.value = nextHidden
        solo.value = nextSolo
        const samePath = info.value?.path === next.path
        info.value = next
        commits.value = first
        status.value = files
        complete.value = first.length < limit
        if (!samePath) {
          selected.value = null
          detail.value = null
          diffTarget.value = null
          diff.value = null
          conflict.value = null
          if (view?.selected) void select(view.selected)
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
        const page = await window.gitspynx.readLog(info.value.path, commits.value.length, PAGE, tipsFor(info.value))
        if (gen !== generation) return
        commits.value = [...commits.value, ...page]
        complete.value = page.length < PAGE
      } finally {
        if (gen === generation) loading.value = false
      }
    })

  async function select(sha: string) {
    if (!info.value) return
    error.value = null
    selected.value = sha
    if (sha === WIP) return
    try {
      const d = await window.gitspynx.readCommit(info.value.path, sha)
      if (selected.value === sha) detail.value = d
    } catch (e) {
      if (selected.value === sha) report(e) // a superseded selection's failure is irrelevant
    }
  }

  // Calls arriving while a refresh runs share it plus one follow-up run (watcher bursts, stage clicks).
  let statusRun: Promise<void> | null = null
  let statusAgain = false
  function refreshStatus(): Promise<void> {
    if (statusRun) {
      statusAgain = true
      return statusRun
    }
    statusRun = (async () => {
      do {
        statusAgain = false
        await readStatusOnce()
      } while (statusAgain)
    })().finally(() => (statusRun = null))
    return statusRun
  }

  const readStatusOnce = () =>
    guard(async () => {
      if (!info.value) return
      const path = info.value.path
      const files = await window.gitspynx.readStatus(path)
      if (info.value?.path !== path) return // repo closed or switched meanwhile
      status.value = files
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
      conflict.value = null
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
      if (busy.value) return
      await window.gitspynx.stage(info.value!.path, paths)
      await refreshStatus()
    })

  const unstage = (paths: string[]) =>
    guard(async () => {
      if (busy.value) return
      await window.gitspynx.unstage(info.value!.path, paths)
      await refreshStatus()
    })

  const stageHunk = (sel: Omit<HunkSelection, 'path' | 'staged'>) =>
    guard(async () => {
      const t = diffTarget.value
      if (busy.value || !info.value || !t || 'sha' in t) return
      await window.gitspynx.stageHunk(info.value.path, { ...sel, path: t.path, staged: t.staged })
      await refreshStatus()
    })

  // A staged rename is a deletion plus an addition; unstage both or the deletion stays staged.
  const unstageFiles = (files: FileStatus[]) => unstage(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))

  async function commit(message: string, amend: boolean): Promise<boolean> {
    if (busy.value) return false
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

  // Runs a ref-changing operation, then reloads history. Refused while a network operation runs
  // (a checkout in the middle of a pull would interleave with it). Errors and the reload only
  // apply if the user is still looking at that repository (tabs).
  async function mutate(op: (repo: string) => Promise<void>, partOfNetworkOp = false) {
    if (!info.value || (busy.value && !partOfNetworkOp)) return
    const path = info.value.path
    error.value = null
    notice.value = null
    try {
      await op(path)
    } catch (e) {
      if (info.value?.path === path) report(e)
    } finally {
      if (info.value?.path === path) await refresh()
    }
  }

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

  async function network(kind: NetworkKind, op: (repo: string) => Promise<void>) {
    if (!info.value || busy.value) return
    const path = info.value.path
    busyByPath.value = new Map(busyByPath.value).set(path, kind)
    try {
      await mutate(op, true)
    } finally {
      const next = new Map(busyByPath.value)
      next.delete(path)
      busyByPath.value = next
    }
  }

  const fetchAll = () => network('fetch', (r) => window.gitspynx.fetch(r))
  const pullBranch = (mode: 'ff-only' | 'rebase' | 'merge' = 'ff-only') => network('pull', (r) => window.gitspynx.pull(r, mode))

  const pushBranch = () =>
    network('push', async (r) => {
      if ((await window.gitspynx.push(r, false)) === 'ok') return
      const force = await window.gitspynx.confirm(
        `Push von „${r.split(/[\\/]/).pop()}“ abgelehnt: Der Remote enthält Commits, die lokal fehlen.`,
        'Mit --force-with-lease --force-if-includes überschreiben? Das gelingt nur, wenn alle Remote-Commits bereits in deinem Branch enthalten waren – fremde Commits werden nie überschrieben.',
        'Force-Push'
      )
      if (force && (await window.gitspynx.push(r, true)) === 'rejected') throw new Error('Force-Push abgelehnt: Der Remote enthält Commits, die nicht in deinem Branch sind. Erst pullen.')
    })

  async function deleteRemoteBranch(name: string) {
    if (await window.gitspynx.confirm(`Branch „${name}“ auf dem Remote löschen?`, 'Das betrifft alle, die mit diesem Remote arbeiten.', 'Auf Remote löschen'))
      await network('push', (r) => window.gitspynx.deleteRemoteBranch(r, name))
  }

  // Merge/rebase/cherry-pick: on conflicts show the working directory where they get resolved.
  async function integrate(op: (repo: string) => Promise<'ok' | 'conflicts'>): Promise<boolean> {
    const path = info.value?.path
    let result = 'ok' as 'ok' | 'conflicts' // assigned inside the callback
    await mutate(async (r) => void (result = await op(r)))
    if (result !== 'conflicts' || info.value?.path !== path) return false
    await select(WIP)
    return true
  }

  const mergeInto = (rev: string) => integrate((r) => window.gitspynx.merge(r, rev))
  const cherryPick = (sha: string) => integrate((r) => window.gitspynx.cherryPick(r, sha))
  const continueOp = () => integrate((r) => window.gitspynx.continueOperation(r))
  const skipOp = () => integrate((r) => window.gitspynx.skipOperation(r))

  async function rebaseOnto(rev: string) {
    const branch = info.value?.head.branch
    const ok = await window.gitspynx.confirm(
      `„${branch}“ auf „${rev}“ rebasen?`,
      'Die Commits des Branches werden neu geschrieben. Bereits gepushte Commits brauchen danach einen Force-Push.',
      'Rebase'
    )
    if (ok) await integrate((r) => window.gitspynx.rebase(r, rev))
  }

  const OP_NAMES = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-Pick', revert: 'Revert' }

  async function abortOp() {
    const op = info.value?.operation
    const name = op ? OP_NAMES[op] : 'Operation'
    const ok = await window.gitspynx.confirm(
      `${name} abbrechen?`,
      'Der Stand vor dem Start wird wiederhergestellt; alle bisherigen Konfliktlösungen dieser Operation gehen verloren.',
      `${name} abbrechen`
    )
    if (!ok) return
    conflict.value = null
    await mutate((r) => window.gitspynx.abortOperation(r))
  }

  const stash = (message = '') => mutate((r) => window.gitspynx.stashPush(r, message))
  async function applyStash(sha: string, pop: boolean) {
    const conflicted = await integrate((r) => window.gitspynx.stashApply(r, sha, pop))
    if (conflicted && pop) notice.value = 'Konflikte beim Anwenden – der Stash wurde behalten. Nach dem Lösen kann er gelöscht werden.'
  }

  async function popLatestStash() {
    const latest = info.value?.stashes[0]
    if (latest) await applyStash(latest.sha, true)
  }

  async function dropStash(sha: string) {
    const st = info.value?.stashes.find((x) => x.sha === sha)
    if (await window.gitspynx.confirm(`Stash „${st?.subject ?? sha.slice(0, 7)}“ löschen?`, 'Der Stash ist danach nur noch über git fsck auffindbar.', 'Stash löschen'))
      await mutate((r) => window.gitspynx.stashDrop(r, sha))
  }

  const openConflict = (path: string) =>
    guard(async () => {
      if (!info.value) return
      closeDiff()
      const versions = await window.gitspynx.readConflict(info.value.path, path)
      conflict.value = { path, versions }
    })

  const resolve = (resolution: Resolution) =>
    guard(async () => {
      if (!info.value || !conflict.value) return
      await window.gitspynx.resolveConflict(info.value.path, conflict.value.path, resolution)
      conflict.value = null
      await refreshStatus()
    })

  // Filters change which tips the log walks, so history is reloaded from the start.
  const reloadFiltered = () => info.value && open(info.value.path)

  // Hiding a local branch also hides its upstream; otherwise the usual case (origin/x at the same
  // commit) would keep the history visible.
  function toggleHidden(fullName: string) {
    const ref = info.value?.refs.find((r) => r.fullName === fullName)
    const names = [fullName, ...(ref?.kind === 'local' && ref.upstream ? [`refs/remotes/${ref.upstream}`] : [])]
    const next = new Set(hidden.value)
    if (next.has(fullName)) names.forEach((n) => next.delete(n))
    else names.forEach((n) => next.add(n))
    hidden.value = next
    return reloadFiltered()
  }

  function toggleSolo(fullName: string) {
    solo.value = solo.value === fullName ? null : fullName
    return reloadFiltered()
  }

  function resetFilters() {
    hidden.value = new Set()
    solo.value = null
    return reloadFiltered()
  }

  async function loadAll() {
    while (info.value && !complete.value) {
      const before = commits.value.length
      await loadMore()
      if (commits.value.length === before) break // error or superseded
    }
  }

  const close = () => {
    void window.gitspynx.closeRepo()
    error.value = null
    notice.value = null
    hidden.value = new Set()
    solo.value = null
    conflict.value = null
    generation++
    loading.value = false
    info.value = null
    commits.value = []
    status.value = []
    closeDiff()
  }

  return {
    info, commits, complete, loading, error, notice, viewState, selected, detail, status, staged, unstaged, diffTarget, diff, unstageFiles,
    graph, refsBySha, open, refresh, loadMore, select, refreshStatus, openDiff, closeDiff, stage, unstage, commit, close,
    checkoutBranch, createBranch, renameBranch, deleteBranch, busy, fetchAll, pullBranch, pushBranch, deleteRemoteBranch,
    conflict, mergeInto, rebaseOnto, cherryPick, continueOp, skipOp, abortOp, openConflict, resolve,
    stash, applyStash, popLatestStash, dropStash, stageHunk, hidden, solo, toggleHidden, toggleSolo, resetFilters, loadAll
  }
})
