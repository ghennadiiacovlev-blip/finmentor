// FINMENTOR — P8.2: the Concierge hot-path configuration design.
//
// WHY THIS EXISTS.
//
// Production execution #3716 failed in 312 ms at `Read Settings` — a Google Sheets read — and
// the customer's /start got no reply at all. The node is step 1 of 25, so a transient Sheets
// blip aborts the turn before anything else happens.
//
// The reflex fix is `retryOnFail`. That would be wrong twice over: it papers over a dependency
// that mostly should not exist, and on a slow-but-succeeding Sheets call it makes the 8.849 s
// latency worse rather than better.
//
// This module is the analysis that replaces the reflex. It classifies every settings key by its
// PROVEN consumers in the deployed graph — not by its name, and not by what an old document
// says it is for.
//
// ================================================================================
// THE FINDING THAT CHANGED THE ANSWER
// ================================================================================
//
// `internal_intake_key` looks like the most important key here: a shared secret sent as
// `x-finmentor-internal-key` on the Concierge -> Lead Intake handoff. It is DEAD, for THREE
// independent reasons, each verified against the live exports. Any one of them alone would be
// enough; together they say it was never wired up at all.
//
//   1. IT IS NEVER EMITTED. `Settings to Object` returns a `cfg` object of exactly nine keys,
//      and `internal_intake_key` is not one of them. Even a perfectly written consumer
//      expression would read `undefined`. The value has never been reachable at runtime, which
//      also means "fixing" the expression below would achieve precisely nothing.
//
//   2. Its only consumer is MALFORMED. The header value in the live Concierge is
//
//          ={{ \Settings to Object.first().json.settings.internal_intake_key || '' }}
//
//      `\Settings to Object` is not an n8n node reference — the valid form is
//      `$('Settings to Object')`, which the URL field two lines above uses correctly. The
//      expression cannot resolve, and the node carries `continueOnFail: true` with
//      `onError: continueRegularOutput`, so it swallows its own failure.
//
//   3. NOTHING READS IT. Lead Intake's `Validate Payload` touches exactly one header,
//      `x-finmentor-source`. No node in that 57-node workflow references
//      `x-finmentor-internal-key` at all.
//
// So the Concierge sends a header nobody checks, computed by an expression that cannot work.
// **A security control that appears to exist and does not is worse than a known absent one** —
// it invites the reader to believe the internal handoff is authenticated when the posture is
// actually the documented "public webhook accepts any JSON" one from P6.
//
// The correct action is to DELETE the dependency, not to migrate it into a credential. P8.2 §7
// says exactly that: do not preserve obsolete configuration for history's sake.
//
// ================================================================================
// CLASSIFICATION
// ================================================================================
//
// STATIC_NON_SECRET     a value that changes about never. Belongs in workflow configuration,
//                       evaluated locally with ZERO I/O per Telegram turn.
// DYNAMIC_OPERATIONAL   a value whose freshness someone might reasonably want per message.
//                       Each one has to JUSTIFY the round trip it costs.
// SECRET                must never live in a spreadsheet cell.
// DEAD                  no live consumer. Remove from the runtime dependency entirely.

'use strict';

const STATIC_NON_SECRET = 'STATIC_NON_SECRET';
const DYNAMIC_OPERATIONAL = 'DYNAMIC_OPERATIONAL';
const SECRET = 'SECRET';
const DEAD = 'DEAD';

// Every key the current `Settings to Object` produces, with the consumers PROVEN from the
// deployed graph. `provenConsumers` is asserted against the artifacts by the gate, so this
// table cannot drift away from the workflow without a test failing.
const SETTINGS_CLASSIFICATION = {
  bot_enabled: {
    class: DYNAMIC_OPERATIONAL,
    emitted: true, provenConsumers: ['Build Bot Response'],
    note: 'application-level maintenance switch. See BOT_ENABLED_DESIGN — it does NOT need to '
      + 'be remote, and the emergency stop is workflow.active, which is instant and free.'
  },
  default_language: { class: STATIC_NON_SECRET, emitted: true, provenConsumers: ['Build Bot Response'], note: 'ru; changes never' },
  website_url: {
    class: STATIC_NON_SECRET,
    emitted: true, provenConsumers: ['Build Bot Response', 'Build Intake Transport Request'],
    note: 'finmentor.md; a domain change is a deploy anyway'
  },
  client_ai_enabled: {
    class: DYNAMIC_OPERATIONAL,
    emitted: true, provenConsumers: ['Build Bot Response'],
    note: 'feature flag, currently false. Same argument as bot_enabled: rarely toggled, and a '
      + 'per-message round trip is a high price for a flag nobody flips.'
  },
  client_ai_model: { class: STATIC_NON_SECRET, emitted: true, provenConsumers: ['Build Bot Response'], note: 'model id' },
  lead_intake_webhook_url: {
    class: STATIC_NON_SECRET,
    emitted: true, provenConsumers: ['Send Lead to Intake'],
    note: 'the ONE key whose expression is valid and whose consumer is real. Needed only on '
      + 'lead-ready turns, never on /start.'
  },
  internal_intake_key: {
    class: DEAD,
    emitted: false, provenConsumers: [],
    note: 'never emitted by Settings to Object, consumer expression malformed, and Lead Intake never reads the header. Three independent reasons. See header.'
  },
  owner_chat_id: { class: DEAD, emitted: true, provenConsumers: [], note: 'referenced by no node' },
  timezone: { class: DEAD, emitted: true, provenConsumers: [], note: 'referenced by no node' },
  client_ai_temperature: { class: DEAD, emitted: true, provenConsumers: [], note: 'referenced by no node' }
};

