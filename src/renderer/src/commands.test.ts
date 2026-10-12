import { describe, expect, it } from 'vitest'
import { buildCommands, commandForKey, type Command } from './commands'

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({ id, title: id, run: () => {}, ...extra })
const byCombo = new Map([
  ['Mod+W', 'close'],
  ['Mod+=', 'zoom'],
  ['Mod+F', 'search'],
  ['G', 'plain']
])
const commands = [cmd('close'), cmd('zoom', { repeatable: true }), cmd('search', { enabled: () => false }), cmd('plain')]

describe('commandForKey', () => {
  it('finds the command bound to a combo', () => {
    expect(commandForKey('Mod+W', { repeat: false, inTextField: false }, commands, byCombo)?.id).toBe('close')
  })

  it('ignores key repeat unless the command is repeatable', () => {
    expect(commandForKey('Mod+W', { repeat: true, inTextField: false }, commands, byCombo)).toBeUndefined()
    expect(commandForKey('Mod+=', { repeat: true, inTextField: false }, commands, byCombo)?.id).toBe('zoom')
  })

  it('skips disabled commands', () => {
    expect(commandForKey('Mod+F', { repeat: false, inTextField: false }, commands, byCombo)).toBeUndefined()
  })

  it('leaves commands marked notInTextFields to the text field (Mod+Z is text undo there)', () => {
    const cmds = [cmd('undo', { notInTextFields: true })]
    const map = new Map([['Mod+Z', 'undo']])
    expect(commandForKey('Mod+Z', { repeat: false, inTextField: true }, cmds, map)).toBeUndefined()
    expect(commandForKey('Mod+Z', { repeat: false, inTextField: false }, cmds, map)?.id).toBe('undo')
  })

  it('leaves plain keys to text fields', () => {
    expect(commandForKey('G', { repeat: false, inTextField: true }, commands, byCombo)).toBeUndefined()
    expect(commandForKey('G', { repeat: false, inTextField: false }, commands, byCombo)?.id).toBe('plain')
  })
})

describe('buildCommands', () => {
  it('does not offer search while the conflict editor holds an unsaved resolution', () => {
    const fake = (conflict: unknown) =>
      buildCommands({
        repo: { info: { path: '/r' }, conflict, busy: null } as never,
        tabs: { tabs: ['/r'], active: 0 } as never,
        settings: { settings: { zoom: 1, pullMode: 'ff-only' } } as never,
        pickRepo: () => {}
      }).find((c) => c.id === 'search.focus')!
    expect(fake({ path: 'f.txt' }).enabled!()).toBe(false)
    expect(fake(null).enabled!()).toBe(true)
  })
})
