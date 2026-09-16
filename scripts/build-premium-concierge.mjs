#!/usr/bin/env node
// FINMENTOR — Premium bilingual Concierge candidate (the CUSTOMER conversation).
//
//   node scripts/build-premium-concierge.mjs --live <live-export.json>
//
// REPO-ONLY. Emits n8n/candidate/premium-concierge-candidate.json and never contacts n8n.
// It is a CANDIDATE, not a deployment.
//
// IT SPLICES FOUR NODE BODIES. It adds no node, removes none, and moves no edge.
//
// The live Concierge is 51 nodes and serves real customers. Almost all of those nodes are the
// SPINE: session read, the issuance gate, receipt preallocation and readback, the authority re-read
// and verdict, the stale- and unresolved-authority branches, the transport worker, the internal
// handoff to Lead Intake. Every P8/P9 hardening decision lives there and every one is closed at GO.
//
// P1-01 — WHY THIS IS NO LONGER AN OWNER-GATED BRANCH. Until this build the premium conversation
// was three ADDED nodes behind a `Premium Owner Gate`, so that owner-only UAT could run on the live
// bot without putting an unproven flow in front of customers. That shape has to go for the release,
// for two independent reasons:
//
//   * it made the BILINGUAL path the OWNER path. The whole Romanian presentation and the locale
//     authority sat on the branch only the owner could enter, so a Romanian customer following the
//     Romanian site's own call to action met a Russian-only state machine;
//   * it could not have carried customers even with the gate opened, because thirteen downstream
//     nodes read `$('Build Bot Response')` and thirteen read `$('Get Bot Session')` by NAME.
//
// So the conversation is spliced INTO the two nodes those readers already name. See "the customer
// conversation" below for the full argument, including why this hands a customer no owner
// authority: this workflow contains no owner control, and the invariants assert it rather than
// assume it.
//
// THE NODE BODY IS GENERATED FROM THE GATED MODULES. `n8n/src/premium-ux/tg-state-machine.js` and
// the TG_COPY block of `branches.js` are inlined verbatim at build time rather than retyped here.
// qa/premium-ux-state.test.mjs and qa/premium-ux-content.test.mjs drive those modules, so the
// deployed node and the tested logic cannot drift apart — there is only one copy of the decision.
//
// THE CYCLE BOUNDARY. `Get Bot Session` deliberately does:
//
//     const isStart = text === '/start';
//     if (isStart) reset = 'start';
//
// so `/start` cannot inherit stale UI authority. The session gate archives the current lead
// reference, clears current-cycle consent/draft fields, preserves durable identity/history, and
// mints the fresh cycle and submission key before `decide()` renders TG_ENTRY. Confirmed in-flow
// new/discard actions remain the only two rotations owned by the response state machine.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIntakeTransportCode,
  buildRecoveryRequestCode
} from './lib/customer-terminal-presentation.mjs';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');

export const RESPONSE_NODE = 'Build Bot Response';

// Injected at deploy time. The Mini App URL is NOT baked into a tracked artifact.
export const MINIAPP_URL_PLACEHOLDER = '__PREMIUM_MINIAPP_URL__';

const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const L = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'locale.js'));
const SM_PATH = join(ROOT, 'n8n', 'src', 'premium-ux', 'tg-state-machine.js');
const CX_PATH = join(ROOT, 'n8n', 'src', 'premium-ux', 'context-extraction.js');
const SM = require(SM_PATH);

const args = process.argv.slice(2);
const livePath = args[args.indexOf('--live') + 1];
if (!livePath || livePath.startsWith('--')) {
  console.error('usage: node scripts/build-premium-concierge.mjs --live <live-export.json>');
  process.exit(1);
}
const live = JSON.parse(readFileSync(livePath, 'utf8').replace(/^\uFEFF/, ''));

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

// P1-01 — the locale authority, taken from locale.js rather than restated here.
//
// The node used to carry its own two-line `isRo()`. It agreed with locale.js by inspection only,
// and it consulted no journey origin at all, so the module the QA gate drives and the code the
// customer actually met were two different decisions. They are now one: these four functions are
// LIFTED VERBATIM from n8n/src/premium-ux/locale.js at build time, and the gate below refuses to
// emit a node in which any of them is missing or has been re-typed.
const LOCALE_PATH = join(ROOT, 'n8n', 'src', 'premium-ux', 'locale.js');
export const LOCALE_FUNCTIONS = ['normalize', 'resolveLocale', 'startPayloadLocale', 'resolveCustomerLocale'];

export function takeFunctions(source, names) {
  const out = [];
  const re0 = /^const START_PAYLOAD_RE = .*$/m.exec(source);
  if (!re0) { throw new Error('locale.js no longer declares START_PAYLOAD_RE'); }
  out.push(re0[0]);
  for (const name of names) {
    const re = new RegExp('^function ' + name + '\\([\\s\\S]*?\\n\\}', 'm');
    const m = re.exec(source);
    if (!m) { throw new Error('locale.js no longer exports a liftable `' + name + '`'); }
    out.push(m[0]);
  }
  return out.join('\n\n');
}

