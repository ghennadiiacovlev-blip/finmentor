#!/usr/bin/env node
// FINMENTOR final V1 P1 correction: public Premium Concierge + sequential X-Ray success graph.
//
//   node scripts/deploy-final-p1.mjs --dry-run
//   node scripts/deploy-final-p1.mjs --confirm
//
// The pure preparation functions are exported for offline QA. The CLI reads both live workflows,
// builds candidates from the accepted repository sources, and refuses any delta outside the two
// bounded fixes. --confirm writes timestamped full-workflow backups before the first PUT and
// automatically restores the workflow whose deployment or readback fails.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';
import { splicePremiumSession } from './deploy-c3-concierge-cycle.mjs';
import { prepareXray } from './deploy-c3-xray.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_ROOT = process.env.UAT_ARTIFACT_DIR || join(ROOT, '.uat');
const PREMIUM_SOURCE = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json'), 'utf8'));

export const CONCIERGE_ID = 'mppzthlkSJFr6Kle';
export const XRAY_ID = 'tNSMRoKlFB52vjge';
export const CONCIERGE_NAME = 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED';
export const XRAY_NAME = 'FINMENTOR X-Ray Analysis';
export const XRAY_VOLATILE_WEBHOOK_ID_NODES = Object.freeze([
  'Telegram Failure Notice',
  'Telegram Owner Alert',
  'Telegram Source Audit Finding',
  'Telegram Validation Failure Notice'
]);

const N = {
  trigger: 'Telegram Client Trigger',
  find: 'Find Session',
  gate: 'Premium Owner Gate',
  readCommit: 'Read Cycle Commit',
  adoptCommit: 'Adopt Cycle Commit',
  session: 'Get Bot Session',
  premiumSession: 'Get Bot Session (Premium)',
  response: 'Build Bot Response',
  premiumResponse: 'Build Bot Response (Premium)',
  transport: 'Build Transport Request'
};

const RETIRED_FROM_ROUTE = [N.gate, N.premiumSession, N.premiumResponse];
const LEGACY_ENTRY_TEXT = ['Free Text Request', 'Продолжить диагностику', 'Оставить контакт'];
const PLACEHOLDER = '__PREMIUM_MINIAPP_URL__';
const j = (value) => JSON.stringify(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const stableJson = (value) => JSON.stringify(canonical(value));
const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : j(value)).digest('hex');
const importable = (w) => ({ name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings || {} });
const byName = (w, name) => w.nodes.find((node) => node.name === name);
const targets = (w, name, output = 0) => (((w.connections[name] || {}).main || [])[output] || []).map((edge) => edge.node);

function exactly(w, name, expected, output = 0) {
  if (j(targets(w, name, output)) !== j(expected)) {
    throw new Error(name + '[' + output + '] is ' + j(targets(w, name, output)) + ', expected ' + j(expected));
  }
}

function nodeCredentialSignature(w) {
  return w.nodes.filter((node) => node.credentials).map((node) => [node.name, node.credentials]).sort((a, b) => a[0].localeCompare(b[0]));
}

// Strict legacy signature. It remains the pre-write rule for Concierge, whose trigger webhookId
// is historically pinned. X-Ray readback has a narrower, proven exception below.
function webhookSignature(w) {
  return w.nodes.filter((node) => node.webhookId || /Webhook|Trigger/.test(node.name)).map((node) => [
    node.name, node.type, node.webhookId || '', node.parameters && node.parameters.path || '',
    node.parameters && node.parameters.httpMethod || ''
  ]).sort((a, b) => a[0].localeCompare(b[0]));
}

function isWebhookRelevant(node) {
  return Boolean(node && (
    node.webhookId || /webhook|trigger/i.test(String(node.type || '')) || /Webhook|Trigger/.test(String(node.name || ''))
  ));
}

