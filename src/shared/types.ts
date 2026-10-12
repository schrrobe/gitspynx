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
}

// Everything the preload exposes as window.gitspynx.
export interface GitspynxApi {
  pickRepo(): Promise<string | null>
  recentRepos(): Promise<string[]>
  openRepo(path: string): Promise<RepoInfo>
  readLog(repo: string, skip: number, limit: number): Promise<Commit[]> // pages over RepoInfo.tips
  readCommit(repo: string, sha: string): Promise<CommitDetail>
  readStatus(repo: string): Promise<FileStatus[]>
  stage(repo: string, paths: string[]): Promise<void>
  unstage(repo: string, paths: string[]): Promise<void>
  readFileDiff(repo: string, target: DiffTarget): Promise<FileDiff>
  commit(repo: string, message: string, amend: boolean): Promise<void>
}

// Pushed from main whenever files in the open repository change; git = something under .git/ changed.
export interface RepoChange {
  repo: string
  git: boolean
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
