#!/usr/bin/env node
// FINMENTOR — build the B.2.1-C P5 Lead Intake candidate with the MODEL B receipt critical
// section spliced in.
//
//   node scripts/build-lead-intake-receipt-candidate.mjs
//
// REPO-ONLY. This reads the tracked production export and WRITES A NEW FILE under
// n8n/candidate/. It never contacts n8n, never mutates the production export, and never
// touches a live workflow. P6 deploys the result; P5 only produces it.
//
// Why a generator rather than a hand-edited 72-node JSON: the splice is a small, stateable
// transformation of a large file. Expressed as code it is reviewable, regenerable, and
// diffable against the production export it derives from. Hand-editing the JSON would make
// the interesting part — WHERE the claim goes and WHAT the zero-row branch reaches — the
// hardest thing in the artefact to see.
//
// THE SPLICE, in one picture. Existing nodes in [], new nodes in <>:
//
//   <Internal Auth Entry> ──┐
//   [Webhook] ──────────────┴─> [Validate Payload] -> [IF Valid] -> ... -> [Dedup Guard]
//
//   [Dedup Guard] -> <Receipt Gate> -> <IF Receipt Required>
//        ├─ false (public path) ───────────────────────────────> [IF Is New]
//        └─ true  -> <Receipt Exact Read> -> <Receipt Claim>
//                       -> <Claim Verdict> -> <IF Claim Won>
//                            ├─ true ────────────────────────> [IF Is New]
//                            └─ false -> <Respond Receipt Unresolved> -> <Stop: Receipt Claim Failed>
//
// and each of the three lead-id-returning outcomes commits before responding:
//
//   [Save to Pipeline]       -> <Commit (New)>   -> <Commit Verdict (New)>   -> <IF Committed (New)>   -> [Respond New Lead]
//   [IF Is Retry] true       -> <Commit (Retry)> -> <Commit Verdict (Retry)> -> <IF Committed (Retry)> -> [Respond Retry]
//   [Update Pipeline (Merge)]-> <Commit (Merge)> -> <Commit Verdict (Merge)> -> <IF Committed (Merge)> -> [Respond Merged]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SOURCE = join(ROOT, 'n8n/production/QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json');
const OUT_DIR = join(ROOT, 'n8n/candidate');
const OUT = join(OUT_DIR, 'lead-intake-internal-receipt-candidate.json');

// The receipt table is referenced BY NAME, not by id. The production table does not exist
// yet — P6 step 2 creates it — and baking a placeholder id would produce a candidate that
// looks deployable while pointing at nothing.
const TABLE = { __rl: true, mode: 'name', value: 'Submission_Receipts' };

const wf = JSON.parse(readFileSync(SOURCE, 'utf8'));

function nodeByName(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) { throw new Error('anchor node missing from production export: ' + name); }
  return n;
}

// Fail loudly if the production graph is not the shape this splice assumes. A silent splice
// onto a drifted graph is exactly how a claim ends up on the wrong side of a Pipeline write.
const ANCHORS = [
  'Webhook', 'Validate Payload', 'Dedup Guard', 'IF Is New', 'IF Is Retry',
  'Save to Pipeline', 'Update Pipeline (Merge)',
  'Respond New Lead', 'Respond Retry', 'Respond Merged'
];
ANCHORS.forEach(nodeByName);

const at = (name, dx, dy) => {
  const p = nodeByName(name).position;
  return [p[0] + dx, p[1] + dy];
};

let idSeq = 0;
function nid(slug) {
  idSeq += 1;
  return 'p5-receipt-' + String(idSeq).padStart(2, '0') + '-' + slug;
}

function code(name, position, jsCode, notes) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: nid('code'), name: name, type: 'n8n-nodes-base.code', typeVersion: 2,
    position: position, notes: notes
  };
}

function ifNode(name, position, leftExpr, rightValue, notes) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: nid('cond'),
          leftValue: leftExpr,
          rightValue: rightValue,
          operator: { type: 'number', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: nid('if'), name: name, type: 'n8n-nodes-base.if', typeVersion: 2.2,
    position: position, notes: notes
  };
}

// ---------------------------------------------------------------- the receipt nodes

const NEW_NODES = [];

