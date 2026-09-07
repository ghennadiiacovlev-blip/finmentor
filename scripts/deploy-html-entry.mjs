#!/usr/bin/env node
// FINMENTOR — render the Premium entry screen as Telegram HTML.
//
//   node scripts/deploy-html-entry.mjs --dry-run
//   node scripts/deploy-html-entry.mjs --confirm
//
// ── THE CONFLICT THIS RESOLVES, STATED PLAINLY ─────────────────────────────────────────────────
//
// The instruction was "change only the copy, do not touch the transport" AND "parse_mode = HTML".
// Those cannot both hold: measured on the live workflows, `Build Transport Request` hardcodes
// `parse_mode: ''`, `Validate Transport Payload` DROPS the field entirely, and not one of the
// fifteen `Render *` nodes passes a parse mode to Telegram. HTML cannot render today.
//
// Deploying the new copy without enabling HTML would send the owner literal `<b>` tags — worse
// than the flat copy it replaces. So the transport is extended, minimally, and this comment exists
// so the deviation is visible rather than buried.
//
// ── WHY A VARIANT LAYOUT AND NOT A parse_mode PASS-THROUGH ─────────────────────────────────────
//
// Threading `parse_mode` through the validator and into every renderer's additionalFields would
// touch all fifteen renderers — fifteen chances to change what a customer sees, to enable HTML for
// one screen. Instead the layout ID itself encodes the mode: `L2_C_HTML` is `L2_C` rendered as
// HTML. One new spec entry, one new route, one new renderer. Every existing renderer stays
// byte-identical, and the validator's return shape does not change at all.
//
// It also fails closed by construction: if a screen asks for HTML and no HTML variant exists for
// its keyboard shape, the signature does not resolve, the layout is unmapped, and the reply goes to
// the recovery branch instead of reaching Telegram with raw tags in it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');

const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const TRANSPORT_ID = 'ShcmmJeLSE8LYVBk';
const BASE_LAYOUT = 'L2_C';
const HTML_LAYOUT = 'L2_C_HTML';
const RENDER_NODE = 'Render ' + HTML_LAYOUT;

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
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });

