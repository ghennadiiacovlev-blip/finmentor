#!/usr/bin/env node
// FINMENTOR V1 client hardening — bounded Concierge cutover.
//
//   node scripts/deploy-v1-client-hardening-concierge.mjs --dry-run
//   node scripts/deploy-v1-client-hardening-concierge.mjs --confirm
//
// Exactly five existing Code-node bodies may change:
//   - both session resolvers receive the one-time explicit language selector;
//   - both response builders receive the tracked bilingual customer renderer;
//   - the cycle projection carries the persisted locale into the Mini App seed.
// Nodes, edges, settings, credentials, webhook identity and workflow activation are preserved.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keepRollback } from './lib/rollback-artifact.mjs';
import {
  CONTEXT_PROJECTION_LEGACY,
  CONTEXT_PROJECTION_WITH_LOCALE
} from './deploy-c3-concierge-cycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat', 'v1-client-hardening');
export const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
const SOURCE = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');
const SESSION_NODES = ['Get Bot Session', 'Get Bot Session (Premium)'];
const RESPONSE_NODES = ['Build Bot Response', 'Build Bot Response (Premium)'];
const PROJECTION_NODE = 'Prepare Cycle Projection';
export const ALLOWED_NODES = [...SESSION_NODES, ...RESPONSE_NODES, PROJECTION_NODE];
const START_MARKER = '// ============ P1-01';
const END_MARKER = '// ============ end P1-01 ============';

const clone = (value) => JSON.parse(JSON.stringify(value));
const stable = (value) => JSON.stringify(value);
const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const importable = (workflow) => ({
  name: workflow.name,
  nodes: workflow.nodes,
  connections: workflow.connections,
  settings: workflow.settings || {}
});
const node = (workflow, name) => workflow.nodes.find((item) => item.name === name);

function extractMarkedBlock(code, label) {
  const start = code.indexOf(START_MARKER);
  const endStart = code.indexOf(END_MARKER);
  if (start < 0 || endStart < 0 || code.indexOf(START_MARKER, start + 1) !== -1 ||
      code.indexOf(END_MARKER, endStart + 1) !== -1 || endStart < start) {
    throw new Error(label + ': locale block markers are not unique');
  }
  let end = endStart + END_MARKER.length;
  if (code.slice(end, end + 2) === '\r\n') end += 2;
  else if (code.charAt(end) === '\n') end += 1;
  return code.slice(start, end);
}

function replaceMarkedBlock(code, replacement, label) {
  const current = extractMarkedBlock(code, label);
  return code.replace(current, replacement);
}

function parseOnly(code, label) {
  try {
    // Parse the n8n Code-node body without executing it. `$(` is rewritten only to make it a
    // conventional identifier for the parser; semantics remain covered by the executed QA gate.
    new Function(code.replace(/\$input/g, '__input').replace(/\$\(/g, '__ref('));
  } catch (error) {
    throw new Error(label + ': generated body does not parse: ' + error.message);
  }
}

export function prepareConcierge(live, tracked) {
  const failures = [];
  const out = clone(live);
  const sourceSession = node(tracked, 'Get Bot Session');
  const sourceResponse = node(tracked, 'Build Bot Response');
  if (!sourceSession || !sourceResponse) {
    return { out: null, failures: ['tracked source lacks Get Bot Session or Build Bot Response'] };
  }

  let wantedLocaleBlock = '';
  try { wantedLocaleBlock = extractMarkedBlock(String(sourceSession.parameters.jsCode || ''), 'tracked session'); }
  catch (error) { failures.push(error.message); }

  const liveResponses = RESPONSE_NODES.map((name) => node(live, name));
  if (liveResponses.some((item) => !item)) failures.push('one or more live response nodes are missing');
  const liveUrls = liveResponses.filter(Boolean).map((item) => {
    const match = /const MINIAPP_URL = "([^"]+)";/.exec(String(item.parameters.jsCode || ''));
    return match ? match[1] : '';
  });
  if (liveUrls.some((value) => !value) || new Set(liveUrls).size !== 1) {
    failures.push('the live response nodes do not expose one identical Mini App URL');
  }
  const resolvedResponse = String(sourceResponse.parameters.jsCode || '')
    .split('__PREMIUM_MINIAPP_URL__').join(liveUrls[0] || '__PREMIUM_MINIAPP_URL__');
  if (resolvedResponse.includes('__PREMIUM_')) failures.push('a response placeholder remains unresolved');

  if (!failures.length) {
    for (const name of SESSION_NODES) {
      const target = node(out, name);
      if (!target) { failures.push('missing live node: ' + name); continue; }
      try { target.parameters.jsCode = replaceMarkedBlock(String(target.parameters.jsCode || ''), wantedLocaleBlock, name); }
      catch (error) { failures.push(error.message); }
    }
    for (const name of RESPONSE_NODES) {
      const target = node(out, name);
      if (!target) { failures.push('missing live node: ' + name); continue; }
      target.parameters.jsCode = resolvedResponse;
    }
    const projection = node(out, PROJECTION_NODE);
    if (!projection) failures.push('missing live node: ' + PROJECTION_NODE);
    else {
      const code = String(projection.parameters.jsCode || '');
      const legacyCount = code.split(CONTEXT_PROJECTION_LEGACY).length - 1;
      const currentCount = code.split(CONTEXT_PROJECTION_WITH_LOCALE).length - 1;
      if (currentCount === 1 && legacyCount === 0) projection.parameters.jsCode = code;
      else if (legacyCount === 1 && currentCount === 0) {
        projection.parameters.jsCode = code.replace(CONTEXT_PROJECTION_LEGACY, CONTEXT_PROJECTION_WITH_LOCALE);
      } else failures.push(PROJECTION_NODE + ': contextProjection anchor is not exactly one known version');
    }
  }

  if (!failures.length) {
    if (stable(out.connections || {}) !== stable(live.connections || {})) failures.push('connection graph changed');
    if (stable(out.settings || {}) !== stable(live.settings || {})) failures.push('workflow settings changed');
    if (out.name !== live.name || out.nodes.length !== live.nodes.length) failures.push('workflow identity or node count changed');
    for (const before of live.nodes) {
      const after = node(out, before.name);
      if (!after) { failures.push('node removed: ' + before.name); continue; }
      if (ALLOWED_NODES.includes(before.name)) {
        const left = clone(before); const right = clone(after);
        left.parameters.jsCode = ''; right.parameters.jsCode = '';
        if (stable(left) !== stable(right)) failures.push('non-code metadata changed on ' + before.name);
      } else if (stable(before) !== stable(after)) failures.push('unauthorised node changed: ' + before.name);
    }
    for (const name of ALLOWED_NODES) {
      const target = node(out, name);
      if (!target) continue;
      try { parseOnly(String(target.parameters.jsCode || ''), name); }
      catch (error) { failures.push(error.message); }
    }
    const blob = stable(importable(out));
    for (const token of ['p|lang_ro', 'p|lang_ru', '__language_choice_required', 'locale: locale']) {
      if (!blob.includes(token)) failures.push('prepared workflow lacks ' + token);
    }
    if (blob.includes('callback_data: "p|lang"')) failures.push('unmapped five-button language control returned');
  }
  return { out, failures };
}