function webhookRelevantNames(...workflows) {
  const names = new Set();
  for (const workflow of workflows) {
    for (const node of (workflow && workflow.nodes) || []) if (isWebhookRelevant(node)) names.add(node.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

// The stable contract is the complete relevant node, byte-for-byte, except webhookId. This
// includes name/type/typeVersion, path, HTTP method, authentication and response configuration,
// credentials, and every other functional parameter or flag. Node removal/addition is represented
// by a null entry when callers pass the union of relevant names from both workflows.
export function stableWebhookSignature(workflow, names = webhookRelevantNames(workflow)) {
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const node = byName(workflow, name);
    if (!node) return [name, null];
    const stable = clone(node);
    delete stable.webhookId;
    return [name, stable];
  });
}

// The ONE authorised parameter delta on an X-Ray webhook-relevant node (owner-render closure,
// 2026-09-17). Both the direct route and the bounded owner-normalizer route now converge on a
// single node, and the owner-facing Telegram nodes must read their payload from that convergence
// instead of the core validator. The guard proves the delta rather than trusting it: it rewrites
// the new reference back to the retired one and still demands a byte-exact match, so any other
// edit to those nodes — copy, keyboard, parse mode, credentials, flags — is still refused.
export const XRAY_OWNER_SOURCE_REPOINT = Object.freeze({
  authorised_at: '2026-09-17', from: "$('Resolved Analysis Outcome')", to: "$('Validate + Store Rows')"
});

function withRetiredOwnerSource(value) {
  if (Array.isArray(value)) return value.map(withRetiredOwnerSource);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withRetiredOwnerSource(entry)]));
  }
  return typeof value === 'string' ? value.split(XRAY_OWNER_SOURCE_REPOINT.from).join(XRAY_OWNER_SOURCE_REPOINT.to) : value;
}

function assertStableWebhookContract(before, other, label) {
  const names = webhookRelevantNames(before, other);
  // Both sides are read through the same equivalence: the owner source repoint is the only
  // difference this collapses, so an unauthorised edit on either side still shows as a delta.
  const expected = new Map(stableWebhookSignature(before, names).map(([name, node]) => [name, withRetiredOwnerSource(node)]));
  const observed = new Map(stableWebhookSignature(other, names).map(([name, node]) => {
    const repointed = withRetiredOwnerSource(node);
    // A repoint is only authorised when the convergence node it names actually exists.
    if (stableJson(repointed) !== stableJson(node) && !byName(other, 'Resolved Analysis Outcome')) {
      throw new Error(label + ': owner source repoint names an absent node at ' + name);
    }
    return [name, repointed];
  }));
  const changed = names.filter((name) => stableJson(expected.get(name)) !== stableJson(observed.get(name)));
  if (changed.length) {
    const paths = (left, right, prefix = '') => {
      if (stableJson(left) === stableJson(right)) return [];
      if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return [prefix || '<node>'];
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      return keys.flatMap((key) => paths(left[key], right[key], prefix ? prefix + '.' + key : key)).slice(0, 12);
    };
    const detail = changed.map((name) => name + '[' + paths(expected.get(name), observed.get(name)).join(',') + ']').join('; ');
    throw new Error(label + ': stable webhook contract changed at ' + detail);
  }
  return names;
}

const uuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const metadataId = (node) => node && node.webhookId || '';
const isProvenVolatileXrayNode = (node) => Boolean(node && node.type === 'n8n-nodes-base.telegram' && node.parameters && node.parameters.operation === 'sendMessage');

export function verifyXrayWebhookCandidate(before, candidate) {
  const names = assertStableWebhookContract(before, candidate, XRAY_ID + ' candidate');
  const allowed = new Set(XRAY_VOLATILE_WEBHOOK_ID_NODES);
  for (const name of names) {
    const oldNode = byName(before, name);
    const nextNode = byName(candidate, name);
    const oldId = metadataId(oldNode);
    const nextId = metadataId(nextNode);
    if (oldId === nextId) continue;
    if (!allowed.has(name) || !oldId || nextId || !isProvenVolatileXrayNode(oldNode) || !isProvenVolatileXrayNode(nextNode)) {
      throw new Error(XRAY_ID + ': unproved webhookId candidate change at ' + name);
    }
  }
  return names;
}

