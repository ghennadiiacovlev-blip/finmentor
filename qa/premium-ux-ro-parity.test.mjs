// FINMENTOR — Romanian parity gate (Sprint 1, checkpoint 2).
//
// WHAT THIS GATE IS FOR. Production v1 shipped a Romanian public site and a Romanian result with a
// Russian conversation and a Russian brief in between. Closing that gap is only half the work; the
// other half is making the gap impossible to reopen. This gate is that half.
//
// It proves four things, and each of them is a way the Romanian path could silently rot:
//
//   1. COMPLETENESS — every customer-visible string, in branches.js and in the Mini App shell, has
//      a Romanian label. A new Russian string added anywhere on the customer path fails here
//      rather than appearing in front of a Romanian customer.
//   2. NO FALLBACK — the build itself refuses an incomplete translation. Proven by construction,
//      not asserted by comment.
//   3. MACHINE VALUES ARE UNTOUCHED — the Romanian dictionary never appears in a stored value, a
//      comparison or a projection. Presentation and storage stay separate (owner decision,
//      Option A: the Russian string remains the canonical machine value in BOTH languages).
//   4. LOCALE AUTHORITY — the journey decides the language, not Telegram's UI setting. The v1
//      failure mode (a Romanian whose Telegram is Russian gets a Russian conversation) is pinned
//      shut, and so is the `ro-MD` tag that an `=== 'ro'` test used to miss.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);

const B = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'branches.js'));
const L = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'locale.js'));
const N = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-notice.js'));
const { RO_LABELS, SHELL_RO } = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'ro-labels.js'));

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const APP = read(join('app-premium', 'app.js'));
const CONTENT = read(join('app-premium', 'content.js'));

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) { throw new Error('returned false'); }
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ' -> ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
function assert(c, m) { if (!c) { throw new Error(m); } }

const CYRILLIC = /[А-яЁё]/;

console.log('\nRO PARITY — locale authority, completeness, machine-value isolation\n');

// ── 1. completeness ──────────────────────────────────────────────────────────────────────────

check('every customer-visible contract string has a Romanian label', () => {
  const missing = L.missingRoLabels(B);
  assert(missing.length === 0, missing.length + ' missing, first: ' + JSON.stringify(missing[0]));
  return true;
});

check('every Mini App shell string has a Romanian label', () => {
  const missing = L.missingShellLabels(APP);
  assert(missing.length === 0, missing.length + ' missing, first: ' + JSON.stringify(missing[0]));
  return true;
});

check('the dictionary has no orphan entries the customer can never see', () => {
  const reachable = new Set(L.collectVisibleStrings(B));
  const orphans = Object.keys(RO_LABELS).filter((k) => !reachable.has(k));
  assert(orphans.length === 0, orphans.length + ' orphan(s), first: ' + JSON.stringify(orphans[0]));
  return true;
});

check('every Romanian label is actually Romanian, never a copied Russian string', () => {
  const all = Object.assign({}, RO_LABELS, SHELL_RO);
  const cyr = Object.keys(all).filter((k) => CYRILLIC.test(all[k]));
  assert(cyr.length === 0, cyr.length + ' Romanian label(s) still contain Cyrillic, first: '
    + JSON.stringify(all[cyr[0]]));
  return true;
});

check('no Romanian label is identical to its Russian machine value', () => {
  const all = Object.assign({}, RO_LABELS, SHELL_RO);
  const same = Object.keys(all).filter((k) => all[k] === k);
  assert(same.length === 0, same.length + ' untranslated, first: ' + JSON.stringify(same[0]));
  return true;
});

// ── 2. no fallback: the BUILD refuses an incomplete translation ──────────────────────────────

check('an untranslated customer-visible string fails the build, never falls back to Russian', () => {
  let threw = false;
  try {
    L.roTable({ OBJECTIVES: [{ id: 'x', label: 'Строка без перевода' }] });
  } catch (e) {
    threw = /RO parity incomplete/.test(e.message);
  }
  assert(threw, 'roTable() accepted an untranslated string');
  return true;
});

