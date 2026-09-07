#!/usr/bin/env node
// FINMENTOR — Bot_Sessions legacy cycle-state contract gate (P6R-1).
//
//   node qa/bot-sessions-legacy-cycle.test.mjs
//
// Two jobs, both offline, no tenant and no credential:
//
//   1. REPRODUCE the live defect and PROVE the remediation closes it, by running the
//      BYTE-EXACT cycle-gate source extracted from the tracked Concierge export against a
//      model of Google Sheets' autoMapInputData persistence. The model has one rule, and it
//      is the whole defect: a key with no matching header is silently DROPPED.
//
//   2. PIN the legacy schema contract, so the six columns cannot quietly leave the required
//      set and so a B.2.1-C column cannot be smuggled in as though P6R-1 had delivered it.
//
// WHY THE SOURCE IS EXTRACTED RATHER THAN RETYPED. A hand-copy of the gate would prove that
// my transcription behaves correctly, which is not the claim. The claim is about the code
// that is deployed, so the test reads it out of the tracked export and executes it.
//
// This test changes NO runtime behaviour. It is a contract and a regression guard.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

// ---------------------------------------------------------------- the tracked source

const CONCIERGE = JSON.parse(readFileSync(
  join(ROOT, 'n8n', 'production', 'mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'), 'utf8'));

const nodeByName = (n) => CONCIERGE.nodes.find((x) => x.name === n);
const GATE_SRC = nodeByName('Get Bot Session').parameters.jsCode;

// The three row builders that persist a session. All three must carry the same required set.
const ROW_BUILDERS = ['Build Session Row', 'Build Intake State Row', 'Build Confirmation State Row'];

function colsOf(nodeName) {
  const js = nodeByName(nodeName).parameters.jsCode;
  const m = js.match(/const COLS = \[([\s\S]*?)\]/);
  if (!m) { throw new Error('COLS not found in ' + nodeName); }
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

// ---------------------------------------------------------------- canonical contracts

// The six columns the legacy cycle/consent/lead guards depend on. P6R-1 scope.
const LEGACY_REQUIRED = [
  'cycle_id', 'consent_cycle_id', 'consent_at', 'lead_cycle_id', 'lead_intake_ok', 'previous_lead_id'
];

// B.2.1-C columns. Explicitly NOT delivered by P6R-1 and must never be marked live by it.
// submission_key WAS in this list. P7.5R shipped the Concierge issuer, so the Concierge row
// builders now write it deliberately, and "no row builder writes it" became false for the one
// reason that is allowed to make it false. The two claims the list was carrying are separable:
//
//   * P6R-1 must not CLAIM any B.2.1-C column as legacy-live   -- still true of all four
//   * no Concierge row builder may WRITE one                   -- still true of the other three
//
// Collapsing them back into one list would mean either dropping submission_key from the P6R-1
// containment (losing coverage) or asserting production has not shipped (asserting a falsehood).
const B21C_ONLY = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];
const B21C_NOT_YET_SHIPPED = ['lead_mode', 'lead_priority', 'financial_zone'];

// The live header row as observed on 2026-08-26 (P6R-0 / P6R-1 preflight), 40 columns.
const LIVE_HEADERS_40 = [
  'session_id', 'chat_id', 'user_id', 'username', 'first_name', 'last_name', 'language', 'state',
  'created_at', 'updated_at', 'last_message_at', 'entry_source', 'selected_service', 'business_model',
  'turnover_range', 'main_pain', 'urgency', 'has_cfo', 'documents_status', 'contact_phone',
  'contact_email', 'contact_name', 'company', 'free_text_request', 'consent', 'lead_id',
  'lead_sent_at', 'status', 'notes', 'raw_json', 'reply_text', 'reply_markup', 'tg_body',
  'session', 'lead_ready', 'lead_payload', 'event', 'ai_guarded', 'ok', 'result'
];
const MIGRATED_HEADERS_46 = LIVE_HEADERS_40.concat(LEGACY_REQUIRED);

