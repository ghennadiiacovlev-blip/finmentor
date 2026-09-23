#!/usr/bin/env node
// Final production audit: indexed-page RU/RO, metadata, headings and structured-data sweep.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const sitemap = read('sitemap.xml');
const urls = [...sitemap.matchAll(/<loc>(https:\/\/www\.finmentor\.md\/[^<]*)<\/loc>/g)].map((m) => m[1]);
const routes = urls.map((url) => new URL(url).pathname);
const fileOf = (route) => route === '/' ? 'index.html' : route.replace(/^\//, '').replace(/\/$/, '/index.html');
const normalizeRoute = (route) => route === '/index.html' ? '/' : route === '/ro/index.html' ? '/ro/' : route;
const strip = (html) => html.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<svg\b[\s\S]*?<\/svg>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|amp|quot|apos|lt|gt);/g, ' ').replace(/&#(?:x[0-9a-f]+|\d+);/gi, ' ').replace(/\s+/g, ' ').trim();
const attr = (html, tag, name) => {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${name}=["']([^"']*)["'][^>]*>`, 'i');
  return (html.match(re) || [])[1] || '';
};
const meta = (html, key, property = false) => {
  const marker = property ? 'property' : 'name';
  const a = new RegExp(`<meta\\b(?=[^>]*\\b${marker}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'])(?=[^>]*\\bcontent=["']([^"']*)["'])[^>]*>`, 'i').exec(html);
  return a ? a[1] : '';
};
const link = (html, rel, hreflang = null) => {
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const found = tags.find((tag) => new RegExp(`\\brel=["']${rel}["']`, 'i').test(tag)
    && (hreflang === null || new RegExp(`\\bhreflang=["']${hreflang}["']`, 'i').test(tag)));
  return found ? attr(found, 'link', 'href') : '';
};
const counterpart = (route, lang) => {
  const bare = route.startsWith('/ro/') ? route.slice(3) || '/' : route;
  return lang === 'ro' ? (bare === '/' ? '/ro/' : '/ro' + bare) : bare;
};

const defects = [];
const warnings = [];
const titleMap = new Map();
const descMap = new Map();
const files = new Set(routes.map(fileOf));

for (const route of routes) {
  const file = fileOf(route);
  const html = read(file);
  const lang = route.startsWith('/ro/') ? 'ro' : 'ru';
  const expectedCanonical = 'https://www.finmentor.md' + route;
  const expectedRu = 'https://www.finmentor.md' + counterpart(route, 'ru');
  const expectedRo = 'https://www.finmentor.md' + counterpart(route, 'ro');
  const expectedDefault = expectedRu;
  const htmlLang = attr(html, 'html', 'lang');
  const canonical = link(html, 'canonical');
  const ru = link(html, 'alternate', 'ru');
  const ro = link(html, 'alternate', 'ro');
  const xdefault = link(html, 'alternate', 'x-default');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, ' ').trim() || '';
  const description = meta(html, 'description');
  const robots = [...html.matchAll(/<meta\b(?=[^>]*\bname=["']robots["'])(?=[^>]*\bcontent=["']([^"']*)["'])[^>]*>/gi)].map((m) => m[1]);
  if (htmlLang !== lang) defects.push(`${file}: html lang ${htmlLang || '(missing)'} != ${lang}`);
  if (canonical !== expectedCanonical) defects.push(`${file}: canonical ${canonical || '(missing)'} != ${expectedCanonical}`);
  if (ru !== expectedRu || ro !== expectedRo || xdefault !== expectedDefault) defects.push(`${file}: hreflang mismatch`);
  if (!title || !description) defects.push(`${file}: title or description missing`);
  if (robots.length !== 1 || /noindex/i.test(robots[0] || '')) defects.push(`${file}: indexed sitemap page robots=${robots.join(' || ') || '(missing)'}`);
  for (const key of ['og:title', 'og:description', 'og:url', 'og:image']) if (!meta(html, key, true)) defects.push(`${file}: ${key} missing`);
  for (const key of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (!meta(html, key)) defects.push(`${file}: ${key} missing`);
  if (meta(html, 'og:url', true) !== expectedCanonical) defects.push(`${file}: og:url mismatch`);
  if ((titleMap.get(title) || titleMap.set(title, []).get(title)).push(file) > 1) {}
  if ((descMap.get(description) || descMap.set(description, []).get(description)).push(file) > 1) {}

  const h1 = (html.match(/<h1\b/gi) || []).length;
  if (h1 !== 1) defects.push(`${file}: H1 count ${h1}`);
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  for (let i = 1; i < headings.length; i++) if (headings[i] > headings[i - 1] + 1) { warnings.push(`${file}: heading jump H${headings[i - 1]} to H${headings[i]}`); break; }
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
  const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicates.length) defects.push(`${file}: duplicate IDs ${duplicates.join(', ')}`);

  for (const block of html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(block[1]); } catch (error) { defects.push(`${file}: invalid JSON-LD ${error.message}`); }
  }
  const jsonLdCount = [...html.matchAll(/<script\s+type=["']application\/ld\+json["']/gi)].length;
  if (!jsonLdCount) warnings.push(`${file}: no JSON-LD`);

  const other = lang === 'ru' ? 'ro' : 'ru';
  const switchTag = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]).find((tag) => new RegExp(`data-lang-switch=["']${other}["']`, 'i').test(tag));
  if (!switchTag) defects.push(`${file}: ${other.toUpperCase()} language switch missing`);
  else {
    const resolved = new URL(attr(switchTag, 'a', 'href'), expectedCanonical).pathname;
    if (normalizeRoute(resolved) !== counterpart(route, other)) defects.push(`${file}: ${other.toUpperCase()} switch resolves ${resolved}`);
  }

  if (lang === 'ro') {
    const body = html.slice(Math.max(0, html.search(/<body\b/i)));
    const visible = strip(body);
    const cyr = visible.match(/[\u0400-\u04ff]+/g);
    if (cyr) defects.push(`${file}: visible Cyrillic ${[...new Set(cyr)].slice(0, 8).join(', ')}`);
  }
}

for (const route of routes) {
  const other = counterpart(route, route.startsWith('/ro/') ? 'ru' : 'ro');
  if (!files.has(fileOf(other))) defects.push(`${fileOf(route)}: counterpart missing ${fileOf(other)}`);
}
for (const [title, group] of titleMap) if (group.length > 1) defects.push(`duplicate title: ${group.join(', ')} :: ${title.slice(0, 80)}`);
for (const [description, group] of descMap) if (group.length > 1) defects.push(`duplicate description: ${group.join(', ')} :: ${description.slice(0, 80)}`);

console.log('INDEXED_URLS=' + urls.length);
console.log('RU_INDEXED=' + routes.filter((x) => !x.startsWith('/ro/')).length);
console.log('RO_INDEXED=' + routes.filter((x) => x.startsWith('/ro/')).length);
console.log('I18N_SEO_DEFECTS=' + defects.length);
console.log('HEADING_SCHEMA_WARNINGS=' + warnings.length);
if (defects.length) console.log(defects.join('\n'));
if (warnings.length) console.log(warnings.join('\n'));
if (defects.length) process.exitCode = 1;
