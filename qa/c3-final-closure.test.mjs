#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — C3 offline acceptance gate.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compileFile } from '../scripts/lib/compile-workflow-sdk.mjs';
import {
  IDS, patchCommandCenter, patchLeadIntake, readC3Sources, workflowShape
} from '../scripts/lib/c3-final-closure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const load = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
const sources = readC3Sources(ROOT);
const intakeBase = load('n8n/candidate/lead-intake-premium-source-candidate.json');
const commandBase = load('n8n/candidate/lead-command-center-ack-fix-candidate.json');
const intake = patchLeadIntake(intakeBase, sources);
const command = patchCommandCenter(commandBase, sources);
const xray = compileFile(join(ROOT, 'n8n/candidate/xray-analysis-workflow.sdk.js'), {});
const alert = require_(join(ROOT, 'n8n/src/lead-intelligence/alert.js'));

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
const byName = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(workflow.name + ': missing ' + name);
  return found;
};
const targets = (workflow, name, output = 0) =>
  (((workflow.connections[name] || {}).main || [])[output] || []).map((item) => item.node);
function reachable(workflow, start) {
  const seen = new Set();
  (function walk(name) {
    for (const branch of ((workflow.connections[name] || {}).main || [])) for (const next of branch || []) {
      if (!seen.has(next.node)) { seen.add(next.node); walk(next.node); }
    }
  })(start);
  return seen;
}
function handle(values) {
  const items = values.map((json) => ({ json }));
  return { first: () => items[0], all: () => items, isExecuted: true };
}
function runCode(code, named = {}, input = []) {
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(named, name)) throw new Error('node not executed: ' + name);
    return handle(named[name]);
  };
  return new Function('$', '$input', code)($, handle(input));
}

check('C3.1 canonical NEW commit resumes Restore Lead Context', () => {
  eq(targets(intake, 'IF Committed (New)', 0), ['Restore Lead Context'], 'settled true output');
  eq(targets(intake, 'IF Committed (New)', 1), ['Internal Result (Unresolved)'], 'unresolved output');
});

check('C3.1 post-commit route reaches priority, CRM source, intelligence and narrow result', () => {
  const reached = reachable(intake, 'IF Committed (New)');
  for (const name of ['Route by Lead Priority', 'Save Lead to CRM', 'Build C3 Intelligence Request',
    'Run Owner Intelligence (C3)', 'Internal Result (New)']) assert(reached.has(name), 'not reached: ' + name);
});

check('C3.1 intelligence starts only after Leads source write', () => {
  eq(targets(intake, 'Save Lead to CRM'), ['Build C3 Intelligence Request'], 'post-Leads dispatch');
  eq(targets(intake, 'Build C3 Intelligence Request'), ['Run Owner Intelligence (C3)'], 'dispatch call');
  eq(targets(intake, 'Run Owner Intelligence (C3)'), ['Internal Result (New)'], 'return convergence');
});

check('C3.1 exactly one X-Ray call targets the accepted workflow and waits', () => {
  const calls = intake.nodes.filter((item) => item.name === 'Run Owner Intelligence (C3)');
  eq(calls.length, 1, 'C3 call count');
  eq(calls[0].parameters.workflowId.value, IDS.xray, 'X-Ray workflow id');
  assert(calls[0].parameters.options.waitForSubWorkflow === true, 'call does not wait');
});

check('C3.1 public input emits no internal intelligence request', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: false, lead_id: 'FIN-PUBLIC', request_id: 'req-public' }],
    'Commit Verdict (New)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  }, [{}]);
  eq(out.length, 0, 'public request count');
});

check('C3.1 authenticated request requires proven one-row commit', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: true, lead_id: 'FIN-C3', request_id: 'req-c3' }],
    'Commit Verdict (New)': [{ __commit_updated_rows: 0, __commit_ok: 0 }]
  }, [{}]);
  eq(out, [], 'uncommitted request was dispatched');
});

