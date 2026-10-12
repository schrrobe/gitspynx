import { describe, expect, it } from 'vitest'
import { parseDiff } from './parse'
import { buildPatch } from './patch'

const diff = parseDiff(
  [
    'diff --git a/f.txt b/f.txt',
    'index 111..222 100644',
    '--- a/f.txt',
    '+++ b/f.txt',
    '@@ -1,4 +1,4 @@',
    ' keep',
    '-old1',
    '-old2',
    '+new1',
    '+new2',
    ' tail',
    ''
  ].join('\n')
)

describe('buildPatch', () => {
  it('keeps the file header from the diff', () => {
    expect(diff.header).toEqual(['diff --git a/f.txt b/f.txt', 'index 111..222 100644', '--- a/f.txt', '+++ b/f.txt'])
  })

  it('builds a patch for a whole hunk', () => {
    expect(buildPatch(diff, 0, undefined, false)).toBe(
      ['diff --git a/f.txt b/f.txt', 'index 111..222 100644', '--- a/f.txt', '+++ b/f.txt', '@@ -1,4 +1,4 @@', ' keep', '-old1', '-old2', '+new1', '+new2', ' tail', ''].join('\n')
    )
  })

  it('stages selected lines: unselected removals become context, unselected additions are dropped', () => {
    // lines: 0 keep, 1 -old1, 2 -old2, 3 +new1, 4 +new2, 5 tail
    const patch = buildPatch(diff, 0, [1, 3], false)
    expect(patch.split('\n').slice(4)).toEqual(['@@ -1,4 +1,4 @@', ' keep', '-old1', ' old2', '+new1', ' tail', ''])
  })

  it('unstages selected lines (applied in reverse): unselected additions become context, unselected removals are dropped', () => {
    const patch = buildPatch(diff, 0, [4], true)
    expect(patch.split('\n').slice(4)).toEqual(['@@ -1,3 +1,4 @@', ' keep', ' new1', '+new2', ' tail', ''])
  })

  it('keeps the no-newline marker after the last line', () => {
    const d = parseDiff(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b', '\\ No newline at end of file', ''].join('\n'))
    expect(buildPatch(d, 0, undefined, false).split('\n').slice(3)).toEqual([
      '@@ -1,1 +1,1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
      ''
    ])
  })

  it('rejects a selection without any change', () => {
    expect(() => buildPatch(diff, 0, [0, 5], false)).toThrow(/no changed lines/)
  })
})

describe('buildPatch at end of file without newline', () => {
  const d = parseDiff(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-x', '\\ No newline at end of file', '+y', '\\ No newline at end of file', ''].join('\n'))

  it('refuses a selection that would turn the last line into context before other lines', () => {
    expect(() => buildPatch(d, 0, [1], false)).toThrow(/last line/) // only +y: -x would become context before it
    expect(() => buildPatch(d, 0, [0], true)).toThrow(/last line/)
  })

  it('still allows the whole change', () => {
    expect(() => buildPatch(d, 0, [0, 1], false)).not.toThrow()
  })
})
