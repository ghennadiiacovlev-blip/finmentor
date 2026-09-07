#!/usr/bin/env node
// FINMENTOR — the Romanian customer's first contact, proven against the TRACKED CANDIDATE.
//
//   node qa/ro-first-contact.test.mjs
//
// Offline. No tenant, no Telegram, no network, no production writes.
//
// WHAT THIS GATE IS FOR, AND WHY IT WAS REWRITTEN.
//
// Every Romanian page carries a call to action to the public Telegram bot. Until the P1 correction
// pack, a Romanian customer who followed it met a Russian state machine, and the locale was
// decided from Telegram's own interface language — so a Romanian who reads Telegram in Russian was
// answered in Russian on the Romanian journey.
//
// The PREVIOUS version of this gate did not catch that, because it did not test the shipping path.
// It drove `scripts/deploy-ro-first-contact.mjs` — a deployment helper holding a stand-in fragment
// of the two lines it would splice — and proved that fragment behaved. The candidate the release
// actually ships was never executed here. An independent audit found exactly that, and it is the
// reason this file now loads:
//
//     n8n/candidate/premium-concierge-candidate.json
//
// and runs the REAL `Get Bot Session` and `Build Bot Response` bodies out of it. `deploy-ro-first-
// contact.mjs` is superseded by the bilingual conversation and is no longer part of the release
// path; the gate that stands behind the Romanian customer is this one.
//
// THE AUTHORITY UNDER TEST. journey origin -> persisted session locale -> Telegram language_code
// -> ru. The journey origin is the bot's deep-link start parameter, which the Romanian pages
// publish as `?start=ro` and the Russian pages as `?start=ru`; Telegram delivers it as the message
// text `/start ro`. No language detection participates.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const L = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'locale.js'));
const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));

const CANDIDATE = join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json');
const wf = JSON.parse(readFileSync(CANDIDATE, 'utf8'));

const node = (name) => {
  const n = wf.nodes.find((x) => x.name === name);
  if (!n) { throw new Error('the candidate has no node named ' + name); }
  return n.parameters.jsCode;
};

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } };

// ── running the two shipping nodes ───────────────────────────────────────────────────────────
//
// `Get Bot Session` reads `$input.all()` (the Bot_Sessions rows for this chat) and
// `$('Parse Telegram Update')`. `Build Bot Response` reads `$input.first()` and the same parse
// node. Both are given the real Telegram context a customer's update produces.

const SESSION_BODY = node('Get Bot Session');
const RESPONSE_BODY = node('Build Bot Response');
const nodeRequire = require;

// A turn mints a cycle id from the clock and a submission key from 16 random bytes. Both are
// per-turn values by design, so two runs of the same turn differ in them and in nothing else.
// Comparisons that ask "did the LOCALE change this?" normalise them rather than ignoring the
// fields, so a locale that stopped a mint happening at all would still be caught.
function normaliseMinted(session) {
  const s = Object.assign({}, session);
  if (/^C-\d+-\d+$/.test(String(s.cycle_id || ''))) { s.cycle_id = 'C-<chat>-<minted>'; }
  if (/^sub_[0-9a-f]{32}$/.test(String(s.submission_key || ''))) { s.submission_key = 'sub_<minted>'; }
  return s;
}

function parsed(ctx) {
  return {
    chat_id: ctx.chat_id, user_id: ctx.user_id || ctx.chat_id, username: '', first_name: '', last_name: '',
    language: ctx.telegramLanguage === undefined ? '' : ctx.telegramLanguage,
    message_text: ctx.messageText || '',
    callback_data: ctx.callbackData || '',
    callback_query_id: '', is_callback: !!ctx.callbackData
  };
}