export function verifyXrayWebhookReadback(before, candidate, after) {
  const candidateNames = verifyXrayWebhookCandidate(before, candidate);
  const names = webhookRelevantNames(before, candidate, after);
  if (j(names) !== j(candidateNames)) throw new Error(XRAY_ID + ': webhook node set changed after PUT');
  assertStableWebhookContract(before, after, XRAY_ID + ' readback');
  const allowed = new Set(XRAY_VOLATILE_WEBHOOK_ID_NODES);
  for (const name of names) {
    const oldNode = byName(before, name);
    const nextNode = byName(candidate, name);
    const readNode = byName(after, name);
    const oldId = metadataId(oldNode);
    const nextId = metadataId(nextNode);
    const readId = metadataId(readNode);
    if (oldId === nextId) {
      if (readId !== oldId) throw new Error(XRAY_ID + ': historically stable webhookId changed at ' + name);
      continue;
    }
    if (!allowed.has(name) || nextId || !uuid(readId) || readId === oldId || !isProvenVolatileXrayNode(readNode)) {
      throw new Error(XRAY_ID + ': expected n8n webhookId regeneration was not proven at ' + name);
    }
  }
  return names;
}

function webhookForensicNode(node) {
  return node ? {
    name: node.name,
    type: node.type,
    webhookId: node.webhookId || null,
    path: node.parameters && node.parameters.path || null,
    httpMethod: node.parameters && node.parameters.httpMethod || null,
    parameters: node.parameters || {}
  } : null;
}

function webhookDeltaClass(before, after) {
  if (!before || !after) return 'C';
  if ((before.parameters && before.parameters.path || null) !== (after.parameters && after.parameters.path || null) ||
      (before.parameters && before.parameters.httpMethod || null) !== (after.parameters && after.parameters.httpMethod || null)) return 'B';
  if (before.name !== after.name || before.type !== after.type || j(before.parameters || {}) !== j(after.parameters || {})) return 'C';
  const oldStable = clone(before); const newStable = clone(after);
  delete oldStable.webhookId; delete newStable.webhookId;
  if (j(oldStable) !== j(newStable)) return 'D';
  return metadataId(before) === metadataId(after) ? 'UNCHANGED' : 'A';
}

export function xrayWebhookForensic(before, candidate, after) {
  const nodes = webhookRelevantNames(before, candidate, after).map((name) => {
    const oldNode = byName(before, name);
    const candidateNode = byName(candidate, name);
    const readNode = byName(after, name);
    return {
      name,
      delta_class: webhookDeltaClass(oldNode, readNode),
      before: webhookForensicNode(oldNode),
      candidate: webhookForensicNode(candidateNode),
      readback: webhookForensicNode(readNode)
    };
  });
  const changed = nodes.filter((node) => node.delta_class !== 'UNCHANGED');
  const deltaClass = changed.length && changed.every((node) => node.delta_class === 'A') ? 'A'
    : changed.some((node) => node.delta_class === 'B') ? 'B'
      : changed.some((node) => node.delta_class === 'C') ? 'C'
        : changed.some((node) => node.delta_class === 'D') ? 'D' : 'NONE';
  const names = webhookRelevantNames(before, candidate, after);
  return {
    captured_at: new Date().toISOString(),
    workflow_id: before.id,
    delta_class: deltaClass,
    strict_signature_equal: j(webhookSignature(before)) === j(webhookSignature(after)),
    stable_contract_equal: j(stableWebhookSignature(before, names)) === j(stableWebhookSignature(after, names)),
    nodes
  };
}

function reachable(w, root) {
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const name = queue.shift();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    for (const branch of ((w.connections[name] || {}).main || [])) {
      for (const edge of branch || []) queue.push(edge.node);
    }
  }
  return seen;
}

