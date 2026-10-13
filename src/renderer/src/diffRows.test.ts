import { describe, expect, it } from 'vitest'
import { HUNK_H, LINE_H, offsetOf, rowIndex, visibleRows } from './diffRows'

// hunk 0: 3 lines, hunk 1: 100000 lines
const index = rowIndex([3, 100_000])

describe('diff rows', () => {
  it('places hunk headers and lines one after another', () => {
    expect(offsetOf(index, { hunk: 0, line: -1 })).toBe(0)
    expect(offsetOf(index, { hunk: 0, line: 0 })).toBe(HUNK_H)
    expect(offsetOf(index, { hunk: 1, line: -1 })).toBe(HUNK_H + 3 * LINE_H)
    expect(offsetOf(index, { hunk: 1, line: 5 })).toBe(2 * HUNK_H + 8 * LINE_H)
    expect(index.total).toBe(2 * HUNK_H + 100_003 * LINE_H)
  })

  it('returns only the rows in view, from any depth', () => {
    const top = visibleRows(index, 0, 3 * LINE_H + HUNK_H + 1) // one pixel of the second header is in view
    expect(top[0]).toEqual({ hunk: 0, line: -1, top: 0 })
    expect(top.some((r) => r.hunk === 1 && r.line === -1)).toBe(true)
    const deep = visibleRows(index, offsetOf(index, { hunk: 1, line: 90_000 }), 10 * LINE_H)
    expect(deep[0]).toEqual({ hunk: 1, line: 90_000, top: offsetOf(index, { hunk: 1, line: 90_000 }) })
    expect(deep.length).toBeLessThan(15)
  })
})