const localeSource = takeFunctions(readFileSync(LOCALE_PATH, 'utf8'), LOCALE_FUNCTIONS)
  .replace(/\bDEFAULT_LOCALE\b/g, '"ru"');

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
  // ── SPRINT 1 — Romanian presentation ────────────────────────────────────────────────────────
  //
  // The Concierge is now fully bilingual, and it is bilingual the same way the Mini App is: one
  // state machine, one set of Russian machine values, and a display table consulted at the render
  // boundary. `TR()` is called from renderCopy() and from the button `text` — never from a state
  // transition, a callback_data lookup, a lead payload or a comparison — so the conversation is
  // Romanian while everything the CRM stores is byte-identical to the Russian path.
  //
  // The table is emitted from n8n/src/premium-ux/ro-labels.js via locale.js, which refuses to
  // produce it while any customer-visible string is untranslated. A Code node cannot require(),
  // so it is inlined; it is data, and the build is the only thing that writes it.
  'const RO_LABELS = ' + JSON.stringify(L.roTable(B), null, 2) + ';',
  '',
  '// ── the locale authority ─────────────────────────────────────────────────────────────────',
  '//',
  '// LIFTED VERBATIM from n8n/src/premium-ux/locale.js by scripts/build-premium-concierge.mjs.',
  '// A Code node cannot require(), and a re-typed copy is how the shipping path and the tested',
  '// module drifted apart in the first place: the module resolved a journey origin that nothing',
  '// ever supplied, and the node consulted Telegram\'s UI language alone.',
  '//',
  '// The order is journey origin -> persisted session -> Telegram language_code -> ru, and a',
  '// language TAG match rather than equality, so `ro-MD` is Romanian and `roman` is not.',
  localeSource,
  '',
  'function TR(s) {',
  '  if (typeof s !== "string" || !RO_ACTIVE) { return s; }',
  '  const t = RO_LABELS[s];',
  '  return t === undefined ? s : t;',
  '}',
  '',
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
  'function readC1Note(value) {',
  '  try {',
  '    const n = JSON.parse(String(value || "{}"));',
  '    return n && n.v === 1 && n.kind === "premium_context" ? n : { v: 1, kind: "premium_context" };',
  '  } catch (e) { return { v: 1, kind: "premium_context" }; }',
  '}',
  '',
  '// Which callback each approved action label carries. Built from ACTIONS so a label can never be',
  '// wired to an action that does not exist.',
  'const LABEL_ACTION = {',
  '  "Описать задачу": ACTIONS.DESCRIBE,',
  '  "Финансовая диагностика": ACTIONS.DIAGNOSIS,',
  '  "Подготовить бриф": ACTIONS.BRIEF,',
  '  "Запросить встречу": ACTIONS.MEETING,',
  '  "Подтвердить запрос": ACTIONS.MEETING_CONFIRM,',
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
  '// The two open actions target the SAME approved Mini App; diagnosis reuses the existing X-Ray',
  '// journey and does not create a second engine or endpoint. Everything else is a callback.',
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
  'const LANGUAGE_CALLBACK = { "Română": "p|lang_ro", "Русский": "p|lang_ru" };',
  '',
  'function buildMarkup(labels, sessionId, state) {',
  '  const perState = LABEL_ACTION_BY_STATE[String(state || "")] || {};',
  '  const rows = [];',
  // SPRINT 1 — the button LABEL is localised, the callback_data is not. `label` stays the Russian
  // key on both lookups (LABEL_ACTION and the web_app test), so the callback contract and the
  // routing that reads it are byte-identical in Romanian. Only `text` changes.
  '  for (const label of labels || []) {',
  '    if (LANGUAGE_CALLBACK[label]) { rows.push([{ text: label, callback_data: LANGUAGE_CALLBACK[label] }]); continue; }',
  '    if (label === "Открыть бриф" || label === "Открыть диагностику") {',
  '      rows.push([{ text: TR(label), web_app: { url: MINIAPP_URL } }]);',
  '      continue;',
  '    }',
  '    const action = perState[label] || LABEL_ACTION[label];',
  '    if (!action) { continue; }',
  '    rows.push([{ text: TR(label), callback_data: action }]);',
  '  }',
  '  return rows.length ? { inline_keyboard: rows } : { inline_keyboard: [] };',
  '}',
  '',
  '// TG_CONFIRM_CONTEXT is the one screen assembled from data rather than fixed lines. A field with',
  '// no content renders NO label — never «Компания: —» (owner decision C).',
  'function renderCopy(copy, auth) {',
  '  if (!copy) { return { text: "", actions: [] }; }',
  '  if (copy.header) {',
  '    const lines = [TR(copy.header), ""];',
  '    for (const s of confirmContextSections(auth.context_extracted)) {',
  // The LABEL is ours and is localised. The VALUE is the customer's own words, read back to them:
  // it is never translated and never looked up — a customer must see what they actually wrote, and
  // running client text through a label table would be both wrong and a way to smuggle a lookup hit
  // into user input. It stays escaped, which is the whole defence on an HTML screen.
  '      lines.push(TR(s.label));',
  '      const machineValue = ["role", "turnover_band", "objective"].indexOf(String(s.key || "")) !== -1;',
  '      lines.push("<b>" + escapeHtml(machineValue ? TR(s.value) : s.value) + "</b>");',
  '      lines.push("");',
  '    }',
  '    lines.push(TR(copy.closing));',
  '    return { text: lines.join("\\n"), actions: copy.actions || [] };',
  '  }',
  '  return { text: (copy.text || []).map(TR).join("\\n\\n"), actions: copy.actions || [] };',
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
  'const telegramFirstName = p.first_name || src.first_name || "";',
  'const telegramLastName = p.last_name || src.last_name || "";',
  'const telegramUsername = p.username || src.username || "";',
  'if (String(telegramFirstName).trim()) { session.first_name = safeText(telegramFirstName, 100); }',
  'if (String(telegramLastName).trim()) { session.last_name = safeText(telegramLastName, 100); }',
  'if (String(telegramUsername).trim()) { session.username = safeText(telegramUsername, 100); }',
  'const telegramFullName = [session.first_name, session.last_name].map(v => String(v || "").trim()).filter(Boolean).join(" ");',
  'if (!String(session.contact_name || "").trim() && telegramFullName) { session.contact_name = telegramFullName; }',
  'const c1Note = readC1Note(session.notes);',
  '',
  // ── the locale for THIS reply, decided once, by the module ──────────────────────────────────
  //
  // 1. the JOURNEY ORIGIN, carried by the Telegram deep-link start parameter the /ro/ and RU pages
  //    publish (`?start=ro` arrives here as the message text `/start ro`);
  // 2. the PERSISTED session locale, which is what the journey origin became on the turn it
  //    arrived — a returning customer keeps the language they started in;
  // 3. Telegram's `language_code`, a hint, reached only by a customer with neither of the above;
  // 4. `ru`.
  //
  // A Romanian who reads Telegram in Russian therefore stays Romanian, which is the defect this
  // closes. No model call and no language detection participates: the origin is a page, not a guess.
  'const languageChoiceRequired = session.__language_choice_required === true;',
  'const LOCALE = resolveCustomerLocale({',
  '  messageText: text,',
  '  journeyLocale: session.__journey_locale,',
  '  sessionLocale: session.language,',
  '  telegramLanguageCode: p.language',
  '});',
  'const RO_ACTIVE = LOCALE === "ro";',
  '',
  // PERSISTED, so the deep link only has to happen once. `language` is an EXISTING Bot_Sessions
  // column that Build Session Row already writes — no column is added, and F16 (a stray property
  // permanently widening the sheet) cannot repeat here.
  'session.language = languageChoiceRequired ? "" : LOCALE;',
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
  '    try {',
  '      const direct = JSON.parse(session.context_extracted_json || "{}");',
  '      return Object.keys(direct).length ? direct : (c1Note.extracted || {});',
  '    } catch (e) { return c1Note.extracted || {}; }',
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
  'if (languageChoiceRequired) {',
  '  outcome.state = "TG_ENTRY";',
  '  outcome.copy = { text: ["Alegeți limba / Выберите язык"], actions: ["Română", "Русский"] };',
  '  outcome.rotate = false; outcome.writes = [];',
  '} else if (data === "p|lang_ro" || data === "p|lang_ru") {',
  '  // The selector callback is presentation control, not a state-machine action. Persisting the',
  '  // choice happened in Get Bot Session; now render the ordinary entry in the chosen language.',
  '  outcome.state = "TG_ENTRY"; outcome.copy = B.TG_COPY.TG_ENTRY;',
  '  outcome.rotate = false; outcome.writes = [];',
  '}',
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
  'if (writes.indexOf("free_text") !== -1) {',
  '  session.free_text_request = safeText(outcome.free_text, 500);',
  '  c1Note.original_text = session.free_text_request;',
  '  c1Note.context_confirmed = false;',
  '}',
  'if (writes.indexOf("confirm_context") !== -1) { session.context_confirmed = "true"; c1Note.context_confirmed = true; }',
  'if (writes.indexOf("activity_append") !== -1) { session.append_text = safeText(outcome.append_text, 500); }',
  'if (writes.indexOf("meeting_request") !== -1) {',
  '  session.selected_service = "Запрос на встречу";',
  '  c1Note.meeting_requested_at = new Date().toISOString();',
  '}',
  'if (writes.indexOf("consent_yes") !== -1) { session.consent = "yes"; }',
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
  '    // Request free text has no identity authority. Company/name/role/contact can enter only',
  '    // through a separately approved carried identity source, never through this proposal.',
  '    business_activity: proposal.fields.business_activity || "",',
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
  '  c1Note.extracted = auth.context_extracted;',
  '  c1Note.context_confirmed = false;',
  '}',
  '',
  '// «Исправить» must not leave the rejected guess in place — a later screen would prefill from a',
  '// value the client has just told us is wrong.',
  'if (input.kind === "callback" && input.value === ACTIONS.CONFIRM_FIX) {',
  '  session.context_extracted_json = "";',
  '  session.context_confirmed = "false";',
  '  c1Note.extracted = {};',
  '  c1Note.context_confirmed = false;',
  '}',
  'session.notes = JSON.stringify(c1Note).slice(0, 4000);',
  '',
  '// The confirmation screen has to EARN its place. It is worth asking only when extraction found',
  '// request structure — an objective, activity or explicitly stated turnover band.',
  '// It is not worth asking when the only thing on screen is the client\'s own sentence read back',
  '// to them: that is a step with no decision in it, and it makes the product look like it',
  '// understood something when it did not.',
  '//',
  '// So the screen renders only when at least one STRUCTURED field survived. `problem_summary` is',
  '// the client\'s own words and never counts towards that on its own.',
  'const structuralKeys = ["business_activity", "turnover_band", "objective"];',
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
  '// Only the explicit meeting action uses the existing authenticated Lead Intake handoff.',
  '// Every brief/diagnosis submission still goes exclusively through POST /miniapp/submit.',
  'const meetingRequested = writes.indexOf("meeting_request") !== -1;',
  'const confirmed = c1Note.context_confirmed === true ? (c1Note.extracted || {}) : {};',
  'const originalText = String(c1Note.original_text || session.free_text_request || "").slice(0, 500);',
  'const telegramIdentity = String(session.username || p.username || "").trim()',
  '  ? "@" + String(session.username || p.username).replace(/^@/, "").trim()',
  '  : String(session.user_id || p.user_id || chat_id);',
  'const meetingLeadPayload = meetingRequested ? {',
  '  tool: "telegram_client_concierge",',
  '  client: {',
  '    name: String(session.contact_name || telegramFullName || ""),',
  '    company: String(confirmed.company_name || session.company || ""),',
  '    role: String(confirmed.role || ""),',
  '    telegram: telegramIdentity,',
  '    language: LOCALE',
  '  },',
  '  answers: { business_model: String(confirmed.business_activity || ""), main_pain: originalText || "Запрос на встречу" },',
  '  main_pain: { problem: originalText || "Запрос на встречу", desired_first_step: "Согласовать встречу" },',
  '  intake: {',
  '    goals: { expected_meeting_outcomes: ["Согласовать встречу"] },',
  '    business_pain: { preferred_meeting_format: "Согласовать с клиентом" },',
  '    commercial_intent: { work_interest: ["консультация"] }',
  '  },',
  '  automation: { recommended_next_step: "Согласовать встречу" },',
  '  premium: { important_context: originalText },',
  '  meta: {',
  '    consent: String(session.consent || "").toLowerCase() === "yes",',
  '    request_type: "meeting_request",',
  '    preferred_contact_channel: "telegram",',
  '    telegram_username: String(session.username || p.username || ""),',
  '    telegram_user_id: String(session.user_id || p.user_id || ""),',
  '    original_telegram_text: originalText,',
  '    context_provenance: c1Note.context_confirmed === true ? "client_confirmed" : (originalText ? "original_client_fact" : "")',
  '  }',
  '} : null;',
  'return [{',
  '  json: {',
  '    chat_id: chat_id,',
  '    reply_text: reply_text,',
  '    reply_markup: reply_markup,',
  '    tg_body: { chat_id: chat_id, text: reply_text, reply_markup: reply_markup, parse_mode: parse_mode },',
  '    session: session,',
  '    lead_ready: meetingRequested,',
  '    lead_payload: meetingLeadPayload,',
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

