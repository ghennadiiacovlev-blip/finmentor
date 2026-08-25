// Line-ending-preserving exact-string patcher used by the remediation work.
// Usage: node scripts/patchfile.mjs <file> <jsonSpecFile>
// spec: [{ "find": "...", "replace": "...", "count": 1 }]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , target, specPath] = process.argv;
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const raw = readFileSync(target, 'utf8');
const hadCRLF = raw.includes('\r\n');
let s = hadCRLF ? raw.split('\r\n').join('\n') : raw;

for (const [i, r] of spec.entries()) {
  const want = r.count === undefined ? 1 : r.count;
  const occurrences = s.split(r.find).length - 1;
  if (occurrences !== want) {
    console.error(`rule ${i}: expected ${want} occurrence(s), found ${occurrences}`);
    console.error(`  find starts: ${JSON.stringify(r.find.slice(0, 90))}`);
    process.exit(1);
  }
  s = s.split(r.find).join(r.replace);
}

writeFileSync(target, hadCRLF ? s.split('\n').join('\r\n') : s);
console.log(`patched ${target} (${spec.length} rule(s))`);
