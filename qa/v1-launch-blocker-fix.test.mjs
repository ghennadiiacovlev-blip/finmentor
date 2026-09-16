#!/usr/bin/env node
// FINMENTOR V1 launch-blocker fix — offline acceptance gate.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IDS, authorityViolations, changedNodes, patchCommand, patchConcierge, patchIntake, patchSystem,
  patchTransport, patchXray, readFixSources
} from '../scripts/lib/v1-launch-blocker-fix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const sources = readFixSources(ROOT);
const clone = (value) => JSON.parse(JSON.stringify(value));
const edge = (name) => ({ node: name, type: 'main', index: 0 });
const node = (name, parameters = {}, extra = {}) => Object.assign({
  id: 'fixture-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name,
  type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters
}, extra);
const workflow = (name, nodes, connections = {}) => ({ name, nodes, connections, settings: { executionOrder: 'v1' } });
const byName = (w, name) => w.nodes.find((item) => item.name === name);
const targets = (w, name, output = 0) => ((((w.connections[name] || {}).main || [])[output]) || []).map((item) => item.node);

let passed = 0; const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
function handle(values, executed = true) {
  const items = values.map((json) => ({ json }));
  return { first: () => items[0], all: () => items, item: items[0], isExecuted: executed };
}
function runCode(code, named = {}, input = []) {
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(named, name)) throw new Error('node not executed: ' + name);
    return handle(named[name]);
  };
  return new Function('$', '$input', 'require', code)($, handle(input), require_);
}

const sessionCode = `const text = '/start ro';
const isStart = text === '/start';
let reset = '';
// [premium] REMOVED: /start no longer resets the cycle. \`if (false)\` rather than a comment,
// because this line heads an if/else chain and commenting it out orphans the \`else\` below.
if (false) { reset = 'start'; }
else if (false) { reset = 'restart'; }
return [{ json: { reset } }];`;
const transportRequestCode = `const MAP = {
  'C|C|C|C': 'L4_CCCC',
};
return [{ json: MAP }];`;
const conciergeBase = workflow('Concierge', [
  node('Get Bot Session', { jsCode: sessionCode }), node('Build Transport Request', { jsCode: transportRequestCode })
]);
const concierge = patchConcierge(conciergeBase);

check('/start patch restores the current-cycle reset and preserves a parseable if/else chain', () => {
  const code = byName(concierge, 'Get Bot Session').parameters.jsCode;
  assert(code.includes("if (isStart) { reset = 'start'; }"), 'reset missing');
  assert(code.includes("/^\\/start"), 'Telegram deep-link start detector missing');
  eq(new Function(code)()[0].json.reset, 'start', '/start ro did not reset');
});
check('Concierge maps four callback rows in HTML mode without changing its graph', () => {
  assert(byName(concierge, 'Build Transport Request').parameters.jsCode.includes("'C|C|C|C#HTML': 'L4_C_HTML'"), 'HTML map missing');
  eq(concierge.connections, conciergeBase.connections, 'graph drift');
});

const l4Rule = { outputKey: 'L4_CCCC', conditions: { conditions: [{ id: 'l4', rightValue: 'L4_CCCC' }] } };
const transportBase = workflow('Transport', [
  node('Validate Transport Payload', { jsCode: "const LAYOUTS = { L4_CCCC: [['C'],['C'],['C'],['C']], };" }),
  node('Route Keyboard Layout', { rules: { values: [clone(l4Rule)] } }, { type: 'n8n-nodes-base.switch', typeVersion: 3.2 }),
  node('Render L4_CCCC', { additionalFields: {} }, { type: 'n8n-nodes-base.telegram', typeVersion: 1.2,
    credentials: { telegramApi: { id: 'tg', name: 'Telegram' } } })
], { 'Route Keyboard Layout': { main: [[edge('Render L4_CCCC')], []] } });
const transport = patchTransport(transportBase);
check('Transport validates, routes and renders the new L4_C_HTML layout', () => {
  assert(byName(transport, 'Validate Transport Payload').parameters.jsCode.includes("L4_C_HTML: [['C'],['C'],['C'],['C']]"), 'validator layout missing');
  assert(byName(transport, 'Route Keyboard Layout').parameters.rules.values.some((rule) => rule.outputKey === 'L4_C_HTML'), 'route missing');
  eq(byName(transport, 'Render L4_C_HTML').parameters.additionalFields.parse_mode, 'HTML', 'parse mode');
  eq(targets(transport, 'Route Keyboard Layout', 1), ['Render L4_C_HTML'], 'route output');
});
check('Transport renderer reuses the existing Telegram credential', () => {
  eq(byName(transport, 'Render L4_C_HTML').credentials, byName(transportBase, 'Render L4_CCCC').credentials, 'credential drift');
});

