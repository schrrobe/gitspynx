// Runs every scenario in e2e/scenarios against the built app (npm run build first).
// usage: node e2e/run.cjs [name-filter]
const fs = require('node:fs')
const path = require('node:path')

;(async () => {
  const dir = path.join(__dirname, 'scenarios')
  const filter = process.argv[2] ?? ''
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cjs') && f.includes(filter)).sort()
  let failed = 0
  for (const file of files) {
    const t0 = Date.now()
    try {
      await require(path.join(dir, file))()
      console.log(`ok   ${file} (${Date.now() - t0} ms)`)
    } catch (e) {
      failed++
      console.log(`FAIL ${file} (${Date.now() - t0} ms)\n     ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n     ')}`)
    }
  }
  console.log(`${files.length - failed}/${files.length} scenarios passed`)
  process.exit(failed ? 1 : 0)
})()
