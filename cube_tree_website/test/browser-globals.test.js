// Plain <script> tags share ONE global lexical scope in the browser (unlike
// Node's per-file module scope), so two files declaring the same top-level
// const/let/class/function silently break the later script. Node-only tests
// can't see this; this static check can.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
let failures = 0;

for (const page of ['solver.html', 'index.html']) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const srcs = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
  const owner = new Map();
  const dupes = [];
  for (const src of srcs) {
    const code = fs.readFileSync(path.join(root, src), 'utf8');
    for (const m of code.matchAll(/^(?:const|let|var|class|function\*?|async function)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (owner.has(m[1]) && owner.get(m[1]) !== src) dupes.push(`${m[1]} (${owner.get(m[1])} and ${src})`);
      else owner.set(m[1], src);
    }
  }
  try {
    assert.deepStrictEqual(dupes, []);
    console.log(`PASS: ${page}: no duplicate top-level declarations across its <script> files`);
  } catch (e) {
    failures++;
    console.log(`FAIL: ${page}: duplicate top-level declarations`, dupes);
  }
}
if (failures) process.exit(1);
console.log('All browser-globals tests passed.');
