import type { Ref } from '../../shared/types'

// Slash-separated names as a folder tree ("feature/x" → folder feature, leaf x), as in GitKraken's
// sidebar (branches) and file lists (paths). T is the item type (a Ref unless stated otherwise).
export type TreeNode<T = Ref> = { kind: 'folder'; name: string; path: string; children: TreeNode<T>[] } | { kind: 'ref'; ref: T; label: string }
export type FlatNode<T = Ref> = ({ kind: 'folder'; name: string; path: string } | { kind: 'ref'; ref: T; label: string }) & { depth: number }

// name: the slash path of an item; filter: case-insensitive substring.
export function refTree(refs: Ref[], filter = '', name = (r: Ref) => r.name): TreeNode[] {
  return buildTree(refs, filter, name)
}

export function buildTree<T>(items: T[], filter: string, name: (item: T) => string): TreeNode<T>[] {
  type Node = TreeNode<T>
  const root: Node[] = []
  const f = filter.trim().toLowerCase()
  for (const r of items) {
    const full = name(r)
    if (f && !full.toLowerCase().includes(f)) continue
    const parts = full.split('/')
    let level = root
    let path = ''
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part
      let folder = level.find((n): n is Extract<Node, { kind: 'folder' }> => n.kind === 'folder' && n.name === part)
      if (!folder) level.push((folder = { kind: 'folder', name: part, path, children: [] }))
      level = folder.children
    }
    level.push({ kind: 'ref', ref: r, label: parts.at(-1)! })
  }
  const sort = (nodes: Node[]): Node[] =>
    nodes
      .map((n) => (n.kind === 'folder' ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : (a.kind === 'folder' ? a.name : a.label).localeCompare(b.kind === 'folder' ? b.name : b.label)))
  const tree = sort(root)
  return f ? tree.map(openAll) : tree
}

// While filtering every folder is open (marked so flattenTree ignores collapsed state).
const openAll = <T>(n: TreeNode<T>): TreeNode<T> => (n.kind === 'folder' ? { ...n, path: `${n.path}\0open`, children: n.children.map(openAll) } : n)

// Visible rows: folders listed in `collapsed` (by path) hide their children.
export function flattenTree<T>(nodes: TreeNode<T>[], collapsed: Set<string>, depth = 0): FlatNode<T>[] {
  return nodes.flatMap((n): FlatNode<T>[] => {
    if (n.kind === 'ref') return [{ ...n, depth }]
    const forcedOpen = n.path.endsWith('\0open')
    const path = forcedOpen ? n.path.slice(0, -5) : n.path
    const row: FlatNode<T> = { kind: 'folder', name: n.name, path, depth }
    return collapsed.has(path) && !forcedOpen ? [row] : [row, ...flattenTree(n.children, collapsed, depth + 1)]
  })
}