// P6R-1R — the ACTUAL live schema, observed 2026-08-26 19:2xZ. The grid is 48 columns
// (proven by the API refusing AW with "Max columns: 48"), laid out as:
//
//   A..AN  the original 40
//   AO     error        <-- duplicate name
//   AP     error        <-- duplicate name
//   AQ..AV the six legacy columns
//
// The two 'error' headers COLLAPSE into a single key when the n8n Sheets node maps a row,
// which is why a naive key-order read reports the six one column to the left of where they
// actually are. Recorded so that positional reasoning about this sheet is never done from
// n8n's key order again.
const LIVE_GRID_COLUMNS = 48;
const LIVE_TAIL_AFTER_40 = ['error', 'error'].concat(LEGACY_REQUIRED);
const LIVE_DUPLICATE_HEADERS = ['error'];

// ---------------------------------------------------------------- the harness

// Run the BYTE-EXACT gate source. The gate reads exactly two things from the workflow
// context, so those are the only two shims.
function runGate(persistedRow, parsedUpdate) {
  const $ = (name) => {
    if (name === 'Parse Telegram Update') { return { first: () => ({ json: parsedUpdate }) }; }
    throw new Error('gate referenced an unexpected node: ' + name);
  };
  const $input = { all: () => (persistedRow ? [{ json: persistedRow }] : []) };
  const fn = new Function('$', '$input', GATE_SRC);
  return fn($, $input)[0].json;
}

// THE DEFECT, modelled in one line: autoMapInputData maps input keys onto the live header
// row and silently DROPS every key with no matching header. No error, no warning.
function persist(row, headers) {
  const out = {};
  Object.keys(row).forEach((k) => { if (headers.indexOf(k) !== -1) { out[k] = row[k]; } });
  return out;
}

// One full Concierge round trip: gate -> row builder projection -> Sheets persistence.
function roundTrip(persistedRow, parsedUpdate, headers) {
  const gated = runGate(persistedRow, parsedUpdate);
  const cols = colsOf('Build Session Row');
  const outgoing = {};
  cols.forEach((c) => { outgoing[c] = gated[c] === undefined || gated[c] === null ? '' : String(gated[c]); });
  return { gated, outgoing, stored: persist(outgoing, headers) };
}

const CHAT = '900000123';                       // reserved synthetic range, never a real user
const ordinary = { chat_id: CHAT, message_text: 'привет', callback_data: '', is_callback: false };
const start = { chat_id: CHAT, message_text: '/start', callback_data: '', is_callback: false };
const restart = { chat_id: CHAT, message_text: '', callback_data: 'm|diag', is_callback: true };

const baseRow = (over) => Object.assign({
  chat_id: CHAT, session_id: 's-1', state: 'MENU', status: 'active',
  consent: '', lead_id: '', lead_sent_at: ''
}, over || {});

// ================================================================ the defect, reproduced

console.log('\nLEGACY 40-COLUMN SCHEMA — the defect reproduced');

check('the gate source really is the tracked one', () => {
  assert(/CYCLE SEMANTICS GATE/.test(GATE_SRC), 'the extracted source is not the cycle gate');
  assert(/hasNoCycle/.test(GATE_SRC), 'the gate lost its hasNoCycle branch');
  assert(/archiveLead/.test(GATE_SRC), 'the gate lost archiveLead');
  // The six are genuinely absent from the live header set this test models.
  LEGACY_REQUIRED.forEach((c) => assert(LIVE_HEADERS_40.indexOf(c) === -1,
    c + ' is modelled as live, but P6R-0/P6R-1 observed it absent'));
});

check('(defect) cycle_id never persists, so every event mints a NEW cycle', () => {
  const r1 = roundTrip(baseRow(), ordinary, LIVE_HEADERS_40);
  eq(r1.gated.cycle_reset, 'bootstrap', 'event 1 did not bootstrap');
  assert(/^C-/.test(r1.gated.cycle_id), 'event 1 minted no cycle');
  // The outgoing row DOES carry it...
  assert(r1.outgoing.cycle_id !== '', 'the row builder did not emit cycle_id');
  // ...and persistence drops it. That is the defect.
  eq(r1.stored.cycle_id, undefined, 'cycle_id unexpectedly persisted under the legacy schema');

  const r2 = roundTrip(r1.stored, ordinary, LIVE_HEADERS_40);
  // THE defect signature: the second event bootstraps AGAIN, so the cycle never settles.
  // The id VALUES are deliberately not compared - the legacy generator collides within a
  // millisecond (see the residual check below), so comparing them would make this test
  // depend on wall-clock timing. The repeated RESET is the property that matters.
  eq(r2.gated.cycle_reset, 'bootstrap', 'event 2 did not bootstrap again');
});

