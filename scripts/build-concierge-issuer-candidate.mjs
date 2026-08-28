#!/usr/bin/env node
// FINMENTOR — build the B.2.1-C P7.2 Concierge candidate with the ISSUER half spliced in.
//
//   node scripts/build-concierge-issuer-candidate.mjs
//
// REPO-ONLY. Reads the tracked production export and WRITES A NEW FILE under n8n/candidate/.
// It never contacts n8n, never mutates the production export, never touches a live workflow.
//
// Why a generator rather than a hand-edited JSON: the Concierge is a 33-node graph on the path
// of every Telegram update. Hand-editing it would make the interesting part — where the mint
// goes, which turns preallocate, and exactly which branch is allowed to reach Save Bot Session
// — the hardest thing to see. As code the splice is reviewable, regenerable and diffable, and
// every anchor it depends on fails loudly if production drifts.
//
// ================================ WHAT P7.2 IS ================================
//
// G1 closed at P6.4: the receipt substrate is proven live end to end. P6.4 §6 recorded the gap
// it could not close — the live Concierge contains ZERO nodes referencing submission_key, so it
// does not mint or persist one at cycle issuance. The consumer is finished; the PRODUCER does
// not exist. This builds it.
//
// P7.0 §5 listed five steps. P7.1 measured the first two against the real sheet and removed
// them: F14 was REFUTED (the production read range already covers submission_key, and widening
// it would be an avoidable edit to a node every update passes through) and F15 was CLOSED
// (autoMapInputData persisted all four B.2.1-C columns). Steps 3, 4 and 5 are what remains, and
// they are T1..T6 below.
//
// ================================ THE SHAPE ================================
//
// Existing nodes in [], new nodes in <>.
//
//   [IF Message Delivered] true  -> <Issuance Gate> -> <IF Issuance Fault>
//                                      true  -> <Build Issuance Failure Event> -> [Save Bot Event]
//                                      false -> <IF Preallocation Required>
//                                                 false -> [Build Session Row]
//                                                 true  -> <Receipt Preallocate>
//                                                            -> <Receipt Readback>
//                                                            -> <Issuance Verdict>
//                                                            -> <IF Authority May Advance>
//                                                                 true  -> [Build Session Row]
//                                                                 false -> <Build Issuance Failure Event>
//                         false -> [Build Delivery Failure Event]        (unchanged)
//
//   [IF Lead Ready]        true  -> <Authority Reread> -> <Authority Verdict>
//                                     -> <IF Authority Current>
//                                          true  -> [IF Lead Already Sent]
//                                          false -> <Build Stale Authority Event> -> [Save Bot Event]
//                         false -> [Build Bot Event]                     (unchanged)
//
// THE FAIL-CLOSED PROPERTY, stated once so it is not re-derived from the wiring: there is
// exactly ONE inbound edge to [Build Session Row] on which authority may advance without a
// confirmed receipt, and it is the branch where NO receipt was required — CARRY,
// CARRY_MALFORMED and LEGACY_NO_KEY, none of which mints anything. Every MINT reaches
// [Build Session Row] only through <IF Authority May Advance>.
//
// WHY THE SUPPRESSION CASCADE IS DELIBERATE. [Save Bot Session] feeds [IF Lead Ready], so a
// fail-closed issuance also suppresses the lead handoff for that turn. That is the point: a
// lead sent for a cycle that no authority row names would land in the CRM carrying a cycle_id
// that does not exist in Bot_Sessions.
//
// WHY THIS ADDS NO NEW CLASS OF HARM. A turn that persists nothing already exists in this
// graph — [Build Delivery Failure Event] discards a proposed session on every failed send, and
// [Build Bot Event] even carries a `session_save_failed` detail for the case where the Sheets
// write itself fails. planIssuance() is explicit that keeping the OLD cycle current beats
// advancing to a cycle with no receipt behind it: every submit on a half-advanced row (new
// cycle_id, no submission_key) is PRE_ACTIVATION_BLOCKED, which locks the user out of a cycle
// that looks current.
//
// ================================ WHAT IS NOT TOUCHED ================================
//
// No credential-bearing node is MODIFIED. Every googleSheets, telegram, httpRequest and
// executeWorkflow node inherited from production comes through byte-identical — including
// [Save Bot Session] with its A:AV sibling read, its autoMapInputData mode and its 40-entry
// stored schema, all three of which P7.1 proved are ALREADY CORRECT for this write. The safest
// change to a live graph is the one not made.
//
// Two credential-bearing nodes are ADDED, and the distinction is not a technicality: <Receipt
// Preallocate> and <Receipt Readback> reach the Data Table, and <Authority Reread> is a verbatim
// copy of [Read Bot Sessions] pointed at the same document with the same credential. A copy
// rather than a variant, so the two reads cannot disagree about what the sheet looks like. The
// operational cost is one extra Bot_Sessions read per LEAD-READY turn — not per message.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// FROZEN, not the tracked reference. This generator splices Model B into the export P7.5R was
// built from, and that export is a fact about the past. The tracked reference under
// n8n/production/ advances on every seal -- it is `A` in `R(L) == A` and must describe current
// production -- so reading it here made regeneration depend on how many cutovers had happened
// since. See n8n/history/README.md.
const SOURCE = join(ROOT, 'n8n/history/mppzthlkSJFr6Kle.pre-P7-5R-cutover.json');
const OUT_DIR = join(ROOT, 'n8n/candidate');
const OUT = join(OUT_DIR, 'concierge-issuer-candidate.json');

// Referenced BY NAME, exactly as the P5.1 receipt candidate does. Both artifacts must resolve
// to the same table, and a baked id would make that agreement invisible.
const TABLE = { __rl: true, mode: 'name', value: 'Submission_Receipts' };