function acceptedPremiumBodies(live, accepted) {
  const sourceSession = byName(accepted, N.session);
  const sourceResponse = byName(accepted, N.response);
  const livePremiumSession = byName(live, N.premiumSession);
  const livePremiumResponse = byName(live, N.premiumResponse);
  for (const [name, node] of [
    ['accepted ' + N.session, sourceSession], ['accepted ' + N.response, sourceResponse],
    ['live ' + N.premiumSession, livePremiumSession], ['live ' + N.premiumResponse, livePremiumResponse]
  ]) if (!node || !node.parameters || !node.parameters.jsCode) throw new Error('missing ' + name);

  const sessionCode = splicePremiumSession(String(sourceSession.parameters.jsCode));
  if (sessionCode !== String(livePremiumSession.parameters.jsCode)) {
    throw new Error('live premium session does not match accepted source plus the C3 cycle splice');
  }

  const liveResponseCode = String(livePremiumResponse.parameters.jsCode);
  const urlMatch = liveResponseCode.match(/const MINIAPP_URL = "([^"]+)";/);
  if (!urlMatch || !/^https:\/\//.test(urlMatch[1]) || urlMatch[1] === PLACEHOLDER) {
    throw new Error('live premium response has no accepted HTTPS Mini App URL');
  }
  let responseCode = String(sourceResponse.parameters.jsCode);
  if (!responseCode.includes(PLACEHOLDER)) throw new Error('accepted premium response has no Mini App URL placeholder');
  responseCode = responseCode.split(PLACEHOLDER).join(urlMatch[1]);
  if (responseCode !== liveResponseCode) {
    throw new Error('live premium response does not match the accepted merged source');
  }
  return { sessionCode, responseCode };
}

export function verifyPremiumStarts(workflow) {
  const body = String(byName(workflow, N.response).parameters.jsCode);
  const run = new Function('$input', body);
  const cases = [
    ['/start', 'ru', ['Описать задачу', 'Финансовая диагностика', 'Подготовить бриф', 'Запросить встречу'], 'Подготовка к первой встрече'],
    ['/start ru', 'ru', ['Описать задачу', 'Финансовая диагностика', 'Подготовить бриф', 'Запросить встречу'], 'Подготовка к первой встрече'],
    ['/start ro', 'ro', ['Descrieți solicitarea', 'Diagnostic financiar', 'Pregătiți sinteza', 'Solicitați o întâlnire'], 'Pregătirea primei întâlniri']
  ];
  const evidence = [];
  for (const [command, locale, labels, subtitle] of cases) {
    const input = { session: { chat_id: '900000001', cycle_id: 'C-900000001-1789140000000', lead_id: '', lead_cycle_id: '', state: 'TG_ENTRY', language: '' }, message_text: command };
    const result = run({ first: () => ({ json: input }) })[0].json;
    const actualLabels = (result.reply_markup.inline_keyboard || []).map((row) => row[0].text);
    if (result.debug.state_after !== 'TG_ENTRY') throw new Error(command + ' reached ' + result.debug.state_after);
    if (String(result.session.language) !== locale) throw new Error(command + ' resolved locale ' + result.session.language + ', expected ' + locale);
    if (j(actualLabels) !== j(labels)) throw new Error(command + ' buttons are ' + j(actualLabels));
    if (!String(result.reply_text).includes(subtitle)) throw new Error(command + ' lacks the accepted entry subtitle');
    for (const legacy of LEGACY_ENTRY_TEXT) if (String(result.reply_text).includes(legacy) || actualLabels.includes(legacy)) throw new Error(command + ' exposed legacy entry text: ' + legacy);
    evidence.push({ command, locale, state: result.debug.state_after, labels: actualLabels });
  }
  return evidence;
}

