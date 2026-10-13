import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminals, mergePath, type PtyLike, shellEnv } from './terminal'

function fakePty() {
  const p = {
    written: [] as string[],
    size: [80, 24],
    killed: false,
    paused: false,
    dataCb: (_d: string) => {},
    exitCb: (_e: { exitCode: number }) => {},
    onData(cb: (d: string) => void) {
      p.dataCb = cb
    },
    onExit(cb: (e: { exitCode: number }) => void) {
      p.exitCb = cb
    },
    write(d: string) {
      p.written.push(d)
    },
    resize(c: number, r: number) {
      p.size = [c, r]
    },
    kill() {
      p.killed = true
    },
    pause() {
      p.paused = true
    },
    resume() {
      p.paused = false
    }
  }
  return p
}

function setup() {
  const ptys: ReturnType<typeof fakePty>[] = []
  const cwds: string[] = []
  const events: unknown[][] = []
  const t = createTerminals(
    (cwd) => {
      cwds.push(cwd)
      const p = fakePty()
      ptys.push(p)
      return p as PtyLike
    },
    (owner, channel, ...args) => events.push([owner, channel, ...args])
  )
  return { t, ptys, cwds, events }
}

describe('terminals', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts a shell in the repository and forwards its output and exit to the owner', () => {
    const { t, ptys, cwds, events } = setup()
    const id = t.start(1, '/repo')
    expect(cwds).toEqual(['/repo'])
    ptys[0].dataCb('hello')
    ptys[0].exitCb({ exitCode: 0 }) // pending output goes out before the exit
    expect(events).toEqual([
      [1, 'terminal:data', id, 'hello'],
      [1, 'terminal:exit', id, 0]
    ])
  })

  it('sends bursts of output as one message', () => {
    const { t, ptys, events } = setup()
    const id = t.start(1, '/repo')
    for (const chunk of ['a', 'b', 'c']) ptys[0].dataCb(chunk)
    expect(events).toEqual([])
    vi.runAllTimers()
    expect(events).toEqual([[1, 'terminal:data', id, 'abc']])
  })

  it('pauses the shell while the window lags behind and resumes after it caught up', () => {
    const { t, ptys } = setup()
    const id = t.start(1, '/repo')
    ptys[0].dataCb('x'.repeat(600_000))
    vi.runAllTimers()
    expect(ptys[0].paused).toBe(true)
    expect(() => t.ack(2, id, 600_000)).toThrow() // only the owner
    t.ack(1, id, 300_000)
    expect(ptys[0].paused).toBe(true) // still above the low-water mark
    t.ack(1, id, 300_000)
    expect(ptys[0].paused).toBe(false)
  })

  it('only lets the owning window write, resize or kill', () => {
    const { t, ptys } = setup()
    const id = t.start(1, '/repo')
    expect(() => t.write(2, id, 'rm -rf ~\r')).toThrow()
    expect(() => t.kill(2, id)).toThrow()
    t.write(1, id, 'ls\r')
    expect(ptys[0].written).toEqual(['ls\r'])
  })

  it('clamps sizes to sane values', () => {
    const { t, ptys } = setup()
    const id = t.start(1, '/repo')
    t.resize(1, id, 0, 100000)
    expect(ptys[0].size).toEqual([2, 1000])
  })

  it('kills all terminals of a window that goes away and forgets exited ones', () => {
    const { t, ptys } = setup()
    t.start(1, '/a')
    t.start(1, '/b')
    const other = t.start(2, '/c')
    t.killAll(1)
    expect(ptys.map((p) => p.killed)).toEqual([true, true, false])
    ptys[2].exitCb({ exitCode: 1 })
    expect(() => t.write(2, other, 'x')).toThrow()
  })
})

describe('shellEnv', () => {
  const launcher = {
    HOME: '/Users/a',
    PATH: '/app/gitspynx/node_modules/.bin:/usr/local/bin:/usr/bin',
    NODE_ENV: 'production',
    NODE_ENV_ELECTRON_VITE: 'production',
    ELECTRON_RENDERER_URL: 'http://localhost:5173',
    ELECTRON_RUN_AS_NODE: '1',
    npm_lifecycle_event: 'start',
    INIT_CWD: '/app/gitspynx',
    EDITOR: 'vim'
  }

  it('drops variables that belong to how gitspynx itself was started', () => {
    const env = shellEnv(launcher, '/app/gitspynx', 'darwin')
    for (const k of ['NODE_ENV', 'NODE_ENV_ELECTRON_VITE', 'ELECTRON_RENDERER_URL', 'ELECTRON_RUN_AS_NODE', 'npm_lifecycle_event', 'INIT_CWD'])
      expect(env[k]).toBeUndefined()
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin')
    expect(env.HOME).toBe('/Users/a')
    expect(env.EDITOR).toBe('vim')
  })

  it('identifies the terminal and gives Dock-launched macOS shells a UTF-8 locale', () => {
    const env = shellEnv({ PATH: '/usr/bin' }, '/app', 'darwin')
    expect(env.TERM_PROGRAM).toBe('gitspynx')
    expect(env.COLORTERM).toBe('truecolor')
    expect(env.LANG).toBe('en_US.UTF-8')
    expect(shellEnv({ PATH: '/usr/bin', LANG: 'de_DE.UTF-8' }, '/app', 'darwin').LANG).toBe('de_DE.UTF-8')
  })
})

describe('mergePath', () => {
  it('puts the login shell PATH first and keeps entries only the app had', () => {
    expect(mergePath('/usr/bin:/bin:/opt/app/bin', '/opt/homebrew/bin:/usr/bin:/bin', ':')).toBe('/opt/homebrew/bin:/usr/bin:/bin:/opt/app/bin')
    expect(mergePath('/usr/bin', '', ':')).toBe('/usr/bin')
  })
})

describe('shellEnv on Windows and with similar folder names', () => {
  it('filters the PATH key regardless of its case and only drops entries inside the app folder', () => {
    const env = shellEnv({ Path: 'C:\\\\app\\\\node_modules\\\\.bin;C:\\\\app-tools;C:\\\\Windows' }, 'C:\\\\app', 'win32')
    expect(env.Path).toBe('C:\\\\app-tools;C:\\\\Windows')
  })
})
