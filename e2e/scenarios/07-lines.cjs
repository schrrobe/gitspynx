// Line staging: Shift-click across two hunks stages exactly the marked lines.
const { git, repo, write, launch, openFirstRecent, expect } = require('../lib.cjs')

module.exports = async () => {
  const r = repo('lines')
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  write(r, 'f.txt', lines.join('\n') + '\n'); git(r, 'add', '.'); git(r, 'commit', '-q', '-m', 'base')
  const edited = [...lines]
  edited.splice(2, 0, 'TOP A', 'TOP B')
  edited.splice(34, 0, 'BOTTOM C', 'BOTTOM D')
  write(r, 'f.txt', edited.join('\n') + '\n')
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.win.click('.wip')
    await s.win.click('.workdir li:has-text("f.txt") .file')
    await s.win.waitForSelector('.diff .line.add')
    await s.win.click('.diff .line:has-text("TOP B")')
    await s.win.click('.diff .line:has-text("BOTTOM C")', { modifiers: ['Shift'] })
    await s.win.click('.selbar button:has-text("Markierte stagen")')
    await s.win.waitForFunction(() => !document.querySelector('.selbar'))
    const staged = git(r, 'diff', '--cached', '-U0').split('\n').filter((l) => /^\+[A-Z]/.test(l)).map((l) => l.slice(1))
    expect(staged, ['TOP B', 'BOTTOM C'], 'staged lines')
  } finally {
    await s.close()
  }
}
