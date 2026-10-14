// Smoke test of a packaged build: opens a fresh repository from the recent list, checks that the
// graph renders, that the integrated terminal (native node-pty) runs a command, and that a fetch
// from a password-protected HTTP remote asks for the credentials in the app (askpass bridge).
// usage: node tools/smoke.cjs <path to the packaged executable>
const { _electron } = require('playwright-core')
const { execFileSync, spawn } = require('node:child_process')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const exe = process.argv[2]
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gitspynx-smoke-')))
const repo = path.join(tmp, 'repo')
const ud = path.join(tmp, 'user-data')
fs.mkdirSync(repo)
fs.mkdirSync(ud)
const git = (...a) => execFileSync('git', ['-c', 'user.name=Smoke', '-c', 'user.email=smoke@example.com', ...a], { cwd: repo })
git('init', '-q', '-b', 'main')
git('commit', '-q', '--allow-empty', '-m', 'first')
git('commit', '-q', '--allow-empty', '-m', 'second')
fs.writeFileSync(path.join(ud, 'recent.json'), JSON.stringify([repo]))
execFileSync('git', ['clone', '-q', '--bare', repo, path.join(tmp, 'remote.git')])
git('config', 'credential.helper', '') // no credential manager/keychain: the app must ask

// Smart-HTTP server (git http-backend) that wants Basic auth ada:s3cret.
const AUTH = 'Basic ' + Buffer.from('ada:s3cret').toString('base64')
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== AUTH) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="smoke"' })
    return res.end()
  }
  const u = new URL(req.url, 'http://x')
  const cgi = spawn('git', ['http-backend'], {
    env: { ...process.env, GIT_PROJECT_ROOT: tmp, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '', REMOTE_USER: 'ada' }
  })
  req.pipe(cgi.stdin)
  let head = Buffer.alloc(0)
  let sent = false
  cgi.stdout.on('data', (d) => {
    if (sent) return res.write(d)
    head = Buffer.concat([head, d])
    const end = head.indexOf('\r\n\r\n')
    if (end === -1) return
    const headers = {}
    let status = 200
    for (const line of head.subarray(0, end).toString().split('\r\n')) {
      const [k, ...v] = line.split(':')
      if (k.toLowerCase() === 'status') status = parseInt(v.join(':'))
      else headers[k] = v.join(':').trim()
    }
    res.writeHead(status, headers)
    res.write(head.subarray(end + 4))
    sent = true
  })
  cgi.on('close', () => res.end())
})

;(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  git('remote', 'add', 'origin', `http://127.0.0.1:${server.address().port}/remote.git`)
  // Linux CI: no SUID chrome-sandbox in the unpacked build, user namespaces restricted
  const args = [`--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
  const app = await _electron.launch({ executablePath: exe, args })
  const win = await app.firstWindow()
  try {
    if (!(await app.evaluate(({ app }) => app.isPackaged))) throw new Error('not a packaged build')
    await win.click('.welcome li a')
    await win.waitForSelector('.row:has-text("second")', { timeout: 20000 })
    await win.keyboard.press('Control+`')
    await win.waitForSelector('.xterm-helper-textarea', { timeout: 20000 })
    await win.waitForTimeout(3000) // shell start-up
    await win.keyboard.type('echo GSPX_$((6*7))_OK')
    await win.keyboard.press('Enter')
    // cmd.exe has no $((…)); there the plain echo of the typed text is enough to prove the pty runs
    const marker = process.platform === 'win32' ? /^GSPX_\$\(\(6\*7\)\)_OK$/m : /^GSPX_42_OK$/m
    await win.waitForFunction((src) => new RegExp(src, 'm').test(document.querySelector('.xterm-rows')?.innerText ?? ''), marker.source, { timeout: 20000 })
    await win.keyboard.press('Control+`') // terminal away
    // fetch from the protected remote: the app asks for user name, then (masked) password
    await win.click('.toolbar button:has-text("Fetch")')
    await win.waitForSelector('dialog[open] #prompt-input', { timeout: 20000 })
    await win.fill('#prompt-input', 'ada')
    await win.keyboard.press('Enter')
    await win.waitForSelector('dialog[open] #prompt-input[type=password]', { timeout: 20000 })
    await win.fill('#prompt-input', 's3cret')
    await win.keyboard.press('Enter')
    await win.waitForSelector('.sidebar .item:has-text("origin/main")', { timeout: 30000 })
    console.log('smoke ok')
  } catch (e) {
    await win.screenshot({ path: path.join(process.cwd(), 'smoke-failure.png') }).catch(() => {})
    console.error(e)
    process.exitCode = 1
  } finally {
    await app.close()
    server.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})()
