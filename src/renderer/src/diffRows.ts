// Row geometry of the virtualized diff: per hunk a header row followed by its lines, all with
// fixed heights, so any depth is found by arithmetic (a binary search over the hunk starts).
export const HUNK_H = 30
export const LINE_H = 18

export interface RowIndex {
  starts: number[] // offset of each hunk's header
  counts: number[] // lines per hunk
  total: number
}

export function rowIndex(lineCounts: number[]): RowIndex {
  const starts: number[] = []
  let y = 0
  for (const n of lineCounts) {
    starts.push(y)
    y += HUNK_H + n * LINE_H
  }
  return { starts, counts: lineCounts, total: y }
}

// line -1: the hunk's header row
export const offsetOf = (index: RowIndex, pos: { hunk: number; line: number }) =>
  index.starts[pos.hunk] + (pos.line < 0 ? 0 : HUNK_H + pos.line * LINE_H)

export function visibleRows(index: RowIndex, scrollTop: number, height: number) {
  const rows: { hunk: number; line: number; top: number }[] = []
  let lo = 0
  let hi = index.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (index.starts[mid] <= scrollTop) lo = mid
    else hi = mid - 1
  }
  const bottom = scrollTop + height
  for (let h = lo; h < index.starts.length && index.starts[h] < bottom; h++) {
    if (index.starts[h] + HUNK_H > scrollTop) rows.push({ hunk: h, line: -1, top: index.starts[h] })
    const first = Math.max(0, Math.floor((scrollTop - index.starts[h] - HUNK_H) / LINE_H))
    for (let l = first; l < index.counts[h]; l++) {
      const top = index.starts[h] + HUNK_H + l * LINE_H
      if (top >= bottom) break
      if (top + LINE_H > scrollTop) rows.push({ hunk: h, line: l, top })
    }
  }
  return rows
}
