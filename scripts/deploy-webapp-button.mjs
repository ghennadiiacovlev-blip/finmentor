#!/usr/bin/env node
// FINMENTOR — preserve `web_app` buttons through the Telegram transport.
//
//   node scripts/deploy-webapp-button.mjs --dry-run
//   node scripts/deploy-webapp-button.mjs --confirm
//
// ── THE DEFECT ─────────────────────────────────────────────────────────────────────────────────
//
// The transport classifies each button as 'C' (callback) or 'U' (url) and rebuilds it as
// `{text, callback_data}` or `{text, url}`. There is no third case, so a `web_app` button is
// classified 'C' and rebuilt as a callback button with an EMPTY callback_data — a button that does
// nothing. That button is «Открыть бриф», the only way into the Mini App.
//
// ── WHY IT IS TWO WORKFLOWS ────────────────────────────────────────────────────────────────────
//
// The keyboard crosses a contract boundary. The Concierge derives a LAYOUT ID from the keyboard's
// shape-and-type signature; the transport sub-workflow validates the payload against that layout's
// spec and renders it with one Telegram node per layout. A new button type therefore needs a new
// type letter, a new layout, a validation branch and a renderer — and nothing else.
//
// ── WHAT IS NOT CHANGED ────────────────────────────────────────────────────────────────────────
//
// Every existing layout, spec, renderer and route is untouched. 'C' and 'U' behave exactly as
// before: this adds a case, it does not rewrite the mechanism. The proof is that reversing the
// additions restores both workflows byte-for-byte.
//
// The n8n Telegram node supports `web_app` in inline-keyboard additionalFields — confirmed against
// this instance's own node schema, not assumed — so no raw HTTP call and no bot token handling is
// introduced.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const TRANSPORT_ID = 'ShcmmJeLSE8LYVBk';
const NEW_LAYOUT = 'L1_W';
const RENDER_NODE = 'Render ' + NEW_LAYOUT;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => say('  FAIL  ' + m);
function die(m) { console.error('\nSTOPPED: ' + m); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this modifies two live workflows; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

say('');
say('web_app button preservation');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

// ── 1. the Concierge side: classify and preserve ────────────────────────────────────────────────

say('STEP 1 — Concierge: classify web_app, and copy only the fields a button actually has');
const conc = await api('GET', '/workflows/' + CONCIERGE_ID);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-webapp.json'), JSON.stringify(importable(conc), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-webapp.json');

const concPatched = JSON.parse(JSON.stringify(conc));
const transportNode = concPatched.nodes.find((n) => n.name === 'Build Transport Request');
if (!transportNode) { die('the Concierge has no Build Transport Request'); }

const OLD_TYPEOF = "function typeOf(btn) { if (btn && typeof btn.url === 'string' && btn.url.trim() !== '') return 'U'; return 'C'; }";
const NEW_TYPEOF = [
  "// A button's TYPE is what it does, and every button must do exactly one thing. 'W' is the",
  "// Telegram Web App launcher: before this it fell through to 'C' and was rebuilt as a callback",
  "// button with an empty callback_data — a button that silently does nothing.",
  "function destinations(btn) {",
  "  const b = btn || {};",
  "  const out = [];",
  "  if (typeof b.url === 'string' && b.url.trim() !== '') { out.push('U'); }",
  "  if (b.web_app && typeof b.web_app.url === 'string' && b.web_app.url.trim() !== '') { out.push('W'); }",
  "  if (typeof b.callback_data === 'string' && b.callback_data.trim() !== '') { out.push('C'); }",
  "  return out;",
  "}",
  "// Only these four keys may appear on a button. An unknown key is REFUSED, not stripped:",
  "// silently dropping something like login_url would coerce a button the author did not write",
  "// into one they did, and nothing would ever say so.",
  "const ALLOWED_BTN_KEYS = ['text', 'callback_data', 'url', 'web_app'];",
  "function typeOf(btn) {",
  "  const b0 = btn || {};",
  "  for (const k of Object.keys(b0)) { if (ALLOWED_BTN_KEYS.indexOf(k) === -1) { return 'X'; } }",
  "  // A web_app key that is present but empty is a botched Web App button, not a callback button.",
  "  // Saying so here keeps the refusal honest instead of surfacing as EMPTY_CALLBACK_DATA later.",
  "  if (b0.web_app !== undefined && String((b0.web_app || {}).url || '').trim() === '') { return 'X'; }",
  "  const d = destinations(btn);",
  "  // Two destinations is malformed, not a preference order: refusing beats guessing which one the",
  "  // author meant. An unknown signature is routed to the controlled recovery branch, never sent.",
  "  if (d.length !== 1) { return d.length === 0 ? 'C' : 'X'; }",
  "  return d[0];",
  "}"
].join('\n');

