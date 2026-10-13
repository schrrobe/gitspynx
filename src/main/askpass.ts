import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Password and passphrase prompts of git (HTTPS) and ssh reach the app: GIT_ASKPASS/SSH_ASKPASS
// point to a script that runs a tiny client with the app's own runtime (Electron as Node). The
// client sends the prompt over a local socket (named pipe on Windows) and prints the answer.
// Only callers that know the random token, i.e. processes started with this env, get an answer.

const CLIENT = `const net = require('net')
const s = net.connect(process.env.GITSPYNX_ASKPASS_SOCKET, () =>
  s.write(JSON.stringify({ token: process.env.GITSPYNX_ASKPASS_TOKEN, prompt: process.argv[2] || '' }) + '\\n'))
let data = ''
s.on('data', (d) => (data += d))
s.on('end', () => {
  let r = {}
  try { r = JSON.parse(data) } catch {}
  if (typeof r.answer !== 'string') process.exit(1)
  process.stdout.write(r.answer + '\\n')
})
s.on('error', () => process.exit(1))
`

export interface Askpass {
  env: Record<string, string>
  close(): void
}

// ask resolves the answer, or null when the user cancels.
export async function startAskpass(dir: string, runtime: string, ask: (prompt: string) => Promise<string | null>): Promise<Askpass> {
  mkdirSync(dir, { recursive: true })
  const token = randomBytes(24).toString('hex')
  // Unix socket paths are limited to ~104 bytes, userData can be longer: short random name in tmp.
  const name = `gitspynx-askpass-${token.slice(0, 16)}`
  const socket = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`)
  const client = join(dir, 'askpass-client.cjs')
  const script = join(dir, 'askpass.sh') // git for Windows runs it with its own sh, as do ssh builds that ship with git
  const sh = (p: string) => p.replaceAll('\\', '/')
  writeFileSync(client, CLIENT)
  writeFileSync(script, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${sh(runtime)}" "${sh(client)}" "$@"\n`)
  chmodSync(script, 0o700)

  const server = createServer((conn) => {
    let buf = ''
    conn.on('error', () => {})
    conn.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl === -1) return buf.length > 10_000 ? void conn.end('{}') : undefined
      let req: { token?: unknown; prompt?: unknown } = {}
      try {
        req = JSON.parse(buf.slice(0, nl))
      } catch {
        // answered as refused below
      }
      if (req.token !== token || typeof req.prompt !== 'string') return void conn.end('{}')
      ask(req.prompt.slice(0, 500)).then(
        (answer) => conn.end(JSON.stringify(answer === null ? {} : { answer })),
        () => conn.end('{}')
      )
    })
  })
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(socket, resolve))
  if (process.platform !== 'win32') chmodSync(socket, 0o600)

  return {
    env: {
      GIT_ASKPASS: script,
      SSH_ASKPASS: script,
      SSH_ASKPASS_REQUIRE: 'force', // OpenSSH ≥ 8.4: use it even without a display
      GITSPYNX_ASKPASS_SOCKET: socket,
      GITSPYNX_ASKPASS_TOKEN: token
    },
    close: () => server.close() // also removes the socket file
  }
}
