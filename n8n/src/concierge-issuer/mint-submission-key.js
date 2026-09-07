// FINMENTOR — B.2.1-C P7: the ISSUER half of Model B.
//
// The receipt substrate is proven live (G1, P6.4). What has never existed is the half that
// CREATES a submission_key: the live Concierge contains zero nodes referencing it. This
// module is the decision logic for that half — the mint, and the rule for when a cycle gets a
// new key, keeps its old one, or gets none at all.
//
// It deliberately does NOT re-implement what already exists. `buildPreallocation` and
// `verifyPreallocationReadback` in n8n/src/lead-intake/idempotency-receipt.js are steps 2-4 of
// ISSUANCE_ORDER and are already gated. This module is step 1, plus the question that step 1
// alone does not answer: what happens on the messages that are NOT a new cycle.
//
// ============================ THE PRIMITIVE, PROVEN NOT ASSUMED ============================
//
// P3 §3 specifies `crypto.randomBytes(16)`. Writing that literally would have shipped a live
// outage, and the probe that caught it ran before a line of issuer code was written.
//
// n8n Code sandbox, this tenant, execution 3651 (2026-08-27):
//
//   typeof crypto                          -> "undefined"
//   crypto.randomUUID()                    -> ERR: crypto is not defined
//   crypto.getRandomValues(...)            -> ERR: crypto is not defined
//   require('crypto').randomBytes(16)      -> e0156e8ea8c81ca8f39b002155c76550
//   typeof Buffer                          -> "function"
//   typeof require                         -> "function"
//   process.version                        -> ERR: process is not defined
//
// There is NO global `crypto` in an n8n Code node here. The mint runs inside `Get Bot Session`,
// on the /start path, for every user — so a ReferenceError there is not a failed submission,
// it is a bot that stops answering. The one primitive that answered is `require('crypto')`,
// and that is what the issuer is written against.
//
// Its QUALITY was measured rather than assumed, execution 3652: 10,000 draws, 10,000 distinct,
// 0 collisions, 0 malformed, all 256 byte values observed, common prefix between two draws 0
// hex chars. And the failure mode `cycle_id` actually has — two issuances inside ONE
// millisecond — was MEASURED to occur (`same_ms_pair_measured: true`, so the check was not
// vacuous) and the two keys were distinct. `cycle_id` is `'C-' + chat_id + '-' + Date.now()`
// and collides by construction in exactly that case; the key does not.
//
// randomBytes is injected rather than required at module scope so the gate can drive the mint
// with a stub and prove the format rules actually fail when they are violated.

'use strict';

const SUBMISSION_KEY_RE = /^sub_[0-9a-f]{32}$/;
const KEY_BYTES = 16; // 128 bits

// The exact expression that must appear in the deployed Code body. The gate asserts the
// candidate uses this and NOT a `crypto.` global, because the difference between them is a
// working bot and a dead one, and it is one word wide.
const REQUIRED_ENTROPY_CALL = "require('crypto').randomBytes";
const FORBIDDEN_IN_CODE_NODE = ['crypto.randomUUID', 'crypto.getRandomValues'];

const ENTROPY_EVIDENCE = {
  tenant_has_global_crypto: false,
  proven_by_execution: '3651',
  quality_proven_by_execution: '3652',
  draws: 10000,
  collisions: 0,
  same_millisecond_pair_measured: true,
  same_millisecond_pair_distinct: true
};

function str(v) { return String(v == null ? '' : v).trim(); }

function isSubmissionKey(v) { return SUBMISSION_KEY_RE.test(str(v)); }

