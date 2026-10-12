import { describe, expect, it } from 'vitest'
import { classifyChange } from './watch'

describe('classifyChange', () => {
  it('ignores object writes and lock files', () => {
    expect(classifyChange('.git/objects/ab/cdef')).toBe('ignore')
    expect(classifyChange('.git/index.lock')).toBe('ignore')
    expect(classifyChange('.git/refs/heads/main.lock')).toBe('ignore')
  })

  it('treats index writes as status-only changes', () => {
    expect(classifyChange('.git/index')).toBe('status')
  })

  it('treats refs, HEAD and other git metadata as history changes', () => {
    expect(classifyChange('.git/HEAD')).toBe('history')
    expect(classifyChange('.git/refs/heads/topic')).toBe('history')
    expect(classifyChange('.git')).toBe('history')
  })

  it('treats work tree files as status changes', () => {
    expect(classifyChange('src/app.ts')).toBe('status')
    expect(classifyChange('.gitignore')).toBe('status')
  })

  it('understands Windows separators', () => {
    expect(classifyChange('.git\\refs\\heads\\x')).toBe('history')
    expect(classifyChange('.git\\objects\\ab\\cd')).toBe('ignore')
    expect(classifyChange('.git\\index')).toBe('status')
  })
})