// One turn, end to end: the cycle gate, then the reply builder, exactly as the graph runs them.
function turn(ctx) {
  const p = parsed(ctx);
  const rows = ctx.row ? [ctx.row] : [];
  const ref = (name) => {
    if (name === 'Parse Telegram Update') { return { first: () => ({ json: p }) }; }
    throw new Error('the node referenced $("' + name + '"), which this harness does not provide');
  };
  // `require` is passed in because the cycle gate mints the submission key with
  // `require('crypto').randomBytes` — the only entropy source that answers on the n8n tenant.
  // Withholding it would run the node's MINT_FAILED path in every case and prove nothing about
  // the one that actually ships.
  const sessionRunner = new Function('$input', '$', 'require', SESSION_BODY);
  const session = sessionRunner(
    { all: () => rows.map((r) => ({ json: r })), first: () => ({ json: rows[0] || {} }) }, ref, nodeRequire)[0].json;

  const responseRunner = new Function('$input', '$', RESPONSE_BODY);
  const reply = responseRunner({ first: () => ({ json: session }) }, ref)[0].json;
  return { session: session, reply: reply };
}

// A cold Bot_Sessions row is what `Find Session` hands the gate for a customer it has never seen:
// identity, and the raw Telegram language tag.
const cold = (ctx) => ({
  row_number: 0, session_id: '', chat_id: ctx.chat_id, user_id: ctx.chat_id,
  username: '', first_name: '', last_name: '',
  language: ctx.telegramLanguage === undefined ? 'ru' : (ctx.telegramLanguage || 'ru'),
  state: '', cycle_id: '', consent: '', lead_id: '', lead_cycle_id: '', status: '',
  submission_key: '', previous_lead_id: ''
});

const CUSTOMER = '551662999';        // a NON-owner customer
const OWNER_SHAPED = '551662084';    // the shape of an owner id, used only to prove it is ignored

const RO_MARK = /[ăâîșțĂÂÎȘȚ]/;
const CYRILLIC = /[А-Яа-яЁё]/;
const roTable = L.roTable(B);
const RU_MACHINE_VALUES = Object.keys(roTable);

// ── the published journey origin ─────────────────────────────────────────────────────────────
//
// The node can only honour an origin the site actually sends. Every page that links to the bot is
// read from disk and its link inspected against the language the page declares.
const BOT = 'https://t.me/finmentor_md_bot';

function botLinks() {
  const ro = { total: 0, bare: 0, wrong: 0, examples: [], wrongExamples: [] };
  const ru = { total: 0, bare: 0, wrong: 0, examples: [], wrongExamples: [] };
  const payloads = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') { continue; }
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.html$/.test(e.name)) { continue; }
      const html = readFileSync(p, 'utf8');
      if (html.indexOf(BOT) === -1) { continue; }
      const declared = /<html[^>]*\blang="([^"]*)"/.exec(html);
      const bucket = (declared && /^ro/i.test(declared[1])) ? ro : ru;
      const want = bucket === ro ? 'ro' : 'ru';
      for (const m of html.matchAll(/https:\/\/t\.me\/finmentor_md_bot(\?start=([a-zA-Z-]+))?/g)) {
        bucket.total++;
        if (!m[1]) { bucket.bare++; if (bucket.examples.length < 3) { bucket.examples.push(p); } continue; }
        payloads.add(m[2]);
        if (m[2] !== want) { bucket.wrong++; if (bucket.wrongExamples.length < 3) { bucket.wrongExamples.push(p); } }
      }
    }
  };
  walk(ROOT);
  return { ro: ro, ru: ru, payloads: payloads };
}

console.log('RO customer locale routing — the tracked candidate, executed');
console.log('');

// ── the six required cases ───────────────────────────────────────────────────────────────────