// Step 1 of ISSUANCE_ORDER. `randomBytes` must be require('crypto').randomBytes or a stub
// with the same contract: (n) -> a Buffer/Uint8Array of length n.
//
// The output is validated before it is returned. A stub — or a future platform whose
// randomBytes is short, constant or non-hex — must not be able to mint a key that the rest of
// the system will then treat as authoritative. Minting is the one place where a silent
// weakening is invisible downstream: every consumer sees a well-formed string either way.
function mintSubmissionKey(randomBytes) {
  if (typeof randomBytes !== 'function') {
    throw new Error('mintSubmissionKey requires a randomBytes function');
  }
  const buf = randomBytes(KEY_BYTES);
  if (!buf || typeof buf.length !== 'number' || buf.length !== KEY_BYTES) {
    throw new Error('randomBytes did not return ' + KEY_BYTES + ' bytes');
  }
  let hex = '';
  for (let i = 0; i < KEY_BYTES; i++) {
    const b = buf[i];
    if (typeof b !== 'number' || !isFinite(b) || b < 0 || b > 255 || (b | 0) !== b) {
      throw new Error('randomBytes returned a non-byte at index ' + i);
    }
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  const key = 'sub_' + hex;
  if (!SUBMISSION_KEY_RE.test(key)) { throw new Error('minted key failed the format rule'); }
  return key;
}

// ---------------------------------------------------------------- the issuance decision

// THE RULE THAT MATTERS: the issuer never backfills.
//
// Every Bot_Sessions row that exists today has a cycle_id and no submission_key. The tempting
// repair — "a current cycle must have a key, so mint one for it" — creates a duplicate lead.
// A legacy cycle may ALREADY have submitted: `lead_id` is set, the CRM row exists, the work is
// done. Minting a key for it preallocates a READY receipt, and READY is positive evidence that
// no handoff began. The gateway would read it, believe the submission had never happened, and
// release exactly one attempt for a lead that is already in the pipeline.
//
// So a legacy cycle keeps no key and stays unsubmittable. The gateway answers CANNOT_ANSWER
// (P3 §5, fail-closed-when-missing), and the user's next /start issues a genuinely new cycle
// with a genuinely new key. That costs one restart and cannot duplicate anything.
//
// The second rule: a key is minted if and only if a NEW CYCLE is minted. Anything else
// desynchronises the pair that Bot_Sessions carries, and the gateway's SUBMISSION_KEY_DRIFT
// check exists because that pair is meant to move together or not at all.
const ISSUANCE_ACTIONS = ['MINT', 'CARRY', 'LEGACY_NO_KEY', 'CARRY_MALFORMED'];

const NEVER_BACKFILL = {
  rule: 'a cycle that exists without a submission_key NEVER receives one retroactively',
  because: 'a legacy cycle may already have submitted; a fresh READY receipt would be read as ' +
    'positive evidence that it had not, releasing a second attempt for an existing lead',
  consequence: 'the gateway answers CANNOT_ANSWER until the user starts a new cycle',
  cost: 'one restart',
  alternative_cost: 'a duplicate lead'
};

// `reset` is the cycle gate's own output: '' | 'start' | 'restart' | 'bootstrap'.
// `persistedKey` is what the session row carries TODAY — which on this tenant the Concierge
// cannot even read yet (see F14 in the P7.0 record), so the gate pins that separately.
function decideIssuance(opts) {
  const o = opts || {};
  const reset = str(o.reset);
  const persistedKey = str(o.persistedKey);
  const persistedCycleId = str(o.persistedCycleId);

  if (reset !== '') {
    if (typeof o.mint !== 'function') {
      throw new Error('decideIssuance needs a mint function when a new cycle is issued');
    }
    const key = o.mint();
    if (!isSubmissionKey(key)) { throw new Error('mint produced a malformed submission_key'); }
    // A new cycle REPLACES the key. It never merges with, appends to or reuses the old one.
    return { action: 'MINT', submission_key: key, preallocate: true, reason: 'NEW_CYCLE_' + reset.toUpperCase() };
  }

  if (isSubmissionKey(persistedKey)) {
    return { action: 'CARRY', submission_key: persistedKey, preallocate: false, reason: 'CYCLE_UNCHANGED' };
  }

  // Malformed rather than absent. Carried forward UNCHANGED and never repaired: the gateway
  // already refuses a malformed key (SUBMISSION_KEY_INVALID, proven live), and blanking it
  // here would destroy the only evidence that the row is corrupt while producing the same
  // refusal. The issuer reports; it does not launder.
  if (persistedKey !== '') {
    return { action: 'CARRY_MALFORMED', submission_key: persistedKey, preallocate: false, reason: 'KEY_MALFORMED_NOT_REPAIRED' };
  }

  // No key. If there is a cycle, this is a legacy row — and NEVER_BACKFILL applies.
  return {
    action: 'LEGACY_NO_KEY',
    submission_key: '',
    preallocate: false,
    reason: persistedCycleId !== '' ? 'LEGACY_CYCLE_NOT_BACKFILLED' : 'NO_CYCLE_NO_KEY'
  };
}

// A decision is only allowed to advance authority when the receipt behind it is confirmed.
// `preallocate === false` means there is nothing new to confirm, so authority may advance on
// the strength of a receipt that was confirmed at some earlier issuance.
function authorityAdvanceAllowed(decision, readbackVerdict) {
  const d = decision || {};
  if (!d.preallocate) { return { advance: true, reason: 'NO_NEW_RECEIPT_REQUIRED' }; }
  const v = readbackVerdict || {};
  if (v.ok !== true || v.advance !== true) {
    return { advance: false, reason: 'PREALLOCATION_UNCONFIRMED:' + str(v.reason || 'NO_VERDICT') };
  }
  if (str(v.key) !== '' && str(v.key) !== str(d.submission_key)) {
    return { advance: false, reason: 'READBACK_KEY_MISMATCH' };
  }
  return { advance: true, reason: 'PREALLOCATION_CONFIRMED' };
}

module.exports = {
  SUBMISSION_KEY_RE,
  KEY_BYTES,
  REQUIRED_ENTROPY_CALL,
  FORBIDDEN_IN_CODE_NODE,
  ENTROPY_EVIDENCE,
  ISSUANCE_ACTIONS,
  NEVER_BACKFILL,
  isSubmissionKey,
  mintSubmissionKey,
  decideIssuance,
  authorityAdvanceAllowed
};
