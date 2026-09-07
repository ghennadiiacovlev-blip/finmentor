#!/usr/bin/env node
// FINMENTOR — P7.5 §2/§3: build and classify the PRODUCTION cutover artifact.
//
//   node scripts/build-concierge-cutover.mjs
//
// REPO-ONLY. Reads the tracked production export and the audited Model-B candidate and writes
// the exact body that will be PUT to the existing production workflow. It never contacts n8n.
//
// ================================================================================
// THIS IS NOT THE CANARY WRAPPER, AND THAT IS THE POINT
// ================================================================================
//
// P7.3 built an IMPORT-SAFE wrapper whose whole purpose was to be a SEPARATE, non-activatable
// copy: production id stripped, `active: false`, Telegram trigger disabled. Importing that as
// the production cutover would take the live bot offline.
//
// A cutover is the opposite operation. It UPDATES the existing workflow in place, so identity
// and lifecycle must be preserved, not neutralised:
//
//   * the workflow id is not in the body at all -- it is the URL of the PUT
//   * `active` is not in the body at all -- the public API's update schema accepts only
//     { name, nodes, connections, settings }, so the live lifecycle state is untouched by
//     construction rather than by care
//   * the Telegram trigger is carried VERBATIM from production -- same credential, same
//     webhookId, same parameters, still enabled -- because the transport identity is exactly
//     what a cutover must not disturb
//
// THE NAME IS TAKEN FROM PRODUCTION, NOT FROM THE CANDIDATE. The candidate is named
// "...B21C ISSUER CANDIDATE". Renaming the live workflow is a visible change that Model B does
// not require, so the production name wins. That is the only field where this projection
// prefers production over the candidate, and it is declared rather than silent.
//
// ================================================================================
// EVERY DIFFERENCE IS CLASSIFIED, AND UNEXPECTED IS FATAL
// ================================================================================
//
// classifyCutover() walks production against the artifact and puts every difference in exactly
// one bucket:
//
//   MODEL_B_REQUIRED        one of the audited P7.2/P7.4 changes, named individually below
//   GENERATED_METADATA_ONLY  a non-executable field (position, notes) on a node whose
//                            executable content is unchanged
//   UNEXPECTED               anything else -- the build REFUSES TO WRITE
//
// The lists below are not derived from the diff. They are written down, so a change that is not
// already understood cannot classify itself as understood.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// FROZEN pre-P7.5R export, not the tracked reference -- see n8n/history/README.md. The P7.5
// cutover body is "production at that moment" + Model B; the tracked reference has since
// advanced past it.
const PROD = join(ROOT, 'n8n', 'history', 'mppzthlkSJFr6Kle.pre-P7-5R-cutover.json');
const CAND = join(ROOT, 'n8n', 'candidate', 'concierge-issuer-candidate.json');
const OUT = join(ROOT, 'n8n', 'candidate', 'concierge-cutover-PRODUCTION.json');

export const PRODUCTION_WORKFLOW_ID = 'mppzthlkSJFr6Kle';
export const BOT_CREDENTIAL_ID = '2JnVm0BIX0Z8tvBf';
export const TRIGGER_WEBHOOK_ID = 'fa4cd08a-6959-4db5-890d-03755a0aa42d';
export const TRIGGER_NODE_NAME = 'Telegram Client Trigger';

// The twelve nodes Model B adds. Every one is an issuance or authority node audited by
// qa/concierge-issuer-candidate.test.mjs and exercised live in P7.3 step 2 and P7.4.
export const MODEL_B_ADDED = [
  'Issuance Gate', 'IF Issuance Fault', 'IF Preallocation Required',
  'Receipt Preallocate', 'Receipt Readback', 'Issuance Verdict',
  'IF Authority May Advance', 'Build Issuance Failure Event',
  'Authority Reread', 'Authority Verdict', 'IF Authority Current',
  'Build Stale Authority Event'
];

// The five inherited Code nodes Model B modifies, each with the reason it must change.
export const MODEL_B_MODIFIED = {
  'Get Bot Session': 'mints submission_key on a new cycle; NEVER_BACKFILL otherwise',
  'Find Session': 'carries the persisted submission_key through to the cycle gate',
  'Build Session Row': 'adds submission_key to the authority row',
  'Build Intake State Row': 'adds submission_key so a later write cannot blank it',
  'Build Confirmation State Row': 'adds submission_key so a later write cannot blank it'
};