// ------------------------------------------------------------------ the customer conversation
//
// P1-01. THE PREMIUM CONVERSATION IS THE CUSTOMER CONVERSATION. It is spliced INTO the two live
// nodes, and it is no longer gated on owner identity.
//
// WHAT THIS REPLACES AND WHY. The previous shape added three nodes behind a `Premium Owner Gate`
// that compared the Telegram chat id to Settings `owner_chat_id`:
//
//   Find Session -> Premium Owner Gate --[owner]--> Get Bot Session (Premium)
//                          |                          -> Build Bot Response (Premium) --+
//                          --[everyone else]--> Get Bot Session -> Build Bot Response ---+
//
// That was right for owner-only UAT and wrong for the release. Two things were wrong with it:
//
//   1. THE BILINGUAL PATH WAS THE OWNER PATH. Every Romanian string, and the whole locale
//      authority, lived on the branch only the owner could enter. A Romanian customer following
//      the Romanian site's own call to action reached the legacy node, which holds 67 Russian
//      sendable strings and no Romanian at all. The audit finding — "the isolated locale resolver
//      is correct but the shipping customer path does not use it end to end" — is exactly this.
//
//   2. THE PARALLEL BRANCH COULD NEVER HAVE CARRIED CUSTOMERS ANYWAY. Thirteen downstream nodes
//      read `$('Build Bot Response')` and thirteen read `$('Get Bot Session')` BY NAME — Build
//      Session Row, Build Bot Event, Build Internal Handoff, the issuance and authority verdicts,
//      the transport builders. A customer routed down the parallel branch would reach a node whose
//      `$('Build Bot Response')` never executed. Opening the gate would not have shipped the
//      premium conversation; it would have broken the spine.
//
// So the branch is removed and the logic is spliced into the nodes those thirteen readers already
// name. Node count is unchanged, the connection graph is UNTOUCHED, and every downstream reference
// resolves exactly as it does today.
//
// WHAT THIS DOES NOT DO — THE OWNER BOUNDARY. It grants a customer NOTHING that belongs to the
// owner. This workflow contains no owner control: `Hot Path Config` deliberately stops emitting
// `owner_chat_id` (it is one of its four dead keys), and no node in the Concierge reads an owner
// identity to decide what a person may do. Owner authority — the lead lifecycle commands, the CRM
// stage and terminal writes, the internal lead actions, the alert keyboards — lives in the Lead
// Command Center and Lead Alerts workflows, each behind its own owner gate, and none of them is
// touched here. The invariants below ASSERT that separation rather than assuming it: the spliced
// nodes may emit only the approved CUSTOMER callback vocabulary, and may not read an owner
// identity at all.
//
// WHY THE /start RESET IS REQUIRED. `Get Bot Session` is the current-cycle authority:
//
//     const isStart = text === '/start';
//     if (isStart) reset = 'start';
//
// so `/start` archives only the current lead reference into the session history, clears the
// current-cycle consent/draft fields, preserves identity/contact and all durable CRM facts, and
// mints a clean cycle/submission key. This is what makes stale UI state unable to poison entry.