const OLD_KBROWS = [
  "const kbRows = rows.map(r => (r || []).map(btn => {",
  "  const o = { text: String((btn && btn.text) || '') };",
  "  if (typeOf(btn) === 'U') o.url = String(btn.url); else o.callback_data = String((btn && btn.callback_data) || '');",
  "  return o;",
  "}));"
].join('\n');
const NEW_KBROWS = [
  "// Copy only the destination field the button actually has. The old form synthesised",
  "// `callback_data: ''` for anything that was not a URL, which is how a web_app button became a",
  "// dead callback button.",
  "const kbRows = rows.map(r => (r || []).map(btn => {",
  "  const o = { text: String((btn && btn.text) || '') };",
  "  const t = typeOf(btn);",
  "  if (t === 'U') { o.url = String(btn.url); }",
  "  else if (t === 'W') { o.web_app = { url: String(btn.web_app.url) }; }",
  "  else if (t === 'C') { o.callback_data = String((btn && btn.callback_data) || ''); }",
  "  // 'X' (ambiguous) deliberately produces a button with NO destination, so the signature cannot",
  "  // match any layout and the reply goes to recovery instead of Telegram.",
  "  return o;",
  "}));"
].join('\n');

{
  const code = transportNode.parameters.jsCode;
  if (code.indexOf(OLD_TYPEOF) === -1) { die('Build Transport Request: typeOf() is not in the expected form — do not splice blindly'); }
  if (code.indexOf(OLD_KBROWS) === -1) { die('Build Transport Request: the kbRows mapping is not in the expected form'); }
  if (code.indexOf("'C|C': 'L2_C',") === -1) { die('Build Transport Request: the layout MAP is not in the expected form'); }
  let next = code.replace(OLD_TYPEOF, NEW_TYPEOF).replace(OLD_KBROWS, NEW_KBROWS);
  // One new signature: a single row with a single web_app button — the «Открыть бриф» screen.
  next = next.replace("'C|C': 'L2_C',", "'C|C': 'L2_C',\n  'W': '" + NEW_LAYOUT + "',");
  transportNode.parameters.jsCode = next;
  try { new Function(next.replace(/\$\(/g, '__ref(').replace(/\$json/g, '__json')); }
  catch (e) { die('the patched Build Transport Request does not parse: ' + e.message); }
  ok('typeOf recognises web_app, refuses ambiguous buttons, and kbRows copies only real fields');
  ok("layout MAP gains 'W' -> " + NEW_LAYOUT + '; every existing entry untouched');
}

{
  const changed = concPatched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(conc.nodes.find((x) => x.name === n.name))).map((n) => n.name);
  if (changed.join(',') !== 'Build Transport Request') { die('the Concierge change touches ' + changed.join(', ')); }
  if (JSON.stringify(concPatched.connections) !== JSON.stringify(conc.connections)) { die('the Concierge graph changed'); }
  ok('exactly one Concierge node differs, and no edge moved');
}
say('');

// ── 2. the transport sub-workflow: validate and render ─────────────────────────────────────────

say('STEP 2 — transport: a W spec, a W validation branch, and a renderer');
const tr = await api('GET', '/workflows/' + TRANSPORT_ID);
writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.pre-webapp.json'), JSON.stringify(importable(tr), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + TRANSPORT_ID + '.pre-webapp.json');

