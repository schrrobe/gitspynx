// Integrated terminals: one pseudo terminal per id, owned by the window (webContents id) that
// started it. Only the owner can write to, resize or kill it; a closed window takes its
// terminals with it. The pty itself is injected (node-pty in main, a fake in tests).

export interface PtyLike {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

type Emit = (owner: number, channel: 'terminal:data' | 'terminal:exit', id: number, payload: string | number) => void

export function createTerminals(spawn: (cwd: string) => PtyLike, emit: Emit) {
  const terms = new Map<number, { pty: PtyLike; owner: number }>()
  let next = 1

  function own(owner: number, id: number) {
    const t = terms.get(id)
    if (!t || t.owner !== owner) throw new Error('unknown terminal')
    return t.pty
  }

  return {
    start(owner: number, cwd: string): number {
      const id = next++
      const pty = spawn(cwd)
      terms.set(id, { pty, owner })
      pty.onData((data) => emit(owner, 'terminal:data', id, data))
      pty.onExit(({ exitCode }) => {
        terms.delete(id)
        emit(owner, 'terminal:exit', id, exitCode)
      })
      return id
    },
    write: (owner: number, id: number, data: string) => own(owner, id).write(data),
    resize: (owner: number, id: number, cols: number, rows: number) =>
      own(owner, id).resize(Math.min(1000, Math.max(2, cols)), Math.min(1000, Math.max(1, rows))),
    kill(owner: number, id: number) {
      own(owner, id).kill()
      terms.delete(id)
    },
    killAll(owner: number) {
      for (const [id, t] of terms) if (t.owner === owner) (t.pty.kill(), terms.delete(id))
    }
  }
}