check('CASE 1 — journey ro + Telegram ru + NON-owner customer = Romanian Concierge', () => {
  // The defect this whole correction exists for. A Romanian who reads Telegram in Russian follows
  // the Romanian page's call to action and must be answered in Romanian.
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: '/start ro' };
  const t = turn(Object.assign({ row: cold(ctx) }, ctx));
  eq(t.session.language, 'ro', 'the journey origin did not become the session locale');
  assert(RO_MARK.test(t.reply.reply_text), 'the reply carries no Romanian: ' + t.reply.reply_text.slice(0, 80));
  assert(!CYRILLIC.test(t.reply.reply_text), 'Cyrillic reached the Romanian customer: ' + t.reply.reply_text.slice(0, 80));
  // …and it is the CONCIERGE, not an acknowledgement: the entry screen with its two actions.
  eq(t.reply.debug.state_after, 'TG_ENTRY', 'the customer did not reach the entry screen');
  const cbs = (t.reply.reply_markup.inline_keyboard || []).map((r) => r[0].callback_data);
  eq(cbs, ['p|describe', 'p|brief'], 'the Romanian customer was not offered the conversation');
});

check('CASE 1b — the Romanian locale SURVIVES the deep link, turn after turn', () => {
  // The start parameter fires once. Everything after it must read the persisted session locale,
  // or the customer falls back into Russian on their second message.
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: '/start ro' };
  const first = turn(Object.assign({ row: cold(ctx) }, ctx));
  const second = turn({ chat_id: CUSTOMER, telegramLanguage: 'ru', callbackData: 'p|describe', row: first.session });
  eq(second.session.language, 'ro', 'the locale was lost on the next turn');
  assert(RO_MARK.test(second.reply.reply_text), 'the second reply fell back to Russian');
  assert(!CYRILLIC.test(second.reply.reply_text), 'Cyrillic reached the Romanian customer on turn 2');
});

check('CASE 2 — journey ro + Telegram ro-MD = Romanian', () => {
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ro-MD', messageText: '/start ro' };
  const t = turn(Object.assign({ row: cold(ctx) }, ctx));
  eq(t.session.language, 'ro', 'locale');
  assert(RO_MARK.test(t.reply.reply_text) && !CYRILLIC.test(t.reply.reply_text), 'not Romanian');
});

check('CASE 3 — journey ru + Telegram ro = Russian', () => {
  // The journey origin is authoritative in BOTH directions. A customer who entered from the
  // Russian journey is not moved to Romanian by their phone's language.
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ro', messageText: '/start ru' };
  const t = turn(Object.assign({ row: cold(ctx) }, ctx));
  eq(t.session.language, 'ru', 'locale');
  assert(CYRILLIC.test(t.reply.reply_text), 'the Russian customer was not answered in Russian');
  assert(!RO_MARK.test(t.reply.reply_text), 'Romanian leaked into the Russian journey: ' + t.reply.reply_text.slice(0, 80));
});

check('CASE 4 — no journey locale + Telegram ro-MD = Romanian fallback', () => {
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ro-MD', messageText: '/start' };
  const t = turn(Object.assign({ row: cold(ctx) }, ctx));
  eq(t.session.language, 'ro', 'locale');
  assert(RO_MARK.test(t.reply.reply_text) && !CYRILLIC.test(t.reply.reply_text), 'not Romanian');
});

check('CASE 5 — no journey locale + Telegram ru = Russian fallback', () => {
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: '/start' };
  const t = turn(Object.assign({ row: cold(ctx) }, ctx));
  eq(t.session.language, 'ru', 'locale');
  assert(CYRILLIC.test(t.reply.reply_text) && !RO_MARK.test(t.reply.reply_text), 'not Russian');
});