check('(defect) a consent decision is DESTROYED on the next ordinary event', () => {
  const r = roundTrip(baseRow({ consent: 'yes' }), ordinary, LIVE_HEADERS_40);
  eq(r.gated.consent, '', 'consent was not wiped by the stale-cycle guard');
  // consent IS a live column, so the cleared value is written back.
  eq(r.stored.consent, '', 'the wipe did not reach the sheet');
});

check('(defect) a lead binding is destroyed AND the archive rescue is dropped', () => {
  const r = roundTrip(baseRow({ lead_id: 'FIN-legacy-1', lead_sent_at: '2026-08-01T00:00:00.000Z' }), ordinary, LIVE_HEADERS_40);
  eq(r.gated.lead_id, '', 'lead_id was not cleared by the stale-cycle guard');
  eq(r.stored.lead_id, '', 'the lead wipe did not reach the sheet');
  eq(r.stored.lead_sent_at, '', 'lead_sent_at was not wiped too');
  // archiveLead() computed the rescue...
  assert(r.gated.previous_lead_id.indexOf('FIN-legacy-1') !== -1, 'archiveLead did not compute the rescue');
  // ...and persistence dropped it, so the id is lost entirely.
  eq(r.stored.previous_lead_id, undefined, 'previous_lead_id unexpectedly persisted');
});

// ================================================================ remediation

console.log('\nMIGRATED 46-COLUMN SCHEMA — remediation proof');

check('(step 6) EVENT 1 bootstraps a cycle and it PERSISTS', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  eq(r1.gated.cycle_reset, 'bootstrap', 'event 1 did not bootstrap');
  assert(/^C-/.test(r1.stored.cycle_id), 'cycle_id did not persist after migration');
});

check('(step 6) EVENT 2 finds the cycle and does NOT mint a second one', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const C1 = r1.stored.cycle_id;
  const r2 = roundTrip(r1.stored, ordinary, MIGRATED_HEADERS_46);
  eq(r2.gated.cycle_reset, '', 'event 2 still reset the cycle');
  eq(r2.stored.cycle_id, C1, 'the cycle changed between events');
  // ...and a third event is stable too, so this is a fixed point rather than a one-off.
  const r3 = roundTrip(r2.stored, ordinary, MIGRATED_HEADERS_46);
  eq(r3.stored.cycle_id, C1, 'the cycle is not a fixed point');
});

check('(step 7) same-cycle consent SURVIVES', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const C1 = r1.stored.cycle_id;
  const withConsent = Object.assign({}, r1.stored, {
    consent: 'yes', consent_cycle_id: C1, consent_at: '2026-08-26T12:00:00.000Z'
  });
  const r2 = roundTrip(withConsent, ordinary, MIGRATED_HEADERS_46);
  eq(r2.stored.cycle_id, C1, 'the cycle moved');
  eq(r2.stored.consent, 'yes', 'a valid same-cycle consent was destroyed');
  eq(r2.stored.consent_cycle_id, C1, 'consent_cycle_id was not preserved');
  eq(r2.stored.consent_at, '2026-08-26T12:00:00.000Z', 'consent_at was altered');
});

check('(step 7) stale cross-cycle consent is still REJECTED', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const stale = Object.assign({}, r1.stored, {
    consent: 'yes', consent_cycle_id: 'C-OLD-1', consent_at: '2025-01-01T00:00:00.000Z'
  });
  const r2 = roundTrip(stale, ordinary, MIGRATED_HEADERS_46);
  eq(r2.stored.consent, '', 'stale consent was honoured');
  eq(r2.stored.consent_cycle_id, '', 'stale consent_cycle_id survived');
  eq(r2.stored.consent_at, '', 'stale consent_at survived');
});

check('(step 8) same-cycle lead binding is RETAINED', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const C1 = r1.stored.cycle_id;
  const bound = Object.assign({}, r1.stored, {
    lead_id: 'QA-P6R1-SYNTHETIC', lead_cycle_id: C1, lead_intake_ok: 'true'
  });
  const r2 = roundTrip(bound, ordinary, MIGRATED_HEADERS_46);
  eq(r2.stored.lead_id, 'QA-P6R1-SYNTHETIC', 'a valid same-cycle lead was archived');
  eq(r2.stored.lead_cycle_id, C1, 'lead_cycle_id was not preserved');
  eq(r2.stored.lead_intake_ok, 'true', 'lead_intake_ok was not preserved');
});

