// Aligns every page's hreflang="x-default" with its own hreflang="ru" URL, which is the
// policy the sitemap already publishes. Line endings are preserved.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SKIP = new Set(['.git', 'node_modules', 'qa', 'scripts', 'n8n', 'docs']);

function collect(dir, acc = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = dir ? `${dir}/${e}` : e;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (!SKIP.has(e)) collect(rel, acc);
    } else if (e.endsWith('.html')) acc.push(rel);
  }
  return acc;
}

const hrefOf = (tag) => (/href=["']([^"']+)["']/i.exec(tag) || [])[1] || null;
let changed = 0;
const skipped = [];

for (const f of collect('')) {
  const raw = readFileSync(join(ROOT, f), 'utf8');
  const crlf = raw.includes('\r\n');
  let s = crlf ? raw.split('\r\n').join('\n') : raw;

  const xdTags = s.match(/<link[^>]+hreflang=["']x-default["'][^>]*>/gi) || [];
  if (xdTags.length === 0) continue;
  const ruTags = s.match(/<link[^>]+hreflang=["']ru["'][^>]*>/gi) || [];
  if (ruTags.length !== 1 || xdTags.length !== 1) { skipped.push(`${f} (ru=${ruTags.length} xd=${xdTags.length})`); continue; }

  const ruHref = hrefOf(ruTags[0]);
  const xdHref = hrefOf(xdTags[0]);
  if (!ruHref || !xdHref || ruHref === xdHref) continue;

  const fixed = xdTags[0].replace(xdHref, ruHref);
  s = s.replace(xdTags[0], fixed);
  writeFileSync(join(ROOT, f), crlf ? s.split('\n').join('\r\n') : s);
  changed++;
  console.log(`  ${f}: x-default ${xdHref} -> ${ruHref}`);
}

console.log(`\nx-default aligned in ${changed} file(s)`);
if (skipped.length) console.log(`skipped (ambiguous): ${skipped.join(', ')}`);
