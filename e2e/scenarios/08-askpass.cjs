// A fetch from a password-protected HTTP remote asks for user name and (masked) password.
const path = require('node:path')
const { git, repo, launch, openFirstRecent, protectedGitServer, expect, tempDir } = require('../lib.cjs')

module.exports = async () => {
  const root = tempDir('remote')
  git(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
  const seed = repo('seed'); git(seed, 'commit', '-q', '--allow-empty', '-m', 'remote commit'); git(seed, 'push', '-q', path.join(root, 'remote.git'), 'main')
  const server = await protectedGitServer(root, 'ada', 's3cret')
  const r = repo('askpass'); git(r, 'commit', '-q', '--allow-empty', '-m', 'local')
  git(r, 'remote', 'add', 'origin', `${server.url}/remote.git`)
  git(r, 'config', 'credential.helper', '') // no keychain/credential manager: the app must ask
  const s = await launch([r])
  try {
    await openFirstRecent(s.win)
    await s.pick('Fetch') // in Pull's ▾ menu, as in GitKraken
    await s.win.click('.toolbar .caret')
    await s.win.waitForSelector('dialog[open] #prompt-input')
    expect(await s.win.getAttribute('#prompt-input', 'type'), 'text', 'user name in clear')
    await s.win.fill('#prompt-input', 'ada')
    await s.win.keyboard.press('Enter')
    await s.win.waitForSelector('dialog[open] #prompt-input[type=password]')
    await s.win.fill('#prompt-input', 's3cret')
    await s.win.keyboard.press('Enter')
    await s.win.waitForSelector('.sidebar .name[data-full="origin/main"]', { timeout: 30000 })
  } finally {
    await s.close()
    server.close()
  }
}