const OLD_GUARD = '// C3: authenticated committed NEW leads use the single X-Ray owner-intelligence alert.\n'
  + 'if ($input.first().json.provenance_trusted === true) return [];\n';
const intakeNodes = ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']
  .map((name) => node(name, { jsCode: OLD_GUARD + 'return $input.all();' }));
intakeNodes.push(
  node('Build C3 Intelligence Request', { jsCode: 'return [];' }),
  node('Run Owner Intelligence (C3)', { workflowId: { value: IDS.xray }, options: { waitForSubWorkflow: true } }, { type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2 }),
  node('Emit System Alert (Infra)', { workflowInputs: { value: { workflow_key: 'lead-intake' } } }, { type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2 })
);
const intakeBase = workflow('Lead Intake', intakeNodes);
const intake = patchIntake(intakeBase, sources);
check('eligible public and internal leads suppress every legacy duplicate-alert path', () => {
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']) {
    const code = byName(intake, name).parameters.jsCode;
    eq(runCode(code, {}, [{ provenance_trusted: false, lead_priority: 'HOT', status: 'Qualified' }]), [], name + ' public duplicate');
    eq(runCode(code, {}, [{ provenance_trusted: true, lead_priority: 'INCOMPLETE', status: 'Incomplete Lead' }]), [], name + ' internal duplicate');
  }
});
check('internal one-row commit emits the closed eligible target envelope', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: true, lead_id: 'FIN-INTERNAL', request_id: 'req-internal', lead_priority: 'HOT', status: 'Qualified' }],
    'Commit Verdict (New)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  });
  eq(out[0].json.commit_authority, 'RECEIPT_COMMIT', 'authority');
  assert(out[0].json.event === 'ELIGIBLE_NEW_COMMITTED' && out[0].json.eligible === true, 'envelope');
});
check('successful public Pipeline commit emits the same target contract', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: false, lead_id: 'FIN-PUBLIC', request_id: 'fmr_' + 'a'.repeat(32), lead_priority: 'WARM', status: 'New' }],
    'Respond New Lead': [{}], 'Save to Pipeline': [{}]
  });
  eq(out[0].json.commit_authority, 'PUBLIC_PIPELINE_COMMIT', 'authority');
  assert(out[0].json.eligible === true, 'public lead not eligible');
});
check('public request identity and commit authority fail closed', () => {
  eq(runCode(sources.intakeRequest, {
    'Restore Lead Context': [{ provenance_trusted: false, lead_id: 'FIN-PUBLIC', request_id: 'fmr_' + 'b'.repeat(32), lead_priority: 'HOT' }]
  }), [], 'uncommitted public request');
  let error = '';
  try {
    runCode(sources.intakeRequest, {
      'Restore Lead Context': [{ provenance_trusted: false, lead_id: 'FIN-PUBLIC', request_id: 'caller-controlled', lead_priority: 'HOT' }],
      'Respond New Lead': [{}], 'Save to Pipeline': [{}]
    });
  } catch (caught) { error = caught.message; }
  eq(error, 'C3_PUBLIC_REQUEST_ID_INVALID', 'identity validation');
});

