#!/usr/bin/env node
// FINMENTOR — the smallest possible live proof that Telegram renders the approved button styles.
//
//   node scripts/smoke-telegram-button-styles.mjs --dry-run   build and print the exact payload, send nothing
//   node scripts/smoke-telegram-button-styles.mjs --confirm    send ONE message to the owner chat, then clean up
//
// WHAT IT PROVES. Bot API `InlineKeyboardButton.style` is one of 'primary' | 'success' | 'danger';
// omitted means the client's own style. n8n's Telegram node copies `additionalFields` onto each
// button verbatim, so the key reaches Telegram through the node we already use. This sends one
// message carrying all three states at once, with the approved production labels, so the owner can
// confirm the colours before any workflow is restyled.
//
// WHY IT IS SAFE.
//   * NO production workflow is touched. A disposable workflow is created, called once, deleted.
//   * NO callback_data anywhere. Every button is a URL button pointing at the public site, so a tap
//     opens finmentor.md and can never reach the Command Center or mutate a lead.
//   * NO lead, no analysis, no CRM row, no Pipeline write, no customer message.
//   * The owner chat is read from the Settings sheet, exactly as production does — never hard-coded.
//   * The existing Telegram credential is reused by id; no credential is created or replaced.
//
// SECRETS. N8N_API_KEY (read) / N8N_FIX_API_KEY (write, falls back). Never printed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const lf = (s) => s.replace(/\r\n/g, '\n');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CONFIRM = args.includes('--confirm');
const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;

const say = (m) => console.log(m);
const ok = (m) => say('  PASS  ' + m);
const die = (m) => { console.error('\nSTOPPED: ' + m); process.exitCode = 1; throw new Error('stopped'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The same credentials production already holds, referenced by id. Nothing new is created.
const SHEETS_CRED = { googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } };
const TELEGRAM_CRED = { telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } };
const DOC_ID = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A';
const SETTINGS_GID = 1871239368;
const SAFE_URL = 'https://www.finmentor.md/';

// The approved matrix, taken from the module rather than retyped, so the smoke test cannot drift
// from the policy it is proving.
const ACTIONS_SRC = lf(readFileSync(join(ROOT, 'n8n', 'src', 'lead-alerts', 'actions.js'), 'utf8')).replace('// __CRM_STAGE_RESOLVER__', '');
const LAA = new Function(ACTIONS_SRC + '\n; return LAA;')();
const PRIORITY_ROWS = LAA.keyboard('priority', { deal_stage: 'Qualified', sla_status: 'Active' }, 'SMOKE');

export function keyboardParam(rows) {
  return {
    rows: rows.map((row) => ({
      row: {
        buttons: row.map((b) => ({
          text: b.text,
          // URL button: no callback_data, so a tap cannot act on a lead. `style` only where the policy sets it.
          additionalFields: b.style ? { url: SAFE_URL, style: b.style } : { url: SAFE_URL }
        }))
      }
    }))
  };
}

const TEXT = [
  '🎨 <b>FINMENTOR · Проверка оформления кнопок</b>',
  '',
  'Тестовое сообщение. Кнопки ниже <b>ничего не меняют</b> — каждая просто открывает finmentor.md.',
  'Ни один лид, анализ или запись CRM не затронуты.',
  '',
  '<b>Что проверить</b>',
  '① «✅ Обработано» — зелёная (success)',
  '② «📞 Discovery» — синяя (primary)',
  '③ «⏰ На 24 часа», «📄 Документы», «🗂 В наблюдение» — обычные, без цвета',
  '',
  'Если все три состояния видны — оформление можно выкатывать на боевые оповещения.'
].join('\n');

function smokeNodes(path) {
  return [
    { parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: {} },
      id: 'n-wh', name: 'WH', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
    { parameters: { resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: DOC_ID, mode: 'list' },
        sheetName: { __rl: true, value: SETTINGS_GID, mode: 'list', cachedResultName: 'Settings' }, options: {} },
      id: 'n-set', name: 'Read Settings', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, position: [220, 0],
      credentials: SHEETS_CRED },
    { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: [
        '// The owner destination comes from the Settings sheet, exactly as production reads it.',
        'const rows = $input.all().map(i => i.json);',
        'const s = {};',
        "for (const r of rows) { const k = String(r.key || '').trim(); if (k) s[k] = String(r.value || '').trim(); }",
        "if (!/^[0-9]+$/.test(s.owner_chat_id || '')) { throw new Error('owner_chat_id missing from Settings'); }",
        'return [{ json: { owner_chat_id: s.owner_chat_id } }];'
      ].join('\n') },
      id: 'n-cfg', name: 'Settings to Object', type: 'n8n-nodes-base.code', typeVersion: 2, position: [440, 0] },
    { parameters: { resource: 'message', operation: 'sendMessage',
        chatId: '={{ $json.owner_chat_id }}',
        text: TEXT,
        replyMarkup: 'inlineKeyboard',
        inlineKeyboard: keyboardParam(PRIORITY_ROWS),
        additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true } },
      id: 'n-tg', name: 'Send Smoke Message', type: 'n8n-nodes-base.telegram', typeVersion: 1.2, position: [660, 0],
      credentials: TELEGRAM_CRED }
  ];
}
const CONNECTIONS = {
  WH: { main: [[{ node: 'Read Settings', type: 'main', index: 0 }]] },
  'Read Settings': { main: [[{ node: 'Settings to Object', type: 'main', index: 0 }]] },
  'Settings to Object': { main: [[{ node: 'Send Smoke Message', type: 'main', index: 0 }]] }
};

