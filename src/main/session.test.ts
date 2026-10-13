import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptySession, jsonFile, latestOnly, parseSession, sessionFile, withTabs, withWorkspace, withoutWorkspace } from './session'

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

describe('session file', () => {
  it('serializes overlapping writes atomically and keeps the latest state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitspynx-session-'))
    const file = join(dir, 'session.json')
    const store = sessionFile(file)
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.save({ tabs: Array.from({ length: i % 7 }, (_, j) => `/ok/${j}`), active: 0, workspaces: [] }))
    )
    const final = { tabs: ['/ok/last'], active: 0, workspaces: [] }
    await store.save(final)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(final)
    expect(await sessionFile(file).load()).toEqual(final)
    rmSync(dir, { recursive: true })
  })
})

describe('jsonFile', () => {
  it('falls back to defaults when the file holds invalid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gitspynx-json-'))
    writeFileSync(join(dir, 's.json'), '{"theme": "dark",}')
    const f = jsonFile(join(dir, 's.json'), (raw) => raw ?? 'defaults')
    expect(await f.load()).toBe('defaults')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('latestOnly', () => {
  it('tells whether a request is still the newest one', () => {
    const latest = latestOnly()
    const a = latest.next()
    const b = latest.next()
    expect(latest.isLatest(a)).toBe(false)
    expect(latest.isLatest(b)).toBe(true)
  })
})