// ================================================================================
// bot_enabled: three designs, and why B+A wins
// ================================================================================
//
// A. workflow.active = false
//      transport-level hard stop. Telegram gets no webhook delivery, the customer gets
//      silence. Instant, owner-clickable, zero I/O. Correct for an EMERGENCY.
//      Wrong for maintenance: silence is a bad user experience and looks like a fault.
//
// B. local flag in workflow configuration
//      evaluated in a Code node, ZERO I/O. Can return a friendly maintenance message. The
//      cost is that changing it requires a deploy — which, through the P7.5R materializer, is
//      a reviewed minutes-long operation, not a risk.
//
// C. remote flag in Google Sheets  (TODAY)
//      dynamic, and costs a Sheets round trip on EVERY Telegram turn — the exact dependency
//      that produced #3716. It buys the ability to toggle without a deploy, for a flag that
//      has never been toggled.
//
// CHOSEN: B for maintenance, A for emergency.
//
// The decisive argument is the failure mode, not the convenience. Under C, Google Sheets
// being unavailable means the bot cannot answer AT ALL — the maintenance switch's own
// dependency takes the bot down. Under B, maintenance mode still works when Sheets is down,
// which is precisely when you are most likely to want it.
const BOT_ENABLED_DESIGN = {
  maintenance: 'B — local flag in workflow configuration, zero I/O, friendly message',
  emergency: 'A — workflow.active = false, instant and owner-clickable',
  rejected: 'C — remote Sheets flag; its own dependency is what took the bot down in #3716'
};

// ================================================================================
// The hot path, before and after
// ================================================================================
//
// "Pre-reply" means everything up to and including `Send Client Message`, which is step 11 of
// 25. Steps 16-24 — receipt, authority, event — run AFTER the customer has their message and
// do not belong in the latency SLO.
const PRE_REPLY_ROUND_TRIPS_BEFORE = ['Read Settings', 'Read Bot Sessions', 'Send Client Message'];
const PRE_REPLY_ROUND_TRIPS_AFTER = ['Read Bot Sessions', 'Send Client Message'];

// The SLO is measured on time-to-reply, never on total workflow duration.
const LATENCY_SLO = {
  measure: 'TELEGRAM_TRIGGER_RECEIVED -> Send Client Message COMPLETED',
  preferred_ms: 2000,
  acceptable_ms: 3000,
  degraded_ms: 5000,
  note: 'total workflow duration is a separate operational metric and must NOT be optimised by '
    + 'weakening post-reply safety work'
};

