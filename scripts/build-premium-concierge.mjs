#!/usr/bin/env node
// FINMENTOR — Premium RU Concierge candidate.
//
//   node scripts/build-premium-concierge.mjs --live <live-export.json>
//
// REPO-ONLY. Emits n8n/candidate/premium-concierge-candidate.json and never contacts n8n.
// It is a CANDIDATE, not a deployment.
//
// IT REPLACES NOTHING. It ADDS an owner-only branch.
//
// The live Concierge is 51 nodes and serves real customers. Almost all of those nodes are the
// SPINE: session read, the issuance gate, receipt preallocation and readback, the authority re-read
// and verdict, the stale- and unresolved-authority branches, the transport worker, the internal
// handoff to Lead Intake. Every P8/P9 hardening decision lives there and every one is closed at GO.
//
// An earlier version of this script OVERWROTE `Build Bot Response`. That was fine while the
// candidate was never going to be deployed; it stopped being fine the moment owner-only UAT on the
// live bot became the plan, because it would have put the Premium flow in front of every customer.
//
// So: three nodes are added, none is modified, none is removed, and a non-owner reaches exactly
// the node they reach today — one IF later. Owner-only becomes a server-side property rather than
// an unlisted URL.
//
// THE NODE BODY IS GENERATED FROM THE GATED MODULES. `n8n/src/premium-ux/tg-state-machine.js` and
// the TG_COPY block of `branches.js` are inlined verbatim at build time rather than retyped here.
// qa/premium-ux-state.test.mjs and qa/premium-ux-content.test.mjs drive those modules, so the
// deployed node and the tested logic cannot drift apart — there is only one copy of the decision.
//
// THE DEFECT THIS FIXES. The deployed `Get Bot Session` does, unconditionally:
//
//     const isStart = text === '/start';
//     if (isStart) reset = 'start';
//
// so `/start` after a committed submission silently archives lead_id, clears consent and wipes
// every qualification answer. `decide()` forbids it: after a committed submission, no input
// returns the user to qualification without an explicit CONFIRMED new-request action, and exactly
// two branches in the whole machine rotate a cycle. The gate below counts them.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');

export const RESPONSE_NODE = 'Build Bot Response';

// Injected at deploy time. The Mini App URL is NOT baked into a tracked artifact.
export const MINIAPP_URL_PLACEHOLDER = '__PREMIUM_MINIAPP_URL__';

const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const SM_PATH = join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js');
const CX_PATH = join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js');
const SM = require(SM_PATH);

const args = process.argv.slice(2);
const livePath = args[args.indexOf('--live') + 1];
if (!livePath || livePath.startsWith('--')) {
  console.error('usage: node scripts/build-premium-concierge.mjs --live <live-export.json>');
  process.exit(1);
}
const live = JSON.parse(readFileSync(livePath, 'utf8'));

// Display caches carry the production spreadsheet URL. Stripped from the BASE as well, so the
// drift check compares like with like.
function sanitize(v) {
  if (!v || typeof v !== 'object') { return v; }
  if (Array.isArray(v)) { return v.map(sanitize); }
  const out = {};
  for (const k of Object.keys(v)) {
    if (k === 'cachedResultUrl' || k === 'cachedResultName') { continue; }
    out[k] = sanitize(v[k]);
  }
  return out;
}
const baseNodes = sanitize(JSON.parse(JSON.stringify(live.nodes)));
const cachesStripped = JSON.stringify(live.nodes).split('"cachedResult').length - 1;

// ------------------------------------------------------------------ the node body

// The module source, minus its CommonJS shell. Inlined rather than reimplemented.
// The extraction module, inlined the same way and for the same reason: one copy of the logic, and
// qa/premium-ux-extraction.test.mjs drives it. Its `shownSections` and `promoteShown` reach back
// into the other two modules through `require`, which does not exist in a Code node — so those two
// functions are dropped here and the adapter calls `confirmContextSections` directly instead.
const cxSource = readFileSync(CX_PATH, 'utf8')
  .replace(/^'use strict';\s*$/m, '')
  .replace(/^const B = require\('\.\/branches\.js'\);\s*$/m, '')
  .replace(/^function shownSections\(normalised, turnoverBand\) \{[\s\S]*?\n\}\s*$/m, '')
  .replace(/^function promoteShown\(draft, sections, nowIso\) \{[\s\S]*?\n\}\s*$/m, '')
  .replace(/^module\.exports = \{[\s\S]*?\};\s*$/m, '')
  .trim();

const smSource = readFileSync(SM_PATH, 'utf8')
  .replace(/^'use strict';\s*$/m, '')
  .replace(/^const B = require\('\.\/branches\.js'\);\s*$/m, '')
  .replace(/^module\.exports = \{[\s\S]*?\};\s*$/m, '')
  .trim();

