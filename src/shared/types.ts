import type { Settings } from './settings'

// Most commits one readLog call returns (a refresh re-reads what is loaded, up to this).
export const MAX_LOG_PAGE = 50_000

export interface Commit {
  sha: string
  parents: string[]
  author: string
  email: string
  date: number // epoch seconds
  subject: string
}

export interface Ref {
  name: string
  fullName: string
  kind: 'local' | 'remote' | 'tag' | 'stash'
  target: string // commit sha (annotated tags are peeled)
  upstream?: string
  upstreamRemote?: string // branch.<name>.remote
  upstreamMerge?: string // branch.<name>.merge
  ahead?: number
  behind?: number
}

export interface FileChange {
  status: string // A M D R C T U
  path: string
  oldPath?: string
}

export interface CommitDetail extends Commit {
  body: string
  committer: string
  committerDate: number
  files: FileChange[]
}

export interface RepoInfo {
  path: string
  head: { branch: string | null; sha: string | null } // branch null = detached, sha null = unborn
  refs: Ref[]
  tips: string[] // commits the log pages over; fixed until the repo is reopened
  operation: Operation | null // multi-step operation waiting for conflicts to be resolved
  stashes: Commit[] // newest first; subject like "On main: message"
  worktrees: Worktree[] // first = main work tree
  submodules: Submodule[]
  lfs: LfsInfo | null // null: the repository does not use Git LFS
}

export interface LfsInfo {
  installed: boolean // git-lfs available
  configured: boolean // LFS filters set up (globally or for this repository)
  patterns: string[] // tracked patterns
}

export interface Submodule {
  path: string // relative to the work tree
  sha: string // recorded commit (checked-out commit when modified)
  state: 'ok' | 'uninitialized' | 'modified' | 'conflict'
}

export interface Worktree {
  path: string
  head: string
  branch: string | null // null = detached
  main: boolean
  locked: boolean
  prunable: boolean // its folder is gone
}

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface ConflictVersions {
  base: string | null // null: the file did not exist in that version
  ours: string | null
  theirs: string | null
  merged: string | null // work tree file with conflict markers
  binary: boolean // resolve by choosing a side only
}

export type Resolution = { content: string } | { side: 'ours' | 'theirs' } | { delete: true }

// Everything the preload exposes as window.gitspynx.
export interface GitspynxApi {
  pickRepo(): Promise<string | null>
  recentRepos(): Promise<string[]>
  openRepo(path: string): Promise<RepoInfo>
  closeRepo(): Promise<void>
  getSession(): Promise<Session>
  saveTabs(tabs: string[], active: number): Promise<void>
  saveWorkspace(name: string, repos: string[]): Promise<Session>
  deleteWorkspace(name: string): Promise<Session>
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<Settings>
  // pages over RepoInfo.tips, or over a subset of them (branch filters)
  readLog(repo: string, skip: number, limit: number, tips?: string[]): Promise<Commit[]>
  readCommit(repo: string, sha: string): Promise<CommitDetail>
  readStatus(repo: string): Promise<FileStatus[]>
  stage(repo: string, paths: string[]): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  readFileDiff(repo: string, target: DiffTarget): Promise<FileDiff>
  stageHunk(repo: string, selection: HunkSelection): Promise<void>
  readRebasePlan(repo: string, base: string): Promise<RebaseCommit[]>
  interactiveRebase(repo: string, base: string, steps: RebaseStep[]): Promise<'ok' | 'conflicts'>
  applyUndo(repo: string, steps: UndoStep[]): Promise<void>
  readHead(repo: string): Promise<{ sha: string | null; branch: string | null }>
  // Asks for the folder in a dialog; resolves to the new work tree's path, or null if cancelled.
  addWorktree(repo: string, branch: string, fromSha: string | null): Promise<string | null>
  removeWorktree(repo: string, path: string, force: boolean): Promise<void>
  pruneWorktrees(repo: string): Promise<void>
  updateSubmodules(repo: string, paths: string[]): Promise<void> // [] = all
  lfsTrack(repo: string, pattern: string): Promise<void>
  lfsUntrack(repo: string, pattern: string): Promise<void>
  lfsPull(repo: string): Promise<void>
  terminalStart(repo: string, cols: number, rows: number): Promise<number> // login shell in the repository; returns its id
  terminalWrite(id: number, data: string): Promise<void>
  terminalResize(id: number, cols: number, rows: number): Promise<void>
  terminalKill(id: number): Promise<void>
  commit(repo: string, message: string, amend: boolean): Promise<void>
  createBranch(repo: string, name: string, start: string, switchTo: boolean): Promise<void>
  checkout(repo: string, branch: string): Promise<void>
  renameBranch(repo: string, from: string, to: string): Promise<void>
  deleteBranch(repo: string, name: string, force: boolean): Promise<void>
  fetch(repo: string): Promise<void>
  pull(repo: string, mode: 'ff-only' | 'rebase' | 'merge'): Promise<'ok' | 'conflicts'>
  push(repo: string, force: boolean): Promise<'ok' | 'rejected'> // rejected = remote has commits we don't
  deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void>
  merge(repo: string, rev: string): Promise<'ok' | 'conflicts'>
  rebase(repo: string, onto: string): Promise<'ok' | 'conflicts'>
  cherryPick(repo: string, sha: string): Promise<'ok' | 'conflicts'>
  continueOperation(repo: string): Promise<'ok' | 'conflicts'>
  skipOperation(repo: string): Promise<'ok' | 'conflicts'>
  abortOperation(repo: string): Promise<void>
  stashPush(repo: string, message: string): Promise<void>
  stashApply(repo: string, sha: string, pop: boolean): Promise<'ok' | 'conflicts'>
  stashDrop(repo: string, sha: string): Promise<void>
  readConflict(repo: string, path: string): Promise<ConflictVersions>
  resolveConflict(repo: string, path: string, resolution: Resolution): Promise<void>
  showContextMenu(items: MenuItem[]): Promise<string | null> // id of the clicked item
  confirm(message: string, detail: string, okLabel: string): Promise<boolean>
}

