import type { Commit } from '../../shared/types'

// Every word must match the subject, author or email (case-insensitive) or prefix the commit id.
// ponytail: linear scan on the UI thread (~10 ms per 100k commits); a worker if that ever lags
export function searchCommits(commits: Commit[], query: string): number[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits: number[] = []
  commits.forEach((c, i) => {
    const text = `${c.subject}\n${c.author}\n${c.email}`.toLowerCase()
    if (words.every((w) => text.includes(w) || c.sha.startsWith(w))) hits.push(i)
  })
  return hits
}