export function prepareConcierge(live, accepted = PREMIUM_SOURCE) {
  if (!live || live.id !== CONCIERGE_ID || live.name !== CONCIERGE_NAME) throw new Error('not the live Concierge');
  for (const name of Object.values(N)) if (!byName(live, name)) throw new Error('live Concierge lacks ' + name);

  exactly(live, N.find, [N.gate]);
  exactly(live, N.gate, [N.readCommit], 0);
  exactly(live, N.gate, [N.session], 1);
  exactly(live, N.readCommit, [N.adoptCommit]);
  exactly(live, N.adoptCommit, [N.premiumSession]);
  exactly(live, N.premiumSession, [N.premiumResponse]);
  exactly(live, N.premiumResponse, [N.transport]);
  exactly(live, N.session, [N.response]);
  exactly(live, N.response, [N.transport]);

  const bodies = acceptedPremiumBodies(live, accepted);
  const candidate = clone(live);
  byName(candidate, N.session).parameters.jsCode = bodies.sessionCode;
  byName(candidate, N.response).parameters.jsCode = bodies.responseCode;
  candidate.connections[N.find] = { main: [[{ node: N.readCommit, type: 'main', index: 0 }]] };
  candidate.connections[N.adoptCommit] = { main: [[{ node: N.session, type: 'main', index: 0 }]] };

  exactly(candidate, N.find, [N.readCommit]);
  exactly(candidate, N.readCommit, [N.adoptCommit]);
  exactly(candidate, N.adoptCommit, [N.session]);
  exactly(candidate, N.session, [N.response]);
  exactly(candidate, N.response, [N.transport]);

  const activeRoute = reachable(candidate, N.trigger);
  for (const retired of RETIRED_FROM_ROUTE) if (activeRoute.has(retired)) throw new Error(retired + ' remains reachable from the Telegram trigger');
  for (const required of [N.readCommit, N.adoptCommit, N.session, N.response, N.transport]) if (!activeRoute.has(required)) throw new Error(required + ' is not reachable from the Telegram trigger');

  const changedNodes = candidate.nodes.filter((node) => j(node) !== j(byName(live, node.name))).map((node) => node.name).sort();
  if (j(changedNodes) !== j([N.response, N.session].sort())) throw new Error('unexpected changed nodes: ' + changedNodes.join(', '));
  const connectionKeys = new Set(Object.keys(live.connections).concat(Object.keys(candidate.connections)));
  const changedConnections = [...connectionKeys].filter((name) => j(live.connections[name]) !== j(candidate.connections[name])).sort();
  if (j(changedConnections) !== j([N.adoptCommit, N.find].sort())) throw new Error('unexpected changed connections: ' + changedConnections.join(', '));
  if (candidate.nodes.length !== live.nodes.length) throw new Error('Concierge node count changed');
  if (j(candidate.settings || {}) !== j(live.settings || {})) throw new Error('Concierge settings changed');
  if (j(candidate.staticData || null) !== j(live.staticData || null)) throw new Error('Concierge staticData changed');
  if (j(nodeCredentialSignature(candidate)) !== j(nodeCredentialSignature(live))) throw new Error('Concierge credentials changed');
  if (j(webhookSignature(candidate)) !== j(webhookSignature(live))) throw new Error('Concierge webhooks changed');
  if (j(byName(candidate, N.transport)) !== j(byName(live, N.transport))) throw new Error('Transport contract changed');

  const starts = verifyPremiumStarts(candidate);
  return { candidate, changedNodes, changedConnections, starts };
}

export function verifyXrayGraph(workflow) {
  const expected = [
    ['AI X-Ray Analysis', ['Validate + Store Rows'], 0],
    ['Validate + Store Rows', ['IF Owner Render Required'], 0],
    ['IF Owner Render Required', ['Owner Render Normalizer'], 0],
    ['IF Owner Render Required', ['Resolved Analysis Outcome'], 1],
    ['Owner Render Normalizer', ['Validate Owner Render'], 0],
    ['Validate Owner Render', ['IF Owner Render Valid'], 0],
    ['IF Owner Render Valid', ['Revalidate Normalized Analysis'], 0],
    ['IF Owner Render Valid', ['Owner Render Correction'], 1],
    ['Owner Render Correction', ['Validate Owner Render Correction'], 0],
    ['Validate Owner Render Correction', ['IF Owner Render Correction Valid'], 0],
    ['IF Owner Render Correction Valid', ['Revalidate Corrected Analysis'], 0],
    ['IF Owner Render Correction Valid', ['Owner Render Failed Row'], 1],
    ['Revalidate Normalized Analysis', ['Resolved Analysis Outcome'], 0],
    ['Revalidate Corrected Analysis', ['Resolved Analysis Outcome'], 0],
    ['Owner Render Failed Row', ['Resolved Analysis Outcome'], 0],
    ['Resolved Analysis Outcome', ['Analysis Row'], 0],
    ['Analysis Row', ['Save XRay_Analysis'], 0],
    ['Save XRay_Analysis', ['Pipeline Row'], 0],
    ['Pipeline Row', ['Update Pipeline X-Ray'], 0],
    ['Update Pipeline X-Ray', ['IF Analysis Valid'], 0],
    ['AI X-Ray Analysis', ['Analysis Failed Row'], 1],
    ['Analysis Failed Row', ['Failed Row'], 0],
    ['Failed Row', ['Save Failed Analysis'], 0],
    ['Save Failed Analysis', ['Failed Pipeline Row'], 0],
    ['Failed Pipeline Row', ['Update Pipeline X-Ray Failure'], 0],
    ['Update Pipeline X-Ray Failure', ['IF Upstream Failure Owner Notice'], 0],
    ['IF Upstream Failure Owner Notice', ['Telegram Failure Notice'], 0],
    ['IF Upstream Failure Owner Notice', ['IF Upstream Retry Exhausted'], 1],
    ['IF Upstream Retry Exhausted', ['Emit System Alert (X-Ray Retry Exhausted)'], 0],
    ['IF Analysis Valid', ['IF Validation Failure Owner Notice'], 1],
    ['IF Validation Failure Owner Notice', ['Telegram Validation Failure Notice'], 0],
    ['IF Validation Failure Owner Notice', ['IF Owner Render Failed'], 1],
    ['IF Owner Render Failed', ['Emit System Alert (Owner Render Failed)'], 0],
    ['IF Owner Render Failed', ['IF Validation Retry Exhausted'], 1],
    ['IF Validation Retry Exhausted', ['Emit System Alert (X-Ray Retry Exhausted)'], 0]
  ];
  for (const [from, to, output] of expected) exactly(workflow, from, to, output);
  for (const forbidden of ['Analysis Row', 'Save XRay_Analysis', 'Pipeline Row', 'Update Pipeline X-Ray', 'IF Analysis Valid']) {
    if (targets(workflow, 'AI X-Ray Analysis', 0).includes(forbidden)) throw new Error('AI bypass edge remains: AI X-Ray Analysis -> ' + forbidden);
  }
  return expected;
}

