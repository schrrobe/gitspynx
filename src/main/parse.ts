import type { Commit, FileChange, FileDiff, FileStatus, Ref } from '../shared/types'

export const US = '\x1f' // field separator for for-each-ref (refnames cannot contain control characters)

// Used with `git log -z`: NUL separates fields and commits; NUL cannot occur in commit messages.
const LOG_FIELDS = ['%H', '%P', '%an', '%ae', '%at', '%s']
export const LOG_FORMAT = LOG_FIELDS.join('%x00')
export const REF_FORMAT = [
  '%(refname)',
  '%(objectname)',
  '%(*objectname)',
  '%(upstream:short)',
  '%(upstream:track)'
].join('%1f')

export function parseLog(out: string): Commit[] {
  const f = out.split('\0')
  const commits: Commit[] = []
  for (let i = 0; i + LOG_FIELDS.length <= f.length; i += LOG_FIELDS.length) {
    const [sha, parents, author, email, date, subject] = f.slice(i, i + LOG_FIELDS.length)
    commits.push({ sha, parents: parents ? parents.split(' ') : [], author, email, date: Number(date), subject })
  }
  return commits
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

// git status --porcelain=v2 -z (without --branch)
export function parseStatus(out: string): FileStatus[] {
  const parts = out.split('\0')
  const files: FileStatus[] = []
  const letter = (c: string) => (c === '.' ? null : c)
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    const fields = (n: number) => entry.split(' ').slice(0, n) // path is everything after n fields
    const rest = (n: number) => entry.split(' ').slice(n).join(' ')
    switch (entry[0]) {
      case '1': {
        const [, xy] = fields(2)
        files.push({ path: rest(8), staged: letter(xy[0]), unstaged: letter(xy[1]), conflicted: false })
        break
      }
      case '2': {
        const [, xy] = fields(2)
        files.push({ path: rest(9), oldPath: parts[++i], staged: letter(xy[0]), unstaged: letter(xy[1]), conflicted: false })
        break
      }
      case 'u':
        files.push({ path: rest(10), staged: null, unstaged: 'U', conflicted: true })
        break
      case '?':
        files.push({ path: entry.slice(2), staged: null, unstaged: '?', conflicted: false })
        break
    }
  }
  return files
}

export function parseDiff(out: string): FileDiff {
  const diff: FileDiff = { binary: false, hunks: [] }
  let oldNo = 0
  let newNo = 0
  for (const line of out.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      diff.hunks.push({ header: line, lines: [] })
      continue
    }
    const current = diff.hunks.at(-1)
    if (!current) {
      if (line.startsWith('Binary files ')) diff.binary = true
      continue
    }
    const type = line[0]
    if (type === ' ') current.lines.push({ type, text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
    else if (type === '-') current.lines.push({ type, text: line.slice(1), oldNo: oldNo++, newNo: null })
    else if (type === '+') current.lines.push({ type, text: line.slice(1), oldNo: null, newNo: newNo++ })
  }
  return diff
}