const ADAPTER_HEAD = [
  '// Build Bot Response — FINMENTOR PREMIUM RU Concierge.',
  '//',
  '// GENERATED by scripts/build-premium-concierge.mjs from n8n/src/premium-ux/tg-state-machine.js',
  '// and the TG_COPY block of branches.js. DO NOT EDIT IN THE n8n UI: the next build overwrites it,',
  '// and an edit here would not be covered by qa/premium-ux-state.test.mjs. Change the module.',
  '//',
  '// It keeps the OUTPUT CONTRACT of the node it replaces exactly — chat_id, reply_text,',
  '// reply_markup, tg_body, session, lead_ready, lead_payload, ai_guarded, debug, event — because',
  '// eleven downstream nodes read those keys and none of them is in scope here.',
  '',
  '// `B` stands in for branches.js, which cannot be required inside a Code node. It carries exactly',
  '// what the two inlined modules read from it — the approved copy and the approved taxonomy — so a',
  '// value that is not in branches.js cannot appear here. The extraction module reads',
  '// B.OBJECTIVE_IDS and B.objectiveById; leaving those off produced a node that threw on the first',
  '// message, which is what the executed gate caught.',
  'const OBJECTIVE_LABEL = ' + JSON.stringify(B.OBJECTIVES.reduce((a, o) => { a[o.id] = o.label; return a; }, {}), null, 2) + ';',
  'const B = {',
  '  TG_COPY: ' + JSON.stringify(B.TG_COPY, null, 2).split('\n').join('\n') + ',',
  '  OBJECTIVE_IDS: ' + JSON.stringify(B.OBJECTIVE_IDS) + ',',
  '  OBJECTIVE_LABELS: ' + JSON.stringify(B.OBJECTIVE_LABELS) + ',',
  // `normalise` validates turnover_band against the approved bands. Leaving SCALE_OPTIONS off
  // this stub is the same class of defect as the missing OBJECTIVE_IDS: the module reads it, the
  // node would throw on the first message that states a turnover, and only an EXECUTED gate finds
  // it. The gate below asserts every B key the inlined modules touch.
  '  SCALE_OPTIONS: ' + JSON.stringify(B.SCALE_OPTIONS) + ',',
  '  objectiveById: (id) => (OBJECTIVE_LABEL[id] ? { id: id, label: OBJECTIVE_LABEL[id] } : null),',
  '  objectiveByLabel: (label) => {',
  '    for (const id of Object.keys(OBJECTIVE_LABEL)) {',
  '      if (OBJECTIVE_LABEL[id] === label) { return { id: id, label: label }; }',
  '    }',
  '    return null;',
  '  }',
  '};',
  '',
  'const MINIAPP_URL = ' + JSON.stringify(MINIAPP_URL_PLACEHOLDER) + ';',
  'const objectiveLabel = (id) => OBJECTIVE_LABEL[id] || "";',
  ''
].join('\n');