const wf = JSON.parse(readFileSync(SOURCE, 'utf8'));

function nodeByName(name) {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) { throw new Error('anchor node missing from production export: ' + name); }
  return n;
}

// Fail loudly if the production graph is not the shape this splice assumes.
[
  'Get Bot Session', 'Find Session', 'Read Bot Sessions', 'Parse Telegram Update',
  'Build Bot Response', 'Send Client Message', 'IF Message Delivered', 'Build Session Row',
  'Save Bot Session', 'Save Bot Event', 'Build Delivery Failure Event', 'IF Lead Ready',
  'Parse Intake Response', 'Build Intake State Row', 'Build Confirmation State Row'
].forEach(nodeByName);

// Anchored string surgery. A splice that silently no-ops is worse than one that crashes: the
// candidate would look generated and carry none of the logic. Every replacement asserts its
// anchor occurs EXACTLY ONCE.
function spliceCode(nodeName, anchor, replacement) {
  const n = nodeByName(nodeName);
  const js = n.parameters.jsCode;
  const parts = js.split(anchor);
  if (parts.length !== 2) {
    throw new Error(nodeName + ': anchor occurs ' + (parts.length - 1) + ' times, expected exactly 1 -> ' + anchor.slice(0, 60));
  }
  n.parameters.jsCode = parts[0] + replacement + parts[1];
}

let idSeq = 0;
const nid = (slug) => 'p72-' + String(++idSeq).padStart(2, '0') + '-' + slug;

const NEW_NODES = [];
const add = (n) => { NEW_NODES.push(n); return n; };

function code(name, position, jsCode, notes) {
  return {
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: jsCode },
    id: nid('code'), name: name, type: 'n8n-nodes-base.code', typeVersion: 2,
    position: position, notes: notes
  };
}

// The IF style is lifted from the graph it is joining. [IF Message Delivered] compares
// `String($json.ok)` to the STRING 'true' rather than trusting strict boolean typeValidation,
// and every new IF here does the same, for the same reason and so the graph reads as one.
function ifTrue(name, position, path, notes) {
  return {
    parameters: {
      conditions: {
        combinator: 'and',
        conditions: [{
          id: nid('cond'),
          leftValue: '={{ String($json.' + path + ') }}',
          operator: { name: 'filter.operator.equals', operation: 'equals', type: 'string' },
          rightValue: 'true'
        }],
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 }
      },
      options: {}
    },
    id: nid('if'), name: name, type: 'n8n-nodes-base.if', typeVersion: 2.3,
    position: position, notes: notes
  };
}

function dtField(id) {
  return { id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true };
}

// ================================================================ T1 — the mint

// Captured BEFORE the gate mutates `s`. decideIssuance() reads the PERSISTED key and the
// PERSISTED cycle; reading them after `s.cycle_id = cycleId` would let the decision see a value
// this very node just produced, which is how a "legacy row" quietly becomes a "new cycle".
const T1_CAPTURE = `
// ============ B.2.1-C P7.2 — ISSUANCE INPUTS, CAPTURED BEFORE THIS GATE MUTATES s ============
const persistedSubmissionKey = str(s.submission_key);
const persistedCycleIdAtEntry = str(s.cycle_id);`;