check('C3.1 authenticated committed request is a one-item closed envelope', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: true, lead_id: 'FIN-C3-ONE', request_id: 'req-c3-one' }],
    'Commit Verdict (New)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  }, [{}]);
  eq(out, [{ json: { event: 'ELIGIBLE_NEW_COMMITTED', lead_id: 'FIN-C3-ONE', request_id: 'req-c3-one',
    eligible: true, commit_authority: 'RECEIPT_COMMIT', source_workflow_id: IDS.intake } }], 'C3 envelope');
});

check('C3.4 legacy short-alert builders are unchanged after the internal-only guard', () => {
  const guard = '// C3: authenticated committed NEW leads use the single X-Ray owner-intelligence alert.\n'
    + 'if ($input.first().json.provenance_trusted === true) return [];\n';
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']) {
    eq(byName(intake, name).parameters.jsCode, guard + byName(intakeBase, name).parameters.jsCode, name + ' delta');
    eq(runCode(byName(intake, name).parameters.jsCode, {}, [{ provenance_trusted: true }]).length, 0, name + ' internal output');
  }
});

check('C3.4 replay and refusal terminals cannot re-enter C3', () => {
  for (const name of ['Internal Result (Committed Replay)', 'Internal Result (Retry)', 'Internal Result (Unresolved)',
    'Internal Result (Invalid)', 'Internal Result (Fault)', 'Internal Result (Correlation)', 'Internal Result (Infra)',
    'Internal Result (PipelineFailed)']) assert(!reachable(intake, name).has('Build C3 Intelligence Request'), name + ' re-enters C3');
});

check('C3.4 no second lead-creation node was added', () => {
  eq(intake.nodes.filter((item) => item.name === 'Save to Pipeline').length, 1, 'Pipeline commit count');
  eq(intake.nodes.filter((item) => item.name === 'Save Lead to CRM').length, 1, 'Leads archive count');
});

check('C3.2 callback validation accepts a basic private-human envelope', () => {
  const update = { update_id: 1, callback_query: { id: 'cb-c3', data: 'done|FIN-C3',
    from: { id: 100001, is_bot: false }, message: { message_id: 3, chat: { id: 100001, type: 'private' } } } };
  const out = runCode(sources.callbackValidate, {}, [update])[0].json;
  assert(out.c3_basic_callback_valid === true && out.c3_callback_query_id === 'cb-c3', 'valid callback rejected');
  assert(out.c3_original_update === update, 'original envelope not preserved');
});

check('C3.2 callback validation rejects bot, group, identity split and empty data', () => {
  const base = { id: 'cb', data: 'done|FIN-C3', from: { id: 10, is_bot: false },
    message: { message_id: 3, chat: { id: 10, type: 'private' } } };
  const cases = [
    { ...base, from: { id: 10, is_bot: true } },
    { ...base, message: { message_id: 3, chat: { id: -10, type: 'group' } } },
    { ...base, message: { message_id: 3, chat: { id: 11, type: 'private' } } },
    { ...base, data: '' }
  ];
  for (const callback_query of cases) {
    const out = runCode(sources.callbackValidate, {}, [{ callback_query }])[0].json;
    assert(out.c3_basic_callback_valid === false && out.c3_callback_query_id === '', 'bad callback accepted');
  }
});

check('C3.2 strict graph order is Trigger → validate → ACK → identity → Sheets', () => {
  eq(targets(command, 'Telegram Command Trigger'), ['Validate Basic Callback Envelope'], 'trigger target');
  eq(targets(command, 'Validate Basic Callback Envelope'), ['IF Basic Callback Envelope'], 'validator target');
  eq(targets(command, 'IF Basic Callback Envelope', 0), ['Answer Callback Query'], 'callback true target');
  eq(targets(command, 'Answer Callback Query'), ['Restore Command Envelope'], 'ACK target');
  eq(targets(command, 'Restore Command Envelope'), ['Verify Telegram Identity'], 'restored identity target');
  eq(targets(command, 'Verify Telegram Identity'), ['Read Settings'], 'Settings target');
});