export type MenuItem = { id: string; label: string; enabled?: boolean } | { separator: true }

// Pushed from main when files in the open repository change: refs/HEAD (history) or files/index (status).
export interface RepoChange {
  repo: string
  kind: 'status' | 'history'
}

export type GitspynxBridge = GitspynxApi & {
  onRepoChanged(cb: (change: RepoChange) => void): () => void
  onTerminalData(cb: (id: number, data: string) => void): () => void
  onTerminalExit(cb: (id: number, exitCode: number) => void): () => void
}

export interface FileStatus {
  path: string
  oldPath?: string
  staged: string | null // index status letter, null = unchanged
  unstaged: string | null // work tree status letter, '?' = untracked
  conflicted: boolean
}

export interface DiffLine {
  type: ' ' | '+' | '-'
  text: string
  oldNo: number | null
  newNo: number | null
  noEol?: true // followed by "\ No newline at end of file"
}

export interface FileDiff {
  binary: boolean
  header: string[] // file header lines before the first hunk (diff --git, index, ---, +++)
  hunks: { header: string; lines: DiffLine[] }[]
}

// A hunk (and optionally some of its lines) to stage from the unstaged diff, or to unstage from
// the staged diff. hunkHeader guards against a diff that changed since it was displayed.
export interface HunkSelection {
  path: string
  staged: boolean
  hunk: number
  hunkHeader: string
  hunkLines: string // hunkKey() of the hunk as displayed
  lines?: number[] // indexes into the hunk's lines; all changes when omitted
}

export type DiffTarget = { path: string; staged: boolean } | { path: string; sha: string }

export interface Workspace {
  name: string
  repos: string[] // work tree paths
}

export interface Session {
  tabs: string[] // open repositories (work tree paths), in tab order
  active: number
  workspaces: Workspace[]
}

export interface RebaseCommit {
  sha: string
  subject: string
  message: string // full message (subject and body), the starting point for rewording
}

export type RebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'

export interface RebaseStep {
  sha: string
  action: RebaseAction
  message?: string // new message for reword
}

// One step of an undo or redo; main checks the expected state before each step.
export type UndoStep =
  | { type: 'reset'; expect: string; to: string; mode: 'soft' | 'keep'; branch: string | null } // branch: expected checked-out branch
  | { type: 'checkout'; branch: string }
  | { type: 'createBranch'; name: string; sha: string; upstream?: { remote: string; merge: string } }
  | { type: 'deleteBranch'; name: string; expect: string }
  | { type: 'renameBranch'; from: string; to: string }
