import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertRevision, GitError, openRepo, readCommit, readLog } from './git'

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Tester',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'Tester',
  GIT_COMMITTER_EMAIL: 't@example.com'
}
let dir: string
const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, env }).toString().trim()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitspynx-'))
  g('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), '1')
  g('add', '.')
  g('commit', '-q', '-m', 'first')
  g('switch', '-q', '-c', 'topic')
  writeFileSync(join(dir, 'b.txt'), '2')
  g('add', '.')
  g('commit', '-q', '-m', 'on topic')
  g('switch', '-q', 'main')
  g('merge', '-q', '--no-ff', '-m', 'merge topic', 'topic')
  g('tag', '-a', 'v1', '-m', 'release')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('git backend', () => {
  it('opens a repository from a subdirectory and reports head and refs', async () => {
    const info = await openRepo(join(dir, '.git'))
    expect(info.path).toBe(g('rev-parse', '--show-toplevel'))
    expect(info.head).toEqual({ branch: 'main', sha: g('rev-parse', 'HEAD') })
    expect(info.refs.map((r) => r.name).sort()).toEqual(['main', 'topic', 'v1'])
    expect(info.refs.find((r) => r.name === 'v1')!.target).toBe(g('rev-parse', 'HEAD'))
  })

  it('rejects a directory that is not a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'gitspynx-plain-'))
    await expect(openRepo(plain)).rejects.toBeInstanceOf(GitError)
    rmSync(plain, { recursive: true })
  })

  it('reads the log in topological order with paging', async () => {
    const all = await readLog(dir, 0, 100)
    expect(all.map((c) => c.subject)).toEqual(['merge topic', 'on topic', 'first'])
    expect(all[0].parents).toHaveLength(2)
    expect((await readLog(dir, 1, 1)).map((c) => c.subject)).toEqual(['on topic'])
  })

  it('reads commit details with files changed against the first parent', async () => {
    const merge = await readCommit(dir, 'HEAD')
    expect(merge.subject).toBe('merge topic')
    expect(merge.files).toEqual([{ status: 'A', path: 'b.txt' }])
    const root = await readCommit(dir, 'HEAD~1')
    expect(root.files).toEqual([{ status: 'A', path: 'a.txt' }])
  })

  it('refuses revisions that could be read as options', () => {
    expect(() => assertRevision('--output=/tmp/x')).toThrow(GitError)
    expect(() => assertRevision('a'.repeat(40))).not.toThrow()
  })
})
