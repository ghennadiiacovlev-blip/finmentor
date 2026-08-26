// FINMENTOR — preallocated submission receipt (G1, P3 architecture).
//
// Canonical scope: docs/PHASE_B2_1C_G1_P3_PREALLOCATION_DECISION.md.
//
// WHY THIS WAS REDESIGNED.
//
// P2 took the original design to the tenant and it failed: the n8n Data Table has NO atomic
// insert-if-absent. The `dataTable` node's row operations are deleteRows / get / rowExists /
// rowNotExists / insert / update / upsert — `insert` is unconditional, `upsert` is
// match-then-write, and rowExists+insert is the "broad lookup + create" race this design
// forbids. Confirmed live: two inserts of the same key both succeeded. Evidence in
// docs/PHASE_B2_1C_G1_P2_LIVE_STORE_CANARY.md.
//
// So the submit path can no longer CREATE its receipt. The receipt must already exist.
//
// THE PREALLOCATION INVARIANT — the one sentence this file exists to hold:
//
//     A CURRENT AUTHORITATIVE CYCLE NEVER EXISTS WITHOUT ITS PREALLOCATED RECEIPT.
//
// The receipt is created at cycle issuance, BEFORE the cycle becomes authoritative. The
// submit path then only ever performs CONDITIONAL UPDATES — the one primitive Phase 10 did
// prove live in this tenant.
//
// WHAT THAT BUYS, and it is the whole point:
//
//   * absence stops being an answer. Under the old design "no row" meant "nothing was
//     created, go ahead and submit" — an inference that could create a duplicate lead if the
//     store was merely slow. Now a missing receipt for a current cycle is a BROKEN INVARIANT,
//     and the only safe response is CANNOT_ANSWER. Read-after-write therefore stops being a
//     safety prerequisite (P1-L3) and becomes a liveness property.
//   * READY is POSITIVE evidence that no Lead Intake handoff began. That is what permits a
//     submit, and it is evidence rather than an inference from silence.
//   * the durable LOOKUP KEY stops being derived from the Telegram identity. Stated precisely,
//     because the broader claim would be false: the submission key is opaque and carries no
//     user identity, and no contact PII is stored — but a COMMITTED receipt does hold
//     `canonical_lead_id`, which is a CRM record identifier. So the ledger is not
//     "identifier-free"; it no longer contains a *Telegram/user* identifier, which is the
//     P1.3 §3.1 compromise that is actually retired.
//
// Every dependency is INJECTED. This file performs no I/O whatsoever.

const crypto = require('crypto');

function normValue(v) {
  if (v === null || v === undefined) { return ''; }
  return String(v).trim();
}

// ---------------------------------------------------------------- the submission key

// MODEL B. An opaque, server-minted, cryptographically random key — NOT derived from the
// Telegram user id or the cycle id.
//
// Model A (keep `miniapp:<telegram_user_id>:<cycle_id>` with a strengthened cycle generator)
// was rejected on evidence, not preference. The decisive problem is that the current cycle id
// is `C-<chat_id>-<Date.now()>`: two issuances for one chat in the same millisecond produce
// the IDENTICAL cycle id, and therefore the identical derived receipt key — at which point
// preallocation needs insert-if-absent to arbitrate, which P2 proved does not exist. A
// derived key cannot escape that, because its uniqueness is only ever as good as the cycle
// id's. A random key is unique by construction regardless of what the cycle generator does.
//
// 128 bits from crypto.randomBytes. Stated honestly: this is a PROBABILISTIC guarantee, not
// a mathematical impossibility. At 128 bits the collision probability across any realistic
// number of cycles this business will ever issue is far below the probability of the store
// itself losing a row, which is the correct comparison to make.
const SUBMISSION_KEY_BYTES = 16;
const SUBMISSION_KEY_PREFIX = 'sub_';
const SUBMISSION_KEY_RE = /^sub_[0-9a-f]{32}$/;

function mintSubmissionKey() {
  return SUBMISSION_KEY_PREFIX + crypto.randomBytes(SUBMISSION_KEY_BYTES).toString('hex');
}

// EXACT form only. No trimming, no repair: the key is server-minted, so anything that is not
// exactly the minted shape did not come from the minter.
function isValidSubmissionKey(key) {
  if (typeof key !== 'string') { return false; }
  return SUBMISSION_KEY_RE.test(key);
}

const SUBMISSION_KEY_MODEL = {
  model: 'B — opaque server-minted random key',
  format: 'sub_<32 lowercase hex>',
  entropy_bits: SUBMISSION_KEY_BYTES * 8,
  minted_by: 'the cycle issuer (Concierge), server-side, at cycle issuance',
  persisted_in: 'Bot_Sessions.submission_key, alongside the authoritative cycle',
  derived_from_identity: false,
  guessable: false,
  // Precise rather than flattering: the KEY carries no identity. The ledger as a whole still
  // holds canonical_lead_id on a COMMITTED receipt, which is a CRM record identifier.
  ledger_is_identifier_free: false,
  ledger_holds_user_identity: false,
  ledger_holds_contact_pii: false,
  crosses_tb1: false,
  browser_may_supply: false,
  collision_model: 'probabilistic: 128-bit random. Not claimed impossible — claimed far less ' +
    'likely than the store losing a row'
};

// ---------------------------------------------------------------- receipt authority

// Unchanged from P1.3 and still binding. An unguessable key is NOT a substitute for route
// authentication: P1-L10 remains required. A random key removes the *targeted* poisoning
// threat (an attacker cannot guess a victim's key) but it does not stop an authenticated-
// looking public caller from mutating a key it has somehow learned, and provenance must never
// come from anything a caller can assert.
const RECEIPT_AUTHORITY = {
  source: 'route provenance only',
  proven_by: "$('Internal Auth Entry').first().json.__internal_route === true",
  never_from: [
    'a payload body field',
    'an HTTP header',
    'a query parameter',
    'any caller assertion of any kind'
  ],
  public_route_behaviour: 'receipt controls are IGNORED: no receipt is read, created or updated',
  marker_in_body_is_not_provenance: true,
  // Explicit, because "the key is random now" is exactly the argument someone will make.
  unguessable_key_is_not_a_substitute_for_route_auth: true
};

