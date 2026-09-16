#!/usr/bin/env node
// FINMENTOR V1 FINAL CLOSURE — C1 candidate builder.
// Repo/local only. Reads redacted live backups and emits bounded candidates under .uat/.
// It never contacts n8n and never mutates production.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTEXT_PROJECTION_WITH_LOCALE } from './deploy-c3-concierge-cycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const PRE = resolve(ROOT, argValue('--pre', '.uat/c1-final-closure/pre'));
const OUT = resolve(ROOT, argValue('--out', '.uat/c1-final-closure/candidates'));
const MINIAPP_URL = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-premium-miniapp';
const GATEWAY_URL = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-gateway';
const SESSION_URL = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-session';
const SUBMIT_URL = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-submit';

const IDS = {
  concierge: 'mppzthlkSJFr6Kle', host: 'KBD7Q94QQnlzgYKJ', gateway: 'nTZHLbv2KFggdhh5',
  intake: 'QmIyEW2ZEqKregmN', xray: 'tNSMRoKlFB52vjge', command: 'qF9tonlHHIxc8MDd',
  daily: 'imeJIDeNyaWDyXzh', sla: 'LZ2mvKXbBikmeVTn', followup: 'zeLOCuf0K1bkaKl2',
  systemAlert: 'ID700kTo6EXffwry', errorMonitor: 'RBiFLhVjizMkAzrK'
};

const ALLOWED = {
  [IDS.concierge]: ['Build Bot Response', 'Build Bot Response (Premium)', 'Prepare Cycle Projection', 'Build Intake Transport Request'],
  [IDS.host]: ['Serve Page'],
  [IDS.gateway]: ['Build App Session'],
  [IDS.intake]: ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert', 'Build Short AI Telegram'],
  [IDS.xray]: ['Analysis Failed Row', 'Validate + Store Rows', 'Render Review Surface', 'Review POST Verdict', 'Build Curated Client Result', 'Build Client Ready Notification', 'Complete Client Ready Notification', 'Complete Outbound Contact'],
  [IDS.command]: ['Build Query Reply', 'Find & Build Update', 'Verify Mutation'],
  [IDS.daily]: ['Build Daily Digest'],
  [IDS.sla]: ['SLA Select'],
  [IDS.followup]: ['Build Followup Plan'],
  [IDS.systemAlert]: ['Build System Alert'],
  [IDS.errorMonitor]: ['Build Error Alert']
};

function fail(message) { throw new Error('C1 BUILD REFUSED: ' + message); }
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function stable(value) { return JSON.stringify(value); }
function fileFor(id) {
  const name = readdirSync(PRE).find((f) => f.startsWith(id + '.') && f.endsWith('.json'));
  if (!name) fail('missing pre-deploy backup for ' + id);
  return join(PRE, name);
}
function load(id) { return JSON.parse(readFileSync(fileFor(id), 'utf8').replace(/^\uFEFF/, '')); }
function node(workflow, name) {
  const found = workflow.nodes.find((n) => n.name === name);
  if (!found) fail(workflow.id + ': missing node ' + name);
  return found;
}
function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) fail(label + ': expected one anchor, found ' + count);
  return text.replace(before, after);
}
function replaceVisibleTerms(text) {
  return text
    .split('Финансовый рентген — расширенная анкета').join('Финансовая диагностика — расширенная анкета')
    .split('Финансовый рентген — быстрый рентген').join('Финансовая диагностика — краткая анкета');
}
function setCode(workflow, name, code) { node(workflow, name).parameters.jsCode = code; }

