#!/usr/bin/env node
// FINMENTOR V1 — RO UAT P0/P1 correction gate.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  patchCommand, patchIntake, patchXray, protectedShape, readCorrectionSources
} from '../scripts/lib/v1-ro-uat-correction.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sources = readCorrectionSources(ROOT);
const link = (name) => ({ node: name, type: 'main', index: 0 });
const codeNode = (name, position = [0, 0]) => ({ name, type: 'n8n-nodes-base.code', position, parameters: { jsCode: '// fixture' } });

// These deliberately small, tracked fixtures exercise the correction's exact graph anchors and
// protected surfaces. Production snapshots remain untracked because they can contain live data.
const intakeBase = {
  name: 'Lead Intake correction fixture',
  nodes: [
    { name: 'Internal Ingress', type: 'n8n-nodes-base.webhook', parameters: { path: 'fixture-intake' }, credentials: { headerAuth: { id: 'fixture', name: 'fixture' } } },
    codeNode('IF Committed (Merge)'), codeNode('Internal Result (Merge)'), codeNode('Internal Result (Unresolved)'),
    codeNode('Restore Lead Context (Merged)'), codeNode('Save Lead to CRM'), codeNode('Build C3 Intelligence Request'),
    codeNode('Run Owner Intelligence (C3)', [100, 200]), codeNode('Internal Result (New)')
  ],
  connections: {
    'IF Committed (Merge)': { main: [[link('Internal Result (Merge)')], [link('Internal Result (Unresolved)')]] },
    'Restore Lead Context (Merged)': { main: [[link('Save Lead to CRM')]] },
    'Save Lead to CRM': { main: [[link('Build C3 Intelligence Request')]] },
    'Run Owner Intelligence (C3)': { main: [[link('Internal Result (New)')]] }
  }
};
const xrayBase = {
  name: 'X-Ray correction fixture',
  nodes: [
    { name: 'Scheduled Analysis', type: 'n8n-nodes-base.scheduleTrigger', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } } },
    codeNode('Validate C3 Lead Target'), codeNode('Select Pending Leads'), codeNode('Build Analysis Input'),
    codeNode('Validate + Store Rows'), codeNode('Analysis Failed Row'),
    { name: 'Telegram Owner Alert', type: 'n8n-nodes-base.telegram', parameters: {}, credentials: { telegramApi: { id: 'fixture', name: 'fixture' } } }
  ],
  connections: {}
};
const commandBase = {
  name: 'Command Center correction fixture',
  nodes: [
    { name: 'Owner Commands', type: 'n8n-nodes-base.telegramTrigger', parameters: { updates: ['callback_query'] }, credentials: { telegramApi: { id: 'fixture', name: 'fixture' } } },
    codeNode('Render Pre-Call Brief')
  ],
  connections: {}
};
const intake = patchIntake(intakeBase, sources);
const xray = patchXray(xrayBase, sources);
const command = patchCommand(commandBase, sources);

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(message + ' (got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected) + ')');
};
const byName = (workflow, name) => {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(workflow.name + ': missing ' + name);
  return found;
};
const targets = (workflow, name, output = 0) =>
  (((workflow.connections[name] || {}).main || [])[output] || []).map((item) => item.node);
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

check('committed Merge rejoins the post-commit context and archives its exact request', () => {
  eq(targets(intake, 'IF Committed (Merge)', 0), ['Restore Lead Context (Merged)'], 'Merge true branch');
  assert(targets(intake, 'Restore Lead Context (Merged)').includes('Save Lead to CRM'), 'Leads archive missing');
  eq(targets(intake, 'Save Lead to CRM'), ['Build C3 Intelligence Request'], 'C3 is not post-archive');
});

check('New and Merge results return through their original narrow contracts', () => {
  eq(targets(intake, 'Run Owner Intelligence (C3)'), ['Route C3 Result Mode'], 'C3 result router');
  eq(targets(intake, 'Route C3 Result Mode', 0), ['Internal Result (Merge)'], 'Merge return');
  eq(targets(intake, 'Route C3 Result Mode', 1), ['Internal Result (New)'], 'New return');
});

check('one-row durable Merge commit emits one closed owner-intelligence request', () => {
  const out = runCode(sources.intakeRequest, {
    'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: 'FIN-CANON', request_id: 'sub_current', lead_priority: 'HOT', status: 'Merged into FIN-CANON' }],
    'Commit Verdict (Merge)': [{ __commit_updated_rows: 1, __commit_ok: 1 }]
  }, [{}]);
  eq(out, [{ json: {
    event: 'ELIGIBLE_MERGE_COMMITTED', lead_id: 'FIN-CANON', request_id: 'sub_current', eligible: true,
    commit_authority: 'RECEIPT_COMMIT_MERGE', source_workflow_id: 'QmIyEW2ZEqKregmN', settlement_mode: 'merged'
  } }], 'Merge envelope');
});

