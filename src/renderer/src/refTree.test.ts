import { describe, expect, it } from 'vitest'
import type { Ref } from '../../shared/types'
import { flattenTree, refTree } from './refTree'

const ref = (name: string, kind: Ref['kind'] = 'local'): Ref => ({ name, fullName: `refs/heads/${name}`, kind, target: 'a' })

describe('refTree', () => {
  it('groups names by their slash folders, folders first, both sorted', () => {
    const tree = refTree([ref('main'), ref('fix/b'), ref('feature/x'), ref('feature/deep/y'), ref('fix/a')])
    expect(flattenTree(tree, new Set()).map((n) => `${'  '.repeat(n.depth)}${n.kind === 'folder' ? n.name + '/' : n.label}`)).toEqual([
      'feature/',
      '  deep/',
      '    y',
      '  x',
      'fix/',
      '  a',
      '  b',
      'main'
    ])
  })

  it('hides the children of collapsed folders', () => {
    const tree = refTree([ref('feature/x'), ref('main')])
    expect(flattenTree(tree, new Set(['feature'])).map((n) => (n.kind === 'folder' ? n.name : n.label))).toEqual(['feature', 'main'])
  })

  it('filters by name and keeps the folders of matches open', () => {
    const tree = refTree([ref('feature/login'), ref('feature/x'), ref('main')], 'LOG')
    expect(flattenTree(tree, new Set(['feature'])).map((n) => (n.kind === 'folder' ? n.name : n.label))).toEqual(['feature', 'login'])
  })
})
