import type { Commit, FileChange, Ref } from '../shared/types'

export const US = '\x1f' // field separator in --format strings
export const RS = '\x1e' // record separator in --format strings

export const LOG_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%s'].join('%x1f') + '%x1e'
export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream:short)',
  '%(upstream:track)'
].join('%1f')

export function parseLog(out: string): Commit[] {
  return out
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, parents, author, email, date, subject] = r.split(US)
      return { sha, parents: parents ? parents.split(' ') : [], author, email, date: Number(date), subject }
    })
}

const KINDS: [string, Ref['kind']][] = [
  ['refs/heads/', 'local'],
  ['refs/remotes/', 'remote'],
  ['refs/tags/', 'tag']
]

export function parseRefs(out: string): Ref[] {
  const refs: Ref[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [fullName, sha, peeled, upstream, track] = line.split(US)
    if (fullName.endsWith('/HEAD')) continue // symbolic remote HEAD duplicates its target branch
    const match = KINDS.find(([prefix]) => fullName.startsWith(prefix))
    let ref: Ref
    if (match) ref = { name: fullName.slice(match[0].length), fullName, kind: match[1], target: peeled || sha }
    else if (fullName === 'refs/stash') ref = { name: 'stash', fullName, kind: 'stash', target: sha }
    else continue // notes, pull-request refs etc. are not shown
    if (upstream) {
      ref.upstream = upstream
      ref.ahead = Number(/ahead (\d+)/.exec(track)?.[1] ?? 0)
      ref.behind = Number(/behind (\d+)/.exec(track)?.[1] ?? 0)
    }
    refs.push(ref)
  }
  return refs
}

export function parseNameStatus(out: string): FileChange[] {
  const parts = out.split('\0')
  const files: FileChange[] = []
  for (let i = 0; i < parts.length - 1; ) {
    const status = parts[i++][0]
    if (status === 'R' || status === 'C') {
      const oldPath = parts[i++]
      files.push({ status, path: parts[i++], oldPath })
    } else {
      files.push({ status, path: parts[i++] })
    }
  }
  return files
}