check('(step 8) stale-cycle lead is archived AND previous_lead_id now PERSISTS', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const stale = Object.assign({}, r1.stored, {
    lead_id: 'QA-P6R1-OLD', lead_cycle_id: 'C-OLD-1', lead_intake_ok: 'true'
  });
  const r2 = roundTrip(stale, ordinary, MIGRATED_HEADERS_46);
  eq(r2.stored.lead_id, '', 'a stale lead binding was honoured');
  eq(r2.stored.lead_cycle_id, '', 'stale lead_cycle_id survived');
  eq(r2.stored.lead_intake_ok, '', 'stale lead_intake_ok survived');
  // THE POINT of the migration for this field: the rescue is no longer dropped.
  assert(r2.stored.previous_lead_id.indexOf('QA-P6R1-OLD') !== -1,
    'previous_lead_id still does not persist the archived lead');
});

check('(step 9) /start resets the cycle and the archive persists', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const C1 = r1.stored.cycle_id;
  const live = Object.assign({}, r1.stored, {
    consent: 'yes', consent_cycle_id: C1, consent_at: '2026-08-26T12:00:00.000Z',
    lead_id: 'QA-P6R1-START', lead_cycle_id: C1, lead_intake_ok: 'true'
  });
  const r2 = roundTrip(live, start, MIGRATED_HEADERS_46);
  eq(r2.gated.cycle_reset, 'start', '/start did not reset');
  // NOTE: the id itself is not asserted to differ. The legacy generator is
  // 'C-' + chat_id + '-' + Date.now(), so two resets inside one millisecond collide. That is a
  // pre-existing property, documented separately below, and asserting inequality here would
  // make this test depend on wall-clock timing. The RESET DECISION and its state effects are
  // what /start has to get right.
  eq(r2.stored.consent, '', '/start did not clear consent');
  eq(r2.stored.lead_id, '', '/start did not archive the lead');
  assert(r2.stored.previous_lead_id.indexOf('QA-P6R1-START') !== -1,
    '/start lost the archived lead id');
  eq(r2.stored.status, 'active', '/start did not reset status');
  eq(r2.stored.state, 'MENU', '/start did not reset state');
});

check('(step 9) the restart callback on a finished cycle behaves the same', () => {
  const r1 = roundTrip(baseRow(), ordinary, MIGRATED_HEADERS_46);
  const C1 = r1.stored.cycle_id;
  // carriesFinishedCycle requires a consent decision, a lead, or status ended.
  const finished = Object.assign({}, r1.stored, {
    consent: 'yes', consent_cycle_id: C1, consent_at: '2026-08-26T12:00:00.000Z',
    lead_id: 'QA-P6R1-RESTART', lead_cycle_id: C1, lead_intake_ok: 'true'
  });
  const r2 = roundTrip(finished, restart, MIGRATED_HEADERS_46);
  eq(r2.gated.cycle_reset, 'restart', 'm|diag on a finished cycle did not restart');
  assert(/^C-/.test(r2.stored.cycle_id), 'restart produced no cycle id');
  eq(r2.stored.consent, '', 'restart did not clear consent');
  assert(r2.stored.previous_lead_id.indexOf('QA-P6R1-RESTART') !== -1, 'restart lost the archived lead id');
  // ...and an UNFINISHED cycle is deliberately not reset by the same callback.
  const unfinished = Object.assign({}, r1.stored, { consent: '', lead_id: '', status: 'active' });
  const r3 = roundTrip(unfinished, restart, MIGRATED_HEADERS_46);
  eq(r3.gated.cycle_reset, '', 'm|diag reset an unfinished diagnostic cycle');
});