// ================================================================================
// Authority write retry — why blind retry is unsafe
// ================================================================================
//
// `Save Bot Session` is `appendOrUpdate` matched on `chat_id`. It has no conditional predicate:
// it cannot say "update only if cycle_id is still C1".
//
//   CASE A  write never reached Sheets           retry writes once            SAFE
//   CASE B  write committed, ACK lost            retry rewrites identically   SAFE (idempotent)
//   CASE C  a newer cycle C2/K2 won first        retry overwrites C2/K2 with C1/K1
//                                                                             UNSAFE
//
// CASE C is stale-authority RESURRECTION, and it is the exact condition P7.4 proved the system
// refuses at the reread. A blind `retryOnFail` would reintroduce it one node earlier, where
// nothing is watching.
//
// So: NO blind retry. The safe procedure re-reads and re-decides, and it reuses the comparison
// `Authority Verdict` already makes rather than inventing a second one:
// CORRECTED AT P8.2R. The first version of this design proposed verify-then-retry: re-read, and
// if C1/K1 still looks current, write it again. That is NOT safe, and the reason is a TOCTOU
// window I described and then failed to weigh:
//
//     reread sees C1/K1  ->  a concurrent execution writes C2/K2  ->  the retry writes C1/K1
//
// The earlier "the fallback is never worse than today" argument covered only the branch where
// the verdict REFUSES. The branch where it PROCEEDS is the dangerous one, and that is the branch
// the argument said nothing about. A pre-write reread does not make a subsequent unconditional
// write conditional; it only makes it feel conditional.
//
// THE RULE, therefore: there is NO SECOND AUTHORITY WRITE. Not conditionally, not after a
// verified reread, not ever -- unless a real atomic compare-and-set primitive exists, which the
// Sheets node does not offer.
//
// The readback survives, but ONLY to classify what happened. Classification is safe because it
// never leads to a write; the worst a stale classification can do is mislabel an event.
const AUTHORITY_RETRY_DESIGN = {
  blindRetry: 'UNSAFE — appendOrUpdate cannot express "only if still current"',
  verifyThenRetry: 'ALSO UNSAFE — TOCTOU between the reread and the write. Withdrawn at P8.2R.',
  secondWrite: 'NEVER, without a real atomic CAS primitive',
  procedure: [
    'Save Bot Session: onError continueRegularOutput (do not abort the turn)',
    'IF the write reported failure ->',
    '  Authority Outcome Reread : re-read Bot_Sessions for this chat  [CLASSIFY ONLY]',
    '  Authority Outcome Verdict: classifyAuthorityWriteOutcome(intended, observed)',
    '      A  ACK_LOST_BUT_COMMITTED     the row already holds C1/K1 -> treat as success',
    '      B  SUPERSEDED                 the row holds a different valid pair -> stand down',
    '      C  AUTHORITY_WRITE_UNRESOLVED previous / absent / unreadable -> stand down',
    '  In A, B and C alike: NO WRITE. Emit the operational signal and stop the post-reply path.'
  ],
  unresolvedPosture:
    'In case C the READY receipt is deliberately PRESERVED as recoverable orphan evidence. It is '
    + 'the only record that a cycle was issued whose authority never landed, and destroying it '
    + 'would destroy the ability to reconcile. This is the same reasoning that keeps IN_FLIGHT '
    + 'receipts undeletable in the P1-L8 retention policy.',
  cost: 'all of it runs AFTER the reply; zero customer latency'
};

// Classifies an ambiguous `Save Bot Session` outcome from a readback. It returns a label and
// NOTHING ELSE: `writeAllowed` is hard-coded false on every branch, because the whole point of
// P8.2R is that no classification result may authorise a second write.
//
//   intended  { cycle_id, submission_key }  what this turn tried to persist
//   observed  { cycle_id, submission_key } | null   what the readback found (null = absent/unreadable)
function classifyAuthorityWriteOutcome(intended, observed) {
  const str = (v) => String(v === undefined || v === null ? '' : v).trim();
  const iC = str((intended || {}).cycle_id);
  const iK = str((intended || {}).submission_key);

  if (!observed) {
    return { outcome: 'AUTHORITY_WRITE_UNRESOLVED', reason: 'ROW_ABSENT_OR_UNREADABLE', writeAllowed: false };
  }
  const oC = str(observed.cycle_id);
  const oK = str(observed.submission_key);

  if (oC === iC && oK === iK) {
    return { outcome: 'ACK_LOST_BUT_COMMITTED', reason: 'ROW_MATCHES_INTENT', writeAllowed: false };
  }
  // A different, well-formed pair means somebody else's turn owns the row now. Note this does
  // NOT try to decide who is newer: it does not need to, because no branch writes. Refusing to
  // rank them is what keeps a stale classification harmless.
  if (/^C-\d+-\d+$/.test(oC) && /^sub_[0-9a-f]{32}$/.test(oK) && (oC !== iC || oK !== iK)) {
    return { outcome: 'SUPERSEDED', reason: 'ROW_HOLDS_A_DIFFERENT_VALID_PAIR', writeAllowed: false };
  }
  return { outcome: 'AUTHORITY_WRITE_UNRESOLVED', reason: 'ROW_NOT_INTERPRETABLE_AS_CURRENT', writeAllowed: false };
}

