// node-pty's npm tarball ships the macOS prebuilt spawn-helper without the execute bit; without
// it every terminal fails with "posix_spawnp failed". Runs after npm install/ci.
const fs = require('node:fs')
const path = require('node:path')

const prebuilds = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
for (const dir of fs.existsSync(prebuilds) ? fs.readdirSync(prebuilds) : []) {
  const helper = path.join(prebuilds, dir, 'spawn-helper')
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
}
