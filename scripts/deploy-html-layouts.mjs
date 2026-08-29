#!/usr/bin/env node
// FINMENTOR — two authorised HTML layouts: no buttons, and one web_app button.
//
//   node scripts/deploy-html-layouts.mjs --dry-run
//   node scripts/deploy-html-layouts.mjs --confirm
//
// ── WHY ────────────────────────────────────────────────────────────────────────────────────────
//
// The owner copy pass makes every client-facing Premium screen HTML. The transport picks a renderer
// from the keyboard's shape-and-type signature PLUS the parse mode, and only `L2_C_HTML` exists.
// Two screen shapes therefore have nowhere to go:
//
//   no buttons   + HTML   TG_FREEFORM_PROBLEM, TG_APPEND_MESSAGE   ->  L0_NONE_HTML
//   one web_app  + HTML   TG_OPEN_BRIEF                            ->  L1_W_HTML
//
// Without them those three screens fail closed at the transport — correctly, and invisibly to the
// client. This is STRICTLY ADDITIVE: two LAYOUTS entries, two MAP entries, two router rules, two
// render nodes. No existing spec, renderer or rule is touched.
//
// ── THE TRAP THIS SCRIPT EXISTS TO AVOID ───────────────────────────────────────────────────────
//
// `Route Keyboard Layout` is a Switch with `fallbackOutput: 'extra'`. The fallback is a TRAILING
// output, currently index 16, wired to `Return Transport Error`. Appending two rules makes 16 and
// 17 the new rules and pushes the fallback to 18. Adding rules without moving that connection would
// silently route every no-button HTML message to the ERROR output. So the rewire is asserted, not
// assumed: after patching, the fallback index must equal rules.length and still point at the error
// handler, and every pre-existing rule must keep the output index it had.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const TRANSPORT_ID = 'ShcmmJeLSE8LYVBk';
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const ROUTER = 'Route Keyboard Layout';
const VALIDATOR = 'Validate Transport Payload';
const ERROR_NODE = 'Return Transport Error';

// [new layout, the layout it is cloned from, the signature the Concierge derives]
const NEW = [
  { layout: 'L0_NONE_HTML', from: 'L0_NONE', spec: '[]', sig: '' },
  { layout: 'L1_W_HTML', from: 'L1_W', spec: "[['W']]", sig: 'W' }
];

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
say('Two authorised HTML layouts: L0_NONE_HTML and L1_W_HTML');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

// ---------------------------------------------------------------- 1. rollback + hashes

say('STEP 1 — fresh read, rollback artifacts, structural hashes');
const transport = await api('GET', '/workflows/' + TRANSPORT_ID);
const concierge = await api('GET', '/workflows/' + CONCIERGE_ID);
const hashOf = (w) => sha({ n: w.nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null]), c: w.connections });
const tHashBefore = hashOf(transport);
const cHashBefore = hashOf(concierge);
say('  transport : ' + transport.nodes.length + ' nodes  active=' + transport.active + '  ' + tHashBefore);
say('  concierge : ' + concierge.nodes.length + ' nodes  active=' + concierge.active + '  ' + cHashBefore);
writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.pre-html-layouts.json'), JSON.stringify(importable(transport), null, 2) + '\n', 'utf8');
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-html-layouts.json'), JSON.stringify(importable(concierge), null, 2) + '\n', 'utf8');
ok('rollback captured for both workflows');
say('');

// ---------------------------------------------------------------- 2. patch the transport

say('STEP 2 — transport: LAYOUTS, router rules, render nodes');
const tp = JSON.parse(JSON.stringify(transport));
const validator = tp.nodes.find((n) => n.name === VALIDATOR);
const router = tp.nodes.find((n) => n.name === ROUTER);
if (!validator || !router) { die('the transport is missing the validator or the router'); }

// -- 2a. LAYOUTS: append, never rewrite.
{
  let code = String(validator.parameters.jsCode);
  const anchor = "L2_C_HTML: [['C'],['C']],";
  if (code.indexOf(anchor) === -1) { die('the LAYOUTS table is not in the expected form'); }
  for (const n of NEW) {
    if (code.indexOf(n.layout + ':') !== -1) { die(n.layout + ' is already registered'); }
  }
  const add = NEW.map((n) => ' ' + n.layout + ': ' + n.spec + ',').join('');
  code = code.replace(anchor, anchor + add);
  validator.parameters.jsCode = code;
  ok('LAYOUTS gains ' + NEW.map((n) => n.layout + ': ' + n.spec).join(' and '));
}