// Refuses anything that could act on a lead.
export function verifySmoke(nodes) {
  const f = [];
  const tg = nodes.find((n) => n.type === 'n8n-nodes-base.telegram');
  if (!tg) { f.push('no Telegram node'); return f; }
  const rows = tg.parameters.inlineKeyboard.rows;
  const flat = rows.flatMap((r) => r.row.buttons);
  for (const b of flat) {
    const af = b.additionalFields || {};
    if (af.callback_data !== undefined) { f.push('a button carries callback_data: ' + b.text); }
    if (af.url !== SAFE_URL) { f.push('a button points somewhere other than the public site: ' + b.text); }
    if ('style' in af && ['primary', 'success', 'danger'].indexOf(af.style) === -1) { f.push('unsupported style on ' + b.text); }
    if (af.style === '') { f.push('empty style on ' + b.text + ' would be a 400'); }
  }
  const styled = flat.filter((b) => (b.additionalFields || {}).style);
  if (styled.length !== 2) { f.push('expected exactly two emphasised buttons, got ' + styled.length); }
  if (!flat.some((b) => (b.additionalFields || {}).style === 'success')) { f.push('no success button'); }
  if (!flat.some((b) => (b.additionalFields || {}).style === 'primary')) { f.push('no primary button'); }
  if (flat.some((b) => (b.additionalFields || {}).style === 'danger')) { f.push('a danger button exists'); }
  if (nodes.some((n) => n.type === 'n8n-nodes-base.googleSheets' && n.parameters.operation !== 'read')) { f.push('a Sheets node would write'); }
  return f;
}

async function api(m, p, b) {
  const res = await fetch(BASE + '/api/v1' + p, { method: m,
    headers: Object.assign({ 'X-N8N-API-KEY': m === 'GET' ? READ_KEY : WRITE_KEY }, b ? { 'Content-Type': 'application/json' } : {}),
    body: b ? JSON.stringify(b) : undefined });
  const t = await res.text();
  if (!res.ok) { throw new Error(m + ' ' + p + ' -> ' + res.status + ' ' + t.slice(0, 250)); }
  return t ? JSON.parse(t) : null;
}

const isMain = process.argv[1] && process.argv[1].endsWith('smoke-telegram-button-styles.mjs');
if (isMain) {
  try {
    if (!DRY && !CONFIRM) { die('this sends a real Telegram message; re-run with --confirm (or --dry-run first)'); }
    say(''); say('TELEGRAM BUTTON STYLE — live smoke test (one owner-only message)'); say('='.repeat(78));
    say(DRY ? '  MODE: DRY RUN — nothing is created and nothing is sent' : '  MODE: LIVE');
    say('');
    const path = 'zz-style-smoke-' + crypto.randomBytes(4).toString('hex');
    const nodes = smokeNodes(path);
    const f = verifySmoke(nodes);
    if (f.length) { die(f.join(' | ')); }
    ok('keyboard verified: URL buttons only, no callback_data, exactly two emphasised, no danger');
    say('');
    say('  the message:');
    say(TEXT.split('\n').map((l) => '    ' + l).join('\n'));
    say('');
    say('  the keyboard Telegram will receive:');
    for (const r of nodes.find((n) => n.type === 'n8n-nodes-base.telegram').parameters.inlineKeyboard.rows) {
      say('    ' + r.row.buttons.map((b) => b.text + '  [style=' + ((b.additionalFields || {}).style || 'omitted') + ']').join('   |   '));
    }
    say('');
    if (DRY) { say('DRY RUN — no workflow created, no message sent.'); }
    else {
      if (!BASE || !READ_KEY) { die('N8N_BASE_URL and N8N_API_KEY must be set'); }
      const wf = await api('POST', '/workflows', { name: 'ZZ STYLE SMOKE (disposable)', nodes, connections: CONNECTIONS, settings: { executionOrder: 'v1' } });
      let sent = false;
      try {
        await api('POST', '/workflows/' + wf.id + '/activate');
        await sleep(2500);
        let last = null;
        for (let i = 0; i < 4 && !sent; i++) {
          const r = await fetch(BASE + '/webhook/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const t = await r.text();
          if (r.ok) { sent = true; ok('one message sent to the owner chat'); }
          else { last = r.status + ' ' + t.slice(0, 200); await sleep(2000); }
        }
        if (!sent) { say('  FAIL  the disposable workflow did not answer: ' + last); }
      } finally {
        for (let i = 0; i < 4; i++) {
          await api('POST', '/workflows/' + wf.id + '/deactivate').catch(() => {});
          const gone = await api('DELETE', '/workflows/' + wf.id).then(() => true).catch(() => false);
          if (gone) { ok('disposable workflow deleted'); break; }
          await sleep(1500);
        }
      }
      say('');
      say('  Now look at the message in Telegram and confirm the three states.');
      say('  Nothing else changed: no production workflow was touched.');
    }
  } catch (e) { if (e.message !== 'stopped') { console.error('\nSTOPPED: ' + e.message); process.exitCode = 1; } }
}