const T1_ISSUANCE = `

// ================ B.2.1-C P7.2 — SUBMISSION KEY ISSUANCE (ISSUANCE_ORDER step 1) ================
//
// The deployed form of decideIssuance() in n8n/src/concierge-issuer/mint-submission-key.js.
// The module is the GATED statement of this logic; qa/concierge-issuer-candidate.test.mjs
// drives both against one table of cases, so the two cannot drift apart silently.
//
// THE PRIMITIVE. require('crypto').randomBytes is the ONLY entropy source that answers in this
// sandbox: execution 3651 measured "typeof crypto === undefined" on this tenant. Writing the
// modern reflex (crypto.getRandomValues) or the specification's literal (crypto.randomBytes)
// here is not a degraded feature — it is a ReferenceError inside the node that every Telegram
// update passes through, i.e. a bot that stops answering /start for every user.
//
// THE FAILURE POSTURE. The mint is wrapped, and that wrapper is load-bearing. This node runs
// BEFORE the reply is composed, so an exception here costs the user their message. A mint that
// throws degrades to MINT_FAILED: the turn still answers, and it is the GRAPH that refuses to
// persist the new cycle. planIssuance() is explicit about why that refusal is the safe half — a
// half-advanced authority row (new cycle_id, no submission_key) makes every submit
// PRE_ACTIVATION_BLOCKED, locking the user out of a cycle that looks current.
//
// NEVER_BACKFILL. A cycle that exists without a key is NEVER given one retroactively. A legacy
// cycle may already have submitted — lead_id set, CRM row written — and a fresh READY receipt is
// positive evidence to the gateway that it has NOT, releasing a second attempt for a lead that
// is already in the pipeline. Cost of refusing: one restart. Cost of backfilling: a duplicate
// lead.
//
// The four annotations below are __-prefixed on purpose. They are decision metadata, not sheet
// columns, and F16 proved that a stray property reaching Save Bot Session does not vanish — it
// permanently widens Bot_Sessions. The three row builders emit their declared COLS only, and the
// prefix makes it visible at a glance that these were never candidates for that list.
const SUBMISSION_KEY_RE = /^sub_[0-9a-f]{32}$/;
function mintSubmissionKey() {
  const buf = require('crypto').randomBytes(16);
  if (!buf || typeof buf.length !== 'number' || buf.length !== 16) { throw new Error('randomBytes did not return 16 bytes'); }
  let hex = '';
  for (let i = 0; i < 16; i++) {
    const b = buf[i];
    if (typeof b !== 'number' || !isFinite(b) || b < 0 || b > 255 || (b | 0) !== b) { throw new Error('randomBytes returned a non-byte at index ' + i); }
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  const k = 'sub_' + hex;
  if (!SUBMISSION_KEY_RE.test(k)) { throw new Error('minted key failed the format rule'); }
  return k;
}

let keyAction = '';
let keyReason = '';
let keyPreallocate = false;
if (reset !== '') {
  // A key is minted IF AND ONLY IF a new cycle is minted. Anything else desynchronises the pair
  // Bot_Sessions carries, and the gateway's SUBMISSION_KEY_DRIFT check exists precisely because
  // that pair must move together or not at all.
  try {
    s.submission_key = mintSubmissionKey();
    keyAction = 'MINT';
    keyReason = 'NEW_CYCLE_' + reset.toUpperCase();
    keyPreallocate = true;
  } catch (e) {
    s.submission_key = '';
    keyAction = 'MINT_FAILED';
    keyReason = 'MINT_THREW:' + String((e && e.message) || e).slice(0, 120);
  }
} else if (SUBMISSION_KEY_RE.test(persistedSubmissionKey)) {
  s.submission_key = persistedSubmissionKey;
  keyAction = 'CARRY';
  keyReason = 'CYCLE_UNCHANGED';
} else if (persistedSubmissionKey !== '') {
  // Carried UNCHANGED and never repaired. The gateway already refuses a malformed key
  // (SUBMISSION_KEY_INVALID, proven live); blanking it here would destroy the only evidence
  // that the row is corrupt while producing the identical refusal. The issuer reports; it does
  // not launder.
  s.submission_key = persistedSubmissionKey;
  keyAction = 'CARRY_MALFORMED';
  keyReason = 'KEY_MALFORMED_NOT_REPAIRED';
} else {
  s.submission_key = '';
  keyAction = 'LEGACY_NO_KEY';
  keyReason = persistedCycleIdAtEntry !== '' ? 'LEGACY_CYCLE_NOT_BACKFILLED' : 'NO_CYCLE_NO_KEY';
}
s.__submission_key_action = keyAction;
s.__submission_key_reason = keyReason;
s.__submission_key_preallocate = keyPreallocate;
s.__submission_key_fault = keyAction === 'MINT_FAILED';`;

spliceCode('Get Bot Session', "const str = v => String(v == null ? '' : v).trim();",
  "const str = v => String(v == null ? '' : v).trim();" + T1_CAPTURE);
spliceCode('Get Bot Session', 's.cycle_reset = reset;', 's.cycle_reset = reset;' + T1_ISSUANCE);

// ================================================================ T2..T4 — the row builders

// All THREE builders persist a full Bot_Sessions row through the same appendOrUpdate node, so a
// builder that omits the column BLANKS whatever the previous save wrote. They gain it together
// or not at all — this is the failure P7.0 §5 step 4 named, and the generator makes "together"
// structural by refusing to run if any anchor is missing.
const BUILDER_COLS_ANCHOR = "'previous_lead_id']";
const BUILDER_COLS_REPLACEMENT = "'previous_lead_id','submission_key']";

const REATTACH = (why) => `
// P7.2 — ${why}
// Re-attached FROM THE CYCLE GATE, exactly like the cycle fields, and for the same reason: the
// value is decided in one place and every writer reads it from there.
let g72 = {};
try { g72 = $('Get Bot Session').first().json || {}; } catch (e) { g72 = {}; }
s.submission_key = String(g72.submission_key == null ? '' : g72.submission_key).trim();`;

// Build Session Row already holds the cycle gate as `g`, so it re-attaches inline beside the
// other cycle fields rather than re-reading the node.
//
// F7 BINDING. On a minting turn the value written to AUTHORITY is the key the readback
// VERIFIED, not the key the gate proposed. The two are equal by construction, and that is
// precisely why taking the verified one costs nothing and buys something: the authority write
// consumes the verifier's output, so "authority advanced without a confirmed receipt" stops
// being a rule someone must remember about the wiring and becomes a data dependency. On a carry
// there is no verdict node in the run, $('Issuance Verdict') throws, and the gate's key is the
// only key there ever was.
spliceCode('Build Session Row', 's.lead_intake_ok = str(g.lead_intake_ok);',
  's.lead_intake_ok = str(g.lead_intake_ok);\n' +
  '// P7.2 — the key rides with the cycle fields for the same reason they are here: the state\n' +
  "// machine's baseSession() does not carry it, so it must come from the gate that decided it.\n" +
  '// F7: when this turn minted, the value written is the one the READBACK VERIFIED.\n' +
  "let verifiedKey72 = '';\n" +
  "try {\n" +
  "  const v72 = $('Issuance Verdict').first().json || {};\n" +
  "  if (v72.__advance === true) { verifiedKey72 = String(v72.__verified_submission_key || ''); }\n" +
  "} catch (e) { verifiedKey72 = ''; }\n" +
  's.submission_key = verifiedKey72 || str(g.submission_key);');

// The canonical empty session handed to a chat with no row yet. It enumerates the persisted
// shape field by field, so the column the three builders now write belongs in it: an absent
// property and an empty one both read as '' downstream, but only one of them says so.
spliceCode('Find Session', "  previous_lead_id: ''\n} }];",
  "  previous_lead_id: '',\n  submission_key: ''\n} }];");

