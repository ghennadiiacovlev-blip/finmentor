#!/usr/bin/env node
// FINMENTOR — P8.4B (WRITE B): migrate the Concierge lead handoff from the PUBLIC HTTP webhook
// to the STRUCTURAL internal Execute Workflow route.
//
//   node scripts/build-concierge-internal-handoff.mjs
//
// REPO-ONLY. Reads the tracked Concierge export and writes a candidate. Never contacts n8n.
//
// ================================ WHY ================================
//
// The Concierge posted leads to Lead Intake's PUBLIC webhook. That route is reachable by anyone
// who knows the URL, so the bot's submission was indistinguishable from an internet request and
// could not carry a capability. Write A deployed an internal executeWorkflowTrigger reachable
// only from inside the tenant; this points the Concierge at it.
//
// ================================ THE SHAPE ================================
//
//   [IF Lead Already Sent] false -> <Build Internal Handoff> -> <Send Lead to Intake (Internal)>
//                                                                     -> [Parse Intake Response]
//   [Send Lead to Intake]  (public httpRequest)  REMOVED
//
// THE KEY IS NOT MINTED HERE. `Build Internal Handoff` reads the submission_key from
// `Issuance Gate` — the SAME node `Receipt Preallocate` wrote the receipt with — so the handoff
// carries the authoritative key the cycle already owns. Minting a second key at handoff would
// orphan that receipt and produce a submission the state machine cannot settle. Nothing about
// the key comes from the caller: the Telegram update never reaches it.
//
// `Issuance Gate` is chosen over `Issuance Verdict` deliberately. Verdict only runs when a
// preallocation was required; on the REUSE path `IF Preallocation Required` routes straight to
// `Build Session Row`, so `$('Issuance Verdict')` is unresolvable there. The Gate always runs.
//
// CORRELATION. The Concierge lead payload carries no request_id, and the internal route requires
// one: `Internal Auth Entry` faults CORRELATION_ID_MISSING without it, and `Correlation Guard`
// then demands it equal what `Normalize + Score Lead` derives. `cycle_id` is used — server-
// derived, stable across retries WITHIN a cycle, which is what makes a replay correlate to the
// submission it is replaying.
//
// ENVELOPE SOURCE. `Internal Auth Entry` hard-requires `telegram_miniapp`. That is the internal
// GATEWAY ENVELOPE marker, not lead attribution: `Validate Payload` derives the lead's source
// from `payload.tool`, which stays `telegram_client_concierge`. The naming is Write A's and is
// left alone here rather than reopened.
//
// TB-1. The submission_key travels ONLY into the envelope. It is never written to a
// customer-facing field, and `mode` is never sent to the client.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// FROZEN pre-Write-B export. Sealing Write B advanced the tracked reference to 51 nodes, so
// reading the moving pointer here would try to remove a node that is already gone.
const SOURCE = join(ROOT, 'n8n/history/mppzthlkSJFr6Kle.pre-write-b.json');
const OUT = join(ROOT, 'n8n/candidate/concierge-internal-handoff-candidate.json');

export const LEAD_INTAKE_WORKFLOW_ID = 'QmIyEW2ZEqKregmN';
export const ADDED_NODES = ['Build Internal Handoff', 'Send Lead to Intake (Internal)'];
export const ADDED_NODE_IDS = {
  'Build Internal Handoff': 'p84b-01-build-handoff',
  'Send Lead to Intake (Internal)': 'p84b-02-internal-handoff'
};
export const REMOVED_NODE = {
  name: 'Send Lead to Intake',
  id: 'b43d5227-8eaa-4e98-94d7-f901fc5c3255',
  inbound: ['IF Lead Already Sent'],
  outbound: ['Parse Intake Response']
};
export const REWIRED_SOURCES = ['IF Lead Already Sent', 'Send Lead to Intake'];

