// Working directory: a change shows up, gets staged and committed from the app.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('commit')
  write(r, 'a.txt', '1\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'first')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    write(r, 'a.txt', '1\n2\n')
    await s.win.waitForSelector('.wip', { timeout: 15000 }) // watcher picked it up
    await s.win.click('.wip')
    await s.win.click('.workdir button:has-text("Alle stagen")')
    await s.win.waitForFunction(() => /GESTAGED\s*1/i.test(document.querySelector('.workdir')?.innerText ?? ''))
    await s.win.fill('.workdir input', 'second from the app')
    await s.win.click('.workdir button:has-text("Commit")')
    await s.win.waitForSelector('.row:has-text("second from the app")')
    expect(git(r, 'log', '-1', '--format=%s'), 'second from the app', 'committed')
    expect(git(r, 'status', '--porcelain'), '', 'clean afterwards')
  } finally {
    await s.close()
  }
}