const ADAPTER_TAIL = [
  '',
  '// ---------------------------------------------------------------- rendering',
  '',
  '// Telegram-safe text. The copy is approved RU prose, so nothing here may re-word it — only',
  '// characters Telegram would misparse are removed.',
  '//',
  '// ON AN HTML SCREEN THE ANGLE BRACKETS MUST SURVIVE. Stripping them is right for plain text',
  '// and destroys the markup here, which is why the mode is passed in rather than assumed. Only',
  '// TG_ENTRY sets it, and only because that screen is entirely static approved copy: a screen',
  '// that renders client-supplied text must escape it before it could ever be sent as HTML.',
  '// Client-derived values are interpolated into an HTML screen, so they are escaped before they',
  '// go anywhere near a tag. safeText deliberately does NOT strip < and > on an HTML screen — the',
  '// authored copy needs its tags — so escaping the VALUES is the only thing standing between a',
  '// client typing "<" and a broken send.',
  'function escapeHtml(value) {',
  '  return String(value === null || value === undefined ? "" : value)',
  '    .split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;");',
  '}',
  '',
  'function safeText(value, max, html) {',
  '  let t = String(value === null || value === undefined ? "" : value)',
  '    .replace(/\\r/g, "")',
  '    .replace(html ? /(?:)/g : /[<>]/g, "")',
  '    .replace(/[ \\t]+\\n/g, "\\n")',
  '    .replace(/\\n{4,}/g, "\\n\\n\\n")',
  '    .trim();',
  '  const cap = max || 3800;',
  '  if (t.length > cap) { t = t.slice(0, cap).trim() + "..."; }',
  '  return t;',
  '}',
  '',
  '// Which callback each approved action label carries. Built from ACTIONS so a label can never be',
  '// wired to an action that does not exist.',
  'const LABEL_ACTION = {',
  '  "Описать задачу": ACTIONS.DESCRIBE,',
  '  "Подготовить бриф": ACTIONS.BRIEF,',
  '  "Всё верно": ACTIONS.CONFIRM_OK,',
  '  "Исправить": ACTIONS.CONFIRM_FIX,',
  '  "Открыть бриф": ACTIONS.OPEN,',
  '  "Продолжить": ACTIONS.RESUME,',
  '  "Начать заново": ACTIONS.RESTART,',
  '  "Начать новое": ACTIONS.RESTART_CONFIRM,',
  '  "Добавить к обращению": ACTIONS.APPEND,',
  '  "Начать новый вопрос": ACTIONS.NEW,',
  '  "Да, начать новый вопрос": ACTIONS.NEW_CONFIRM,',
  '  "Вернуться": ACTIONS.BACK,',
  '  "Повторить": ACTIONS.RETRY',
  '};',
  '',
  '// «Открыть бриф» is the ONLY web_app button. Everything else is a callback, so a stale message',
  '// can never launch the Mini App with an identity the server has not re-resolved.',
  '// A label carries a different action on a CONFIRMATION screen than on the screen that opened it.',
  '// «Начать новый вопрос» appears on three screens: on TG_SUBMITTED and on the append confirmation',
  '// it OPENS the confirmation, and on TG_NEW_REQUEST_CONFIRM it must CONFIRM. With one global',
  '// label->action map it opened the confirmation from inside the confirmation, so the primary',
  '// button re-rendered its own screen and a client could never actually start a new question.',
  '// ACTIONS.NEW_CONFIRM was reachable only through «Да, начать новый вопрос», which no screen',
  '// renders.',
  '//',
  '// Keyed by STATE as well as label, so the fix cannot leak: the discard confirmation reuses the',
  '// TG_NEW_REQUEST_CONFIRM state id but renders «Начать новое», which is not in this table.',
  'const LABEL_ACTION_BY_STATE = {',
  '  TG_NEW_REQUEST_CONFIRM: { "Начать новый вопрос": ACTIONS.NEW_CONFIRM }',
  '};',
  '',
  'function buildMarkup(labels, sessionId, state) {',
  '  const perState = LABEL_ACTION_BY_STATE[String(state || "")] || {};',
  '  const rows = [];',
  '  for (const label of labels || []) {',
  '    if (label === "Открыть бриф") {',
  '      rows.push([{ text: label, web_app: { url: MINIAPP_URL } }]);',
  '      continue;',
  '    }',
  '    const action = perState[label] || LABEL_ACTION[label];',
  '    if (!action) { continue; }',
  '    rows.push([{ text: label, callback_data: action }]);',
  '  }',
  '  return rows.length ? { inline_keyboard: rows } : { inline_keyboard: [] };',
  '}',
  '',
  '// TG_CONFIRM_CONTEXT is the one screen assembled from data rather than fixed lines. A field with',
  '// no content renders NO label — never «Компания: —» (owner decision C).',
  'function renderCopy(copy, auth) {',
  '  if (!copy) { return { text: "", actions: [] }; }',
  '  if (copy.header) {',
  '    const lines = [copy.header, ""];',
  '    for (const s of confirmContextSections(auth.context_extracted)) {',
  '      lines.push(s.label);',
  '      lines.push("<b>" + escapeHtml(s.value) + "</b>");',
  '      lines.push("");',
  '    }',
  '    lines.push(copy.closing);',
  '    return { text: lines.join("\\n"), actions: copy.actions || [] };',
  '  }',
  '  return { text: (copy.text || []).join("\\n\\n"), actions: copy.actions || [] };',
  '}',
  '',
  '// ---------------------------------------------------------------- input',
  '',
  '// In the deployed graph this node sits directly after Get Bot Session, which returns the SESSION',
  '// ROW ITSELF, flat — not `{session: {...}}`. The offline harness passes the wrapped shape. Both',
  '// are accepted, because getting this wrong would silently produce an empty session and a bot that',
  '// greets a committed client as a stranger.',
  'const src = $input.first().json;',
  'const session = Object.assign({}, (src && src.session) ? src.session : src);',
  '',
  '// The message and the callback come from Parse Telegram Update, which is the only node that has',
  '// them. `$` does not exist in the offline harness, so its absence is a normal case, not an error.',
  'const p = (function () { try { return $("Parse Telegram Update").first().json || {}; } catch (e) { return {}; } })();',
  'const chat_id = String(session.chat_id || src.chat_id || p.chat_id || "");',
  'const text = String(p.message_text || src.message_text || src.text || "");',
  'const data = String(p.callback_data || src.callback_data || src.data || "");',
  '',
  '// The authority snapshot is resolved UPSTREAM, from Bot_Sessions, and is read here rather than',
  '// derived from the message. `committed` is never taken from a caller.',
  'const auth = {',
  '  cycle_id: String(session.cycle_id || ""),',
  '  lead_id: String(session.lead_id || ""),',
  '  lead_cycle_id: String(session.lead_cycle_id || ""),',
  '  has_draft: String(session.draft_state || "") === "draft",',
  '  draft_step: String(session.draft_step || ""),',
  '  context_extracted: (function () {',
  '    try { return JSON.parse(session.context_extracted_json || "{}"); } catch (e) { return {}; }',
  '  })(),',
  '  awaiting_problem: String(session.state || "") === "TG_FREEFORM_PROBLEM",',
  '  awaiting_append: String(session.state || "") === "TG_APPEND_MESSAGE"',
  '};',
  '',
  'let input;',
  'if (data) { input = { kind: "callback", value: data }; }',
  'else if (text.charAt(0) === "/") { input = { kind: "command", value: text.trim().split(/\\s+/)[0] }; }',
  'else { input = { kind: "text", value: text }; }',
  '',
  'const stateBefore = String(session.state || "TG_ENTRY");',
  'const outcome = decide(auth, input);',
  '',
  '// The terminal rule, asserted on the OUTCOME rather than trusted from the machine. If this ever',
  '// fires the machine has a defect, and the safe answer is the terminal screen — not qualification.',
  'let violated = false;',
  'if (violatesTerminalRule(auth, input, outcome)) {',
  '  violated = true;',
  '  outcome.state = "TG_SUBMITTED";',
  '  outcome.copy = B.TG_COPY.TG_SUBMITTED;',
  '  outcome.rotate = false;',
  '  outcome.writes = [];',
  '}',
  '',
  'if (STATES.indexOf(outcome.state) === -1) { outcome.state = "TG_ENTRY"; outcome.copy = B.TG_COPY.TG_ENTRY; }',
  '',
  '// An empty or whitespace-only message is not an answer to "describe your situation". Carrying it',
  '// forward would store an empty summary AND — since nothing structured can be found in nothing —',
  '// let the "no structure, skip ahead" rule below march past the one question this screen exists',
  '// to ask. Stay on the screen instead, and write nothing.',
  'if (outcome.state === "TG_CONFIRM_CONTEXT" && (outcome.writes || []).indexOf("free_text") !== -1',
  '    && String(outcome.free_text || "").trim() === "") {',
  '  outcome.state = "TG_FREEFORM_PROBLEM";',
  '  outcome.copy = B.TG_COPY.TG_FREEFORM_PROBLEM;',
  '  outcome.writes = [];',
  '  outcome.free_text = "";',
  '}',
  '',
  '// ---------------------------------------------------------------- session writes',
  '',
  'const writes = outcome.writes || [];',
  'session.state = outcome.state;',
  '',
  '// Cycle rotation is the only destructive write, it happens on exactly two confirmed actions, and',
  '// it archives a lead ONLY when one exists.',
  'if (outcome.rotate === true) {',
  '  if (writes.indexOf("archive_lead") !== -1 && auth.lead_id) {',
  '    session.archived_lead_id = auth.lead_id;',
  '  }',
  '  session.lead_id = "";',
  '  session.lead_cycle_id = "";',
  '  session.draft_state = "";',
  '  session.draft_step = "";',
  '  session.context_extracted_json = "";',
  '  session.cycle_id = "";   // minted by the issuer downstream, never here',
  '}',
  '',
  'if (writes.indexOf("free_text") !== -1) { session.free_text_request = safeText(outcome.free_text, 500); }',
  'if (writes.indexOf("confirm_context") !== -1) { session.context_confirmed = "true"; }',
  'if (writes.indexOf("activity_append") !== -1) { session.append_text = safeText(outcome.append_text, 500); }',
  '',
  '// ---------------------------------------------------------------- output',
  '',
  '// ---------------------------------------------------------------- context extraction',
  '',
  '// The free text has just arrived. Extraction proposes structure; `normalise` decides what is',
  '// allowed through. Everything that survives is ai_inferred and unconfirmed, which is why it can',
  '// prefill a later screen but can never skip a question.',
  'if (outcome.state === "TG_CONFIRM_CONTEXT" && (writes || []).indexOf("free_text") !== -1) {',
  '  const proposal = normalise(extractDeterministic(outcome.free_text || text));',
  '  auth.context_extracted = {',
  '    company_name: proposal.fields.company_name || "",',
  '    role: proposal.fields.role || "",',
  '  // The client\'s OWN answer always wins. Extraction only fills a band the client has not',
  '  // given, and only from a stated turnover — never from prose. «Предпочитаю не указывать»',
  '  // cannot be produced by extraction at all, so a client who chose it keeps that choice.',
  '    turnover_band: String(session.turnover_band || proposal.fields.turnover_band || ""),',
  '    objective: proposal.fields.objective ? (objectiveLabel(proposal.fields.objective) || "") : "",',
  '    problem_summary: proposal.fields.problem_summary || ""',
  '  };',
  '  // Stored so the Mini App can prefill from the same proposal, and so «Всё верно» has',
  '  // something to promote. The draft itself is written by the endpoint, not here.',
  '  session.context_extracted_json = JSON.stringify(auth.context_extracted);',
  '  session.context_confirmed = "false";',
  '}',
  '',
  '// «Исправить» must not leave the rejected guess in place — a later screen would prefill from a',
  '// value the client has just told us is wrong.',
  'if (input.kind === "callback" && input.value === ACTIONS.CONFIRM_FIX) {',
  '  session.context_extracted_json = "";',
  '  session.context_confirmed = "false";',
  '}',
  '',
  '// The confirmation screen has to EARN its place. «Проверьте, правильно ли FINMENTOR понял ваш',
  '// контекст» is worth asking when extraction found structure — a company, a role, an objective.',
  '// It is not worth asking when the only thing on screen is the client\'s own sentence read back',
  '// to them: that is a step with no decision in it, and it makes the product look like it',
  '// understood something when it did not.',
  '//',
  '// So the screen renders only when at least one STRUCTURED field survived. `problem_summary` is',
  '// the client\'s own words and never counts towards that on its own.',
  'const structuralKeys = ["company_name", "role", "turnover_band", "objective"];',
  'const sectionsNow = confirmContextSections(auth.context_extracted);',
  'const hasStructure = sectionsNow.some((s) => structuralKeys.indexOf(s.key) !== -1);',
  'if (outcome.state === "TG_CONFIRM_CONTEXT" && !hasStructure) {',
  '  outcome.state = "TG_OPEN_BRIEF";',
  '  outcome.copy = B.TG_COPY.TG_OPEN_BRIEF;',
  '}',
  '',
  'const rendered = renderCopy(outcome.copy, auth);',
  '',
  '// The screen declares its own parse mode. Absent means plain text, which is every screen but',
  '// TG_ENTRY — so this changes nothing for any other reply.',
  'const parse_mode = String((outcome.copy && outcome.copy.parse_mode) || "");',
  'const reply_text = safeText(rendered.text, 3800, parse_mode === "HTML");',
  'const reply_markup = buildMarkup(rendered.actions, session.app_session_id, outcome.state);',
  '',
  '// lead_ready is FALSE on every premium screen. The premium brief is submitted through',
  '// POST /miniapp/submit, which owns the projection and the privacy record; a second path from',
  '// here would be a second authority for the same lead.',
  'return [{',
  '  json: {',
  '    chat_id: chat_id,',
  '    reply_text: reply_text,',
  '    reply_markup: reply_markup,',
  '    tg_body: { chat_id: chat_id, text: reply_text, reply_markup: reply_markup, parse_mode: parse_mode },',
  '    session: session,',
  '    lead_ready: false,',
  '    lead_payload: null,',
  '    ai_guarded: { enabled: false, model: "", used: false, fallback_used: false },',
  '    debug: {',
  '      state_before: stateBefore,',
  '      state_after: outcome.state,',
  '      detail: violated ? "terminal_rule_enforced" : ("premium_" + outcome.state.toLowerCase()),',
  '      rotate: outcome.rotate === true,',
  '      writes: writes.join(",")',
  '    },',
  '    event: {',
  '      event_type: input.kind,',
  '      state_before: stateBefore,',
  '      state_after: outcome.state,',
  '      message_text: input.kind === "text" ? text : "",',
  '      callback_data: data,',
  '      detail: violated ? "terminal_rule_enforced" : ("premium_" + outcome.state.toLowerCase())',
  '    }',
  '  }',
  '}];'
].join('\n');