// P5 §5 — P1-L10 ROUTE DECISION.
//
// DECISION: INTERNAL SUBWORKFLOW. Not an authenticated webhook.
//
// The deciding fact is deployment topology, checked rather than assumed: the Mini App
// gateway and Lead Intake both run as workflows in the SAME n8n tenant
// (n8n/production/manifest.json, tenantHost ghennadi.app.n8n.cloud), so an in-tenant
// invocation is available. P4 additionally exercised exactly this mechanism live in this
// tenant — `executeWorkflow` calling an `executeWorkflowTrigger` sub-workflow — so it is a
// proven capability here, not a hoped-for one.
//
// Why it beats a credential-protected webhook, given both were available:
//
//   * NO PUBLIC URL. An authenticated webhook is still a network-reachable endpoint that
//     accepts unauthenticated connections before rejecting them. A sub-workflow has no
//     address off-instance at all, so the internal receipt path is not merely guarded — it
//     is unreachable from the internet.
//   * NO TRANSPORT SECRET LIFECYCLE. No credential to provision, rotate, scope, leak into an
//     export, or forget to revoke. The audit already has two n8n API keys pending revocation;
//     adding a third long-lived transport secret to hold that same design open is the wrong
//     direction.
//   * PROVENANCE IS STRUCTURAL. The entry node can only be reached by an in-instance caller.
//     `internalRouteProven()` reads a node that never ran on the public path, so provenance
//     comes from the workflow graph rather than from anything a caller can assert — which is
//     the property P1-L10 actually requires.
//   * THE PUBLIC PATH STAYS PHYSICALLY SEPARATE. The existing public webhook keeps its own
//     entry node and never reaches the receipt branch.
//
// The entry node keeps the name `Internal Auth Entry`, so `internalRouteProven()` in
// normalize-score-lead.js continues to prove provenance UNCHANGED. That is deliberate: the
// alternative was renaming the node and the function together, and a rename of a
// load-bearing provenance check buys nothing here.
//
// The condition that would overturn this: if the gateway is ever deployed OUTSIDE this n8n
// tenant it cannot invoke a sub-workflow, and the fallback is the authenticated webhook with
// an n8n-managed credential — never a shared secret in Settings or Sheets, never a body
// marker, never a hand-checked header.
const INTERNAL_ROUTE_DECISION = {
  decision: 'INTERNAL_SUBWORKFLOW',
  rejected_alternative: 'AUTHENTICATED_WEBHOOK',
  entry_node_name: 'Internal Auth Entry',
  entry_node_type: 'n8n-nodes-base.executeWorkflowTrigger',
  invoked_by: 'n8n-nodes-base.executeWorkflow from the Mini App gateway workflow',
  same_tenant: true,
  tenant_evidence: 'n8n/production/manifest.json tenantHost',
  mechanism_proven_live: 'P4 race harness used executeWorkflow -> executeWorkflowTrigger in this tenant',
  provenance_source: 'workflow graph reachability',
  public_url_created: false,
  transport_secret_required: false,
  proven_by_unchanged_helper: 'internalRouteProven() in normalize-score-lead.js',
  fallback_if_gateway_leaves_tenant: {
    decision: 'AUTHENTICATED_WEBHOOK',
    auth: 'n8n-managed credential on the entry node',
    forbidden: [
      'a shared secret stored in the Settings sheet',
      'a body field used as authentication',
      'a manually compared caller header treated as provenance'
    ]
  }
};

function resolveReceiptKey(opts) {
  const o = opts || {};
  if (o.provenanceTrusted !== true) {
    return { allowed: false, reason: 'RECEIPT_CONTROLS_REQUIRE_TRUSTED_ROUTE', key: '' };
  }
  if (!isValidSubmissionKey(o.submissionKey)) {
    return { allowed: false, reason: 'SUBMISSION_KEY_INVALID', key: '' };
  }
  return { allowed: true, reason: 'TRUSTED_ROUTE', key: o.submissionKey };
}

// ---------------------------------------------------------------- schema

// Ten fields. `idempotency_key` is gone, replaced by `submission_key`; the identity fields it
// used to embed are gone with it, so the ledger now holds NO personal identifier.
const RECEIPT_FIELDS = [
  'submission_key',     // unique. The ONLY lookup key. Opaque, random, identity-free
  'commit_state',       // READY | IN_FLIGHT | COMMITTED | ABORTED
  'canonical_lead_id',  // empty until COMMITTED; written exactly once
  'lead_mode',          // needed to replay the canonical success verbatim
  'lead_priority',      // ditto
  'financial_zone',     // ditto
  'created_at',         // when the receipt was PREALLOCATED, at cycle issuance
  'claimed_at',         // when READY -> IN_FLIGHT succeeded
  'settled_at',         // when COMMITTED or ABORTED was recorded
  'abort_reason',       // constrained vocabulary; empty unless ABORTED
  // P5 — EMPTY at preallocation, written exactly once by the WINNING claim, and immutable
  // thereafter. It is the gateway's server correlation id, which is the same value the
  // outbound envelope carries as meta.request_id. See P1_L9_CORRELATION_CHAIN.
  'correlation_id'
];

// READY replaces the old submit-time "insert an intent" step. PENDING was renamed IN_FLIGHT
// because under preallocation both READY and the old PENDING would have been "a row exists
// and no lead is recorded" — two very different situations that must never share a name.
const RECEIPT_STATES = ['READY', 'IN_FLIGHT', 'COMMITTED', 'ABORTED'];

const ABORT_REASONS = ['PROVEN_NO_PIPELINE_COMMIT'];