const HANDOFF_CODE = [
  '// P8.4B — build the INTERNAL envelope for the structural Lead Intake handoff.',
  '//',
  '// THE KEY IS NOT MINTED HERE. It is read from Issuance Gate, the same node Receipt',
  '// Preallocate wrote the receipt with, so the handoff carries the authoritative key this cycle',
  '// already owns. A second mint at handoff would orphan that receipt and create a submission the',
  '// state machine could never settle. Nothing here is caller-supplied: the Telegram update does',
  '// not reach this node, and no header, body flag or source field is consulted for trust.',
  "const gate = $('Issuance Gate').first().json || {};",
  "const b = $('Build Bot Response').first().json || {};",
  "const g = $('Get Bot Session').first().json || {};",
  '',
  "const key = String(gate.__submission_key || '');",
  "const cycleId = String(g.cycle_id || '');",
  'const base = b.lead_payload || {};',
  '',
  '// The correlation the receipt will be stamped with. cycle_id is server-derived and stable',
  '// across retries within the cycle, so a replay correlates to the submission it replays.',
  'const payload = Object.assign({}, base, {',
  '  audit: {',
  '    cycle_id: cycleId,',
  "    consent_cycle_id: String(g.consent_cycle_id || g.cycle_id || ''),",
  "    consent_at: String(g.consent_at || new Date().toISOString())",
  '  },',
  '  meta: Object.assign({}, base.meta || {}, { request_id: cycleId })',
  '});',
  '',
  '// The wrapper the internal trigger passes through untouched. source is the internal GATEWAY',
  '// envelope marker required by Internal Auth Entry; lead attribution stays payload.tool.',
  'return [{ json: {',
  '  submission_key: key,',
  '  envelope: {',
  "    source: 'telegram_miniapp',",
  '    payload: payload',
  '  }',
  '} }];'
].join('\n');

export function buildInternalHandoff(base) {
  const wf = JSON.parse(JSON.stringify(base));
  const byName = (n) => wf.nodes.find((x) => x.name === n);

  if (wf.nodes.length !== 50) { throw new Error('base is not the 50-node P8.3A Concierge: ' + wf.nodes.length); }
  const old = byName(REMOVED_NODE.name);
  if (!old) { throw new Error('anchor node missing: ' + REMOVED_NODE.name); }
  if (old.id !== REMOVED_NODE.id) { throw new Error('the node to remove is not the pinned id'); }
  if (old.type !== 'n8n-nodes-base.httpRequest') { throw new Error('the node to remove is not the public HTTP call'); }
  ADDED_NODES.forEach((n) => { if (byName(n)) { throw new Error('node already present: ' + n); } });
  ['Issuance Gate', 'Build Bot Response', 'Get Bot Session', 'IF Lead Already Sent',
    'Parse Intake Response'].forEach((n) => {
    if (!byName(n)) { throw new Error('anchor node missing: ' + n); }
  });

  const at = old.position || [0, 0];

  wf.nodes.push({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: HANDOFF_CODE },
    id: ADDED_NODE_IDS['Build Internal Handoff'],
    name: 'Build Internal Handoff',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [at[0] - 200, at[1]]
  });

  // The public HTTP node retried twice with a 2s backoff and never aborted the turn. That
  // posture is preserved: a retry is now SAFE in a way it was not before P8.4A-R, because a
  // second attempt on a settled receipt resolves from it instead of writing again.
  wf.nodes.push({
    parameters: {
      mode: 'each',
      options: { waitForSubWorkflow: true },
      workflowId: { __rl: true, mode: 'id', value: LEAD_INTAKE_WORKFLOW_ID }
    },
    id: ADDED_NODE_IDS['Send Lead to Intake (Internal)'],
    name: 'Send Lead to Intake (Internal)',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: at,
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 2000,
    continueOnFail: true
  });

  wf.nodes = wf.nodes.filter((n) => n.name !== REMOVED_NODE.name);

  wf.connections['IF Lead Already Sent'] = {
    main: [
      [{ node: 'Build Intake Transport Request', type: 'main', index: 0 }],
      [{ node: 'Build Internal Handoff', type: 'main', index: 0 }]
    ]
  };
  wf.connections['Build Internal Handoff'] = {
    main: [[{ node: 'Send Lead to Intake (Internal)', type: 'main', index: 0 }]]
  };
  wf.connections['Send Lead to Intake (Internal)'] = {
    main: [[{ node: 'Parse Intake Response', type: 'main', index: 0 }]]
  };
  delete wf.connections[REMOVED_NODE.name];

  wf.name = 'FINMENTOR Telegram Client Concierge INTERNAL HANDOFF CANDIDATE';
  return wf;
}

