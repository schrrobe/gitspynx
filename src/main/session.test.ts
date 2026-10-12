import { describe, expect, it } from 'vitest'
import { emptySession, parseSession, withTabs, withWorkspace, withoutWorkspace } from './session'

const allow = (p: string) => p.startsWith('/ok/')

describe('session', () => {
  it('parses a stored session and drops malformed parts', () => {
    expect(parseSession({ tabs: ['/ok/a', 3, '/ok/b'], active: 1, workspaces: [{ name: 'W', repos: ['/ok/a'] }, { name: 7 }] })).toEqual({
      tabs: ['/ok/a', '/ok/b'],
      active: 1,
      workspaces: [{ name: 'W', repos: ['/ok/a'] }]
    })
    expect(parseSession('garbage')).toEqual(emptySession())
    expect(parseSession({ tabs: ['/ok/a'], active: 5 }).active).toBe(0)
  })

  it('stores only allowed, de-duplicated tabs and clamps the active index', () => {
    const s = withTabs(emptySession(), ['/ok/a', '/etc', '/ok/a', '/ok/b'], 3, allow)
    expect(s.tabs).toEqual(['/ok/a', '/ok/b'])
    expect(s.active).toBe(1)
    expect(withTabs(emptySession(), [], 0, allow)).toMatchObject({ tabs: [], active: 0 })
  })

  it('saves, replaces and deletes workspaces by name', () => {
    let s = withWorkspace(emptySession(), 'Team', ['/ok/a', '/nope'], allow)
    expect(s.workspaces).toEqual([{ name: 'Team', repos: ['/ok/a'] }])
    s = withWorkspace(s, 'Team', ['/ok/b'], allow)
    expect(s.workspaces).toEqual([{ name: 'Team', repos: ['/ok/b'] }])
    s = withoutWorkspace(s, 'Team')
    expect(s.workspaces).toEqual([])
  })

  it('rejects an empty or blank workspace name', () => {
    expect(() => withWorkspace(emptySession(), '  ', ['/ok/a'], allow)).toThrow()
  })
})