// COMMITTED and ABORTED are terminal. READY -> ABORTED is permitted: an operator may close a
// key that was preallocated but never used, and doing so is strictly safer than leaving it
// claimable for ever.
const TRANSITIONS = {
  READY: ['IN_FLIGHT', 'ABORTED'],
  IN_FLIGHT: ['COMMITTED', 'ABORTED'],
  COMMITTED: [],
  ABORTED: []
};

function canTransition(from, to) {
  const f = normValue(from);
  const t = normValue(to);
  if (RECEIPT_STATES.indexOf(f) === -1 || RECEIPT_STATES.indexOf(t) === -1) { return false; }
  return (TRANSITIONS[f] || []).indexOf(t) !== -1;
}

// ---------------------------------------------------------------- issuance ordering

// The order is the safety property, so it is declared as data rather than left to whoever
// wires the workflow.
// P5 tightens step 3. "Confirmed" is now defined rather than left to the implementer: an
// INSERT that returned success is NOT confirmation, because P2 proved the Data Table has no
// uniqueness constraint and therefore cannot refuse a second row for the same key. The only
// admissible confirmation is an exact-key readback whose CARDINALITY and CONTENT are both
// checked — that is verifyPreallocationReadback().
const ISSUANCE_ORDER = [
  '1. mint a new submission_key server-side (random, not derived)',
  '2. INSERT the receipt in state READY',
  '3. exact-key READBACK of that submission_key',
  '4. verify EXACTLY ONE row, and that the row is a pristine READY receipt for this key',
  '5. where an issuance reference is carried, prove it belongs to THIS issuance',
  '6. only then write the new cycle + submission_key to Bot_Sessions (authority)',
  '7. only after the authority commit may a Mini App session bind to that cycle'
];

const PREALLOCATION_INVARIANT = {
  rule: 'a current authoritative cycle never exists without its preallocated receipt',
  if_receipt_create_fails: 'the authority cycle MUST NOT advance — the old cycle stays current',
  if_authority_write_fails: 'an orphan receipt remains, but no current cycle points to it; ' +
    'harmless, and cleaned up later',
  orphan_receipt_is_never_authority: 'a receipt cannot make itself current — only Bot_Sessions ' +
    'names the authoritative submission_key',
  // The concurrency answer, stated up front because P2/P3 proved issuance is NOT single-writer.
  concurrent_issuance: 'each issuer mints its OWN random key and preallocates its OWN receipt. ' +
    'Both may persist. Bot_Sessions appendOrUpdate decides the winner by last-write-wins, and ' +
    'the gateway only ever uses the key named by the CURRENT authority row. The loser is an ' +
    'orphan that can never satisfy the winner, because the winner reads a different key.',
  data_table_does_not_arbitrate: true
};

// F7 — THE LEAD INTAKE SERVER-SIDE ORDERING.
//
// A gateway submit carrying the submission key is NOT by itself enough. What makes the
// handoff safe is that Lead Intake claims the receipt BEFORE it writes to Pipeline, and that
// the claim is a conditional update whose affected-row count is checked. Encoded here as data
// so the workflow wiring can be checked against it rather than described in prose.
//
// The rule that matters most: NO Pipeline write may occur when the READY claim returns 0,
// more than one, or an unreadable count.
// P5 §3 — VALIDATION MUST PRECEDE THE CLAIM.
//
// The receipt must never become IN_FLIGHT because of a request that was never capable of
// reaching Pipeline. A claim burns the receipt: once it leaves READY it can never be claimed
// again, so a request rejected AFTER the claim strands the cycle in an unresolved state that
// only an operator can clear. Every deterministic, non-mutating rejection therefore happens
// first, and the claim is placed as late as safely possible.
//
// Against the LIVE Lead Intake graph (57 nodes, export QmIyEW2ZEqKregmN) the deterministic
// prefix is:
//
//     Webhook -> Validate Payload -> IF Valid          (schema rejection)
//             -> Read Settings -> Settings to Object   (config load)
//             -> Normalize + Score Lead                (normalisation, scoring)
//             -> Read Pipeline (Dedup) -> Dedup Guard  (dedup decision)
//
// and the dedup decision then routes to exactly three terminal outcomes, ALL of which return
// a canonical lead id to the caller:
//
//     IF Is New  = true  -> Build Pipeline Row -> Save to Pipeline        (new lead)
//     IF Is Retry= true  -> Respond Retry                                  (no write, existing id)
//     otherwise          -> Build Merge Update -> Update Pipeline (Merge)  (merge)
//
// The claim therefore belongs at the single choke point AFTER `Dedup Guard` and BEFORE
// `IF Is New`. That placement is load-bearing in a way that "immediately before Save to
// Pipeline" is not: the RETRY branch returns a lead id WITHOUT writing to Pipeline, so a
// claim attached only to the write paths would leave the receipt READY while the caller was
// told the submission had succeeded. A later recovery would then read READY — "no handoff
// began" — and invite a duplicate submit for a lead that already exists.
const LEAD_INTAKE_CLAIM_ORDER = [
  '1. arrive on the trusted INTERNAL route (P1-L10); the public route does none of this',
  '2. payload schema validation — reject here, receipt still READY',
  '3. settings load and normalisation/scoring — reject here, receipt still READY',
  '4. dedup lookup and dedup decision — the last step that may reject',
  '5. exact-key read of the receipt named by the trusted submission_key',
  '6. conditional update READY -> IN_FLIGHT, matching key AND state, setting correlation_id',
  '7. assert updated_rows === 1 — anything else takes the fail-closed path with NO Pipeline write',
  '8. Pipeline canonical outcome (Save to Pipeline / Update Pipeline (Merge) / retry replay)',
  '9. conditional update IN_FLIGHT -> COMMITTED with the canonical lead id',
  '10. assert updated_rows === 1',
  '11. only then respond'
];