check('C3.2 message path bypasses ACK but restores the original envelope', () => {
  eq(targets(command, 'IF Basic Callback Envelope', 1), ['Restore Command Envelope'], 'non-callback target');
  const update = { update_id: 2, message: { text: '/today', from: { id: 10 }, chat: { id: 10, type: 'private' } } };
  const checked = runCode(sources.callbackValidate, {}, [update])[0].json;
  const restored = runCode(sources.callbackRestore, { 'Validate Basic Callback Envelope': [checked] }, [checked]);
  assert(restored[0].json === update, 'message envelope changed');
});

check('C3.2 there is exactly one neutral callback ACK and no false-success wording', () => {
  const ackNodes = command.nodes.filter((item) => item.type === 'n8n-nodes-base.telegram' && item.parameters.resource === 'callback');
  eq(ackNodes.length, 1, 'callback ACK count');
  eq(ackNodes[0].parameters.queryId, '={{ $json.c3_callback_query_id }}', 'ACK query id');
  eq(ackNodes[0].parameters.additionalFields.text, 'Принято', 'ACK text');
  assert(!/готов|сохран|обнов|выполн|completed|saved|updated/i.test(ackNodes[0].parameters.additionalFields.text), 'false success ACK');
});

check('C3.2 old late ACK edge is removed', () => {
  assert(!targets(command, 'Parse Lead Command v2').includes('IF Has Callback'), 'parser still triggers late ACK');
  eq(targets(command, 'IF Has Callback'), [], 'late ACK branch still connected');
});