// This builder read the upstream session object directly. It is copied first, so re-attaching
// the key cannot mutate the item Parse Intake Response still holds.
spliceCode('Build Intake State Row', 'const s = $input.first().json.session || {};',
  'const s = Object.assign({}, $input.first().json.session || {});' +
  REATTACH('Parse Intake Response builds its session from the state machine, which has no key.'));

spliceCode('Build Confirmation State Row',
  "s.notes = note(s.notes, delivered ? 'confirmation_delivered' : 'confirmation_failed');",
  "s.notes = note(s.notes, delivered ? 'confirmation_delivered' : 'confirmation_failed');" +
  REATTACH('`base` may come from Parse Intake Response, which does not carry the key.'));

['Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row']
  .forEach((n) => spliceCode(n, BUILDER_COLS_ANCHOR, BUILDER_COLS_REPLACEMENT));

// ================================================================ T5 — the new nodes

const IMD = nodeByName('IF Message Delivered').position;
const at = (dx, dy) => [IMD[0] + dx, IMD[1] + dy];

add(code('Issuance Gate', at(-20, 380), `// B.2.1-C P7.2 — the issuance gate.
//
// Reached only after IF Message Delivered confirmed ok === true. It does NOT re-decide: the
// cycle gate already made the decision, and a second decision site is a second thing to drift.
// What it does is re-prove the one precondition an INSERT must never run without — a
// well-formed key — and name the fault when there is one.
const g = $('Get Bot Session').first().json || {};
const p = $('Parse Telegram Update').first().json || {};
const t = $input.first().json || {};
const str = v => String(v == null ? '' : v).trim();

const key = str(g.submission_key);
const action = str(g.__submission_key_action);
const wellFormed = /^sub_[0-9a-f]{32}$/.test(key);
const wants = g.__submission_key_preallocate === true;

// Three independent faults rather than one boolean, so the Bot_Events row says which happened.
//
// NO_ISSUANCE_DECISION is a DRIFT GUARD and it fails closed on purpose. It can only fire if
// this node is running against a Get Bot Session that has no issuance block — i.e. one half of
// this candidate was reverted by hand. Every new cycle would then be persisted with no key,
// which is exactly the half-advanced authority row planIssuance() refuses. A loud stop beats a
// quiet stream of unsubmittable cycles.
let fault = '';
if (g.__submission_key_fault === true || action === 'MINT_FAILED') { fault = 'MINT_FAILED'; }
else if (action === '') { fault = 'NO_ISSUANCE_DECISION'; }
else if (wants && !wellFormed) { fault = 'MINT_UNUSABLE'; }

return [{ json: {
  __submission_key: key,
  __issuance_action: action,
  __issuance_reason: str(g.__submission_key_reason),
  __preallocate: fault === '' && wants,
  __fault: fault !== '',
  __fault_reason: fault,
  __chat_id: str(p.chat_id),
  __correlation_id: str(t.correlation_id)
} }];`,
  'P7.2 issuance gate. Reads the decision the cycle gate made; re-proves the key format before ' +
  'any INSERT. Does not re-decide.'));

add(ifTrue('IF Issuance Fault', at(-240, 380), '__fault',
  'Fail-closed first. A faulted issuance never reaches the preallocation branch and never ' +
  'reaches Save Bot Session.'));

add(ifTrue('IF Preallocation Required', at(-460, 380), '__preallocate',
  'TRUE only for MINT. CARRY / CARRY_MALFORMED / LEGACY_NO_KEY create no receipt, so they ' +
  'rejoin the ordinary flow directly — there is nothing new to confirm.'));

// ISSUANCE_ORDER step 2. An unconditional INSERT, which is all the platform offers and which is
// SAFE precisely because the key is random and minted once: nothing else will ever try to insert
// this key, so there is nothing for insert-if-absent to arbitrate. Uniqueness moved from the
// store to the key generator.
//
// The record is buildPreallocation()'s record, field for field. correlation_id is EMPTY and that
// is not an oversight: a receipt preallocated before any submit attempt exists has no request to
// correlate to, so an id minted here would correlate nothing while looking like it did. The
// winning claim fills it. buildPreallocation() refuses a supplied one outright.
add({
  parameters: {
    resource: 'row',
    operation: 'insert',
    dataTableId: TABLE,
    columns: {
      mappingMode: 'defineBelow',
      matchingColumns: [],
      value: {
        submission_key: "={{ $('Issuance Gate').first().json.__submission_key }}",
        commit_state: 'READY',
        canonical_lead_id: '',
        lead_mode: '',
        lead_priority: '',
        financial_zone: '',
        created_at: '={{ $now.toISO() }}',
        claimed_at: '',
        settled_at: '',
        abort_reason: '',
        correlation_id: ''
      },
      schema: [
        'submission_key', 'commit_state', 'canonical_lead_id', 'lead_mode', 'lead_priority',
        'financial_zone', 'created_at', 'claimed_at', 'settled_at', 'abort_reason', 'correlation_id'
      ].map(dtField)
    },
    options: {}
  },
  id: nid('prealloc'), name: 'Receipt Preallocate', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: at(-680, 500),
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
  notes: 'ISSUANCE_ORDER step 2. onError:continueRegularOutput is load-bearing — a store ' +
    'failure must reach the verdict node and fail closed there, not throw at a user whose ' +
    'message has already been delivered.'
});

