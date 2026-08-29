#!/usr/bin/env node
// FINMENTOR — prove every button type end to end, and prove the malformed ones are refused.
//
//   node scripts/prove-button-types.mjs --confirm
//
// LIVE but ISOLATED. It sends nothing to Telegram: the harness stops at the transport VALIDATOR,
// which is the last node before a `Render *` Telegram node, and reports the exact `kb` the renderer
// would receive.
//
// The two patched Code nodes come from the dry-run candidates in .uat/, so what is proved here is
// exactly what would be deployed:
//
//   Concierge   Build Transport Request    reply keyboard -> layout id + keyboard_data
//   Transport   Validate Transport Payload keyboard_data  -> kb (the renderer's input)
//
// The renderers themselves are static Telegram nodes: `Render L1_W` reads
// `$json.kb[0][0].web_app.url`, so proving `kb` carries `web_app.url` and no `callback_data` proves
// the button Telegram receives.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const TRANSPORT_ID = 'ShcmmJeLSE8LYVBk';
const PATH = 'p15/button-types';

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }
if (!BASE || !READ_KEY || !WRITE_KEY) { console.error('N8N_BASE_URL, N8N_API_KEY, N8N_FIX_API_KEY required'); process.exit(1); }

const failures = [];
const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const bad = (m) => { say('  FAIL  ' + m); failures.push(m); };
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
async function hit(body) {
  for (let i = 0; i < 12; i++) {
    try {
      const r = await fetch(BASE + '/webhook/' + PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await r.text();
      if (r.status !== 404) { let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, body: j, raw: t }; }
    } catch (e) {}
    await sleep(1200);
  }
  return { status: 404, body: null, raw: '' };
}

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

say('');
say('BUTTON TYPES — callback, url, web_app, and the malformed ones');
say('='.repeat(78));
say('');

const conc = JSON.parse(readFileSync(join(OUT_DIR, CONCIERGE_ID + '.webapp-candidate.json'), 'utf8'));
const tr = JSON.parse(readFileSync(join(OUT_DIR, TRANSPORT_ID + '.webapp-candidate.json'), 'utf8'));
const buildTransport = conc.nodes.find((n) => n.name === 'Build Transport Request');
const validate = tr.nodes.find((n) => n.name === 'Validate Transport Payload');
if (!buildTransport || !validate) { bad('candidates are missing the nodes under test'); process.exit(1); }
ok('loaded both patched nodes from the dry-run candidates');

// The renderer contract, read from the candidate rather than assumed.
{
  const r = tr.nodes.find((n) => n.name === 'Render L1_W');
  const j = JSON.stringify(r.parameters);
  if (j.indexOf('web_app') === -1) { bad('Render L1_W does not reference web_app'); }
  else { ok('Render L1_W reads ' + (j.match(/\{\{[^}]*web_app[^}]*\}\}/) || ['?'])[0]); }
  if (j.indexOf('callback_data') !== -1) { bad('Render L1_W still carries callback_data'); }
  else { ok('Render L1_W carries no callback_data'); }
  const l1c = tr.nodes.find((n) => n.name === 'Render L1_C');
  if (r.type !== l1c.type || JSON.stringify(r.credentials) !== JSON.stringify(l1c.credentials)) {
    bad('Render L1_W does not use the same node type and credential as Render L1_C');
  } else { ok('Render L1_W uses the same node type and credential as the existing renderers'); }
}
say('');

// The harness: reply keyboard in, `kb` (or a refusal) out.
const wf = {
  name: '[TEMP] P15 button types', settings: SETTINGS,
  nodes: [
    { parameters: { httpMethod: 'POST', path: PATH, responseMode: 'responseNode', options: {} },
      id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: 'const b = $("Hook").first().json.body || {};\nreturn [{ json: { chat_id: "551000000", message_text: "/x", callback_data: "", is_callback: false, callback_query_id: "" } }];' },
      id: 'p', name: 'Parse Telegram Update', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, -160] },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
        jsCode: 'const b = $("Hook").first().json.body || {};\nreturn [{ json: { chat_id: "551000000", tg_body: { chat_id: "551000000", text: String(b.text || "hello"), reply_markup: { inline_keyboard: b.rows || [] } } } }];' },
      id: 'r', name: 'Build Bot Response', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, 0] },
    // PRESENT BUT UNCONNECTED. The deployed transport node resolves the response through
    // `$('Build Bot Response (Premium)').isExecuted`, and `.isExecuted` THROWS when the node does
    // not exist at all. Omitting it made every case refuse with INVALID_CHAT_ID — including the
    // malformed ones, which then "passed" for entirely the wrong reason.
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return [{ json: { unused: true } }];' },
      id: 'rp', name: 'Build Bot Response (Premium)', type: 'n8n-nodes-base.code', typeVersion: 2, position: [400, -260] },
    Object.assign(JSON.parse(JSON.stringify(buildTransport)), { position: [600, 0], onError: 'continueRegularOutput' }),
    Object.assign(JSON.parse(JSON.stringify(validate)), { position: [800, 0], onError: 'continueRegularOutput' }),
    { parameters: { respondWith: 'json',
        responseBody: '={{ JSON.stringify({ valid: $json.valid, error_code: $json.error_code, layout: $json.layout, kb: $json.kb, err: $json.error ? String($json.error).slice(0,80) : null }) }}',
        options: { responseCode: 200 } },
      id: 'x', name: 'Report', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [1000, 0] }
  ],
  connections: {
    Hook: { main: [[{ node: 'Parse Telegram Update', type: 'main', index: 0 }]] },
    'Parse Telegram Update': { main: [[{ node: 'Build Bot Response', type: 'main', index: 0 }]] },
    'Build Bot Response': { main: [[{ node: 'Build Transport Request', type: 'main', index: 0 }]] },
    'Build Transport Request': { main: [[{ node: 'Validate Transport Payload', type: 'main', index: 0 }]] },
    'Validate Transport Payload': { main: [[{ node: 'Report', type: 'main', index: 0 }]] }
  }
};

