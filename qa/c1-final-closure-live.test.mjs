#!/usr/bin/env node
// FINMENTOR C1 final-closure gate.
// Offline execution of the candidates assembled from the same-turn production read-back.
// Requires .uat/c1-final-closure/pre and /candidates; performs no network or production writes.

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PRE = join(ROOT, '.uat', 'c1-final-closure', 'pre');
const CANDIDATES = join(ROOT, '.uat', 'c1-final-closure', 'candidates');
const require = createRequire(import.meta.url);
const H = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'c1-handoff.js'));
const D = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'draft-contract.js'));

const IDS = {
  concierge: 'mppzthlkSJFr6Kle', host: 'KBD7Q94QQnlzgYKJ', gateway: 'nTZHLbv2KFggdhh5',
  intake: 'QmIyEW2ZEqKregmN', xray: 'tNSMRoKlFB52vjge', command: 'qF9tonlHHIxc8MDd',
  daily: 'imeJIDeNyaWDyXzh', sla: 'LZ2mvKXbBikmeVTn', followup: 'zeLOCuf0K1bkaKl2',
  systemAlert: 'ID700kTo6EXffwry', errorMonitor: 'RBiFLhVjizMkAzrK'
};
const ALLOWED = {
  [IDS.concierge]: ['Build Bot Response', 'Build Bot Response (Premium)', 'Prepare Cycle Projection', 'Build Intake Transport Request', 'Build Recovery Request'],
  [IDS.host]: ['Serve Page'], [IDS.gateway]: ['Build App Session'],
  [IDS.intake]: ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'Build Short AI Telegram'],
  [IDS.xray]: ['Analysis Failed Row', 'Validate + Store Rows', 'Render Review Surface', 'Review POST Verdict', 'Build Curated Client Result', 'Build Client Ready Notification', 'Complete Client Ready Notification', 'Complete Outbound Contact'],
  [IDS.command]: ['Build Query Reply', 'Find & Build Update', 'Verify Mutation'],
  [IDS.daily]: ['Build Daily Digest'], [IDS.sla]: ['SLA Select'], [IDS.followup]: ['Build Followup Plan'],
  [IDS.systemAlert]: ['Build System Alert'], [IDS.errorMonitor]: ['Build Error Alert']
};
const URL = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-premium-miniapp';

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
function assert(value, message) { if (!value) throw new Error(message); }
function eq(actual, expected, message) {
  if (actual !== expected) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function parse(path) { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
function pre(id) {
  const file = readdirSync(PRE).find((name) => name.startsWith(id + '.') && name.endsWith('.json'));
  assert(file, 'missing production backup for ' + id);
  return parse(join(PRE, file));
}
function candidate(id) { return parse(join(CANDIDATES, id + '.candidate.json')); }
function byName(workflow, name) {
  const found = workflow.nodes.find((node) => node.name === name);
  assert(found, workflow.id + ': missing node ' + name);
  return found;
}
function j(value) { return JSON.stringify(value); }
function credentials(workflow) {
  return workflow.nodes.map((node) => [node.name, node.credentials || {}]);
}
function triggers(workflow) {
  const initiatingTypes = new Set([
    'n8n-nodes-base.webhook',
    'n8n-nodes-base.scheduleTrigger',
    'n8n-nodes-base.cron'
  ]);
  return workflow.nodes.filter((node) => initiatingTypes.has(node.type)).map((node) => [node.name, node.type, node.parameters]);
}
function runConcierge(input) {
  const code = byName(candidate(IDS.concierge), 'Build Bot Response').parameters.jsCode;
  return new Function('$input', code)({ first: () => ({ json: input }) })[0].json;
}
function labels(result) { return (result.reply_markup.inline_keyboard || []).flat().map((button) => button.text); }
function callbacks(result) { return (result.reply_markup.inline_keyboard || []).flat().map((button) => button.callback_data).filter(Boolean); }
function runCode(code, nodes, input) {
  const handle = (value, executed = true) => ({ isExecuted: executed, first: () => ({ json: value }) });
  const $ = (name) => {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) throw new Error('missing harness node ' + name);
    const item = nodes[name];
    return handle(item.value, item.executed !== false);
  };
  return new Function('$input', '$', code)({ first: () => ({ json: input }) }, $);
}

console.log('FINMENTOR C1 — live-derived candidate closure gate\n');

check('candidate manifest covers exactly the eleven affected workflows', () => {
  const manifest = parse(join(CANDIDATES, 'manifest.json'));
  eq(manifest.workflows.map((row) => row.id).sort().join(','), Object.values(IDS).sort().join(','), 'manifest workflow set');
});

for (const id of Object.values(IDS)) {
  check(id + ': only declared node bodies changed', () => {
    const a = pre(id); const b = candidate(id); const allowed = new Set(ALLOWED[id]);
    eq(b.name, a.name, 'workflow name');
    eq(j(b.settings || {}), j(a.settings || {}), 'workflow settings');
    eq(j(b.connections), j(a.connections), 'connection graph');
    eq(b.nodes.length, a.nodes.length, 'node count');
    for (const oldNode of a.nodes) {
      const nextNode = byName(b, oldNode.name);
      eq(nextNode.id, oldNode.id, oldNode.name + ': node id');
      eq(nextNode.type, oldNode.type, oldNode.name + ': node type');
      eq(j(nextNode.credentials || {}), j(oldNode.credentials || {}), oldNode.name + ': credentials');
      if (!allowed.has(oldNode.name)) eq(j(nextNode), j(oldNode), oldNode.name + ': out-of-scope node changed');
    }
  });
}

check('credential drift is zero for every affected workflow', () => {
  for (const id of Object.values(IDS)) eq(j(credentials(candidate(id))), j(credentials(pre(id))), id + ': credential drift');
});
check('webhook and schedule drift is zero for every affected workflow', () => {
  for (const id of Object.values(IDS)) eq(j(triggers(candidate(id))), j(triggers(pre(id))), id + ': trigger drift');
});

check('entry has the four approved actions in the approved order', () => {
  const r = runConcierge({ chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', message_text: '/start', session: {} });
  eq(labels(r).join('|'), 'Описать задачу|Финансовая диагностика|Подготовить бриф|Запросить встречу', 'entry labels');
  eq(callbacks(r).join('|'), 'p|describe|p|diagnosis|p|brief|p|meeting', 'entry callbacks');
});
check('diagnosis and brief route to the same existing Mini App', () => {
  const base = { chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', session: {} };
  const d = runConcierge({ ...base, callback_data: 'p|diagnosis' });
  const b = runConcierge({ ...base, callback_data: 'p|brief' });
  eq(d.debug.state_after, 'TG_OPEN_DIAGNOSIS', 'diagnosis state');
  eq(b.debug.state_after, 'TG_OPEN_BRIEF', 'brief state');
  const du = d.reply_markup.inline_keyboard.flat().find((x) => x.web_app).web_app.url;
  const bu = b.reply_markup.inline_keyboard.flat().find((x) => x.web_app).web_app.url;
  eq(du, URL, 'diagnosis URL'); eq(du, bu, 'a second diagnosis surface was introduced');
});
check('unknown input has explicit recovery and all four next actions', () => {
  const r = runConcierge({ chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', message_text: '???', session: {} });
  eq(r.debug.state_after, 'TG_UNKNOWN', 'unknown state');
  assert(/Не удалось точно определить запрос/.test(r.reply_text), 'recovery copy missing');
  eq(labels(r).length, 4, 'recovery action count');
  assert(!/state|callback|workflow|confidence/i.test(r.reply_text), 'technical terminology exposed');
});
check('freeform prompt asks one management question', () => {
  const r = runConcierge({ chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', callback_data: 'p|describe', session: {} });
  eq((r.reply_text.match(/\?/g) || []).length, 1, 'question count');
});
check('freeform original text, confirmed context and full Telegram name survive', () => {
  const original = 'ООО «Контур» продаёт оборудование; отчётность собираем вручную.';
  const first = runConcierge({ chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', message_text: original,
    session: { state: 'TG_FREEFORM_PROBLEM', first_name: 'Анна', last_name: 'Петрова' } });
  eq(first.session.free_text_request, original, 'original narrative');
  eq(first.session.contact_name, 'Анна Петрова', 'full name');
  const note = JSON.parse(first.session.notes);
  eq(note.original_text, original, 'note original text');
  eq(note.context_confirmed, false, 'unconfirmed extraction was promoted');
  const second = runConcierge({ chat_id: '900000001', user_id: '900000001', cycle_id: 'C1-UAT', callback_data: 'p|ctx_ok', session: first.session });
  eq(JSON.parse(second.session.notes).context_confirmed, true, 'explicit confirmation was not preserved');
});
check('explicit contact name outranks Telegram display name', () => {
  eq(H.fullName({ first_name: 'Анна', last_name: 'Петрова', contact_name: 'Анна Соколова' }), 'Анна Соколова', 'name priority');
});
check('projection preserves verbatim narrative and separates inferred facts', () => {
  const note = { v: 1, kind: 'premium_context', original_text: 'Текст клиента — дословно.', context_confirmed: false,
    extracted: { company_name: 'Контур', business_activity: 'Оборудование' } };
  const envelope = H.projectionEnvelope('reset-value', { notes: JSON.stringify(note), first_name: 'Анна', last_name: 'Петрова' });
  const draft = H.draftFromProjection(envelope, 'C1-UAT', '2026-09-15T10:00:00.000Z');
  eq(draft.fields.important_context.value, note.original_text, 'original narrative');
  eq(draft.fields.important_context.source, 'user_explicit', 'original provenance');
  eq(draft.fields.company_name.source, 'ai_inferred', 'inference provenance');
  eq(D.canSkip(draft.fields.company_name, 'company_name'), false, 'AI inference skipped a question');
  eq(draft.fields.contact_name.value, 'Анна Петрова', 'projected full name');
});
check('client-confirmed facts become user_confirmed and may skip', () => {
  const note = { v: 1, kind: 'premium_context', original_text: 'Контекст', context_confirmed: true,
    extracted: { company_name: 'Контур', business_activity: 'Оборудование' } };
  const draft = H.draftFromProjection(H.projectionEnvelope('', { notes: JSON.stringify(note) }), 'C1-UAT', '2026-09-15T10:00:00.000Z');
  eq(draft.fields.company_name.source, 'user_confirmed', 'confirmed provenance');
  eq(D.canSkip(draft.fields.company_name, 'company_name'), true, 'confirmed value does not skip');
});
check('company name and business activity are separate states and screens', () => {
  const order = D.ASK_ORDER.map((row) => row[0]);
  eq(order[0], 'APP_COMPANY', 'first company state');
  eq(order[1], 'APP_BUSINESS_ACTIVITY', 'activity state');
  const app = readFileSync(join(ROOT, 'app-premium', 'app.js'), 'utf8');
  assert(/function scrCompany\(\)[\s\S]*?company_name/.test(app), 'company screen absent');
  assert(/function scrBusinessActivity\(\)[\s\S]*?business_activity/.test(app), 'activity screen absent');
});

check('meeting request requires explicit confirmation and then builds a truthful lead', () => {
  const base = { chat_id: '900000001', user_id: '900000001', username: 'c1_controlled', first_name: 'Анна', last_name: 'Петрова', cycle_id: 'C1-UAT', session: {} };
  const ask = runConcierge({ ...base, callback_data: 'p|meeting' });
  eq(ask.debug.state_after, 'TG_MEETING_CONFIRM', 'meeting confirmation state');
  assert(/обработку контактных данных/.test(ask.reply_text), 'privacy confirmation absent');
  const confirmed = runConcierge({ ...base, callback_data: 'p|meeting_y', session: ask.session });
  eq(confirmed.debug.state_after, 'TG_MEETING_REQUEST', 'meeting request state');
  eq(confirmed.lead_ready, true, 'Lead Intake handoff not requested');
  eq(confirmed.session.selected_service, 'Запрос на встречу', 'session persistence marker');
  eq(confirmed.session.consent, 'yes', 'privacy decision');
  eq(confirmed.lead_payload.client.name, 'Анна Петрова', 'owner payload name');
  eq(confirmed.lead_payload.client.telegram, '@c1_controlled', 'owner payload Telegram');
  eq(confirmed.lead_payload.meta.request_type, 'meeting_request', 'meeting metadata');
  assert(!/календар|слот|забронир|встреча подтверждена/i.test(j(confirmed.lead_payload)), 'false booking claim');
});
check('all three owner routes render the dedicated meeting alert from available data only', () => {
  const wf = candidate(IDS.intake);
  const payload = { client: { name: 'Анна Петрова', company: '', role: '', telegram: '@c1_controlled' },
    premium: { important_context: 'Нужно обсудить денежный поток.' }, meta: { request_type: 'meeting_request' } };
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert']) {
    const out = new Function('$input', byName(wf, name).parameters.jsCode)({ first: () => ({ json: { raw_json: JSON.stringify(payload) } }) })[0].json.alert_html;
    assert(/Запрос на встречу/.test(out), name + ': dedicated title');
    assert(/Анна Петрова/.test(out) && /@c1_controlled/.test(out), name + ': available identity');
    assert(/Согласовать встречу/.test(out), name + ': next action');
    assert(!/Компания не указана|Роль не указана/.test(out), name + ': unavailable data shown');
  }
});
check('client meeting acknowledgement occurs only after successful Intake', () => {
  const wf = candidate(IDS.concierge);
  const code = byName(wf, 'Build Intake Transport Request').parameters.jsCode;
  const bot = runConcierge({ chat_id: '900000001', user_id: '900000001', username: 'c1_controlled', cycle_id: 'C1-UAT', callback_data: 'p|meeting_y', session: {} });
  const nodes = {
    'Build Bot Response (Premium)': { value: bot }, 'Build Bot Response': { value: bot, executed: false },
    'Parse Telegram Update': { value: { chat_id: '900000001', callback_query_id: 'cb-c1', is_callback: true } },
    'Settings to Object': { value: { settings: { website_url: 'https://finmentor.md' } } },
    'Parse Intake Response': { value: { intake_ok: true } },
    'Get Bot Session (Premium)': { value: {} }, 'Get Bot Session': { value: {}, executed: false }
  };
  const ok = runCode(code, nodes, {})[0].json;
  assert(/Запрос на встречу принят/.test(ok.text), 'success acknowledgement');
  assert(/в течение 1 рабочего дня/.test(ok.text), 'response window');
  assert(!/календар|слот|забронир|встреча подтверждена/i.test(ok.text), 'false booking claim');
  nodes['Parse Intake Response'].value = { intake_ok: false };
  const failed = runCode(code, nodes, {})[0].json;
  assert(/не считается принятым/.test(failed.text), 'failure was presented as accepted');
});

check('active client and owner copy contains no retired terms or URL placeholder', () => {
  const retired = ['Финансовый рентген', 'Финансовый рентген бизнеса', 'ГЛАВНАЯ БОЛЬ', 'Главная боль', '01 · Боль', '__PREMIUM_MINIAPP_URL__'];
  const overlay = new Map(Object.values(IDS).map((id) => [id, candidate(id)]));
  for (const file of readdirSync(PRE).filter((name) => name.endsWith('.json') && name !== 'manifest.json')) {
    const live = parse(join(PRE, file)); const workflow = overlay.get(live.id) || live;
    const body = j(workflow.nodes.map((node) => node.parameters));
    for (const term of retired) assert(!body.includes(term), workflow.id + ': retired term remains: ' + term);
  }
});
check('approved diagnosis and problem terminology is present', () => {
  const all = Object.values(IDS).map((id) => j(candidate(id))).join('\n');
  assert(all.includes('Финансовая диагностика'), 'diagnosis label absent');
  assert(all.includes('КЛЮЧЕВАЯ ПРОБЛЕМА') && all.includes('Проблема:'), 'problem terminology absent');
});
check('non-AI baseline label is N/A because no such presentation concept exists', () => {
  const all = readdirSync(PRE).filter((name) => name.endsWith('.json')).map((name) => readFileSync(join(PRE, name), 'utf8')).join('\n');
  assert(!/Человеческий базлайн|Human baseline|human baseline/.test(all), 'a baseline concept exists and needs a label');
});
check('result URL is the approved production URL and the placeholder is absent', () => {
  const code = byName(candidate(IDS.xray), 'Build Client Ready Notification').parameters.jsCode;
  assert(code.includes(URL), 'approved result URL missing');
  assert(!code.includes('__PREMIUM_MINIAPP_URL__'), 'placeholder remains');
});

check('X-Ray business/scoring/result changes are literal presentation substitutions only', () => {
  const old = pre(IDS.xray); const next = candidate(IDS.xray);
  const presentationShape = (value) => String(value)
    .split(URL).join('__MINIAPP_URL__')
    .split('__PREMIUM_MINIAPP_URL__').join('__MINIAPP_URL__')
    .split('Финансовый рентген бизнеса').join('__FINANCIAL_DIAGNOSIS__')
    .split('Финансовый рентген').join('__FINANCIAL_DIAGNOSIS__')
    .split('Финансовая диагностика').join('__FINANCIAL_DIAGNOSIS__')
    .split('ГЛАВНАЯ БОЛЬ').join('__KEY_PROBLEM_UPPER__')
    .split('КЛЮЧЕВАЯ ПРОБЛЕМА').join('__KEY_PROBLEM_UPPER__')
    .split('Главная боль').join('__KEY_PROBLEM__')
    .split('Ключевая проблема').join('__KEY_PROBLEM__')
    .split('01 · Боль').join('01 · __PROBLEM__')
    .split('01 · Проблема').join('01 · __PROBLEM__');
  for (const name of ALLOWED[IDS.xray]) {
    const a = byName(old, name).parameters.jsCode;
    const b = byName(next, name).parameters.jsCode;
    eq(presentationShape(b), presentationShape(a), name + ': non-presentation drift');
  }
});
check('X-Ray eligibility, visibility, notification and viewed-proof nodes are byte-identical', () => {
  const a = pre(IDS.xray); const b = candidate(IDS.xray);
  for (const name of ['Build Analysis Input', 'AI X-Ray Analysis', 'IF Source Pair Safe', 'IF Analysis Valid',
    'IF Publish Client Result', 'IF Verified Telegram Route', 'Send Client Ready Notification',
    'IF Client Notification Delivered', 'Notified Analysis Row', 'Update Analysis Notified',
    'Notified Pipeline Row', 'Update Pipeline Notified', 'Notified Activity Row', 'Append Notified Activity']) {
    eq(j(byName(b, name)), j(byName(a, name)), name + ': protected logic drift');
  }
  const beforeViewedReferences = (j(a).match(/CLIENT_VIEWED/g) || []).length;
  const afterViewedReferences = (j(b).match(/CLIENT_VIEWED/g) || []).length;
  eq(afterViewedReferences, beforeViewedReferences, 'CLIENT_VIEWED references changed without new proof');
});
check('Lead scoring is byte-identical', () => {
  eq(j(byName(candidate(IDS.intake), 'Normalize + Score Lead')), j(byName(pre(IDS.intake), 'Normalize + Score Lead')), 'lead scoring drift');
});
check('CRM writers and schemas are byte-identical', () => {
  const pairs = [[IDS.intake, ['Save Answers to Lead_Answers', 'Save to Pipeline', 'Save Lead to CRM']],
    [IDS.concierge, ['Save Bot Session', 'Save Confirmation State', 'Save Intake State']],
    [IDS.gateway, ['Create App Session']]];
  for (const [id, names] of pairs) for (const name of names) eq(j(byName(candidate(id), name)), j(byName(pre(id), name)), id + '/' + name + ': schema/writer drift');
});
check('Starter controls and Niagara data are untouched', () => {
  for (const id of Object.values(IDS)) {
    const before = pre(id); const after = candidate(id);
    for (const node of before.nodes.filter((n) => /starter|budget|limit|niagara/i.test(n.name))) {
      eq(j(byName(after, node.name)), j(node), id + '/' + node.name + ': protected drift');
    }
  }
});

console.log('\nC1 ASSERTIONS: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('FAILURES:'); for (const failure of failures) console.log('  - ' + failure);
  process.exit(1);
}
