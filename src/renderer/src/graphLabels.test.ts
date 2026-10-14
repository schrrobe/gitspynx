import { describe, expect, it } from 'vitest'
import type { Ref } from '../../shared/types'
import { initials, refPills, relativeTime } from './graphLabels'

const r = (name: string, kind: Ref['kind']): Ref => ({ name, fullName: `${kind}/${name}`, kind, target: 'a' })

describe('refPills', () => {
  it('joins a local branch with its remote copy, head first, tags last', () => {
    const pills = refPills([r('v1', 'tag'), r('origin/main', 'remote'), r('feature', 'local'), r('main', 'local')], 'main')
    expect(pills.map((p) => [p.label, p.local, p.remote, p.tag, p.head])).toEqual([
      ['main', true, true, false, true],
      ['feature', true, false, false, false],
      ['v1', false, false, true, false]
    ])
  })

  it('keeps a remote branch without local copy under its remote name', () => {
    expect(refPills([r('origin/fix', 'remote')], null).map((p) => [p.label, p.remote])).toEqual([['origin/fix', true]])
  })
})

describe('initials', () => {
  it('takes first and last name, or the first two letters', () => {
    expect(initials('Junio C Hamano')).toBe('JH')
    expect(initials('ada')).toBe('AD')
    expect(initials('  ')).toBe('?')
  })
})

describe('relativeTime', () => {
  const now = Date.UTC(2026, 9, 14, 12) / 1000
  it('says how long ago in German', () => {
    expect(relativeTime(now - 30, now)).toBe('gerade eben')
    expect(relativeTime(now - 2 * 3600, now)).toBe('vor 2 Stunden')
    expect(relativeTime(now - 3 * 86400, now)).toBe('vor 3 Tagen')
    expect(relativeTime(now - 400 * 86400, now)).toBe('vor 1 Jahr')
  })
})