const MINIAPP = BASE + '/webhook/finmentor-premium-miniapp';

const CASES = [
  { name: 'A. callback button', rows: [[{ text: 'Описать задачу', callback_data: 'p|describe' }]],
    want: { valid: true, layout: 'L1_C', has: ['callback_data'], hasNot: ['url', 'web_app'] } },
  { name: 'A2. two callback rows (TG_ENTRY)',
    rows: [[{ text: 'Описать задачу', callback_data: 'p|describe' }], [{ text: 'Подготовить бриф', callback_data: 'p|brief' }]],
    want: { valid: true, layout: 'L2_C', has: ['callback_data'], hasNot: ['url', 'web_app'] } },
  { name: 'B. URL button (legacy L2_CU)',
    rows: [[{ text: 'Кнопка', callback_data: 'x|y' }], [{ text: 'Сайт', url: 'https://www.finmentor.md/' }]],
    want: { valid: true, layout: 'L2_CU' } },
  { name: 'C. web_app button (TG_OPEN_BRIEF)', rows: [[{ text: 'Открыть бриф', web_app: { url: MINIAPP } }]],
    want: { valid: true, layout: 'L1_W', has: ['web_app'], hasNot: ['callback_data', 'url'] } },
  { name: 'D. no text', rows: [[{ web_app: { url: MINIAPP } }]], want: { valid: false } },
  { name: 'E. callback_data + url', rows: [[{ text: 'x', callback_data: 'a|b', url: 'https://x.test/' }]], want: { valid: false } },
  { name: 'F. callback_data + web_app', rows: [[{ text: 'x', callback_data: 'a|b', web_app: { url: MINIAPP } }]], want: { valid: false } },
  { name: 'G. url + web_app', rows: [[{ text: 'x', url: 'https://x.test/', web_app: { url: MINIAPP } }]], want: { valid: false } },
  { name: 'H. empty web_app.url', rows: [[{ text: 'x', web_app: { url: '' } }]], want: { valid: false } },
  { name: 'L. web_app present, url missing', rows: [[{ text: 'x', web_app: {} }]], want: { valid: false } },
  { name: 'I. non-HTTPS web_app.url', rows: [[{ text: 'x', web_app: { url: 'http://insecure.test/app' } }]], want: { valid: false } },
  { name: 'J. empty callback_data', rows: [[{ text: 'x', callback_data: '' }]], want: { valid: false } },
  { name: 'K. unknown destination field', rows: [[{ text: 'x', callback_data: 'a|b', login_url: { url: 'https://evil.test/' } }]], want: { valid: false } }
];

let id = null;
try {
  id = (await api('POST', '/workflows', wf)).id;
  await api('POST', '/workflows/' + id + '/activate');
  for (const c of CASES) {
    const r = await hit({ rows: c.rows, text: 'проверка' });
    const b = r.body || {};
    const kbBtn = (b.kb && b.kb[0] && b.kb[0][0]) || null;
    const shown = b.valid ? (b.layout + '  ' + JSON.stringify(kbBtn)) : ('refused: ' + (b.error_code || b.err || '(no code)'));
    say('  ' + c.name.padEnd(34) + ' -> ' + String(shown).slice(0, 130));

    if (c.want.valid === true) {
      if (b.valid !== true) { bad(c.name + ': expected a valid payload, got ' + (b.error_code || b.err)); continue; }
      if (c.want.layout && b.layout !== c.want.layout) { bad(c.name + ': layout ' + b.layout + ', expected ' + c.want.layout); }
      for (const f of (c.want.has || [])) { if (!kbBtn || kbBtn[f] === undefined) { bad(c.name + ': the rendered button has no ' + f); } }
      for (const f of (c.want.hasNot || [])) { if (kbBtn && kbBtn[f] !== undefined) { bad(c.name + ': the rendered button carries ' + f + ' and must not'); } }
    } else {
      if (b.valid === true) { bad(c.name + ': a malformed button was ACCEPTED as ' + b.layout); }
    }
  }
  say('');

  // The web_app case, in full.
  {
    const r = await hit({ rows: [[{ text: 'Открыть бриф', web_app: { url: MINIAPP } }]], text: 'x' });
    const btn = r.body && r.body.kb && r.body.kb[0] && r.body.kb[0][0];
    if (!btn) { bad('the web_app case produced no button'); }
    else {
      if (btn.web_app && btn.web_app.url === MINIAPP) { ok('web_app.url survives end to end and points at the owner-only Mini App surface'); }
      else { bad('web_app.url is ' + JSON.stringify(btn.web_app)); }
      if (btn.callback_data === undefined) { ok('the web_app button carries NO callback_data'); }
      else { bad('the web_app button carries callback_data ' + JSON.stringify(btn.callback_data)); }
      if (btn.url === undefined) { ok('the web_app button was not downgraded to a plain URL button'); }
      else { bad('the web_app button became a URL button'); }
      if (String(btn.web_app.url).indexOf('https://') === 0) { ok('the Mini App URL is HTTPS'); }
      else { bad('the Mini App URL is not HTTPS'); }
    }
  }
} catch (e) {
  bad('harness failed: ' + String(e.message).slice(0, 200));
} finally {
  if (id) {
    try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) {}
    for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } }
    ok('harness deleted');
  }
}

say('');
say(failures.length ? '  BUTTON TYPES = FAIL' : '  BUTTON TYPES = PASS');
if (failures.length) { say(''); for (const f of failures) { say('    - ' + f); } process.exitCode = 1; }
say('');
