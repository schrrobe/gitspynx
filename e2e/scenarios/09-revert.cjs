// Reverting the newest commit from its context menu, recorded for undo.
const fs = require('node:fs')
const path = require('node:path')
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('revert')
  git(r, 'commit', '-q', '--allow-empty', '-m', 'base')
  write(r, 'x.txt', 'x\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'add x')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.pick('Commit rückgängig machen')
    await s.win.click('.row:has-text("add x")', { button: 'right' })
    await s.win.waitForSelector('.row:has-text("Revert")')
    expect(git(r, 'log', '-1', '--format=%s'), 'Revert "add x"', 'revert commit')
    expect(fs.existsSync(path.join(r, 'x.txt')), false, 'file gone')
    expect(await s.win.getAttribute('button[aria-label="Rückgängig"]', 'title'), `Rückgängig: Revert ${git(r, 'rev-parse', '--short=7', 'HEAD~1')}`, 'undo offered')
  } finally {
    await s.close()
  }
}
