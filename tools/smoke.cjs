// Smoke test of a packaged build: opens a fresh repository from the recent list, checks that the
// graph renders and that the integrated terminal (native node-pty) runs a command.
// usage: node tools/smoke.cjs <path to the packaged executable>
const { _electron } = require('playwright-core')
const { execFileSync } = require('node:child_process')
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

;(async () => {
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
    console.log('smoke ok')
  } catch (e) {
    await win.screenshot({ path: path.join(process.cwd(), 'smoke-failure.png') }).catch(() => {})
    console.error(e)
    process.exitCode = 1
  } finally {
    await app.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})()
