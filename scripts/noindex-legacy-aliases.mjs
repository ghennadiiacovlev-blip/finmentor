// Marks legacy alias pages noindex,follow (INDP3-01).
//
// These pages are live (HTTP 200) but absent from the sitemap, and they declare canonical
// URLs that point either at unrelated pages or at /en/... paths that return 404. A canonical
// aimed at a 404 is worse than no canonical: it asks search engines to consolidate signals
// onto a URL that does not exist.
//
// They are NOT deleted. Any of them may still have live inbound links, and deleting would
// turn those into 404s. noindex,follow removes them from search results while keeping the
// URL alive and letting equity flow through their internal links. Fully reversible.
//
// Canonicals are also removed. These aliases are deliberately excluded from indexing and a
// guessed canonical is more harmful than no canonical when the preserved filename and content
// no longer describe the same current page.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');

// Functional pages that are intentionally out of the sitemap and already handled.
const KEEP = new Set(['thank-you.html', 'ro/thank-you.html', 'app/index.html', '404.html']);

const sitemap = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
const inMap = new Set([...sitemap.matchAll(/<loc>https:\/\/www\.finmentor\.md\/([^<]*)<\/loc>/g)].map((m) => m[1]));

const files = [];
(function walk(d) {
  for (const e of readdirSync(join(ROOT, d) || ROOT)) {
    const rel = d ? `${d}/${e}` : e;
    if (statSync(join(ROOT, rel)).isDirectory()) {
      if (!['.git', 'node_modules', 'qa', 'scripts', 'n8n', 'docs'].includes(e)) walk(rel);
    } else if (e.endsWith('.html')) files.push(rel);
  }
})('');

let changed = 0;
for (const f of files) {
  if (KEEP.has(f)) continue;
  // Legacy website aliases are root-level files. Do not rewrite separately gated applications,
  // gateway diagnostics, or other subdirectory-owned HTML.
  if (f.includes('/')) continue;
  const loc = f === 'index.html' ? '' : f;
  const roLoc = f === 'ro/index.html' ? 'ro/' : f;
  if (inMap.has(loc) || inMap.has(roLoc)) continue;

  const raw = readFileSync(join(ROOT, f), 'utf8');
  const crlf = raw.includes('\r\n');
  let s = crlf ? raw.split('\r\n').join('\n') : raw;

  const canon = /^[ \t]*<link[^>]+rel="canonical"[^>]+href="([^"]+)"[^>]*>[ \t]*\n?/im.exec(s);
  const canonHref = canon ? /href="([^"]+)"/i.exec(canon[0])[1] : '(none)';
  if (canon) s = s.replace(canon[0], '');

  // Remove every prior robots declaration first. Several aliases already carried the inserted
  // noindex tag plus their old `index, follow`, so an early return left contradictory directives.
  const marker = /^[ \t]*<!-- Legacy alias page: kept live for inbound links, excluded from search\. -->[ \t]*\n?/gmi;
  const robots = /^[ \t]*<meta[^>]+name=["']robots["'][^>]*>[ \t]*\n?/gmi;
  s = s.replace(marker, '').replace(robots, '');

  const anchor = /<meta charset=["'][^"']*["']\s*\/?>/i.exec(s);
  if (!anchor) { console.log(`  SKIP (no charset anchor): ${f}`); continue; }
  const tag = '\n  <!-- Legacy alias page: kept live for inbound links, excluded from search. -->\n'
    + '  <meta name="robots" content="noindex,follow" />';
  s = s.slice(0, anchor.index + anchor[0].length) + tag + s.slice(anchor.index + anchor[0].length);

  const result = crlf ? s.split('\n').join('\r\n') : s;
  if (result === raw) continue;
  if (apply) writeFileSync(join(ROOT, f), result);
  changed++;
  console.log(`  ${f.padEnd(38)} robots normalized; removed canonical -> ${canonHref.replace('https://www.finmentor.md', '')}`);
}
console.log(`\n${changed} legacy alias page(s)${apply ? ' updated' : ' (dry run)'}`);