check('uncommitted internal or public Merge (no Pipeline merge proof) cannot dispatch owner intelligence', () => {
  eq(runCode(sources.intakeRequest, {
    'Restore Lead Context (Merged)': [{ provenance_trusted: true, lead_id: 'FIN-CANON', request_id: 'sub_current' }],
    'Commit Verdict (Merge)': [{ __commit_updated_rows: 0, __commit_ok: 0 }]
  }, [{}]), [], 'uncommitted Merge');
  eq(runCode(sources.intakeRequest, {
    'Restore Lead Context (Merged)': [{ provenance_trusted: false, lead_id: 'FIN-CANON', request_id: 'fmr_' + 'a'.repeat(32) }]
  }, [{}]), [], 'public Merge without Pipeline merge proof');
});

const target = runCode(sources.xrayTarget, {}, [{
  event: 'ELIGIBLE_MERGE_COMMITTED', lead_id: 'FIN-CANON', request_id: 'sub_current', eligible: true,
  settlement_mode: 'merged', source_workflow_id: 'QmIyEW2ZEqKregmN'
}])[0].json;

check('Merge target is request-scoped even when the canonical lead already has CLIENT_READY intelligence', () => {
  const out = runCode(sources.selectPending, {
    'Settings to Object': [{ settings: { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3 } }],
    'Read XRay_Analysis': [{ lead_id: 'FIN-CANON', request_id: 'sub_old', analysis_id: 'XA-OLD', review_status: 'CLIENT_READY' }],
    'Read Pipeline': [{ lead_id: 'FIN-CANON', request_id: 'sub_old', priority: 'HOT', status: 'Qualified', created_at: '2026-01-01T00:00:00Z', xray_analysis_id: 'XA-OLD', xray_analysis_status: 'CLIENT_READY' }],
    'Validate C3 Lead Target': [target]
  });
  eq(out.length, 1, 'selected count');
  eq(out[0].json.analysis_mode, 'NEW_REQUEST_ANALYSIS', 'analysis mode');
  eq(out[0].json.request_id, 'sub_current', 'current request identity');
  eq(out[0].json.xray_analysis_status, 'CLIENT_READY', 'existing client state carried');
});

check('the same request cannot produce duplicate analysis or duplicate owner alert', () => {
  const out = runCode(sources.selectPending, {
    'Settings to Object': [{ settings: { xray_analysis_enabled: true, xray_analysis_since: '2020-01-01', xray_max_per_run: 3 } }],
    'Read XRay_Analysis': [
      { lead_id: 'FIN-CANON', request_id: 'sub_old', analysis_id: 'XA-OLD', review_status: 'CLIENT_READY' },
      { lead_id: 'FIN-CANON', request_id: 'sub_current', analysis_id: 'XA-CURRENT', review_status: 'AI_DRAFT' }
    ],
    'Read Pipeline': [{ lead_id: 'FIN-CANON', priority: 'HOT', status: 'Qualified', created_at: '2026-01-01T00:00:00Z' }],
    'Validate C3 Lead Target': [target]
  });
  eq(out, [], 'replayed request selected');
});

check('request-scoped analysis pairs only with the new archived Raw JSON', () => {
  const pipe = {
    lead_id: 'FIN-CANON', request_id: 'sub_current', analysis_mode: 'NEW_REQUEST_ANALYSIS',
    company: 'OLD IMC GROUP SRL', name: 'Old Name', role: 'Old Role',
    priority: 'COLD', priority_reason: 'Old priority', status: 'Qualified', created_at: '2026-01-01T00:00:00Z',
    main_pain: 'Old exhausted request pain', selected_goals: 'Old goal', business_model: 'Old model',
    financial_zone: 'RED', xray_analysis_id: 'XA-OLD', xray_analysis_status: 'CLIENT_READY'
  };
  const raw = JSON.stringify({
    source: 'telegram_miniapp', client: { company: 'FINMENTOR UAT RO FINAL', name: 'New Name', role: 'Director nou' },
    premium: {}, request_id: 'sub_current', selected_goals: ['Control nou']
  });
  const out = runCode(sources.buildInput, {
    'Select Pending Leads': [pipe],
    'Settings to Object': [{ settings: { xray_ai_model: 'gpt-4.1' } }]
  }, [
    { 'Lead ID': 'FIN-CANON', 'Raw JSON': JSON.stringify({ source: 'telegram_miniapp', client: { company: 'Old SRL' } }) },
    {
      'Lead ID': 'FIN-SUBMISSION', 'Request ID': 'sub_current', 'Raw JSON': raw,
      'Created At': '2026-09-17T05:32:26.241Z', Company: 'FINMENTOR UAT RO FINAL', Name: 'New Name', Role: 'Director nou',
      Language: 'ro', 'Main Pain': 'Lipsă de numerar pentru solicitarea nouă', 'Selected Goals': 'Control nou',
      'Business Model': 'Servicii B2B noi', 'Financial Zone': 'GREEN', 'Lead Priority': 'HOT',
      'Priority Reason': 'Solicitare nouă urgentă'
    }
  ]);
  eq(out.length, 1, 'analysis input count');
  eq(out[0].json.source_pairing.method, 'request_id', 'pairing method');
  eq(out[0].json.request_id, 'sub_current', 'paired request');
  eq(out[0].json.locale, 'ro', 'RO locale');
  eq(out[0].json.company, 'FINMENTOR UAT RO FINAL', 'failure-card company authority');
  eq(out[0].json.owner_context.company, 'FINMENTOR UAT RO FINAL', 'owner-card company authority');
  eq(out[0].json.owner_context.role, 'Director nou', 'owner-card role authority');
  eq(out[0].json.owner_context.qualification, 'HOT', 'request qualification authority');
  eq(out[0].json.owner_context.priority_reason, 'Solicitare nouă urgentă', 'request priority authority');
  eq(out[0].json.created_at_lead, '2026-09-17T05:32:26.241Z', 'request timestamp authority');
  assert(out[0].json.input_digest_text.includes('Lipsă de numerar pentru solicitarea nouă'), 'new request pain missing from model input');
  assert(out[0].json.input_digest_text.includes('Control nou'), 'new request goal missing from model input');
  assert(!out[0].json.input_digest_text.includes('Old exhausted request pain'), 'old request pain leaked into model input');
  assert(!out[0].json.input_digest_text.includes('Old goal'), 'old request goal leaked into model input');
});

