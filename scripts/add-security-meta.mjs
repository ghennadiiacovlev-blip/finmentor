// Adds the security controls GitHub Pages actually honours.
//
// GitHub Pages serves fixed response headers and does not read a _headers file, so CSP,
// HSTS, X-Frame-Options, X-Content-Type-Options and Permissions-Policy cannot be set from
// this repository at all. <meta name="referrer"> is the one control with a genuine,
// browser-honoured HTML equivalent, so that is what gets applied here. Everything else is
// recorded as a platform blocker rather than claimed as fixed.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['.git', 'node_modules', 'qa', 'scripts', 'n8n', 'docs']);
const META = '  <meta name="referrer" content="strict-origin-when-cross-origin" />';

function collect(dir, acc = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = dir ? `${dir}/${e}` : e;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (!SKIP.has(e)) collect(rel, acc);
    } else if (e.endsWith('.html')) acc.push(rel);
  }
  return acc;
}

let added = 0;
let already = 0;
for (const f of collect('')) {
  const raw = readFileSync(join(ROOT, f), 'utf8');
  const crlf = raw.includes('\r\n');
  let s = crlf ? raw.split('\r\n').join('\n') : raw;

  if (/<meta[^>]+name=["']referrer["']/i.test(s)) { already++; continue; }

  const m = /<meta charset=["'][^"']*["']\s*\/?>/i.exec(s);
  if (!m) { console.log(`  SKIP (no charset anchor): ${f}`); continue; }

  const at = m.index + m[0].length;
  s = s.slice(0, at) + '\n' + META + s.slice(at);
  writeFileSync(join(ROOT, f), crlf ? s.split('\n').join('\r\n') : s);
  added++;
}
console.log(`referrer meta added to ${added} page(s); already present in ${already}`);
