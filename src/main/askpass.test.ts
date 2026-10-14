import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
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
function fill(env: Record<string, string>): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const emptyConfig = join(tempDir(), 'gitconfig') // git on Windows rejects \\.\nul as a config file
  writeFileSync(emptyConfig, '')
  const git = spawn('git', ['credential', 'fill'], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TRACE: '1', ...env }
  })
  let stdout = ''
  let stderr = ''
  git.stdout.on('data', (d) => (stdout += d))
  git.stderr.on('data', (d) => (stderr += d))
  git.stdin.end('protocol=https\nhost=example.com\n\n')
  return new Promise((resolve) => git.on('close', (status) => resolve({ status, stdout, stderr })))
}

describe('askpass bridge', () => {
  it('answers git credential prompts through the app', async () => {
    const prompts: string[] = []
    const askpass = await startAskpass(tempDir(), process.execPath, async (p) => (prompts.push(p), p.startsWith('Username') ? 'ada' : 's3cret'))
    try {
      const out = await fill(askpass.env)
      expect(out.stdout, out.stderr).toContain('username=ada')
      expect(out.stdout).toContain('password=s3cret')
      expect(prompts[0]).toMatch(/^Username for 'https:\/\/example\.com'/)
      expect(prompts[1]).toMatch(/^Password for 'https:\/\/ada@example\.com'/)
    } finally {
      askpass.close()
    }
  })

  it.skipIf(process.platform === 'win32')('answers an ssh passphrase prompt (same SSH_ASKPASS path as git over ssh)', async () => {
    const dir = tempDir()
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 's3cret', '-C', 'test', '-f', join(dir, 'key')])
    const agent = execFileSync('ssh-agent', ['-s', '-a', join(dir, 'agent.sock')]).toString()
    const pid = /SSH_AGENT_PID=(\d+)/.exec(agent)![1]
    const prompts: string[] = []
    const askpass = await startAskpass(tempDir(), process.execPath, async (p) => (prompts.push(p), 's3cret'))
    try {
      const add = spawn('ssh-add', [join(dir, 'key')], { env: { ...process.env, SSH_AUTH_SOCK: join(dir, 'agent.sock'), ...askpass.env }, stdio: ['ignore', 'pipe', 'pipe'] })
      const status = await new Promise((resolve) => add.on('close', resolve))
      expect(status).toBe(0)
      expect(prompts[0]).toMatch(/passphrase/i)
      expect(execFileSync('ssh-add', ['-l'], { env: { ...process.env, SSH_AUTH_SOCK: join(dir, 'agent.sock') } }).toString()).toMatch(/test/)
    } finally {
      askpass.close()
      process.kill(Number(pid))
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

