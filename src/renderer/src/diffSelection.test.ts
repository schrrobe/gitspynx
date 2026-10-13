import { describe, expect, it } from 'vitest'
import type { DiffLine, FileDiff } from '../../shared/types'
import { keepSelection, moveCursor, selectRange, toggleLine } from './diffSelection'

const line = (t: string): DiffLine => ({ type: t[0] as DiffLine['type'], text: t.slice(1), oldNo: null, newNo: null })
const diff = (...hunks: [string, string[]][]): FileDiff => ({
  binary: false,
  header: [],
  hunks: hunks.map(([header, lines]) => ({ header, lines: lines.map(line) }))
})
// hunk 0: context, +a, -b ; hunk 1: +c, context, +d
const two = diff(['@@ -1,2 +1,2 @@', [' x', '+a', '-b']], ['@@ -9,1 +9,3 @@', ['+c', ' y', '+d']])
const pairs = (sel: Map<number, Set<number>>) => [...sel].flatMap(([h, ls]) => [...ls].map((l) => `${h}:${l}`)).sort()

describe('keepSelection', () => {
  const sel = new Map([[0, new Set([1])], [1, new Set([0])]])

  it('keeps the selection of hunks a refresh brings back unchanged', () => {
    expect(pairs(keepSelection(sel, two, two))).toEqual(['0:1', '1:0'])
  })

  it('drops only the hunks that changed', () => {
    const changed = diff(['@@ -1,2 +1,2 @@', [' x', '+a', '-b']], ['@@ -9,1 +9,4 @@', ['+c', ' y', '+d', '+e']])
    expect(pairs(keepSelection(sel, two, changed))).toEqual(['0:1'])
  })

  it('drops everything when there is no new diff', () => {
    expect(keepSelection(sel, two, null).size).toBe(0)
  })
})

describe('toggleLine and selectRange', () => {
  it('toggles single changed lines and ignores context lines', () => {
    let sel = toggleLine(new Map(), two, 0, 1)
    sel = toggleLine(sel, two, 1, 2)
    sel = toggleLine(sel, two, 0, 0) // context
    expect(pairs(sel)).toEqual(['0:1', '1:2'])
    expect(pairs(toggleLine(sel, two, 0, 1))).toEqual(['1:2'])
  })

  it('selects every changed line between anchor and target, across hunks, keeping earlier picks', () => {
    const start = toggleLine(new Map(), two, 1, 2)
    expect(pairs(selectRange(start, two, { hunk: 0, line: 2 }, { hunk: 1, line: 0 }))).toEqual(['0:2', '1:0', '1:2'])
    expect(pairs(selectRange(new Map(), two, { hunk: 1, line: 2 }, { hunk: 0, line: 1 }))).toEqual(['0:1', '0:2', '1:0', '1:2'])
  })
})

describe('moveCursor', () => {
  it('steps over context lines and across hunks, staying put at the ends', () => {
    expect(moveCursor(two, null, 1)).toEqual({ hunk: 0, line: 1 })
    expect(moveCursor(two, { hunk: 0, line: 2 }, 1)).toEqual({ hunk: 1, line: 0 })
    expect(moveCursor(two, { hunk: 1, line: 0 }, 1)).toEqual({ hunk: 1, line: 2 })
    expect(moveCursor(two, { hunk: 1, line: 2 }, 1)).toEqual({ hunk: 1, line: 2 })
    expect(moveCursor(two, { hunk: 1, line: 0 }, -1)).toEqual({ hunk: 0, line: 2 })
  })
})