function verifyCommon(before, candidate, after, id) {
  if (after.id !== id) throw new Error(id + ': workflow ID changed');
  if (after.name !== before.name) throw new Error(id + ': workflow name changed');
  if (after.active !== before.active) throw new Error(id + ': active state changed');
  if (j(after.settings || {}) !== j(before.settings || {})) throw new Error(id + ': settings changed');
  if (j(after.staticData || null) !== j(before.staticData || null)) throw new Error(id + ': staticData changed');
  if (j(nodeCredentialSignature(after)) !== j(nodeCredentialSignature(before))) throw new Error(id + ': credentials changed');
  if (j(after.connections) !== j(candidate.connections)) throw new Error(id + ': deployed connections differ from candidate');
  if (after.nodes.length !== candidate.nodes.length) throw new Error(id + ': deployed node count differs from candidate');
}

function verifyConciergeReadback(before, candidate, after) {
  verifyCommon(before, candidate, after, CONCIERGE_ID);
  if (j(webhookSignature(after)) !== j(webhookSignature(before))) throw new Error(CONCIERGE_ID + ': webhooks changed');
  for (const name of [N.session, N.response, N.transport]) {
    if (j(byName(after, name)) !== j(byName(candidate, name))) throw new Error('Concierge readback differs at ' + name);
  }
  const route = reachable(after, N.trigger);
  for (const retired of RETIRED_FROM_ROUTE) if (route.has(retired)) throw new Error(retired + ' is active after deployment');
  verifyPremiumStarts(after);
}

export function verifyXrayReadback(before, candidate, after) {
  verifyCommon(before, candidate, after, XRAY_ID);
  verifyXrayWebhookReadback(before, candidate, after);
  const candidateStableNodes = candidate.nodes.map((node) => { const copy = clone(node); delete copy.webhookId; return copy; });
  const readbackStableNodes = after.nodes.map((node) => { const copy = clone(node); delete copy.webhookId; return copy; });
  if (stableJson(readbackStableNodes) !== stableJson(candidateStableNodes)) throw new Error(XRAY_ID + ': deployed node configuration differs from candidate');
  verifyXrayGraph(after);
  const analysis = byName(after, 'Analysis Row');
  if (!analysis || analysis.parameters.jsonOutput !== '={{ JSON.stringify($json.analysis_row) }}') throw new Error('Analysis Row contract changed');
  const validator = byName(after, 'Validate + Store Rows');
  if (!validator || !String(validator.parameters.jsCode).includes("ANALYSIS_VERSION = 'lead-intelligence-v1'")) throw new Error('accepted validator is absent');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(base, readKey, writeKey, method, path, body, tries = 4) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? readKey : writeKey }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? j(body) : undefined
      });
      const text = await response.text();
      if (!response.ok) throw new Error(method + ' ' + path + ' -> ' + response.status + ' ' + text.slice(0, 240));
      return text ? JSON.parse(text) : null;
    } catch (error) { last = error; if (attempt + 1 < tries) await sleep(1200); }
  }
  throw last;
}

