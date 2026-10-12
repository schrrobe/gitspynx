import { describe, expect, it } from 'vitest'
import type { FileDiff } from '../../shared/types'
import { keepSelection } from './diffSelection'

const diff = (header: string, texts: string[]): FileDiff => ({
  binary: false,
  header: [],
  hunks: [{ header, lines: texts.map((t) => ({ type: '+', text: t, oldNo: null, newNo: 1 })) }]
})

describe('keepSelection', () => {
  const sel = { hunk: 0, lines: new Set([1]) }

  it('keeps the selection when a refresh brings the same hunk back', () => {
    expect(keepSelection(sel, diff('@@ -1 +1,2 @@', ['a', 'b']), diff('@@ -1 +1,2 @@', ['a', 'b']))).toBe(sel)
  })

  it('drops it when the hunk changed', () => {
    expect(keepSelection(sel, diff('@@ -1 +1,2 @@', ['a', 'b']), diff('@@ -1 +1,3 @@', ['a', 'b', 'c']))).toBeNull()
    expect(keepSelection(sel, diff('@@ -1 +1,2 @@', ['a', 'b']), diff('@@ -1 +1,2 @@', ['a', 'x']))).toBeNull()
  })

  it('drops it when there is no new diff', () => {
    expect(keepSelection(sel, diff('@@ -1 +1,2 @@', ['a']), null)).toBeNull()
  })
})