// P1-L10. The internal entry. Provenance is the fact that THIS NODE RAN, which is a property
// of the workflow graph and unreachable from the public webhook. `internalRouteProven()` in
// normalize-score-lead.js reads exactly this node name and is unchanged by P5.
NEW_NODES.push({
  parameters: { inputSource: 'passthrough' },
  id: nid('entry'),
  name: 'Internal Auth Entry',
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  typeVersion: 1.2,
  position: at('Webhook', 0, -220),
  notes: 'P1-L10 INTERNAL SUBWORKFLOW entry. Invoked in-tenant by the Mini App gateway. ' +
    'No public URL, no transport secret. Provenance = this node ran. Never reachable from ' +
    'the public webhook, where $() throws and provenance is false.'
});

// Sets __internal_route on the item so internalRouteProven() finds it. Kept as its own tiny
// node rather than folded into the trigger because the trigger passes caller data through,
// and the marker must be set by the GRAPH, never carried by the caller.
NEW_NODES.push(code('Internal Route Marker', at('Webhook', 180, -220),
  [
    '// The marker is written HERE, by the workflow, and never read from the caller payload.',
    '// A caller that sends __internal_route on the public path is ignored: that path never',
    '// reaches this node, and Validate Payload strips caller-asserted control fields.',
    'const out = [];',
    'for (const i of $input.all()) {',
    '  const j = Object.assign({}, i.json);',
    '  j.__internal_route = true;',
    '  out.push({ json: j });',
    '}',
    'return out;'
  ].join('\n'),
  'Sets the graph-owned provenance marker. Never reads it from the caller.'));

// ---- the claim chain -------------------------------------------------------------

NEW_NODES.push(code('Receipt Gate', at('Dedup Guard', 0, 260),
  [
    '// P5 §3 / §6. Decide whether this execution is inside the receipt critical section.',
    '//',
    '// TWO conditions, both required, and both server-side:',
    '//   1. provenance came from the INTERNAL route (the graph, not the payload)',
    '//   2. a syntactically exact submission_key arrived over that trusted transport',
    '//',
    '// The public path fails (1) and therefore never reads, creates, claims or commits a',
    '// receipt, and never reveals whether any key exists. A public caller that sends a',
    '// submission_key gets the ordinary public behaviour with the field ignored — not an',
    '// error, because an error that fires only for real keys is an existence oracle.',
    'function internalRouteProven() {',
    "  try { return $('Internal Auth Entry').first().json.__internal_route === true; }",
    '  catch (e) { return false; }',
    '}',
    'const trusted = internalRouteProven();',
    '',
    "const KEY_RE = /^sub_[0-9a-f]{32}$/;",
    '// Read the key ONLY from the trusted internal transport, never from the public body.',
    'let key = \'\';',
    'if (trusted) {',
    "  try { key = String($('Internal Auth Entry').first().json.submission_key || '').trim(); }",
    "  catch (e) { key = ''; }",
    '}',
    'const keyValid = KEY_RE.test(key);',
    '',
    '// The server correlation id that the gateway also used as envelope.meta.request_id.',
    '// P1-L9: this exact value is what the winning claim stamps onto the receipt.',
    "let correlationId = '';",
    'if (trusted) {',
    '  try {',
    "    const e = $('Internal Auth Entry').first().json;",
    "    correlationId = String((e.meta && e.meta.request_id) || e.request_id || '').trim().slice(0, 80);",
    "  } catch (e) { correlationId = ''; }",
    '}',
    '',
    'const receiptRequired = trusted && keyValid && correlationId !== \'\';',
    '',
    'const out = [];',
    'for (const i of $input.all()) {',
    '  const j = Object.assign({}, i.json);',
    '  j.__receipt_required = receiptRequired ? 1 : 0;',
    '  j.__submission_key = receiptRequired ? key : \'\';',
    '  j.__correlation_id = receiptRequired ? correlationId : \'\';',
    '  // Trusted route with a malformed key or no correlation id is a WIRING fault, not a',
    '  // public request. It must fail closed rather than silently degrade to the public path.',
    '  j.__receipt_fault = (trusted && !receiptRequired) ? 1 : 0;',
    '  out.push({ json: j });',
    '}',
    'return out;'
  ].join('\n'),
  'P5 §3/§6. Receipt branch requires INTERNAL provenance + exact key + server correlation id. ' +
  'Public path bypasses the whole branch and reveals nothing about key existence.'));