function buildConcierge(workflow) {
  const generated = JSON.parse(readFileSync(join(ROOT, 'n8n/candidate/premium-concierge-candidate.json'), 'utf8'));
  const generatedCode = node(generated, 'Build Bot Response').parameters.jsCode
    .split('__PREMIUM_MINIAPP_URL__').join(MINIAPP_URL);
  if (generatedCode.includes('__PREMIUM_')) fail('Concierge: unresolved placeholder in generated response');
  setCode(workflow, 'Build Bot Response', generatedCode);
  setCode(workflow, 'Build Bot Response (Premium)', generatedCode);

  let projection = node(workflow, 'Prepare Cycle Projection').parameters.jsCode;
  projection = replaceOnce(projection,
    "const g = ($('Get Bot Session (Premium)').isExecuted ? $('Get Bot Session (Premium)') : $('Get Bot Session')).first().json || {};",
    "const g = ($('Get Bot Session (Premium)').isExecuted ? $('Get Bot Session (Premium)') : $('Get Bot Session')).first().json || {};\n" +
    "const b = ($('Build Bot Response (Premium)').isExecuted ? $('Build Bot Response (Premium)') : $('Build Bot Response')).first().json || {};\n" +
    "const session = b.session || row;\n" + CONTEXT_PROJECTION_WITH_LOCALE,
    'Concierge projection context splice');
  projection = replaceOnce(projection, "const now = new Date().toISOString();", "const now = new Date().toISOString();\nconst projectionValue = contextProjection(g.cycle_reset, session);", 'Concierge projection value');
  const resetExpr = "cycle_reset: String(g.cycle_reset || '')";
  if (projection.split(resetExpr).length - 1 !== 2) fail('Concierge projection: expected two cycle_reset mappings');
  projection = projection.split(resetExpr).join('cycle_reset: projectionValue');
  setCode(workflow, 'Prepare Cycle Projection', projection);

  let confirmation = node(workflow, 'Build Intake Transport Request').parameters.jsCode;
  confirmation = replaceOnce(confirmation,
    "const ok = intake ? intake.intake_ok === true : String(persisted.lead_id || '') !== '';",
    "const ok = intake ? intake.intake_ok === true : String(persisted.lead_id || '') !== '';\n" +
    "const isMeeting = !!(b.lead_payload && b.lead_payload.meta && b.lead_payload.meta.request_type === 'meeting_request');",
    'Meeting confirmation discriminator');
  const oldSuccess = "const successText = 'Спасибо. Я передал ваш запрос эксперту FINMENTOR.\\n\\n' + 'Мы посмотрим контекст и вернёмся с подходящим первым шагом: Financial X-Ray, встреча или список данных для первичного анализа.\\n\\n' + 'Ничего дополнительно делать сейчас не нужно.';";
  const newSuccess = "const successText = isMeeting\n  ? 'Запрос на встречу принят.\\n\\nМы свяжемся с вами, чтобы согласовать удобное время.\\n\\nМы свяжемся с вами в течение 1 рабочего дня.'\n  : 'Спасибо. Ваш запрос передан эксперту FINMENTOR.\\n\\nМы свяжемся с вами в течение 1 рабочего дня.';";
  confirmation = replaceOnce(confirmation, oldSuccess, newSuccess, 'Meeting success copy');
  const oldFail = "const failText = 'Спасибо. Я зафиксировал ваш запрос.\\n\\n' + 'Мы проверим детали и вернёмся к вам в этом чате или по указанному контакту.';";
  const newFail = "const failText = isMeeting\n  ? 'Не удалось зарегистрировать запрос на встречу.\\n\\nЗапрос не считается принятым. Вернитесь в главное меню и повторите действие.'\n  : 'Не удалось передать запрос консультанту.\\n\\nОбращение не считается принятым. Вернитесь в главное меню и повторите действие.';";
  confirmation = replaceOnce(confirmation, oldFail, newFail, 'Meeting failure copy');
  setCode(workflow, 'Build Intake Transport Request', confirmation);
}

function buildHost(workflow) {
  const generated = JSON.parse(readFileSync(join(ROOT, 'n8n/candidate/premium-miniapp-host-candidate.json'), 'utf8'));
  let page = String(node(generated, 'Serve Page').parameters.responseBody || '');
  page = page.split('__PREMIUM_GATEWAY_URL__').join(GATEWAY_URL)
    .split('__PREMIUM_SESSION_URL__').join(SESSION_URL)
    .split('__PREMIUM_SUBMIT_URL__').join(SUBMIT_URL);
  if (/__PREMIUM_[A-Z_]+__/.test(page)) fail('Host: unresolved endpoint placeholder');
  node(workflow, 'Serve Page').parameters.responseBody = page;
}

function buildGateway(workflow) {
  const generated = JSON.parse(readFileSync(join(ROOT, 'n8n/candidate/miniapp-gateway-candidate.json'), 'utf8'));
  const code = node(generated, 'Build App Session').parameters.jsCode;
  if (!code.includes('function c1Draft(') || !code.includes("source, confirmed")) fail('Gateway: C1 draft seed missing');
  setCode(workflow, 'Build App Session', code);
}

const MEETING_RENDER = String.raw`
function c1MeetingAlert(item) {
  let payload = {};
  try { payload = JSON.parse(String(item.raw_json || '{}')); } catch (e) { payload = {}; }
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  if (meta.request_type !== 'meeting_request') return '';
  const client = payload.client && typeof payload.client === 'object' ? payload.client : {};
  const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tidy = (v, n) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() + '…' : s; };
  const lines = ['📅 <b>FINMENTOR · Запрос на встречу</b>'];
  const identity = [tidy(client.name || item.name, 70), tidy(client.company || item.company, 70), tidy(client.role || item.role, 60)].filter(Boolean);
  if (identity.length) lines.push('', identity.map(esc).join(' · '));
  const tg = tidy(client.telegram || item.telegram || meta.telegram_username || meta.telegram_user_id, 72);
  if (tg) lines.push('', '<b>Предпочтительный контакт</b>', 'Telegram · ' + esc(tg));
  const context = tidy(meta.original_telegram_text || (payload.premium && payload.premium.important_context) || (payload.main_pain && payload.main_pain.problem), 240);
  if (context) lines.push('', '<b>Контекст</b>', esc(context));
  lines.push('', '<b>Следующее действие</b>', 'Согласовать встречу');
  return lines.join('\n');
}
const c1Meeting = c1MeetingAlert(item);
if (c1Meeting) return [{ json: Object.assign({}, item, { alert_html: c1Meeting }) }];`;

