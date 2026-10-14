// Branches: create one at a commit via the context menu and check it out by double-click.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('branches')
  write(r, 'a.txt', '1\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'first')
  write(r, 'a.txt', '2\n'); git(r, 'commit', '-q', '-am', 'second')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.pick('Branch hier erstellen')
    await s.win.click('.row:has-text("first")', { button: 'right' })
    await s.win.waitForSelector('dialog[open] #prompt-input')
    await s.win.fill('#prompt-input', 'topic')
    await s.win.keyboard.press('Enter')
    await s.win.waitForSelector('.sidebar .item:has-text("topic")')
    expect(git(r, 'rev-parse', '--abbrev-ref', 'HEAD'), 'topic', 'created and checked out')
    await s.win.dblclick('.sidebar .item:has-text("main")')
    await s.win.waitForFunction(() => document.querySelector('.toolbar .branch-name')?.textContent.trim() === 'main')
    expect(git(r, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'checked out main')
  } finally {
    await s.close()
  }
}
