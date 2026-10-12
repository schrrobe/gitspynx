import { describe, expect, it } from 'vitest'
import { buildMessage } from './commitMessage'

describe('buildMessage', () => {
  it('joins summary and description with a blank line', () => {
    expect(buildMessage(' Fix it ', 'Because.\n')).toBe('Fix it\n\nBecause.')
  })

  it('keeps indentation of the description', () => {
    expect(buildMessage('Add example', '\n    code();\n    more();\n\n')).toBe('Add example\n\n    code();\n    more();')
  })

  it('omits an empty description', () => {
    expect(buildMessage('Only summary', '  \n ')).toBe('Only summary')
  })
})