const LEAD_INTAKE_CLAIM_RULES = {
  no_pipeline_write_unless_claim_returned_exactly_one: true,
  claim_precedes_pipeline_write: true,
  commit_precedes_response: true,
  unconditional_update_forbidden: true,
  node_success_is_not_row_count_evidence: true,
  // P5 §3 additions.
  all_deterministic_validation_precedes_claim: true,
  claim_is_after_dedup_decision: true,
  // The retry branch returns a lead id without a Pipeline write, so it is INSIDE the
  // critical section even though it writes nothing.
  claim_covers_retry_branch_with_no_pipeline_write: true,
  no_ordinary_rejection_after_claim: true,
  post_claim_failure_is_unresolved_not_ordinary_failure: 'SUBMIT_UNRESOLVED'
};

// The deterministic stages that MUST complete before the claim, named as they appear in the
// live export so the candidate wiring can be checked against the real graph rather than
// against prose.
const PRE_CLAIM_VALIDATION_STAGES = [
  'route provenance',
  'payload schema validation',
  'contact/consent validation required by Lead Intake',
  'normalization and scoring',
  'dedup lookup and dedup decision',
  'deterministic business-rule rejection'
];

// ---------------------------------------------------------------- P5 §4 zero-item wiring

// P4 proved that a conditional update matching NOTHING returns `data.main[0] === []` with
// executionStatus "success". In n8n that means the node emits ZERO ITEMS, and every ordinary
// downstream node is SKIPPED for that execution.
//
// This is the sharpest wiring hazard in the whole design. The natural reading of
// "Data Table update -> IF updated_rows === 1 -> Pipeline" is that the IF node decides. It
// does not: on a zero-match the IF never runs at all, so whatever the workflow does next is
// decided by the graph's fall-through, not by any check that was written. A design that
// relies on a post-update Code/IF node to catch the zero case catches nothing.
//
// Two n8n-native constructions survive that. The candidate uses BOTH, because they fail
// differently:
//
//   1. `alwaysOutputData: true` on the update node. n8n then substitutes a single EMPTY item
//      `{}` when the node produced none, so a downstream node always runs. The discriminator
//      is then the SHAPE of the item, not its presence.
//   2. An explicit output-shape discrimination step that converts item-presence into an
//      explicit `{ ok, updated_rows }` verdict, and treats anything it does not positively
//      recognise as a failure.
//
// The trap in (1) on its own: the substituted `{}` is indistinguishable from a real row only
// if the check is sloppy. A truthy test, an `!== undefined`, or a `try { ... } catch` around
// a field read all turn the synthetic empty item into a fake success. So the discriminator
// must key on a field that a genuine updated row ALWAYS carries and an empty item NEVER
// does — the update node returns the full post-update row, so `submission_key` matching the
// expected key is that field.
const ZERO_ITEM_UPDATE_CONTRACT = {
  platform_fact: 'a conditional update matching zero rows returns data.main[0] === [] and succeeds',
  consequence: 'ordinary downstream nodes are SKIPPED; a post-update IF/Code node does not run',
  forbidden_patterns: [
    'assuming a post-update Code or IF node will run on a zero match',
    'treating node execution success as an affected-row count',
    'treating the absence of an error as a successful claim',
    'a pre-read followed by an assumed update',
    'converting a zero match into a synthetic success item that reaches the Pipeline path'
  ],
  required_wiring: [
    'alwaysOutputData: true on the conditional update node',
    'an explicit shape discriminator immediately after it',
    'the discriminator returns { ok, updated_rows } and never throws',
    'updated_rows === 0 routes to the fail-closed branch, which reaches NO Pipeline node',
    'updated_rows === 1 is the ONLY value that permits the Pipeline path'
  ],
  synthetic_empty_item_is_not_success: true,
  verdict_shape: '{ ok: boolean, updated_rows: 0 | 1 }'
};

// Convert the RAW output items of an n8n Data Table conditional-update node into an explicit
// verdict. This is the discriminator the candidate wiring runs immediately after the update.
//
// It must never throw and must never invent a success. `items` is the node's output array,
// which under `alwaysOutputData: true` is one of:
//
//     []                              zero items (only when alwaysOutputData is off)
//     [{}]                            the SYNTHETIC empty item n8n substitutes -> ZERO rows
//     [{ submission_key: K, ... }]    one genuinely updated row                -> ONE row
//
// Anything else — more than one item, a row for a different key, a non-object — is a store
// or wiring behaviour nobody modelled, and is failed closed rather than interpreted.
function interpretUpdateItems(items, expectedKey) {
  if (!isValidSubmissionKey(expectedKey)) {
    return { ok: false, updated_rows: 0, reason: 'SUBMISSION_KEY_INVALID' };
  }
  if (!Array.isArray(items)) {
    return { ok: false, updated_rows: 0, reason: 'UPDATE_OUTPUT_UNREADABLE' };
  }
  // Genuine zero-match with alwaysOutputData off.
  if (items.length === 0) {
    return { ok: false, updated_rows: 0, reason: 'STATE_ALREADY_MOVED' };
  }
  if (items.length > 1) {
    return { ok: false, updated_rows: items.length, reason: 'MULTIPLE_ROWS_AFFECTED' };
  }

  const raw = items[0];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, updated_rows: 0, reason: 'UPDATE_OUTPUT_UNREADABLE' };
  }
  // n8n wraps node output as { json: {...} }; accept either shape so the discriminator works
  // both inside a Code node ($input.all()) and against a raw runData capture.
  const row = (raw.json && typeof raw.json === 'object' && !Array.isArray(raw.json)) ? raw.json : raw;

  const storedKey = normValue(row.submission_key);
  // THE LOAD-BEARING LINE. The synthetic empty item n8n substitutes under alwaysOutputData
  // has no submission_key, so it lands here and is reported as ZERO rows updated — not as a
  // success, and not as an unreadable error that a caller might retry into a duplicate.
  if (storedKey === '') {
    return { ok: false, updated_rows: 0, reason: 'STATE_ALREADY_MOVED' };
  }
  if (storedKey !== expectedKey) {
    return { ok: false, updated_rows: 0, reason: 'UPDATE_TOUCHED_WRONG_KEY' };
  }

  return { ok: true, updated_rows: 1, reason: 'EXACTLY_ONE_ROW' };
}

