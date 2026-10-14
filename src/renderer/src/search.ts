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

// Row index of the next (delta 1) or previous (-1) hit relative to the selected row, wrapping.
// Derived from the selection so reloading or paging history never loses the position.
export function nextHit(hits: number[], selected: number, delta: 1 | -1): number {
  if (!hits.length) return -1
  if (delta === 1) return hits.find((i) => i > selected) ?? hits[0]
  return [...hits].reverse().find((i) => i < selected && selected !== -1) ?? hits[hits.length - 1]
}