// Connection sources whose outgoing edges change. Two are pre-existing production nodes being
// rewired into the issuance path; the rest are the new nodes' own edges.
export const MODEL_B_REWIRED_EXISTING = ['IF Message Delivered', 'IF Lead Ready'];

// Fields that are not executable. A difference confined to these on an otherwise identical node
// is metadata, not behaviour.
const NON_EXECUTABLE_FIELDS = ['position', 'notes', 'id'];

// Executable fields. Any difference here on a node outside MODEL_B_MODIFIED is UNEXPECTED.
const EXECUTABLE_FIELDS = ['type', 'typeVersion', 'parameters', 'credentials', 'disabled',
  'onError', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'alwaysOutputData',
  'continueOnFail', 'executeOnce'];

// ================================================================================
// THE DEFECT THAT MADE THE FIRST P7.5 CUTOVER ATTEMPT FAIL
// ================================================================================
//
// The tracked production exports are REDACTED before they reach git -- `ConvertTo-Redacted` in
// scripts/n8n-lib.ps1 replaces bot tokens, API keys and Telegram chat ids with markers. That is
// correct and must stay: secrets and customer identities do not belong in a repository.
//
// But every generator in this project builds its artifact FROM that redacted export. So the
// candidate, the wrapper, the API projection and this cutover artifact all inherited
// `<REDACTED_CHAT_ID>` in the three transport nodes' `chat_id` mapping, where production has
// `={{ $json.chat_id }}`.
//
// The first cutover attempt wrote that to production. The bot kept running and could not have
// replied to anyone: every reply would have been addressed to the literal string
// "<REDACTED_CHAT_ID>". It was rolled back within minutes and exact restoration was proven.
//
// WHY NOTHING CAUGHT IT. Every fidelity check in the chain compared a derivative against the
// SAME redacted source, or against another derivative of it. A marker present on both sides of
// a diff is invisible to that diff. The checks were not weak; they were pointed at the wrong
// baseline.
//
// So the marker scan below is absolute, not comparative: an artifact destined for a live
// workflow may not contain a redaction marker at all, whatever the source says. A future
// cutover must be generated from an UNREDACTED live export fetched at cutover time and never
// committed -- see docs/P7_5_PRODUCTION_CONCIERGE_CUTOVER.md §3.1.
const REDACTION_MARKERS = ['<REDACTED_CHAT_ID>', '<REDACTED_BOT_TOKEN>', '<REDACTED_API_KEY>'];

export function findRedactionMarkers(wf) {
  const blob = JSON.stringify(wf);
  const found = [];
  REDACTION_MARKERS.forEach((m) => {
    const n = blob.split(m).length - 1;
    if (n > 0) { found.push({ marker: m, count: n }); }
  });
  return found;
}

// Which nodes carry them, so a report can name the damage rather than just count it.
export function redactedNodes(wf) {
  const out = [];
  (wf.nodes || []).forEach((n) => {
    const blob = JSON.stringify(n);
    REDACTION_MARKERS.forEach((m) => {
      if (blob.indexOf(m) !== -1 && out.indexOf(n.name) === -1) { out.push(n.name); }
    });
  });
  return out;
}

function nodeMap(wf) { const m = {}; (wf.nodes || []).forEach((n) => { m[n.name] = n; }); return m; }

export function buildCutover(production, candidate) {
  return {
    // Production's name, deliberately. See the header.
    name: production.name,
    nodes: JSON.parse(JSON.stringify(candidate.nodes)),
    connections: JSON.parse(JSON.stringify(candidate.connections)),
    settings: JSON.parse(JSON.stringify(candidate.settings))
  };
}

export function serializeCutover(wf) { return JSON.stringify(wf, null, 2) + '\n'; }

