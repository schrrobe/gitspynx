// Tabs: a second repository opens as a tab, arrow keys move focus, Delete closes it.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const a = repo('tab-a'); write(a, 'a.txt', '1\n'); git(a, 'add', '.'); git(a, 'commit', '-q', '-m', 'in a')
  const b = repo('tab-b'); write(b, 'b.txt', '1\n'); git(b, 'add', '.'); git(b, 'commit', '-q', '-m', 'in b')
  const s = await launch([a])
  try {
    await s.app.evaluate(({ dialog }, dir) => (dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })), b)
    await openFirstRecent(s.win)
    await s.win.click('.strip .add')
    await s.win.waitForSelector('.row:has-text("in b")')
    expect(await s.win.$$eval('.tab .label', (e) => e.map((x) => x.textContent.trim())), ['tab-a', 'tab-b'], 'tabs')
    await s.win.focus('.tab.active .label')
    await s.win.keyboard.press('ArrowLeft')
    expect(await s.win.evaluate(() => document.activeElement?.textContent.trim()), 'tab-a', 'focus moved')
    await s.win.keyboard.press('Delete')
    await s.win.waitForFunction(() => document.querySelectorAll('.tab').length === 1)
    expect(await s.win.textContent('.tab .label'), 'tab-b', 'remaining tab')
  } finally {
    await s.close()
  }
}
