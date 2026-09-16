// FINMENTOR V1 launch-blocker correction — pure live-workflow patchers.
// No API calls or filesystem writes occur here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readC3Sources } from './c3-final-closure.mjs';

export const BASELINE = '6f6dd65fbb80cbeeb5f03ffc84d8a521d73e0d25';
export const IDS = Object.freeze({
  concierge: 'mppzthlkSJFr6Kle', transport: 'ShcmmJeLSE8LYVBk', intake: 'QmIyEW2ZEqKregmN',
  xray: 'tNSMRoKlFB52vjge', command: 'qF9tonlHHIxc8MDd', system: 'ID700kTo6EXffwry'
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const edge = (name) => ({ node: name, type: 'main', index: 0 });
const fail = (m) => { throw new Error(m); };
const node = (w, name) => {
  const n = w.nodes.find((x) => x.name === name);
  if (!n) fail(w.name + ': missing anchor ' + name);
  return n;
};
const targets = (w, name, output = 0) => ((((w.connections[name] || {}).main || [])[output]) || []).map((x) => x.node);
const read = (root, rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const body = (src) => src
  .replace(/^\/\/[^\n]*\n(?:\/\/[^\n]*\n)*/m, '')
  .replace(/['"]use strict['"];?\s*/, '')
  .replace(/if \(typeof module[\s\S]*$/, '')
  .trim();

export function readFixSources(root) {
  const c3 = readC3Sources(root);
  const cards = read(root, 'n8n/src/xray-analysis/owner-cards.js').replace(/if \(typeof module[\s\S]*$/, '').trim();
  const failed = read(root, 'n8n/src/xray-analysis/analysis-failed.js')
    .replace('// __XRAY_OWNER_CARDS__ (inlined by the builder)', cards);
  const precallBody = body(read(root, 'n8n/src/lead-intelligence/precall.js'));
  return Object.assign({}, c3, {
    analysisFailed: failed,
    commandParser: read(root, 'n8n/src/command-center/parse-lead-command.js'),
    precallCode: `const PRECALL = (function () {\n${precallBody}\nreturn { renderPrecallBrief };\n})();\n\n` +
`const cmd = $('Parse Lead Command v2').first().json || {};
const leadId = String(cmd.lead_id || '').trim();
const rows = $input.all().map((item) => item.json || {}).filter((row) => String(row.lead_id || '').trim() === leadId);
const ready = rows.filter((row) => String(row.review_status || '').toUpperCase() !== 'ANALYSIS_FAILED'
  && String(row.owner_brief_json || '').trim() !== '')
  .sort((a, b) => {
    const byTime = (Date.parse(String(a.created_at || '')) || 0) - (Date.parse(String(b.created_at || '')) || 0);
    return byTime || String(a.analysis_id || '').localeCompare(String(b.analysis_id || ''));
  });
let reply = '';
if (!ready.length) {
  reply = '<b>FINMENTOR · БРИФ К ПЕРВОЙ ВСТРЕЧЕ</b>\\n\\nБриф пока недоступен. Лид сохранён; дождитесь завершения анализа.';
} else {
  try {
    // A canonical lead may receive more than one committed Mini App request. The callback remains
    // lead-scoped; its Brief opens the newest request intelligence deterministically.
    const brief = JSON.parse(String(ready[ready.length - 1].owner_brief_json || ''));
    reply = PRECALL.renderPrecallBrief({ lead_id: leadId, brief });
  } catch (e) {
    reply = '<b>FINMENTOR · БРИФ К ПЕРВОЙ ВСТРЕЧЕ</b>\\n\\nБриф пока недоступен. Лид сохранён; команда получила уведомление.';
  }
}
return [{ json: { chat_id: String(cmd.chat_id || ''), reply_text: reply, lead_id: leadId } }];`,
    systemEvent: read(root, 'n8n/src/system-alert/event.js')
  });
}

export function patchConcierge(workflow) {
  const out = clone(workflow);
  const session = node(out, 'Get Bot Session');
  let js = String(session.parameters.jsCode || '');
  const oldDetector = "const isStart = text === '/start';";
  const detector = "const isStart = /^\\/start(?:@[A-Za-z0-9_]+)?(?:\\s+\\S+)?\\s*$/.test(text);";
  const old = "if (false) { reset = 'start'; }";
  if (!js.includes(oldDetector)) fail('Concierge: /start detector anchor moved');
  if (!js.includes(old)) fail('Concierge: neutered /start anchor moved');
  js = js.replace(oldDetector, detector)
    .replace(old, "if (isStart) { reset = 'start'; }")
    .replace('// [premium] REMOVED: /start no longer resets the cycle. `if (false)` rather than a comment,\n// because this line heads an if/else chain and commenting it out orphans the `else` below.\n',
      '// [V1 launch blocker] /start always starts a clean current cycle; archiveLead preserves history.\n');
  session.parameters.jsCode = js;

  const transport = node(out, 'Build Transport Request');
  js = String(transport.parameters.jsCode || '');
  const anchor = "  'C|C|C|C': 'L4_CCCC',";
  if (!js.includes(anchor) || js.includes("'C|C|C|C#HTML': 'L4_C_HTML'")) fail('Concierge: transport map anchor drift');
  transport.parameters.jsCode = js.replace(anchor, anchor + "\n  'C|C|C|C#HTML': 'L4_C_HTML',");
  return out;
}

export function patchTransport(workflow) {
  const out = clone(workflow);
  const validate = node(out, 'Validate Transport Payload');
  let js = String(validate.parameters.jsCode || '');
  const anchor = "L4_CCCC: [['C'],['C'],['C'],['C']],";
  if (!js.includes(anchor) || js.includes("L4_C_HTML: [['C'],['C'],['C'],['C']]")) fail('Transport: layout spec anchor drift');
  validate.parameters.jsCode = js.replace(anchor, anchor + " L4_C_HTML: [['C'],['C'],['C'],['C']],");

  const route = node(out, 'Route Keyboard Layout');
  const rules = route.parameters.rules.values;
  if (!Array.isArray(rules) || rules.some((r) => r.outputKey === 'L4_C_HTML')) fail('Transport: route rules drift');
  const template = clone(rules.find((r) => r.outputKey === 'L4_CCCC'));
  if (!template) fail('Transport: L4_CCCC route missing');
  template.outputKey = 'L4_C_HTML';
  template.conditions.conditions[0].rightValue = 'L4_C_HTML';
  template.conditions.conditions[0].id = 'v1-launch-l4-c-html';
  const ruleIndex = rules.length;
  rules.push(template);

  const renderer = clone(node(out, 'Render L4_CCCC'));
  renderer.id = 'v1-launch-render-l4-c-html';
  renderer.name = 'Render L4_C_HTML';
  renderer.position = [renderer.position[0], renderer.position[1] + 1080];
  renderer.parameters.additionalFields = Object.assign({}, renderer.parameters.additionalFields || {}, { parse_mode: 'HTML' });
  out.nodes.push(renderer);
  const outputs = out.connections['Route Keyboard Layout'].main;
  if (!Array.isArray(outputs) || outputs.length !== ruleIndex + 1) fail('Transport: switch output cardinality drift');
  outputs.splice(ruleIndex, 0, [edge(renderer.name)]);
  return out;
}

const OLD_GUARD = '// C3: authenticated committed NEW leads use the single X-Ray owner-intelligence alert.\n'
  + 'if ($input.first().json.provenance_trusted === true) return [];\n';
const CANONICAL_GUARD = '// V1: all eligible NEW leads use the single X-Ray owner-intelligence alert.\n'
  + 'const __v1Lead = $input.first().json || {};\n'
  + 'const __v1Eligible = String(__v1Lead.lead_priority || "").toUpperCase() !== "INCOMPLETE"\n'
  + '  && String(__v1Lead.status || "").toLowerCase() !== "incomplete lead";\n'
  + 'if (__v1Lead.provenance_trusted === true || __v1Eligible) return [];\n';

export function patchIntake(workflow, sources) {
  const out = clone(workflow);
  node(out, 'Build C3 Intelligence Request').parameters.jsCode = sources.intakeRequest;
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'AI Gate']) {
    const n = node(out, name);
    const js = String(n.parameters.jsCode || '');
    if (!js.startsWith(OLD_GUARD)) fail('Lead Intake: C3 guard drift in ' + name);
    n.parameters.jsCode = CANONICAL_GUARD + js.slice(OLD_GUARD.length);
  }
  const call = node(out, 'Run Owner Intelligence (C3)');
  if (call.parameters.workflowId.value !== IDS.xray || call.parameters.options.waitForSubWorkflow !== true) fail('Lead Intake: owner-intelligence caller drift');
  return out;
}

function ifNode(name, id, expression, position) {
  return {
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: id + '-condition', leftValue: expression, rightValue: true,
        operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    id, name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position
  };
}

export function patchXray(workflow, intakeTemplate, sources) {
  const out = clone(workflow);
  for (const [name, code] of [
    ['Validate C3 Lead Target', sources.xrayTarget], ['Select Pending Leads', sources.selectPending],
    ['Validate + Store Rows', sources.validateAnalysis], ['Analysis Failed Row', sources.analysisFailed]
  ]) node(out, name).parameters.jsCode = code;

  const alert = node(out, 'Telegram Owner Alert');
  alert.parameters.inlineKeyboard = { rows: [
    { row: { buttons: [{ text: 'Бриф к встрече', additionalFields: { callback_data: "={{ 'brief|' + $('Validate + Store Rows').item.json.lead_id }}", style: 'primary' } }] } },
    { row: { buttons: [{ text: 'Связаться', additionalFields: { url: "={{ $('Validate + Store Rows').item.json.owner_alert.contact_url }}" } }] } },
    { row: { buttons: [{ text: 'Discovery', additionalFields: { callback_data: "={{ 'stage|' + $('Validate + Store Rows').item.json.lead_id + '|Discovery Scheduled' }}", style: 'success' } }] } },
    { row: { buttons: [{ text: '⋯ Управление лидом', additionalFields: { url: "={{ $('Validate + Store Rows').item.json.owner_alert.review_url }}" } }] } }
  ] };

  const failedSet = clone(node(out, 'Failed Row'));
  failedSet.id = 'v1-failed-pipeline-row'; failedSet.name = 'Failed Pipeline Row';
  failedSet.position = [node(out, 'Save Failed Analysis').position[0] + 220, node(out, 'Save Failed Analysis').position[1]];
  failedSet.parameters.jsonOutput = "={{ JSON.stringify($('Analysis Failed Row').item.json.pipeline_row) }}";
  const failedUpdate = clone(node(out, 'Update Pipeline X-Ray'));
  failedUpdate.id = 'v1-update-failed-pipeline'; failedUpdate.name = 'Update Pipeline X-Ray Failure';
  failedUpdate.position = [failedSet.position[0] + 220, failedSet.position[1]];

  const upNotice = ifNode('IF Upstream Failure Owner Notice', 'v1-if-upstream-notice',
    "={{ $('Analysis Failed Row').item.json.notify_owner }}", [failedUpdate.position[0] + 220, failedUpdate.position[1] - 100]);
  const upTerminal = ifNode('IF Upstream Retry Exhausted', 'v1-if-upstream-terminal',
    "={{ $('Analysis Failed Row').item.json.retry_exhausted }}", [failedUpdate.position[0] + 220, failedUpdate.position[1] + 100]);
  const validationNotice = ifNode('IF Validation Failure Owner Notice', 'v1-if-validation-notice',
    "={{ $('Validate + Store Rows').item.json.notify_owner }}", [node(out, 'IF Analysis Valid').position[0] + 220, node(out, 'IF Analysis Valid').position[1] + 180]);
  const validationTerminal = ifNode('IF Validation Retry Exhausted', 'v1-if-validation-terminal',
    "={{ $('Validate + Store Rows').item.json.retry_exhausted }}", [node(out, 'IF Analysis Valid').position[0] + 220, node(out, 'IF Analysis Valid').position[1] + 340]);

  const emit = clone(node(intakeTemplate, 'Emit System Alert (Infra)'));
  emit.id = 'v1-emit-xray-retry-exhausted'; emit.name = 'Emit System Alert (X-Ray Retry Exhausted)';
  emit.position = [failedUpdate.position[0] + 700, failedUpdate.position[1] + 260];
  emit.parameters.workflowInputs.value = {
    workflow_key: 'xray-analysis', verdict_node: 'Retry Exhausted', error_code: 'XRAY_RETRY_EXHAUSTED',
    retryable: 'false',
    route_identity: "={{ String(($('Analysis Failed Row').isExecuted ? $('Analysis Failed Row').first().json.lead_id : $('Validate + Store Rows').first().json.lead_id) || '') }}",
    occurred_at: '={{ $now.toISO() }}'
  };

  out.nodes.push(failedSet, failedUpdate, upNotice, upTerminal, validationNotice, validationTerminal, emit);
  out.connections['Save Failed Analysis'] = { main: [[edge(failedSet.name)]] };
  out.connections[failedSet.name] = { main: [[edge(failedUpdate.name)]] };
  out.connections[failedUpdate.name] = { main: [[edge(upNotice.name)]] };
  out.connections[upNotice.name] = { main: [[edge('Telegram Failure Notice')], [edge(upTerminal.name)]] };
  out.connections[upTerminal.name] = { main: [[edge(emit.name)], []] };
  out.connections['IF Analysis Valid'].main[1] = [edge(validationNotice.name)];
  out.connections[validationNotice.name] = { main: [[edge('Telegram Validation Failure Notice')], [edge(validationTerminal.name)]] };
  out.connections[validationTerminal.name] = { main: [[edge(emit.name)], []] };
  return out;
}

export function patchCommand(workflow, xrayTemplate, sources) {
  const out = clone(workflow);
  node(out, 'Parse Lead Command v2').parameters.jsCode = sources.commandParser;
  const route = node(out, 'Route Command Mode');
  const rules = route.parameters.rules.values;
  if (rules.some((r) => (r.conditions.conditions[0] || {}).rightValue === 'precall')) fail('Command Center: precall route exists');
  const r = clone(rules[1]);
  r.conditions.conditions[0].id = 'v1-precall-route';
  r.conditions.conditions[0].rightValue = 'precall';
  rules.push(r);

  const readNode = clone(node(xrayTemplate, 'Read Analysis For Review GET'));
  readNode.id = 'v1-read-precall-analysis'; readNode.name = 'Read Pre-Call Analysis';
  readNode.position = [304, 896]; readNode.executeOnce = true;
  readNode.parameters.filtersUI = { values: [{ lookupColumn: 'lead_id', lookupValue: "={{ $('Parse Lead Command v2').first().json.lead_id }}" }] };
  const render = { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: sources.precallCode },
    id: 'v1-render-precall-brief', name: 'Render Pre-Call Brief', type: 'n8n-nodes-base.code', typeVersion: 2, position: [528, 896] };
  const send = clone(node(out, 'Telegram Query Reply'));
  send.id = 'v1-telegram-precall-brief'; send.name = 'Telegram Pre-Call Brief'; send.position = [752, 896];
  send.parameters.chatId = '={{ $json.chat_id }}'; send.parameters.text = '={{ $json.reply_text }}';
  send.parameters.additionalFields = Object.assign({}, send.parameters.additionalFields || {}, { parse_mode: 'HTML', disable_web_page_preview: true, appendAttribution: false });
  out.nodes.push(readNode, render, send);
  out.connections['Route Command Mode'].main.push([edge(readNode.name)]);
  out.connections[readNode.name] = { main: [[edge(render.name)]] };
  out.connections[render.name] = { main: [[edge(send.name)]] };
  return out;
}

export function patchSystem(workflow, sources) {
  const out = clone(workflow);
  const normalise = node(out, 'Normalise Alert Event');
  const js = String(normalise.parameters.jsCode || '');
  const startMarker = '// =================== FINMENTOR SYSTEM ALERT EVENT ===================';
  const endMarker = '// =================== END FINMENTOR SYSTEM ALERT EVENT ===================';
  const start = js.indexOf(startMarker); const end = js.indexOf(endMarker);
  if (start < 0 || end < start) fail('System Alert: event markers drift');
  normalise.parameters.jsCode = js.slice(0, start) + sources.systemEvent.trim() + js.slice(end + endMarker.length);
  return out;
}

export function importable(workflow) {
  return { name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} };
}

export function protectedShape(workflow) {
  return {
    credentials: workflow.nodes.filter((n) => n.credentials).map((n) => [n.name, n.credentials]),
    schedules: workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.scheduleTrigger').map((n) => [n.name, n.parameters]),
    webhooks: workflow.nodes.filter((n) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.telegramTrigger'].includes(n.type)).map((n) => [n.name, n.parameters])
  };
}

// Adding a node may reuse an already-approved credential, so a raw before/after credential-node
// list is expected to grow. This guard preserves every existing assignment, refuses every new
// credential authority, and keeps schedules/webhooks byte-exact.
export function authorityViolations(before, after) {
  const failures = [];
  const beforeShape = protectedShape(before); const afterShape = protectedShape(after);
  if (JSON.stringify(beforeShape.schedules) !== JSON.stringify(afterShape.schedules)) failures.push('schedule authority changed');
  if (JSON.stringify(beforeShape.webhooks) !== JSON.stringify(afterShape.webhooks)) failures.push('webhook authority changed');
  const afterBy = new Map(after.nodes.map((n) => [n.name, n]));
  for (const old of before.nodes) {
    const next = afterBy.get(old.name);
    if (!next) { failures.push('existing node removed: ' + old.name); continue; }
    if (JSON.stringify(old.credentials || null) !== JSON.stringify(next.credentials || null)) failures.push('credential assignment changed: ' + old.name);
  }
  const allowed = new Set(before.nodes.flatMap((n) => Object.entries(n.credentials || {}).map(([key, value]) => JSON.stringify([key, value]))));
  const beforeNames = new Set(before.nodes.map((n) => n.name));
  for (const added of after.nodes.filter((n) => !beforeNames.has(n.name))) {
    for (const entry of Object.entries(added.credentials || {})) {
      if (!allowed.has(JSON.stringify(entry))) failures.push('new credential authority: ' + added.name + ':' + entry[0]);
    }
  }
  return failures;
}

export function changedNodes(before, after) {
  const old = new Map(before.nodes.map((n) => [n.name, n]));
  return {
    added: after.nodes.filter((n) => !old.has(n.name)).map((n) => n.name),
    changed: after.nodes.filter((n) => old.has(n.name) && JSON.stringify(n) !== JSON.stringify(old.get(n.name))).map((n) => n.name),
    removed: before.nodes.filter((n) => !after.nodes.some((x) => x.name === n.name)).map((n) => n.name)
  };
}

export { node, targets };