// -- 2b. router rules, appended after the existing ones.
const rulesBefore = (router.parameters.rules.values || []).map((r) => r.outputKey);
{
  const values = router.parameters.rules.values;
  const template = values.find((v) => v.outputKey === 'L2_C_HTML');
  if (!template) { die('no L2_C_HTML rule to model the new ones on'); }
  for (const n of NEW) {
    const rule = JSON.parse(JSON.stringify(template));
    rule.outputKey = n.layout;
    const conds = rule.conditions.conditions;
    if (conds.length !== 1) { die('the router rule shape changed — refusing to guess'); }
    conds[0].rightValue = n.layout;
    if (conds[0].id) { conds[0].id = crypto.randomUUID(); }
    if (rule.conditions.options && rule.conditions.options.version === undefined) { /* leave as-is */ }
    values.push(rule);
  }
  ok('router rules appended: ' + NEW.map((n) => n.layout).join(', '));
}

// -- 2c. the fallback output MUST follow the rules along.
{
  const conns = tp.connections[ROUTER].main;
  const ruleCount = router.parameters.rules.values.length;
  const fallbackWas = conns.length - 1;
  const fallbackTargets = conns[fallbackWas];
  if (!fallbackTargets || !fallbackTargets.length || fallbackTargets[0].node !== ERROR_NODE) {
    die('the trailing output is not the error handler — refusing to move anything');
  }
  // Rebuild: every existing rule keeps its index, the two new rules get theirs, the fallback moves
  // to the new trailing position.
  const rebuilt = [];
  for (let i = 0; i < fallbackWas; i++) { rebuilt.push(conns[i]); }
  rebuilt.push([{ node: 'Render ' + NEW[0].layout, type: 'main', index: 0 }]);
  rebuilt.push([{ node: 'Render ' + NEW[1].layout, type: 'main', index: 0 }]);
  rebuilt.push(fallbackTargets);
  if (rebuilt.length !== ruleCount + 1) { die('output count does not match rules + fallback'); }
  tp.connections[ROUTER].main = rebuilt;
  ok('fallback moved from output ' + fallbackWas + ' to ' + (rebuilt.length - 1) + ', still -> ' + ERROR_NODE);
}

// -- 2d. render nodes, cloned from the proven plain-text ones plus parse_mode.
{
  const anchorNode = tp.nodes.find((n) => n.name === 'Render L2_C_HTML');
  let dy = 0;
  for (const n of NEW) {
    const src = tp.nodes.find((x) => x.name === 'Render ' + n.from);
    if (!src) { die('no Render ' + n.from + ' to clone'); }
    if (tp.nodes.find((x) => x.name === 'Render ' + n.layout)) { die('Render ' + n.layout + ' already exists'); }
    const clone = JSON.parse(JSON.stringify(src));
    clone.name = 'Render ' + n.layout;
    clone.id = crypto.randomUUID();
    clone.position = [(anchorNode.position[0] || 0), (anchorNode.position[1] || 0) + 220 + dy];
    dy += 220;
    clone.parameters.additionalFields = Object.assign({}, clone.parameters.additionalFields, { parse_mode: 'HTML' });
    tp.nodes.push(clone);
    // The clone must send exactly what its plain twin sends, apart from the parse mode.
    const a = JSON.parse(JSON.stringify(clone.parameters));
    delete a.additionalFields.parse_mode;
    if (JSON.stringify(a) !== JSON.stringify(src.parameters)) {
      die('Render ' + n.layout + ' differs from Render ' + n.from + ' by more than the parse mode');
    }
  }
  ok('render nodes added: ' + NEW.map((n) => 'Render ' + n.layout + ' (clone of Render ' + n.from + ' + parse_mode HTML)').join(', '));
  // Wire each new render node onward exactly like the node it was cloned from.
  for (const n of NEW) {
    const srcOut = transport.connections['Render ' + n.from];
    if (srcOut) { tp.connections['Render ' + n.layout] = JSON.parse(JSON.stringify(srcOut)); }
  }
  ok('each new renderer is wired onward exactly like its plain twin');
}
say('');

// ---------------------------------------------------------------- 3. patch the concierge MAP

