// Integrated terminals: one pseudo terminal per id, owned by the window (webContents id) that
// started it. Only the owner can write to, resize or kill it; a closed window takes its
// terminals with it. The pty itself is injected (node-pty in main, a fake in tests).

export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  pause(): void
  resume(): void
}

type Emit = (owner: number, channel: 'terminal:data' | 'terminal:exit', id: number, payload: string | number) => void

// Output is sent in bursts (a few ms, at most 64K chars per message). The window acknowledges what
// xterm has rendered; with more than HIGH chars outstanding the shell is paused until it is back
// under LOW, so `cat huge.log` cannot flood IPC and the renderer.
const FLUSH_MS = 5
const MAX_BATCH = 64 * 1024
const HIGH = 512 * 1024
const LOW = 128 * 1024

interface Term {
  pty: PtyLike
  owner: number
  pending: string
  timer: ReturnType<typeof setTimeout> | null
  unacked: number
  paused: boolean
}

export function createTerminals(spawn: (cwd: string, cols: number, rows: number) => PtyLike, emit: Emit) {
  const terms = new Map<number, Term>()
  let next = 1

  function own(owner: number, id: number) {
    const t = terms.get(id)
    if (!t || t.owner !== owner) throw new Error('unknown terminal')
    return t
  }

  function flush(id: number, t: Term) {
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    if (!t.pending) return
    const data = t.pending
    t.pending = ''
    t.unacked += data.length
    emit(t.owner, 'terminal:data', id, data)
    if (t.unacked > HIGH && !t.paused) {
      t.paused = true
      t.pty.pause()
    }
  }

  return {
    start(owner: number, cwd: string, cols = 80, rows = 24): number {
      const pty = spawn(cwd, Math.min(1000, Math.max(2, cols)), Math.min(1000, Math.max(1, rows)))
      const id = next++
      const t: Term = { pty, owner, pending: '', timer: null, unacked: 0, paused: false }
      terms.set(id, t)
      pty.onData((data) => {
        t.pending += data
        if (t.pending.length >= MAX_BATCH) flush(id, t)
        else t.timer ??= setTimeout(() => flush(id, t), FLUSH_MS)
      })
      pty.onExit(({ exitCode }) => {
        flush(id, t)
        terms.delete(id)
        emit(owner, 'terminal:exit', id, exitCode)
      })
      return id
    },
    write: (owner: number, id: number, data: string) => own(owner, id).pty.write(data),
    resize: (owner: number, id: number, cols: number, rows: number) =>
      own(owner, id).pty.resize(Math.min(1000, Math.max(2, cols)), Math.min(1000, Math.max(1, rows))),
    // The window rendered `chars` more characters of this terminal's output.
    ack(owner: number, id: number, chars: number) {
      const t = own(owner, id)
      t.unacked = Math.max(0, t.unacked - chars)
      if (t.paused && t.unacked < LOW) {
        t.paused = false
        t.pty.resume()
      }
    },
    kill(owner: number, id: number) {
      const t = own(owner, id)
      if (t.timer) clearTimeout(t.timer)
      t.pty.kill()
      terms.delete(id)
    },
    killAll(owner: number) {
      for (const [id, t] of terms) {
        if (t.owner !== owner) continue
        if (t.timer) clearTimeout(t.timer)
        t.pty.kill()
        terms.delete(id)
      }
    }
  }
}

// The environment for a user's shell: main's own, minus what only describes how gitspynx was
// launched (npm scripts, electron-vite, NODE_ENV, our node_modules/.bin on PATH), so tools in the
// terminal behave as in any other terminal.
export function shellEnv(env: Record<string, string | undefined>, appDir: string, platform: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || /^(NODE_ENV|NODE_ENV_ELECTRON_VITE|INIT_CWD)$/.test(k) || /^(ELECTRON_|npm_)/i.test(k)) continue
    out[k] = v
  }
  const sep = platform === 'win32' ? ';' : ':'
  const dirSep = platform === 'win32' ? '\\' : '/'
  const pathKey = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') // "Path" on Windows
  if (pathKey) out[pathKey] = out[pathKey].split(sep).filter((p) => p !== appDir && !p.startsWith(appDir + dirSep)).join(sep)
  out.TERM_PROGRAM = 'gitspynx'
  out.COLORTERM = 'truecolor'
  if (platform === 'darwin' && !out.LANG) out.LANG = 'en_US.UTF-8' // Dock-launched apps get no locale
  return out
}

// PATH for a GUI-launched app: the login shell's entries first (Homebrew, git-lfs, …), then any the
// app already had that the shell lacks.
export function mergePath(current: string, login: string, sep: string): string {
  const entries = [...login.split(sep), ...current.split(sep)].filter(Boolean)
  return [...new Set(entries)].join(sep)
}