check('CASE 6 — a NON-owner customer cannot reach an owner or admin action', () => {
  // The conversation became available to customers. It must hand them nothing that belongs to the
  // owner. Swept over every screen, every input and both locales: the only callbacks a customer
  // can be shown are the approved conversation actions.
  const APPROVED = ['p|describe', 'p|brief', 'p|ctx_ok', 'p|ctx_fix', 'p|open', 'p|resume',
    'p|restart', 'p|restart_y', 'p|append', 'p|new', 'p|new_y', 'p|back', 'p|retry'];
  const rows = [
    cold({ chat_id: CUSTOMER, telegramLanguage: 'ro' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_FREEFORM_PROBLEM' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_SUBMITTED', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_APPEND_MESSAGE', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' })
  ];
  const inputs = [{ messageText: '/start' }, { messageText: '/start ro' }, { messageText: 'у нас кассовые разрывы' }]
    .concat(APPROVED.map((cb) => ({ callbackData: cb })));
  const seen = new Set();
  for (const language of ['ru', 'ro', 'ro-MD']) {
    for (const row of rows) {
      for (const i of inputs) {
        const t = turn(Object.assign({ chat_id: CUSTOMER, telegramLanguage: language, row: row }, i));
        for (const r of t.reply.reply_markup.inline_keyboard || []) {
          for (const b of r) { if (!b.web_app) { seen.add(b.callback_data); } }
        }
        assert(t.reply.lead_ready === false, 'a customer turn claimed a lead is ready');
      }
    }
  }
  assert(seen.size > 0, 'no keyboard was produced at all — the sweep proved nothing');
  for (const cb of seen) {
    assert(APPROVED.indexOf(cb) !== -1, 'a non-approved callback reached a customer: ' + cb);
  }
  // And the node must not decide anything from an owner identity.
  for (const name of ['Get Bot Session', 'Build Bot Response']) {
    const exec = node(name).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert(!/owner_chat_id|is_owner|isOwner/.test(exec), name + ' reads an owner identity');
  }
});

check('CASE 6b — the customer id is not consulted at all when choosing the reply', () => {
  // An owner-shaped chat id must produce the identical reply to a customer id. This is the check
  // that would have caught the defect the correction closes: the premium conversation used to be
  // available only to one chat id.
  const base = { telegramLanguage: 'ro', messageText: '/start ro' };
  const asCustomer = turn(Object.assign({ chat_id: CUSTOMER, row: cold(Object.assign({ chat_id: CUSTOMER }, base)) }, base));
  const asOwner = turn(Object.assign({ chat_id: OWNER_SHAPED, row: cold(Object.assign({ chat_id: OWNER_SHAPED }, base)) }, base));
  eq(asCustomer.reply.reply_text, asOwner.reply.reply_text, 'the reply depends on WHO is asking');
  eq(asCustomer.reply.reply_markup, asOwner.reply.reply_markup, 'the keyboard depends on WHO is asking');
});

// ── RO customer parity, and the two leak counters the release asks for ───────────────────────

check('UNEXPECTED RU IN RO = 0 — no Russian machine value survives into a Romanian reply', () => {
  const rows = [
    cold({ chat_id: CUSTOMER, telegramLanguage: 'ro' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_FREEFORM_PROBLEM' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_SUBMITTED', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_NEW_REQUEST_CONFIRM', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', draft_state: 'draft', draft_step: 'objective', state: 'TG_RESUME_DRAFT' })
  ];
  const inputs = [{ messageText: '/start ro' }, { callbackData: 'p|describe' }, { callbackData: 'p|brief' },
    { callbackData: 'p|resume' }, { callbackData: 'p|new' }, { callbackData: 'p|append' }, { callbackData: 'p|retry' }];
  let leaks = 0;
  const examples = [];
  for (const row of rows) {
    for (const i of inputs) {
      const t = turn(Object.assign({ chat_id: CUSTOMER, telegramLanguage: 'ru', row: Object.assign({}, row, { language: 'ro' }) }, i));
      const text = t.reply.reply_text;
      if (CYRILLIC.test(text)) { leaks++; examples.push(text.slice(0, 60)); continue; }
      for (const b of (t.reply.reply_markup.inline_keyboard || []).flat()) {
        if (CYRILLIC.test(String(b.text))) { leaks++; examples.push('button: ' + b.text); }
      }
    }
  }
  eq(leaks, 0, 'Russian reached a Romanian customer ' + leaks + ' time(s): ' + examples.slice(0, 3).join(' | '));
});