// ISSUANCE_ORDER step 3. The key comes from Issuance Gate BY NODE REFERENCE, never from $json:
// the insert output is { id, createdAt, updatedAt } and carries no key at all.
add({
  parameters: {
    resource: 'row',
    operation: 'get',
    dataTableId: TABLE,
    matchType: 'allConditions',
    filters: {
      conditions: [{
        keyName: 'submission_key',
        condition: 'eq',
        keyValue: "={{ $('Issuance Gate').first().json.__submission_key }}"
      }]
    },
    returnAll: true
  },
  id: nid('readback'), name: 'Receipt Readback', type: 'n8n-nodes-base.dataTable',
  typeVersion: 1.1, position: at(-900, 500),
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
  notes: 'Exact-key readback. alwaysOutputData so an ABSENT receipt still reaches the verdict ' +
    'instead of silently skipping the branch (P4 zero-item semantics). returnAll so a DUPLICATE ' +
    'is visible rather than truncated to one.'
});

add(code('Issuance Verdict', at(-1120, 500), `// B.2.1-C P7.2 — ISSUANCE_ORDER steps 3-5, deployed form of verifyPreallocationReadback().
//
// WHAT IS AND IS NOT CONFIRMATION. P2 proved this Data Table has NO uniqueness constraint: two
// inserts of one key both succeed and neither errors. So an id in the insert output, an
// insertedCount, a 2xx and the absence of an exception are all reports about the CALL, and none
// of them is evidence about the STATE. Only state can justify advancing authority, so authority
// advances on an exact-key readback whose CARDINALITY and CONTENT are both checked, or not at
// all. There is no partial credit and no probably-fine branch.
//
// THE ZERO-ITEM DISCRIMINATOR. Receipt Readback carries alwaysOutputData, which is load-bearing:
// P4 proved a zero-match returns main[0] === [] and skips every downstream node, so without it
// the fail-closed branch could never run. The cost is that "no match" arrives as ONE EMPTY ITEM,
// and an empty item is not a row. It is discriminated by KEY COUNT — never by truthiness, which
// an empty object passes, and never by try/catch, which never fires.
const gate = $('Issuance Gate').first().json || {};
const key = gate.__submission_key;
const norm = v => String(v == null ? '' : v).trim();

let insert = {};
try { insert = $('Receipt Preallocate').first().json || {}; } catch (e) { insert = {}; }
const insertErrored = !!(insert.error || insert.errorMessage);

const raw = $input.all().map(i => i.json).filter(r => r && typeof r === 'object' && !Array.isArray(r));
const storeError = raw.some(r => r.error || r.errorMessage);
const rows = raw.filter(r => Object.keys(r).length > 0 && !r.error && !r.errorMessage);

function refuse(reason, extra) {
  return [{ json: Object.assign({
    __advance: false,
    __reason: reason,
    __verified_submission_key: '',
    __rows_seen: rows.length,
    __insert_errored: insertErrored
  }, extra || {}) }];
}

if (!/^sub_[0-9a-f]{32}$/.test(norm(key))) { return refuse('SUBMISSION_KEY_INVALID'); }
// "We could not look" and "it is there" must never collapse into one outcome.
if (storeError) { return refuse('READBACK_STORE_ERROR'); }

// RAW exact equality, deliberately not a trim. A trim is a REPAIR, and a MODEL B key is an
// opaque server-minted value: a stored "sub_...abc " is not the same key with a stray space, it
// is evidence that something wrote a value the minter never produced or that the store is
// mangling what it holds. Trimming it into a match is how a corrupted row reaches authority.
for (let i = 0; i < rows.length; i++) {
  const stored = rows[i].submission_key;
  if (typeof stored !== 'string' || stored !== key) { return refuse('READBACK_WRONG_KEY'); }
}
if (rows.length === 0) { return refuse('READBACK_ABSENT'); }
if (rows.length > 1) { return refuse('READBACK_DUPLICATE'); }

const row = rows[0];
if (norm(row.commit_state) !== 'READY') { return refuse('READBACK_WRONG_STATE'); }

// A pristine preallocation carries no settlement residue AND no classification residue. The
// classification fields matter as much as the settlement ones: classifyRows replays lead_mode,
// lead_priority and financial_zone on a COMMITTED read, so a READY row already carrying them
// would arm a replay with a previous submission's classification.
const PRISTINE = ['canonical_lead_id','claimed_at','settled_at','abort_reason','lead_mode','lead_priority','financial_zone'];
const dirty = PRISTINE.filter(f => norm(row[f]) !== '');
if (dirty.length) { return refuse('READBACK_NOT_PRISTINE', { __dirty_fields: dirty.join(',') }); }
// A freshly preallocated receipt has not been claimed, so it cannot yet carry a correlation id.
// A non-empty one means this row is not a pristine preallocation.
if (norm(row.correlation_id) !== '') { return refuse('READBACK_ALREADY_CLAIMED'); }

// created_at must be PRESENT and parseable. A receipt with no creation time cannot be aged for
// retention and cannot be ordered against anything, and an unparseable one is a row nobody wrote
// through buildPreallocation. Checked, never repaired: substituting a default would hide the
// write that produced it.
const createdAt = row.created_at;
if (typeof createdAt !== 'string' || createdAt.trim() === '') { return refuse('READBACK_CREATED_AT_MISSING'); }
if (!Number.isFinite(Date.parse(createdAt))) { return refuse('READBACK_CREATED_AT_INVALID'); }

// The verdict NAMES the key it verified, so the authority write is bound to THIS issuance
// structurally rather than by trusting the branch it arrived on.
return [{ json: {
  __advance: true,
  __reason: 'PREALLOCATION_CONFIRMED',
  __verified_submission_key: key,
  __rows_seen: rows.length,
  __insert_errored: insertErrored
} }];`,
  'ISSUANCE_ORDER steps 3-5. Cardinality AND content. An insert that returned success is not ' +
  'confirmation, because the store cannot refuse a second row for the same key.'));

add(ifTrue('IF Authority May Advance', at(-1340, 500), '__advance',
  'ISSUANCE_ORDER step 6. The ONLY edge on which a minted cycle may reach Save Bot Session.'));