// Both gated modules, in dependency order, then the adapter that binds them to n8n's item shape.
const NODE_BODY = ADAPTER_HEAD + '\n' + smSource + '\n\n' + cxSource + '\n' + ADAPTER_TAIL + '\n';

// An inlining that silently produced nothing would leave the node calling functions that do not
// exist — which is exactly what the first attempt did, and what the executed gate caught.
if (!/function normalise\b/.test(cxSource) || !/function extractDeterministic\b/.test(cxSource)) {
  console.error('REFUSING: the extraction module did not survive inlining');
  process.exit(1);
}

// ------------------------------------------------------------------ assemble

const candidate = {
  name: '[CANDIDATE] FINMENTOR Telegram Client Concierge PREMIUM UX (owner-gated)',
  nodes: JSON.parse(JSON.stringify(baseNodes)),
  connections: JSON.parse(JSON.stringify(live.connections)),
  settings: JSON.parse(JSON.stringify(live.settings || {}))
};

const fail = [];

// ------------------------------------------------------------------ the owner gate
//
// THE PREMIUM FLOW IS ADDITIVE, NOT A REPLACEMENT. The live Concierge serves real customers, so
// this candidate does NOT overwrite the existing response builder. It adds a branch only the owner
// can enter, and leaves every existing node byte-identical:
//
//   Find Session -> Premium Owner Gate --[owner]--> Get Bot Session (Premium)
//                          |                            -> Build Bot Response (Premium) --+
//                          --[everyone else]--> Get Bot Session -> Build Bot Response ----+
//                                                                                         v
//                                                                        Build Transport Request
//
// A non-owner reaches the SAME node running the SAME code, one IF later. That is what makes
// owner-only a server-side property rather than an unlisted URL.
//
// WHY THE GATE SITS BEFORE Get Bot Session AND NOT AFTER IT. Get Bot Session is where the /start
// reset lives:
//
//     const isStart = text === '/start';
//     if (isStart) reset = 'start';
//     if (reset) cycleId = 'C-' + chat_id + '-' + Date.now();
//
// It mints a new cycle BEFORE any response node runs. Gating after it would leave the premium
// machine enforcing a terminal rule on a session that had already been reset out from under it:
// the fix would appear to work and would in fact do nothing.

