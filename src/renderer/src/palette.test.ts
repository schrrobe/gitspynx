import { describe, expect, it } from 'vitest'
import { fuzzyRank } from './palette'

const items = ['Fetch', 'Pull', 'Push', 'Checkout: feature/login', 'Checkout: main', 'Einstellungen öffnen']

describe('fuzzyRank', () => {
  it('matches characters in order, case-insensitively', () => {
    expect(fuzzyRank(items, 'cma', (x) => x)).toEqual(['Checkout: main'])
  })

  it('ranks prefix and word-start matches before scattered ones', () => {
    expect(fuzzyRank(items, 'pu', (x) => x)).toEqual(['Pull', 'Push'])
    expect(fuzzyRank(['xxpxxux', 'Pull'], 'pu', (x) => x)).toEqual(['Pull', 'xxpxxux'])
  })

  it('returns all items in their order for an empty query', () => {
    expect(fuzzyRank(items, '', (x) => x)).toEqual(items)
  })

  it('handles umlauts', () => {
    expect(fuzzyRank(items, 'öff', (x) => x)).toEqual(['Einstellungen öffnen'])
  })
})