add(code('Build Issuance Failure Event', at(-460, 700), `// B.2.1-C P7.2 — the fail-closed terminal, reached from EITHER the fault branch or the readback
// verdict.
//
// The turn persists NOTHING to Bot_Sessions, and that is the whole point. It is not a new class
// of harm: Build Delivery Failure Event beside it already discards a proposed session on every
// failed send. planIssuance() is explicit that keeping the OLD cycle current beats advancing to
// a cycle with no receipt behind it — every submit on a half-advanced row is
// PRE_ACTIVATION_BLOCKED, which locks the user out of a cycle that looks current.
//
// Because Save Bot Session does not run, IF Lead Ready downstream of it does not run either, so
// no lead is handed to Intake for a cycle that no authority row names. That suppression is
// deliberate, not a side effect.
//
// THE KEY ITSELF IS NEVER LOGGED. A submission_key is a capability: whoever holds it can claim
// the receipt. Bot_Events is a spreadsheet with wider read access than the Data Table, so this
// row records only whether a key was PRESENT.
//
// F16: Bot_Events is written with autoMapInputData and an EMPTY stored schema, so a stray
// property here would permanently widen the live sheet. The key set below is exactly the one
// Build Bot Event and Build Delivery Failure Event already emit — twelve, no more.
const p = $('Parse Telegram Update').first().json;
const b = $('Build Bot Response').first().json;
const d = b.debug || {};
const gate = $('Issuance Gate').first().json || {};
let v = {};
try { v = $('Issuance Verdict').first().json || {}; } catch (e) { v = {}; }
const reason = String(v.__reason || gate.__fault_reason || 'ISSUANCE_UNCONFIRMED');
return [{ json: {
  event_id: \`\${p.chat_id}-\${Date.now()}\`,
  ts: new Date().toISOString(),
  chat_id: String(p.chat_id || ''),
  user_id: String(p.user_id || ''),
  username: String(p.username || ''),
  event_type: p.is_callback ? 'callback_received' : 'message_received',
  state_before: String(d.state_before || ''),
  state_after: String(d.state_before || ''),
  message_text: String(p.message_text || '').slice(0, 500),
  callback_data: String(p.callback_data || ''),
  detail: 'issuance_unconfirmed: ' + reason,
  raw_json: JSON.stringify({
    issuance_action: gate.__issuance_action || '',
    issuance_reason: gate.__issuance_reason || '',
    fault_reason: gate.__fault_reason || '',
    readback_reason: v.__reason || '',
    rows_seen: v.__rows_seen === undefined ? null : v.__rows_seen,
    insert_errored: v.__insert_errored === true,
    dirty_fields: v.__dirty_fields || '',
    proposed_state_discarded: d.state_after || '',
    submission_key_present: String(gate.__submission_key || '') !== ''
  }).slice(0, 4000)
} }];`,
  'Fail-closed terminal. The proposed session is discarded; the OLD cycle stays authoritative. ' +
  'The key value is never written to Bot_Events.'));

// ================================================================ T7 — the post-authority reread

// THE PROBLEM THIS CLOSES, stated before the nodes that close it.
//
// Bot_Sessions is written with appendOrUpdate. That is LAST-WRITE-WINS and there is no
// compare-and-set. PREALLOCATION_INVARIANT already says so plainly — concurrent issuers each
// mint their own key, both may persist, and "the ledger never decides who won"; only
// Bot_Sessions names the authoritative key. The corollary is what this section is for: a turn
// that WROTE the authority row is not thereby the WINNER. Another execution for the same chat
// may have written after it, and this turn is then holding an orphan.
//
// WHERE THE REFUSAL HAS TEETH. On exactly one edge: the lead handoff. A lead sent to Intake
// under a submission_key that is no longer current lands in the CRM stamped with a cycle_id
// Bot_Sessions does not name, and the receipt behind it can never be claimed — the gateway
// reads the CURRENT authority row and finds a different key. Everything else a losing turn does
// is already harmless: its receipt is an orphan, and an orphan cannot make itself authority.
//
// WHY IT SITS AFTER [IF Lead Ready] AND NOT AFTER [Save Bot Session]. Two reasons, and the
// second is the one that decided it. First, cost: this is a second full Bot_Sessions read, and
// on the [Save Bot Session] edge it would run on every delivered turn rather than on the rare
// turn that is about to hand a lead to the CRM. Second, and more important: on a MINTING turn
// the lead path is not taken at all — a reset clears consent, and lead_ready requires a
// current-cycle consent — so a refusal placed there would have nothing left to refuse. It would
// be a check that reads well and prevents nothing.
const READ_BOT_SESSIONS = nodeByName('Read Bot Sessions');

add(Object.assign(JSON.parse(JSON.stringify(READ_BOT_SESSIONS)), {
  id: nid('reread'),
  name: 'Authority Reread',
  position: [nodeByName('IF Lead Ready').position[0] + 60, nodeByName('IF Lead Ready').position[1] + 300],
  notes: 'Post-authority reread. Parameters are a VERBATIM copy of Read Bot Sessions — same ' +
    'document, same A:AV range, same credential — so the two reads cannot disagree about what ' +
    'the sheet looks like.'
}));

