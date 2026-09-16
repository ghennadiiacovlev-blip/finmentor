#!/usr/bin/env node
// FINMENTOR V1 — P0 new-request context mapping, guarded one-node deployment.
//
//   node scripts/deploy-p0-new-request-context.mjs --dry-run
//   node scripts/deploy-p0-new-request-context.mjs --confirm

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_ID = 'mppzthlkSJFr6Kle';
const RESPONSE_NODE = 'Build Bot Response';
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const WRITE_KEY = String(process.env.N8N_FIX_API_KEY || '');
const DRY = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');
const REAL_RO = 'Cash Flow / \u00ABprofit este, dar lipsesc bani\u00BB';

const json = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(json(value));
const fail = (message) => { throw new Error(message); };
const pass = (message) => console.log('  PASS  ' + message);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : json(value)).digest('hex');
const importable = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings || {}
});

function inlineContextSource() {
  return readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js'), 'utf8')
    .replace(/^'use strict';\s*$/m, '')
    .replace(/^const B = require\('\.\/branches\.js'\);\s*$/m, '')
    .replace(/^function shownSections\(normalised, turnoverBand\) \{[\s\S]*?\n\}\s*$/m, '')
    .replace(/^function promoteShown\(draft, sections, nowIso\) \{[\s\S]*?\n\}\s*$/m, '')
    .replace(/^module\.exports = \{[\s\S]*?\};\s*$/m, '')
    .trim();
}

function replaceOnce(value, oldText, newText, label) {
  if (value.split(oldText).length !== 2) fail(label + ': anchor not found exactly once');
  return value.replace(oldText, newText);
}

function patchResponseCode(source) {
  let code = String(source || '');
  if (code.includes('Request free text has no identity authority.')) fail('response node is already patched');

  const phraseAt = code.indexOf('structured context extraction from free text.');
  const start = code.lastIndexOf('//', phraseAt);
  const end = code.indexOf('// ---------------------------------------------------------------- rendering', phraseAt);
  if (phraseAt < 0 || start < 0 || end <= start) fail('context-extraction inline boundaries are not recognisable');
  code = code.slice(0, start) + inlineContextSource() + '\n\n' + code.slice(end);

  const oldIdentityProjection = [
    '  auth.context_extracted = {',
    '    company_name: proposal.fields.company_name || "",',
    '    business_activity: proposal.fields.business_activity || "",',
    '    role: proposal.fields.role || "",'
  ].join('\n');
  const newRequestProjection = [
    '  auth.context_extracted = {',
    '    // Request free text has no identity authority. Company/name/role/contact can enter only',
    '    // through a separately approved carried identity source, never through this proposal.',
    '    business_activity: proposal.fields.business_activity || "",'
  ].join('\n');
  code = replaceOnce(code, oldIdentityProjection, newRequestProjection, 'free-text identity projection');
  code = replaceOnce(
    code,
    'const structuralKeys = ["company_name", "role", "turnover_band", "objective"];',
    'const structuralKeys = ["business_activity", "turnover_band", "objective"];',
    'confirmation structural keys'
  );

  const lines = code.split('\n');
  const commentAt = lines.findIndex((line) => line.includes('The confirmation screen has to EARN its place.'));
  if (commentAt >= 0 && lines[commentAt + 1] && lines[commentAt + 1].includes('is worth asking')) {
    lines.splice(commentAt, 2,
      '// The confirmation screen has to EARN its place. It is worth asking only when extraction found',
      '// request structure — an objective, activity or explicitly stated turnover band.');
    code = lines.join('\n');
  }
  return code;
}

function nodeMap(workflow) { return new Map(workflow.nodes.map((node) => [node.name, node])); }

function assertOneNodeDelta(before, after) {
  if (before.nodes.length !== after.nodes.length) fail('node count changed');
  if (json(before.connections || {}) !== json(after.connections || {})) fail('connections changed');
  if (json(before.settings || {}) !== json(after.settings || {})) fail('settings changed');
  const oldNodes = nodeMap(before);
  const changed = after.nodes.filter((node) => json(oldNodes.get(node.name)) !== json(node)).map((node) => node.name);
  if (json(changed) !== json([RESPONSE_NODE])) fail('changed nodes: ' + changed.join(', '));

  const oldNode = clone(oldNodes.get(RESPONSE_NODE));
  const newNode = clone(nodeMap(after).get(RESPONSE_NODE));
  oldNode.parameters.jsCode = '';
  newNode.parameters.jsCode = '';
  if (json(oldNode) !== json(newNode)) fail(RESPONSE_NODE + ': fields beyond parameters.jsCode changed');
}