NEW_NODES.push(ifNode('IF Receipt Required', at('Dedup Guard', 220, 260),
  '={{ $json.__receipt_required }}', 1,
  'true -> receipt critical section. false -> public/ordinary path, receipt untouched.'));

NEW_NODES.push({
  parameters: {
    resource: 'row', operation: 'get', dataTableId: TABLE,
    matchType: 'allConditions',
    filters: { conditions: [{ keyName: 'submission_key', condition: 'eq', keyValue: '={{ $json.__submission_key }}' }] },
    returnAll: true
  },
  id: nid('read'), name: 'Receipt Exact Read', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
  position: at('Dedup Guard', 440, 180),
  alwaysOutputData: true,
  notes: 'Exact-key read. alwaysOutputData so an ABSENT receipt still reaches the verdict node ' +
    'instead of silently skipping the rest of the branch (P4 zero-item semantics).'
});

NEW_NODES.push(code('Receipt Read Verdict', at('Dedup Guard', 660, 180),
  [
    '// classifyRows, inlined for the n8n sandbox. ABSENCE IS NEVER AN ANSWER: a current',
    '// cycle is required to have a preallocated receipt, so a missing row is a broken',
    '// invariant, not permission to proceed.',
    "const gate = $('Receipt Gate').first().json;",
    'const key = String(gate.__submission_key || \'\');',
    'const rows = $input.all()',
    '  .map((i) => i.json)',
    '  .filter((r) => r && typeof r === \'object\' && String(r.submission_key || \'\') !== \'\');',
    '',
    'let ok = 0;',
    "let reason = 'RECEIPT_ABSENT_INVARIANT_BROKEN';",
    'if (rows.length === 1 && String(rows[0].submission_key) === key) {',
    "  const state = String(rows[0].commit_state || '').trim();",
    "  if (state === 'READY') { ok = 1; reason = 'READY'; }",
    "  else { ok = 0; reason = 'RECEIPT_NOT_READY_' + (state || 'EMPTY'); }",
    '} else if (rows.length > 1) {',
    "  reason = 'DUPLICATE_RECEIPTS';",
    "} else if (rows.length === 1) {",
    "  reason = 'LOOKUP_CONTRACT_VIOLATION';",
    '}',
    '',
    "return [{ json: Object.assign({}, gate, { __receipt_read_ok: ok, __receipt_reason: reason }) }];"
  ].join('\n'),
  'Absence resolves to a broken invariant, never to "safe to proceed".'));

NEW_NODES.push(ifNode('IF Receipt Claimable', at('Dedup Guard', 880, 180),
  '={{ $json.__receipt_read_ok }}', 1,
  'Only a single READY row for the exact key may proceed to the claim.'));

// THE CLAIM. alwaysOutputData is the load-bearing setting: without it a zero-match emits no
// items and every node after it is skipped, so the fail-closed branch would never run.
NEW_NODES.push({
  parameters: {
    resource: 'row', operation: 'update', dataTableId: TABLE,
    matchType: 'allConditions',
    filters: {
      conditions: [
        { keyName: 'submission_key', condition: 'eq', keyValue: '={{ $json.__submission_key }}' },
        { keyName: 'commit_state', condition: 'eq', keyValue: 'READY' }
      ]
    },
    columns: {
      mappingMode: 'defineBelow',
      value: {
        commit_state: 'IN_FLIGHT',
        claimed_at: '={{ $now.toISO() }}',
        // P1-L9 — the SAME server correlation id the gateway sent as meta.request_id.
        correlation_id: '={{ $json.__correlation_id }}'
      },
      schema: ['commit_state', 'claimed_at', 'correlation_id'].map((c) => ({
        id: c, displayName: c, required: false, defaultMatch: false, display: true,
        type: 'string', canBeUsedToMatch: true
      }))
    }
  },
  id: nid('claim'), name: 'Receipt Claim', type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
  position: at('Dedup Guard', 1100, 180),
  alwaysOutputData: true,
  notes: 'READY -> IN_FLIGHT CAS. alwaysOutputData:true is LOAD-BEARING: P4 proved a ' +
    'zero-match returns main[0]===[] and skips every downstream node, so without it the ' +
    'fail-closed branch could never run. Sets correlation_id (P1-L9).'
});