if (!BASE || !READ_KEY || !WRITE_KEY) { die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY must be set'); }
if (!DRY && !CONFIRM) { die('this modifies two live workflows; re-run with --confirm (or --dry-run first)'); }
mkdirSync(OUT_DIR, { recursive: true });

say('');
say('Premium TG_ENTRY as Telegram HTML');
say('='.repeat(78));
say(DRY ? '  MODE: DRY RUN' : '  MODE: LIVE');
say('');

// ── 1. Concierge: the response node's new body, and an HTML-aware layout choice ────────────────

say('STEP 1 — Concierge');
const conc = await api('GET', '/workflows/' + CONCIERGE_ID);
writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.pre-html.json'), JSON.stringify(importable(conc), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + CONCIERGE_ID + '.pre-html.json');

const candidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json'), 'utf8'));
const newResponse = candidate.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
if (!newResponse) { die('the candidate has no premium response node'); }

const concPatched = JSON.parse(JSON.stringify(conc));
const respNode = concPatched.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
const btNode = concPatched.nodes.find((n) => n.name === 'Build Transport Request');
if (!respNode || !btNode) { die('the live Concierge is not in the expected shape'); }

// The Mini App URL is resolved live; take it from the deployed node so nothing is re-substituted.
{
  const deployedUrl = (respNode.parameters.jsCode.match(/const MINIAPP_URL = "([^"]+)"/) || [])[1];
  if (!deployedUrl) { die('could not read the deployed Mini App URL — refusing to overwrite the node blind'); }
  let body = newResponse.parameters.jsCode;
  if (body.indexOf('__PREMIUM_MINIAPP_URL__') === -1) { die('the candidate has no Mini App placeholder to substitute'); }
  body = body.split('__PREMIUM_MINIAPP_URL__').join(deployedUrl);
  if (/__[A-Z_]{4,}__/.test(body)) { die('a placeholder survived substitution in the premium response body'); }
  respNode.parameters.jsCode = body;
  ok('premium response node rebuilt from the candidate, Mini App URL preserved from what is live');
}

// The layout choice becomes mode-aware. HTML has no silent fallback: an HTML screen whose keyboard
// shape has no HTML variant must NOT be sent as plain text with tags showing.
{
  const OLD = "const layout = MAP[signature] || '';";
  if (btNode.parameters.jsCode.indexOf(OLD) === -1) { die('Build Transport Request: the layout lookup is not in the expected form'); }
  const NEW = [
    "// A screen may ask to be rendered as HTML. The MODE is part of the layout identity, because",
    "// the renderer is chosen by layout: L2_C_HTML is L2_C sent with parse_mode HTML.",
    "//",
    "// There is deliberately NO fallback from an HTML request to the plain layout. Falling back",
    "// would send the markup as literal text — `<b>FINMENTOR</b>` on screen — which is a worse",
    "// failure than not sending, and the unmapped path already routes to controlled recovery.",
    "const wantsHtml = String(body.parse_mode || '') === 'HTML';",
    "const layout = wantsHtml ? (MAP[signature + '#HTML'] || '') : (MAP[signature] || '');"
  ].join('\n');
  let code = btNode.parameters.jsCode.replace(OLD, NEW);

  const MAP_ANCHOR = "  'C|C': 'L2_C',";
  if (code.indexOf(MAP_ANCHOR) === -1) { die('Build Transport Request: the MAP is not in the expected form'); }
  code = code.replace(MAP_ANCHOR, MAP_ANCHOR + "\n  'C|C#HTML': '" + HTML_LAYOUT + "',");

  // parse_mode must be carried, not hardcoded empty.
  const PM_OLD = "  parse_mode: '',";
  if (code.indexOf(PM_OLD) === -1) { die('Build Transport Request: parse_mode is not in the expected form'); }
  code = code.replace(PM_OLD, "  parse_mode: wantsHtml ? 'HTML' : '',");

  btNode.parameters.jsCode = code;
  try { new Function(code.replace(/\$\(/g, '__ref(').replace(/\$json/g, '__json')); }
  catch (e) { die('the patched Build Transport Request does not parse: ' + e.message); }
  ok("MAP gains 'C|C#HTML' -> " + HTML_LAYOUT + '; an HTML request never falls back to the plain layout');
}

{
  const changed = concPatched.nodes.filter((n) => JSON.stringify(n) !== JSON.stringify(conc.nodes.find((x) => x.name === n.name))).map((n) => n.name).sort();
  if (changed.join(',') !== 'Build Bot Response (Premium),Build Transport Request') {
    die('the Concierge change touches: ' + changed.join(', '));
  }
  if (JSON.stringify(concPatched.connections) !== JSON.stringify(conc.connections)) { die('the Concierge graph changed'); }
  const legacy = concPatched.nodes.find((n) => n.name === 'Build Bot Response');
  if (JSON.stringify(legacy) !== JSON.stringify(conc.nodes.find((n) => n.name === 'Build Bot Response'))) { die('the LEGACY response builder changed'); }
  ok('exactly two Concierge nodes differ; the legacy builder and every edge are untouched');
}
say('');

// ── 2. transport: one spec entry, one route, one renderer ──────────────────────────────────────

say('STEP 2 — transport');
const tr = await api('GET', '/workflows/' + TRANSPORT_ID);
writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.pre-html.json'), JSON.stringify(importable(tr), null, 2) + '\n', 'utf8');
ok('rollback artifact: .uat/' + TRANSPORT_ID + '.pre-html.json');

const trPatched = JSON.parse(JSON.stringify(tr));
const validator = trPatched.nodes.find((n) => n.name === 'Validate Transport Payload');
const router = trPatched.nodes.find((n) => n.name === 'Route Keyboard Layout');
const base = trPatched.nodes.find((n) => n.name === 'Render ' + BASE_LAYOUT);
if (!validator || !router || !base) { die('the transport is not in the expected shape'); }
if (trPatched.nodes.find((n) => n.name === RENDER_NODE)) { die(RENDER_NODE + ' already exists'); }

{
  let code = validator.parameters.jsCode;
  const A = "L2_C: [['C'],['C']],";
  if (code.indexOf(A) === -1) { die('the LAYOUTS table is not in the expected form'); }
  // Same shape as L2_C; only the renderer differs.
  code = code.replace(A, A + ' ' + HTML_LAYOUT + ": [['C'],['C']],");
  validator.parameters.jsCode = code;
  try { new Function(code.replace(/\$input/g, '__input')); }
  catch (e) { die('the patched validator does not parse: ' + e.message); }
  ok('LAYOUTS gains ' + HTML_LAYOUT + " with the SAME [['C'],['C']] spec as " + BASE_LAYOUT);
}

{
  const render = JSON.parse(JSON.stringify(base));
  render.name = RENDER_NODE;
  render.id = 'render-l2-c-html';
  render.position = [(base.position[0] || 0), (base.position[1] || 0) - 220];
  // The ONLY difference from Render L2_C.
  render.parameters.additionalFields = Object.assign({}, base.parameters.additionalFields, { parse_mode: 'HTML' });
  const a = JSON.stringify(Object.assign({}, render.parameters, { additionalFields: null }));
  const b = JSON.stringify(Object.assign({}, base.parameters, { additionalFields: null }));
  if (a !== b) { die(RENDER_NODE + ' differs from ' + BASE_LAYOUT + ' beyond additionalFields'); }
  trPatched.nodes.push(render);
  ok(RENDER_NODE + ' added — identical to Render ' + BASE_LAYOUT + ' apart from parse_mode: HTML');
}

{
  const rules = router.parameters.rules.values;
  const template = JSON.parse(JSON.stringify(rules.find((r) => r.outputKey === BASE_LAYOUT)));
  template.outputKey = HTML_LAYOUT;
  template.conditions.conditions[0].rightValue = HTML_LAYOUT;
  if (template.conditions.conditions[0].id) { template.conditions.conditions[0].id = 'route-l2-c-html'; }
  const main = trPatched.connections['Route Keyboard Layout'].main;
  const fallbackIdx = main.length - 1;
  const fallbackBefore = JSON.stringify(main[fallbackIdx]);
  if (!/Return Transport Error/.test(fallbackBefore)) { die('the last router output is not the error fallback'); }
  rules.push(template);
  main.splice(fallbackIdx, 0, [{ node: RENDER_NODE, type: 'main', index: 0 }]);
  if (main.length !== rules.length + 1) { die('router outputs and rules disagree'); }
  if (JSON.stringify(main[main.length - 1]) !== fallbackBefore) { die('the error fallback moved'); }
  trPatched.connections[RENDER_NODE] = { main: [[{ node: 'Normalize Telegram Result', type: 'main', index: 0 }]] };
  ok('route added before the UNROUTED fallback, wired to Normalize Telegram Result');
}

{
  if (trPatched.nodes.length !== tr.nodes.length + 1) { die('transport node count moved by ' + (trPatched.nodes.length - tr.nodes.length)); }
  const drift = trPatched.nodes.filter((n) => {
    if (n.name === RENDER_NODE) { return false; }
    const was = tr.nodes.find((x) => x.name === n.name);
    return !was || JSON.stringify(n) !== JSON.stringify(was);
  }).map((n) => n.name).sort();
  if (drift.join(',') !== 'Route Keyboard Layout,Validate Transport Payload') {
    die('transport nodes changed beyond the two intended: ' + drift.join(', '));
  }
  for (const n of tr.nodes) {
    if (!/^Render /.test(n.name)) { continue; }
    if (JSON.stringify(trPatched.nodes.find((x) => x.name === n.name)) !== JSON.stringify(n)) { die('a legacy renderer changed: ' + n.name); }
  }
  ok('all ' + tr.nodes.filter((n) => /^Render /.test(n.name)).length + ' existing renderers byte-identical');
  const wasMain = tr.connections['Route Keyboard Layout'].main;
  const nowMain = trPatched.connections['Route Keyboard Layout'].main;
  for (let i = 0; i < wasMain.length - 1; i++) {
    if (JSON.stringify(wasMain[i]) !== JSON.stringify(nowMain[i])) { die('route ' + i + ' changed'); }
  }
  ok('every pre-existing route unchanged');
}
say('');

if (DRY) {
  writeFileSync(join(OUT_DIR, CONCIERGE_ID + '.html-candidate.json'), JSON.stringify(importable(concPatched), null, 2) + '\n', 'utf8');
  writeFileSync(join(OUT_DIR, TRANSPORT_ID + '.html-candidate.json'), JSON.stringify(importable(trPatched), null, 2) + '\n', 'utf8');
  say('DRY RUN — nothing written to n8n. Candidates saved to .uat/.');
  say('');
} else {
  say('STEP 3 — writing');
  await api('PUT', '/workflows/' + TRANSPORT_ID, importable(trPatched), 3);
  ok('transport updated first — it must understand ' + HTML_LAYOUT + ' before the Concierge can emit it');
  await api('PUT', '/workflows/' + CONCIERGE_ID, importable(concPatched), 3);
  ok('Concierge updated');
  say('');
  say('STEP 4 — fresh read and verify');
  let good = true;
  const t2 = await api('GET', '/workflows/' + TRANSPORT_ID);
  const c2 = await api('GET', '/workflows/' + CONCIERGE_ID);
  if (!t2.active || !c2.active) { bad('a workflow is not active'); good = false; } else { ok('both active'); }
  if (t2.name !== tr.name || c2.name !== conc.name) { bad('a workflow was renamed'); good = false; } else { ok('names unchanged'); }
  const r2 = t2.nodes.find((n) => n.name === RENDER_NODE);
  if (!r2) { bad(RENDER_NODE + ' missing'); good = false; }
  else if (r2.parameters.additionalFields.parse_mode !== 'HTML') { bad(RENDER_NODE + ' does not set parse_mode HTML'); good = false; }
  else { ok(RENDER_NODE + ' present and sets parse_mode: HTML'); }
  const bt2 = c2.nodes.find((n) => n.name === 'Build Transport Request');
  if (bt2.parameters.jsCode.indexOf("'C|C#HTML'") === -1) { bad('the Concierge cannot select ' + HTML_LAYOUT); good = false; }
  else { ok('Concierge selects ' + HTML_LAYOUT + ' when a screen asks for HTML'); }
  const resp2 = c2.nodes.find((n) => n.name === 'Build Bot Response (Premium)');
  if (resp2.parameters.jsCode.indexOf('<b>FINMENTOR</b>') === -1) { bad('the new entry copy is not deployed'); good = false; }
  else { ok('the new entry copy is live in the premium response node'); }
  for (const [label, now, before] of [['Concierge', c2, conc], ['transport', t2, tr]]) {
    if (String((now.settings || {}).errorWorkflow || '') !== String((before.settings || {}).errorWorkflow || '')) {
      bad(label + ': errorWorkflow binding changed'); good = false;
    }
  }
  ok('error monitor bindings unchanged');
  say('');
  say(good ? '  HTML ENTRY = PASS' : '  HTML ENTRY = FAIL');
  say('');
  say('  rollback: PUT /api/v1/workflows/' + TRANSPORT_ID + '  with .uat/' + TRANSPORT_ID + '.pre-html.json');
  say('            PUT /api/v1/workflows/' + CONCIERGE_ID + '  with .uat/' + CONCIERGE_ID + '.pre-html.json');
  say('');
  if (!good) { process.exitCode = 1; }
}