async function api(base, readKey, writeKey, method, path, payload) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? readKey : writeKey },
          payload ? { 'Content-Type': 'application/json' } : {}),
        body: payload ? JSON.stringify(payload) : undefined
      });
      const text = await response.text();
      if (!response.ok) throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
      return text ? JSON.parse(text) : null;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw last;
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-v1-client-hardening-concierge.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const readKey = process.env.N8N_API_KEY;
  const writeKey = process.env.N8N_FIX_API_KEY || readKey;
  if (!base || !readKey) throw new Error('N8N_BASE_URL and N8N_API_KEY must be set');
  if (!dryRun && !confirm) throw new Error('use --dry-run or --confirm');
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('\nV1 client hardening — Concierge');
  console.log('='.repeat(78));
  console.log(dryRun ? '  MODE: DRY RUN' : '  MODE: LIVE');
  const live = await api(base, readKey, writeKey, 'GET', '/workflows/' + CONCIERGE_ID);
  const tracked = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const rollbackPath = join(OUT_DIR, CONCIERGE_ID + '.pre-client-hardening.json');
  const rollback = keepRollback(rollbackPath, JSON.stringify(importable(live), null, 2) + '\n');
  console.log('  PASS  fresh rollback captured' + (rollback.aside ? ' (timestamped)' : ''));
  const prepared = prepareConcierge(live, tracked);
  if (prepared.failures.length) throw new Error(prepared.failures.join(' | '));
  const candidatePath = join(OUT_DIR, CONCIERGE_ID + '.client-hardening-candidate.json');
  writeFileSync(candidatePath, JSON.stringify(importable(prepared.out), null, 2) + '\n');
  const changed = ALLOWED_NODES.filter((name) =>
    String(node(live, name).parameters.jsCode || '') !== String(node(prepared.out, name).parameters.jsCode || ''));
  console.log('  PASS  bounded candidate verified');
  console.log('  changed: ' + (changed.join(', ') || '(already current)'));
  console.log('  sha256: ' + sha(importable(live)).slice(0, 16) + ' -> ' + sha(importable(prepared.out)).slice(0, 16));

  if (dryRun) console.log('\nDRY RUN — nothing written.');
  else {
    await api(base, readKey, writeKey, 'PUT', '/workflows/' + CONCIERGE_ID, importable(prepared.out));
    const after = await api(base, readKey, writeKey, 'GET', '/workflows/' + CONCIERGE_ID);
    const verify = prepareConcierge(after, tracked);
    const canonical = (workflow) => stable(importable(workflow)).split('\r\n').join('\n').split('\r').join('');
    if (verify.failures.length || canonical(after) !== canonical(prepared.out) || !after.active) {
      throw new Error('post-deploy read-back mismatch; use the captured rollback artifact');
    }
    console.log('  PASS  written, active, and fresh-read byte-equivalent');
  }
}