function assertRealRo(code) {
  const runner = new Function('$input', code);
  const result = runner({ first: () => ({ json: {
    session: { chat_id: '777000', cycle_id: 'C-777000-1', state: 'TG_FREEFORM_PROBLEM', language: 'ro' },
    message_text: REAL_RO
  } }) })[0].json;
  if (result.debug.state_after !== 'TG_CONFIRM_CONTEXT') fail('REAL RO did not reach TG_CONFIRM_CONTEXT');
  const context = JSON.parse(result.session.context_extracted_json || '{}');
  if (context.company_name !== undefined) fail('REAL RO populated company_name: ' + context.company_name);
  if (context.role !== undefined) fail('REAL RO populated role: ' + context.role);
  if (context.objective !== 'Денежный поток') fail('REAL RO objective: ' + context.objective);
  if (context.problem_summary !== REAL_RO) fail('REAL RO problem text changed');
  if (result.reply_text.includes('Compania\n')) fail('REAL RO rendered an unknown company block');
  if (!result.reply_text.includes('Obiectiv\n<b>Flux de numerar</b>')) fail('REAL RO objective presentation missing');
  if (!result.reply_text.includes('Situația principală\n<b>' + REAL_RO + '</b>')) fail('REAL RO problem presentation missing');
}

async function api(method, path, body, key) {
  const response = await fetch(BASE + '/api/v1' + path, {
    method,
    headers: Object.assign({ 'X-N8N-API-KEY': key }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? json(body) : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) fail(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (DRY === CONFIRM) fail('choose exactly one of --dry-run or --confirm');
  if (!BASE || !READ_KEY || (CONFIRM && !WRITE_KEY)) fail('missing n8n API environment');

  console.log('\nP0 NEW-REQUEST CONTEXT — ' + (DRY ? 'DRY RUN' : 'CONTROLLED CUTOVER'));
  const fresh = await api('GET', '/workflows/' + WORKFLOW_ID, null, READ_KEY);
  if (!fresh.active) fail('Concierge workflow is inactive');
  const candidate = clone(fresh);
  const response = nodeMap(candidate).get(RESPONSE_NODE);
  if (!response || !response.parameters || typeof response.parameters.jsCode !== 'string') fail(RESPONSE_NODE + ' missing');
  response.parameters.jsCode = patchResponseCode(response.parameters.jsCode);

  assertOneNodeDelta(fresh, candidate);
  assertRealRo(response.parameters.jsCode);
  pass('exact Romanian request: objective/problem preserved, company and role absent');
  pass('delta is exactly Build Bot Response.parameters.jsCode; graph/settings/credentials unchanged');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ROOT, '.uat', 'p0-new-request-context', (DRY ? 'dry-' : 'deploy-') + stamp);
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(join(artifactDir, WORKFLOW_ID + '.pre.json'), JSON.stringify(fresh, null, 2) + '\n', 'utf8');
  writeFileSync(join(artifactDir, WORKFLOW_ID + '.candidate.json'), JSON.stringify(candidate, null, 2) + '\n', 'utf8');
  pass('rollback and candidate artifacts saved: ' + artifactDir);
  console.log('  PRE SHA  ' + sha(importable(fresh)));
  console.log('  NEW SHA  ' + sha(importable(candidate)));
  if (DRY) return;

  const beforeWrite = await api('GET', '/workflows/' + WORKFLOW_ID, null, READ_KEY);
  if (json(importable(beforeWrite)) !== json(importable(fresh))) fail('production drifted after candidate preparation');

  let written = false;
  try {
    await api('PUT', '/workflows/' + WORKFLOW_ID, importable(candidate), WRITE_KEY);
    written = true;
    const after = await api('GET', '/workflows/' + WORKFLOW_ID, null, READ_KEY);
    if (json(importable(after)) !== json(importable(candidate))) fail('immediate read-back mismatch');
    if (after.active !== fresh.active) fail('workflow active state changed');
    assertOneNodeDelta(fresh, after);
    assertRealRo(nodeMap(after).get(RESPONSE_NODE).parameters.jsCode);
    writeFileSync(join(artifactDir, WORKFLOW_ID + '.post.json'), JSON.stringify(after, null, 2) + '\n', 'utf8');
    pass('deployed, read back byte-exactly, and REAL RO replay passed');
  } catch (error) {
    if (written) {
      await api('PUT', '/workflows/' + WORKFLOW_ID, importable(fresh), WRITE_KEY);
      const restored = await api('GET', '/workflows/' + WORKFLOW_ID, null, READ_KEY);
      if (json(importable(restored)) !== json(importable(fresh))) fail('cutover failed and rollback read-back mismatched: ' + error.message);
      writeFileSync(join(artifactDir, WORKFLOW_ID + '.rollback.json'), JSON.stringify(restored, null, 2) + '\n', 'utf8');
    }
    fail('cutover failed' + (written ? '; rollback verified' : '') + ': ' + error.message);
  }
}

main().catch((error) => {
  console.error('\nSTOPPED: ' + error.message);
  process.exit(1);
});