const CUSTOMER_SESSION = 'Get Bot Session';
const CUSTOMER_RESPONSE = RESPONSE_NODE;
const CUSTOMER_TERMINAL = 'Build Intake Transport Request';
const CUSTOMER_RECOVERY = 'Build Recovery Request';
const ANCHOR_IN = 'Find Session';
const ANCHOR_OUT = 'Build Transport Request';
const RETIRED_NODES = ['Premium Owner Gate', 'Get Bot Session (Premium)', 'Build Bot Response (Premium)'];

for (const n of [ANCHOR_IN, CUSTOMER_SESSION, CUSTOMER_RESPONSE, CUSTOMER_TERMINAL, CUSTOMER_RECOVERY, ANCHOR_OUT]) {
  if (!candidate.nodes.find((x) => x.name === n)) { fail.push('missing anchor node: ' + n); }
}

// The customer session node: the live code with /start reset explicit and the journey origin added.
const legacySession = baseNodes.find((n) => n.name === CUSTOMER_SESSION);
const START_DETECT_LINE = "const isStart = text === '/start';";
const PREMIUM_START_DETECT = "const isStart = /^\\/start(?:@[A-Za-z0-9_]+)?(?:\\s+\\S+)?\\s*$/.test(text);";
const RESET_LINE = "if (isStart) reset = 'start';";
const RETURN_ANCHOR = 'return [{ json: s }];';