export const serialize = (wf) => JSON.stringify(wf, null, 2) + '\n';

export function verifyInternalHandoff(base, cand) {
  const failures = [];
  const bn = (w, n) => w.nodes.find((x) => x.name === n);
  if (cand.nodes.length !== base.nodes.length + 1) { failures.push('node count is not base + 1'); }
  if (bn(cand, REMOVED_NODE.name)) { failures.push('the public HTTP handoff is still present'); }
  if (cand.nodes.some((n) => n.type === 'n8n-nodes-base.httpRequest'
    && /lead_intake|intake/i.test(JSON.stringify(n.parameters || {})))) {
    failures.push('an HTTP node still targets Lead Intake');
  }
  const ew = cand.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow'
    && (((n.parameters || {}).workflowId) || {}).value === LEAD_INTAKE_WORKFLOW_ID);
  if (ew.length !== 1) { failures.push('there are ' + ew.length + ' Execute Workflow calls to Lead Intake'); }
  if (ew.length === 1 && typeof ew[0].parameters.workflowId.value !== 'string') {
    failures.push('the target workflow id is not a literal');
  }
  if (ew.length === 1 && /^=/.test(String(ew[0].parameters.workflowId.value))) {
    failures.push('the target workflow id is an expression — it is dynamically steerable');
  }
  ADDED_NODES.forEach((n) => {
    const node = bn(cand, n);
    if (!node) { failures.push('missing added node ' + n); return; }
    if (node.id !== ADDED_NODE_IDS[n]) { failures.push('added node id drifted: ' + n); }
    if (node.credentials) { failures.push('added node carries a credential: ' + n); }
  });
  const EXEC = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled', 'onError',
    'retryOnFail', 'maxTries', 'waitBetweenTries', 'continueOnFail'];
  base.nodes.forEach((b) => {
    if (b.name === REMOVED_NODE.name) { return; }
    const c = bn(cand, b.name);
    if (!c) { failures.push('base node vanished: ' + b.name); return; }
    EXEC.forEach((k) => {
      if (JSON.stringify(b[k]) !== JSON.stringify(c[k])) { failures.push('undeclared change on ' + b.name + '.' + k); }
    });
  });
  const isTrig = (t) => /trigger$/i.test(String(t)) || String(t) === 'n8n-nodes-base.webhook';
  if (cand.nodes.filter((n) => isTrig(n.type)).length !== base.nodes.filter((n) => isTrig(n.type)).length) {
    failures.push('trigger count changed');
  }
  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-concierge-internal-handoff.mjs');
if (isMain) {
  const base = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const cand = buildInternalHandoff(base);
  const v = verifyInternalHandoff(base, cand);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the Write B candidate failed verification.');
    v.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  writeFileSync(OUT, serialize(cand), 'utf8');
  console.log('Write B candidate: n8n/candidate/concierge-internal-handoff-candidate.json');
  console.log('  nodes        : ' + cand.nodes.length + '  (base ' + base.nodes.length + ' + 2 - 1)');
  console.log('  added        : ' + ADDED_NODES.join(', '));
  console.log('  removed      : ' + REMOVED_NODE.name + ' (public httpRequest)');
  console.log('  target       : ' + LEAD_INTAKE_WORKFLOW_ID + ' (literal, not steerable)');
  console.log('  verification : PASS');
}