const xrayBase = workflow('X-Ray', [
  node('Validate C3 Lead Target', { jsCode: 'return [];' }),
  node('Select Pending Leads', { jsCode: 'return [];' }),
  node('Validate + Store Rows', { jsCode: 'return [];' }),
  node('Analysis Failed Row', { jsCode: 'return [];' }),
  node('Telegram Owner Alert', { inlineKeyboard: { rows: [] } }, { type: 'n8n-nodes-base.telegram', typeVersion: 1.2 }),
  node('Failed Row', { jsonOutput: '={{ $json }}' }, { type: 'n8n-nodes-base.set', typeVersion: 3.4 }),
  node('Save Failed Analysis', { columns: { matchingColumns: ['analysis_id'] } }, { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
    credentials: { googleSheetsOAuth2Api: { id: 'sheets', name: 'Sheets' } } }),
  node('Update Pipeline X-Ray', { columns: { matchingColumns: ['lead_id'] } }, { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7 }),
  node('IF Analysis Valid', {}, { type: 'n8n-nodes-base.if', typeVersion: 2.2 }),
  node('Telegram Failure Notice', {}, { type: 'n8n-nodes-base.telegram', typeVersion: 1.2 }),
  node('Telegram Validation Failure Notice', {}, { type: 'n8n-nodes-base.telegram', typeVersion: 1.2 }),
  node('Read Analysis For Review GET', { filtersUI: { values: [] } }, { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
    credentials: { googleSheetsOAuth2Api: { id: 'sheets', name: 'Sheets' } } })
], {
  'Save Failed Analysis': { main: [[edge('Telegram Failure Notice')]] },
  'IF Analysis Valid': { main: [[], [edge('Telegram Validation Failure Notice')]] }
});
const xray = patchXray(xrayBase, intakeBase, sources);
check('X-Ray owner alert exposes the four approved single-row actions', () => {
  const rows = byName(xray, 'Telegram Owner Alert').parameters.inlineKeyboard.rows;
  eq(rows.map((row) => row.row.buttons[0].text), ['Бриф к встрече', 'Discovery', 'Разбор клиента', 'Связаться'], 'buttons');
  assert(rows[0].row.buttons[0].additionalFields.callback_data.includes("'brief|'"), 'brief callback');
});
check('X-Ray failure graph updates Pipeline before owner/system routing', () => {
  eq(targets(xray, 'Save Failed Analysis'), ['Failed Pipeline Row'], 'failed save');
  eq(targets(xray, 'Failed Pipeline Row'), ['Update Pipeline X-Ray Failure'], 'projection');
  eq(targets(xray, 'Update Pipeline X-Ray Failure'), ['IF Upstream Failure Owner Notice'], 'notice gate');
  eq(targets(xray, 'IF Upstream Failure Owner Notice', 1), ['IF Upstream Retry Exhausted'], 'retry gate');
  eq(targets(xray, 'IF Upstream Retry Exhausted'), ['Emit System Alert (X-Ray Retry Exhausted)'], 'system alert');
});
check('an ineligible targeted call cannot fall through into scheduled backlog', () => {
  const out = runCode(sources.selectPending, {
    'Settings to Object': [{ settings: { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3 } }],
    'Read XRay_Analysis': [{}],
    'Read Pipeline': [{ lead_id: 'FIN-OTHER', priority: 'HOT', status: 'New', created_at: '2020-01-01T00:00:00Z' }],
    'Validate C3 Lead Target': [{ c3_targeted: true, c3_target_eligible: false, c3_target_lead_id: 'FIN-INCOMPLETE' }]
  });
  eq(out, [], 'unrelated scheduled work leaked into targeted invocation');
});
check('failed analysis retry is due once, in place, and stops after attempt three', () => {
  const settings = { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3 };
  const pipeline = [{ lead_id: 'FIN-RETRY', priority: 'HOT', status: 'Qualified', created_at: '2020-01-01T00:00:00Z' }];
  const select = (attempt) => runCode(sources.selectPending, {
    'Settings to Object': [{ settings }], 'Read Pipeline': pipeline,
    'Read XRay_Analysis': [{ analysis_id: 'XA-RETRY', lead_id: 'FIN-RETRY', review_status: 'ANALYSIS_FAILED',
      validation_errors: 'UPSTREAM_RATE_LIMIT|ATTEMPT=' + attempt + '|MAX=3|NEXT=2020-01-01T00:00:00Z' }]
  });
  assert(select(2).length === 1 && select(2)[0].json.analysis_mode === 'RETRY_FAILED', 'attempt two not retried');
  eq(select(3), [], 'exhausted row retried');
});
check('third upstream failure keeps one identity, suppresses duplicate notice and redacts secrets', () => {
  const fakeSecret = ['sk', 'supersecret123456789'].join('-');
  const failed = runCode(sources.analysisFailed, { 'Build Analysis Input': [{
    lead_id: 'FIN-RETRY', request_id: 'req', company: 'Example', analysis_mode: 'RETRY_FAILED',
    existing_analysis: { analysis_id: 'XA-RETRY', lead_id: 'FIN-RETRY', created_at: '2020-01-01T00:00:00Z',
      review_status: 'ANALYSIS_FAILED', validation_errors: 'UPSTREAM_RATE_LIMIT|ATTEMPT=2|MAX=3|NEXT=2020-01-01T00:00:00Z' },
    owner_context: { next_action: 'Call today', contact: { preferred_contact_channel: 'email', reachable_channels: [] } }
  }] }, [{ error: { message: 'api_key=' + fakeSecret + ' user@example.test' } }])[0].json;
  assert(failed.analysis_id === 'XA-RETRY' && failed.retry_attempt === 3 && failed.retry_exhausted === true, 'retry identity/bound');
  assert(failed.notify_owner === false && !failed.analysis_row.validation_errors.includes('supersecret') && !failed.analysis_row.validation_errors.includes('example.test'), 'notification/redaction');
});