// ---------------------------------------------------------------- records

function newCorrelationId() { return crypto.randomUUID(); }

// Step 2 of ISSUANCE_ORDER. Creates the receipt in READY, before the cycle is authoritative.
//
// This is an unconditional INSERT — which is all the platform offers, and which is now SAFE
// precisely because the key is random and minted once. Nothing else will ever try to insert
// this key, so there is nothing for insert-if-absent to arbitrate. That is the trick the whole
// redesign turns on: uniqueness moved from the store to the key generator.
function buildPreallocation(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }

  // P5 / P1-L9. The receipt is preallocated BEFORE any submit attempt exists, so there is no
  // request to correlate to yet. A correlation id minted here would be a value no log line
  // downstream ever carries, and would therefore BREAK the operator recovery chain rather
  // than serve it — it would look like a correlation id while correlating nothing.
  //
  // So it is left EMPTY, and the winning claim fills it with the gateway's server
  // correlation id. Supplying one here is refused outright rather than ignored: silently
  // dropping it would let a caller believe it had steered a value that it had not.
  if (normValue(o.correlationId) !== '') {
    return { ok: false, reason: 'CORRELATION_ID_NOT_ALLOWED_AT_PREALLOCATION' };
  }

  return {
    ok: true,
    record: {
      submission_key: gate.key,
      commit_state: 'READY',
      canonical_lead_id: '',
      lead_mode: '',
      lead_priority: '',
      financial_zone: '',
      created_at: now,
      claimed_at: '',
      settled_at: '',
      abort_reason: '',
      correlation_id: ''
    }
  };
}

// ---------------------------------------------------------------- P5 §1 readback proof

// WHY THIS EXISTS.
//
// P2 proved the n8n Data Table INSERT has no uniqueness constraint: two inserts of one key
// both succeed, and neither errors. MODEL B makes a collision extraordinarily unlikely by
// minting a 128-bit random key, but "extraordinarily unlikely" is a property of the KEY
// GENERATOR, not a property the STORE enforces. Authority must therefore never advance on
// the strength of an insert that merely returned success.
//
// The failure this closes is narrow and real: an INSERT that reports success while the row
// is absent, duplicated, or not the row we think it is. `insertedCount`, a 2xx, and the
// absence of an exception are all reports about the CALL. None of them is evidence about the
// STATE, and only state can justify advancing authority.
//
// Every non-conforming outcome returns the same posture: advance === false. There is no
// partial credit and no "probably fine" branch.
const PREALLOCATION_READBACK_RULES = {
  confirmation_is: 'an exact-key readback with cardinality and content both verified',
  not_confirmation: [
    'insertedCount',
    'the node did not error',
    'an HTTP 2xx',
    'the absence of an exception'
  ],
  required_cardinality: 1,
  required_state: 'READY',
  required_pristine_fields: ['canonical_lead_id', 'claimed_at', 'settled_at', 'abort_reason'],
  // P1-L9: a freshly preallocated receipt has NOT been claimed, so it cannot yet carry a
  // correlation id. A non-empty one means this row is not a pristine preallocation.
  correlation_id_must_be_empty: true,
  on_any_failure: 'authority MUST NOT advance; the issuance is an orphan, never a current cycle'
};

// Step 3-5 of ISSUANCE_ORDER. `rows` is the exact-key readback; `key` is the minted key.
//
// `issuanceRef` is optional and covers ordering item 6 of the brief: where an issuance
// carries a correlation/reference of its own, it must be proven to belong to THIS issuance
// rather than to a concurrent one. Concurrent issuance is explicitly allowed (each issuer
// mints its own key), so a reference that belongs to a different issuance is a sign the
// caller has mixed two issuances together and must not advance authority.
function verifyPreallocationReadback(opts) {
  const o = opts || {};
  const key = o.submissionKey;

  if (!isValidSubmissionKey(key)) {
    return { ok: false, advance: false, reason: 'SUBMISSION_KEY_INVALID' };
  }
  // An unreadable store answer is never a pass. "We could not look" and "it is there" must
  // not collapse into one outcome.
  if (o.storeError === true) {
    return { ok: false, advance: false, reason: 'READBACK_STORE_ERROR' };
  }
  if (!Array.isArray(o.rows)) {
    return { ok: false, advance: false, reason: 'READBACK_UNREADABLE' };
  }

  // Reuse the exact-key contract check: a store that returns a row for a different key has
  // broken its lookup contract, and a broken contract proves nothing about our key.
  for (let i = 0; i < o.rows.length; i++) {
    const r = o.rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { ok: false, advance: false, reason: 'READBACK_MALFORMED_ROW' };
    }
    if (normValue(r.submission_key) !== key) {
      return { ok: false, advance: false, reason: 'READBACK_WRONG_KEY' };
    }
  }

  if (o.rows.length === 0) { return { ok: false, advance: false, reason: 'READBACK_ABSENT' }; }
  if (o.rows.length > 1) { return { ok: false, advance: false, reason: 'READBACK_DUPLICATE' }; }

  const row = o.rows[0];
  if (normValue(row.commit_state) !== 'READY') {
    return { ok: false, advance: false, reason: 'READBACK_WRONG_STATE' };
  }

  // A pristine preallocation has no settlement residue. Any of these being populated means
  // the row already has a history, so it is not the receipt this issuance just created.
  const dirty = PREALLOCATION_READBACK_RULES.required_pristine_fields
    .filter((f) => normValue(row[f]) !== '');
  if (dirty.length) {
    return { ok: false, advance: false, reason: 'READBACK_NOT_PRISTINE', fields: dirty };
  }
  if (normValue(row.correlation_id) !== '') {
    return { ok: false, advance: false, reason: 'READBACK_ALREADY_CLAIMED' };
  }

  // Ordering item 6 — an issuance reference, when used, must belong to this issuance.
  if (o.issuanceRef !== undefined || o.expectedIssuanceRef !== undefined) {
    const got = normValue(o.issuanceRef);
    const want = normValue(o.expectedIssuanceRef);
    if (got === '' || want === '' || got !== want) {
      return { ok: false, advance: false, reason: 'ISSUANCE_REF_MISMATCH' };
    }
  }

  return { ok: true, advance: true, reason: 'PREALLOCATION_CONFIRMED' };
}

