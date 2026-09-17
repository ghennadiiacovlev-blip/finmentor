#!/usr/bin/env node
// FINMENTOR — delete the owner's internal UAT/test Telegram messages, and nothing else.
//
//   node scripts/cleanup-uat-telegram.mjs --dry-run
//   node scripts/cleanup-uat-telegram.mjs --confirm
//
// THE ONLY AUTHORITY IS THE MANIFEST. The script deletes exactly the message ids recorded in
// .uat/final-telegram-cleanup/manifest.json under `test_messages_with_recoverable_id` with
// `deletable_by_bot: true`. It never enumerates a chat, never ranges over ids, and never infers an
// id from a neighbouring one: a guessed id is someone else's message. Every entry it acts on must
// carry its own provenance (request_id or analysis_id) and a chat that resolves in the manifest.
//
// THE BOT TOKEN NEVER APPEARS. Telegram is reached through a disposable n8n workflow that names the
// stored Telegram credential BY ID. The token stays in n8n credentials, exactly as it does for every
// production sender; it never reaches a file, a URL, an argument or this repository.
//
// A MESSAGE IS NOT A RECORD. Deleting a chat message removes no Leads row, no Pipeline row, no
// receipt, no XRay_Analysis row, no Activity entry and no consent record. This script touches
// Telegram only, and it writes a result file so the deletion itself stays auditable.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIR = join(ROOT, '.uat', 'final-telegram-cleanup');
const MANIFEST = join(DIR, 'manifest.json');

