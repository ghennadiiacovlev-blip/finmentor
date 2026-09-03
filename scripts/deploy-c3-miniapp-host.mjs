#!/usr/bin/env node
// FINMENTOR — C3: deploy the tracked Mini App host page (result screen, cycle/outage copy).
//
//   node scripts/deploy-c3-miniapp-host.mjs --dry-run
//   node scripts/deploy-c3-miniapp-host.mjs --confirm
//
// ONE WORKFLOW, ONE NODE, ONE FIELD. KBD7Q94QQnlzgYKJ `Serve Page`.responseBody is replaced by the
// tracked candidate page (n8n/candidate/premium-miniapp-host-candidate.json, built by
// scripts/build-miniapp-host.mjs from app-premium/) with the three endpoint URLs read back from
// the page that is live — never typed, never written into the repo. Everything else on the host
// must be byte-identical before and after.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
export const HOST_ID = 'KBD7Q94QQnlzgYKJ';
// What the C3 page must carry, and what it must not.
export const MUST = [
  ['function scrResult()', 'the customer result screen'],
  ['function clientResult()', 'the curated result accessor'],
  ["'CYCLE_UNRESOLVED'", 'the cycle-unresolved bootstrap copy'],
  // the RO product NAME comes from the server (result.labels); the RO shell strings are the app's
  ['Rezultatul este gata', 'the RO result shell strings'],
  ['Результат анализа появится здесь', 'the pending note']
];
export const MUST_NOT = [['Radiografia Financiară', 'the retired RO product name'], ['__PREMIUM_', 'an endpoint placeholder']];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

async function api(m, p, b, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + p, { method: m,
        headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
        body: b ? JSON.stringify(b) : undefined });
      const t = await res.text();
      if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1200); }
  }
  throw last;
}

// Pure: the host as it will be sent, given the live host and the tracked candidate.
export function prepareHost(live, candidate) {
  const f = [];
  const liveServe = live.nodes.find((n) => n.name === 'Serve Page');
  const candServe = candidate.nodes.find((n) => n.name === 'Serve Page');
  if (!liveServe || !candServe) { f.push('no Serve Page node'); return { out: null, failures: f, urls: {} }; }
  const livePage = String(liveServe.parameters.responseBody || '');
  const urls = {};
  for (const key of ['gateway', 'session', 'submit']) {
    const m = new RegExp(key + ':\\s*\'([^\']+)\'').exec(livePage);
    if (!m || /__[A-Z_]+__/.test(m[1])) { f.push('could not read the live ' + key + ' endpoint out of the page'); continue; }
    urls[key] = m[1];
  }
  let page = String(candServe.parameters.responseBody || '')
    .split('__PREMIUM_GATEWAY_URL__').join(urls.gateway || '__PREMIUM_GATEWAY_URL__')
    .split('__PREMIUM_SESSION_URL__').join(urls.session || '__PREMIUM_SESSION_URL__')
    .split('__PREMIUM_SUBMIT_URL__').join(urls.submit || '__PREMIUM_SUBMIT_URL__');
  for (const [s, what] of MUST) { if (page.indexOf(s) === -1) { f.push('the candidate page lacks ' + what); } }
  for (const [s, what] of MUST_NOT) { if (page.indexOf(s) !== -1) { f.push('the candidate page carries ' + what); } }
  const out = JSON.parse(JSON.stringify(live));
  const serve = out.nodes.find((n) => n.name === 'Serve Page');
  serve.parameters = JSON.parse(JSON.stringify(candServe.parameters));
  serve.parameters.responseBody = page;
  // everything but the page body must be identical to live
  const strip = (w) => JSON.stringify(importable(w).nodes.map((n) => { const c = JSON.parse(JSON.stringify(n)); if (c.name === 'Serve Page') { delete c.parameters.responseBody; } return c; }));
  if (strip(out) !== strip(live)) { f.push('the deploy would change something other than the page body'); }
  return { out, failures: f, urls, pageSha: sha(page), livePageSha: sha(livePage) };
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-c3-miniapp-host.mjs');
if (isMain) {
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this rewrites the live host page; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('C3 — Mini App host: result screen, cycle/outage copy'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE'); say('');
    const live = await api('GET', '/workflows/' + HOST_ID);
    if (live.nodes.length !== 2) { die('the live host is not the 2-node page server this script knows'); }
    writeFileSync(join(OUT_DIR, HOST_ID + '.pre-c3-host.json'), JSON.stringify(importable(live), null, 2) + '\n', 'utf8');
    ok('rollback artifact: .uat/' + HOST_ID + '.pre-c3-host.json (active=' + live.active + ')');
    const candidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'), 'utf8'));
    const { out, failures, urls, pageSha, livePageSha } = prepareHost(live, candidate);
    if (failures.length) { die(failures.join(' | ')); }
    for (const k of Object.keys(urls)) { ok(k.padEnd(8) + ': <tenant>' + urls[k].replace(BASE, '')); }
    ok('live page sha ' + livePageSha.slice(0, 16) + ' -> candidate page sha ' + pageSha.slice(0, 16));
    writeFileSync(join(OUT_DIR, HOST_ID + '.c3-host-candidate.json'), JSON.stringify(importable(out), null, 2) + '\n', 'utf8');
    if (DRY) { say('\nDRY RUN — nothing written.'); }
    else {
      await api('PUT', '/workflows/' + HOST_ID, importable(out), 3);
      ok('host updated');
      const after = await api('GET', '/workflows/' + HOST_ID);
      const afterPage = String(after.nodes.find((n) => n.name === 'Serve Page').parameters.responseBody || '');
      if (sha(afterPage) !== pageSha) { bad('the live page does not match what was sent — roll back'); } else { ok('fresh read: the live page is the candidate page'); }
      if (!after.active) { bad('the host is NOT active'); } else { ok('active'); }
      say('\n  rollback: PUT /api/v1/workflows/' + HOST_ID + ' with .uat/' + HOST_ID + '.pre-c3-host.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