NEW_NODES.push(code('Claim Verdict', at('Dedup Guard', 1320, 180),
  [
    '// P5 §4 — the zero-item discriminator. Returns { ok, updated_rows } and NEVER throws.',
    '//',
    '// Under alwaysOutputData:true n8n substitutes a single EMPTY item {} when the update',
    '// matched nothing. That synthetic item is the trap: a truthy test or a field read in a',
    '// try/catch would turn it into a fake success. The discriminator therefore keys on a',
    '// field a genuinely updated row ALWAYS carries — the node returns the full post-update',
    '// row — and an empty item NEVER does.',
    "const gate = $('Receipt Gate').first().json;",
    'const key = String(gate.__submission_key || \'\');',
    'const items = $input.all();',
    '',
    'let updated = 0;',
    "let reason = 'STATE_ALREADY_MOVED';",
    'if (items.length > 1) {',
    '  updated = items.length;',
    "  reason = 'MULTIPLE_ROWS_AFFECTED';",
    '} else if (items.length === 1) {',
    '  const row = (items[0] && items[0].json) || {};',
    "  const stored = String(row.submission_key || '').trim();",
    "  if (stored === '') { updated = 0; reason = 'STATE_ALREADY_MOVED'; }",
    "  else if (stored !== key) { updated = 0; reason = 'UPDATE_TOUCHED_WRONG_KEY'; }",
    "  else { updated = 1; reason = 'EXACTLY_ONE_ROW'; }",
    '}',
    '',
    '// updated_rows === 1 is the ONLY value that permits the Pipeline path.',
    'return [{ json: Object.assign({}, gate, {',
    '  __updated_rows: updated,',
    '  __claim_ok: updated === 1 ? 1 : 0,',
    '  __claim_reason: reason',
    '}) }];'
  ].join('\n'),
  'P5 §4. Converts item presence into an explicit {ok, updated_rows}. The synthetic empty ' +
  'item from alwaysOutputData is reported as ZERO rows, never as success.'));

NEW_NODES.push(ifNode('IF Claim Won', at('Dedup Guard', 1540, 180),
  '={{ $json.__updated_rows }}', 1,
  'THE gate. Only updated_rows === 1 reaches Pipeline. 0, >1 and unreadable all fail closed.'));

NEW_NODES.push({
  parameters: {
    respondWith: 'json',
    responseCode: 503,
    responseBody: '={{ JSON.stringify({ ok: false, error_code: "SUBMIT_UNRESOLVED", retryable: true, request_id: $json.__correlation_id }) }}'
  },
  id: nid('resp-unresolved'), name: 'Respond Receipt Unresolved',
  type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
  position: at('Dedup Guard', 1760, 320),
  notes: 'Fail-closed. Reached when the claim affected 0 or >1 rows, or the receipt was ' +
    'absent/not READY. NO Pipeline node is reachable from here. Never an ordinary failure ' +
    'that invites a plain retry.'
});

NEW_NODES.push(code('Stop: Receipt Claim Failed', at('Dedup Guard', 1980, 320),
  [
    '// Operator evidence, then stop. The submission key is NEVER logged: it is opaque but',
    '// capability-shaped, and correlation_id is the field that correlates log lines.',
    "const j = $json || {};",
    "throw new Error('RECEIPT_CLAIM_FAILED reason=' + String(j.__claim_reason || j.__receipt_reason || 'UNKNOWN') +",
    "  ' updated_rows=' + String(j.__updated_rows === undefined ? 'n/a' : j.__updated_rows) +",
    "  ' correlation_id=' + String(j.__correlation_id || ''));"
  ].join('\n'),
  'Preserves operator evidence and halts. No raw submission_key in the log line.'));

// ---- the commit chains -----------------------------------------------------------