check('request-scoped result preserves the canonical Pipeline X-Ray publication projection', () => {
  const src = readFileSync(join(ROOT, 'n8n/src/xray-analysis/validate-analysis.js'), 'utf8');
  assert(src.includes("const requestScoped = inp.analysis_mode === 'NEW_REQUEST_ANALYSIS'"), 'request mode missing');
  for (const key of ['xray_analysis_id', 'xray_score', 'xray_maturity', 'xray_primary_risk', 'xray_analysis_status', 'xray_next_step'])
    assert(src.includes(key + ': String(inp.' + key) || src.includes(key + ': inp.' + key), 'Pipeline preservation missing ' + key);
  assert(src.includes("analysis_mode: upgrading ? 'UPGRADE_EXISTING'"), 'mode ledger missing');
});

check('the first owner message has only the canonical four first-level actions', () => {
  const rows = byName(xray, 'Telegram Owner Alert').parameters.inlineKeyboard.rows;
  eq(rows.map((row) => row.row.buttons[0].text),
    ['Бриф к встрече', 'Связаться', 'Discovery', '⋯ Управление лидом'], 'action order');
  eq(xray.nodes.filter((item) => item.name === 'Telegram Owner Alert').length, 1, 'rich alert node count');
});

check('Brief resolves deterministically to the newest request analysis', () => {
  const brief = (company) => JSON.stringify({
    header: { company, contact_name: 'Owner', role: 'Director', financial_zone: 'UNKNOWN' },
    client_facts: [{ id: 'main_problem', label: 'Problem', value: company + ' pain' }],
    diagnoses: [{ conclusion: 'Observation' }], unknowns: [{ item: 'Verify' }],
    first_meeting_objective: 'Objective', conversation_opening: 'Opening',
    discovery_questions: [{ question: 'Question?', why: 'Why' }],
    solution_hypothesis: { format: 'Discovery' }, next_action: { action: 'Call' }, contact: {}
  });
  const out = runCode(sources.precallCode, {
    'Parse Lead Command v2': [{ lead_id: 'FIN-CANON', chat_id: '1' }]
  }, [
    { lead_id: 'FIN-CANON', analysis_id: 'XA-OLD', created_at: '2026-01-01T00:00:00Z', review_status: 'CLIENT_READY', owner_brief_json: brief('OLD') },
    { lead_id: 'FIN-CANON', analysis_id: 'XA-NEW', created_at: '2026-09-16T10:00:00Z', review_status: 'AI_DRAFT', owner_brief_json: brief('NEW') }
  ]);
  assert(out[0].json.reply_text.includes('NEW'), 'newest Brief not selected');
  assert(!out[0].json.reply_text.includes('OLD pain'), 'old Brief leaked into newest response');
});

check('credentials, schedules and webhooks are byte-identical', () => {
  eq(protectedShape(intake), protectedShape(intakeBase), 'Lead Intake protected shape');
  eq(protectedShape(xray), protectedShape(xrayBase), 'X-Ray protected shape');
  eq(protectedShape(command), protectedShape(commandBase), 'Command protected shape');
});

console.log('\nV1 RO UAT correction: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const failure of failures) console.log('  ' + failure);
  process.exit(1);
}
