import { describe, expect, it } from 'vitest'
import { parseLog, parseNameStatus, parseRefs } from './parse'

const US = '\x1f'
const RS = '\x1e'

describe('parseLog', () => {
  it('parses commits with zero, one and two parents', () => {
    const out =
      ['c3', 'c2 c9', 'Ann', 'ann@x.io', '1700000300', 'Merge c9'].join(US) + RS + '\n' +
      ['c2', 'c1', 'Bob', 'bob@x.io', '1700000200', 'subject with | pipes'].join(US) + RS + '\n' +
      ['c1', '', 'Bob', 'bob@x.io', '1700000100', 'root'].join(US) + RS + '\n'
    expect(parseLog(out)).toEqual([
      { sha: 'c3', parents: ['c2', 'c9'], author: 'Ann', email: 'ann@x.io', date: 1700000300, subject: 'Merge c9' },
      { sha: 'c2', parents: ['c1'], author: 'Bob', email: 'bob@x.io', date: 1700000200, subject: 'subject with | pipes' },
      { sha: 'c1', parents: [], author: 'Bob', email: 'bob@x.io', date: 1700000100, subject: 'root' }
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
