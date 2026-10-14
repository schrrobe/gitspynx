// Rebase with a conflict finished via Continue, then undone with one click.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('rebase')
  write(r, 'f.txt', 'one\ntwo\nthree\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'base')
  git(r, 'switch', '-q', '-c', 'side'); write(r, 'f.txt', 'one\nSIDE\nthree\n'); git(r, 'commit', '-q', '-am', 'side-change')
  git(r, 'switch', '-q', 'main'); write(r, 'f.txt', 'one\nMAIN\nthree\n'); git(r, 'commit', '-q', '-am', 'main-change')
  git(r, 'switch', '-q', 'side')
  const before = git(r, 'rev-parse', 'side')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.pick('„side“ auf „main“ rebasen')
    await s.win.click('.sidebar .item:has-text("main")', { button: 'right' })
    await s.win.waitForSelector('.bar:has-text("Rebase")')
    await s.win.click('.conflicts .file')
    await s.win.fill('.conflict textarea', 'one\nMAIN+SIDE\nthree\n')
    await s.win.click('.conflict button:has-text("Als gelöst markieren")')
    await s.win.waitForSelector('.bar:has-text("Alle Konflikte gelöst")')
    await s.win.click('.bar button:has-text("Fortsetzen")')
    await s.win.waitForFunction(() => !document.querySelector('.bar'))
    expect(git(r, 'log', '--format=%s', '-2').split('\n'), ['side-change', 'main-change'], 'rebased')
    await s.win.click('button[aria-label="Rückgängig"]')
    await s.win.waitForFunction(() => !/Rebase abschließen/.test(document.querySelector('button[aria-label="Rückgängig"]')?.title ?? ''))
    expect(git(r, 'rev-parse', 'side'), before, 'branch back where the rebase started')
  } finally {
    await s.close()
  }
}