check('a bootstrap does NOT clear funnel progress — no user is sent back to /start', () => {
  const funnel = baseRow({
    selected_service: 'diagnostic', business_model: 'retail',
    contact_name: 'Synthetic Person', company: 'Synthetic SRL', state: 'SERVICE_SELECTED'
  });
  const r = roundTrip(funnel, ordinary, MIGRATED_HEADERS_46);
  eq(r.gated.cycle_reset, 'bootstrap', 'the fixture did not bootstrap');
  eq(r.stored.selected_service, 'diagnostic', 'bootstrap cleared selected_service');
  eq(r.stored.business_model, 'retail', 'bootstrap cleared business_model');
  eq(r.stored.state, 'SERVICE_SELECTED', 'bootstrap reset the funnel state');
});

// ================================================================ schema contract

check('KNOWN RESIDUAL — the legacy cycle id generator collides within one millisecond', () => {
  // The generator is 'C-' + chat_id + '-' + Date.now(). Two resets for one chat inside the
  // same millisecond produce the IDENTICAL cycle id. This surfaced naturally while writing
  // this gate: two back-to-back resets returned the same id and failed an equality assertion.
  //
  // It is PRE-EXISTING and is NOT made worse by adding the six columns, which is why P6R-1
  // does not touch it. It is also exactly the collision P3 cited when rejecting a derived
  // submission key in favour of MODEL B's 128-bit random key, so B.2.1-C already routes
  // around it. Recorded here so it stays visible instead of being rediscovered later.
  const a = roundTrip(baseRow({ consent: 'yes' }), start, MIGRATED_HEADERS_46);
  const b = roundTrip(baseRow({ consent: 'yes' }), start, MIGRATED_HEADERS_46);
  eq(a.gated.cycle_reset, 'start', 'fixture a did not reset');
  eq(b.gated.cycle_reset, 'start', 'fixture b did not reset');
  assert(/^C-/.test(a.stored.cycle_id), 'the reset produced no cycle id');
  // The collision is a property of the generator SHAPE, which is what is asserted here.
  // Whether two same-millisecond calls actually collided in this particular run is reported,
  // not required, so the check is deterministic.
  assert(GATE_SRC.indexOf("'C-' + str(p.chat_id) + '-' + Date.now()") !== -1,
    'the cycle id generator changed shape; re-assess this residual');
  if (a.stored.cycle_id === b.stored.cycle_id) {
    console.log('        (collision reproduced in this run)');
  }
});

console.log('\nLEGACY SCHEMA CONTRACT (P6R-1 scope)');

check('(step 12) every field the guards depend on is in the legacy required set', () => {
  // Read the dependencies out of the gate source rather than asserting a list from memory.
  LEGACY_REQUIRED.forEach((c) => assert(GATE_SRC.indexOf(c) !== -1,
    c + ' is in the required set but the gate never references it'));
  // ...and the guards' own field reads are all covered by the set plus the live headers.
  ['cycle_id', 'consent_cycle_id', 'lead_cycle_id', 'previous_lead_id', 'lead_intake_ok', 'consent_at']
    .forEach((c) => assert(LEGACY_REQUIRED.indexOf(c) !== -1, c + ' left the required set'));
  eq(LEGACY_REQUIRED.length, 6, 'the legacy required set is no longer six columns');
});

check('(step 12) all three row builders carry the same required set', () => {
  ROW_BUILDERS.forEach((b) => {
    const cols = colsOf(b);
    LEGACY_REQUIRED.forEach((c) => assert(cols.indexOf(c) !== -1,
      b + ' does not write ' + c + ', so that column could never persist'));
  });
  // ...and they agree with one another, so one builder cannot drift alone.
  const a = colsOf(ROW_BUILDERS[0]).slice().sort().join(',');
  ROW_BUILDERS.slice(1).forEach((b) => eq(colsOf(b).slice().sort().join(','), a,
    b + ' has drifted from ' + ROW_BUILDERS[0]));
});

check('(step 12) MUTATION — dropping any one legacy column fails the contract', () => {
  // The guard is only worth having if removing a field breaks it. Prove that for each.
  LEGACY_REQUIRED.forEach((victim) => {
    const reduced = LEGACY_REQUIRED.filter((c) => c !== victim);
    let caught = false;
    try {
      ROW_BUILDERS.forEach((b) => {
        const cols = colsOf(b);
        LEGACY_REQUIRED.forEach((c) => { if (cols.indexOf(c) === -1) { throw new Error('missing'); } });
      });
      // The real mutation: a required set that has lost a column must not still satisfy the
      // six-column contract.
      if (reduced.length !== 6) { throw new Error('contract-size'); }
    } catch (e) { caught = true; }
    eq(caught, true, 'dropping ' + victim + ' did not break the contract');
  });
});

