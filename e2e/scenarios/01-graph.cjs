// Opens a repository from the recent list: graph rows, sidebar refs, commit detail, arrow keys.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('graph')
  write(r, 'a.txt', '1\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'first')
  git(r, 'switch', '-q', '-c', 'feature'); write(r, 'b.txt', '2\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'feature work')
  git(r, 'switch', '-q', 'main'); write(r, 'a.txt', '3\n'); git(r, 'commit', '-q', '-am', 'main work')
  git(r, 'merge', '-q', '--no-ff', '--no-edit', 'feature')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    const subjects = await s.win.$$eval('.row .subject', (e) => e.map((x) => x.textContent.trim()))
    expect(subjects.length, 4, 'rows')
    expect((await s.win.$$eval('.sidebar .item .name', (e) => e.map((x) => x.textContent))).includes('feature'), true, 'feature in sidebar')
    await s.win.click('.row:has-text("Merge branch")')
    await s.win.waitForSelector('.detail h2')
    await s.win.click('.scroller')
    await s.win.keyboard.press('ArrowDown')
    await s.win.waitForFunction(() => !/Merge branch/.test(document.querySelector('.detail h2')?.textContent ?? 'Merge branch'))
    expect(s.errors, [], 'page errors')
  } finally {
    await s.close()
  }
}
