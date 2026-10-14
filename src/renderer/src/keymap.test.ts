import { describe, expect, it } from 'vitest'
import { comboFromEvent, normalizeCombo, reservedCombo, resolveKeymap } from './keymap'

const ev = (key: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods
})

describe('keymap', () => {
  it('turns key events into combos, Mod = Cmd on macOS', () => {
    expect(comboFromEvent(ev('p', { metaKey: true, shiftKey: true }), true)).toBe('Mod+Shift+P')
    expect(comboFromEvent(ev('p', { ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+P')
    expect(comboFromEvent(ev('Tab', { ctrlKey: true }), true)).toBe('Ctrl+Tab')
    expect(comboFromEvent(ev('Enter', { metaKey: true }), true)).toBe('Mod+Enter')
  })

  it('reads AltGr characters as typed text, not as Mod+Alt (Windows)', () => {
    const altGr = { ...ev('@', { ctrlKey: true, altKey: true }), getModifierState: (k: string) => k === 'AltGraph' }
    expect(comboFromEvent(altGr, false)).toBe('@')
  })

  it('reserves editing keys that a shortcut must not take over', () => {
    expect(reservedCombo('Mod+C')).toBe(true)
    expect(reservedCombo('Mod+Shift+Z')).toBe(true)
    expect(reservedCombo('ArrowDown')).toBe(true)
    expect(reservedCombo('Enter')).toBe(true)
    expect(reservedCombo('Mod+Enter')).toBe(false)
    expect(reservedCombo('Mod+Shift+P')).toBe(false)
  })

  it('falls back to the physical key when the key is a dead key', () => {
    expect(comboFromEvent({ ...ev('Dead', { ctrlKey: true }), code: 'Backquote' }, true)).toBe('Ctrl+`')
  })

  it('ignores pure modifier presses', () => {
    expect(comboFromEvent(ev('Shift', { shiftKey: true }), true)).toBeNull()
  })

  it('normalizes user-written combos (order, case, aliases)', () => {
    expect(normalizeCombo('shift+cmd+p', true)).toBe('Mod+Shift+P')
    expect(normalizeCombo('Ctrl + l', true)).toBe('Ctrl+L')
    expect(normalizeCombo('mod+,', true)).toBe('Mod+,')
    expect(normalizeCombo('Mod+', true)).toBeNull()
    expect(normalizeCombo('Hyper+X', true)).toBeNull()
  })

  it('treats Ctrl as Mod outside macOS', () => {
    expect(normalizeCombo('Ctrl+L', false)).toBe('Mod+L')
  })
})

describe('resolveKeymap', () => {
  const commands = [
    { id: 'a', keys: 'Mod+L' },
    { id: 'b', keys: 'Mod+B' },
    { id: 'c' }
  ]

  it('maps default combos to commands', () => {
    const { byCombo } = resolveKeymap(commands, {}, true)
    expect(byCombo.get('Mod+L')).toBe('a')
    expect(byCombo.get('Mod+B')).toBe('b')
  })

  it('lets overrides replace or remove defaults and add shortcuts', () => {
    const { byCombo, byCommand } = resolveKeymap(commands, { a: 'cmd+shift+l', b: '', c: 'Mod+K' }, true)
    expect(byCombo.get('Mod+Shift+L')).toBe('a')
    expect(byCombo.has('Mod+L')).toBe(false)
    expect(byCommand.get('b')).toBeUndefined()
    expect(byCombo.get('Mod+K')).toBe('c')
  })

  it('reports conflicts and invalid overrides', () => {
    const { conflicts, invalid } = resolveKeymap(commands, { c: 'Mod+L', b: 'Hyper+Q' }, true)
    expect(conflicts).toEqual([['Mod+L', ['a', 'c']]])
    expect(invalid).toEqual(['b'])
  })
})

describe('layouts', () => {
  it('names the plus key and ignores Shift for symbol keys', () => {
    expect(comboFromEvent(ev('+', { metaKey: true }), true)).toBe('Mod+Plus') // German "+" key
    expect(comboFromEvent(ev('+', { metaKey: true, shiftKey: true }), true)).toBe('Mod+Plus') // US Shift+=
    expect(comboFromEvent(ev('=', { metaKey: true, shiftKey: true }), true)).toBe('Mod+=') // German Shift+0
    expect(comboFromEvent(ev('P', { metaKey: true, shiftKey: true }), true)).toBe('Mod+Shift+P') // letters keep Shift
  })

  it('falls back to the physical key on non-Latin layouts', () => {
    expect(comboFromEvent({ ...ev('а', { ctrlKey: true }), code: 'KeyF' }, false)).toBe('Mod+F')
  })

  it('parses plus in written combos', () => {
    expect(normalizeCombo('Cmd++', true)).toBe('Mod+Plus')
    expect(normalizeCombo('cmd+plus', true)).toBe('Mod+Plus')
    expect(normalizeCombo('Cmd+Shift+=', true)).toBe('Mod+=')
  })

  it('accepts several default combos for one command', () => {
    const { byCombo, byCommand } = resolveKeymap([{ id: 'zoom', keys: ['Mod+=', 'Mod+Plus'] }], {}, true)
    expect(byCombo.get('Mod+=')).toBe('zoom')
    expect(byCombo.get('Mod+Plus')).toBe('zoom')
    expect(byCommand.get('zoom')).toBe('Mod+=')
  })
})