add(code('Authority Verdict',
  [nodeByName('IF Lead Ready').position[0] - 160, nodeByName('IF Lead Ready').position[1] + 300],
  `// B.2.1-C P7.2 — the stale-loser refusal.
//
// A concurrent winner and a lagging read look identical if you only ask "does the row match?".
// They are told apart here by the one property that makes cycle_id weak: it is time-derived,
// C-<chat_id>-<ms>. A row that names a NEWER cycle than the one this turn holds is a genuine
// concurrent winner. A row that names an OLDER one is this turn's own write not yet visible,
// which is read lag and not a loss — refusing there would drop a real lead to protect against
// nothing.
//
// The same-millisecond case is exactly the collision P3 flagged: two issuances in one
// millisecond produce the IDENTICAL cycle_id, so the stamps cannot separate them. The KEY can,
// and does — equal cycle, different key means the other issuer won inside that millisecond.
//
// WHAT THIS DOES NOT DO. It narrows the window; it does not close it. Between this read and the
// Intake call another execution can still win. Closing it needs a compare-and-set the Sheets
// node does not offer (P4 explored precisely that). Stated here rather than implied, because a
// partial check believed to be total is worse than one known to be partial.
const p = $('Parse Telegram Update').first().json;
const g = $('Get Bot Session').first().json || {};
const str = v => String(v == null ? '' : v).trim();
const target = str(p.chat_id);

const rows = $input.all().map(i => i.json).filter(r => r && r.chat_id !== undefined && String(r.chat_id).trim() !== '');
let current = null;
for (const r of rows) { if (String(r.chat_id) === target) { current = r; break; } }

const heldCycle = str(g.cycle_id);
const heldKey = str(g.submission_key);

// Parsed against the EXACT shape the cycle gate mints — 'C-' + chat_id + '-' + Date.now() — and
// nothing looser. An earlier form of this took the trailing run of digits and required ten or
// more of them, and that threshold was a latent fail-open: any cycle_id that did not match it
// stamped as NaN, and NaN fell through to "lagged", which PROCEEDS. Values that do not match are
// not hypothetical — scripts/p71-sheet-probe.ps1 wrote C-900000701-P71 into the real sheet, and
// scripts/build-cas-gate-workflow.mjs writes C-900, which has no stamp segment at all.
function stamp(cid) {
  const m = /^C-\\d+-(\\d+)$/.exec(String(cid == null ? '' : cid));
  return m ? Number(m[1]) : NaN;
}
function verdict(ok, reason, currentCycle, currentKeyPresent) {
  return [{ json: {
    __current: ok,
    __reason: reason,
    __held_cycle_id: heldCycle,
    __current_cycle_id: currentCycle,
    __held_key_present: heldKey !== '',
    __current_key_present: currentKeyPresent
  } }];
}

// An unreadable authority row is NOT a pass. "We could not look" and "we are still current"
// must never collapse into one outcome — the rule the readback verdict already follows. A
// lead-ready turn always has a pre-existing row, because lead_ready needs a consent from an
// earlier turn, so an absent row here is anomalous rather than merely early.
if (!current) { return verdict(false, 'AUTHORITY_ROW_ABSENT', '', false); }

const currentCycle = str(current.cycle_id);
const currentKey = str(current.submission_key);
const keyPresent = currentKey !== '';

if (currentCycle === heldCycle) {
  // RAW exact equality, deliberately not a trim-and-compare, for the reason the readback verdict
  // gives: a trim is a repair, and repairing a key promotes a row nobody minted.
  if (currentKey === heldKey) { return verdict(true, 'AUTHORITY_CURRENT', currentCycle, keyPresent); }
  return verdict(false, 'AUTHORITY_KEY_SUPERSEDED', currentCycle, keyPresent);
}

const heldStamp = stamp(heldCycle);
const currentStamp = stamp(currentCycle);

// UNCOMPARABLE IS NOT LAGGED, and this is the whole safety of the branch.
//
// Proceeding requires POSITIVE evidence that the row is this turn's own write not yet visible.
// The only such evidence is a strictly OLDER stamp, and that needs both sides to parse. When
// either side does not, we cannot tell a lagging read from a lost race — and "we could not tell"
// must land where "we could not look" already lands, which is a refusal. The same rule the
// readback verdict follows for READBACK_STORE_ERROR and the row lookup follows for
// AUTHORITY_ROW_ABSENT.
//
// The cost of being wrong here is asymmetric and that is what settles it. A false refusal costs
// the user one restart. A false proceed puts a lead in the CRM stamped with a cycle_id
// Bot_Sessions no longer names, behind a receipt the gateway can never claim, and that is not
// recoverable by the user doing anything at all.
if (!Number.isFinite(heldStamp) || !Number.isFinite(currentStamp)) {
  return verdict(false, 'AUTHORITY_CYCLE_UNCOMPARABLE', currentCycle, keyPresent);
}
if (currentStamp > heldStamp) {
  return verdict(false, 'AUTHORITY_CYCLE_SUPERSEDED', currentCycle, keyPresent);
}

// Strictly older, and both sides parsed. This turn's own write has not become visible yet; the
// cycle it holds is the one it just persisted. Proceed, and say WHICH of the two it was, so a
// run that took this path is not silently indistinguishable from a clean one.
return verdict(true, 'AUTHORITY_READ_LAGGED', currentCycle, keyPresent);`,
  'Tells a concurrent winner apart from a lagging read by the cycle timestamp, and the ' +
  'same-millisecond collision apart by the key. Refuses only on a PROVABLE loss.'));

add(ifTrue('IF Authority Current',
  [nodeByName('IF Lead Ready').position[0] - 380, nodeByName('IF Lead Ready').position[1] + 300],
  '__current',
  'The only edge on which a lead may be handed to Intake. A losing turn ends at the event row.'));

