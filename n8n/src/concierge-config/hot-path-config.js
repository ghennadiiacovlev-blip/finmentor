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
const AUTHORITY_RETRY_DESIGN = {
  blindRetry: 'UNSAFE — appendOrUpdate cannot express "only if still current"',
  procedure: [
    'Save Bot Session: onError continueRegularOutput (do not abort the turn)',
    'IF the write reported failure ->',
    '  Authority Retry Reread   : re-read Bot_Sessions for this chat',
    '  Authority Retry Verdict  : the SAME stamp comparison Authority Verdict uses --',
    '                             proceed only if the stored cycle is absent, equal, or OLDER',
    '  Save Bot Session (retry) : only on that verdict',
    'ELSE -> Build Authority Abandoned Event, and stop'
  ],
  fallbackIsNeverWorse:
    'If the verdict refuses, the outcome is an orphan READY receipt and an unadvanced authority '
    + 'row -- which is EXACTLY what happens today when the write fails. So verify-then-retry is '
    + 'strictly better than no retry and strictly safer than blind retry.',
  cost: 'all of it runs AFTER the reply; zero customer latency'
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
  BOT_EVENT_DESIGN,
  SESSION_READ_RETRY,
  validateStaticConfig,
  keysOfClass
};
