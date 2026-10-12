import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Commit, RepoInfo } from '../../../shared/types'
import { useRepo } from './repo'

const info: RepoInfo = { path: '/r', head: { branch: 'main', sha: 'a0' }, refs: [], tips: ['a0'] }
const page = (prefix: string, n = 2000): Commit[] =>
  Array.from({ length: n }, (_, i) => ({
    sha: `${prefix}${i}`,
    parents: i < n - 1 ? [`${prefix}${i + 1}`] : [],
    author: 'a',
    email: 'a@x',
    date: 0,
    subject: `${prefix}${i}`
  }))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let logCalls: { skip: number; d: ReturnType<typeof deferred<Commit[]>> }[]

beforeEach(() => {
  setActivePinia(createPinia())
  logCalls = []
  ;(globalThis as unknown as { window: unknown }).window = {
    gitspynx: {
      openRepo: async () => info,
      readStatus: async () => [],
      readFileDiff: async () => ({ binary: false, hunks: [] }),
      readLog: (_repo: string, skip: number) => {
        const d = deferred<Commit[]>()
        logCalls.push({ skip, d })
        return d.promise
      }
    }
  }
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('repo store', () => {
  it('drops a page that was still loading when the repo was reopened', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('old'))
    await first

    const more = repo.loadMore()
    await flush()
    const reopen = repo.open('/r')
    await flush()
    logCalls[2].d.resolve(page('new'))
    await reopen
    logCalls[1].d.resolve(page('stale'))
    await more

    expect(repo.commits.map((c) => c.sha)).toEqual(page('new').map((c) => c.sha))
    expect(repo.loading).toBe(false)
  })

  it('stays loading while a reopen is in flight even if an older page finishes', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('old'))
    await first

    const more = repo.loadMore()
    await flush()
    const reopen = repo.open('/r')
    await flush()
    logCalls[1].d.resolve(page('stale'))
    await more
    expect(repo.loading).toBe(true)

    logCalls[2].d.resolve(page('new'))
    await reopen
    expect(repo.loading).toBe(false)
  })

  it('shows the diff for the file that was opened', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    await repo.openDiff({ path: 'f1', staged: false })
    expect(repo.diff).toEqual({ binary: false, hunks: [] })
  })

  it('follows an open diff to the staged side when the file gets staged', async () => {
    const repo = useRepo()
    const first = repo.open('/r')
    await flush()
    logCalls[0].d.resolve(page('c', 3))
    await first
    await repo.openDiff({ path: 'f1', staged: false })
    const w = (globalThis as unknown as { window: { gitspynx: Record<string, unknown> } }).window
    w.gitspynx.stage = async () => {}
    w.gitspynx.readStatus = async () => [{ path: 'f1', staged: 'M', unstaged: null, conflicted: false }]
    await repo.stage(['f1'])
    expect(repo.diffTarget).toEqual({ path: 'f1', staged: true })
  })
})