say('STEP 3 — concierge: two MAP entries, nothing else');
const cp = JSON.parse(JSON.stringify(concierge));
{
  const btr = cp.nodes.find((n) => n.name === 'Build Transport Request');
  let code = String(btr.parameters.jsCode);
  const anchor = "  'C|C#HTML': 'L2_C_HTML',";
  if (code.indexOf(anchor) === -1) { die('the MAP is not in the expected form'); }
  const add = NEW.map((n) => "\n  '" + n.sig + "#HTML': '" + n.layout + "',").join('');
  for (const n of NEW) {
    // Matched as a whole MAP line. The no-button signature is the EMPTY string, so a substring
    // test for "'#HTML'" also matches "'C|C#HTML'" and reports a duplicate that is not there.
    if (code.indexOf("\n  '" + n.sig + "#HTML':") !== -1) { die("'" + n.sig + "#HTML' is already mapped"); }
  }
  code = code.replace(anchor, anchor + add);
  btr.parameters.jsCode = code;
  ok("MAP gains '#HTML' -> L0_NONE_HTML and 'W#HTML' -> L1_W_HTML");

  const changed = cp.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(concierge.nodes.find((x) => x.name === n.name))).map((n) => n.name);
  if (changed.join('|') !== 'Build Transport Request') { die('concierge nodes changed beyond the MAP: ' + changed.join(', ')); }
  ok('exactly one concierge node differs');
  const undone = code.replace(anchor + add, anchor);
  if (undone !== String(concierge.nodes.find((n) => n.name === 'Build Transport Request').parameters.jsCode)) {
    die('the MAP change is not a pure insertion');
  }
  ok('the MAP change is a PURE insertion — removing the two lines restores the node byte-for-byte');
}
say('');

// ---------------------------------------------------------------- 4. the ten safety proofs

say('STEP 4 — the transport safety gate');
let good = true;
const gate = (cond, m) => { if (cond) { ok(m); } else { bad(m); good = false; } };