check('C3.1 X-Ray has one internal trigger and preserves its schedule trigger', () => {
  eq(xray.nodes.filter((item) => item.type === 'n8n-nodes-base.executeWorkflowTrigger').map((item) => item.name), ['C3 Lead Intelligence Trigger'], 'internal triggers');
  eq(xray.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').map((item) => item.name), ['Every 10 Minutes'], 'schedule triggers');
  eq(byName(xray, 'Every 10 Minutes').parameters.rule.interval[0].expression, '0,30 8-19 * * 1-5', 'schedule expression');
});

check('C3.1 targeted X-Ray joins the existing approved intelligence chain at Read Settings', () => {
  eq(targets(xray, 'C3 Lead Intelligence Trigger'), ['Validate C3 Lead Target'], 'C3 target validator');
  eq(targets(xray, 'Validate C3 Lead Target'), ['Read Settings'], 'existing chain join');
  eq(targets(xray, 'Every 10 Minutes'), ['Read Settings'], 'scheduled join');
});

check('C3.1 target validator rejects an untrusted event or source', () => {
  for (const bad of [
    { event: 'OTHER', lead_id: 'FIN-C3', request_id: 'req', source_workflow_id: IDS.intake },
    { event: 'AUTHENTICATED_NEW_COMMITTED', lead_id: 'FIN-C3', request_id: 'req', source_workflow_id: 'other' }
  ]) {
    let threw = false; try { runCode(sources.xrayTarget, {}, [bad]); } catch (error) { threw = true; }
    assert(threw, 'untrusted target accepted');
  }
});

check('C3.1 exact target selects one eligible unanalysed lead only', () => {
  const settings = { settings: { xray_analysis_enabled: true, xray_analysis_since: '2026-01-01', xray_max_per_run: 3 } };
  const pipeline = [
    { lead_id: 'FIN-C3-A', priority: 'HOT', status: 'Qualified', created_at: '2026-09-15T00:00:00Z' },
    { lead_id: 'FIN-C3-B', priority: 'WARM', status: 'New', created_at: '2026-09-15T00:01:00Z' }
  ];
  const out = runCode(sources.selectPending, {
    'Settings to Object': [settings], 'Read XRay_Analysis': [{}], 'Read Pipeline': pipeline,
    'Validate C3 Lead Target': [{ c3_targeted: true, c3_target_eligible: true, c3_target_lead_id: 'FIN-C3-B' }]
  }, [{}]);
  eq(out.length, 1, 'targeted count');
  assert(out[0].json.lead_id === 'FIN-C3-B' && out[0].json.analysis_mode === 'NEW_ANALYSIS' && out[0].json.c3_targeted === true, 'wrong target');
});

check('C3.4 existing ledger row suppresses a duplicate targeted analysis and alert', () => {
  const pipe = { lead_id: 'FIN-C3-B', priority: 'HOT', status: 'Qualified', created_at: '2026-09-15T00:00:00Z' };
  const out = runCode(sources.selectPending, {
    'Settings to Object': [{ settings: { xray_analysis_enabled: true, xray_analysis_since: '2026-01-01' } }],
    'Read XRay_Analysis': [{ analysis_id: 'XA-C3', lead_id: 'FIN-C3-B', review_status: 'AI_DRAFT' }],
    'Read Pipeline': [pipe], 'Validate C3 Lead Target': [{ c3_targeted: true, c3_target_lead_id: 'FIN-C3-B' }]
  }, [{}]);
  eq(out.length, 0, 'duplicate target count');
});

check('C3.3 rendered brief contains identity, importance, problem and contact', () => {
  const text = renderBrief();
  for (const value of ['FINMENTOR · Новый лид', 'Lead ID:', 'FIN-C3-OWNER', 'C3 Synthetic SRL', 'Ирина Власова',
    'Финансовый директор', 'ВАЖНОСТЬ', 'Квалификация:', 'HOT', 'Финансовая зона:', 'ORANGE',
    'КЛЮЧЕВАЯ ПРОБЛЕМА', 'кассовые разрывы', 'КОНТАКТ', '@c3_owner_test']) assert(text.includes(value), 'missing ' + value);
});

check('C3.3 rendered brief contains existing FINMENTOR uncertainty and impact', () => {
  const text = renderBrief();
  for (const value of ['ЧТО ВИДИТ FINMENTOR', 'Быстрый тест', 'Зрелость:', '2/5',
    'РИСКИ / ЧТО НУЖНО ПРОВЕРИТЬ', '• Проверить:']) assert(text.includes(value), 'missing ' + value);
});

check('C3.3 rendered brief contains owner action and at most three existing discovery points', () => {
  const text = renderBrief();
  assert(text.includes('ПЕРВЫЙ РАЗГОВОР'), 'guidance section missing');
  for (const question of ['Как формируется прогноз', 'Кто утверждает платежи', 'Каков цикл дебиторки']) assert(text.includes(question), 'missing question');
  assert(!text.includes('Четвёртый вопрос'), 'fourth question leaked into compact alert');
  assert(text.includes('СЕЙЧАС') && text.includes('Назначить discovery call'), 'owner next action missing');
});

check('C3.3 alert adds no deferred intelligence labels and stays within Telegram limit', () => {
  const text = renderBrief();
  for (const deferred of ['ЖЕЛАЕМЫЙ РЕЗУЛЬТАТ', 'СРОЧНОСТЬ', 'ДОКУМЕНТЫ', 'БЫСТРЫЕ ПОБЕДЫ', 'ФОРМАТ СЛЕДУЮЩЕГО КОНТАКТА']) {
    assert(!text.includes(deferred), 'deferred field rendered: ' + deferred);
  }
  assert(text.length < 4000, 'Telegram body too long: ' + text.length);
});

check('C3.3 visible values are HTML-escaped and no AI/control token is exposed', () => {
  const text = alert.renderLeadIntelligenceAlert({ lead_id: 'FIN-<C3>', company: '<script>', main_pain: 'A < B',
    qualification: 'HOT', financial_zone: 'RED', contact: {}, next_action: 'Проверить' });
  assert(text.includes('FIN-&lt;C3&gt;') && text.includes('&lt;script&gt;') && text.includes('A &lt; B'), 'escaping failed');
  assert(!/<script>|AI_DRAFT|review_token|[a-f0-9]{64}/i.test(text), 'technical value exposed');
});

check('C3 safety: all credential, webhook and schedule authorities are unchanged', () => {
  eq(workflowShape(intake), workflowShape(intakeBase), 'Lead Intake authority shape');
  eq(workflowShape(command), workflowShape(commandBase), 'Command Center authority shape');
  for (const name of ['Build C3 Intelligence Request', 'Run Owner Intelligence (C3)', 'Validate Basic Callback Envelope',
    'IF Basic Callback Envelope', 'Restore Command Envelope', 'C3 Lead Intelligence Trigger', 'Validate C3 Lead Target']) {
    const owner = intake.nodes.find((item) => item.name === name) || command.nodes.find((item) => item.name === name) || xray.nodes.find((item) => item.name === name);
    assert(owner && !owner.credentials, name + ' gained a credential');
  }
});

check('C3 safety: scoring and CRM schema nodes are byte-identical', () => {
  for (const name of ['Normalize + Score Lead', 'Build Pipeline Row', 'Save to Pipeline', 'Dedup Guard']) {
    eq(byName(intake, name), byName(intakeBase, name), name + ' drift');
  }
});

check('C3 safety: original/AI/owner fact authority contract remains present', () => {
  const contract = readFileSync(join(ROOT, 'n8n/src/lead-intelligence/contract.js'), 'utf8');
  assert(contract.includes('CLIENT_FACT') && contract.includes('FINMENTOR_INTERPRETATION') && contract.includes('OWNER_CONFIRMED'), 'authority vocabulary missing');
  assert(contract.includes('owner_confirmed_facts') && contract.includes('client_facts'), 'fact stores missing');
});

check('C3 safety: no client Telegram transport was added', () => {
  const newNodes = [...intake.nodes.slice(intakeBase.nodes.length), ...command.nodes.slice(commandBase.nodes.length),
    ...xray.nodes.filter((item) => ['C3 Lead Intelligence Trigger', 'Validate C3 Lead Target'].includes(item.name))];
  assert(newNodes.every((item) => item.type !== 'n8n-nodes-base.telegram'), 'new client/Telegram sender added');
  assert(byName(xray, 'Telegram Owner Alert').parameters.chatId.includes('owner_chat_id'), 'intelligence alert is not owner-only');
});

function renderBrief() {
  return alert.renderLeadIntelligenceAlert({
    lead_id: 'FIN-C3-OWNER', company: 'C3 Synthetic SRL', contact_name: 'Ирина Власова', role: 'Финансовый директор',
    business: 'Оптовая торговля', scale: '10–20 сотрудников', qualification: 'HOT', financial_zone: 'ORANGE',
    priority_reason: 'Финансовая зона ORANGE; требуется быстрый контроль', main_pain: 'Регулярные кассовые разрывы',
    observation: 'Быстрый тест показывает контроль, но расширенная анкета его не подтверждает',
    maturity: { score_1_to_5: 2, label: 'Реактивное управление' },
    risks: [{ title: 'Непредсказуемый остаток денег' }, { title: 'Просрочка дебиторки' }, { title: 'Не показывать' }],
    needs_verification: { item: 'Актуальный платёжный календарь и правила приоритизации' },
    economic_impact: 'Риск дефицита оборотного капитала и задержки платежей',
    discovery_questions: [
      { question: 'Как формируется прогноз движения денег?' },
      { question: 'Кто утверждает платежи и по каким правилам?' },
      { question: 'Каков цикл дебиторки по ключевым клиентам?' },
      { question: 'Четвёртый вопрос не должен попасть в alert' }
    ],
    contact: { preferred_label: 'Telegram', preferred_contact_channel: 'telegram',
      reachable_channels: [{ key: 'telegram', label: 'Telegram', value: '@c3_owner_test' }] },
    next_action: 'Назначить discovery call и подтвердить исходные данные'
  });
}

console.log(`\nC3 ASSERTIONS: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log('FAILED: ' + failure);
if (failures.length) process.exit(1);
