import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { type Commit, type CommitDetail, type ConflictVersions, type DiffTarget, type FileDiff, type FileStatus, type HunkSelection, MAX_LOG_PAGE, type RebaseCommit, type RebaseStep, type UndoStep, type RepoInfo, type Ref, type Resolution } from '../../../shared/types'
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
  type NetworkKind = 'fetch' | 'pull' | 'push' | 'submodules' | 'lfs'
  const busyByPath = shallowRef(new Map<string, NetworkKind>()) // running network operation per repo
  const busy = computed(() => (info.value && busyByPath.value.get(info.value.path)) || null)
  const conflict = shallowRef<{ path: string; versions: ConflictVersions } | null>(null)
  // Undo/redo per repository (memory only). Each entry holds the steps that reverse the action and
  // the steps that repeat it; main checks the expected state before every step.
  interface HistoryEntry {
    label: string
    undo: UndoStep[]
    redo: UndoStep[]
  }
  const histories = shallowRef(new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>())
  const history = computed(() => (info.value && histories.value.get(info.value.path)) || { undo: [], redo: [] })
  const undoLabel = computed(() => history.value.undo.at(-1)?.label ?? null)
  const redoLabel = computed(() => history.value.redo.at(-1)?.label ?? null)
  const rebasePlan = shallowRef<{ base: string; commits: RebaseCommit[] } | null>(null) // open interactive-rebase dialog
  const hidden = shallowRef(new Set<string>()) // fullNames of refs whose history is hidden
  const solo = ref<string | null>(null) // fullName of the only ref shown
  // Bumped whenever the loaded history is replaced; results of older requests are dropped.
  let generation = 0

  // A loaded page only lays out its own rows (see layoutGraph).
  let lastLayout: ReturnType<typeof layoutGraph> | undefined
  const graph = computed(() => (lastLayout = layoutGraph(commits.value, lastLayout)))

  // Recently shown repositories stay in memory: switching back to a tab shows it at once (with
  // everything that was loaded) while it reloads behind the scenes.
  // ponytail: 3 entries, each holding its loaded history (a fully loaded git/git is ~100 MB heap)
  const recentRepos = new Map<string, { info: RepoInfo; commits: Commit[]; complete: boolean; status: FileStatus[]; layout: typeof lastLayout }>()
  function remember() {
    if (!info.value) return
    recentRepos.delete(info.value.path)
    recentRepos.set(info.value.path, { info: info.value, commits: commits.value, complete: complete.value, status: status.value, layout: lastLayout })
    while (recentRepos.size > 3) recentRepos.delete(recentRepos.keys().next().value!)
  }
  const forget = (path: string) => void recentRepos.delete(path)

  // Another repository is shown: selection and open views start fresh (or as the tab remembers
  // them), and a failure that happened while it was in the background is reported now.
  function enter(path: string, v?: View) {
    const pending = backgroundErrors.value.get(path)
    if (pending !== undefined) {
      error.value = pending
      const rest = new Map(backgroundErrors.value)
      rest.delete(path)
      backgroundErrors.value = rest
    }
    selected.value = null
    detail.value = null
    diffTarget.value = null
    diff.value = null
    conflict.value = null
    if (v?.selected) void select(v.selected)
  }
  const refsBySha = computed(() => {
    const map = new Map<string, RepoInfo['refs']>()
    for (const r of info.value?.refs ?? []) map.set(r.target, [...(map.get(r.target) ?? []), r])
    return map
  })
  const staged = computed(() => status.value.filter((f) => f.staged))
  const unstaged = computed(() => status.value.filter((f) => f.unstaged))

  const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
  function report(e: unknown) {
    error.value = message(e)
  }
  // Failures of operations whose repository is no longer shown (another tab was opened meanwhile):
  // the tab shows a mark, the message appears when the repository is shown again.
  const backgroundErrors = shallowRef(new Map<string, string>())

  // background: a reload nobody asked for (watcher) keeps the messages of the last action, but
  // takes back an error of its own once a later background run succeeds.
  let backgroundError: string | null = null
  async function guard(fn: () => Promise<void>, background = false) {
    if (!background) {
      error.value = null
      notice.value = null
    }
    try {
      await fn()
      if (background && error.value !== null && error.value === backgroundError) error.value = null
    } catch (e) {
      report(e)
      if (background) backgroundError = error.value
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
  // view may depend on the repository root the path resolves to (a subfolder of an open tab).
  let loadRun: Promise<void> | null = null // open or page load in flight, awaited by loadAll
  function tracked(p: Promise<void>) {
    loadRun = p
    void p.finally(() => loadRun === p && (loadRun = null))
    return p
  }

  const open = (path: string, keepCount = 0, view?: View | ((root: string) => View | undefined), background = false) =>
    tracked(guard(async () => {
      const gen = ++generation
      loading.value = true
      const cached = path !== info.value?.path ? recentRepos.get(path) : undefined
      if (cached) {
        remember()
        const v = typeof view === 'function' ? view(cached.info.path) : view
        lastLayout = cached.layout
        hidden.value = new Set(v?.hidden)
        solo.value = v?.solo ?? null
        info.value = cached.info
        commits.value = cached.commits
        complete.value = cached.complete
        status.value = cached.status
        enter(cached.info.path, v)
        keepCount = Math.max(keepCount, cached.commits.length)
      }
      try {
        const next = await window.gitspynx.openRepo(path)
        // Filters belong to the repository they were set in; they only become visible once this
        // load wins, so a tab switched away from meanwhile never remembers another tab's filters.
        const switching = next.path !== info.value?.path
        const v = typeof view === 'function' ? view(next.path) : view
        // Filters on refs that no longer exist (deleted, pruned) are dropped.
        const known = new Set(next.refs.map((r) => r.fullName))
        let nextHidden = switching ? new Set(v?.hidden) : hidden.value
        if ([...nextHidden].some((n) => !known.has(n))) nextHidden = new Set([...nextHidden].filter((n) => known.has(n)))
        let nextSolo = switching ? (v?.solo ?? null) : solo.value
        if (nextSolo && !known.has(nextSolo)) nextSolo = null
        const limit = Math.min(Math.max(PAGE, keepCount), MAX_LOG_PAGE)
        const tips = tipsFor(next, nextHidden, nextSolo)
        const [firstPage, files] = await Promise.all([window.gitspynx.readLog(next.path, 0, limit, tips), window.gitspynx.readStatus(next.path)])
        let first = firstPage
        let more = firstPage.length === limit // the last page read was full: history may go on
        // A refresh keeps as many commits as were loaded, also beyond one maximal page.
        while (more && first.length < keepCount) {
          if (gen !== generation) return
          const want = Math.min(MAX_LOG_PAGE, keepCount - first.length)
          const page = await window.gitspynx.readLog(next.path, first.length, want, tips)
          more = page.length === want
          first = first.concat(page)
        }
        if (gen !== generation) return
        // Unchanged history (most watcher refreshes): keep the shown list, so neither the graph
        // layout nor the rows are rebuilt.
        const shown = commits.value
        if (next.path === info.value?.path && first.length === shown.length && first.every((c, i) => c.sha === shown[i].sha)) first = shown
        hidden.value = nextHidden
        solo.value = nextSolo
        const samePath = info.value?.path === next.path
        const sel = selected.value
        if (samePath && sel && info.value?.stashes.some((x) => x.sha === sel) && !next.stashes.some((x) => x.sha === sel)) {
          selected.value = null // the shown stash was popped or dropped
          detail.value = null
        }
        if (!samePath) remember()
        info.value = next
        commits.value = first
        status.value = files
        complete.value = !more
        if (!samePath) enter(next.path, v)
        else await refreshOpenDiff() // external commit/reset/checkout changed what the diff shows
      } finally {
        if (gen === generation) loading.value = false
      }
    }, background))

  const refresh = (background = false) => info.value && open(info.value.path, commits.value.length, undefined, background)

  // size: scrolling loads small pages; "load all" large ones — without a commit-graph file every
  // page makes git walk the whole history (git/git: ~1 s per page)
  const loadMore = (size = PAGE) => {
    if (!info.value || loading.value || complete.value) return Promise.resolve()
    return tracked(guard(async () => {
      if (!info.value) return
      const gen = generation
      loading.value = true
      try {
        const page = await window.gitspynx.readLog(info.value.path, commits.value.length, size, tipsFor(info.value))
        if (gen !== generation) return
        commits.value = [...commits.value, ...page]
        complete.value = page.length < size
      } finally {
        if (gen === generation) loading.value = false
      }
    }))
  }

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
      await refreshOpenDiff()
    }, true) // a follow-up reload: the triggering action already reset the messages

  // After the status changed: re-read an open working-directory diff; a file that moved between
  // staged and unstaged keeps its diff open on the side it is now on.
  function refreshOpenDiff() {
    const t = diffTarget.value
    if (!t || 'sha' in t) return
    const f = status.value.find((s) => s.path === t.path)
    const stillThere = f && (t.staged ? f.staged : f.unstaged)
    const other = f && (t.staged ? f.unstaged : f.staged)
    return openDiff(!stillThere && other ? { path: t.path, staged: !t.staged } : t, true)
  }

  // Only the newest read counts: a refresh re-reads the same target, and an older answer must not
  // overwrite a newer one (e.g. a read from before an external `git reset` finishing last).
  let diffRead = 0
  const openDiff = (target: DiffTarget, background = false) =>
    guard(async () => {
      if (!info.value) return
      conflict.value = null
      diffTarget.value = target
      const my = ++diffRead
      const d = await window.gitspynx.readFileDiff(info.value.path, target)
      if (my === diffRead && diffTarget.value === target) diff.value = d
    }, background)

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

  const openRebasePlan = (base: string) =>
    guard(async () => {
      if (!info.value || busy.value) return
      rebasePlan.value = { base, commits: await window.gitspynx.readRebasePlan(info.value.path, base) }
    })

  async function startRebase(steps: RebaseStep[]) {
    const plan = rebasePlan.value
    if (!plan) return
    let accepted = false // the dialog stays open (typed messages kept) while git refuses the plan
    await integrate(async (r) => {
      const result = await window.gitspynx.interactiveRebase(r, plan.base, steps)
      accepted = true
      return result
    }, 'Interaktiver Rebase')
    // a rebase that started and then stopped (hook, empty pick) continues in the operation bar
    if ((accepted || info.value?.operation) && rebasePlan.value === plan) rebasePlan.value = null
    if (accepted && info.value?.operation === 'rebase' && !error.value && steps.some((s) => s.action === 'edit'))
      notice.value = 'Rebase angehalten zum Bearbeiten: Änderungen vornehmen (z. B. „Letzten Commit ändern"), dann „Fortsetzen".'
  }

  // Discards hunks/lines of the open unstaged diff after one confirmation; bottom-up like staging
  // (the headers of the hunks above stay valid).
  async function discardHunks(sels: Omit<HunkSelection, 'path' | 'staged'>[]) {
    const t = diffTarget.value
    if (busy.value || !info.value || !t || 'sha' in t || t.staged || !sels.length) return
    const lines = sels.reduce((n, s) => n + (s.lines?.length ?? 0), 0)
    const what = sels.some((s) => !s.lines) ? (sels.length === 1 ? 'diesen Hunk' : `${sels.length} Hunks`) : `${lines} ${lines === 1 ? 'Zeile' : 'Zeilen'}`
    if (!(await window.gitspynx.confirm(`${what} in „${t.path}“ verwerfen?`, 'Die Änderungen im Arbeitsverzeichnis gehen verloren; das lässt sich nicht rückgängig machen.', 'Verwerfen'))) return
    const path = info.value.path
    await guard(async () => {
      for (const sel of [...sels].sort((a, b) => b.hunk - a.hunk)) await window.gitspynx.discardHunk(path, { ...sel, path: t.path, staged: false })
    })
    await refreshStatus()
  }

  const stageHunk = (sel: Omit<HunkSelection, 'path' | 'staged'>) =>
    guard(async () => {
      const t = diffTarget.value
      if (busy.value || !info.value || !t || 'sha' in t) return
      await window.gitspynx.stageHunk(info.value.path, { ...sel, path: t.path, staged: t.staged })
      await refreshStatus()
    })

  // A staged rename is a deletion plus an addition; unstage both or the deletion stays staged.
  const unstageFiles = (files: FileStatus[]) => unstage(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))

  function record(path: string, entry: HistoryEntry) {
    const h = histories.value.get(path) ?? { undo: [], redo: [] }
    histories.value = new Map(histories.value).set(path, { undo: [...h.undo, entry].slice(-50), redo: [] })
  }

  // HEAD read from git around an action: the store's view can be overtaken by a watcher reload.
  const gitHead = (path: string) => window.gitspynx.readHead(path).catch(() => ({ sha: null, branch: null }))

  // Runs an action and records it when HEAD moved (commit, merge, rebase, pull …).
  async function recordHeadMove(label: string, mode: 'soft' | 'keep', action: () => Promise<boolean>) {
    const path = info.value?.path
    if (!path) return false
    const before = await gitHead(path)
    const ok = await action()
    const after = await gitHead(path)
    if (ok && before.sha && after.sha && before.sha !== after.sha && before.branch === after.branch)
      record(path, {
        label,
        undo: [{ type: 'reset', expect: after.sha, to: before.sha, mode, branch: after.branch }],
        redo: [{ type: 'reset', expect: before.sha, to: after.sha, mode, branch: before.branch }]
      })
    return ok
  }

  const undoing = ref(false)

  async function step(direction: 'undo' | 'redo') {
    if (!info.value || busy.value || undoing.value) return
    const path = info.value.path
    const entry = histories.value.get(path)?.[direction].at(-1)
    if (!entry) return
    // ahead 0 with an upstream: the commit being taken back is already on the remote
    const reset = entry[direction].find((s) => s.type === 'reset' && s.mode === 'soft')
    const branch = reset?.type === 'reset' ? info.value.refs.find((r) => r.kind === 'local' && r.name === reset.branch) : undefined
    if (
      direction === 'undo' &&
      branch?.upstream &&
      !branch.upstreamGone &&
      !branch.ahead &&
      !(await window.gitspynx.confirm(`„${entry.label}“ ist bereits gepusht.`, 'Rückgängig nimmt den Commit nur lokal zurück; auf dem Remote bleibt er.', 'Trotzdem rückgängig'))
    )
      return
    undoing.value = true
    try {
      const ok = await mutate((r) => window.gitspynx.applyUndo(r, entry[direction]))
      const h = histories.value.get(path)!
      const rest = { ...h, [direction]: h[direction].filter((e) => e !== entry) }
      if (ok) {
        const other = direction === 'undo' ? 'redo' : 'undo'
        histories.value = new Map(histories.value).set(path, { ...rest, [other]: [...rest[other], entry] })
      } else if (/cannot be undone/.test(error.value ?? '')) {
        histories.value = new Map(histories.value).set(path, rest) // the recorded state is gone for good
      }
    } finally {
      undoing.value = false
    }
  }
  const undo = () => step('undo')
  const redo = () => step('redo')

  async function commit(message: string, amend: boolean): Promise<boolean> {
    if (busy.value) return false
    const label = amend ? 'Amend' : `Commit „${message.split('\n')[0]}“`
    return recordHeadMove(label, 'soft', async () => {
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
    })
  }

  // Runs a ref-changing operation, then reloads history. Refused while a network operation runs
  // (a checkout in the middle of a pull would interleave with it). Errors and the reload only
  // apply if the user is still looking at that repository (tabs). Resolves true on success.
  async function mutate(op: (repo: string) => Promise<void>, partOfNetworkOp = false): Promise<boolean> {
    if (!info.value || (busy.value && !partOfNetworkOp)) return false
    const path = info.value.path
    error.value = null
    notice.value = null
    let failure: unknown = null
    try {
      await op(path)
    } catch (e) {
      failure = e ?? new Error('failed')
    }
    if (info.value?.path !== path) {
      if (failure !== null) backgroundErrors.value = new Map(backgroundErrors.value).set(path, message(failure))
      return failure === null
    }
    await refresh() // reloading clears messages, so report afterwards
    if (failure !== null && info.value?.path === path) report(failure)
    return failure === null
  }

  async function checkoutBranch(name: string) {
    const path = info.value?.path
    if (!path) return
    const before = (await gitHead(path)).branch
    if (!(await mutate((r) => window.gitspynx.checkout(r, name)))) return
    const after = (await gitHead(path)).branch
    if (path && before && after && before !== after)
      record(path, { label: `Checkout „${after}“`, undo: [{ type: 'checkout', branch: before }], redo: [{ type: 'checkout', branch: after }] })
  }

  async function createBranch(start: string) {
    const name = await ask('Neuer Branch', '', 'Erstellen und auschecken')
    if (!name || !info.value) return
    const path = info.value.path
    const before = (await gitHead(path)).branch
    if (!(await mutate((r) => window.gitspynx.createBranch(r, name, start, true)))) return
    const sha = (await gitHead(path)).sha
    if (before && sha)
      record(path, {
        label: `Branch „${name}“ erstellt`,
        undo: [{ type: 'checkout', branch: before }, { type: 'deleteBranch', name, expect: sha }],
        redo: [{ type: 'createBranch', name, sha }, { type: 'checkout', branch: name }]
      })
  }

  async function renameBranch(from: string) {
    const to = await ask(`Branch „${from}“ umbenennen`, from, 'Umbenennen')
    if (!to || to === from || !info.value) return
    const path = info.value.path
    if (await mutate((r) => window.gitspynx.renameBranch(r, from, to)))
      record(path, { label: `„${from}“ umbenannt`, undo: [{ type: 'renameBranch', from: to, to: from }], redo: [{ type: 'renameBranch', from, to }] })
  }

  async function deleteBranch(name: string) {
    if (!(await window.gitspynx.confirm(`Branch „${name}“ löschen?`, '', 'Löschen'))) return
    const path = info.value?.path
    const ref = info.value?.refs.find((r) => r.kind === 'local' && r.name === name)
    const sha = ref?.target
    const upstream = ref?.upstreamRemote && ref.upstreamMerge ? { upstream: { remote: ref.upstreamRemote, merge: ref.upstreamMerge } } : {}
    let deleted = false
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
        deleted = force
        return
      }
      deleted = true
    })
    if (deleted && path && sha)
      record(path, { label: `Branch „${name}“ gelöscht`, undo: [{ type: 'createBranch', name, sha, ...upstream }], redo: [{ type: 'deleteBranch', name, expect: sha }] })
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
  async function pullBranch(mode: 'ff-only' | 'rebase' | 'merge' = 'ff-only') {
    const path = info.value?.path
    let result = 'failed' as 'ok' | 'conflicts' | 'failed'
    await recordHeadMove('Pull', 'keep', async () => {
      await network('pull', async (r) => void (result = await window.gitspynx.pull(r, mode)))
      return result === 'ok'
    })
    if (result === 'conflicts' && info.value?.path === path) await select(WIP) // resolve them in the working directory
  }

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
  // With a label, a run that completes without conflicts can be undone.
  async function integrate(op: (repo: string) => Promise<'ok' | 'conflicts'>, label?: string): Promise<boolean> {
    const path = info.value?.path
    let result = 'failed' as 'ok' | 'conflicts' | 'failed' // assigned inside the callback
    const run = async () => (await mutate(async (r) => void (result = await op(r)))) && result === 'ok'
    if (label) await recordHeadMove(label, 'keep', run)
    else await run()
    if (result !== 'conflicts' || info.value?.path !== path) return false
    await select(WIP)
    return true
  }

  // Full refnames (sidebar) avoid ambiguity with a same-named tag; labels show the short name.
  const shortRev = (rev: string) => (/^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev.replace(/^refs\/(heads|remotes|tags)\//, ''))
  // Short name for git, unless a tag or branch shares it (then git would pick one by its own rules).
  const revFor = (r: Ref) => ((info.value?.refs ?? []).some((x) => x.fullName !== r.fullName && x.name === r.name) ? r.fullName : r.name)
  const mergeInto = (rev: string) => integrate((r) => window.gitspynx.merge(r, rev), `Merge „${shortRev(rev)}“`)
  const cherryPick = (sha: string) => integrate((r) => window.gitspynx.cherryPick(r, sha), `Cherry-Pick ${sha.slice(0, 7)}`)
  const revertCommit = (sha: string) => integrate((r) => window.gitspynx.revert(r, sha), `Revert ${sha.slice(0, 7)}`)
  // Merge, cherry-pick and revert keep HEAD on its branch and are recorded like other actions. A
  // rebase runs detached; once Continue finishes it, the branch is recorded as moved from where
  // the rebase started (orig-head) to its new tip.
  async function continueOp() {
    const op = info.value?.operation
    const path = info.value?.path
    if (op !== 'rebase' || !path) return integrate((r) => window.gitspynx.continueOperation(r), op ? `${OP_NAMES[op]} abschließen` : undefined)
    const start = await window.gitspynx.readRebaseState(path).catch(() => null)
    const conflicted = await integrate((r) => window.gitspynx.continueOperation(r))
    if (conflicted || !start || info.value?.path !== path || info.value.operation) return conflicted
    const now = await gitHead(path)
    if (now.branch === start.branch && now.sha && now.sha !== start.origHead)
      record(path, {
        label: 'Rebase abschließen',
        undo: [{ type: 'reset', expect: now.sha, to: start.origHead, mode: 'keep', branch: start.branch }],
        redo: [{ type: 'reset', expect: start.origHead, to: now.sha, mode: 'keep', branch: start.branch }]
      })
    return conflicted
  }
  const skipOp = () => integrate((r) => window.gitspynx.skipOperation(r))

  async function rebaseOnto(rev: string) {
    const branch = info.value?.head.branch
    const ok = await window.gitspynx.confirm(
      `„${branch}“ auf „${shortRev(rev)}“ rebasen?`,
      'Die Commits des Branches werden neu geschrieben. Bereits gepushte Commits brauchen danach einen Force-Push.',
      'Rebase'
    )
    if (ok) await integrate((r) => window.gitspynx.rebase(r, rev), `Rebase auf „${shortRev(rev)}“`)
  }

  const OP_NAMES = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-Pick', revert: 'Revert', am: 'Patch (git am)' }

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

  // Commits whose changes contain a text (git log -S); "re:pattern" searches changed lines with a
  // regular expression (-G). Branch filters apply. Resolves to the matching shas, null for no term.
  async function searchContent(query: string): Promise<Set<string> | null> {
    if (!info.value) return null
    const regex = query.startsWith('re:')
    const term = (regex ? query.slice(3) : query).trim()
    if (!term) return null
    try {
      return new Set(await window.gitspynx.searchContent(info.value.path, tipsFor(info.value), term, regex ? 'regex' : 'text'))
    } catch (e) {
      if (/cancelled/.test(String(e))) return null // replaced by a newer search
      report(e)
      return new Set()
    }
  }

  async function loadAll() {
    const path = info.value?.path
    while (info.value && info.value.path === path && !complete.value) { // another tab shown: stop
      if (loadRun) {
        await loadRun // a reload or page load is running; continue after it
        continue
      }
      const before = commits.value.length
      await loadMore(MAX_LOG_PAGE)
      if (commits.value.length === before && !loadRun) break // error
    }
  }

  // Resolves to the new work tree's path (to open as a tab), or null.
  async function addWorktree(branch: string, fromSha: string | null): Promise<string | null> {
    let path: string | null = null
    await mutate(async (r) => void (path = await window.gitspynx.addWorktree(r, branch, fromSha)))
    return path
  }

  async function removeWorktree(path: string): Promise<boolean> {
    const detail = 'Der Ordner wird samt allen Dateien gelöscht – auch von git ignorierte wie .env oder lokale Datenbanken. Der Branch bleibt erhalten.'
    if (!(await window.gitspynx.confirm(`Worktree „${path}“ entfernen?`, detail, 'Entfernen'))) return false
    let removed = false
    await mutate(async (r) => {
      try {
        await window.gitspynx.removeWorktree(r, path, false)
      } catch (e) {
        if (!/modified or untracked|use --force/.test(String(e))) throw e
        const force = await window.gitspynx.confirm(
          'Der Worktree enthält nicht committete Änderungen.',
          'Beim Entfernen gehen diese Änderungen verloren.',
          'Trotzdem entfernen'
        )
        if (!force) return
        await window.gitspynx.removeWorktree(r, path, true)
      }
      removed = true
    })
    return removed
  }

  async function pruneWorktrees() {
    if (await window.gitspynx.confirm('Verwaiste Worktrees aufräumen?', 'Git vergisst Worktrees, deren Ordner fehlt. Die Branches bleiben erhalten.', 'Aufräumen'))
      await mutate((r) => window.gitspynx.pruneWorktrees(r))
  }

  async function lfsTrack() {
    const pattern = await ask('Dateien über Git LFS speichern – Muster (z. B. *.psd)', '', 'Tracken')
    if (pattern) await mutate((r) => window.gitspynx.lfsTrack(r, pattern))
  }
  const lfsUntrack = (pattern: string) => mutate((r) => window.gitspynx.lfsUntrack(r, pattern))
  const lfsPull = () => network('lfs', (r) => window.gitspynx.lfsPull(r))
  // Fetches from the submodules' remotes, so it counts as a network operation. A submodule with
  // another commit checked out is reset to the recorded one: commits made on its detached HEAD
  // would end up on no branch, so ask first.
  async function updateSubmodules(paths: string[] = []) {
    const subs = info.value?.submodules ?? []
    const targets = paths.length ? subs.filter((s) => paths.includes(s.path)) : subs.filter((s) => s.state !== 'uninitialized')
    const resets = targets.filter((s) => s.state === 'modified')
    if (
      resets.length &&
      !(await window.gitspynx.confirm(
        `${resets.map((s) => s.path).join(', ')} auf den aufgezeichneten Commit zurücksetzen?`,
        'Das Submodul wird auf den im Repository aufgezeichneten Commit gesetzt. Commits, die dort auf keinem Branch liegen, sind danach nur noch über das Reflog erreichbar.',
        'Zurücksetzen'
      ))
    )
      return
    const path = info.value?.path
    let skipped: string[] = []
    await network('submodules', async (r) => void (skipped = await window.gitspynx.updateSubmodules(r, paths)))
    if (skipped.length && info.value?.path === path)
      notice.value = `Nicht aktualisiert: ${skipped.join(', ')} – in .gitmodules oder der lokalen Konfiguration steht update = none.`
  }

  const close = () => {
    void window.gitspynx.closeRepo()
    rebasePlan.value = null
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
    info, commits, complete, loading, error, notice, viewState, undoing, selected, detail, status, staged, unstaged, diffTarget, diff, unstageFiles,
    graph, refsBySha, open, refresh, loadMore, select, refreshStatus, openDiff, closeDiff, stage, unstage, commit, close,
    checkoutBranch, createBranch, renameBranch, deleteBranch, busy, fetchAll, pullBranch, pushBranch, deleteRemoteBranch,
    conflict, mergeInto, rebaseOnto, cherryPick, revertCommit, continueOp, skipOp, abortOp, openConflict, resolve,
    stash, applyStash, popLatestStash, dropStash, stageHunk, discardHunks, addWorktree, removeWorktree, pruneWorktrees, updateSubmodules, lfsTrack, lfsUntrack, lfsPull, undo, redo, undoLabel, redoLabel, rebasePlan, openRebasePlan, startRebase, hidden, solo, toggleHidden, toggleSolo, resetFilters, loadAll, revFor, backgroundErrors, forget, searchContent
  }
})