// Keep the head of the live if/else chain explicit. The braces make the mutation anchor stable
// without changing the cycle semantics.
const PREMIUM_RESET_REPLACEMENT = [
  '// [V1 launch blocker] /start always starts a clean current cycle; archiveLead preserves history.',
  "if (isStart) { reset = 'start'; }"
].join('\n');

// P1-01 — the journey origin, captured on the turn it arrives.
//
// `?start=ro` on the Romanian pages and `?start=ru` on the Russian ones reach Telegram as the
// message text `/start ro`. The cycle gate is where that text is already in hand and where the
// session row is already being assembled, so the origin is recorded here and the response node
// reads it back off the session like any other persisted field.
//
// It is a CLOSED vocabulary — the two supported tags and nothing else — and it is lifted from
// n8n/src/premium-ux/locale.js exactly as the response node's copy is, so there is one statement
// of what a start payload may mean.
//
// It writes to `language`, an EXISTING Bot_Sessions column that Build Session Row already
// persists. No column is added: F16 proved a stray property permanently widens the sheet.
const JOURNEY_ORIGIN_SPLICE = [
  '',
  '// ============ P1-01 — JOURNEY-ORIGIN LOCALE (deep-link start parameter) ============',
  '//',
  '// GENERATED from n8n/src/premium-ux/locale.js. The Romanian pages publish the bot deep link',
  '// with `?start=ro` and the Russian pages with `?start=ru`; Telegram delivers that as the message',
  '// text `/start ro`. A customer who entered from the Romanian journey therefore stays',
  '// Romanian on every later turn, whatever language Telegram\'s own interface is set to.',
  '//',
  '// Only the two supported tags are recognised. Any other payload is ignored and the turn resolves',
  '// exactly as a bare `/start` does — persisted session locale, then Telegram\'s hint, then ru.',
  '//',
  '// The resolution runs on EVERY turn, not only on a start: it also normalises a cold session that',
  '// Find Session seeded with a raw Telegram tag such as `ro-MD` or `en`, so every later turn reads',
  '// an authoritative `ru` or `ro` rather than re-deriving one.',
  localeSource,
  '',
  'const storedLocale = Number(s.row_number || 0) > 0 ? normalize(s.language) : "";',
  'const journeyLocale = startPayloadLocale(String(p.message_text || ""));',
  'const selectedLocale = String(p.callback_data || "") === "p|lang_ro" ? "ro" : (String(p.callback_data || "") === "p|lang_ru" ? "ru" : "");',
  'const resolvedLocale = resolveCustomerLocale({ messageText: String(p.message_text || ""), journeyLocale: selectedLocale || journeyLocale, sessionLocale: storedLocale, telegramLanguageCode: p.language });',
  'const explicitLocale = selectedLocale || journeyLocale || storedLocale;',
  '// A cold Telegram language_code is only a first-contact hint. It chooses the language of the',
  '// one-time selector, but is not persisted as the customer preference until a button is tapped.',
  's.language = explicitLocale ? resolvedLocale : "";',
  's.__journey_locale = resolvedLocale;',
  's.__language_choice_required = !explicitLocale;',
  '// ============ end P1-01 ============',
  ''
].join('\n');

let premiumSessionCode = '';
if (legacySession) {
  const orig = legacySession.parameters.jsCode;
  if (orig.indexOf(START_DETECT_LINE) === -1) {
    fail.push(CUSTOMER_SESSION + ': the /start detector was not found -- do not splice blindly');
  } else if (orig.indexOf(RESET_LINE) === -1) {
    fail.push(CUSTOMER_SESSION + ': the /start reset line was not found -- do not splice blindly');
  } else if (orig.indexOf(RETURN_ANCHOR) === -1) {
    fail.push(CUSTOMER_SESSION + ': the return anchor was not found -- do not splice blindly');
  } else if (orig.split(RETURN_ANCHOR).length !== 2) {
    fail.push(CUSTOMER_SESSION + ': the return anchor is not unique -- do not splice blindly');
  } else {
    premiumSessionCode = [
      '// Get Bot Session — the live cycle-semantics gate with explicit /start reset and the',
      '// journey-origin locale added.',
      '//',
      '// GENERATED by scripts/build-premium-concierge.mjs from the live Get Bot Session node.',
      '// DO NOT EDIT IN THE n8n UI: the next build overwrites it, and an edit here would not be',
      '// covered by qa/ro-first-contact.test.mjs.',
      '//',
      '// PRESERVED:  the /start reset; EXTENDED: Telegram deep-link payload variants.',
      '// ADDED:    the journey-origin locale capture (P1-01), lifted from',
      '//           n8n/src/premium-ux/locale.js.',
      '//',
      '// /start archives the current lead reference, clears current-cycle state and mints a new',
      '// cycle/submission key while durable historical lead/client facts remain intact.',
      '//',
      '// isRestart and hasNoCycle are UNCHANGED: a session with no cycle still bootstraps one, and',
      '// the legacy m|diag restart stays as it is.',
      ''
    ].join('\n')
      + orig.replace(START_DETECT_LINE, PREMIUM_START_DETECT)
            .replace(RESET_LINE, PREMIUM_RESET_REPLACEMENT)
            .replace(RETURN_ANCHOR, JOURNEY_ORIGIN_SPLICE + RETURN_ANCHOR);
  }
}

