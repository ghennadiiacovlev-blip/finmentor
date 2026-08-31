// =================== FINMENTOR SYSTEM ALERT EVENT ===================
//
// The authoritative business-terminal failure event, and the only thing that decides whether the
// owner is told. Inlined verbatim into the SYSTEM ALERT workflow's Code nodes as `SAE`;
// qa/system-alert.test.mjs re-extracts it from the candidate and requires a byte match, so the
// shipped copy and the tested copy cannot drift.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
//
// A healthy n8n graph can return a terminal business failure without any node throwing:
// `continueRegularOutput` converts a store failure into an ordinary item so the graph can
// classify it and answer honestly. That is deliberate and correct — it is the P9-R2 fix. The
// cost is that nothing throws, so `errorTrigger` never fires, and with execution retention off
// there is no record either. On 2026-08-30 a real owner submit failed and stayed failed with no
// alert and no execution; it was recovered four hours later only from Postgres logs.
//
// The authority here is the SAME verdict object the responder renders. Never HTTP status, never
// execution status, never logs, never the copy shown to the client.
//
// ── WHAT THIS MODULE MUST NEVER LEARN TO DO ────────────────────────────────────────────────────
//
//   · read a payload, a draft, initData, or anything a client sent
//   · classify side effects from `error_code` alone — see SIDE_EFFECT below
//   · claim exactly-once delivery — see ALERT KEY
//   · alert on an expected client refusal
//
var SAE = (function () {
  'use strict';

  var crypto = require('crypto');

  // ── ROUTES ───────────────────────────────────────────────────────────────────────────────────
  //
  // A route is one authoritative verdict point, identified by the workflow and the verdict node.
  // Everything about an event is derived from its route, because `error_code` alone is ambiguous:
  // PIPELINE_WRITE_FAILED on the public web route and on the receipt-backed Mini App route leave
  // DIFFERENT durable state, and a class derived from the code would be wrong on one of them.
  //
  // `sideEffectClass` is fixed per route from the deployed graph order, verified node by node in
  // docs/SYSTEM_ALERT_COVERAGE_DESIGN.md:
  //
  //   A  no irreversible business write was reached on this path
  //   B  state uncertain — a write was attempted, or the cause is not visible from here
  //   C  durable state provably exists before the failure
  //   D  the business commit completed and only the response failed
  //
  var ROUTES = {
    // ── Mini App Submit ──────────────────────────────────────────────────────────────────────
    // Graph order: Submit Guard -> Submit State -> Build Privacy Record -> Write Privacy
    // Acknowledgement -> Privacy Verdict -> Receipt Probe/Preallocate/Readback -> Receipt Verdict
    // -> Build Intake Payload -> Call Lead Intake -> Parse Intake Result.
    'miniapp-submit:Privacy Verdict': {
      operation: 'Не удалось подтвердить согласие на обработку данных.',
      stage: 'Согласие на обработку данных',
      // The privacy INSERT was issued and its outcome is exactly what could not be established.
      sideEffectClass: 'B',
      identity: 'submission_key'
    },
    'miniapp-submit:Receipt Verdict': {
      operation: 'Не удалось подтвердить приём обращения.',
      stage: 'Приём обращения',
      // Privacy is COMMITTED before this node runs — Privacy Verdict must pass to reach it — and
      // a receipt may have been preallocated. Durable state provably exists.
      sideEffectClass: 'C',
      identity: 'submission_key'
    },
    'miniapp-submit:Parse Intake Result': {
      operation: 'Не удалось завершить передачу обращения.',
      stage: 'Передача в CRM',
      // Privacy and receipt are both committed, and Lead Intake's internal contract deliberately
      // strips stage/detail/submission_key, so what IT wrote cannot be known from here.
      sideEffectClass: 'B',
      identity: 'submission_key'
    },
    // ── Mini App Session ─────────────────────────────────────────────────────────────────────
    'miniapp-session:Draft Unavailable': {
      operation: 'Черновик анкеты не сохранён.',
      stage: 'Сохранение черновика',
      // The draft write is the only write on this path, and it is the one that failed.
      sideEffectClass: 'A',
      identity: 'app_session_id'
    },
    // ── Mini App Gateway ─────────────────────────────────────────────────────────────────────
    'miniapp-gateway:Claim Store': {
      operation: 'Не удалось запустить Mini App.',
      stage: 'Проверка запуска',
      // The replay claim is the first write; it did not land, and nothing downstream ran.
      sideEffectClass: 'A',
      identity: 'correlation_id'
    },
    'miniapp-gateway:Session Store Verdict': {
      operation: 'Не удалось создать сессию Mini App.',
      stage: 'Создание сессии',
      // The G5 replay claim WAS won and is durable; the session insert is what failed.
      sideEffectClass: 'C',
      identity: 'correlation_id'
    },
    // ── Lead Intake ──────────────────────────────────────────────────────────────────────────
    'lead-intake:Pipeline Write Failed': {
      operation: 'Обращение не записано в Pipeline.',
      stage: 'Запись в Pipeline',
      // The dedup read completed and the append is what failed. Whether a partial row landed is
      // exactly the open question.
      sideEffectClass: 'B',
      identity: 'request_id'
    },
    'lead-intake:Pipeline Merge Failed': {
      operation: 'Не удалось обновить существующее обращение.',
      stage: 'Обновление Pipeline',
      // A prior row provably exists — the merge path is only reached when dedup found one.
      sideEffectClass: 'C',
      identity: 'request_id'
    },
    'lead-intake:CRM Unavailable': {
      operation: 'Приём обращения прерван: CRM недоступна.',
      stage: 'Чтение настроек',
      // Settings is read before any write on this path.
      sideEffectClass: 'A',
      identity: 'request_id'
    },
    // ── Concierge ────────────────────────────────────────────────────────────────────────────
    'concierge:Parse Intake Response': {
      operation: 'Обращение из Telegram не принято.',
      stage: 'Передача в CRM',
      // Reached only AFTER the Bot_Sessions state mutation has its proven outcome: the session is
      // durably marked lead_pending / intake_failed_review_needed.
      sideEffectClass: 'C',
      identity: 'cycle_id'
    }
  };

  // The owner-facing subsystem name. Derived from the route key, never from the caller, and
  // deliberately not the tenant's shouted workflow name.
  var WORKFLOW_LABEL = {
    'miniapp-submit': 'Mini App Submit',
    'miniapp-session': 'Mini App Session',
    'miniapp-gateway': 'Mini App Gateway',
    'lead-intake': 'Lead Intake',
    'concierge': 'Telegram Concierge'
  };

  // ── EXPECTED CLIENT REFUSALS ─────────────────────────────────────────────────────────────────
  //
  // Never alerted. Each is the intended contract working, not an operational failure. Alerting on
  // these would train the owner to ignore the channel, which is worse than not alerting at all.
  //
  // REPLAY_REFUSED is the G5 replay defence WORKING. IDEMPOTENCY_CONFLICT is the identity
  // contract WORKING. NOT_AUTHORISED is the owner-only UAT gate refusing by construction.
  var SILENT_CODES = ['BAD_REQUEST', 'INVALID_PAYLOAD', 'CONSENT_REQUIRED', 'SESSION_INVALID',
    'SESSION_EXPIRED', 'DRAFT_EMPTY', 'NOT_AUTHORISED', 'REPLAY_REFUSED', 'IDEMPOTENCY_CONFLICT'];

  function isSilentCode(code) { return SILENT_CODES.indexOf(String(code || '')) !== -1; }
  function routeOf(workflowKey, verdictNode) { return ROUTES[String(workflowKey) + ':' + String(verdictNode)] || null; }

  // ── THE STRICT ALLOWLIST ─────────────────────────────────────────────────────────────────────
  //
  // Nine fields, and NOTHING else survives. This is a whitelist and not a blacklist on purpose:
  // a blacklist protects against the fields someone thought of, and the field that leaks is
  // always the one added later. An unknown property is dropped, not carried.
  var ALLOWED = ['alert_key', 'occurred_at', 'workflow_key', 'workflow_label', 'operation',
    'stage', 'error_code', 'retryable', 'side_effect_class', 'route_identity'];

  // Never permitted to appear, at any depth, under any name. Checked as a gate rather than
  // trusted to the allowlist alone, so a future field named `meta` cannot smuggle one through.
  var FORBIDDEN_KEYS = ['init_data', 'initdata', 'hash', 'auth_date', 'signature', 'raw_json',
    'draft_json', 'draft', 'payload', 'body', 'phone', 'email', 'contact', 'message', 'text',
    'stack', 'error', 'credentials', 'password', 'token', 'apikey', 'api_key', 'connection',
    'query', 'dsn'];

  // A route identity is a server-derived correlation reference and nothing else. Anything that
  // does not match one of these shapes is dropped rather than passed through, because the field
  // is the one place a caller could hand over free text.
  var IDENTITY_SHAPES = [
    /^sub_[0-9a-f]{32}$/,                 // Mini App submission_key
    /^fmr_[0-9a-f]{32}$/,                 // public web request_id
    /^FIN-\d{10,}-\d{1,4}$/,              // lead_id
    /^[0-9a-f]{8,80}$/,                   // gateway correlation_id / cycle id (hex)
    /^[A-Za-z0-9_.:-]{1,80}$/             // app_session_id / cycle_id, conservative charset
  ];

  function safeIdentity(v) {
    var s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '') { return ''; }
    for (var i = 0; i < IDENTITY_SHAPES.length; i++) {
      if (IDENTITY_SHAPES[i].test(s)) { return s.slice(0, 80); }
    }
    return '';
  }

  function hasForbidden(obj, depth) {
    if (depth > 4 || obj === null || typeof obj !== 'object') { return false; }
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i]).toLowerCase();
      if (FORBIDDEN_KEYS.indexOf(k) !== -1) { return true; }
      if (hasForbidden(obj[keys[i]], depth + 1)) { return true; }
    }
    return false;
  }

  // ── ALERT KEY ────────────────────────────────────────────────────────────────────────────────
  //
  // Deterministic and route-specific. No Date.now, no Math.random, no Telegram message_id, and
  // deliberately NOT the NEW LEAD dispatch identity — that key means "a lead exists", which is
  // the opposite of what most of these events assert.
  //
  //   same route + same logical failure identity + same verdict  -> SAME key
  //   different operation                                        -> different key
  //   different error verdict on the same operation              -> different key
  //
  // THIS IS AN IDENTITY, NOT A DELIVERY GUARANTEE. There is no persistent store in this phase, so
  // duplicate delivery across executions is possible and is accepted (owner decision D3). The key
  // exists so duplicates are recognisable now and so the durable Alert Outbox can adopt the same
  // contract later without a redesign.
  function alertKey(evt) {
    var e = evt || {};
    var material = [
      String(e.workflow_key || ''),
      String(e.stage || ''),
      String(e.operation || ''),
      String(e.error_code || ''),
      String(e.route_identity || '')
    ].join('');
    return 'sa_' + crypto.createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
  }

  // ── NORMALISE ────────────────────────────────────────────────────────────────────────────────
  //
  // Fails CLOSED in both directions: an event that is not a known route does not alert, and an
  // event carrying anything outside the allowlist does not alert either. A malformed caller can
  // therefore make the system quiet, never noisy and never leaky.
  function normalise(raw) {
    var r = (raw && typeof raw === 'object') ? raw : {};
    if (hasForbidden(r, 0)) {
      return { emit: false, reason: 'FORBIDDEN_FIELD', event: null };
    }
    var workflowKey = String(r.workflow_key || '').slice(0, 40);
    var verdictNode = String(r.verdict_node || '').slice(0, 60);
    var route = routeOf(workflowKey, verdictNode);
    if (!route) { return { emit: false, reason: 'UNKNOWN_ROUTE', event: null }; }

    var code = String(r.error_code || '').slice(0, 40);
    if (!/^[A-Z][A-Z0-9_]{2,39}$/.test(code)) { return { emit: false, reason: 'BAD_ERROR_CODE', event: null }; }
    if (isSilentCode(code)) { return { emit: false, reason: 'EXPECTED_CLIENT_REFUSAL', event: null }; }

    var occurred = String(r.occurred_at || '');
    if (!Number.isFinite(Date.parse(occurred))) { occurred = new Date().toISOString(); }

    var event = {
      alert_key: '',
      occurred_at: occurred,
      workflow_key: workflowKey,
      // The SUBSYSTEM, not the step. `stage` is the step, and rendering the same string as both
      // «Workflow» and «Node» is the kind of duplicated noise the owner asked to keep out.
      workflow_label: WORKFLOW_LABEL[workflowKey] || workflowKey,
      operation: route.operation,
      stage: route.stage,
      error_code: code,
      retryable: r.retryable === true,
      // ROUTE-SPECIFIC AND FIXED. Never taken from the caller: a caller that could set its own
      // class could assert "nothing was written" about a path that writes.
      side_effect_class: route.sideEffectClass,
      route_identity: safeIdentity(r.route_identity)
    };
    event.alert_key = alertKey(event);
    return { emit: true, reason: '', event: event };
  }

  // The shipped event may carry ONLY the allowlisted keys. Asserted at the boundary as well as
  // built that way, so a later edit that adds a field has to fail this rather than slip past.
  function isClean(event) {
    if (!event || typeof event !== 'object') { return false; }
    var keys = Object.keys(event);
    for (var i = 0; i < keys.length; i++) {
      if (ALLOWED.indexOf(keys[i]) === -1) { return false; }
    }
    return !hasForbidden(event, 0);
  }

  return {
    ROUTES: ROUTES,
    SILENT_CODES: SILENT_CODES,
    ALLOWED: ALLOWED,
    FORBIDDEN_KEYS: FORBIDDEN_KEYS,
    isSilentCode: isSilentCode,
    routeOf: routeOf,
    safeIdentity: safeIdentity,
    hasForbidden: hasForbidden,
    alertKey: alertKey,
    normalise: normalise,
    isClean: isClean
  };
})();
// =================== END FINMENTOR SYSTEM ALERT EVENT ===================