// ---------------------------------------------------------------- P5 §8 issuance decision

// The Concierge's decision at step 6 of ISSUANCE_ORDER, as a function rather than as prose
// in a Code node. Given the readback verdict it answers ONE question: may the authority row
// advance to the new cycle, and if so with exactly what patch.
//
// The failure posture is the point. When the receipt cannot be confirmed the OLD authoritative
// cycle stays current — it is not cleared, not superseded, and not replaced with a blank. A
// half-advanced authority row (new cycle_id, no submission_key) would be worse than no
// advance at all: every submit on it is PRE_ACTIVATION_BLOCKED, so the user is locked out of
// a cycle that looks current.
//
// Concurrent issuance stays allowed and is NOT arbitrated here. Two issuers each mint their
// own key, each preallocate their own receipt, and both may confirm. Bot_Sessions
// appendOrUpdate picks the winner by last-write-wins, and the loser's receipt becomes an
// orphan that no current authority row names. The ledger never decides who won.
function planIssuance(opts) {
  const o = opts || {};
  const verdict = o.readback || {};

  if (verdict.advance !== true) {
    return {
      ok: false,
      advanceAuthority: false,
      // Stated explicitly so a caller cannot read this as "clear the cycle".
      keepCurrentCycle: true,
      clientMaySeeNewCycle: false,
      orphanReceipt: true,
      reason: normValue(verdict.reason) || 'PREALLOCATION_UNCONFIRMED'
    };
  }

  const key = o.submissionKey;
  if (!isValidSubmissionKey(key)) {
    return {
      ok: false, advanceAuthority: false, keepCurrentCycle: true,
      clientMaySeeNewCycle: false, orphanReceipt: true, reason: 'SUBMISSION_KEY_INVALID'
    };
  }
  const cycleId = normValue(o.cycleId);
  if (cycleId === '') {
    return {
      ok: false, advanceAuthority: false, keepCurrentCycle: true,
      clientMaySeeNewCycle: false, orphanReceipt: true, reason: 'CYCLE_ID_MISSING'
    };
  }

  return {
    ok: true,
    advanceAuthority: true,
    keepCurrentCycle: false,
    clientMaySeeNewCycle: true,
    orphanReceipt: false,
    reason: 'ISSUANCE_CONFIRMED',
    // The authority patch. cycle_id and submission_key are written TOGETHER — the binding is
    // (cycle_id AND submission_key), so writing one without the other is never valid.
    authorityPatch: { cycle_id: cycleId, submission_key: key }
  };
}

// ---------------------------------------------------------------- conditional updates
//
// Every state change below is expressed as a CONDITIONAL UPDATE SPEC: match on the key AND
// the expected current state, set the new state. The caller must then verify that EXACTLY ONE
// row was affected. Nothing here is an unconditional write.

// P1-L9 STRUCTURAL GUARD. correlation_id is writable on exactly one transition —
// READY -> IN_FLIGHT. Enforcing it here rather than by convention means a future edit that
// adds correlation_id to the commit or abort patch throws at build time instead of silently
// rewriting the operator recovery chain at the moment it is most needed.
function updateSpec(key, fromState, toState, patch) {
  const set = Object.assign({ commit_state: toState }, patch || {});
  if (Object.prototype.hasOwnProperty.call(set, 'correlation_id')) {
    const isClaim = fromState === 'READY' && toState === 'IN_FLIGHT';
    if (!isClaim) {
      throw new Error(
        'correlation_id may only be written by the READY -> IN_FLIGHT claim (P1-L9); ' +
        'attempted on ' + fromState + ' -> ' + toState
      );
    }
  }
  return {
    where: { submission_key: key, commit_state: fromState },
    set: set,
    expect_updated_rows: 1
  };
}

// P1-L9 UNDER MODEL B — the operator recovery chain, redefined.
//
// The OLD P1-L9 came from the submit-time receipt design, where the receipt was created by
// the submit attempt and could therefore be stamped at birth with that attempt's request id:
//
//     receipt.correlation_id === envelope.meta.request_id === Pipeline.request_id (AZ)
//
// Under MODEL B the receipt is PREALLOCATED at cycle issuance, before any submit attempt
// exists. A correlation id minted at preallocation would be a value that appears in no
// gateway log line and in no Pipeline row — it would satisfy the letter of "the receipt has
// a correlation_id" while breaking the chain the rule exists to provide. That is worse than
// having no value, because it looks correct.
//
// So the stamp moves to the moment a submit attempt actually claims the receipt:
//
//     PREALLOCATION      correlation_id = ''
//     READY -> IN_FLIGHT correlation_id = the gateway's SERVER correlation id  <-- written here
//     IN_FLIGHT -> COMMITTED / ABORTED   correlation_id untouched
//
// The gateway already uses that same server correlation id as envelope.meta.request_id
// (submit-contract buildLeadIntakePayload), and Lead Intake normalisation writes that same
// value into Pipeline.request_id / column AZ. So from the instant the claim succeeds — and
// therefore BEFORE the Pipeline write — the chain holds:
//
//     receipt.correlation_id === envelope.meta.request_id === Pipeline.request_id candidate
//
// and after the Pipeline write it is the actual operator recovery chain.
//
// Note what this does NOT change: request_id remains a CORRELATION reference and never a
// submission identity. Two attempts at one submission carry different request_ids and share
// one submission_key. Only the attempt that WINS the claim ever writes its request_id onto
// the receipt, which is what makes the stamped value the one that actually reached Pipeline.
const P1_L9_CORRELATION_CHAIN = {
  rule: 'receipt.correlation_id === envelope.meta.request_id === Pipeline.request_id (AZ)',
  model: 'B — preallocated receipt',
  written_at: 'the winning READY -> IN_FLIGHT claim',
  empty_at_preallocation: true,
  value_source: 'the gateway server correlation id, the same value used as meta.request_id',
  caller_selectable: false,
  immutable_once_written: true,
  commit_preserves_it: true,
  abort_preserves_it: true,
  losing_claim_cannot_write_it: true,
  holds_before_pipeline_write: true,
  request_id_is_submission_identity: false,
  submission_identity_is: 'submission_key'
};