check('UNEXPECTED RO IN RU = 0 — the Russian journey is untouched by the Romanian work', () => {
  const rows = [
    cold({ chat_id: CUSTOMER, telegramLanguage: 'ru' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_FREEFORM_PROBLEM' }),
    Object.assign(cold({ chat_id: CUSTOMER }), { cycle_id: 'CY-1', state: 'TG_SUBMITTED', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' })
  ];
  const inputs = [{ messageText: '/start ru' }, { messageText: '/start' }, { callbackData: 'p|describe' }, { callbackData: 'p|new' }];
  let leaks = 0;
  for (const row of rows) {
    for (const i of inputs) {
      const t = turn(Object.assign({ chat_id: CUSTOMER, telegramLanguage: 'ru', row: row }, i));
      if (RO_MARK.test(t.reply.reply_text)) { leaks++; }
      for (const b of (t.reply.reply_markup.inline_keyboard || []).flat()) {
        if (RO_MARK.test(String(b.text))) { leaks++; }
      }
    }
  }
  eq(leaks, 0, 'Romanian reached a Russian customer ' + leaks + ' time(s)');
});

check('RO CUSTOMER PARITY — every screen the Romanian customer reaches has Romanian copy', () => {
  // Parity is a build-time property of the label table (n8n/src/premium-ux/locale.js refuses to
  // emit a table with a hole in it). This asserts it on the ARTIFACT: the candidate carries the
  // full table, and it carries no Russian customer string that has no Romanian label.
  const body = node('Build Bot Response');
  const m = /const RO_LABELS = (\{[\s\S]*?\n\});/.exec(body);
  assert(m, 'the candidate carries no Romanian label table');
  const shipped = JSON.parse(m[1]);
  eq(Object.keys(shipped).length, RU_MACHINE_VALUES.length, 'the shipped table is not the module table');
  for (const k of RU_MACHINE_VALUES) {
    assert(Object.prototype.hasOwnProperty.call(shipped, k), 'the shipped table has no Romanian for: ' + k);
    assert(String(shipped[k]).trim() !== '', 'the shipped Romanian label is empty for: ' + k);
    assert(!CYRILLIC.test(String(shipped[k])), 'a Romanian label is still Russian: ' + k);
  }
});

// ── the authority, and the things it must never do ───────────────────────────────────────────

check('the shipping node uses the MODULE, not a re-typed copy of the resolution order', () => {
  for (const name of ['Get Bot Session', 'Build Bot Response']) {
    const body = node(name);
    for (const fn of ['normalize', 'resolveLocale', 'startPayloadLocale', 'resolveCustomerLocale']) {
      assert(body.indexOf('function ' + fn + '(') !== -1, name + ' is missing the lifted `' + fn + '`');
    }
    assert(body.indexOf('resolveCustomerLocale({') !== -1, name + ' does not call the module resolver');
    // The re-typed predicate that drifted from the module must not come back.
    assert(!/function isRo\b/.test(body), name + ' carries the retired ad-hoc `isRo`');
  }
});

check('the lifted resolver agrees with the module, case for case', () => {
  // Same table, run against the module and against the code the candidate ships.
  const body = node('Build Bot Response');
  const lifted = new Function(
    /const START_PAYLOAD_RE[\s\S]*?\n\}\n\nfunction resolveCustomerLocale\([\s\S]*?\n\}/.exec(body)[0]
    + '\n; return resolveCustomerLocale;')();
  const CASES = [
    { messageText: '/start ro', sessionLocale: 'ru', telegramLanguageCode: 'ru' },
    { messageText: '/start ru', sessionLocale: 'ro', telegramLanguageCode: 'ro' },
    { messageText: '/start', sessionLocale: '', telegramLanguageCode: 'ro-MD' },
    { messageText: '/start', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/start', sessionLocale: '', telegramLanguageCode: 'en' },
    { messageText: '', sessionLocale: 'ro', telegramLanguageCode: 'ru' },
    { messageText: '/start roman', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/start@finmentor_md_bot ro', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/start ro extra', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/start RO', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/startro', sessionLocale: '', telegramLanguageCode: 'ru' },
    { messageText: '/start ro-MD', sessionLocale: '', telegramLanguageCode: 'ru' }
  ];
  for (const c of CASES) {
    eq(lifted(c), L.resolveCustomerLocale(c), 'the shipped resolver disagrees with the module on ' + JSON.stringify(c));
  }
});

check('the start payload is a CLOSED vocabulary — nothing else can set a locale', () => {
  for (const payload of ['roman', 'romanian', 'en', 'fr', 'ro_MD_x', 'utm_source=ads', '../ro', 'RU;DROP',
                         '<script>', 'ro ru', '  ', '0']) {
    const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: '/start ' + payload };
    const t = turn(Object.assign({ row: cold(ctx) }, ctx));
    eq(t.session.language, 'ru', 'the payload ' + JSON.stringify(payload) + ' changed the locale');
  }
});

check('no language DETECTION participates — the origin is a page, never a guess', () => {
  const body = node('Build Bot Response') + node('Get Bot Session');
  for (const banned of ['detectLanguage', 'franc', 'langdetect', 'cld3', 'guessLanguage', 'openai', 'anthropic']) {
    assert(body.toLowerCase().indexOf(banned.toLowerCase()) === -1, 'a language detector is present: ' + banned);
  }
  // A Romanian SENTENCE typed by a Russian-journey customer must not switch their locale.
  const ctx = { chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: 'Bună ziua, avem probleme cu fluxul de numerar.' };
  const row = Object.assign(cold(ctx), { cycle_id: 'CY-1', state: 'TG_FREEFORM_PROBLEM', language: 'ru' });
  const t = turn(Object.assign({ row: row }, ctx));
  eq(t.session.language, 'ru', 'the customer\'s own words changed their locale');
});

// ── the machine contract is byte-identical across locales ────────────────────────────────────

check('the locale changes the LABEL and nothing the CRM or the routing reads', () => {
  const cases = [
    { messageText: '/start', row: (l) => Object.assign(cold({ chat_id: CUSTOMER }), { language: l, cycle_id: 'CY-1' }) },
    { callbackData: 'p|describe', row: (l) => Object.assign(cold({ chat_id: CUSTOMER }), { language: l, cycle_id: 'CY-1' }) },
    { messageText: 'кассовые разрывы', row: (l) => Object.assign(cold({ chat_id: CUSTOMER }), { language: l, cycle_id: 'CY-1', state: 'TG_FREEFORM_PROBLEM' }) },
    { callbackData: 'p|new', row: (l) => Object.assign(cold({ chat_id: CUSTOMER }), { language: l, cycle_id: 'CY-1', state: 'TG_SUBMITTED', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1' }) }
  ];
  for (const c of cases) {
    const ru = turn(Object.assign({ chat_id: CUSTOMER, telegramLanguage: 'ru', row: c.row('ru') }, c));
    const ro = turn(Object.assign({ chat_id: CUSTOMER, telegramLanguage: 'ru', row: c.row('ro') }, c));
    eq(ro.reply.debug.state_after, ru.reply.debug.state_after, 'the locale changed the state');
    eq(ro.reply.debug.writes, ru.reply.debug.writes, 'the locale changed the session writes');
    eq(ro.reply.debug.rotate, ru.reply.debug.rotate, 'the locale changed cycle rotation');
    eq(ro.reply.lead_ready, ru.reply.lead_ready, 'the locale changed lead readiness');
    eq(ro.reply.event.event_type, ru.reply.event.event_type, 'the locale changed the analytics event');
    const cb = (r) => (r.reply.reply_markup.inline_keyboard || []).map((row) => row.map((b) => b.callback_data || 'web_app').join(',')).join('|');
    eq(cb(ro), cb(ru), 'the locale changed the callback contract');
    // Only `language` may differ between the two sessions.
    const strip = (s) => { const c2 = normaliseMinted(s); delete c2.language; return c2; };
    eq(strip(ro.session), strip(ru.session), 'the locale changed a persisted session field other than `language`');
  }
});

check('`language` stays an EXISTING Bot_Sessions column — no column is added', () => {
  const rowBuilder = wf.nodes.find((n) => n.name === 'Build Session Row').parameters.jsCode;
  assert(rowBuilder.indexOf("'language'") !== -1, 'Build Session Row no longer persists `language`');
  const cols = /const COLS = \[([^\]]*)\]/.exec(rowBuilder);
  assert(cols, 'the persisted column list could not be read');
  const live = JSON.parse(readFileSync(join(ROOT, 'n8n', 'history', 'mppzthlkSJFr6Kle.pre-premium-ux.json'), 'utf8'));
  const liveCols = /const COLS = \[([^\]]*)\]/.exec(live.nodes.find((n) => n.name === 'Build Session Row').parameters.jsCode);
  eq(cols[1], liveCols[1], 'the persisted Bot_Sessions column list changed');
});

check('the /start reset no longer destroys a committed lead — in either language', () => {
  for (const [text, lang] of [['/start', 'ru'], ['/start ro', 'ro'], ['/start ru', 'ru']]) {
    const row = Object.assign(cold({ chat_id: CUSTOMER }), {
      cycle_id: 'CY-1', state: 'TG_SUBMITTED', lead_id: 'LEAD-1', lead_cycle_id: 'CY-1',
      consent: 'yes', consent_cycle_id: 'CY-1', submission_key: 'sub_' + '0'.repeat(32)
    });
    const t = turn({ chat_id: CUSTOMER, telegramLanguage: 'ru', messageText: text, row: row });
    eq(t.session.cycle_id, 'CY-1', text + ': the cycle was rotated');
    eq(t.session.lead_id, 'LEAD-1', text + ': the committed lead was archived');
    eq(t.session.consent, 'yes', text + ': consent was cleared');
    eq(t.session.language, lang, text + ': locale');
  }
});

// ── the other half of the journey: the pages must actually PUBLISH the origin ────────────────

check('every Romanian page publishes the bot link with the Romanian journey origin', () => {
  const { ro, ru } = botLinks();
  assert(ro.total > 0, 'no Romanian page links to the bot at all');
  eq(ro.bare, 0, ro.bare + ' Romanian bot link(s) carry no journey origin: ' + ro.examples.join(', '));
  eq(ro.wrong, 0, ro.wrong + ' Romanian bot link(s) seed the RUSSIAN origin: ' + ro.wrongExamples.join(', '));
});

check('every Russian page publishes the bot link with the Russian journey origin', () => {
  const { ru } = botLinks();
  assert(ru.total > 0, 'no Russian page links to the bot at all');
  eq(ru.bare, 0, ru.bare + ' Russian bot link(s) carry no journey origin: ' + ru.examples.join(', '));
  eq(ru.wrong, 0, ru.wrong + ' Russian bot link(s) seed the ROMANIAN origin: ' + ru.wrongExamples.join(', '));
});

check('the published origins are exactly the two the resolver recognises', () => {
  // A payload the node does not recognise silently falls back to Telegram's hint, which is the
  // defect wearing a different hat. The set the site publishes and the set the node accepts must
  // be the same set.
  const { payloads } = botLinks();
  for (const p of payloads) {
    assert(L.startPayloadLocale('/start ' + p) !== '', 'the site publishes an origin the node ignores: ' + p);
  }
  eq([...payloads].sort(), ['ro', 'ru'], 'the site publishes an unexpected set of origins');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
}
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
