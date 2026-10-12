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
}

// Everything the preload exposes as window.gitspynx.
export interface GitspynxApi {
  pickRepo(): Promise<string | null>
  recentRepos(): Promise<string[]>
  openRepo(path: string): Promise<RepoInfo>
  readLog(repo: string, skip: number, limit: number): Promise<Commit[]>
  readCommit(repo: string, sha: string): Promise<CommitDetail>
}
