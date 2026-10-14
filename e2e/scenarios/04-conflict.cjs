// Merge with a conflict: resolve it in the editor, continue, merge commit with two parents.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('conflict')
  write(r, 'f.txt', 'one\ntwo\nthree\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'base')
  git(r, 'switch', '-q', '-c', 'side'); write(r, 'f.txt', 'one\nSIDE\nthree\n'); git(r, 'commit', '-q', '-am', 'side-change')
  git(r, 'switch', '-q', 'main'); write(r, 'f.txt', 'one\nMAIN\nthree\n'); git(r, 'commit', '-q', '-am', 'main-change')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.pick('„side“ in „main“ mergen')
    await s.win.click('.sidebar .item:has-text("side")', { button: 'right' })
    await s.win.waitForSelector('.bar:has-text("Merge")')
    await s.win.click('.conflicts .file')
    await s.win.waitForSelector('.conflict textarea')
    await s.win.fill('.conflict textarea', 'one\nMAIN+SIDE\nthree\n')
    await s.win.click('.conflict button:has-text("Als gelöst markieren")')
    await s.win.waitForSelector('.bar:has-text("Alle Konflikte gelöst")')
    await s.win.click('.bar button:has-text("Fortsetzen")')
    await s.win.waitForFunction(() => !document.querySelector('.bar'))
    expect(git(r, 'log', '-1', '--format=%P').split(' ').length, 2, 'merge parents')
    expect(git(r, 'show', 'HEAD:f.txt').replace(/\r/g, ''), 'one\nMAIN+SIDE\nthree', 'resolved content')
  } finally {
    await s.close()
  }
}
