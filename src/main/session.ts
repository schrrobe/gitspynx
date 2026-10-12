import { readFile, rename, writeFile } from 'node:fs/promises'
import type { Session, Workspace } from '../shared/types'

// Open tabs and saved workspaces, persisted as JSON in userData.

export const emptySession = (): Session => ({ tabs: [], active: 0, workspaces: [] })

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function parseSession(raw: unknown): Session {
  if (!raw || typeof raw !== 'object') return emptySession()
  const r = raw as Record<string, unknown>
  const tabs = strings(r.tabs)
  const active = Number.isInteger(r.active) && (r.active as number) < tabs.length ? (r.active as number) : 0
  const workspaces = (Array.isArray(r.workspaces) ? r.workspaces : [])
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && typeof w.name === 'string')
    .map((w): Workspace => ({ name: w.name as string, repos: strings(w.repos) }))
  return { tabs, active, workspaces }
}

export function withTabs(s: Session, tabs: string[], active: number, allowed: (path: string) => boolean): Session {
  const kept = [...new Set(tabs.filter(allowed))]
  return { ...s, tabs: kept, active: Math.max(0, Math.min(active, kept.length - 1)) }
}

export function withWorkspace(s: Session, name: string, repos: string[], allowed: (path: string) => boolean): Session {
  const trimmed = name.trim().slice(0, 100)
  if (!trimmed) throw new Error('workspace name is empty')
  const ws = { name: trimmed, repos: [...new Set(repos.filter(allowed))] }
  return { ...s, workspaces: [...s.workspaces.filter((w) => w.name !== trimmed), ws] }
}

export const withoutWorkspace = (s: Session, name: string): Session => ({ ...s, workspaces: s.workspaces.filter((w) => w.name !== name) })

// session.json on disk: one cached load, writes serialized and atomic (temp file + rename), so
// overlapping saves can neither interleave into invalid JSON nor let an older state win.
export function sessionFile(file: string) {
  let loaded: Promise<Session> | null = null
  let latest: Session | null = null
  let writing: Promise<void> = Promise.resolve()
  return {
    load(): Promise<Session> {
      loaded ??= readFile(file, 'utf8').then((t) => parseSession(JSON.parse(t)), () => emptySession())
      return loaded
    },
    save(s: Session): Promise<void> {
      latest = s
      loaded = Promise.resolve(s)
      writing = writing.then(async () => {
        const tmp = `${file}.tmp`
        await writeFile(tmp, JSON.stringify(latest, null, 2))
        await rename(tmp, file)
      })
      return writing
    }
  }
}

// Request counter: only the newest of overlapping requests may act on its result.
export function latestOnly() {
  let n = 0
  return { next: () => ++n, isLatest: (id: number) => id === n }
}