add(code('Build Stale Authority Event',
  [nodeByName('IF Lead Ready').position[0] - 380, nodeByName('IF Lead Ready').position[1] + 520],
  `// B.2.1-C P7.2 — the stale-loser terminal.
//
// This turn wrote the authority row and then lost it to a concurrent execution. The lead is NOT
// handed to Intake: it would be stamped with a cycle_id Bot_Sessions no longer names, and the
// receipt behind it could never be claimed by the gateway, which reads the current row. The
// winning execution owns this chat now, and the user's own next turn runs against its cycle.
//
// The KEY IS NEVER LOGGED — it is a capability, and Bot_Events is a spreadsheet with wider read
// access than the Data Table. The cycle IDS are logged: they are already in the sheet, they name
// nothing on their own, and without them an operator cannot tell a supersede from a lag.
//
// F16: exactly the twelve keys Build Bot Event and Build Delivery Failure Event emit. Bot_Events
// is autoMapInputData over an EMPTY stored schema, so a stray property would permanently widen
// the live sheet.
const p = $('Parse Telegram Update').first().json;
const b = $('Build Bot Response').first().json;
const d = b.debug || {};
const v = $('Authority Verdict').first().json || {};
return [{ json: {
  event_id: \`\${p.chat_id}-\${Date.now()}\`,
  ts: new Date().toISOString(),
  chat_id: String(p.chat_id || ''),
  user_id: String(p.user_id || ''),
  username: String(p.username || ''),
  event_type: p.is_callback ? 'callback_received' : 'message_received',
  state_before: String(d.state_before || ''),
  state_after: String(d.state_after || ''),
  message_text: String(p.message_text || '').slice(0, 500),
  callback_data: String(p.callback_data || ''),
  detail: 'authority_stale: ' + String(v.__reason || 'UNKNOWN'),
  raw_json: JSON.stringify({
    held_cycle_id: v.__held_cycle_id || '',
    current_cycle_id: v.__current_cycle_id || '',
    held_key_present: v.__held_key_present === true,
    current_key_present: v.__current_key_present === true,
    lead_handoff_suppressed: true
  }).slice(0, 4000)
} }];`,
  'Lead handoff refused because this turn lost the authority row. No lead reaches Intake under ' +
  'a key that is no longer current.'));

// ================================================================ T6 — the wiring

const c = wf.connections;
const main = (lists) => ({ main: lists.map((l) => l.map((n) => ({ node: n, type: 'main', index: 0 }))) });

// The single rewired production edge. IF Message Delivered's FALSE output is untouched.
c['IF Message Delivered'] = main([['Issuance Gate'], ['Build Delivery Failure Event']]);

c['Issuance Gate'] = main([['IF Issuance Fault']]);
c['IF Issuance Fault'] = main([['Build Issuance Failure Event'], ['IF Preallocation Required']]);
c['IF Preallocation Required'] = main([['Receipt Preallocate'], ['Build Session Row']]);
c['Receipt Preallocate'] = main([['Receipt Readback']]);
c['Receipt Readback'] = main([['Issuance Verdict']]);
c['Issuance Verdict'] = main([['IF Authority May Advance']]);
c['IF Authority May Advance'] = main([['Build Session Row'], ['Build Issuance Failure Event']]);
c['Build Issuance Failure Event'] = main([['Save Bot Event']]);

// T7. IF Lead Ready's FALSE output is untouched; its TRUE output now passes the reread first.
c['IF Lead Ready'] = main([['Authority Reread'], ['Build Bot Event']]);
c['Authority Reread'] = main([['Authority Verdict']]);
c['Authority Verdict'] = main([['IF Authority Current']]);
c['IF Authority Current'] = main([['IF Lead Already Sent'], ['Build Stale Authority Event']]);
c['Build Stale Authority Event'] = main([['Save Bot Event']]);

wf.nodes.push(...NEW_NODES);

// ================================================================ output

// `activeVersion` is a SECOND FULL COPY of the graph — 33 nodes and their own connections —
// carried by the tenant export. Left in place it would be a shadow copy of the UNSPLICED
// Concierge sitting inside a file whose whole purpose is to state the splice, and every reader
// and every scanner would have to know which of the two graphs is the candidate. A candidate has
// exactly one graph. This is the only non-graph field the generator removes, and it is the only
// place the removal needs to be understood.
delete wf.activeVersion;

wf.name = 'FINMENTOR Telegram Client Concierge B21C ISSUER CANDIDATE';
wf.meta = Object.assign({}, wf.meta, {
  finmentor_candidate: 'B.2.1-C P7.2 issuer splice (mint + preallocation + readback + fail-closed)',
  finmentor_source_export: 'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json',
  finmentor_generated_by: 'scripts/build-concierge-issuer-candidate.mjs',
  finmentor_not_deployed: true,
  // Stated in the artifact itself, not only in the document beside it. This file still carries
  // the LIVE workflow id, active:true and the live Telegram trigger, exactly as the P5.1 receipt
  // candidate does — that faithfulness is what makes it diffable against production, and it is
  // also what makes importing it by hand an overwrite of the running bot.
  finmentor_import_hazard: 'NOT IMPORT-SAFE: carries production id mppzthlkSJFr6Kle, active:true ' +
    'and the live Telegram trigger. An import-safe wrapper is P7.3, as P6.1 was for Lead Intake.',
  finmentor_active_version_stripped: 'the tenant export carries a second full copy of the graph ' +
    'in activeVersion; a candidate has exactly one graph'
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(wf, null, 2) + '\n', 'utf8');

console.log('candidate written: n8n/candidate/' + OUT.split(/[\\/]/).pop());
console.log('  nodes: ' + wf.nodes.length + ' (was ' + (wf.nodes.length - NEW_NODES.length) + ', +' + NEW_NODES.length + ')');
console.log('  new:   ' + NEW_NODES.map((n) => n.name).join(', '));