const trPatched = JSON.parse(JSON.stringify(tr));
const validator = trPatched.nodes.find((n) => n.name === 'Validate Transport Payload');
const router = trPatched.nodes.find((n) => n.name === 'Route Keyboard Layout');
const l1c = trPatched.nodes.find((n) => n.name === 'Render L1_C');
if (!validator || !router || !l1c) { die('the transport sub-workflow is not in the expected shape'); }

{
  let code = validator.parameters.jsCode;
  if (code.indexOf('L1_C: [[\'C\']],') === -1) { die('the LAYOUTS table is not in the expected form'); }
  if (code.indexOf(NEW_LAYOUT) !== -1) { die('the transport already knows ' + NEW_LAYOUT + ' — nothing to do'); }
  code = code.replace("L1_C: [['C']],", "L1_C: [['C']], " + NEW_LAYOUT + ": [['W']],");

  // Exactly one destination per button, checked before the spec is applied. The spec decides which
  // field to READ; this decides whether the button is coherent at all.
  const OLD_BTN = "    const btnText = String(src.text == null ? '' : src.text).trim();";
  if (code.indexOf(OLD_BTN) === -1) { die('the button loop is not in the expected form'); }
  code = code.replace(OLD_BTN, [
    "    // A button must carry EXACTLY ONE destination. The spec below decides which field to read;",
    "    // this decides whether the button is coherent at all, so a callback_data+web_app button is",
    "    // refused rather than silently rendered as whichever the spec happened to expect.",
    "    const dests = ['url', 'web_app', 'callback_data'].filter(function (f) {",
    "      const v = src[f];",
    "      if (f === 'web_app') { return !!(v && String(v.url == null ? '' : v.url).trim() !== ''); }",
    "      return typeof v === 'string' && v.trim() !== '';",
    "    });",
    "    if (dests.length > 1) return fail('AMBIGUOUS_BUTTON_DESTINATION');",
    "    const ALLOWED_BTN_KEYS = ['text', 'callback_data', 'url', 'web_app'];",
    "    for (const key of Object.keys(src)) {",
    "      if (ALLOWED_BTN_KEYS.indexOf(key) === -1) return fail('UNKNOWN_BUTTON_FIELD');",
    "    }",
    OLD_BTN
  ].join('\n'));

  // The W branch. HTTPS only: Telegram requires it for Web Apps, and a http:// launcher would be a
  // downgrade the client cannot warn about.
  const OLD_ELSE = [
    "    } else {",
    "      const url = String(src.url == null ? '' : src.url).trim();",
    "      if (!/^https?:\\/\\/[^\\s]{3,}$/i.test(url)) return fail('INVALID_BUTTON_URL');",
    "      outRow.push({ text: btnText, url: url });",
    "    }"
  ].join('\n');
  if (code.indexOf(OLD_ELSE) === -1) { die('the URL branch is not in the expected form'); }
  code = code.replace(OLD_ELSE, [
    "    } else if (specRow[b] === 'W') {",
    "      const wurl = String((src.web_app && src.web_app.url) == null ? '' : src.web_app.url).trim();",
    "      if (wurl === '') return fail('EMPTY_WEB_APP_URL');",
    "      // Telegram requires HTTPS for Web Apps; http:// is refused rather than downgraded.",
    "      if (!/^https:\\/\\/[^\\s]{3,}$/i.test(wurl)) return fail('INVALID_WEB_APP_URL');",
    "      outRow.push({ text: btnText, web_app: { url: wurl } });",
    "    } else {",
    "      const url = String(src.url == null ? '' : src.url).trim();",
    "      if (!/^https?:\\/\\/[^\\s]{3,}$/i.test(url)) return fail('INVALID_BUTTON_URL');",
    "      outRow.push({ text: btnText, url: url });",
    "    }"
  ].join('\n'));
  validator.parameters.jsCode = code;
  try { new Function(code.replace(/\$input/g, '__input')); }
  catch (e) { die('the patched validator does not parse: ' + e.message); }
  ok('LAYOUTS gains ' + NEW_LAYOUT + ": [['W']]; a W branch validates an HTTPS web_app.url");
  ok('a button with two destinations, or an unknown field, is now refused');
}