// ------------------------------------------------------------------ splice
//
// FOUR NODE BODIES CHANGE. Nothing else in the workflow does: no node is added, no node is removed,
// no edge moves, and no other node's parameters differ by a byte from the live export.
if (!fail.length) {
  const sessionNode = candidate.nodes.find((n) => n.name === CUSTOMER_SESSION);
  const responseNode = candidate.nodes.find((n) => n.name === CUSTOMER_RESPONSE);
  const terminalNode = candidate.nodes.find((n) => n.name === CUSTOMER_TERMINAL);
  const recoveryNode = candidate.nodes.find((n) => n.name === CUSTOMER_RECOVERY);
  sessionNode.parameters = Object.assign({}, sessionNode.parameters, { jsCode: premiumSessionCode });
  responseNode.parameters = Object.assign({}, responseNode.parameters, { jsCode: NODE_BODY });
  terminalNode.parameters = Object.assign({}, terminalNode.parameters, { jsCode: buildIntakeTransportCode() });
  recoveryNode.parameters = Object.assign({}, recoveryNode.parameters, { jsCode: buildRecoveryRequestCode() });
  candidate.name = '[CANDIDATE] FINMENTOR Telegram Client Concierge PREMIUM UX (customer, bilingual)';
}

// ------------------------------------------------------------------ invariants

// EXACTLY FOUR NODE BODIES CHANGE, AND NOTHING ELSE DOES. That is the strongest statement available
// about a workflow that serves real customers: every other node is not 'equivalent', it is the
// same object.
const SPLICED = [CUSTOMER_SESSION, CUSTOMER_RESPONSE, CUSTOMER_TERMINAL, CUSTOMER_RECOVERY];

if (candidate.nodes.length !== baseNodes.length) {
  fail.push('node count moved: ' + baseNodes.length + ' -> ' + candidate.nodes.length + ' (expected no change)');
}

// The retired owner branch must be gone. If a later live export is taken from a tenant that still
// carries those three nodes, they must not be silently re-emitted as part of the customer graph.
for (const n of RETIRED_NODES) {
  if (candidate.nodes.find((x) => x.name === n)) {
    fail.push('the retired owner-gated branch is still present: ' + n);
  }
}

const drift = [];
for (const n of candidate.nodes) {
  const was = baseNodes.find((x) => x.name === n.name);
  if (!was) { drift.push(n.name + ' (new)'); continue; }
  if (SPLICED.indexOf(n.name) !== -1) {
    // The spliced nodes may differ in `parameters.jsCode` and in NOTHING else — not credentials,
    // not typeVersion, not retry policy, not position.
    const a = JSON.parse(JSON.stringify(n));
    const b = JSON.parse(JSON.stringify(was));
    a.parameters.jsCode = '';
    b.parameters.jsCode = '';
    if (JSON.stringify(a) !== JSON.stringify(b)) { drift.push(n.name + ' (beyond jsCode)'); }
    continue;
  }
  if (JSON.stringify(n) !== JSON.stringify(was)) { drift.push(n.name); }
}
if (drift.length) { fail.push('UNRELATED DRIFT in ' + drift.length + ' node(s): ' + drift.slice(0, 8).join(', ')); }

// All four spliced nodes must ACTUALLY have changed. A splice that silently no-opped would emit a
// candidate identical to the live workflow and every gate below would still pass.
for (const name of SPLICED) {
  const now = candidate.nodes.find((x) => x.name === name);
  const was = baseNodes.find((x) => x.name === name);
  if (now && was && now.parameters.jsCode === was.parameters.jsCode) {
    fail.push(name + ': the splice did not change the node body');
  }
}

// No live node was removed.
for (const n of baseNodes) {
  if (!candidate.nodes.find((x) => x.name === n.name)) { fail.push('node removed: ' + n.name); }
}

// THE CONNECTION GRAPH IS UNTOUCHED. Not "differs in the expected keys" — identical. That is what
// makes the thirteen downstream `$('Build Bot Response')` and thirteen `$('Get Bot Session')`
// references safe: they name nodes that still exist, still run, and still sit where they sat.
const edgeDiff = [];
for (const k of new Set(Object.keys(live.connections).concat(Object.keys(candidate.connections)))) {
  if (JSON.stringify(live.connections[k]) !== JSON.stringify(candidate.connections[k])) { edgeDiff.push(k); }
}
if (edgeDiff.length) {
  fail.push('the connection graph was rewired: ' + edgeDiff.sort().join(', ') + ' (expected none)');
}

// Every downstream reader must still name a node that exists in the candidate. This is the check
// the retired parallel branch could never have passed.
{
  const names = new Set(candidate.nodes.map((n) => n.name));
  const referenced = new Set();
  for (const n of candidate.nodes) {
    const j = JSON.stringify(n.parameters || {});
    for (const m of j.matchAll(/\$\(\\?['"]([^'"\\]+)\\?['"]\)/g)) { referenced.add(m[1]); }
  }
  for (const r of referenced) {
    if (!names.has(r)) { fail.push('a node references $("' + r + '"), which the candidate does not contain'); }
  }
  for (const must of [CUSTOMER_SESSION, CUSTOMER_RESPONSE]) {
    if (!referenced.has(must)) { fail.push('nothing references $("' + must + '") any more — the splice went to the wrong node'); }
  }
}

