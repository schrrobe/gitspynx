import { describe, expect, it } from 'vitest'
import { searchCommits } from './search'

const commits = [
  { sha: 'abc1234def', parents: [], author: 'Ada Lovelace', email: 'ada@example.com', date: 0, subject: 'Fix login bug' },
  { sha: 'fff0000aaa', parents: [], author: 'Bob', email: 'bob@example.com', date: 0, subject: 'Add LOGIN page' },
  { sha: '1234abcd00', parents: [], author: 'Carol', email: 'carol@corp.io', date: 0, subject: 'Refactor' }
]

describe('searchCommits', () => {
  it('matches subjects case-insensitively and returns row indexes in order', () => {
    expect(searchCommits(commits, 'login')).toEqual([0, 1])
  })

  it('matches author names and emails', () => {
    expect(searchCommits(commits, 'lovelace')).toEqual([0])
    expect(searchCommits(commits, 'corp.io')).toEqual([2])
  })

  it('matches commit ids by prefix only', () => {
    expect(searchCommits(commits, 'abc12')).toEqual([0])
    expect(searchCommits(commits, '1234')).toEqual([2]) // "1234" inside abc1234def is not a prefix
  })

  it('requires every word to match', () => {
    expect(searchCommits(commits, 'login bob')).toEqual([1])
  })

  it('returns nothing for a blank query', () => {
    expect(searchCommits(commits, '   ')).toEqual([])
  })
})