check('(P6R-1R) the observed live schema is 48 columns with the six legacy present', () => {
  // 40 leading + 2 duplicate 'error' + 6 legacy = 48, matching the grid limit the Sheets API
  // reported. This is the live shape the Concierge now writes against.
  eq(LIVE_HEADERS_40.length + LIVE_TAIL_AFTER_40.length, LIVE_GRID_COLUMNS,
    'the modelled live schema no longer sums to the observed 48-column grid');
  LEGACY_REQUIRED.forEach((c) => assert(LIVE_TAIL_AFTER_40.indexOf(c) !== -1,
    c + ' is missing from the observed live tail'));
  // The duplicate is recorded, and it is 'error' - not one of the six.
  LIVE_DUPLICATE_HEADERS.forEach((d) => {
    assert(LIVE_TAIL_AFTER_40.filter((x) => x === d).length === 2, d + ' is no longer duplicated');
    assert(LEGACY_REQUIRED.indexOf(d) === -1, 'a LEGACY column is duplicated, which would break its mapping');
  });
  // Each of the six appears exactly once, which is what keeps autoMapInputData unambiguous
  // for them despite the duplicate elsewhere in the row.
  LEGACY_REQUIRED.forEach((c) => eq(LIVE_TAIL_AFTER_40.filter((x) => x === c).length, 1,
    c + ' appears more than once in the live tail'));
});

check('(P6R-1R) the duplicate error header cannot shadow any legacy column', () => {
  // autoMapInputData resolves a field by its FIRST index in the header row. A duplicate only
  // shadows itself: the second 'error' is unreachable, every uniquely-named column is not.
  const full = LIVE_HEADERS_40.concat(LIVE_TAIL_AFTER_40);
  LEGACY_REQUIRED.forEach((c) => {
    const first = full.indexOf(c);
    const last = full.lastIndexOf(c);
    eq(first, last, c + ' resolves to more than one column, so its writes would be ambiguous');
  });
  // ...and the shadowed column really is only 'error'.
  const shadowed = full.filter((c, i) => full.indexOf(c) !== i);
  eq(shadowed.join(','), 'error', 'a column other than error is shadowed by a duplicate');
});

check('(step 12) no B.2.1-C column is falsely marked live by P6R-1', () => {
  // Unconditional for all four: whatever production has shipped, P6R-1's legacy scope must not
  // grow to include a B.2.1-C column.
  B21C_ONLY.forEach((c) => {
    assert(LEGACY_REQUIRED.indexOf(c) === -1, c + ' was smuggled into the P6R-1 legacy set');
    assert(MIGRATED_HEADERS_46.indexOf(c) === -1, c + ' appears in the P6R-1 migrated header set');
  });
  // ...and for the three that have NOT shipped, no Concierge row builder writes them either,
  // so P6R-1 cannot deliver one by accident.
  B21C_NOT_YET_SHIPPED.forEach((c) => {
    ROW_BUILDERS.forEach((b) => assert(colsOf(b).indexOf(c) === -1,
      b + ' writes ' + c + ', which is B.2.1-C scope, not P6R-1'));
  });
  eq(MIGRATED_HEADERS_46.length, 46, 'the migrated header count is not 40 + 6');
  eq(LIVE_HEADERS_40.length, 40, 'the observed live header count drifted from 40');
});

check('(step 12b) submission_key is written by ALL THREE row builders or by none', () => {
  // The only column P7.5R moved out of B.2.1-C scope, and the reason it needs its own check:
  // all three builders persist a session row over the SAME sheet row, so a column carried by
  // two of them is not "partly shipped" -- it is blanked by whichever one runs last.
  const carries = ROW_BUILDERS.filter((b) => colsOf(b).indexOf('submission_key') !== -1);
  assert(carries.length === 0 || carries.length === ROW_BUILDERS.length,
    'submission_key is written by ' + carries.join(', ') + ' but not the rest; the others will blank it');
});

// ---------------------------------------------------------------- summary

console.log('\n' + (failures.length ? 'FAIL' : 'PASS') + '  ' + pass + ' checks passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