check('the emitted bundle carries the resolved Romanian table', () => {
  assert(CONTENT.indexOf('window.FM_RO') !== -1, 'FM_RO absent from content.js');
  const w = {};
  // eslint-disable-next-line no-new-func
  new Function('window', CONTENT)(w);
  const n = Object.keys(w.FM_RO).length;
  const expected = new Set(Object.keys(L.roTable(Object.assign({}, B, { PRIVACY: {} }))));
  const walkPrivacy = (value) => {
    if (typeof value === 'string') { expected.add(value); return; }
    if (Array.isArray(value)) { value.forEach(walkPrivacy); return; }
    if (value && typeof value === 'object') Object.values(value).forEach(walkPrivacy);
  };
  walkPrivacy(N.MINI_APP.ru);
  assert(n === expected.size, 'FM_RO carries ' + n + ' entries, expected ' + expected.size);
  for (const legacy of B.PRIVACY.lines) assert(!Object.hasOwn(w.FM_RO, legacy), 'stale privacy label emitted');
  return true;
});

// ── 3. machine values are untouched ──────────────────────────────────────────────────────────

check('the app submits the machine value, never the Romanian label', () => {
  // Every `set(...)` of a presentation-coupled field must take an unlocalised expression. `T()` is
  // reachable only from `el()`, so a localised string cannot arrive here.
  const sets = APP.match(/set\('(objective|problem|desired_outcome|role|company_scale)'[^;]*/g) || [];
  assert(sets.length > 0, 'no presentation-coupled set() calls found — the gate is looking at the wrong file');
  const localised = sets.filter((s) => /\bT\s*\(/.test(s));
  assert(localised.length === 0, 'a localised value is being stored: ' + localised[0]);
  return true;
});

check('T() is applied at the render boundary only', () => {
  assert(/n\.textContent = T\(text\);/.test(APP), 'el() does not translate');
  const calls = APP.match(/\bT\(/g) || [];
  // the definition, the call inside el(), and nothing else
  assert(calls.length <= 3, 'T() is called ' + calls.length + ' times; it belongs in el() alone');
  return true;
});

check('branches.js is untouched by the translation — machine values are byte-identical', () => {
  // The Romanian dictionary lives in its own file. If a translation had been written INTO
  // branches.js, a Romanian string would be reachable from the exports the projection reads.
  const strings = L.collectVisibleStrings(B);
  const roValues = new Set(Object.values(RO_LABELS));
  const leaked = strings.filter((s) => roValues.has(s));
  assert(leaked.length === 0, 'a Romanian label reached branches.js: ' + JSON.stringify(leaked[0]));
  return true;
});

check('the free-text sentinels still compare against the canonical machine value', () => {
  assert(CYRILLIC.test(B.PROBLEM_FREE_TEXT_OPTION), 'PROBLEM_FREE_TEXT_OPTION is no longer the Russian literal');
  assert(CYRILLIC.test(B.OUTCOME_FREE_TEXT_OPTION), 'OUTCOME_FREE_TEXT_OPTION is no longer the Russian literal');
  assert(Object.prototype.hasOwnProperty.call(RO_LABELS, B.PROBLEM_FREE_TEXT_OPTION),
    'the problem sentinel has no Romanian label');
  assert(Object.prototype.hasOwnProperty.call(RO_LABELS, B.OUTCOME_FREE_TEXT_OPTION),
    'the outcome sentinel has no Romanian label');
  return true;
});

// ── 3b. the projection is blind to the locale ────────────────────────────────────────────────
//
// The whole point of Option A, stated as an executable fact: run the SAME answers through the real
// lead projection twice, changing only the language, and the payload the Pipeline receives must be
// byte-identical. If a Romanian label ever reached storage, this is where it would show.

const SP = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'submit-projection.js'));
const fv = (x) => ({ value: x });
const ANSWERS = {
  objective: fv(B.OBJECTIVES[2].label),
  problem: fv(B.PROBLEMS.cash_flow.options[0][0]),
  desired_outcome: fv(B.OUTCOMES.cash_flow.options[0][0]),
  company_name: fv('UAT SRL'), company_activity: fv('retail'), role: fv('Собственник'),
  company_scale: fv(B.SCALE_OPTIONS[1]),
  decision_horizon: fv(B.DECISION_HORIZON.options[0][0]),
  contact_channel: fv('telegram'), contact_name: fv('Test')
};
const payloadFor = (loc) => JSON.stringify(SP.buildLeadIntakePayload(
  { draft: { fields: Object.assign({}, ANSWERS, { locale: fv(loc) }) } }));

check('the same answers project to a byte-identical payload in both languages', () => {
  const strip = (s) => s.split('"ru"').join('"L"').split('"ro"').join('"L"');
  const ru = payloadFor('ru');
  const ro = payloadFor('ro');
  assert(ru.length > 500, 'the fixture no longer produces a real payload (got ' + ru.length + ' bytes)');
  assert(strip(ru) === strip(ro), 'the Romanian payload differs from the Russian one');
  return true;
});

check('a Romanian customer stores the Russian machine value, not the Romanian label', () => {
  const ro = payloadFor('ro');
  for (const v of [B.OBJECTIVES[2].label, B.PROBLEMS.cash_flow.options[0][0],
    B.OUTCOMES.cash_flow.options[0][0]]) {
    assert(ro.indexOf(v) !== -1, 'the canonical machine value is missing from the payload: ' + v);
  }
  return true;
});

check('no Romanian label reaches the lead payload', () => {
  const ro = payloadFor('ro');
  const leaked = Object.values(RO_LABELS).filter((v) => v.length > 8 && ro.indexOf(v) !== -1);
  assert(leaked.length === 0, 'a Romanian label reached storage: ' + JSON.stringify(leaked[0]));
  return true;
});

// ── 4. locale authority ──────────────────────────────────────────────────────────────────────

check('the customer journey outranks the Telegram UI language', () => {
  assert(L.resolveLocale({ journeyLocale: 'ro', telegramLanguageCode: 'ru' }) === 'ro',
    'a Romanian entering from /ro/ with a Russian Telegram was sent down the Russian path');
  assert(L.resolveLocale({ journeyLocale: 'ru', telegramLanguageCode: 'ro' }) === 'ru',
    'a Russian customer was switched to Romanian by a Telegram setting');
  return true;
});

check('a resolved session locale is never recomputed from the Telegram hint', () => {
  assert(L.resolveLocale({ sessionLocale: 'ro', telegramLanguageCode: 'en' }) === 'ro');
  assert(L.resolveLocale({ sessionLocale: 'ru', telegramLanguageCode: 'ro' }) === 'ru');
  return true;
});

check('Telegram language_code is a hint only, for a cold first contact', () => {
  assert(L.resolveLocale({ telegramLanguageCode: 'ro-MD' }) === 'ro', 'ro-MD is Romanian');
  assert(L.resolveLocale({ telegramLanguageCode: 'ro' }) === 'ro');
  assert(L.resolveLocale({ telegramLanguageCode: 'en' }) === 'ru', 'unknown tags default to ru');
  assert(L.resolveLocale({}) === 'ru', 'no signal defaults to ru');
  return true;
});

check('a tag match, not a prefix match: "roman" is not Romanian', () => {
  assert(L.resolveLocale({ telegramLanguageCode: 'roman' }) === 'ru');
  assert(L.resolveLocale({ journeyLocale: 'romanian' }) === 'ru');
  return true;
});

// ── 4b. the journey-origin carrier (P1-01) ───────────────────────────────────────────────────
//
// The order above was correct and, until this correction, unreachable: nothing on the shipping
// path ever supplied `journeyLocale`. The carrier is the bot's deep-link start parameter, which
// arrives as the message text `/start ro`.

check('the deep-link start parameter carries the journey origin', () => {
  assert(L.startPayloadLocale('/start ro') === 'ro', 'the Romanian origin was not read');
  assert(L.startPayloadLocale('/start ru') === 'ru', 'the Russian origin was not read');
  assert(L.startPayloadLocale('/start ro-MD') === 'ro', 'a regional tag in the payload is Romanian');
  assert(L.startPayloadLocale('/start RO') === 'ro', 'the payload is case-insensitive');
  assert(L.startPayloadLocale('/start@finmentor_md_bot ro') === 'ro',
    'a group-addressed start command lost its payload');
  return true;
});

check('the start payload is a CLOSED vocabulary — anything else carries no origin', () => {
  // A payload the resolver half-understood would be worse than one it ignores: the customer would
  // be routed by a tracking code. Everything outside the two supported tags returns '' and the
  // turn falls through to the persisted session and then to Telegram's hint.
  for (const bad of ['roman', 'romanian', 'en', 'fr', 'utm_source=ads', '../ro', 'ro ru', 'RU;DROP',
                     '<script>', '0', '']) {
    assert(L.startPayloadLocale('/start ' + bad) === '', 'an unsupported payload carried an origin: ' + bad);
  }
  assert(L.startPayloadLocale('/start') === '', 'a bare /start carried an origin');
  assert(L.startPayloadLocale('/startro') === '', '/startro is not a start payload');
  assert(L.startPayloadLocale('ro') === '', 'a bare word is not a start payload');
  assert(L.startPayloadLocale('Bună ziua, sunt din Chișinău') === '',
    'a customer sentence was read as a journey origin — that would be language detection');
  return true;
});

check('resolveCustomerLocale is the whole order, in one call', () => {
  const R = L.resolveCustomerLocale;
  // 1 — journey origin beats everything, in both directions.
  assert(R({ messageText: '/start ro', sessionLocale: 'ru', telegramLanguageCode: 'ru' }) === 'ro',
    'the Romanian journey lost to a Russian session and a Russian Telegram');
  assert(R({ messageText: '/start ru', sessionLocale: 'ro', telegramLanguageCode: 'ro' }) === 'ru',
    'the Russian journey lost to a Romanian session and a Romanian Telegram');
  // 2 — the persisted session, once the deep link has been followed.
  assert(R({ messageText: 'ceva', sessionLocale: 'ro', telegramLanguageCode: 'ru' }) === 'ro',
    'a returning Romanian customer was switched back to Russian');
  // 3 — Telegram, only for a customer with neither.
  assert(R({ messageText: '/start', telegramLanguageCode: 'ro-MD' }) === 'ro', 'the cold hint was ignored');
  assert(R({ messageText: '/start', telegramLanguageCode: 'ru' }) === 'ru');
  // 4 — ru.
  assert(R({ messageText: '/start', telegramLanguageCode: 'en' }) === 'ru', 'an unknown tag did not default');
  assert(R({}) === 'ru', 'no signal at all did not default');
  return true;
});

check('the client agrees with the server on what counts as Romanian', () => {
  assert(/function isRoTag\(v\) \{ return \/\^ro\(-\|\$\)\/i\.test/.test(APP),
    'app.js no longer uses a tag match for the Romanian locale');
  assert(APP.indexOf("language_code === 'ro'") === -1,
    'app.js still has an equality test that misses ro-MD');
  return true;
});

check('no AI or model call participates in choosing the language', () => {
  // Comments are stripped first: this gate is about what the module DOES, and the module's own
  // prose explains that no model is involved — which is not the same as calling one.
  // `\r` is normalised away first: on a Windows checkout the lines carry CRLF, and a comment
  // stripper that anchors on `$` then leaves the carriage return behind — which is enough to make
  // this gate disagree with itself between a worktree and a clean archive.
  const code = read(join('n8n', 'src', 'premium-ux', 'locale.js'))
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  for (const needle of ['openai', 'gpt', 'model', 'prompt', 'fetch', 'require(\'http']) {
    assert(code.toLowerCase().indexOf(needle) === -1, 'locale.js code references ' + needle);
  }
  return true;
});

// ── 5. no second state machine ───────────────────────────────────────────────────────────────

check('Romanian adds no branch, no state and no duplicated business logic', () => {
  const src = read(join('n8n', 'src', 'premium-ux', 'ro-labels.js'));
  for (const needle of ['function ', 'if (', 'require(']) {
    assert(src.indexOf(needle) === -1, 'ro-labels.js contains logic (' + needle + '); it must be data only');
  }
  return true;
});

check('the owner-facing brief stays Russian by design', () => {
  assert(L.VISIBLE_EXPORTS.indexOf('MEETING_BRIEF') === -1);
  const brief = read(join('n8n', 'src', 'premium-ux', 'meeting-brief.js'));
  assert(CYRILLIC.test(brief), 'the owner brief is no longer Russian');
  return true;
});

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
