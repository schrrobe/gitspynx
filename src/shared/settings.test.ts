import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from './settings'

describe('parseSettings', () => {
  it('fills defaults for a missing or broken file', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and replaces invalid ones with defaults', () => {
    const s = parseSettings({ version: 1, theme: 'dark', zoom: 1.25, pullMode: 'banana', keymap: { 'repo.fetch': 'Mod+Shift+F', bad: 5 } })
    expect(s.theme).toBe('dark')
    expect(s.zoom).toBe(1.25)
    expect(s.pullMode).toBe(DEFAULT_SETTINGS.pullMode)
    expect(s.keymap).toEqual({ 'repo.fetch': 'Mod+Shift+F' })
  })

  it('clamps zoom to the supported range', () => {
    expect(parseSettings({ zoom: 9 }).zoom).toBe(2)
    expect(parseSettings({ zoom: 0.1 }).zoom).toBe(0.8)
  })

  it('migrates unversioned settings to the current version', () => {
    expect(parseSettings({ theme: 'light' })).toMatchObject({ version: DEFAULT_SETTINGS.version, theme: 'light' })
  })

  it('reads the graph column width, or leaves it automatic', () => {
    expect(parseSettings({}).graphWidth).toBeNull()
    expect(parseSettings({ graphWidth: 300 }).graphWidth).toBe(300)
    expect(parseSettings({ graphWidth: 5 }).graphWidth).toBe(28) // at least two lanes
    expect(parseSettings({ graphWidth: 'wide' }).graphWidth).toBeNull()
  })
})