function buildIntake(workflow) {
  for (const name of ['Build Premium Telegram Brief', 'Build Warm Telegram Alert', 'Build Incomplete Telegram Alert']) {
    let code = replaceVisibleTerms(node(workflow, name).parameters.jsCode);
    code = replaceOnce(code, 'const item = $input.first().json;', 'const item = $input.first().json;\n' + MEETING_RENDER, name + ' meeting renderer');
    setCode(workflow, name, code);
  }
  let short = node(workflow, 'Build Short AI Telegram').parameters.jsCode;
  short = replaceOnce(short, 'ГЛАВНАЯ БОЛЬ', 'КЛЮЧЕВАЯ ПРОБЛЕМА', 'AI work-plan visible heading');
  setCode(workflow, 'Build Short AI Telegram', short);
}

function buildXray(workflow) {
  for (const name of ALLOWED[IDS.xray]) {
    let code = node(workflow, name).parameters.jsCode;
    code = code
      .split('Финансовый рентген бизнеса').join('Финансовая диагностика')
      .split('Финансовый рентген').join('Финансовая диагностика')
      .split('ГЛАВНАЯ БОЛЬ').join('КЛЮЧЕВАЯ ПРОБЛЕМА')
      .split('Главная боль').join('Ключевая проблема')
      .split('01 · Боль').join('01 · Проблема')
      .split('__PREMIUM_MINIAPP_URL__').join(MINIAPP_URL);
    setCode(workflow, name, code);
  }
}

function buildCommand(workflow) {
  for (const name of ALLOWED[IDS.command]) {
    let code = replaceVisibleTerms(node(workflow, name).parameters.jsCode);
    if (name === 'Build Query Reply') code = replaceOnce(code, 'Боль:', 'Проблема:', 'Command query visible label');
    setCode(workflow, name, code);
  }
}

function buildScheduledPresentation(workflow, nodeName) {
  setCode(workflow, nodeName, replaceVisibleTerms(node(workflow, nodeName).parameters.jsCode));
}

function validateDelta(before, after, allowedNames) {
  if (before.name !== after.name) fail(before.id + ': workflow name changed');
  if (stable(before.settings || {}) !== stable(after.settings || {})) fail(before.id + ': workflow settings changed');
  if (stable(before.connections || {}) !== stable(after.connections || {})) fail(before.id + ': connection graph changed');
  if (before.nodes.length !== after.nodes.length) fail(before.id + ': node count changed');
  const changed = [];
  for (const oldNode of before.nodes) {
    const nextNode = node(after, oldNode.name);
    const a = clone(oldNode); const b = clone(nextNode);
    const isHost = oldNode.name === 'Serve Page';
    if (isHost) { a.parameters.responseBody = ''; b.parameters.responseBody = ''; }
    else if (a.parameters && Object.prototype.hasOwnProperty.call(a.parameters, 'jsCode')) { a.parameters.jsCode = ''; b.parameters.jsCode = ''; }
    if (stable(a) !== stable(b)) fail(before.id + ': non-copy/node metadata changed in ' + oldNode.name);
    if (stable(oldNode.parameters) !== stable(nextNode.parameters)) changed.push(oldNode.name);
    if (stable(oldNode.credentials || {}) !== stable(nextNode.credentials || {})) fail(before.id + ': credential drift in ' + oldNode.name);
  }
  const unexpected = changed.filter((name) => !allowedNames.includes(name));
  if (unexpected.length) fail(before.id + ': unexpected changed nodes: ' + unexpected.join(', '));
  if (!changed.length) fail(before.id + ': candidate has no change');
  return changed;
}

mkdirSync(OUT, { recursive: true });
const report = [];
for (const [kind, id] of Object.entries(IDS)) {
  const before = load(id); const after = clone(before);
  if (kind === 'concierge') buildConcierge(after);
  else if (kind === 'host') buildHost(after);
  else if (kind === 'gateway') buildGateway(after);
  else if (kind === 'intake') buildIntake(after);
  else if (kind === 'xray') buildXray(after);
  else if (kind === 'command') buildCommand(after);
  else if (kind === 'daily') buildScheduledPresentation(after, 'Build Daily Digest');
  else if (kind === 'sla') buildScheduledPresentation(after, 'SLA Select');
  else if (kind === 'followup') buildScheduledPresentation(after, 'Build Followup Plan');
  else if (kind === 'systemAlert') buildScheduledPresentation(after, 'Build System Alert');
  else if (kind === 'errorMonitor') buildScheduledPresentation(after, 'Build Error Alert');
  const changed = validateDelta(before, after, ALLOWED[id]);
  const outPath = join(OUT, id + '.candidate.json');
  writeFileSync(outPath, JSON.stringify(after, null, 2) + '\n');
  report.push({ id, name: before.name, changed, before_sha256: sha(stable(before)), candidate_sha256: sha(stable(after)), out: outPath });
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), pre: PRE, workflows: report }, null, 2) + '\n');
console.log('C1 bounded candidates: PASS');
for (const row of report) console.log('  ' + row.id + ' | ' + row.changed.join(', '));
console.log('  CRM schema / credentials / webhooks / schedules / connections: unchanged');
