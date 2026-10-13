import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startAskpass } from './askpass'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'gitspynx-askpass-'))
  dirs.push(d)
  return d
}

// git credential fill asks for username and password through GIT_ASKPASS, without any network.
// Asynchronous: the askpass server runs in this process and must keep answering.
function fill(env: Record<string, string>): Promise<{ status: number | null; stdout: string }> {
  const git = spawn('git', ['credential', 'fill'], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', ...env }
  })
  let stdout = ''
  git.stdout.on('data', (d) => (stdout += d))
  git.stdin.end('protocol=https\nhost=example.com\n\n')
  return new Promise((resolve) => git.on('close', (status) => resolve({ status, stdout })))
}

describe('askpass bridge', () => {
  it('answers git credential prompts through the app', async () => {
    const prompts: string[] = []
    const askpass = await startAskpass(tempDir(), process.execPath, async (p) => (prompts.push(p), p.startsWith('Username') ? 'ada' : 's3cret'))
    try {
      const out = await fill(askpass.env)
      expect(out.stdout).toContain('username=ada')
      expect(out.stdout).toContain('password=s3cret')
      expect(prompts[0]).toMatch(/^Username for 'https:\/\/example\.com'/)
      expect(prompts[1]).toMatch(/^Password for 'https:\/\/ada@example\.com'/)
    } finally {
      askpass.close()
    }
  })

  it('makes git fail when the prompt is cancelled', async () => {
    const askpass = await startAskpass(tempDir(), process.execPath, async () => null)
    try {
      expect((await fill(askpass.env)).status).not.toBe(0)
    } finally {
      askpass.close()
    }
  })

  it('ignores requests without the token', async () => {
    let asked = false
    const askpass = await startAskpass(tempDir(), process.execPath, async () => ((asked = true), 'x'))
    try {
      const reply = await new Promise<string>((resolve) => {
        const s = connect(askpass.env.GITSPYNX_ASKPASS_SOCKET, () => s.write(JSON.stringify({ token: 'wrong', prompt: 'Password:' }) + '\n'))
        let data = ''
        s.on('data', (d) => (data += d))
        s.on('end', () => resolve(data))
      })
      expect(JSON.parse(reply)).toEqual({})
      expect(asked).toBe(false)
    } finally {
      askpass.close()
    }
  })
})