// n8n may leave a workflow inactive after a successful PUT even when it was active before the
// update. Activity is part of the deployment contract, so reconcile it before validating the
// final readback. The injected request keeps this control-plane transition independently
// testable without production access.
export async function reconcileWorkflowActivity(before, current, request) {
  if (!before || !current || !before.id || current.id !== before.id) {
    throw new Error('workflow activity reconciliation identity mismatch');
  }
  const desired = before.active === true;
  if (current.active === desired) return current;

  const action = desired ? 'activate' : 'deactivate';
  await request('POST', '/workflows/' + before.id + '/' + action, {});
  const reconciled = await request('GET', '/workflows/' + before.id);
  if (!reconciled || reconciled.id !== before.id || reconciled.active !== desired) {
    throw new Error(before.id + ': workflow activity reconciliation failed after ' + action);
  }
  return reconciled;
}

async function restore(base, readKey, writeKey, before) {
  await api(base, readKey, writeKey, 'PUT', '/workflows/' + before.id, importable(before));
  let restored = await api(base, readKey, writeKey, 'GET', '/workflows/' + before.id);
  restored = await reconcileWorkflowActivity(before, restored,
    (method, path, body) => api(base, readKey, writeKey, method, path, body));
  if (restored.active !== before.active || j(restored.connections) !== j(before.connections) || restored.nodes.length !== before.nodes.length) {
    throw new Error('rollback readback failed for ' + before.id);
  }
  return restored;
}

async function deployOne(base, readKey, writeKey, before, candidate, verify, evidencePath) {
  try {
    await api(base, readKey, writeKey, 'PUT', '/workflows/' + before.id, importable(candidate));
    let after = await api(base, readKey, writeKey, 'GET', '/workflows/' + before.id);
    after = await reconcileWorkflowActivity(before, after,
      (method, path, body) => api(base, readKey, writeKey, method, path, body));
    if (evidencePath) writeFileSync(evidencePath, JSON.stringify(xrayWebhookForensic(before, candidate, after), null, 2) + '\n', 'utf8');
    verify(before, candidate, after);
    return after;
  } catch (error) {
    try { await restore(base, readKey, writeKey, before); }
    catch (rollbackError) { throw new Error(error.message + ' | ROLLBACK FAILED: ' + rollbackError.message); }
    throw new Error(error.message + ' | rollback restored ' + before.id);
  }
}

export function verifyRestoredXrayBaseline(live, baseline) {
  if (!live || !baseline || live.id !== XRAY_ID || baseline.id !== XRAY_ID) throw new Error('X-Ray restored baseline identity mismatch');
  for (const key of ['name', 'active']) if (live[key] !== baseline[key]) throw new Error('X-Ray restored baseline differs at ' + key);
  for (const key of ['nodes', 'connections', 'settings', 'staticData']) {
    const fallback = key === 'staticData' ? null : {};
    if (j(live[key] ?? fallback) !== j(baseline[key] ?? fallback)) throw new Error('X-Ray restored baseline differs at ' + key);
  }
  return true;
}

