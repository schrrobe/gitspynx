import type { FileDiff } from '../../shared/types'

// Selected changed lines per hunk (hunk index → line indexes within the hunk).
export type LineSelection = Map<number, Set<number>>
export interface LinePos {
  hunk: number
  line: number
}

const sameHunk = (a: FileDiff['hunks'][number] | undefined, b: FileDiff['hunks'][number] | undefined) =>
  !!a && !!b && a.header === b.header && a.lines.length === b.lines.length && a.lines.every((l, i) => l.type === b.lines[i].type && l.text === b.lines[i].text)

// A background refresh (watcher, staging another hunk) replaces the diff object; the selection of
// every hunk that came back unchanged survives.
export function keepSelection(sel: LineSelection, prev: FileDiff | null, next: FileDiff | null): LineSelection {
  if (!prev || !next) return new Map()
  return new Map([...sel].filter(([h]) => sameHunk(prev.hunks[h], next.hunks[h])))
}

const changed = (diff: FileDiff, p: LinePos) => diff.hunks[p.hunk]?.lines[p.line]?.type !== ' ' && !!diff.hunks[p.hunk]?.lines[p.line]

export function toggleLine(sel: LineSelection, diff: FileDiff, hunk: number, line: number): LineSelection {
  if (!changed(diff, { hunk, line })) return sel
  const next = new Map(sel)
  const lines = new Set(next.get(hunk))
  if (!lines.delete(line)) lines.add(line)
  if (lines.size) next.set(hunk, lines)
  else next.delete(hunk)
  return next
}

// All changed lines between two positions (either order, across hunks) are added.
export function selectRange(sel: LineSelection, diff: FileDiff, a: LinePos, b: LinePos): LineSelection {
  const before = (x: LinePos, y: LinePos) => x.hunk < y.hunk || (x.hunk === y.hunk && x.line <= y.line)
  const [from, to] = before(a, b) ? [a, b] : [b, a]
  const next = new Map(sel)
  for (let h = from.hunk; h <= to.hunk; h++) {
    const lines = new Set(next.get(h))
    diff.hunks[h].lines.forEach((l, i) => {
      if (l.type !== ' ' && before(from, { hunk: h, line: i }) && before({ hunk: h, line: i }, to)) lines.add(i)
    })
    if (lines.size) next.set(h, lines)
  }
  return next
}

// The next (delta 1) or previous (-1) changed line; from nowhere, the first one.
export function moveCursor(diff: FileDiff, cursor: LinePos | null, delta: 1 | -1): LinePos | null {
  const all = diff.hunks.flatMap((h, hunk) => h.lines.flatMap((l, line) => (l.type === ' ' ? [] : [{ hunk, line }])))
  if (!all.length) return null
  if (!cursor) return all[0]
  const i = all.findIndex((p) => p.hunk === cursor.hunk && p.line === cursor.line)
  return all[Math.min(all.length - 1, Math.max(0, (i === -1 ? 0 : i) + delta))]
}