// ------------------------------------------------------------------ the owner boundary
//
// P1-01. The customer conversation becoming reachable by customers must not hand a customer one
// byte of owner authority. Asserted, not assumed.
{
  // 1. NO OWNER IDENTITY DECIDES ANYTHING ON THE CUSTOMER PATH. Neither spliced node may read an
  //    owner id, and neither may compare a chat id to one. `Settings to Object` still carries the
  //    key for the workflows that legitimately need it; nothing on this path consults it.
  for (const name of SPLICED) {
    const n = candidate.nodes.find((x) => x.name === name);
    const js = (n && n.parameters && n.parameters.jsCode) || '';
    const codeOnly = js.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    if (/owner_chat_id|owner_id|is_owner|isOwner/.test(codeOnly)) {
      fail.push(name + ': the customer path reads an owner identity');
    }
    if (/\b\d{7,}\b/.test(codeOnly)) {
      fail.push(name + ': a literal Telegram id is embedded in the customer path');
    }
  }

  // 2. THE CUSTOMER MAY EMIT ONLY THE CUSTOMER VOCABULARY. Every callback_data the conversation can
  //    put in front of a customer is one of the approved conversation ACTIONS. An owner command —
  //    a CRM stage write, a terminal close, a lead action, an alert acknowledgement — cannot be
  //    rendered, so it cannot be tapped.
  const approved = Object.keys(SM.ACTIONS).map((k) => SM.ACTIONS[k]).sort();
  const emitted = [];
  for (const m of NODE_BODY.matchAll(/ACTIONS\.([A-Z_]+)/g)) {
    const v = SM.ACTIONS[m[1]];
    if (v === undefined) { fail.push('the node emits ACTIONS.' + m[1] + ', which the machine does not define'); }
    else if (emitted.indexOf(v) === -1) { emitted.push(v); }
  }
  for (const v of emitted) {
    if (approved.indexOf(v) === -1) { fail.push('the node emits a callback outside the approved customer vocabulary: ' + v); }
  }
  // The owner surfaces use their own prefixes. None of them may appear in a customer reply.
  for (const owner of ['lead|', 'stage|', 'crm|', 'ack|', 'close|', 'won|', 'lost|', 'nurture|', 'admin|', 'owner|']) {
    if (NODE_BODY.indexOf('"' + owner) !== -1 || NODE_BODY.indexOf("'" + owner) !== -1) {
      fail.push('an owner callback prefix reached the customer node: ' + owner);
    }
  }

  // 3. NO OWNER-ONLY WORKFLOW IS CALLED FROM THE CUSTOMER PATH. The Concierge's only
  //    executeWorkflow calls are the transport and the internal Lead Intake handoff, both of which
  //    already existed and neither of which is an owner control. Asserted against the live export
  //    so a new call cannot be introduced here unnoticed.
  const callsNow = candidate.nodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow').map((n) => n.name).sort();
  const callsWas = baseNodes.filter((n) => n.type === 'n8n-nodes-base.executeWorkflow').map((n) => n.name).sort();
  if (callsNow.join(',') !== callsWas.join(',')) {
    fail.push('the set of called workflows changed: ' + callsWas.join(', ') + ' -> ' + callsNow.join(', '));
  }
}

// ------------------------------------------------------------------ the locale authority
//
// P1-01. The shipping path must use the MODULE, not a re-typed copy of it.
{
  const sessionJs = (candidate.nodes.find((n) => n.name === CUSTOMER_SESSION) || { parameters: {} }).parameters.jsCode || '';
  for (const [label, body] of [[CUSTOMER_SESSION, sessionJs], [CUSTOMER_RESPONSE, NODE_BODY]]) {
    for (const fn of LOCALE_FUNCTIONS) {
      if (body.indexOf('function ' + fn + '(') === -1) {
        fail.push(label + ': the lifted locale authority is missing `' + fn + '`');
      }
    }
    if (body.indexOf('resolveCustomerLocale({') === -1) {
      fail.push(label + ': does not resolve the locale through the lifted locale authority');
    }
  }
  // The ad-hoc predicate the node used to carry must not come back.
  if (/function isRo\b/.test(NODE_BODY)) {
    fail.push(CUSTOMER_RESPONSE + ': the retired ad-hoc `isRo` locale test is back');
  }
  // The resolved locale must be PERSISTED, or the deep link would have to be re-followed on every
  // turn — which is the defect in a different shape.
  if (NODE_BODY.indexOf('session.language = languageChoiceRequired ? "" : LOCALE;') === -1) {
    fail.push(CUSTOMER_RESPONSE + ': the resolved locale is not persisted onto the session');
  }
  if (sessionJs.indexOf('const selectedLocale =') === -1 ||
      sessionJs.indexOf('s.language = explicitLocale ? resolvedLocale : "";') === -1) {
    fail.push(CUSTOMER_SESSION + ': the journey origin is not recorded onto the session');
  }
  // `language` must stay an EXISTING column. A new one would silently widen Bot_Sessions (F16).
  const rowBuilder = candidate.nodes.find((n) => n.name === 'Build Session Row');
  if (rowBuilder && (rowBuilder.parameters.jsCode || '').indexOf("'language'") === -1) {
    fail.push('Build Session Row no longer persists `language` — the locale would not survive a turn');
  }
  // No language DETECTION. The origin is a page, never a guess about what a customer wrote.
  const localeCode = NODE_BODY.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const banned of ['detectLanguage', 'franc', 'langdetect', 'cld3', 'guessLanguage']) {
    if (localeCode.indexOf(banned) !== -1) { fail.push('a language detector reached the customer node: ' + banned); }
  }
}

