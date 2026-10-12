import type { FileDiff } from './types'

// Content fingerprint of a hunk as displayed; main compares it with the current diff so nothing
// the user did not see gets staged.
export const hunkKey = (hunk: FileDiff['hunks'][number]) => hunk.lines.map((l) => l.type + l.text).join('\n')