const isMain = process.argv[1] && process.argv[1].endsWith('deploy-final-p1.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const confirm = args.includes('--confirm');
  const xrayOnly = args.includes('--xray-only');
  const base = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
  const readKey = process.env.N8N_API_KEY;
  const writeKey = process.env.N8N_FIX_API_KEY || process.env.N8N_API_KEY;
  const say = (message) => console.log(message);
  const pass = (message) => say('  PASS  ' + message);
  const fail = (message) => { console.error('\nSTOPPED: ' + message); process.exit(1); };

  if (!dryRun && !confirm) fail('use --dry-run or --confirm');
  if (!base || !readKey || !writeKey) fail('N8N_BASE_URL, N8N_API_KEY and N8N_FIX_API_KEY are required');

  try {
    say('\nFINMENTOR FINAL P1 — ' + (dryRun ? 'DRY RUN' : 'CONTROLLED PRODUCTION CUTOVER'));
    say('='.repeat(78));
    const conciergeBefore = xrayOnly ? null : await api(base, readKey, writeKey, 'GET', '/workflows/' + CONCIERGE_ID);
    const xrayBefore = await api(base, readKey, writeKey, 'GET', '/workflows/' + XRAY_ID);
    const conciergePrepared = xrayOnly ? null : prepareConcierge(conciergeBefore);
    const xrayPrepared = prepareXray(xrayBefore);
    if (xrayPrepared.failures.length) fail('X-Ray candidate refused: ' + xrayPrepared.failures.join(' | '));
    verifyXrayWebhookCandidate(xrayBefore, xrayPrepared.cand);
    verifyXrayGraph(xrayPrepared.cand);

    if (!xrayOnly) {
      pass('Concierge delta: nodes ' + conciergePrepared.changedNodes.join(', ') + '; connections ' + conciergePrepared.changedConnections.join(', '));
      for (const item of conciergePrepared.starts) pass(item.command + ' -> ' + item.locale.toUpperCase() + ' / ' + item.state);
    } else pass('Concierge excluded: no read, backup, or deployment');
    if (xrayOnly) pass('current live X-Ray accepted as the rollback baseline for this bounded deployment');
    pass('X-Ray candidate: ' + xrayPrepared.cand.nodes.length + ' nodes; exact sequential success graph; AI error graph preserved');
    pass('settings/staticData/stable webhook contract/credentials are preserved by candidate guards');

    if (dryRun) {
      say('\nDRY RUN — no production write, no retention deployment, no customer message.');
      process.exit(0);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(OUT_ROOT, 'final-p1-backups', stamp);
    mkdirSync(backupDir, { recursive: true });
    const xrayBackup = join(backupDir, XRAY_ID + '.full.json');
    if (!xrayOnly) writeFileSync(join(backupDir, CONCIERGE_ID + '.full.json'), JSON.stringify(conciergeBefore, null, 2) + '\n', 'utf8');
    writeFileSync(xrayBackup, JSON.stringify(xrayBefore, null, 2) + '\n', 'utf8');
    const backedUp = xrayOnly ? [xrayBefore] : [conciergeBefore, xrayBefore];
    writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
      captured_at: new Date().toISOString(),
      workflows: backedUp.map((workflow) => ({
        id: workflow.id, name: workflow.name, active: workflow.active, versionId: workflow.versionId,
        nodes: workflow.nodes.length, connection_sources: Object.keys(workflow.connections || {}).length,
        credentials_sha256: sha(nodeCredentialSignature(workflow)), settings_sha256: sha(workflow.settings || {}),
        staticData_sha256: sha(workflow.staticData || null), webhooks_sha256: sha(webhookSignature(workflow)),
        stable_webhook_contract_sha256: sha(stableWebhookSignature(workflow))
      }))
    }, null, 2) + '\n', 'utf8');
    pass('full backups: ' + backupDir.replace(ROOT, '.'));

    if (!xrayOnly) {
      const conciergeAfter = await deployOne(base, readKey, writeKey, conciergeBefore, conciergePrepared.candidate, verifyConciergeReadback);
      pass('Concierge deployed and read back: active=' + conciergeAfter.active + ', version=' + conciergeAfter.versionId);
    }
    const webhookEvidence = join(backupDir, XRAY_ID + '.webhook-readback.json');
    const xrayAfter = await deployOne(base, readKey, writeKey, xrayBefore, xrayPrepared.cand, verifyXrayReadback, webhookEvidence);
    pass('X-Ray deployed and read back: active=' + xrayAfter.active + ', version=' + xrayAfter.versionId);
    pass('X-Ray webhook forensic readback: ' + webhookEvidence.replace(ROOT, '.'));
    say('\nFINAL P1 PRODUCTION CUTOVER = PASS');
    say('BACKUP_DIR=' + backupDir);
  } catch (error) { fail(error.message); }
}
