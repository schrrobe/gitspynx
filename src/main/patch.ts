import type { FileDiff } from '../shared/types'

const NO_EOL = '\\ No newline at end of file'

// Builds a patch for one hunk, limited to the selected line indexes (all changes when omitted).
// Forward (stage, `git apply --cached`): unselected removals stay as context, unselected
// additions are dropped. Reverse (unstage, `git apply --cached --reverse` of the staged diff):
// unselected additions stay as context (they remain in the index), unselected removals drop.
export function buildPatch(diff: FileDiff, hunkIndex: number, lines: number[] | undefined, reverse: boolean): string {
  const hunk = diff.hunks[hunkIndex]
  if (!hunk) throw new Error('hunk not found')
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(hunk.header)
  if (!m) throw new Error(`unexpected hunk header: ${hunk.header}`)
  const selected = lines ? new Set(lines) : null
  const body: string[] = []
  let oldCount = 0
  let newCount = 0
  let changes = 0
  // After a line without final newline, nothing more may follow on the same side of the patch;
  // git would otherwise join the lines (a kept "x" plus a staged "+y" becomes "xy").
  let oldEnded = false
  let newEnded = false
  hunk.lines.forEach((l, i) => {
    const picked = !selected || selected.has(i)
    let out: string | null
    if (l.type === ' ') out = ` ${l.text}`
    else if (picked) {
      out = `${l.type}${l.text}`
      changes++
    } else if ((l.type === '-') !== reverse) out = ` ${l.text}` // forward: kept removal; reverse: kept addition
    else out = null
    if (out === null) return
    const onOld = out[0] !== '+'
    const onNew = out[0] !== '-'
    if ((onOld && oldEnded) || (onNew && newEnded))
      throw new Error('the last line of a file without a final newline must be staged together with the lines after it')
    if (onOld) oldCount++
    if (onNew) newCount++
    body.push(out)
    if (l.noEol) {
      body.push(NO_EOL)
      oldEnded ||= onOld
      newEnded ||= onNew
    }
  })
  if (!changes) throw new Error('no changed lines selected')
  // a partial selection stages content only, not a mode change of the same file
  const header = lines ? diff.header.filter((h) => !/^(old|new) mode /.test(h)) : diff.header
  return [...header, `@@ -${m[1]},${oldCount} +${m[2]},${newCount} @@${m[3]}`, ...body, ''].join('\n')
}
