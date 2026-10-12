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
}

export type Operation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface ConflictVersions {
  base: string | null // null: the file did not exist in that version
  ours: string | null
  theirs: string | null
  merged: string | null // work tree file with conflict markers
  binary: boolean // resolve by choosing a side only
}

export type Resolution = { content: string } | { side: 'ours' | 'theirs' }

// Everything the preload exposes as window.gitspynx.
export interface GitspynxApi {
  pickRepo(): Promise<string | null>
  recentRepos(): Promise<string[]>
  openRepo(path: string): Promise<RepoInfo>
  closeRepo(): Promise<void>
  readLog(repo: string, skip: number, limit: number): Promise<Commit[]> // pages over RepoInfo.tips
  readCommit(repo: string, sha: string): Promise<CommitDetail>
  readStatus(repo: string): Promise<FileStatus[]>
  stage(repo: string, paths: string[]): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  readFileDiff(repo: string, target: DiffTarget): Promise<FileDiff>
  commit(repo: string, message: string, amend: boolean): Promise<void>
  createBranch(repo: string, name: string, start: string, switchTo: boolean): Promise<void>
  checkout(repo: string, branch: string): Promise<void>
  renameBranch(repo: string, from: string, to: string): Promise<void>
  deleteBranch(repo: string, name: string, force: boolean): Promise<void>
  fetch(repo: string): Promise<void>
  pull(repo: string, mode: 'ff-only' | 'rebase' | 'merge'): Promise<void>
  push(repo: string, force: boolean): Promise<'ok' | 'rejected'> // rejected = remote has commits we don't
  deleteRemoteBranch(repo: string, remoteBranch: string): Promise<void>
  merge(repo: string, rev: string): Promise<'ok' | 'conflicts'>
  rebase(repo: string, onto: string): Promise<'ok' | 'conflicts'>
  cherryPick(repo: string, sha: string): Promise<'ok' | 'conflicts'>
  continueOperation(repo: string): Promise<'ok' | 'conflicts'>
  skipOperation(repo: string): Promise<'ok' | 'conflicts'>
  abortOperation(repo: string): Promise<void>
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

export type GitspynxBridge = GitspynxApi & { onRepoChanged(cb: (change: RepoChange) => void): () => void }

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
}

export interface FileDiff {
  binary: boolean
  hunks: { header: string; lines: DiffLine[] }[]
}

export type DiffTarget = { path: string; staged: boolean } | { path: string; sha: string }
