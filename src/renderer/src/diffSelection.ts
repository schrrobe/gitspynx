import type { FileDiff } from '../../shared/types'

export interface LineSelection {
  hunk: number
  lines: Set<number>
}

// A background refresh (watcher, staging another hunk) replaces the diff object; the user's line
// selection survives as long as its hunk is unchanged.
export function keepSelection(sel: LineSelection | null, prev: FileDiff | null, next: FileDiff | null): LineSelection | null {
  if (!sel || !prev || !next) return null
  const a = prev.hunks[sel.hunk]
  const b = next.hunks[sel.hunk]
  if (!a || !b || a.header !== b.header || a.lines.length !== b.lines.length) return null
  return a.lines.every((l, i) => l.type === b.lines[i].type && l.text === b.lines[i].text) ? sel : null
}