// The stored Telegram credential used by every production owner sender. Referenced by id only.
const TELEGRAM_CREDENTIAL = { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' };
const DISPOSABLE_NAME = '[TEMP] FINMENTOR UAT telegram cleanup (DISPOSABLE)';

const j = (value) => JSON.stringify(value);
const say = (message) => console.log(message);
const pass = (message) => say('  PASS  ' + message);
const die = (message) => { console.error('\nSTOPPED: ' + message); process.exit(1); };

// Reads the manifest and returns only the entries this script is allowed to act on. Exported so
// the selection rule is testable without production access.
export function selectDeletable(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest is not an object');
  const chats = manifest.chats && typeof manifest.chats === 'object' ? manifest.chats : {};
  const rows = Array.isArray(manifest.test_messages_with_recoverable_id)
    ? manifest.test_messages_with_recoverable_id : [];
  const selected = [];
  for (const row of rows) {
    if (row.deletable_by_bot !== true) continue;
    const chat = chats[row.chat];
    if (!chat || !Number.isInteger(chat.chat_id)) throw new Error('unresolved chat for message ' + j(row.message_id));
    if (!Number.isInteger(row.message_id) || row.message_id <= 0) throw new Error('a deletable entry has no integer message_id');
    // Provenance is the classification. An entry without it is not proven to be a test message.
    if (!String(row.request_id || '').trim() && !String(row.analysis_id || '').trim()) {
      throw new Error('message ' + row.message_id + ' carries no request_id/analysis_id provenance');
    }
    if (!String(row.reason || '').startsWith('TEST')) throw new Error('message ' + row.message_id + ' is not classified TEST');
    selected.push({
      chat_id: chat.chat_id, message_id: row.message_id, timestamp: row.timestamp || '',
      request_id: row.request_id || '', analysis_id: row.analysis_id || '', reason: row.reason
    });
  }
  const ids = selected.map((row) => row.message_id);
  if (new Set(ids).size !== ids.length) throw new Error('the manifest lists a message id twice');
  return selected;
}

// The disposable workflow: one webhook, one Telegram delete, one response. It exists only for the
// duration of this run and is removed in a finally block.
export function disposableWorkflow(path) {
  return {
    name: DISPOSABLE_NAME,
    settings: { executionOrder: 'v1' },
    nodes: [
      {
        id: 'cleanup-webhook', name: 'Cleanup Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2,
        position: [0, 0],
        parameters: { httpMethod: 'POST', path, responseMode: 'lastNode', options: { responseData: 'allEntries' } }
      },
      {
        id: 'cleanup-delete', name: 'Delete Message', type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
        position: [220, 0], onError: 'continueRegularOutput',
        parameters: {
          resource: 'message', operation: 'deleteMessage',
          chatId: '={{ $json.body.chat_id }}', messageId: '={{ $json.body.message_id }}'
        },
        credentials: { telegramApi: TELEGRAM_CREDENTIAL }
      }
    ],
    connections: { 'Cleanup Webhook': { main: [[{ node: 'Delete Message', type: 'main', index: 0 }]] } }
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith('cleanup-uat-telegram.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const readKey = process.env.N8N_API_KEY;
  const writeKey = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
  if (!dryRun && !confirm) die('use --dry-run or --confirm');
  if (!base || !readKey || !writeKey) die('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY are required');

  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let selected;
  try { selected = selectDeletable(manifest); } catch (error) { die(error.message); }

  say('\nFINMENTOR — OWNER TELEGRAM UAT CLEANUP ' + (dryRun ? '(DRY RUN)' : '(LIVE)'));
  say('='.repeat(78));
  for (const row of selected) {
    pass('DELETE message ' + row.message_id + ' · ' + row.timestamp + ' · ' + (row.request_id || row.analysis_id));
  }
  const manual = (manifest.test_messages_without_recoverable_id || []).length
    + (manifest.test_messages_with_recoverable_id || []).filter((row) => row.deletable_by_bot !== true).length;
  say('');
  pass('bot-deletable test messages: ' + selected.length);
  pass('manual owner deletion required: ' + manual);
  pass('real-lead messages targeted: 0; audit/CRM records targeted: 0');

  if (dryRun) { say('\nDRY RUN — no Telegram message was deleted.'); process.exit(0); }

  const api = async (method, path, body) => {
    const response = await fetch(base + '/api/v1' + path, {
      method,
      headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? readKey : writeKey }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? j(body) : undefined
    });
    const text = await response.text();
    if (!response.ok) throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
    return text ? JSON.parse(text) : null;
  };

  const path = 'finmentor-uat-telegram-cleanup-' + Date.now().toString(36);
  let workflowId = '';
  const results = [];
  try {
    const created = await api('POST', '/workflows', disposableWorkflow(path));
    workflowId = created.id;
    await api('POST', '/workflows/' + workflowId + '/activate', {});
    for (const row of selected) {
      const response = await fetch(base + '/webhook/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: j({ chat_id: row.chat_id, message_id: row.message_id })
      });
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch (error) { payload = { raw: text.slice(0, 240) }; }
      const entry = Array.isArray(payload) ? payload[0] : payload;
      const deleted = entry && (entry.result === true || entry.ok === true);
      results.push({
        message_id: row.message_id, request_id: row.request_id, analysis_id: row.analysis_id,
        deleted: Boolean(deleted), detail: deleted ? '' : String((entry && (entry.error || entry.description)) || text).slice(0, 200)
      });
      say((deleted ? '  DELETED  ' : '  FAILED   ') + row.message_id + (deleted ? '' : ' — ' + results[results.length - 1].detail));
    }
  } catch (error) {
    die(error.message);
  } finally {
    if (workflowId) {
      try { await api('POST', '/workflows/' + workflowId + '/deactivate', {}); } catch (error) { /* deletion below is what matters */ }
      try { await api('DELETE', '/workflows/' + workflowId); say('  PASS  disposable workflow removed'); }
      catch (error) { console.error('  WARNING  disposable workflow ' + workflowId + ' must be removed by hand: ' + error.message); }
    }
  }

  mkdirSync(DIR, { recursive: true });
  const deleted = results.filter((row) => row.deleted);
  writeFileSync(join(DIR, 'deletion-result.json'), JSON.stringify({
    executed_at: new Date().toISOString(),
    test_messages_deleted: deleted.length,
    undeletable_test_messages: (results.length - deleted.length) + manual,
    real_lead_messages_deleted: 0,
    audit_records_deleted: 0,
    results
  }, null, 2) + '\n', 'utf8');
  say('\nTEST MESSAGES DELETED = ' + deleted.length);
  say('UNDELETABLE TEST MESSAGES = ' + ((results.length - deleted.length) + manual));
  say('REAL LEAD MESSAGES DELETED = 0');
  say('AUDIT DATA DELETED = 0');
}