// READY -> IN_FLIGHT, immediately before the irreversible Pipeline handoff.
//
// P5 — the claim now writes correlation_id as well as claimed_at. Because this is a
// CONDITIONAL update matched on commit_state === 'READY', a losing concurrent attempt
// affects zero rows and therefore cannot overwrite the winner's correlation id. The
// immutability of the field is a property of the predicate, not of a separate guard.
function buildClaim(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }

  // P1-L9. The claim is the moment the chain is established, so a claim without the server
  // correlation id is refused rather than defaulted — a generated-here value would correlate
  // to nothing and would silently break operator recovery.
  const correlationId = normValue(o.correlationId);
  if (correlationId === '') { return { ok: false, reason: 'CORRELATION_ID_REQUIRED_AT_CLAIM' }; }
  if (correlationId.indexOf(gate.key) !== -1) {
    return { ok: false, reason: 'CORRELATION_ID_DERIVED_FROM_KEY' };
  }
  // The value must be the SERVER correlation id. A caller-supplied request_id reaching this
  // argument would let a caller choose what the operator chain records.
  if (o.correlationIdIsServerMinted === false) {
    return { ok: false, reason: 'CORRELATION_ID_NOT_SERVER_MINTED' };
  }

  return {
    ok: true,
    spec: updateSpec(gate.key, 'READY', 'IN_FLIGHT', {
      claimed_at: now,
      correlation_id: correlationId
    })
  };
}

// IN_FLIGHT -> COMMITTED, after the Pipeline commit is observed and BEFORE the response.
function buildCommit(opts) {
  const o = opts || {};
  const gate = resolveReceiptKey(o);
  if (!gate.allowed) { return { ok: false, reason: gate.reason }; }
  const leadId = normValue(o.canonicalLeadId);
  if (leadId === '') { return { ok: false, reason: 'LEAD_ID_MISSING' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  return {
    ok: true,
    spec: updateSpec(gate.key, 'IN_FLIGHT', 'COMMITTED', {
      canonical_lead_id: leadId,
      lead_mode: normValue(o.leadMode),
      lead_priority: normValue(o.leadPriority),
      financial_zone: normValue(o.financialZone),
      settled_at: now
    })
  };
}

// Operator-only. READY or IN_FLIGHT -> ABORTED.
function buildAbort(opts) {
  const o = opts || {};
  const key = o.submissionKey;
  if (!isValidSubmissionKey(key)) { return { ok: false, reason: 'SUBMISSION_KEY_INVALID' }; }
  const now = normValue(o.nowIso);
  if (now === '') { return { ok: false, reason: 'CLOCK_MISSING' }; }
  const why = normValue(o.abortReason);
  if (ABORT_REASONS.indexOf(why) === -1) { return { ok: false, reason: 'ABORT_REASON_INVALID' }; }
  const from = normValue(o.fromState);
  if (from !== 'READY' && from !== 'IN_FLIGHT') {
    return { ok: false, reason: 'ABORT_REQUIRES_READY_OR_IN_FLIGHT' };
  }
  return { ok: true, spec: updateSpec(key, from, 'ABORTED', { settled_at: now, abort_reason: why }) };
}

// THE LOAD-BEARING CHECK.
//
// A conditional update that affected zero rows means somebody else already moved the state.
// One that affected more than one means the key is not unique and nothing can be trusted.
// Neither is a success, and — critically — neither is what a node's own "did not error"
// signal reports. "The HTTP call succeeded" is not evidence that exactly one row changed, and
// treating it as such is how a claim gets handed to two operations at once.
function assertExactlyOneUpdated(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, reason: 'UPDATE_RESULT_UNREADABLE' };
  }
  if (result.ok !== true) { return { ok: false, reason: 'UPDATE_FAILED' }; }
  const n = result.updated_rows;
  // F5 — the rule is simply "the number 1". Anything else at all fails closed, including the
  // shapes a looser check would wave through: -1, 0.5, NaN, Infinity, the string '1'. A
  // fractional or negative row count is a store behaving in a way nobody modelled, which is
  // the last moment to start trusting it.
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, reason: 'UPDATED_ROWS_UNREADABLE' };
  }
  if (n === 1) { return { ok: true, reason: 'EXACTLY_ONE_ROW' }; }
  if (n === 0) { return { ok: false, reason: 'STATE_ALREADY_MOVED' }; }
  return { ok: false, reason: 'MULTIPLE_ROWS_AFFECTED' };
}

// ---------------------------------------------------------------- classification

const VERDICT = {
  COMMITTED: 'COMMITTED',
  READY: 'READY',                 // positive evidence that no handoff began
  CANNOT_ANSWER: 'CANNOT_ANSWER'
};

const REASONS = {
  ABORTED: 'ABORTED_REQUIRES_NEW_CYCLE',
  // The preallocation invariant is broken. This is never "nothing was created".
  ABSENT: 'RECEIPT_ABSENT_INVARIANT_BROKEN'
};