// (3) additive only
{
  const before = new Set(transport.nodes.map((n) => n.name));
  const added = tp.nodes.filter((n) => !before.has(n.name)).map((n) => n.name).sort();
  gate(added.join(', ') === 'Render L0_NONE_HTML, Render L1_W_HTML', 'exactly two nodes added: ' + added.join(', '));
  // Two existing nodes must change and no others: the validator gains two LAYOUTS entries, the
  // router gains two rules. Every renderer, in particular, must be untouched.
  const touched = tp.nodes.filter((n) => before.has(n.name) &&
    JSON.stringify(n) !== JSON.stringify(transport.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  gate(touched.join(' + ') === [ROUTER, VALIDATOR].sort().join(' + '),
    'exactly two existing nodes modified — ' + touched.join(' + ') + ' — and no renderer among them');
}

// (4) legacy layout specs unchanged
{
  const specOf = (code) => {
    const i = code.indexOf('const LAYOUTS = {');
    const j = code.indexOf('};', i);
    const table = code.slice(i, j);
    const out = {};
    for (const m of table.matchAll(/([A-Z0-9_]+):\s*(\[[^\]]*\]|\[\])/g)) { out[m[1]] = m[2].replace(/\s+/g, ''); }
    return out;
  };
  const was = specOf(String(transport.nodes.find((n) => n.name === VALIDATOR).parameters.jsCode));
  const now = specOf(String(validator.parameters.jsCode));
  let intact = true;
  for (const k of Object.keys(was)) { if (was[k] !== now[k]) { intact = false; say('        changed spec: ' + k); } }
  gate(intact, 'every pre-existing layout spec is byte-identical');
  gate(Object.keys(now).length === Object.keys(was).length + 2, 'exactly two layout specs added');
}

// router: existing rules keep their output index; fallback is last and still the error handler
{
  const after = (router.parameters.rules.values || []).map((r) => r.outputKey);
  gate(after.slice(0, rulesBefore.length).join(',') === rulesBefore.join(','), 'every pre-existing router rule keeps its output index');
  const conns = tp.connections[ROUTER].main;
  gate(conns.length === after.length + 1, 'outputs = rules + one fallback (' + conns.length + ')');
  gate(conns[conns.length - 1][0].node === ERROR_NODE, 'the trailing output is still the error handler');
  let aligned = true;
  after.forEach((key, i) => {
    const target = (conns[i] || [])[0];
    if (!target || target.node !== 'Render ' + key) { aligned = false; say('        rule ' + i + ' (' + key + ') -> ' + (target ? target.node : 'NOTHING')); }
  });
  gate(aligned, 'every rule routes to the renderer of its own name');
}

// (5)(6)(7) behaviour: run the patched validator over real payload shapes
{
  // The node reads `keyboard_layout_id` and `keyboard_data`, and answers {valid, error_code, kb}.
  // Feeding it `layout`/`kb` makes EVERY case return UNKNOWN_LAYOUT — including the malformed ones,
  // which then "fail closed" for entirely the wrong reason. So the harness is proved first: a known
  // good payload must come back valid, or nothing below means anything.
  const vcode = String(validator.parameters.jsCode);
  const runValidator = (payload) => {
    const fn = new Function('$input', vcode);
    try { return fn({ first: () => ({ json: payload }) })[0].json; }
    catch (e) { return { __threw: String(e && e.message) }; }
  };
  const P = (layout, rows) => ({ chat_id: '551000000', text: 'проверка', disable_preview: true,
    correlation_id: 'proof', keyboard_layout_id: layout, keyboard_data: rows });

  const sane = runValidator(P('L2_C', [[{ text: 'a', callback_data: 'p|a' }], [{ text: 'b', callback_data: 'p|b' }]]));
  gate(sane.valid === true, 'HARNESS: a known-good legacy payload validates — the harness feeds the node correctly');
  if (sane.valid !== true) { die('the harness does not drive the validator; every result below would be meaningless'); }

  const w = runValidator(P('L1_W_HTML', [[{ text: 'Открыть бриф', web_app: { url: 'https://example.invalid/app' } }]]));
  gate(w.valid === true && !!(w.kb && w.kb[0][0].web_app && w.kb[0][0].web_app.url), 'L1_W_HTML: a web_app button stays a web_app button');
  gate(w.valid === true && w.kb[0][0].callback_data === undefined, 'L1_W_HTML: no callback_data was synthesised onto it');

  const n0 = runValidator(P('L0_NONE_HTML', []));
  gate(n0.valid === true && Array.isArray(n0.kb) && n0.kb.length === 0, 'L0_NONE_HTML: a no-button payload is accepted with an empty keyboard');

  const u = runValidator(P('L2_CU', [[{ text: 'a', callback_data: 'p|x' }], [{ text: 'b', url: 'https://example.invalid/p' }]]));
  gate(u.valid === true && !!(u.kb && u.kb[1][0].url) && u.kb[0][0].callback_data === 'p|x',
    'a URL button is still a URL button, and a callback still a callback (legacy layout untouched)');

  // (10) malformed button types must fail closed on the NEW layouts too. Each expects its OWN
  // error code — a blanket "it was refused" would pass on UNKNOWN_LAYOUT for all of them.
  const malformed = [
    ['web_app with an empty url', P('L1_W_HTML', [[{ text: 'x', web_app: { url: '' } }]]), 'EMPTY_WEB_APP_URL'],
    ['web_app over http', P('L1_W_HTML', [[{ text: 'x', web_app: { url: 'http://example.invalid/a' } }]]), 'INVALID_WEB_APP_URL'],
    ['a callback where a web_app belongs', P('L1_W_HTML', [[{ text: 'x', callback_data: 'p|x' }]]), 'EMPTY_WEB_APP_URL'],
    ['two destinations on one button', P('L1_W_HTML', [[{ text: 'x', callback_data: 'p|x', web_app: { url: 'https://example.invalid/a' } }]]), 'AMBIGUOUS_BUTTON_DESTINATION'],
    ['an unknown button field', P('L1_W_HTML', [[{ text: 'x', web_app: { url: 'https://example.invalid/a' }, pay: true }]]), 'UNKNOWN_BUTTON_FIELD'],
    ['buttons on a no-button layout', P('L0_NONE_HTML', [[{ text: 'x', callback_data: 'p|x' }]]), 'KEYBOARD_SHAPE_MISMATCH'],
    ['an unregistered HTML layout', P('L3_C_HTML', [[{ text: 'a', callback_data: 'p|a' }]]), 'UNKNOWN_LAYOUT'],
    ['empty button text', P('L1_W_HTML', [[{ text: '  ', web_app: { url: 'https://example.invalid/a' } }]]), 'EMPTY_BUTTON_TEXT']
  ];
  let closed = true;
  for (const [name, payload, want] of malformed) {
    const r = runValidator(payload);
    if (r.valid !== false || r.error_code !== want) {
      closed = false;
      say('        ' + name + ' -> ' + (r.__threw ? 'THREW ' + r.__threw : JSON.stringify({ valid: r.valid, error_code: r.error_code })) + '   (want ' + want + ')');
    }
  }
  gate(closed, 'all ' + malformed.length + ' malformed shapes fail closed, each with its own error code');
}

// (9) malformed HTML must not be invented by the transport: the renderer sets the mode, the
// Concierge authors the markup, and the validator never rewrites text.
{
  const vcode = String(validator.parameters.jsCode);
  gate(vcode.indexOf('parse_mode') === -1, 'the validator does not touch parse_mode — the renderer owns it');
  const htmlRenderers = tp.nodes.filter((n) => /^Render .*_HTML$/.test(n.name));
  gate(htmlRenderers.length === 3, 'exactly three HTML renderers exist (L2_C_HTML + the two new)');
  let allHtml = true;
  for (const n of htmlRenderers) {
    if (((n.parameters || {}).additionalFields || {}).parse_mode !== 'HTML') { allHtml = false; say('        not HTML: ' + n.name); }
  }
  gate(allHtml, 'every HTML renderer declares parse_mode HTML');
  let plainClean = true;
  for (const n of tp.nodes) {
    if (!/^Render /.test(n.name) || /_HTML$/.test(n.name)) { continue; }
    if (((n.parameters || {}).additionalFields || {}).parse_mode) { plainClean = false; say('        plain renderer gained a mode: ' + n.name); }
  }
  gate(plainClean, 'no plain renderer picked up a parse mode');
}

// (8) non-owner legacy: the Concierge owner gate and the legacy response node are untouched here
{
  const gateNode = cp.nodes.find((n) => n.name === 'Premium Owner Gate');
  const legacy = cp.nodes.find((n) => n.name === 'Build Bot Response');
  gate(JSON.stringify(gateNode) === JSON.stringify(concierge.nodes.find((n) => n.name === 'Premium Owner Gate')), 'the owner gate is untouched');
  gate(JSON.stringify(legacy) === JSON.stringify(concierge.nodes.find((n) => n.name === 'Build Bot Response')), 'the legacy response builder is untouched');
  gate(JSON.stringify(cp.connections) === JSON.stringify(concierge.connections), 'concierge connections unchanged');
}

// P9-R2 flag pair
{
  let clean = true;
  for (const n of tp.nodes.concat(cp.nodes)) {
    if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { clean = false; say('        ' + n.name); }
  }
  gate(clean, 'no P9-R2 fail-open flag pair anywhere');
}
say('');

if (!good) { die('the safety gate failed — nothing was written'); }

if (DRY) {
  writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.html-layouts-candidate.json'), JSON.stringify(importable(tp), null, 2) + '\n', 'utf8');
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.html-layouts-candidate.json'), JSON.stringify(importable(cp), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written. Candidates saved to .uat/.');
  say('');
} else {
  say('STEP 5 — writing');
  await api('PUT', '/workflows/' + TRANSPORT_ID, importable(tp), 3);
  ok('transport written');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(cp), 3);
  ok('concierge written');
  say('');
  say('STEP 6 — fresh read and verify');
  const t2 = await api('GET', '/workflows/' + TRANSPORT_ID);
  const c2 = await api('GET', '/workflows/' + CONCIERGE_ID);
  let v = true;
  const vr = (cond, m) => { if (cond) { ok(m); } else { bad(m); v = false; } };
  vr(t2.active, 'transport active');
  vr(c2.active, 'concierge active');
  vr(t2.nodes.length === transport.nodes.length + 2, 'transport node count +2 (' + t2.nodes.length + ')');
  vr(c2.nodes.length === concierge.nodes.length, 'concierge node count unchanged (' + c2.nodes.length + ')');
  const r2 = t2.nodes.find((n) => n.name === ROUTER);
  const conns2 = t2.connections[ROUTER].main;
  vr(conns2.length === r2.parameters.rules.values.length + 1, 'router outputs = rules + fallback');
  vr(conns2[conns2.length - 1][0].node === ERROR_NODE, 'fallback still routes to ' + ERROR_NODE);
  for (const n of NEW) {
    vr(!!t2.nodes.find((x) => x.name === 'Render ' + n.layout), 'Render ' + n.layout + ' is live');
    vr(String(t2.nodes.find((x) => x.name === VALIDATOR).parameters.jsCode).indexOf(n.layout + ':') !== -1, n.layout + ' is in LAYOUTS');
    vr(String(c2.nodes.find((x) => x.name === 'Build Transport Request').parameters.jsCode).indexOf("'" + n.sig + "#HTML'") !== -1,
      "'" + n.sig + "#HTML' is mapped");
  }
  vr(!!(t2.settings || {}).errorWorkflow === !!(transport.settings || {}).errorWorkflow, 'transport error binding unchanged');
  vr(!!(c2.settings || {}).errorWorkflow, 'concierge error monitor binding intact');
  say('');
  say(v ? '  HTML LAYOUTS = PASS' : '  HTML LAYOUTS = FAIL');
  say('');
  say('  rollback: .uat/' + TRANSPORT_ID + '.pre-html-layouts.json and .uat/' + CONCIERGE_ID + '.pre-html-layouts.json');
  say('');
  if (!v) { process.exitCode = 1; }
}