// ================================================================================
// Concierge -> Lead Intake: which route is canonical
// ================================================================================
//
// MEASURED, from the live exports:
//
//   * the Concierge calls the PUBLIC Lead Intake webhook over httpRequest;
//   * the only header it sends is the broken `x-finmentor-internal-key`;
//   * Lead Intake derives `source` from `payload.tool` (a BODY field) or an
//     `x-finmentor-source` header the Concierge never sends — so provenance is
//     caller-asserted on a public endpoint;
//   * `source` is referenced in exactly ONE node, `Validate Payload`, and only in its own
//     derivation. It never gates a decision anywhere. It is ATTRIBUTION, not trust;
//   * a caller-supplied `lead_id` is sanitised to /^[A-Za-z0-9_\-]{4,80}$/ and RETAINED.
//
// So today the path is PUBLIC-SEMANTICS (option A) with an authentication-shaped decoration on
// top. Nothing privileged is granted by the fake header or by `source` — which is why deleting
// the header changes no behaviour at all.
//
// WHY THE CANONICAL TARGET IS NEVERTHELESS B. The public path has no receipt behind it. The
// httpRequest carries retryOnFail with maxTries 2 and continueOnFail, so a retried submit can
// create a SECOND lead with no idempotency record to deduplicate it. That is precisely the
// Model-A weakness G1 was built to remove, and the Telegram funnel still has it.
//
// And there is an irony worth stating plainly: the Concierge now MINTS a submission_key on every
// new cycle and then submits its own leads WITHOUT it. The key exists solely for a Mini App that
// is not deployed. Moving this handoff to the structural internal route would make the key the
// Concierge already mints do work on the path the Concierge already has.
const LEAD_INTAKE_ROUTE = {
  today: 'PUBLIC — httpRequest to the public webhook, provenance caller-asserted, no receipt',
  privilegeGranted: 'NONE — source never gates a decision; the internal-key header is inert',
  canonicalTarget: 'B — STRUCTURALLY TRUSTED INTERNAL route, for receipt-backed once-only semantics',
  targetIsSeparatePhase: true,
  p82rAction: 'DELETE the header and the dead key. Keep lead_intake_webhook_url while the public '
    + 'call remains. Do NOT invent a shared-secret header: on a public endpoint it is not an '
    + 'authentication mechanism, it is a password in a request anyone can send.',
  duplicateExposure: 'httpRequest retryOnFail maxTries 2 + continueOnFail, with no receipt — a '
    + 'retried Concierge submit can create a second lead. Unchanged by P8.2R and recorded here '
    + 'as the reason B is the target.'
};

// ================================================================================
// Bot Event — telemetry, and not the same class
// ================================================================================
//
// `Save Bot Event` is `append` with `onError: stopWorkflow`. Its `event_id` is
// `${chat_id}-${Date.now()}`, so a retry produces a DIFFERENT id — the append is NOT
// idempotent and a retry would create a near-duplicate row that no dedup would catch.
//
// It is also the LAST node: by the time it runs, the customer has their reply, the receipt
// exists and authority is written. Failing the execution there marks a successful customer turn
// as an error.
const BOT_EVENT_DESIGN = {
  chosen: 'B — best-effort persistence that never fails the customer workflow',
  change: 'onError: continueRegularOutput. No retry.',
  whyNotRetry: 'event_id embeds Date.now(), so a retry writes a second row with a different id. '
    + 'Retry would trade a missing audit row for a duplicate one, which is worse for analytics.',
  contract: 'Bot_Events is duplicate-tolerant and MAY LOSE ROWS under provider failure. Customer '
    + 'reply and authority correctness must never depend on it, and after this change they do not.'
};

// `Read Bot Sessions` already retries. Bounded, but the backoff is a latency risk in the SLO.
const SESSION_READ_RETRY = {
  current: { retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 },
  worstCaseAddedMs: 4000,
  concern: 'n8n cannot classify provider errors, so an auth or permission failure retries as if '
    + 'it were transient and burns the full backoff before failing.',
  recommendation: 'keep maxTries 3, reduce waitBetweenTries to 500-1000 ms. Worst case falls '
    + 'from ~4 s to ~1-2 s, which keeps a bad-but-recovering read inside the degraded band '
    + 'rather than past the SLO ceiling.'
};

// Nothing in the hot-path config may be a secret, and nothing may reference a dead key.
function validateStaticConfig(config) {
  const failures = [];
  Object.keys(config || {}).forEach((k) => {
    const c = SETTINGS_CLASSIFICATION[k];
    if (!c) { failures.push('unknown settings key in static config: ' + k); return; }
    if (c.class === SECRET) { failures.push('SECRET in static config: ' + k + ' — secrets never live in configuration'); }
    if (c.class === DEAD) { failures.push('DEAD key in static config: ' + k + ' — it has no consumer; delete it'); }
  });
  return { ok: failures.length === 0, failures: failures };
}

function keysOfClass(cls) {
  return Object.keys(SETTINGS_CLASSIFICATION).filter((k) => SETTINGS_CLASSIFICATION[k].class === cls);
}

module.exports = {
  STATIC_NON_SECRET, DYNAMIC_OPERATIONAL, SECRET, DEAD,
  SETTINGS_CLASSIFICATION,
  BOT_ENABLED_DESIGN,
  PRE_REPLY_ROUND_TRIPS_BEFORE,
  PRE_REPLY_ROUND_TRIPS_AFTER,
  LATENCY_SLO,
  AUTHORITY_RETRY_DESIGN,
  classifyAuthorityWriteOutcome,
  LEAD_INTAKE_ROUTE,
  BOT_EVENT_DESIGN,
  SESSION_READ_RETRY,
  validateStaticConfig,
  keysOfClass
};