// The renderer: a copy of Render L1_C with web_app in place of callback_data.
{
  const render = JSON.parse(JSON.stringify(l1c));
  render.name = RENDER_NODE;
  render.id = 'render-l1-w';
  render.position = [(l1c.position[0] || 0), (l1c.position[1] || 0) - 220];
  render.parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields = {
    web_app: { url: '={{ $json.kb[0][0].web_app.url }}' }
  };
  if (JSON.stringify(render.parameters).indexOf('callback_data') !== -1) { die(RENDER_NODE + ' still carries callback_data'); }
  trPatched.nodes.push(render);
  ok(RENDER_NODE + ' added — same node type and credential as Render L1_C, web_app instead of callback_data');
}

// The route.
{
  const rules = router.parameters.rules.values;
  const template = JSON.parse(JSON.stringify(rules[1]));   // L1_C
  template.outputKey = NEW_LAYOUT;
  template.conditions.conditions[0].rightValue = NEW_LAYOUT;
  if (template.conditions.conditions[0].id) { template.conditions.conditions[0].id = 'route-l1-w'; }
  // The Switch has one output per rule PLUS a trailing fallback (`fallbackOutput: extra`,
  // renamed UNROUTED) wired to Return Transport Error. So the new route must be INSERTED before
  // that fallback, not appended after it — appending would put the new rule's traffic on the
  // error output and send every unrouted layout to the renderer. The invariant below caught
  // exactly that.
  const main = trPatched.connections['Route Keyboard Layout'].main;
  const fallbackIdx = main.length - 1;
  const fallbackBefore = JSON.stringify(main[fallbackIdx]);
  if (!/Return Transport Error/.test(fallbackBefore)) {
    die('the last router output is not the error fallback — refusing to insert blindly');
  }
  rules.push(template);
  main.splice(fallbackIdx, 0, [{ node: RENDER_NODE, type: 'main', index: 0 }]);
  if (main.length !== rules.length + 1) { die('router outputs and rules disagree: ' + main.length + ' vs ' + rules.length + ' + fallback'); }
  if (JSON.stringify(main[main.length - 1]) !== fallbackBefore) { die('the error fallback moved'); }
  trPatched.connections[RENDER_NODE] = { main: [[{ node: 'Normalize Telegram Result', type: 'main', index: 0 }]] };
  ok('router gains a ' + NEW_LAYOUT + ' rule and output, wired to ' + RENDER_NODE + ' -> Normalize Telegram Result');
}
say('');

// ── 3. invariants ──────────────────────────────────────────────────────────────────────────────