function commitChain(tag, anchor, dx, dy) {
  // §6 — THE PUBLIC PATH MUST NEVER TOUCH A RECEIPT.
  //
  // This gate is not decoration. Without it the public path reaches the commit node: a public
  // lead flows IF Receipt Required(false) -> IF Is New -> Save to Pipeline, and the commit
  // chain hangs off Save to Pipeline, so a website lead would issue a conditional update
  // against the receipt table. It would affect zero rows and therefore create nothing — but
  // it is still a receipt READ on behalf of an untrusted caller, and the failure branch would
  // then answer a public request with SUBMIT_UNRESOLVED, which is an existence oracle for
  // anyone able to shape the request. Caught by the candidate reachability test, not by
  // review.
  const active = ifNode('IF Receipt Active (' + tag + ')', at(anchor, dx - 220, dy),
    "={{ $('Receipt Gate').first().json.__receipt_required }}", 1,
    '§6 gate. false = public/ordinary path: respond WITHOUT touching the receipt table.');

  const commit = {
    parameters: {
      resource: 'row', operation: 'update', dataTableId: TABLE,
      matchType: 'allConditions',
      filters: {
        conditions: [
          { keyName: 'submission_key', condition: 'eq', keyValue: "={{ $('Receipt Gate').first().json.__submission_key }}" },
          { keyName: 'commit_state', condition: 'eq', keyValue: 'IN_FLIGHT' }
        ]
      },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          commit_state: 'COMMITTED',
          canonical_lead_id: "={{ $('Normalize + Score Lead').first().json.lead_id }}",
          lead_mode: tag === 'Merge' ? 'merged' : 'new',
          lead_priority: "={{ $('Normalize + Score Lead').first().json.priority }}",
          financial_zone: "={{ $('Normalize + Score Lead').first().json.financial_zone }}",
          settled_at: '={{ $now.toISO() }}'
        },
        schema: ['commit_state', 'canonical_lead_id', 'lead_mode', 'lead_priority', 'financial_zone', 'settled_at']
          .map((c) => ({
            id: c, displayName: c, required: false, defaultMatch: false, display: true,
            type: 'string', canBeUsedToMatch: true
          }))
      }
    },
    id: nid('commit'), name: 'Receipt Commit (' + tag + ')',
    type: 'n8n-nodes-base.dataTable', typeVersion: 1.1,
    position: at(anchor, dx, dy),
    alwaysOutputData: true,
    notes: 'IN_FLIGHT -> COMMITTED CAS. correlation_id is NOT in the set: it was written by ' +
      'the winning claim and is immutable (P1-L9). alwaysOutputData for the same zero-item ' +
      'reason as the claim.'
  };

  const verdict = code('Commit Verdict (' + tag + ')', at(anchor, dx + 220, dy),
    [
      '// Same zero-item discriminator as the claim. A commit that affected zero rows means',
      '// the receipt is no longer IN_FLIGHT — so the Pipeline write happened but the ledger',
      '// did not record it. That is UNRESOLVED, never an ordinary success.',
      "const gate = $('Receipt Gate').first().json;",
      'const key = String(gate.__submission_key || \'\');',
      'const items = $input.all();',
      'let updated = 0;',
      'if (items.length === 1) {',
      '  const row = (items[0] && items[0].json) || {};',
      "  const stored = String(row.submission_key || '').trim();",
      '  updated = (stored !== \'\' && stored === key) ? 1 : 0;',
      '} else if (items.length > 1) {',
      '  updated = items.length;',
      '}',
      'return [{ json: Object.assign({}, gate, {',
      '  __commit_updated_rows: updated,',
      '  __commit_ok: updated === 1 ? 1 : 0',
      '}) }];'
    ].join('\n'),
    'Pipeline succeeded but commit CAS !== 1 must NOT report ordinary success.');

  const gate = ifNode('IF Committed (' + tag + ')', at(anchor, dx + 440, dy),
    '={{ $json.__commit_updated_rows }}', 1,
    'Only exactly one committed row permits the success response.');

  return [active, commit, verdict, gate];
}

const COMMIT_NEW = commitChain('New', 'Save to Pipeline', 0, 300);
const COMMIT_RETRY = commitChain('Retry', 'IF Is Retry', 0, 320);
const COMMIT_MERGE = commitChain('Merge', 'Update Pipeline (Merge)', 0, 300);
NEW_NODES.push(...COMMIT_NEW, ...COMMIT_RETRY, ...COMMIT_MERGE);

// ---------------------------------------------------------------- rewire

