// usage: node grepctx.js <file> <regex> [ctx=150] [max=10] [mode=ctx|uniq]
const fs = require('fs');
const [file, re, ctx = 150, max = 10, mode = 'ctx'] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');
const rx = new RegExp(re, 'g');
const seen = new Map();
let m, n = 0;
while ((m = rx.exec(src))) {
  if (mode === 'uniq') { const k = m[1] ?? m[0]; seen.set(k, (seen.get(k) || 0) + 1); continue; }
  if (n++ >= +max) break;
  const s = Math.max(0, m.index - +ctx);
  console.log(`@${m.index}: ${src.slice(s, m.index + m[0].length + +ctx)}\n---`);
}
if (mode === 'uniq') for (const [k, v] of [...seen].sort((a, b) => b[1] - a[1]).slice(0, +max)) console.log(v, k);
else console.log(`(total shown ${Math.min(n, +max)})`);
