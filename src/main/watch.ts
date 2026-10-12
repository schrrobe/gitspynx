import { type FSWatcher, watch } from 'node:fs'

export type ChangeKind = 'ignore' | 'status' | 'history'

// file is relative to the work tree, as reported by fs.watch (backslashes on Windows).
export function classifyChange(file: string): ChangeKind {
  const f = file.replaceAll('\\', '/')
  if (f.startsWith('.git/objects/') || f.endsWith('.lock')) return 'ignore'
  if (f === '.git/index') return 'status' // staging, or another tool refreshing the index
  if (f === '.git' || f.startsWith('.git/')) return 'history'
  return 'status'
}

export interface RepoWatcher {
  close(): void
}

// Recursive watch of the work tree (plus git dirs living elsewhere, e.g. linked worktrees)
// with a 300 ms debounce; reports the strongest change kind of each burst.
export function watchRepo(
  path: string,
  outsideGitDirs: string[],
  onChange: (kind: 'status' | 'history') => void,
  onError: (e: Error) => void = () => {}
): RepoWatcher {
  let timer: NodeJS.Timeout | undefined
  let pending: 'status' | 'history' | null = null
  const report = (file: string) => {
    const kind = classifyChange(file)
    if (kind === 'ignore') return
    if (pending !== 'history') pending = kind
    clearTimeout(timer)
    timer = setTimeout(() => {
      onChange(pending!)
      pending = null
    }, 300)
  }
  const watchers: FSWatcher[] = [
    watch(path, { recursive: true }, (_e, file) => report(String(file ?? ''))),
    ...outsideGitDirs.map((dir) => watch(dir, { recursive: true }, (_e, file) => report(`.git/${file ?? ''}`)))
  ]
  for (const w of watchers) w.on('error', onError)
  return {
    close() {
      clearTimeout(timer)
      for (const w of watchers) w.close()
    }
  }
}
