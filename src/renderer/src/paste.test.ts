import { expect, it } from 'vitest'
import { splitForIpc } from './paste'

it('splits large input into pieces without breaking surrogate pairs', () => {
  const text = 'a'.repeat(5) + '😀' + 'b'.repeat(5)
  const parts = splitForIpc(text, 6)
  expect(parts.join('')).toBe(text)
  expect(parts.every((p) => p.length <= 6)).toBe(true)
  expect(parts.some((p) => /[\uD800-\uDBFF]$/.test(p))).toBe(false)
  expect(splitForIpc('short', 6)).toEqual(['short'])
})