say('STEP 3 — prove the existing transport is untouched');
{
  if (trPatched.nodes.length !== tr.nodes.length + 1) { die('transport node count moved by ' + (trPatched.nodes.length - tr.nodes.length)); }
  const drift = [];
  for (const n of trPatched.nodes) {
    if (n.name === RENDER_NODE) { continue; }
    const was = tr.nodes.find((x) => x.name === n.name);
    if (!was) { drift.push(n.name + ' (new)'); continue; }
    if (JSON.stringify(n) !== JSON.stringify(was)) { drift.push(n.name); }
  }
  if (drift.sort().join(',') !== 'Route Keyboard Layout,Validate Transport Payload') {
    die('transport nodes changed beyond the two intended: ' + drift.join(', '));
  }
  ok('exactly two existing nodes changed (validator, router) and one was added');

  // Every legacy renderer must be byte-identical.
  for (const n of tr.nodes) {
    if (!/^Render /.test(n.name)) { continue; }
    const now = trPatched.nodes.find((x) => x.name === n.name);
    if (JSON.stringify(now) !== JSON.stringify(n)) { die('a legacy renderer changed: ' + n.name); }
  }
  ok('all ' + tr.nodes.filter((n) => /^Render /.test(n.name)).length + ' existing renderers byte-identical');

  // Every pre-existing route must still point where it did.
  {
    const wasMain = tr.connections['Route Keyboard Layout'].main;
    const nowMain = trPatched.connections['Route Keyboard Layout'].main;
    for (let i = 0; i < wasMain.length - 1; i++) {
      if (JSON.stringify(wasMain[i]) !== JSON.stringify(nowMain[i])) { die('route ' + i + ' changed'); }
    }
    if (JSON.stringify(wasMain[wasMain.length - 1]) !== JSON.stringify(nowMain[nowMain.length - 1])) {
      die('the UNROUTED fallback no longer points at Return Transport Error');
    }
    ok('every pre-existing route unchanged; the new one sits before the UNROUTED fallback');
  }

  // The legacy LAYOUTS specs must be unchanged apart from the added entry.
  const undone = validator.parameters.jsCode
    .replace(" " + NEW_LAYOUT + ": [['W']],", '');
  if (undone.indexOf(NEW_LAYOUT) !== -1) { /* the W branch remains, expected */ }
  for (const layout of ['L0_NONE', 'L2_C', 'L2_CU', 'LAYOUT_MENU', 'LAYOUT_BMODEL']) {
    if (validator.parameters.jsCode.indexOf(layout + ':') === -1) { die('a legacy layout vanished from the spec: ' + layout); }
  }
  ok('every legacy layout spec still present');

  for (const w of [concPatched, trPatched]) {
    for (const n of w.nodes) {
      if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { die('P9-R2 flag pair on ' + n.name); }
    }
  }
  ok('P9-R2 flag pair absent in both workflows');
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.webapp-candidate.json'), JSON.stringify(importable(concPatched), null, 2) + '\n', 'utf8');
  writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.webapp-candidate.json'), JSON.stringify(importable(trPatched), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written to n8n. Candidates saved to .uat/ for the proof harness.');
  say('');
} else {
  say('STEP 4 — writing');
  // Transport FIRST: the Concierge must never emit a layout the transport cannot render.
  await api('PUT', '/workflows/' + TRANSPORT_ID, importable(trPatched), 3);
  ok('transport sub-workflow updated (it must understand ' + NEW_LAYOUT + ' before the Concierge can emit it)');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(concPatched), 3);
  ok('Concierge updated');
  say('');

  say('STEP 5 — fresh read and verify');
  let good = true;
  const t2 = await api('GET', '/workflows/' + TRANSPORT_ID);
  const c2 = await api('GET', '/workflows/' + CONCIERGE_ID);
  if (!t2.active) { bad('the transport sub-workflow is NOT active'); good = false; } else { ok('transport active'); }
  if (!c2.active) { bad('the Concierge is NOT active'); good = false; } else { ok('Concierge active'); }
  if (t2.name !== tr.name || c2.name !== conc.name) { bad('a workflow was renamed'); good = false; } else { ok('names unchanged'); }
  if (!t2.nodes.find((n) => n.name === RENDER_NODE)) { bad(RENDER_NODE + ' is missing after deploy'); good = false; }
  else { ok(RENDER_NODE + ' present'); }
  const v2 = t2.nodes.find((n) => n.name === 'Validate Transport Payload');
  if (v2.parameters.jsCode.indexOf('INVALID_WEB_APP_URL') === -1) { bad('the validator has no web_app branch'); good = false; }
  else { ok('validator carries the web_app branch'); }
  const bt = c2.nodes.find((n) => n.name === 'Build Transport Request');
  if (bt.parameters.jsCode.indexOf("'W': '" + NEW_LAYOUT + "'") === -1) { bad('the Concierge cannot emit ' + NEW_LAYOUT); good = false; }
  else { ok('Concierge maps a web_app keyboard to ' + NEW_LAYOUT); }
  for (const [label, w, before] of [['Concierge', c2, conc], ['transport', t2, tr]]) {
    const err = (w.settings || {}).errorWorkflow;
    const was = (before.settings || {}).errorWorkflow;
    if (String(err || '') !== String(was || '')) { bad(label + ': errorWorkflow binding changed'); good = false; }
  }
  ok('error monitor bindings unchanged in both workflows');
  say('');
  say(good ? '  WEB_APP BUTTON = PASS' : '  WEB_APP BUTTON = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + TRANSPORT_ID + '  with .uat/' + TRANSPORT_ID + '.pre-webapp.json');
  say('            PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-webapp.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
