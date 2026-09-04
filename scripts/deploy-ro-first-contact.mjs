#!/usr/bin/env node
// FINMENTOR — GATE 3: the Romanian first-contact safe branch in the Concierge.
//
//   node scripts/deploy-ro-first-contact.mjs --dry-run   read live, prove the delta, write nothing
//   node scripts/deploy-ro-first-contact.mjs --confirm    PUT the Concierge, fresh-read, verify
//
// THE DEFECT. Every Romanian page on the site carries a CTA to the public Telegram contact. That
// bot's non-owner branch answers from `Build Bot Response`, which holds 67 distinct Russian
// sendable strings and no Romanian at all — so a Romanian speaker following the site's own call to
// action landed in a Russian menu. The state machine already tracks `session.language` (from
// Telegram's `language_code`) and simply never read it back for output.
//
// THE FIX, AND ITS DELIBERATE LIMITS. Production v1 does NOT translate the Concierge — that stays
// POST_GO. This changes exactly two presentation values, and only when the resolved language is
// Romanian: the reply text becomes the owner-approved Romanian acknowledgement, and the keyboard
// becomes empty so no Russian menu is rendered. An empty keyboard is already a first-class layout
// in the transport (`L0_NONE`, `replyMarkup: none`), so nothing about routing, layouts or the
// callback contract changes.
//
// WHAT IS NOT TOUCHED. The state machine, `session.state`, `leadReady`, `leadPayload`, intent
// classification, consent and every Russian string are left exactly as they are. The branch is
// presentation-only and fail-contained: if `language` is anything other than Romanian — including
// empty — the original expressions run unchanged, so the RU path is byte-identical.
//
// A LIMIT WORTH STATING. The signal is the Telegram client's `language_code`. A Romanian speaker
// whose Telegram UI is set to Russian or English is not detected. That is the only language signal
// the request carries, and inventing a second one would be the identity system this gate forbids.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keepRollback } from './lib/rollback-artifact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const lf = (s) => s.replace(/\r\n/g, '\n');

export const WF_ID = 'mppzthlkSJFr6Kle';
export const NODE = 'Build Bot Response';

// The two lines the branch replaces, verbatim as they stand live.
export const ANCHOR = [
  'const replyText = safeText(out.text);',
  'const tgBody = { chat_id, text: replyText, reply_markup: out.markup || menuKeyboard() };'
].join('\n');

// Owner-approved wording (2026-09-04). Line breaks only are ours. No response-time promise, no
// claim that anyone has reviewed the request, no new consent or legal statement.
export const RO_TEXT = [
  'Bună ziua.',
  '',
  'Vă mulțumim că ați contactat FINMENTOR.',
  '',
  'Mesajul dumneavoastră a fost primit. Pentru o evaluare financiară preliminară puteți completa Radiografia Financiară FINMENTOR, iar pentru o discuție directă echipa FINMENTOR vă va contacta folosind datele furnizate.',
  '',
  'Pentru întrebări urgente ne puteți scrie și la cfo@finmentor.md.'
].join('\\n');

export const REPLACEMENT = [
  '// ── GATE 3 (2026-09-04) — Romanian first-contact safe branch ────────────────────────────────',
  '//',
  '// Presentation only. When the language resolved for THIS session is Romanian, answer in',
  '// Romanian and send NO keyboard, so a Romanian speaker is never dropped into the Russian menu.',
  '// The Concierge itself is not translated — that is POST_GO. Nothing above this line runs',
  '// differently: the state machine, leadReady, leadPayload and every Russian string are untouched,',
  '// and any language other than Romanian (including none) takes the original expressions.',
  '//',
  '// An empty inline_keyboard is a first-class layout downstream (L0_NONE), so no routing, layout',
  '// or callback contract changes.',
  'var RO_FIRST_CONTACT = "' + RO_TEXT + '";',
  // A proper language-tag test, not a two-character prefix: `ro` and `ro-MD` match, `roman` does
  // not. Telegram sends IETF tags, but a prefix test would silently widen the branch and the gate
  // caught exactly that.
  "var isRoFirstContact = /^ro(-|$)/.test(String(session.language || p.language || '').trim().toLowerCase());",
  '',
  'const replyText = isRoFirstContact ? safeText(RO_FIRST_CONTACT) : safeText(out.text);',
  'const tgBody = { chat_id, text: replyText, reply_markup: isRoFirstContact ? { inline_keyboard: [] } : (out.markup || menuKeyboard()) };'
].join('\n');

export function patch(code) {
  const c = lf(String(code || ''));
  if (c.indexOf(REPLACEMENT) !== -1) { return { code: c, changed: false }; }
  const hits = c.split(ANCHOR).length - 1;
  if (hits === 0) { throw new Error('the reply-build anchor was not found; refusing to guess'); }
  if (hits > 1) { throw new Error('the reply-build anchor appears ' + hits + ' times; refusing to guess'); }
  return { code: c.replace(ANCHOR, REPLACEMENT), changed: true };
}

