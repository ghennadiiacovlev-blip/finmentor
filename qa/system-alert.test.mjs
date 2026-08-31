#!/usr/bin/env node
// FINMENTOR — SYSTEM ALERT COVERAGE. Offline gate.
//
//   node qa/system-alert.test.mjs
//
// No tenant, no Telegram, no Sheets, no mutation. Every assertion runs the REAL module and, where
// the graph is what matters, the REAL candidate node source — never a restatement of either.
//
// The 5055/5062 lesson: proving the function is right proves nothing about the graph that runs
// it. So the alertable/silent matrix is driven through the candidate's own `Normalise Alert
// Event` code, not through an import of the module it inlines.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// An n8n Code node has `require` in scope; an ES module does not. The module and the node source
// are therefore evaluated with `require` supplied, and with NOTHING else — a module that reached
// for anything beyond `crypto` would fail here rather than in production.
const require_ = createRequire(import.meta.url);
const sandboxRequire = (m) => {
  if (m === 'crypto') { return require_('crypto'); }
  throw new Error('the alert code required an unexpected module: ' + m);
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const EVENT_SRC = read('n8n/src/system-alert/event.js');
const PRESENTER_SRC = read('n8n/src/lead-alerts/presenter.js');
const CAND = JSON.parse(read('n8n/candidate/system-alert-workflow.json'));
const CALLERS_PATH = 'n8n/candidate/system-alert-callers.json';
const CALLERS = existsSync(join(ROOT, CALLERS_PATH)) ? JSON.parse(read(CALLERS_PATH)) : null;

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (a !== b) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

const SAE = new Function('require', EVENT_SRC + '; return SAE;')(sandboxRequire);
// The presenter is a CommonJS module and is loaded as one — the same way
// qa/lead-alerts-presentation.test.mjs loads it, so both gates drive one object.
const LA = require_(join(ROOT, 'n8n', 'src', 'lead-alerts', 'presenter.js'));
const nodeOf = (n) => (CAND.nodes || []).find((x) => x.name === n);

// Source scans must read CODE, not prose. The module documents that it uses no Telegram
// message_id and promises no exactly-once delivery — and a scan that cannot tell a comment from
// an identifier reports those very sentences as the defect they forbid.
const codeOnly = (src) => String(src)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// The candidate's OWN normalise node, executed. `$input.first().json` is shimmed; everything
// else is the shipped source.
function runNormalise(raw) {
  const src = nodeOf('Normalise Alert Event').parameters.jsCode;
  const $input = { first: () => ({ json: raw }) };
  return new Function('$input', 'require', src)($input, sandboxRequire)[0].json;
}

console.log('');
console.log('FINMENTOR SYSTEM ALERT coverage');
console.log('');

// ── the ten alertable operational paths (owner correction D4: TEN, not nine) ───────────────────
console.log('ALERTABLE OPERATIONAL PATHS — all ten');

const ALERTABLE = [
  ['1  PRIVACY_UNRESOLVED', 'miniapp-submit', 'Privacy Verdict', 'PRIVACY_UNRESOLVED', 'sub_' + 'a'.repeat(32), 'B'],
  ['2  receipt invariant broken', 'miniapp-submit', 'Receipt Verdict', 'SUBMIT_UNRESOLVED', 'sub_' + 'b'.repeat(32), 'C'],
  ['3  Intake unresolved', 'miniapp-submit', 'Parse Intake Result', 'SUBMIT_UNRESOLVED', 'sub_' + 'c'.repeat(32), 'B'],
  ['4  TEMPORARY_BACKEND_ERROR', 'miniapp-session', 'Draft Unavailable', 'TEMPORARY_BACKEND_ERROR', 'app-sess-1', 'A'],
  ['5  REPLAY_STORE_UNAVAILABLE', 'miniapp-gateway', 'Claim Store', 'REPLAY_STORE_UNAVAILABLE', 'deadbeef12345678', 'A'],
  ['6  Gateway session store failure', 'miniapp-gateway', 'Session Store Verdict', 'SESSION_STORE_UNAVAILABLE', 'deadbeef12345678', 'C'],
  ['7  PIPELINE_WRITE_FAILED', 'lead-intake', 'Pipeline Write Failed', 'PIPELINE_WRITE_FAILED', 'fmr_' + '1'.repeat(32), 'B'],
  ['8  PIPELINE_MERGE_FAILED', 'lead-intake', 'Pipeline Merge Failed', 'PIPELINE_MERGE_FAILED', 'fmr_' + '2'.repeat(32), 'C'],
  ['9  CRM_UNAVAILABLE', 'lead-intake', 'CRM Unavailable', 'CRM_UNAVAILABLE', 'fmr_' + '3'.repeat(32), 'A'],
  ['10 Concierge intake failure', 'concierge', 'Parse Intake Response', 'INTAKE_NOT_OK', 'cycle-2026-08-31', 'C']
];

eq(ALERTABLE.length, 10, 'the alertable set must hold TEN paths (owner correction D4)');

for (const [label, wfKey, node, code, ident, cls] of ALERTABLE) {
  check(label + ' -> ALERT', () => {
    const out = runNormalise({ workflow_key: wfKey, verdict_node: node, error_code: code,
      retryable: true, route_identity: ident, occurred_at: '2026-08-31T10:00:00.000Z' });
    eq(out.emit, 1, 'it did not alert');
    assert(out.event, 'no event was produced');
    eq(out.event.error_code, code, 'the error_code changed');
    eq(out.event.side_effect_class, cls, 'the side-effect class is not the route-specific one');
    assert(/^sa_[0-9a-f]{32}$/.test(out.event.alert_key), 'the alert_key is not canonical: ' + out.event.alert_key);
  });
}

// ── the expected client refusals ───────────────────────────────────────────────────────────────
console.log('');
console.log('EXPECTED CLIENT REFUSALS — silent, on a route that otherwise alerts');

const SILENT = [
  ['11 SESSION_INVALID', 'SESSION_INVALID'],
  ['12 SESSION_EXPIRED', 'SESSION_EXPIRED'],
  ['13 CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
  ['14 NOT_AUTHORISED', 'NOT_AUTHORISED'],
  ['15 malformed request', 'BAD_REQUEST'],
  ['16 REPLAY_REFUSED', 'REPLAY_REFUSED'],
  ['17 IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT']
];
for (const [label, code] of SILENT) {
  check(label + ' -> SILENT', () => {
    const out = runNormalise({ workflow_key: 'miniapp-submit', verdict_node: 'Parse Intake Result',
      error_code: code, retryable: false, route_identity: 'sub_' + 'd'.repeat(32) });
    eq(out.emit, 0, 'an expected client refusal alerted the owner');
    eq(out.silent_reason, 'EXPECTED_CLIENT_REFUSAL', 'it was silenced for the wrong reason');
    eq(out.event, null, 'a silenced refusal still produced an event');
  });
}

check('18 the success path never reaches the alert authority at all', () => {
  // There is no success verdict node in ROUTES, so a success event is structurally unroutable.
  const out = runNormalise({ workflow_key: 'miniapp-submit', verdict_node: 'Respond Submit OK',
    error_code: 'OK', retryable: false });
  eq(out.emit, 0, 'a success alerted');
  eq(out.silent_reason, 'UNKNOWN_ROUTE', 'success was silenced by code rather than by route');
  const names = Object.keys(SAE.ROUTES);
  assert(!names.some((k) => /Respond .*OK|Success/i.test(k)), 'a success node is registered as an alert route');
});

// ── the structural guarantees ──────────────────────────────────────────────────────────────────
console.log('');
console.log('STRUCTURE — what the graph makes impossible');

check('21 the SYSTEM ALERT workflow cannot call itself or any business workflow', () => {
  // EXACT type. `executeWorkflowTrigger` is the entry point and is not a call — a substring
  // match here would report the required trigger as a defect.
  const calls = CAND.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow');
  eq(calls.length, 0, 'the alert workflow calls out: ' + calls.map((n) => n.name).join(', '));
  const triggers = CAND.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  eq(triggers.length, 1, 'the alert workflow must have exactly one Execute Workflow trigger');
});

check('22 a Telegram failure cannot recurse: fail-quiet send, and no error route', () => {
  const tg = nodeOf('Telegram System Alert');
  eq(tg.onError, 'continueRegularOutput', 'the Telegram send can throw');
  assert(CAND.settings.errorWorkflow === undefined, 'the alert workflow has an errorWorkflow — a failure would alert about the alert');
  const down = (CAND.connections['Telegram System Alert'] || {}).main || [];
  eq(down.flat().length, 0, 'something runs after the Telegram send');
});

check('the alert workflow writes nothing anywhere', () => {
  const writers = CAND.nodes.filter((n) => /dataTable|postgres|supabase/i.test(n.type)
    || (n.type === 'n8n-nodes-base.googleSheets' && (n.parameters.operation || 'read') !== 'read'));
  eq(writers.map((n) => n.name).join(', '), '', 'the alert workflow can write');
  const sheets = CAND.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets');
  eq(sheets.length, 1, 'exactly one Sheets node — the approved owner-destination read');
  assert(sheets[0].parameters.operation === undefined, 'the Settings node declares a non-read operation');
});

check('23 no sensitive data can enter the alert event', () => {
  const dirty = {
    workflow_key: 'miniapp-submit', verdict_node: 'Privacy Verdict',
    error_code: 'PRIVACY_UNRESOLVED', retryable: true, route_identity: 'sub_' + 'e'.repeat(32),
    init_data: 'query_id=AAA&user=%7B%22id%22%3A551662084%7D&hash=deadbeef'
  };
  const out = runNormalise(dirty);
  eq(out.emit, 0, 'an event carrying initData was alerted');
  eq(out.silent_reason, 'FORBIDDEN_FIELD', 'the forbidden field was not what stopped it');
  // and every single forbidden key is refused, not just the one above
  for (const k of SAE.FORBIDDEN_KEYS) {
    const probe = { workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
      error_code: 'CRM_UNAVAILABLE', retryable: true };
    probe[k] = 'x';
    eq(runNormalise(probe).emit, 0, 'a forbidden key passed the gate: ' + k);
  }
});

check('the emitted event carries ONLY the allowlisted fields', () => {
  const out = runNormalise({ workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
    error_code: 'CRM_UNAVAILABLE', retryable: true, route_identity: 'fmr_' + '4'.repeat(32) });
  const keys = Object.keys(out.event).sort();
  eq(keys.join(','), SAE.ALLOWED.slice().sort().join(','), 'the event shape drifted from the allowlist');
  assert(SAE.isClean(out.event), 'isClean() rejects the event the graph produced');
});

check('free text in route_identity is dropped, not carried', () => {
  const out = runNormalise({ workflow_key: 'lead-intake', verdict_node: 'CRM Unavailable',
    error_code: 'CRM_UNAVAILABLE', retryable: true,
    route_identity: 'Ion Popescu, +373 60 000 000, ion@alfa.md' });
  eq(out.event.route_identity, '', 'client free text survived in the route identity');
});

// ── alert key ──────────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('ALERT KEY — deterministic, route-specific, and honest about what it is not');

check('same route + same identity + same verdict -> SAME key', () => {
  const e = { workflow_key: 'miniapp-submit', verdict_node: 'Receipt Verdict',
    error_code: 'SUBMIT_UNRESOLVED', retryable: true, route_identity: 'sub_' + 'f'.repeat(32) };
  const a = runNormalise(Object.assign({}, e, { occurred_at: '2026-08-31T10:00:00.000Z' }));
  const b = runNormalise(Object.assign({}, e, { occurred_at: '2026-08-31T18:44:02.000Z' }));
  eq(a.event.alert_key, b.event.alert_key, 'the key moved with the clock');
});

check('different operation -> DIFFERENT key', () => {
  const id = 'sub_' + '9'.repeat(32);
  const a = runNormalise({ workflow_key: 'miniapp-submit', verdict_node: 'Receipt Verdict', error_code: 'SUBMIT_UNRESOLVED', retryable: true, route_identity: id });
  const b = runNormalise({ workflow_key: 'miniapp-submit', verdict_node: 'Parse Intake Result', error_code: 'SUBMIT_UNRESOLVED', retryable: true, route_identity: id });
  assert(a.event.alert_key !== b.event.alert_key, 'two different operations share one key');
});

check('different verdict on the same operation -> DIFFERENT key', () => {
  const base = { workflow_key: 'lead-intake', verdict_node: 'Pipeline Write Failed', retryable: true, route_identity: 'fmr_' + '5'.repeat(32) };
  const a = runNormalise(Object.assign({}, base, { error_code: 'PIPELINE_WRITE_FAILED' }));
  const b = runNormalise(Object.assign({}, base, { error_code: 'CRM_UNAVAILABLE' }));
  assert(a.event.alert_key !== b.event.alert_key, 'two different verdicts share one key');
});

check('different identity on the same route -> DIFFERENT key', () => {
  const base = { workflow_key: 'miniapp-submit', verdict_node: 'Receipt Verdict', error_code: 'SUBMIT_UNRESOLVED', retryable: true };
  const a = runNormalise(Object.assign({}, base, { route_identity: 'sub_' + '1'.repeat(32) }));
  const b = runNormalise(Object.assign({}, base, { route_identity: 'sub_' + '2'.repeat(32) }));
  assert(a.event.alert_key !== b.event.alert_key, 'two separate failures share one key');
});

check('the key uses no clock and no randomness — asserted on the source', () => {
  const src = codeOnly(String(SAE.alertKey));
  assert(!/Date\.now|new Date|Math\.random/.test(src), 'the alert key derivation reads a clock or a PRNG');
  const s = codeOnly(nodeOf('Normalise Alert Event').parameters.jsCode);
  assert(!/message_id/i.test(s), 'the alert identity references a Telegram message_id');
  // and the occurred_at that IS a clock never reaches the key material
  assert(!/occurred_at/.test(src), 'the alert key is derived from a timestamp');
});

check('D7 nothing in the graph claims durable dedup', () => {
  // No persistent store exists in this phase, so no node may be NAMED as one and no shipped
  // string may promise one. Comments are stripped first: the module documents that it makes no
  // exactly-once claim, and that sentence is the guarantee, not a violation of it.
  const names = CAND.nodes.map((n) => n.name).join(' | ');
  assert(!/dedup|deduplicat|exactly.?once|idempot/i.test(names),
    'a node name claims dedup the workflow cannot perform: ' + names);
  for (const n of CAND.nodes) {
    const code = codeOnly(n.parameters?.jsCode || '');
    assert(!/exactly.?once/i.test(code), 'executable code in ' + n.name + ' claims exactly-once delivery');
  }
  // The owner-facing message is where such a claim would actually do harm.
  const html = LA.renderSystemAlert({ workflowName: 'x', nodeName: 'y', operation: 'z',
    sideEffectClass: 'B', errorClass: '', message: '', executionId: '' });
  assert(!/один раз|exactly.?once|дубл/i.test(html), 'the owner message claims exactly-once delivery');
  const store = CAND.nodes.filter((n) => /dataTable|postgres/i.test(n.type));
  eq(store.length, 0, 'the alert workflow has a store node but claims no durable state');
});

// ── presentation ───────────────────────────────────────────────────────────────────────────────
console.log('');
console.log('PREMIUM COPY — approved language, no false claims');

check('every side-effect class renders its own truthful data statement', () => {
  const base = { workflowName: 'Mini App Submit', nodeName: 'Mini App · Submit', operation: 'Не удалось завершить передачу обращения.', errorClass: '', message: '', executionId: '' };
  const A = LA.renderSystemAlert(Object.assign({}, base, { sideEffectClass: 'A' }));
  const B = LA.renderSystemAlert(Object.assign({}, base, { sideEffectClass: 'B' }));
  const C = LA.renderSystemAlert(Object.assign({}, base, { sideEffectClass: 'C' }));
  const D = LA.renderSystemAlert(Object.assign({}, base, { sideEffectClass: 'D' }));
  assert(A.includes('Необратимая бизнес-запись не была достигнута.'), 'class A does not state the proven pre-write failure');
  assert(B.includes('Состояние связанных записей требует проверки.'), 'class B does not ask for verification');
  assert(C.includes('До сбоя часть данных уже была сохранена.'), 'class C does not state that durable state exists');
  assert(D.includes('Операция уже была завершена'), 'class D does not state the commit completed');
  // The one claim none of them may make.
  for (const [n, html] of [['A', A], ['B', B], ['C', C], ['D', D]]) {
    assert(!/Лид не создан|Pipeline не изменён|privacy-запись не создана/i.test(html),
      'class ' + n + ' makes an unproven side-effect claim');
  }
  assert(!B.includes('Необратимая бизнес-запись не была достигнута.'), 'class B claims nothing was written');
  assert(!C.includes('Необратимая бизнес-запись не была достигнута.'), 'class C claims nothing was written');
});

check('the existing errorTrigger model still renders BYTE-IDENTICALLY', () => {
  // The Error Monitor passes no operation and no sideEffectClass. Its output must not move.
  const legacy = LA.renderSystemAlert({
    workflowName: 'FINMENTOR Lead Intake PREMIUM FINAL', nodeName: 'Save to Pipeline',
    errorClass: 'RATE_LIMIT', message: 'quota exceeded', executionId: '4239'
  });
  assert(legacy.includes('<b>FINMENTOR · SYSTEM ALERT</b>'), 'the header changed');
  assert(legacy.includes('Последствия для записей автоматически не проверены.'),
    'the errorTrigger data statement changed — existing alerts are not byte-equivalent');
  assert(legacy.includes('Лид, Pipeline и privacy-запись нужно проверить вручную.'), 'the second legacy line changed');
  assert(legacy.includes('Приём заявки прерван.'), 'the workflow-name impact derivation changed');
  assert(!/Код:|Повтор:|Идентификатор:/.test(legacy), 'the new technical lines appear on a model that carries none');
});

check('the operation is the headline when the route names one', () => {
  const html = LA.renderSystemAlert({ workflowName: 'x', nodeName: 'Mini App · Submit',
    operation: 'Не удалось завершить передачу обращения.', sideEffectClass: 'B', errorClass: '', message: '', executionId: '' });
  assert(html.includes('<b>Не удалось завершить передачу обращения.</b>'), 'the operation is not the headline');
  assert(html.includes('Сбой на этапе «Mini App · Submit»'), 'the stage is not shown');
  assert(html.includes('<b>Требует проверки</b>'), 'the status card changed');
});

check('the technical block carries the reference and nothing sensitive', () => {
  const html = LA.renderSystemAlert({ workflowName: 'x', nodeName: 'Lead Intake · Pipeline',
    operation: 'Обращение не записано в Pipeline.', sideEffectClass: 'B',
    errorCode: 'PIPELINE_WRITE_FAILED', retryable: true, routeIdentity: 'fmr_' + '7'.repeat(32),
    errorClass: '', message: '', executionId: '' });
  assert(html.includes('Код: PIPELINE_WRITE_FAILED'), 'the error code is missing');
  assert(html.includes('Повтор: возможен'), 'retryability is missing');
  assert(html.includes('fmr_' + '7'.repeat(32)), 'the correlation reference is missing');
  assert(!/@|\+373|initData|hash=/i.test(html), 'contact or auth material reached the message');
});

// ── the module and the graph cannot drift ──────────────────────────────────────────────────────
console.log('');
console.log('DRIFT — the shipped copy is the tested copy');

check('the candidate inlines the event module byte-for-byte', () => {
  const s = nodeOf('Normalise Alert Event').parameters.jsCode.replace(/\r\n/g, '\n');
  assert(s.includes(EVENT_SRC.trim()), 'the inlined event module is not byte-identical to n8n/src/system-alert/event.js');
});

check('the candidate inlines the presenter byte-for-byte', () => {
  // The same prefix rule qa/lead-alerts-candidates.test.mjs uses: a CommonJS module is inlined as
  // an IIFE, so the shipped copy contains everything UP TO `module.exports`, not the raw file.
  const body = PRESENTER_SRC.slice(0, PRESENTER_SRC.lastIndexOf('module.exports = '));
  const s = nodeOf('Build System Alert').parameters.jsCode.replace(/\r\n/g, '\n');
  assert(s.includes(body), 'the inlined presenter is not byte-identical to n8n/src/lead-alerts/presenter.js');
  assert(s.includes('DO NOT EDIT HERE'), 'the inline warning was removed');
});

// THE BOTH-HALVES RULE. Asserting that the module is inlined proves nothing about whether the
// node RUNS: a raw `module.exports` inline matches byte-for-byte and then throws
// "LA is not defined" in production. Execution 5071 cost one live run to find. So the node is
// executed here, exactly as n8n executes it.
check('the candidate BUILD node actually runs and renders the alert', () => {
  const src = nodeOf('Build System Alert').parameters.jsCode;
  const event = { workflow_label: 'Mini App · Gateway', stage: 'Mini App · Gateway',
    operation: 'Не удалось запустить Mini App.', side_effect_class: 'A',
    error_code: 'REPLAY_STORE_UNAVAILABLE', retryable: true, route_identity: 'abcdef0123456789',
    alert_key: 'sa_' + '0'.repeat(32) };
  const $ = (n) => {
    if (n === 'Normalise Alert Event') { return { first: () => ({ json: { event: event } }) }; }
    throw new Error('the build node reached for an unexpected node: ' + n);
  };
  const out = new Function('$', 'require', src)($, sandboxRequire)[0].json;
  assert(typeof out.alert_html === 'string' && out.alert_html.length > 0, 'the build node rendered nothing');
  assert(out.alert_html.includes('<b>FINMENTOR · SYSTEM ALERT</b>'), 'the rendered alert is not the approved chrome');
  assert(out.alert_html.includes('Не удалось запустить Mini App.'), 'the operation is not the headline');
  assert(out.alert_html.includes('Необратимая бизнес-запись не была достигнута.'), 'the class-A statement is missing');
  eq(out.alert_key, event.alert_key, 'the alert key was not carried through');
});

check('the route table covers exactly the ten alertable paths and nothing else', () => {
  eq(Object.keys(SAE.ROUTES).length, 10, 'the route table is not ten routes');
  for (const [, wfKey, node] of ALERTABLE) {
    assert(SAE.routeOf(wfKey, node), 'a required route is missing: ' + wfKey + ':' + node);
  }
});

check('D5 no route derives its class from the error_code', () => {
  // The same code on two routes must be allowed to carry different classes, and does.
  const a = SAE.routeOf('lead-intake', 'Pipeline Write Failed');
  const b = SAE.routeOf('lead-intake', 'Pipeline Merge Failed');
  assert(a.sideEffectClass !== b.sideEffectClass,
    'two Pipeline routes share a class — the classification is not route-specific');
  const src = String(SAE.normalise);
  assert(/route\.sideEffectClass/.test(src), 'the class is not taken from the route');
  assert(!/r\.side_effect_class|raw\.side_effect_class/.test(src), 'the caller can set its own side-effect class');
});

// ── callers, once the caller candidate exists ──────────────────────────────────────────────────
if (CALLERS) {
  console.log('');
  console.log('CALLERS — ordering, independence and blast radius');

  check('19+20 every emit is downstream of a responder, and waits for nothing', () => {
    for (const c of CALLERS.emits) {
      eq(c.waitForSubWorkflow, false, c.workflow + '/' + c.node + ' waits for the alert');
      assert(c.after_responder || c.workflow === 'concierge',
        c.workflow + '/' + c.node + ' is not downstream of a responder');
      eq(c.onError, 'continueRegularOutput', c.workflow + '/' + c.node + ' can fail its caller');
    }
  });

  check('19 no responder parameter changed', () => {
    for (const r of CALLERS.responder_hashes) {
      eq(r.after, r.before, 'responder changed: ' + r.workflow + '/' + r.node);
    }
  });

  check('24 no caller gained a credential', () => {
    for (const c of CALLERS.emits) { eq(c.credentials, 0, c.workflow + '/' + c.node + ' carries a credential'); }
    eq(CALLERS.credential_delta, 0, 'a caller workflow gained or lost a credential');
  });

  check('25 no retention or errorWorkflow setting changed', () => {
    for (const s of CALLERS.settings) {
      eq(s.after, s.before, 'settings changed on ' + s.workflow + ' — owner decisions D1/D2 forbid it');
    }
  });
}

console.log('');
console.log('  ' + pass + ' passed, ' + failures.length + ' failed');
console.log('');
for (const f of failures) { console.log('  FAILED: ' + f); }
if (failures.length) { process.exitCode = 1; }
