// Helpers for the end-to-end scenarios: throwaway repositories, launching the built app with its
// own user data, and stand-ins for native menus/dialogs (Playwright cannot click those).
const { _electron } = require('playwright-core')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const appDir = path.resolve(__dirname, '..')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control' // the app's "Mod"
const env = { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'ada@example.com' }

function tempDir(name) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `gitspynx-e2e-${name}-`)))
}

// git in a folder; returns trimmed stdout
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()

function repo(name) {
  const dir = path.join(tempDir(name), name)
  fs.mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Ada')
  git(dir, 'config', 'user.email', 'ada@example.com')
  return dir
}

const write = (dir, file, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}

// Starts the built app (out/) with a fresh user-data folder whose recent list holds `recent`.
async function launch(recent, extraEnv = {}) {
  const ud = tempDir('userdata')
  fs.writeFileSync(path.join(ud, 'recent.json'), JSON.stringify(recent))
  const args = [appDir, `--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
  const app = await _electron.launch({ executablePath: require(path.join(appDir, 'node_modules', 'electron')), args, env: { ...env, ...extraEnv } })
  // native context menus pick the item whose label starts with globalThis.__pick; message boxes say OK
  await app.evaluate(({ Menu, dialog }) => {
    Menu.prototype.popup = function () {
      const item = this.items.find((i) => i.label.startsWith(globalThis.__pick ?? '\0'))
      if (!item) throw new Error(`menu item not found: ${globalThis.__pick} in ${this.items.map((i) => i.label)}`)
      item.click()
    }
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1280, height: 800 })
  const errors = []
  win.on('pageerror', (e) => errors.push(e.message))
  return {
    app,
    win,
    errors,
    pick: (label) => app.evaluate((_e, l) => (globalThis.__pick = l), label),
    async close() {
      await app.close().catch(() => {})
      fs.rmSync(ud, { recursive: true, force: true })
    }
  }
}

async function openFirstRecent(win) {
  await win.click('.welcome li a')
  await win.waitForSelector('.row')
}

// Smart-HTTP git server (git http-backend) over `root`, with Basic auth user:pass.
function protectedGitServer(root, user, pass) {
  const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== auth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="e2e"' })
      return res.end()
    }
    const u = new URL(req.url, 'http://x')
    const cgi = spawn('git', ['http-backend'], {
      env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] ?? '', REMOTE_USER: user }
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
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })))
}

function expect(actual, expected, what) {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)]
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`)
}

module.exports = { mod, git, repo, write, launch, openFirstRecent, protectedGitServer, expect, tempDir }