// The executable fingerprint used to compare a local artifact with a live readback. Excludes
// position/notes/id, which n8n may normalise and which cannot change behaviour.
export function executableFingerprint(wf) {
  const nodes = (wf.nodes || []).slice().sort((a, b) => (a.name < b.name ? -1 : 1)).map((n) => {
    const o = { name: n.name };
    EXECUTABLE_FIELDS.forEach((k) => { if (n[k] !== undefined) { o[k] = n[k]; } });
    return o;
  });
  const payload = JSON.stringify({
    name: wf.name, nodes: nodes, connections: wf.connections, settings: wf.settings
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

// ---------------------------------------------------------------- classification

export function classifyCutover(production, artifact) {
  const findings = [];
  const pn = nodeMap(production);
  const an = nodeMap(artifact);

  const add = (kind, what, detail) => findings.push({ kind, what, detail });

  // --- nodes added ----------------------------------------------------------------------
  Object.keys(an).forEach((name) => {
    if (pn[name]) { return; }
    if (MODEL_B_ADDED.indexOf(name) !== -1) {
      add('MODEL_B_REQUIRED', 'node added: ' + name, an[name].type);
    } else {
      add('UNEXPECTED', 'node added: ' + name, an[name].type);
    }
  });

  // --- nodes removed --------------------------------------------------------------------
  Object.keys(pn).forEach((name) => {
    if (!an[name]) { add('UNEXPECTED', 'node REMOVED: ' + name, pn[name].type); }
  });

  // --- nodes modified -------------------------------------------------------------------
  Object.keys(pn).forEach((name) => {
    const a = pn[name];
    const b = an[name];
    if (!b || JSON.stringify(a) === JSON.stringify(b)) { return; }

    const execDiff = EXECUTABLE_FIELDS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    const metaDiff = NON_EXECUTABLE_FIELDS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

    if (execDiff.length === 0) {
      add('GENERATED_METADATA_ONLY', 'node metadata: ' + name, metaDiff.join(','));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(MODEL_B_MODIFIED, name)) {
      // Even a declared node may only change its Code body. A credential or type change on one
      // of these is not covered by the audit and is not accepted here.
      const disallowed = execDiff.filter((k) => k !== 'parameters');
      if (disallowed.length) {
        add('UNEXPECTED', 'declared node changed a non-parameter executable field: ' + name, disallowed.join(','));
      } else {
        add('MODEL_B_REQUIRED', 'node modified: ' + name, MODEL_B_MODIFIED[name]);
      }
      return;
    }
    add('UNEXPECTED', 'node modified: ' + name, execDiff.join(','));
  });

  // --- connections ----------------------------------------------------------------------
  const srcs = new Set(Object.keys(production.connections || {}).concat(Object.keys(artifact.connections || {})));
  srcs.forEach((src) => {
    const a = (production.connections || {})[src];
    const b = (artifact.connections || {})[src];
    if (JSON.stringify(a) === JSON.stringify(b)) { return; }
    if (MODEL_B_ADDED.indexOf(src) !== -1 || MODEL_B_REWIRED_EXISTING.indexOf(src) !== -1) {
      add('MODEL_B_REQUIRED', 'edges from: ' + src, 'rewired into the issuance path');
    } else {
      add('UNEXPECTED', 'edges from: ' + src, 'not a declared rewire point');
    }
  });

  // --- top-level ------------------------------------------------------------------------
  if (artifact.name !== production.name) {
    add('UNEXPECTED', 'workflow name changed', JSON.stringify(artifact.name));
  }
  if (JSON.stringify(artifact.settings) !== JSON.stringify(production.settings)) {
    add('UNEXPECTED', 'settings changed', JSON.stringify(artifact.settings));
  }
  const extra = Object.keys(artifact).filter((k) => ['name', 'nodes', 'connections', 'settings'].indexOf(k) === -1);
  if (extra.length) { add('UNEXPECTED', 'artifact carries fields the update schema rejects', extra.join(',')); }

  // --- the invariants §3 requires unchanged ---------------------------------------------
  const pt = pn[TRIGGER_NODE_NAME];
  const at = an[TRIGGER_NODE_NAME];
  if (!at) { add('UNEXPECTED', 'the Telegram trigger is absent from the cutover artifact', ''); }
  else {
    if (JSON.stringify(pt) !== JSON.stringify(at)) {
      add('UNEXPECTED', 'the Telegram trigger is not byte-identical to production', '');
    }
    if (at.webhookId !== TRIGGER_WEBHOOK_ID) { add('UNEXPECTED', 'trigger webhookId changed', String(at.webhookId)); }
    if (!at.credentials || at.credentials.telegramApi.id !== BOT_CREDENTIAL_ID) {
      add('UNEXPECTED', 'trigger credential changed', '');
    }
    if (at.disabled === true) { add('UNEXPECTED', 'the production trigger would be DISABLED by this cutover', ''); }
  }
  const triggers = (artifact.nodes || []).filter((n) => /trigger$/i.test(String(n.type)) || n.type === 'n8n-nodes-base.webhook');
  if (triggers.length !== 1) {
    add('UNEXPECTED', 'the artifact has ' + triggers.length + ' triggers, production has 1', triggers.map((n) => n.name).join(','));
  }
  if (!artifact.settings || artifact.settings.availableInMCP !== false) {
    add('UNEXPECTED', 'settings.availableInMCP is not false', '');
  }

  // --- redaction markers: absolute, not comparative --------------------------------------
  // Checked against the ARTIFACT alone. A comparative check cannot see a marker that is present
  // on both sides, which is exactly how the first cutover attempt passed every gate and still
  // broke the transport.
  const markers = findRedactionMarkers(artifact);
  if (markers.length) {
    add('UNEXPECTED', 'the artifact contains redaction marker(s)',
      markers.map((m) => m.marker + ' x' + m.count).join(', ')
      + ' on node(s): ' + redactedNodes(artifact).join(', ')
      + ' -- this artifact is generated from a REDACTED export and is not deployable');
  }

  const unexpected = findings.filter((f) => f.kind === 'UNEXPECTED');
  return {
    ok: unexpected.length === 0,
    findings: findings,
    counts: {
      MODEL_B_REQUIRED: findings.filter((f) => f.kind === 'MODEL_B_REQUIRED').length,
      GENERATED_METADATA_ONLY: findings.filter((f) => f.kind === 'GENERATED_METADATA_ONLY').length,
      UNEXPECTED: unexpected.length
    }
  };
}

// ---------------------------------------------------------------- main

const isMain = process.argv[1] && process.argv[1].endsWith('build-concierge-cutover.mjs');
if (isMain) {
  const production = JSON.parse(readFileSync(PROD, 'utf8'));
  const candidate = JSON.parse(readFileSync(CAND, 'utf8'));

  const artifact = buildCutover(production, candidate);
  const verdict = classifyCutover(production, artifact);

  console.log('cutover classification:');
  verdict.findings.slice().sort((a, b) => (a.kind < b.kind ? -1 : 1)).forEach((f) => {
    console.log('  [' + f.kind + '] ' + f.what + (f.detail ? '  -- ' + f.detail : ''));
  });
  console.log('');
  console.log('  MODEL_B_REQUIRED        : ' + verdict.counts.MODEL_B_REQUIRED);
  console.log('  GENERATED_METADATA_ONLY : ' + verdict.counts.GENERATED_METADATA_ONLY);
  console.log('  UNEXPECTED              : ' + verdict.counts.UNEXPECTED);

  if (!verdict.ok) {
    console.error('\nREFUSING TO WRITE: the cutover artifact contains UNEXPECTED executable differences.');
    process.exit(1);
  }

  writeFileSync(OUT, serializeCutover(artifact), 'utf8');
  console.log('');
  console.log('cutover artifact: n8n/candidate/concierge-cutover-PRODUCTION.json');
  console.log('  fields:          ' + Object.keys(artifact).join(', '));
  console.log('  name:            ' + artifact.name + '   (production name preserved)');
  console.log('  nodes:           ' + artifact.nodes.length + '  (production ' + production.nodes.length + ')');
  console.log('  telegram trigger: byte-identical to production, still ENABLED');
  console.log('  webhookId:       ' + TRIGGER_WEBHOOK_ID + '  (unchanged)');
  console.log('  credential:      ' + BOT_CREDENTIAL_ID + '  (unchanged)');
  console.log('  settings:        identical to production');
  console.log('  fingerprint:     ' + executableFingerprint(artifact));
}