const OWNER_GATE = 'Premium Owner Gate';
const PREMIUM_SESSION = 'Get Bot Session (Premium)';
const PREMIUM_RESPONSE = 'Build Bot Response (Premium)';
const ANCHOR_IN = 'Find Session';
const LEGACY_SESSION = 'Get Bot Session';
const ANCHOR_OUT = 'Build Transport Request';

for (const n of [ANCHOR_IN, LEGACY_SESSION, RESPONSE_NODE, ANCHOR_OUT]) {
  if (!candidate.nodes.find((x) => x.name === n)) { fail.push('missing anchor node: ' + n); }
}

// The owner path's session resolution: the live code with the /start reset removed and nothing
// else changed. Generated from the live node so it cannot drift from the spine it mirrors.
const legacySession = baseNodes.find((n) => n.name === LEGACY_SESSION);
const RESET_LINE = "if (isStart) reset = 'start';";

// THE LINE IS NEUTERED, NOT COMMENTED OUT.
//
// It is the HEAD of an if/else chain in the live node:
//
//     if (isStart) reset = 'start';
//     else if (isRestart) reset = 'restart';
//     else if (hasNoCycle) reset = 'bootstrap';
//
// Commenting the head out orphans the first `else`, and the node dies with
// `SyntaxError: Unexpected token 'else'`. That is not hypothetical: the owner's first two real
// /start messages reached n8n and routed correctly through the owner gate, and then this node
// threw — so the bot answered nothing at all, with no error visible to the person typing.
//
// `if (false)` keeps the chain syntactically intact and keeps the removal legible in the
// deployed source. The `isStart` binding above stays — unused and harmless — rather than being
// deleted, because every other byte of this node is the live code verbatim and each extra edit
// is another chance to break something that was working.
const PREMIUM_RESET_REPLACEMENT = [
  '// [premium] REMOVED: /start no longer resets the cycle. `if (false)` rather than a comment,',
  '// because this line heads an if/else chain and commenting it out orphans the `else` below.',
  "if (false) { reset = 'start'; }"
].join('\n');
let premiumSessionCode = '';
if (legacySession) {
  const orig = legacySession.parameters.jsCode;
  if (orig.indexOf(RESET_LINE) === -1) {
    fail.push(LEGACY_SESSION + ': the /start reset line was not found -- do not splice blindly');
  } else {
    premiumSessionCode = [
      '// Get Bot Session (PREMIUM) -- the live cycle-semantics gate, with ONE line removed.',
      '//',
      '// GENERATED by scripts/build-premium-concierge.mjs from the live Get Bot Session node.',
      '// Do not edit here. This is the live code minus the /start reset, and nothing else.',
      '//',
      '// REMOVED:  ' + RESET_LINE,
      '//',
      '// In the premium flow, /start after a committed submission must land on the terminal screen',
      '// with the lead intact. Minting a new cycle here would destroy the lead before the state',
      '// machine ever saw it, and the terminal rule would be enforcing nothing.',
      '//',
      '// isRestart and hasNoCycle are UNCHANGED: a session with no cycle still bootstraps one, and',
      '// the legacy m|diag restart stays as it is -- the premium flow never sends that callback, so',
      '// it is inert here rather than removed.',
      ''
    ].join('\n') + orig.replace(RESET_LINE, PREMIUM_RESET_REPLACEMENT);
  }
}

// The owner identity is READ FROM SETTINGS, never hard-coded. The live workflow already resolves
// owner_chat_id in Settings to Object, so this reuses the identity the instance already trusts
// rather than introducing a second source of truth -- and nothing about the owner reaches this repo.
const OWNER_EXPR = '={{ String($("Parse Telegram Update").first().json.chat_id || "") }}';
const OWNER_VALUE = '={{ String(($("Settings to Object").first().json.settings || {}).owner_chat_id || "") }}';

