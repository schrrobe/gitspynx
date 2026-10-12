// Fuzzy matching for the command palette: query characters must appear in order; matches at the
// start or at word starts rank higher than scattered ones. Stable for equal scores.
function score(text: string, query: string): number | null {
  const t = text.toLowerCase()
  let from = 0
  let prev = -2
  let total = 0
  for (const ch of query.toLowerCase()) {
    if (ch === ' ') continue
    const i = t.indexOf(ch, from)
    if (i === -1) return null
    const wordStart = i === 0 || /[\s:/\-_.]/.test(t[i - 1])
    total += i === prev + 1 ? 0 : wordStart ? 1 : 3
    prev = i
    from = i + 1
  }
  return total
}

export function fuzzyRank<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items
  return items
    .map((item, index) => ({ item, index, s: score(text(item), query) }))
    .filter((x): x is { item: T; index: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((x) => x.item)
}
