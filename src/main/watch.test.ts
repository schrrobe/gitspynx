import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { gitDirsOutside } from './git'
import { classifyChange, keepWatching, watchRepo } from './watch'

describe('classifyChange', () => {
  it('ignores object writes and lock files', () => {
    expect(classifyChange('.git/objects/ab/cdef')).toBe('ignore')
    expect(classifyChange('.git/index.lock')).toBe('ignore')
    expect(classifyChange('.git/refs/heads/main.lock')).toBe('ignore')
  })

  it('still reports branches whose name contains an objects segment', () => {
    expect(classifyChange('.git/refs/heads/feature/objects/x')).toBe('history')
    expect(classifyChange('.git/modules/sub/objects/ab/cd')).toBe('ignore')
  })

  it('treats index writes as status-only changes', () => {
    expect(classifyChange('.git/index')).toBe('status')
  })

  it('treats refs, HEAD and other git metadata as history changes', () => {
    expect(classifyChange('.git/HEAD')).toBe('history')
    expect(classifyChange('.git/refs/heads/topic')).toBe('history')
    expect(classifyChange('.git')).toBe('history')
  })

  it('treats work tree files as status changes', () => {
    expect(classifyChange('src/app.ts')).toBe('status')
    expect(classifyChange('.gitignore')).toBe('status')
  })

  it('treats a linked worktree index as status and ignores submodule object writes', () => {
    expect(classifyChange('.git/worktrees/wt/index')).toBe('status')
    expect(classifyChange('.git/modules/deps/lib/objects/ab/cdef')).toBe('ignore')
  })

  it('understands Windows separators', () => {
    expect(classifyChange('.git\\refs\\heads\\x')).toBe('history')
    expect(classifyChange('.git\\objects\\ab\\cd')).toBe('ignore')
    expect(classifyChange('.git\\index')).toBe('status')
  })
})

describe('watchRepo', () => {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' }
  let root: string
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'gitspynx-watch-')))
    execFileSync('git', ['init', '-q', '-b', 'main', 'main'], { cwd: root, env })
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'one'], { cwd: join(root, 'main'), env })
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'wt', join(root, 'wt')], { cwd: join(root, 'main'), env })
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 40 && !cond(); i++) await new Promise((r) => setTimeout(r, 100))
  }

  it('reports history changes of a linked worktree whose git dir lives elsewhere', async () => {
    const wt = join(root, 'wt')
    const changes: string[] = []
    const watcher = watchRepo(wt, await gitDirsOutside(wt), (k) => changes.push(k))
    await new Promise((r) => setTimeout(r, 300))
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'in worktree'], { cwd: wt, env })
    await until(() => changes.includes('history'))
    watcher.close()
    expect(changes).toContain('history')
  })
})

describe('keepWatching', () => {
  it('restarts a watcher that failed, a few times, and stops when closed', () => {
    vi.useFakeTimers()
    try {
      const fail: (() => void)[] = []
      let closed = 0
      keepWatching((onError) => (fail.push(onError), { close: () => void closed++ }), 1000, 2)
      expect(fail).toHaveLength(1)
      fail[0]() // e.g. EMFILE
      expect(closed).toBe(1)
      vi.advanceTimersByTime(1000)
      expect(fail).toHaveLength(2) // restarted
      fail[1]()
      vi.advanceTimersByTime(1000)
      expect(fail).toHaveLength(3)
      fail[2]()
      vi.advanceTimersByTime(5000)
      expect(fail).toHaveLength(3) // gave up after two restarts
      const again = keepWatching((onError) => (fail.push(onError), { close() {} }), 1000, 2)
      fail[3]()
      again.close()
      vi.advanceTimersByTime(5000)
      expect(fail).toHaveLength(4) // closed meanwhile: no restart
    } finally {
      vi.useRealTimers()
    }
  })
})