const routeRule = (value) => ({ outputKey: value, conditions: { conditions: [{ id: value, rightValue: value }] } });
const commandBase = workflow('Command', [
  node('Parse Lead Command v2', { jsCode: 'return [];' }),
  node('Route Command Mode', { rules: { values: [routeRule('help'), routeRule('query')] } }, { type: 'n8n-nodes-base.switch', typeVersion: 3.2 }),
  node('Read Pipeline', {}, { type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7,
    credentials: { googleSheetsOAuth2Api: { id: 'sheets', name: 'Sheets' } } }),
  node('Telegram Query Reply', { chatId: '={{ $json.chat_id }}', text: '={{ $json.reply_text }}', additionalFields: {} },
    { type: 'n8n-nodes-base.telegram', typeVersion: 1.2, credentials: { telegramApi: { id: 'tg', name: 'Telegram' } } })
], { 'Route Command Mode': { main: [[edge('Help')], [edge('Query')]] } });
const command = patchCommand(commandBase, xrayBase, sources);
check('/brief and brief callbacks parse into the dedicated pre-call route', () => {
  const run = (text, callback) => runCode(sources.commandParser, {
    'Verify Telegram Identity': [{ verified: true, verified_from_id: '7', verified_chat_id: '7', text, is_callback: callback, callback_query_id: callback ? 'cb' : '' }],
    'Settings to Object': [{ settings: { allowed_chat_ids: '7' } }]
  });
  assert(run('/brief FIN-7', false)[0].mode === 'precall' && run('brief|FIN-7', true)[0].lead_id === 'FIN-7', 'brief parser');
});
check('Command Center reads one analysis, renders HTML, and replies through the owner bot', () => {
  eq(targets(command, 'Read Pre-Call Analysis'), ['Render Pre-Call Brief'], 'read route');
  eq(targets(command, 'Render Pre-Call Brief'), ['Telegram Pre-Call Brief'], 'render route');
  eq(byName(command, 'Telegram Pre-Call Brief').parameters.additionalFields.parse_mode, 'HTML', 'parse mode');
  eq(byName(command, 'Telegram Pre-Call Brief').credentials, byName(commandBase, 'Telegram Query Reply').credentials, 'credential');
});

const PRECALL = require_(join(ROOT, 'n8n', 'src', 'lead-intelligence', 'precall.js'));
check('pre-call brief is compact, escaped and ordered for the first meeting', () => {
  const text = PRECALL.renderPrecallBrief({ lead_id: 'FIN-7', brief: {
    header: { company: '<Example>', contact_name: 'Owner', role: 'CEO' },
    client_facts: [{ id: 'main_problem', value: 'Cash gap' }],
    diagnoses: [{ conclusion: 'Timing mismatch', economic_implication: 'Working capital pressure' }],
    unknowns: [{ item: 'Payment calendar' }], first_meeting_objective: 'Validate the gap',
    conversation_opening: 'Start with timing', discovery_questions: [{ question: 'When do clients pay?' }],
    solution_hypothesis: { format: 'Discovery', rationale: 'Confirm facts', confirmation_conditions: ['Data available'] },
    next_action: { action: 'Schedule call', purpose: 'Validate', success_condition: 'Owner confirms' }
  } });
  assert(text.includes('&lt;Example&gt;') && text.includes('<b>11. СЛЕДУЮЩЕЕ ДЕЙСТВИЕ</b>') && text.length < 3900, 'brief');
});

const systemBase = workflow('System Alert', [node('Normalise Alert Event', { jsCode:
  '// before\n// =================== FINMENTOR SYSTEM ALERT EVENT ===================\nold\n// =================== END FINMENTOR SYSTEM ALERT EVENT ===================\n// after' })]);
const system = patchSystem(systemBase, sources);
check('System Alert recognises terminal X-Ray retry exhaustion as a class-C event', () => {
  const src = byName(system, 'Normalise Alert Event').parameters.jsCode;
  const SAE = new Function('require', src.slice(src.indexOf('var SAE ='), src.indexOf('// after')) + '; return SAE;')(require_);
  const route = SAE.routeOf('xray-analysis', 'Retry Exhausted');
  assert(route && route.sideEffectClass === 'C' && route.identity === 'lead_id', 'route');
});

check('all six workflow patches preserve credentials, schedules, webhooks and settings', () => {
  for (const [before, after] of [[conciergeBase, concierge], [transportBase, transport], [intakeBase, intake],
    [xrayBase, xray], [commandBase, command], [systemBase, system]]) {
    eq(authorityViolations(before, after), [], before.name + ' authority');
    eq(after.settings, before.settings, before.name + ' settings');
  }
});
check('the six patches are bounded to the approved node sets', () => {
  const deltas = [
    changedNodes(conciergeBase, concierge), changedNodes(transportBase, transport), changedNodes(intakeBase, intake),
    changedNodes(xrayBase, xray), changedNodes(commandBase, command), changedNodes(systemBase, system)
  ];
  assert(deltas.every((delta) => delta.removed.length === 0), 'a node was removed');
  eq(deltas.map((delta) => delta.added.length), [0, 1, 0, 7, 3, 0], 'added-node bounds');
});

console.log(`\nV1 launch blockers: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((failure) => '  ' + failure).join('\n'));
  process.exit(1);
}