// What does this set of rows, read back for this key, actually prove?
//
// Note what is NOT here: there is no ABSENT verdict that a caller can turn into "safe to
// submit". Absence is a broken invariant and resolves to CANNOT_ANSWER, full stop.
function classifyRows(rows, key) {
  if (!isValidSubmissionKey(key)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'SUBMISSION_KEY_INVALID' };
  }
  if (!Array.isArray(rows)) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'ROWS_UNREADABLE' };
  }

  // The store's contract is exact-key lookup, and a broken contract proves nothing — so no
  // filtering. Every returned row must be exactly this key, compared as a raw string.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
    const stored = r.submission_key;
    if (typeof stored !== 'string' || stored === '') {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'RECEIPT_KEY_MISSING' };
    }
    if (stored !== key) {
      return { verdict: VERDICT.CANNOT_ANSWER, reason: 'LOOKUP_CONTRACT_VIOLATION' };
    }
  }

  if (rows.length === 0) {
    // A current authoritative cycle is REQUIRED to have a receipt. Its absence means the
    // preallocation invariant was violated somewhere — never that nothing was created.
    return { verdict: VERDICT.CANNOT_ANSWER, reason: REASONS.ABSENT };
  }
  if (rows.length > 1) {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'DUPLICATE_RECEIPTS' };
  }

  const row = rows[0];
  const state = normValue(row.commit_state);
  const correlationId = normValue(row.correlation_id);

  if (state === 'READY') {
    // POSITIVE evidence: the receipt exists and no handoff has been claimed against it.
    return { verdict: VERDICT.READY, reason: 'NO_HANDOFF_BEGAN', correlation_id: correlationId };
  }
  if (state === 'IN_FLIGHT') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'IN_FLIGHT_UNRESOLVED', correlation_id: correlationId };
  }
  if (state === 'ABORTED') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: REASONS.ABORTED, correlation_id: correlationId };
  }
  if (state !== 'COMMITTED') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'UNKNOWN_STATE', correlation_id: correlationId };
  }

  const leadId = normValue(row.canonical_lead_id);
  if (leadId === '') {
    return { verdict: VERDICT.CANNOT_ANSWER, reason: 'COMMITTED_WITHOUT_LEAD', correlation_id: correlationId };
  }

  return {
    verdict: VERDICT.COMMITTED,
    reason: 'RECEIPT_COMMITTED',
    correlation_id: correlationId,
    lead_id: leadId,
    lead_mode: normValue(row.lead_mode),
    lead_priority: normValue(row.lead_priority),
    financial_zone: normValue(row.financial_zone)
  };
}

// ---------------------------------------------------------------- retention

const RECEIPT_LIFECYCLE_INVARIANT = {
  must_exist_while: 'the submission_key is named by a Bot_Sessions row that can still pass the ' +
    'authority and session guards',
  never_expires_while: 'the cycle naming it is current or still recoverable',
  deletion_preconditions: [
    'the receipt is terminal (COMMITTED or ABORTED) or a proven orphan',
    'no current authority row names this submission_key',
    'the approved retention period has elapsed'
  ],
  forbidden: [
    'deletion of a receipt whose key is still named by a current authority row',
    'deletion of a READY or IN_FLIGHT receipt that is still reachable',
    'deletion used to reopen a key'
  ],
  // Materially safer than before: deleting a receipt can no longer manufacture a usable
  // absence, because absence never authorises a submit.
  deletion_cannot_authorise_a_submit: true,
  retention_duration: 'OWNER INPUT — no canonical FINMENTOR retention policy defines one'
};

function mayDeleteReceipt(opts) {
  const o = opts || {};
  const state = normValue(o.commitState);
  const terminal = state === 'COMMITTED' || state === 'ABORTED';
  if (!terminal && o.provenOrphan !== true) {
    return { ok: false, reason: 'RECEIPT_NOT_TERMINAL_AND_NOT_ORPHAN' };
  }
  if (o.namedByCurrentAuthority === true) {
    return { ok: false, reason: 'STILL_NAMED_BY_CURRENT_AUTHORITY' };
  }
  if (o.retentionPeriodElapsed !== true) {
    return { ok: false, reason: 'RETENTION_PERIOD_NOT_ELAPSED' };
  }
  return { ok: true, reason: 'SAFE_TO_DELETE' };
}

// ---------------------------------------------------------------- logging

// The submission key is opaque and identity-free, so it is no longer a personal identifier —
// but it is still a capability-shaped secret-ish value, and there is no operational reason to
// print it. correlation_id remains the field that correlates log lines.
function receiptLogView(opts) {
  const o = opts || {};
  return {
    commit_state: normValue(o.commitState),
    has_lead_id: normValue(o.canonicalLeadId) !== '',
    verdict: normValue(o.verdict),
    reason: normValue(o.reason),
    correlation_id: normValue(o.correlationId)
  };
}

module.exports = {
  SUBMISSION_KEY_PREFIX,
  SUBMISSION_KEY_RE,
  SUBMISSION_KEY_BYTES,
  SUBMISSION_KEY_MODEL,
  RECEIPT_FIELDS,
  RECEIPT_STATES,
  TRANSITIONS,
  ABORT_REASONS,
  RECEIPT_AUTHORITY,
  INTERNAL_ROUTE_DECISION,
  ISSUANCE_ORDER,
  LEAD_INTAKE_CLAIM_ORDER,
  LEAD_INTAKE_CLAIM_RULES,
  PRE_CLAIM_VALIDATION_STAGES,
  PREALLOCATION_INVARIANT,
  PREALLOCATION_READBACK_RULES,
  P1_L9_CORRELATION_CHAIN,
  ZERO_ITEM_UPDATE_CONTRACT,
  RECEIPT_LIFECYCLE_INVARIANT,
  VERDICT,
  REASONS,
  normValue,
  mintSubmissionKey,
  isValidSubmissionKey,
  resolveReceiptKey,
  canTransition,
  buildPreallocation,
  verifyPreallocationReadback,
  planIssuance,
  interpretUpdateItems,
  buildClaim,
  buildCommit,
  buildAbort,
  updateSpec,
  assertExactlyOneUpdated,
  classifyRows,
  mayDeleteReceipt,
  receiptLogView,
  newCorrelationId
};