const c = wf.connections;
const main = (targets) => ({ main: targets.map((t) => (Array.isArray(t) ? t : [t]).map((n) => ({ node: n, type: 'main', index: 0 }))) });

// Internal entry joins the SAME validation pipeline as the public webhook. One validation
// path, two entries — so the internal route cannot skip a check the public route performs.
c['Internal Auth Entry'] = main([['Internal Route Marker']]);
c['Internal Route Marker'] = main([['Validate Payload']]);

// Dedup Guard now feeds the receipt gate instead of IF Is New directly.
c['Dedup Guard'] = main([['Receipt Gate']]);
c['Receipt Gate'] = main([['IF Receipt Required']]);
// true -> critical section; false -> straight to the ordinary flow, receipt untouched.
c['IF Receipt Required'] = main([['Receipt Exact Read'], ['IF Is New']]);
c['Receipt Exact Read'] = main([['Receipt Read Verdict']]);
c['Receipt Read Verdict'] = main([['IF Receipt Claimable']]);
c['IF Receipt Claimable'] = main([['Receipt Claim'], ['Respond Receipt Unresolved']]);
c['Receipt Claim'] = main([['Claim Verdict']]);
c['Claim Verdict'] = main([['IF Claim Won']]);
// TRUE rejoins the ordinary flow. FALSE reaches the fail-closed responder and NOTHING else.
c['IF Claim Won'] = main([['IF Is New'], ['Respond Receipt Unresolved']]);
c['Respond Receipt Unresolved'] = main([['Stop: Receipt Claim Failed']]);

// Commit before responding, on all three lead-id-returning outcomes.
// Each outcome routes through its §6 gate first: receipt active -> commit, otherwise respond
// directly, leaving the receipt table untouched by the public path.
c['Save to Pipeline'] = { main: [
  [{ node: 'IF Receipt Active (New)', type: 'main', index: 0 }],
  [{ node: 'Respond Pipeline Failed', type: 'main', index: 0 }]
] };
c['IF Receipt Active (New)'] = main([['Receipt Commit (New)'], ['Respond New Lead']]);
c['Receipt Commit (New)'] = main([['Commit Verdict (New)']]);
c['Commit Verdict (New)'] = main([['IF Committed (New)']]);
c['IF Committed (New)'] = main([['Respond New Lead'], ['Respond Receipt Unresolved']]);

c['IF Is Retry'] = main([['IF Receipt Active (Retry)'], ['Build Merge Update']]);
c['IF Receipt Active (Retry)'] = main([['Receipt Commit (Retry)'], ['Respond Retry']]);
c['Receipt Commit (Retry)'] = main([['Commit Verdict (Retry)']]);
c['Commit Verdict (Retry)'] = main([['IF Committed (Retry)']]);
c['IF Committed (Retry)'] = main([['Respond Retry'], ['Respond Receipt Unresolved']]);

c['Update Pipeline (Merge)'] = { main: [
  [{ node: 'IF Receipt Active (Merge)', type: 'main', index: 0 }],
  [{ node: 'Respond Merge Failed', type: 'main', index: 0 }]
] };
c['IF Receipt Active (Merge)'] = main([['Receipt Commit (Merge)'], ['Respond Merged']]);
c['Receipt Commit (Merge)'] = main([['Commit Verdict (Merge)']]);
c['Commit Verdict (Merge)'] = main([['IF Committed (Merge)']]);
c['IF Committed (Merge)'] = main([['Respond Merged'], ['Respond Receipt Unresolved']]);

wf.nodes.push(...NEW_NODES);

wf.name = 'FINMENTOR Lead Intake B21C RECEIPT CANDIDATE';
wf.meta = Object.assign({}, wf.meta, {
  finmentor_candidate: 'B.2.1-C P5 MODEL B receipt critical section',
  finmentor_source_export: 'QmIyEW2ZEqKregmN.finmentor-lead-intake-premium-final.json',
  finmentor_generated_by: 'scripts/build-lead-intake-receipt-candidate.mjs',
  finmentor_not_deployed: true
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');

console.log('candidate written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes: ' + wf.nodes.length + ' (was ' + (wf.nodes.length - NEW_NODES.length) + ', +' + NEW_NODES.length + ')');