if (!fail.length) {
  const anchorNode = candidate.nodes.find((n) => n.name === ANCHOR_IN);
  const baseX = (anchorNode && anchorNode.position && anchorNode.position[0]) || 0;
  const baseY = (anchorNode && anchorNode.position && anchorNode.position[1]) || 0;

  candidate.nodes.push({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: 'premium-owner-gate',
          leftValue: OWNER_EXPR,
          rightValue: OWNER_VALUE,
          operator: { type: 'string', operation: 'equals' }
        }],
        combinator: 'and'
      },
      options: {}
    },
    id: 'premium-owner-gate', name: OWNER_GATE,
    type: 'n8n-nodes-base.if', typeVersion: 2, position: [baseX + 160, baseY - 240]
  });

  candidate.nodes.push({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: premiumSessionCode },
    id: 'premium-get-session', name: PREMIUM_SESSION,
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [baseX + 400, baseY - 240]
  });

  candidate.nodes.push({
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: NODE_BODY },
    id: 'premium-build-response', name: PREMIUM_RESPONSE,
    type: 'n8n-nodes-base.code', typeVersion: 2, position: [baseX + 640, baseY - 240]
  });

  // Rewire: Find Session now feeds the gate; the gate feeds the two session nodes.
  candidate.connections[ANCHOR_IN] = { main: [[{ node: OWNER_GATE, type: 'main', index: 0 }]] };
  candidate.connections[OWNER_GATE] = {
    main: [
      [{ node: PREMIUM_SESSION, type: 'main', index: 0 }],   // true  -- owner
      [{ node: LEGACY_SESSION, type: 'main', index: 0 }]     // false -- everyone else, unchanged
    ]
  };
  candidate.connections[PREMIUM_SESSION] = { main: [[{ node: PREMIUM_RESPONSE, type: 'main', index: 0 }]] };
  candidate.connections[PREMIUM_RESPONSE] = { main: [[{ node: ANCHOR_OUT, type: 'main', index: 0 }]] };
}

// ------------------------------------------------------------------ invariants

// EXACTLY three nodes are added and NONE is modified. That is the strongest statement available
// about a workflow that serves real customers: the non-owner path is not 'equivalent', it is the
// same objects.
const ADDED = [OWNER_GATE, PREMIUM_SESSION, PREMIUM_RESPONSE];

if (candidate.nodes.length !== baseNodes.length + 3) {
  fail.push('node count moved: ' + baseNodes.length + ' -> ' + candidate.nodes.length + ' (expected +3)');
}

const drift = [];
for (const n of candidate.nodes) {
  if (ADDED.indexOf(n.name) !== -1) { continue; }
  const was = baseNodes.find((x) => x.name === n.name);
  if (!was) { drift.push(n.name + ' (new)'); continue; }
  if (JSON.stringify(n) !== JSON.stringify(was)) { drift.push(n.name); }
}
if (drift.length) { fail.push('UNRELATED DRIFT in ' + drift.length + ' node(s): ' + drift.slice(0, 8).join(', ')); }

// No live node was removed.
for (const n of baseNodes) {
  if (!candidate.nodes.find((x) => x.name === n.name)) { fail.push('node removed: ' + n.name); }
}

// The connection graph may differ in EXACTLY four keys, and no others.
const EXPECTED_EDGE_KEYS = [ANCHOR_IN, OWNER_GATE, PREMIUM_SESSION, PREMIUM_RESPONSE].sort();
const edgeDiff = [];
for (const k of new Set(Object.keys(live.connections).concat(Object.keys(candidate.connections)))) {
  if (JSON.stringify(live.connections[k]) !== JSON.stringify(candidate.connections[k])) { edgeDiff.push(k); }
}
if (edgeDiff.sort().join(',') !== EXPECTED_EDGE_KEYS.join(',')) {
  fail.push('unexpected rewiring: ' + edgeDiff.join(', ') + ' (expected exactly ' + EXPECTED_EDGE_KEYS.join(', ') + ')');
}

// The legacy path must still be intact end to end.
const legacyEdge = candidate.connections[LEGACY_SESSION];
if (JSON.stringify(legacyEdge) !== JSON.stringify(live.connections[LEGACY_SESSION])) {
  fail.push(LEGACY_SESSION + ': the legacy path was rewired');
}
if (JSON.stringify(candidate.connections[RESPONSE_NODE]) !== JSON.stringify(live.connections[RESPONSE_NODE])) {
  fail.push(RESPONSE_NODE + ': the legacy response path was rewired');
}

// The gate must route the FALSE branch to the legacy path. A gate that sent everyone to premium,
// or that had only one output, would expose the flow to every customer.
const gateEdges = candidate.connections[OWNER_GATE];
if (!gateEdges || !gateEdges.main || gateEdges.main.length !== 2) {
  fail.push(OWNER_GATE + ': must have exactly two outputs');
} else {
  const t = gateEdges.main[0][0] && gateEdges.main[0][0].node;
  const f = gateEdges.main[1][0] && gateEdges.main[1][0].node;
  if (t !== PREMIUM_SESSION) { fail.push(OWNER_GATE + ': the TRUE branch does not lead to the premium path'); }
  if (f !== LEGACY_SESSION) { fail.push(OWNER_GATE + ': the FALSE branch does not lead to the legacy path'); }
}

// The owner identity must be read from Settings, never embedded.
const gateNode = candidate.nodes.find((n) => n.name === OWNER_GATE);
const gateJson = JSON.stringify(gateNode || {});
if (gateJson.indexOf('owner_chat_id') === -1) { fail.push(OWNER_GATE + ': does not read owner_chat_id from Settings'); }
if (/\b\d{6,}\b/.test(gateJson)) { fail.push(OWNER_GATE + ': a literal Telegram id is embedded in the gate'); }

// The premium session node must be the live code MINUS the reset, and nothing else.
if (legacySession && premiumSessionCode) {
  if (premiumSessionCode.indexOf('[premium] REMOVED') === -1) {
    fail.push(PREMIUM_SESSION + ': the removal of the /start reset is not recorded in the node');
  }
  const strippedPremium = premiumSessionCode.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  if (/if \(isStart\) reset = /.test(strippedPremium)) {
    fail.push(PREMIUM_SESSION + ': the /start reset is still executable on the premium path');
  }
  // Everything else must survive: the cycle-semantics gate and the submission-key issuance are
  // what make the spine trustworthy, and removing either by accident would be invisible here
  // without this check.
  for (const keep of ['SUBMISSION_KEY_RE', 'hasNoCycle', 'isRestart', 'cycle_reset', '__submission_key_action']) {
    if (premiumSessionCode.indexOf(keep) === -1) { fail.push(PREMIUM_SESSION + ': lost ' + keep); }
  }
  // …and the legacy node itself must be untouched.
  if (legacySession.parameters.jsCode.indexOf(RESET_LINE) === -1) {
    fail.push(LEGACY_SESSION + ': the LIVE node was modified — non-owners must keep exactly today\'s behaviour');
  }
}