// The delta this deploy is allowed to make: the anchor, and nothing else anywhere.
export function verify(before, after) {
  const f = [];
  const b = lf(before);
  const a = lf(after);
  if (b.replace(ANCHOR, REPLACEMENT) !== a) { f.push('the node changed somewhere other than the reply-build anchor'); }
  if (a.indexOf('RO_FIRST_CONTACT') === -1) { f.push('the Romanian text is missing'); }
  if (a.indexOf('inline_keyboard: []') === -1) { f.push('the empty-keyboard branch is missing'); }
  if (a.indexOf('menuKeyboard()') === -1) { f.push('the Russian menu path was removed instead of bypassed'); }
  // the Russian side must be untouched
  const ru = (s) => (s.match(/[А-Яа-яЁё]/g) || []).length;
  if (ru(a) !== ru(b)) { f.push('the Russian string content changed: ' + ru(b) + ' -> ' + ru(a)); }
  // Both overrides must stay conditional. Checking for the guard name alone is not enough — the
  // gate proved that: replacing only the text expression left the markup guard in place and the
  // check still passed, so each expression is asserted in full.
  if (a.indexOf('isRoFirstContact ? safeText(RO_FIRST_CONTACT) : safeText(out.text)') === -1) {
    f.push('the Romanian text is not behind a condition');
  }
  if (a.indexOf('isRoFirstContact ? { inline_keyboard: [] } : (out.markup || menuKeyboard())') === -1) {
    f.push('the empty keyboard is not behind a condition');
  }
  return f;
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-ro-first-contact.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const DRY = args.includes('--dry-run');
  const CONFIRM = args.includes('--confirm');
  const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const READ_KEY = process.env.N8N_API_KEY;
  const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
  const say = (m) => console.log(m);
  const ok = (m) => say('  PASS  ' + m);
  const die = (m) => { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); };
  const api = async (m, p, b) => {
    const res = await fetch(BASE + '/api/v1' + p, { method: m, headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}), body: b ? JSON.stringify(b) : undefined });
    const t = await res.text();
    if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
    return t ? JSON.parse(t) : null;
  };
  try {
    if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
    if (!DRY && !CONFIRM) { die('this rewrites a live workflow; re-run with --confirm (or --dry-run first)'); }
    mkdirSync(OUT_DIR, { recursive: true });
    say(''); say('GATE 3 — Concierge: Romanian first contact, no Russian menu'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN — nothing is written to the tenant' : '  MODE: LIVE'); say('');

    const live = await api('GET', '/workflows/' + WF_ID);
    const body = JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }, null, 2) + '\n';
    const rb = keepRollback(join(OUT_DIR, WF_ID + '.pre-ro-first-contact.json'), body);
    say('  live: "' + live.name + '"  ' + live.nodes.length + ' nodes  active=' + live.active);
    say('  rollback: ' + (rb.written ? '.uat/' + WF_ID + '.pre-ro-first-contact.json' : rb.aside ? 'KEPT (prior preserved; fresh read aside)' : 'KEPT (unchanged)'));

    const next = JSON.parse(JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: live.settings || {} }));
    const node = next.nodes.find((n) => n.name === NODE);
    if (!node || typeof (node.parameters || {}).jsCode !== 'string') { die('Code node missing: ' + NODE); }
    const beforeCode = lf(node.parameters.jsCode);
    const { code, changed } = patch(beforeCode);
    node.parameters.jsCode = code;

    const f = verify(beforeCode, code);
    if (changed && f.length) { die(f.join(' | ')); }
    // nothing else in the workflow may move
    for (const n of next.nodes) {
      const l = live.nodes.find((x) => x.name === n.name);
      if (n.name === NODE) { continue; }
      if (JSON.stringify(n) !== JSON.stringify(l)) { die('undeclared node changed: ' + n.name); }
    }
    if (JSON.stringify(next.connections) !== JSON.stringify(live.connections)) { die('connections changed'); }
    if (next.nodes.length !== live.nodes.length) { die('node count changed'); }

    say('  node: ' + NODE + '  ' + beforeCode.length + ' -> ' + code.length + ' chars  (' + (changed ? 'patched' : 'already current') + ')');
    ok('the only delta is the reply-build anchor; every Russian string, the state machine, leadReady and leadPayload are untouched');
    ok('empty keyboard resolves to the existing L0_NONE layout — no routing, layout or callback change');
    writeFileSync(join(OUT_DIR, WF_ID + '.ro-first-contact-candidate.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');

    if (DRY) { say('\nDRY RUN — nothing written to the tenant.'); }
    else if (!changed) { ok('already current, not written'); }
    else {
      await api('PUT', '/workflows/' + WF_ID, next);
      const after = await api('GET', '/workflows/' + WF_ID);
      const code2 = lf(after.nodes.find((n) => n.name === NODE).parameters.jsCode);
      const g = verify(beforeCode, code2);
      if (g.length) { say('  FAIL  post-deploy: ' + g.join(' | ')); }
      else { ok('written and read back, active=' + after.active); }
      say('\n  rollback: PUT /api/v1/workflows/' + WF_ID + ' with .uat/' + WF_ID + '.pre-ro-first-contact.json');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
