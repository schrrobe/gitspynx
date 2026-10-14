import type { Ref } from '../../shared/types'

export interface Pill {
  label: string
  local: boolean
  remote: boolean
  tag: boolean
  head: boolean
  refs: Ref[]
}

// The labels in the BRANCH / TAG column of a commit: a local branch and its remote copy of the same
// name share one label (with both icons), the checked-out branch comes first, tags last.
export function refPills(refs: Ref[], head: string | null): Pill[] {
  const pills = new Map<string, Pill>()
  const pill = (label: string) => pills.get(label) ?? (pills.set(label, { label, local: false, remote: false, tag: false, head: false, refs: [] }), pills.get(label)!)
  const localNames = new Set(refs.filter((x) => x.kind === 'local').map((x) => x.name))
  for (const x of refs) {
    if (x.kind === 'stash') continue
    const short = x.kind === 'remote' ? x.name.slice(x.name.indexOf('/') + 1) : x.name
    const p = pill(x.kind === 'remote' && !localNames.has(short) ? x.name : short)
    p.refs.push(x)
    if (x.kind === 'local') p.local = true
    if (x.kind === 'remote') p.remote = true
    if (x.kind === 'tag') p.tag = true
    if (x.kind === 'local' && x.name === head) p.head = true
  }
  const rank = (p: Pill) => (p.head ? 0 : p.tag ? 2 : 1)
  return [...pills.values()].sort((a, b) => rank(a) - rank(b))
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length > 1 ? words[0][0] + words.at(-1)![0] : words[0].slice(0, 2)).toUpperCase()
}

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'always' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]

// "vor 2 Stunden"; date and now in seconds
export function relativeTime(date: number, now = Date.now() / 1000): string {
  const ago = now - date
  for (const [unit, secs] of STEPS) if (ago >= secs) return rtf.format(-Math.floor(ago / secs), unit)
  return 'gerade eben'
}
