import { describe, expect, it } from 'vitest'
import { parseDiff, parseLog, parseNameStatus, parseRefs, parseStatus } from './parse'

const US = '\x1f'

describe('parseLog', () => {
  it('parses NUL-separated commits with zero, one and two parents', () => {
    const out = [
      ['c3', 'c2 c9', 'Ann', 'ann@x.io', '1700000300', 'Merge \x1e c9'],
      ['c2', 'c1', 'Bob', 'bob@x.io', '1700000200', 'subject with \x1f and |'],
      ['c1', '', 'Bob', 'bob@x.io', '1700000100', '']
    ].map((f) => f.join('\0')).join('\0')
    expect(parseLog(out)).toEqual([
      { sha: 'c3', parents: ['c2', 'c9'], author: 'Ann', email: 'ann@x.io', date: 1700000300, subject: 'Merge \x1e c9' },
      { sha: 'c2', parents: ['c1'], author: 'Bob', email: 'bob@x.io', date: 1700000200, subject: 'subject with \x1f and |' },
      { sha: 'c1', parents: [], author: 'Bob', email: 'bob@x.io', date: 1700000100, subject: '' }
    ])
  })

  it('returns an empty list for empty output', () => {
    expect(parseLog('')).toEqual([])
  })
})

describe('parseRefs', () => {
  it('classifies refs, peels annotated tags and reads ahead/behind', () => {
    const out = [
      ['refs/heads/main', 'aaa', '', 'origin/main', '[ahead 2, behind 1]'],
      ['refs/heads/topic', 'bbb', '', '', ''],
      ['refs/remotes/origin/main', 'ccc', '', '', ''],
      ['refs/remotes/origin/HEAD', 'ccc', '', '', ''],
      ['refs/tags/v1', 'tagobj', 'ddd', '', ''],
      ['refs/tags/light', 'eee', '', '', ''],
      ['refs/stash', 'fff', '', '', '']
    ].map((f) => f.join(US)).join('\n') + '\n'
    expect(parseRefs(out)).toEqual([
      { name: 'main', fullName: 'refs/heads/main', kind: 'local', target: 'aaa', upstream: 'origin/main', ahead: 2, behind: 1 },
      { name: 'topic', fullName: 'refs/heads/topic', kind: 'local', target: 'bbb' },
      { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', target: 'ccc' },
      { name: 'v1', fullName: 'refs/tags/v1', kind: 'tag', target: 'ddd' },
      { name: 'light', fullName: 'refs/tags/light', kind: 'tag', target: 'eee' },
      { name: 'stash', fullName: 'refs/stash', kind: 'stash', target: 'fff' }
    ])
  })
})

describe('parseNameStatus', () => {
  it('parses -z name-status output including renames', () => {
    const out = ['M', 'src/a.ts', 'R087', 'old.ts', 'new.ts', 'A', 'b c.txt', 'D', 'gone.md', ''].join('\0')
    expect(parseNameStatus(out)).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
      { status: 'A', path: 'b c.txt' },
      { status: 'D', path: 'gone.md' }
    ])
  })
})

describe('parseStatus', () => {
  it('parses porcelain v2 -z entries', () => {
    const out = [
      '1 M. N... 100644 100644 100644 aaa bbb staged.ts',
      '1 .M N... 100644 100644 100644 aaa aaa edited.ts',
      '1 MM N... 100644 100644 100644 aaa bbb both.ts',
      '2 R. N... 100644 100644 100644 aaa aaa R100 new name.ts',
      'old name.ts',
      'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      '? untracked dir/file.txt',
      ''
    ].join('\0')
    expect(parseStatus(out)).toEqual([
      { path: 'staged.ts', staged: 'M', unstaged: null, conflicted: false },
      { path: 'edited.ts', staged: null, unstaged: 'M', conflicted: false },
      { path: 'both.ts', staged: 'M', unstaged: 'M', conflicted: false },
      { path: 'new name.ts', oldPath: 'old name.ts', staged: 'R', unstaged: null, conflicted: false },
      { path: 'conflict.ts', staged: null, unstaged: 'U', conflicted: true },
      { path: 'untracked dir/file.txt', staged: null, unstaged: '?', conflicted: false }
    ])
  })
})

describe('parseDiff', () => {
  it('splits hunks and numbers old/new lines', () => {
    const out = [
      'diff --git a/f.txt b/f.txt',
      'index 111..222 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,3 +1,3 @@ heading',
      ' keep',
      '-old',
      '+new',
      ' tail',
      '@@ -10,2 +10,3 @@',
      ' a',
      '+b',
      ' c',
      '\\ No newline at end of file',
      ''
    ].join('\n')
    expect(parseDiff(out)).toEqual({
      binary: false,
      hunks: [
        {
          header: '@@ -1,3 +1,3 @@ heading',
          lines: [
            { type: ' ', text: 'keep', oldNo: 1, newNo: 1 },
            { type: '-', text: 'old', oldNo: 2, newNo: null },
            { type: '+', text: 'new', oldNo: null, newNo: 2 },
            { type: ' ', text: 'tail', oldNo: 3, newNo: 3 }
          ]
        },
        {
          header: '@@ -10,2 +10,3 @@',
          lines: [
            { type: ' ', text: 'a', oldNo: 10, newNo: 10 },
            { type: '+', text: 'b', oldNo: null, newNo: 11 },
            { type: ' ', text: 'c', oldNo: 11, newNo: 12 }
          ]
        }
      ]
    })
  })

  it('flags binary files', () => {
    const out = 'diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n'
    expect(parseDiff(out)).toEqual({ binary: true, hunks: [] })
  })
})
