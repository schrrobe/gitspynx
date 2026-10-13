// Key combos as strings like "Mod+Shift+P". Mod = Cmd on macOS, Ctrl elsewhere; on macOS Ctrl is
// its own modifier (Ctrl+Tab), elsewhere it is the same as Mod.

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta'])
const NAMED: Record<string, string> = {
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', space: 'Space', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus'
}

function keyName(key: string): string | null {
  if (key === ' ') return 'Space'
  if (key === '+') return 'Plus' // "+" separates combo parts
  if (key.length === 1) return key.toUpperCase()
  const named = NAMED[key.toLowerCase()]
  if (named) return named
  return /^F([1-9]|1[0-2])$/i.test(key) ? key.toUpperCase() : null
}

// Shift is dropped for symbol keys: it is what produced the symbol and differs per layout
// (German Shift+0 is "=", US Shift+= is "+").
const combo = (mods: { mod: boolean; ctrl: boolean; alt: boolean; shift: boolean }, key: string) => {
  const shift = mods.shift && !(key.length === 1 && !/[A-Z0-9]/.test(key)) && key !== 'Plus'
  return [mods.mod && 'Mod', mods.ctrl && 'Ctrl', mods.alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('+')
}

interface KeyLike {
  key: string
  code?: string
  getModifierState?: (key: string) => boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function comboFromEvent(e: KeyLike, mac = isMac): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  // Non-Latin layouts (e.g. Cyrillic) report their own letters; use the physical key instead.
  // Dead keys (` on many European layouts) report "Dead"; the physical key still identifies them.
  const physical = (e.key === 'Dead' || /[^\x00-\x7f]/.test(e.key)) && /^(?:Key([A-Z])|Digit(\d)|(Backquote))$/.exec(e.code ?? '')
  const key = physical ? (physical[1] ?? physical[2] ?? '`') : keyName(e.key)
  if (!key) return null
  // AltGr (Windows/Linux) arrives as Ctrl+Alt; the character it typed is the key.
  if (!mac && e.getModifierState?.('AltGraph')) return combo({ mod: false, ctrl: false, alt: false, shift: e.shiftKey }, key)
  return combo({ mod: mac ? e.metaKey : e.ctrlKey, ctrl: mac && e.ctrlKey, alt: e.altKey, shift: e.shiftKey }, key)
}

// Editing and navigation keys that text fields and lists rely on.
const RESERVED = new Set(['Mod+C', 'Mod+V', 'Mod+X', 'Mod+Z', 'Mod+Shift+Z', 'Mod+A', 'Mod+Y', 'Enter', 'Space', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
export const reservedCombo = (c: string) => RESERVED.has(c) || /^Shift\+(Arrow|Home|End|Page)/.test(c)

// Parses what a user typed ("shift+cmd+p") into the canonical form, or null if invalid.
export function normalizeCombo(text: string, mac = isMac): string | null {
  const parts = text.replace(/\+\s*\+$/, '+Plus').split('+').map((p) => p.trim())
  const keyPart = parts.pop()
  if (!keyPart) return null
  const mods = { mod: false, ctrl: false, alt: false, shift: false }
  for (const p of parts.map((x) => x.toLowerCase())) {
    if (['mod', 'cmd', 'command', 'meta'].includes(p)) mods.mod = true
    else if (['ctrl', 'control'].includes(p)) mac ? (mods.ctrl = true) : (mods.mod = true)
    else if (['alt', 'option', 'opt'].includes(p)) mods.alt = true
    else if (p === 'shift') mods.shift = true
    else return null
  }
  const key = keyName(keyPart)
  return key ? combo(mods, key) : null
}

// Display form, e.g. "⌘⇧P" on macOS, "Ctrl+Shift+P" elsewhere.
export function displayCombo(c: string, mac = isMac): string {
  if (!mac) return c.replace('Mod', 'Ctrl')
  return c
    .split('+')
    .map((p) => ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Enter: '↩', Escape: 'Esc', Plus: '+' })[p] ?? p)
    .join('')
}

// Effective shortcuts: a command's default combo unless the user overrode it ("" removes it).
// The first command claiming a combo wins; later claims are reported as conflicts.
export function resolveKeymap(commands: { id: string; keys?: string | string[] }[], overrides: Record<string, string>, mac = isMac) {
  const byCombo = new Map<string, string>()
  const byCommand = new Map<string, string>()
  const claims = new Map<string, string[]>()
  const invalid: string[] = []
  for (const c of commands) {
    const raws = c.id in overrides ? [overrides[c.id]] : [c.keys ?? []].flat()
    for (const raw of raws.filter(Boolean)) {
      const combo = normalizeCombo(raw, mac)
      if (!combo) {
        invalid.push(c.id)
        continue
      }
      claims.set(combo, [...(claims.get(combo) ?? []), c.id])
      if (!byCombo.has(combo)) byCombo.set(combo, c.id)
      if (!byCommand.has(c.id)) byCommand.set(c.id, combo) // shown in palette/settings
    }
  }
  const conflicts = [...claims].filter(([, ids]) => ids.length > 1)
  return { byCombo, byCommand, conflicts, invalid }
}