// The output contract eleven downstream nodes read.
for (const key of ['chat_id', 'reply_text', 'reply_markup', 'tg_body', 'session', 'lead_ready',
                   'lead_payload', 'ai_guarded', 'debug', 'event']) {
  if (NODE_BODY.indexOf(key + ':') === -1) { fail.push('output contract lost the key: ' + key); }
}

// Every client-facing Premium screen is HTML now (owner copy pass). What used to be "only one
// screen may declare a mode" becomes: the set is EXACTLY this, tags are Telegram-supported and
// balanced, no emoji, no Markdown — and the one screen that interpolates client text must escape
// it. That last check is the reason the old gate existed at all.
{
  const HTML_STATES = ['TG_ENTRY', 'TG_FREEFORM_PROBLEM', 'TG_CONFIRM_CONTEXT', 'TG_OPEN_BRIEF',
    'TG_SUBMITTED', 'TG_APPEND_MESSAGE', 'TG_NEW_REQUEST_CONFIRM', 'TG_INFRA_FAILURE',
    'TG_RESUME_DRAFT', 'TG_RESUME_DISCARD_CONFIRM'];
  const withMode = Object.keys(B.TG_COPY).filter((k) => B.TG_COPY[k] && B.TG_COPY[k].parse_mode);
  if (withMode.slice().sort().join(',') !== HTML_STATES.slice().sort().join(',')) {
    fail.push('HTML is declared on: ' + (withMode.join(', ') || '(none)') + ' — expected exactly the approved ten');
  }
  const ALLOWED_TAGS = ['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'tg-spoiler'];
  const screens = [];
  for (const k of HTML_STATES) {
    const c = B.TG_COPY[k];
    if (!c) { fail.push('missing screen: ' + k); continue; }
    if (c.parse_mode !== 'HTML') { fail.push(k + ' does not declare HTML'); }
    if (c.text) { screens.push([k, c.text.join('\n\n')]); }
    if (c.header) { screens.push([k + ' (header/closing)', c.header + '\n' + c.closing]); }
    if (c.done) {
      if (c.done.parse_mode !== 'HTML') { fail.push(k + '.done does not declare HTML'); }
      screens.push([k + '.done', (c.done.text || []).join('\n\n')]);
    }
  }
  for (const pair of screens) {
    const name = pair[0];
    const text = pair[1];
    for (const m of text.matchAll(/<\/?([a-z-]+)[^>]*>/g)) {
      if (ALLOWED_TAGS.indexOf(m[1]) === -1) { fail.push(name + ' uses a tag Telegram does not support: ' + m[1]); }
    }
    for (const t of ['b', 'i']) {
      const open = (text.match(new RegExp('<' + t + '>', 'g')) || []).length;
      const close = (text.match(new RegExp('</' + t + '>', 'g')) || []).length;
      if (open !== close) { fail.push(name + ' has unbalanced <' + t + '> tags'); }
    }
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) { fail.push(name + ' contains an emoji'); }
    if (/(\*\*|__)/.test(text)) { fail.push(name + ' contains Markdown emphasis'); }
    if (/(^|[^а-яё])я\s+(перенесу|перенёс|добавил|добавила|сохранил|сохранила|понял|поняла)/i.test(text)) {
      fail.push(name + ' uses first-person bot wording');
    }
  }
  // TG_CONFIRM_CONTEXT is the only data-assembled screen, and its values are client text. On an
  // HTML screen safeText does not strip < and >, so escaping the values is the whole defence.
  if (NODE_BODY.indexOf('escapeHtml(s.value)') === -1) {
    fail.push('the confirmation screen interpolates client text into HTML without escaping it');
  }
  // Failure must never read as success.
  const failText = (B.TG_COPY.TG_INFRA_FAILURE.text || []).join(' ');
  for (const w of ['Спасибо', 'получили', 'отправлено', 'успешно', 'принято']) {
    if (failText.indexOf(w) !== -1) { fail.push('TG_INFRA_FAILURE contains success wording: ' + w); }
  }
}

// All nine states, and no tenth.
for (const s of SM.STATES) { if (NODE_BODY.indexOf("'" + s + "'") === -1 && NODE_BODY.indexOf('"' + s + '"') === -1) { fail.push('state missing from the node: ' + s); } }
if (SM.STATES.length !== 9) { fail.push('the machine no longer has nine states'); }

// EXACTLY two rotate branches. A third is a product decision, not a refactor, and must fail here.
// Comments are stripped for every check below that asks "does this node DO X". The module comment
// quotes the /start defect verbatim to say what it replaces, and a check that cannot tell a
// quotation from an instruction refuses the very file that fixes it — which is what the first run
// of this script did.
const CODE_ONLY = NODE_BODY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const rotates = (CODE_ONLY.match(/rotate:\s*true/g) || []).length;
if (rotates !== 2) { fail.push('expected exactly 2 rotate branches in the node, found ' + rotates); }

