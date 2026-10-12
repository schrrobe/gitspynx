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

// Recursive watch with a 300 ms debounce; reports the strongest change kind of each burst.
export function watchRepo(path: string, onChange: (kind: 'status' | 'history') => void): FSWatcher {
  let timer: NodeJS.Timeout | undefined
  let pending: 'status' | 'history' | null = null
  const watcher = watch(path, { recursive: true }, (_event, file) => {
    const kind = classifyChange(String(file ?? ''))
    if (kind === 'ignore') return
    if (pending !== 'history') pending = kind
    clearTimeout(timer)
    timer = setTimeout(() => {
      onChange(pending!)
      pending = null
    }, 300)
  })
  watcher.on('close', () => clearTimeout(timer))
  return watcher
}
