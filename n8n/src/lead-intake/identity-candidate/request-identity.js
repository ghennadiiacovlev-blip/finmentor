// ============================ CANONICAL REQUEST IDENTITY ============================
//
// CANDIDATE. NOT DEPLOYED. Spliced verbatim into `Validate Payload` and `Dedup Guard` by
// scripts/build-lead-intake-request-identity.mjs, so the two nodes cannot drift into two
// different opinions about what an identity is.
//
// WHAT THIS IS. `request_id` is the NEW-event identity of a lead: the idempotency identity of
// the request that created it. It is NOT an authentication credential and nothing here treats
// it as one. Provenance is still established by the ROUTE n8n authenticates, and a
// caller-supplied identity still cannot select a row on its own -- Dedup Guard's corroboration
// rule is left exactly as it is. What this adds is that an identity has a SHAPE, that the
// shape names the route that minted it, and that one identity cannot cover two different
// submissions.
//
// THE THREE CANONICAL SHAPES, one per route, with mutually exclusive prefixes:
//
//   PUBLIC     fmr_<32 lowercase hex>   minted in the browser ONCE per submission and reused
//                                       for every retry of that submission
//   CONCIERGE  C-<chat_id>-<epoch ms>   minted by Get Bot Session, one per application cycle
//   MINI APP   sub_<32 lowercase hex>   minted by the cycle issuer, claimed by the receipt
//
// The prefixes already existed. They are adopted rather than replaced because the internal two
// are load-bearing elsewhere: `sub_` is the key Lead Intake's idempotency receipt claims on,
// and `C-` is the cycle Bot_Sessions stores. Rewriting either into a new namespace would break
// `Correlation Guard`, which asserts the value Normalize derives is byte-equal to
// `Internal Auth Entry.__correlation_id`. Canonicalisation here is normalisation and
// VALIDATION. It never re-mints.
//
// ROUTE CROSSING IS REFUSED. A public caller may not present a `sub_` or `C-` identity, and an
// internal caller may not present an `fmr_` one. Today a public request can send
// `request_id: "sub_<32 hex>"` and have it persisted to Pipeline AZ. It wins no receipt -- the
// Receipt Gate requires proven provenance -- but it does put a foreign value in the identity
// column, where a future `dispatch_key = 'NEW_LEAD:' || request_id` would collide with a real
// Mini App submission. The refusal closes that before the outbox can inherit it.
const RI = (function () {
  'use strict';

  var HEX32 = /^[0-9a-f]{32}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // `C--100...` is a Telegram GROUP chat id, which is negative. Accepting the leading minus is
  // not cosmetic: Get Bot Session builds the cycle as 'C-' + chat_id + '-' + Date.now(), so a
  // stricter pattern would refuse every group cycle at the door.
  var CONCIERGE = /^C--?[0-9]{1,20}-[0-9]{10,16}$/;
  var MAX_LEN = 80;

  // Canonicalise and validate one request identity.
  //
  // Returns { ok, code, id, route }. `code` is '' on success, otherwise one of
  // IDENTITY_MISSING | IDENTITY_MALFORMED | IDENTITY_ROUTE_FORBIDDEN. `id` is the canonical
  // spelling: the ONLY value that may be persisted, compared, or used to build a dispatch key.
  function canonicalise(raw, opts) {
    var o = opts || {};
    var internal = o.internal === true;
    var s = String(raw === undefined || raw === null ? '' : raw).trim();

    if (s === '') { return { ok: false, code: 'IDENTITY_MISSING', id: '', route: '' }; }
    if (s.length > MAX_LEN) { return { ok: false, code: 'IDENTITY_MALFORMED', id: '', route: '' }; }

    if (s.slice(0, 4) === 'sub_') {
      if (!internal) { return { ok: false, code: 'IDENTITY_ROUTE_FORBIDDEN', id: '', route: 'miniapp' }; }
      return HEX32.test(s.slice(4))
        ? { ok: true, code: '', id: s, route: 'miniapp' }
        : { ok: false, code: 'IDENTITY_MALFORMED', id: '', route: 'miniapp' };
    }

    if (s.slice(0, 2) === 'C-') {
      if (!internal) { return { ok: false, code: 'IDENTITY_ROUTE_FORBIDDEN', id: '', route: 'concierge' }; }
      return CONCIERGE.test(s)
        ? { ok: true, code: '', id: s, route: 'concierge' }
        : { ok: false, code: 'IDENTITY_MALFORMED', id: '', route: 'concierge' };
    }

    if (s.slice(0, 4) === 'fmr_') {
      if (internal) { return { ok: false, code: 'IDENTITY_ROUTE_FORBIDDEN', id: '', route: 'public' }; }
      // The browser has minted two spellings of the same 128 bits since 2026-08-25: a dashed
      // randomUUID and a bare getRandomValues hex run. They fold to one canonical form here so
      // Pipeline AZ, the thank-you `sid` and any future dispatch key all agree.
      var body = s.slice(4).toLowerCase();
      if (UUID.test(body)) { body = body.replace(/-/g, ''); }
      return HEX32.test(body)
        ? { ok: true, code: '', id: 'fmr_' + body, route: 'public' }
        : { ok: false, code: 'IDENTITY_MALFORMED', id: '', route: 'public' };
    }

    return { ok: false, code: 'IDENTITY_MALFORMED', id: '', route: '' };
  }

  // ---------------------------- SUBMISSION EQUIVALENCE ----------------------------
  //
  // The fields that decide whether two requests carrying ONE identity are ONE submission.
  //
  // Chosen as the intersection of (stable, client-stated submission content) and (columns
  // durably present on the Pipeline row). That intersection is the whole design: it needs no
  // schema change, and any later reconciler can recompute the comparison from the row alone,
  // months after the execution history is gone.
  //
  // DELIBERATELY ABSENT, each for its own reason:
  //   raw_json           byte equality is forbidden, and would make every retry a conflict --
  //                      the meta block alone carries a fresh timestamp on every attempt
  //   created_at etc.    a retry legitimately carries a later clock
  //   utm_*, ga_*        attribution and consent metadata describe the visit, not the request
  //   priority, zone,    server-derived from the fields below; including them would break the
  //   scores, reasons    rule every time the scorer is tuned
  //   lead_id            identity, not content
  //   request_id
  var EQUIVALENCE_FIELDS = [
    'name', 'company', 'email', 'phone', 'telegram',
    'business_model', 'industry_category', 'turnover_range', 'employees_range',
    'main_pain', 'selected_problems', 'selected_goals', 'work_interest',
    'documents_status', 'selected_documents', 'preferred_meeting_format'
  ];

  // Comma-joined multi-selects. Re-ordering the same answers is not a different submission,
  // so these are set-compared rather than string-compared.
  var LIST_FIELDS = ['selected_problems', 'selected_goals', 'work_interest', 'selected_documents'];

  function normScalar(v) {
    return String(v === undefined || v === null ? '' : v)
      .toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }
  function normList(v) {
    return normScalar(v).split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return x !== ''; }).sort().join(',');
  }
  function normField(key, value) {
    return LIST_FIELDS.indexOf(key) === -1 ? normScalar(value) : normList(value);
  }

  // MATERIALLY DIFFERENT = at least one equivalence field where BOTH sides are non-empty and
  // the normalised values differ.
  //
  // A blank on either side is a FILL, not a conflict. That is not leniency, it is what keeps
  // the rule STABLE UNDER REPEATED MERGE: `Build Merge Update.fill()` only ever writes into a
  // blank, so a row legitimately gains fields from a retry it already absorbed. Under an
  // equality rule the third attempt at one submission would conflict with the row its own
  // second attempt filled in. Under subsumption it does not, ever.
  function conflictFields(existingRow, submission) {
    var out = [];
    var row = existingRow || {};
    var sub = submission || {};
    for (var i = 0; i < EQUIVALENCE_FIELDS.length; i++) {
      var k = EQUIVALENCE_FIELDS[i];
      var a = normField(k, row[k]);
      var b = normField(k, sub[k]);
      if (a !== '' && b !== '' && a !== b) { out.push(k); }
    }
    return out;
  }

  return {
    canonicalise: canonicalise,
    conflictFields: conflictFields,
    EQUIVALENCE_FIELDS: EQUIVALENCE_FIELDS,
    LIST_FIELDS: LIST_FIELDS,
    MAX_LEN: MAX_LEN
  };
})();
// ========================== END CANONICAL REQUEST IDENTITY ==========================