// The legacy defect must be gone from EXECUTABLE code.
if (/isStart\s*=/.test(CODE_ONLY) || /reset\s*=\s*['"]start['"]/.test(CODE_ONLY)) {
  fail.push('the /start reset defect is present in the premium node');
}

// The Mini App URL is a placeholder, and «Открыть бриф» is the only web_app button.
if (NODE_BODY.indexOf(MINIAPP_URL_PLACEHOLDER) === -1) { fail.push('the Mini App URL placeholder is missing'); }
if (/https?:\/\//.test(CODE_ONLY.replace(new RegExp(MINIAPP_URL_PLACEHOLDER, 'g'), ''))) {
  fail.push('a literal URL is baked into the premium node');
}
if ((CODE_ONLY.match(/web_app:/g) || []).length !== 1) { fail.push('there must be exactly one web_app button'); }

// P9-R2 / P9-R4 across the whole candidate.
for (const n of candidate.nodes) {
  if (n.alwaysOutputData === true && n.onError === 'continueErrorOutput') { fail.push('P9-R2 FLAG PAIR on node: ' + n.name); }
}

const text = JSON.stringify(candidate);
for (const leak of ['cachedResultUrl', 'activeVersion', 'versionId', 'pinData']) {
  if (text.indexOf('"' + leak + '"') !== -1) { fail.push('leaked key in the candidate: ' + leak); }
}

// EVERY key the inlined modules read off `B` must exist on the stub that stands in for
// branches.js. `OBJECTIVE_IDS` was once missing and the node threw on the first message; adding
// `turnover_band` needed `SCALE_OPTIONS` and would have done it again. Derived from the module
// sources rather than listed by hand, so a new `B.x` in a module fails the build that introduces it.
{
  const stubKeys = ['TG_COPY', 'OBJECTIVE_IDS', 'OBJECTIVE_LABELS', 'SCALE_OPTIONS', 'objectiveById', 'objectiveByLabel'];
  const used = new Set();
  for (const src of [smSource, cxSource]) {
    for (const m of src.matchAll(/\bB\.([A-Za-z_][A-Za-z0-9_]*)/g)) { used.add(m[1]); }
  }
  for (const key of used) {
    if (stubKeys.indexOf(key) === -1) { fail.push('the inlined modules read B.' + key + ', which the node-body stub does not provide'); }
  }
  for (const key of stubKeys) {
    if (NODE_BODY.indexOf('  ' + key + ':') === -1) { fail.push('the node-body stub is missing ' + key); }
  }
}

// EVERY generated node body must parse. The response body was checked here from the start; the
// SESSION body was not, and that omission is precisely what reached production: a spliced
// if/else chain that no test executed and no gate parsed, discovered by the owner typing /start.
for (const [label, body] of [[PREMIUM_RESPONSE, NODE_BODY], [PREMIUM_SESSION, premiumSessionCode]]) {
  if (!body) { continue; }
  // A parse failure names a line number in a body that exists nowhere on disk. BUILD_DUMP_DIR
  // writes it out so that number means something.
  if (process.env.BUILD_DUMP_DIR) {
    writeFileSync(join(process.env.BUILD_DUMP_DIR, label.replace(/[^A-Za-z0-9]+/g, '_') + '.js'), body, 'utf8');
  }
  try { new Function(body.replace(/\$input/g, '__input').replace(/\$\(/g, '__ref(')); }
  catch (e) { fail.push(label + ': the generated node body does not parse: ' + e.message); }
}

// ------------------------------------------------------------------ emit

if (fail.length) {
  console.error('');
  console.error('REFUSING TO WRITE the Premium Concierge candidate:');
  for (const f of fail) { console.error('  - ' + f); }
  console.error('');
  process.exit(1);
}

const structural = (nodes, connections) => crypto.createHash('sha256').update(JSON.stringify({
  n: nodes.map((n) => [n.name, n.type, n.typeVersion, n.onError || null, n.alwaysOutputData || null]),
  c: connections
})).digest('hex');

const json = JSON.stringify(candidate, null, 2) + '\n';
writeFileSync(OUT, json, 'utf8');

const premiumLines = NODE_BODY.split('\n').length;
const legacyLines = baseNodes.find((n) => n.name === RESPONSE_NODE).parameters.jsCode.split('\n').length;

console.log('');
console.log('Premium RU Concierge candidate — OWNER-GATED, ADDITIVE');
console.log('  source (live)      : ' + live.name + '  (' + baseNodes.length + ' nodes)');
console.log('  display caches     : ' + cachesStripped + ' stripped');
console.log('  out                : n8n/candidate/premium-concierge-candidate.json');
console.log('');
console.log('  nodes ADDED (3)    : ' + ADDED.join(', '));
console.log('  nodes MODIFIED     : NONE — every one of the ' + baseNodes.length + ' live nodes is byte-identical');
console.log('  nodes REMOVED      : NONE');
console.log('  edges rewired (4)  : ' + [ANCHOR_IN, OWNER_GATE, PREMIUM_SESSION, PREMIUM_RESPONSE].join(', '));
console.log('');
console.log('  owner path         : ' + [ANCHOR_IN, OWNER_GATE, PREMIUM_SESSION, PREMIUM_RESPONSE, ANCHOR_OUT].join(' -> '));
console.log('  everyone else      : ' + [ANCHOR_IN, OWNER_GATE, LEGACY_SESSION, RESPONSE_NODE, ANCHOR_OUT].join(' -> '));
console.log('  owner identity     : read from Settings owner_chat_id; no literal id in this artifact');
console.log('');
console.log('  premium response   : ' + premiumLines + ' lines, generated from the gated modules');
console.log('  legacy response    : ' + legacyLines + ' lines, UNTOUCHED');
console.log('  /start reset       : removed on the PREMIUM path only; the legacy node keeps it');
console.log('  spine              : UNTOUCHED (issuance gate, receipts, authority verdicts, transport, handoff)');
console.log('  states             : ' + SM.STATES.length + '   rotate branches: ' + rotates + ' (both confirmed)');
console.log('  web_app buttons    : 1  (Открыть бриф, URL = ' + MINIAPP_URL_PLACEHOLDER + ')');
console.log('  P9-R2 flag pair    : ABSENT across all ' + candidate.nodes.length + ' nodes');
console.log('');
console.log('  structural sha256  : ' + structural(baseNodes, live.connections) + '   (before)');
console.log('                       ' + structural(candidate.nodes, candidate.connections) + '   (after)');
console.log('    These DIFFER, and must: three nodes were added and four edges rewired. A candidate');
console.log('    that added a branch and reported an unchanged structural hash would be lying.');
console.log('  candidate sha256   : ' + crypto.createHash('sha256').update(json).digest('hex'));
console.log('');