// The customer session node must preserve the explicit reset and add the journey origin.
if (legacySession && premiumSessionCode) {
  if (premiumSessionCode.indexOf('[V1 launch blocker]') === -1) {
    fail.push(CUSTOMER_SESSION + ': the /start cycle-boundary marker is missing');
  }
  const strippedPremium = premiumSessionCode.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  if (!/if \(isStart\) \{ reset = 'start'; \}/.test(strippedPremium)) {
    fail.push(CUSTOMER_SESSION + ': the /start reset is not executable on the customer path');
  }
  // Everything else must survive: the cycle-semantics gate and the submission-key issuance are
  // what make the spine trustworthy, and removing either by accident would be invisible here
  // without this check.
  for (const keep of ['SUBMISSION_KEY_RE', 'hasNoCycle', 'isRestart', 'cycle_reset', '__submission_key_action']) {
    if (premiumSessionCode.indexOf(keep) === -1) { fail.push(CUSTOMER_SESSION + ': lost ' + keep); }
  }
}

// The output contract thirteen downstream nodes read.
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
    'TG_RESUME_DRAFT', 'TG_RESUME_DISCARD_CONFIRM', 'TG_OPEN_DIAGNOSIS', 'TG_MEETING_CONFIRM', 'TG_MEETING_REQUEST',
    'TG_UNKNOWN'];
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
  if (NODE_BODY.indexOf('escapeHtml(machineValue ? TR(s.value) : s.value)') === -1) {
    fail.push('the confirmation screen interpolates client text into HTML without escaping it');
  }
  // Failure must never read as success.
  const failText = (B.TG_COPY.TG_INFRA_FAILURE.text || []).join(' ');
  for (const w of ['Спасибо', 'получили', 'отправлено', 'успешно', 'принято']) {
    if (failText.indexOf(w) !== -1) { fail.push('TG_INFRA_FAILURE contains success wording: ' + w); }
  }
}

// The original nine states plus the four bounded C1 presentation/routing states.
for (const s of SM.STATES) { if (NODE_BODY.indexOf("'" + s + "'") === -1 && NODE_BODY.indexOf('"' + s + '"') === -1) { fail.push('state missing from the node: ' + s); } }
if (SM.STATES.length !== 13) { fail.push('the machine no longer has the thirteen approved states'); }

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
if (/https?:\/\//.test(CODE_ONLY
  .replace(new RegExp(MINIAPP_URL_PLACEHOLDER, 'g'), '')
  .replace(/https:\/\/finmentor\.md\/privacy\.html/g, ''))) {
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
for (const [label, body] of [
  [CUSTOMER_RESPONSE, NODE_BODY],
  [CUSTOMER_SESSION, premiumSessionCode],
  [CUSTOMER_TERMINAL, buildIntakeTransportCode()],
  [CUSTOMER_RECOVERY, buildRecoveryRequestCode()]
]) {
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
console.log('Premium Concierge candidate — CUSTOMER CONVERSATION, BILINGUAL, SPLICED');
console.log('  source (live)      : ' + live.name + '  (' + baseNodes.length + ' nodes)');
console.log('  display caches     : ' + cachesStripped + ' stripped');
console.log('  out                : n8n/candidate/premium-concierge-candidate.json');
console.log('');
console.log('  nodes ADDED        : NONE');
console.log('  nodes REMOVED      : NONE');
console.log('  edges rewired      : NONE — the connection graph is byte-identical to the live export');
console.log('  nodes MODIFIED (4) : ' + SPLICED.join(', ') + '  (parameters.jsCode only)');
console.log('');
console.log('  customer path      : ' + [ANCHOR_IN, CUSTOMER_SESSION, CUSTOMER_RESPONSE, ANCHOR_OUT].join(' -> '));
console.log('  owner gate         : REMOVED from the customer conversation. Owner authority stays');
console.log('                       where it lives — Lead Command Center and Lead Alerts, each with');
console.log('                       its own gate; neither is touched by this candidate.');
console.log('  owner identity     : NOT read on the customer path, and no literal id in this artifact');
console.log('');
console.log('  locale authority   : journey origin (deep-link ?start=) -> session -> Telegram -> ru');
console.log('                       lifted verbatim from n8n/src/premium-ux/locale.js: '
  + LOCALE_FUNCTIONS.join(', '));
console.log('  RO labels          : ' + Object.keys(L.roTable(B)).length + ' customer-visible strings, 0 untranslated');
console.log('');
console.log('  response body      : ' + premiumLines + ' lines, generated from the gated modules');
console.log('                       (replaces ' + legacyLines + ' lines of the live Russian-only builder)');
console.log('  /start reset       : current cycle reset; historical lead/client facts preserved');
console.log('  spine              : UNTOUCHED (issuance gate, receipts, authority verdicts, transport, handoff)');
console.log('  states             : ' + SM.STATES.length + '   rotate branches: ' + rotates + ' (both confirmed)');
console.log('  web_app actions    : 2  (brief + existing diagnosis journey, one URL = ' + MINIAPP_URL_PLACEHOLDER + ')');
console.log('  P9-R2 flag pair    : ABSENT across all ' + candidate.nodes.length + ' nodes');
console.log('');
console.log('  structural sha256  : ' + structural(baseNodes, live.connections) + '   (before)');
console.log('                       ' + structural(candidate.nodes, candidate.connections) + '   (after)');
console.log('    These MATCH, and must: no node was added, removed, retyped or rewired. Only four');
console.log('    node BODIES changed, which a structural hash deliberately does not see.');
console.log('  candidate sha256   : ' + crypto.createHash('sha256').update(json).digest('hex'));
console.log('');
