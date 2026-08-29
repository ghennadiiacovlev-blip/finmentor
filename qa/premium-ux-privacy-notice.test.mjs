#!/usr/bin/env node
// FINMENTOR — the layered privacy notice (owner decisions 3, 4, 6 + the controller decision).
//
//   node qa/premium-ux-privacy-notice.test.mjs
//
// Offline. The point of this gate is narrow and blunt: a notice that a customer reads must never
// contain an invented legal identity, an unfilled placeholder, or a legal basis a lawyer has not
// confirmed. Each of those is a way for a document with legal weight to ship looking finished.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const N = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-notice.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); };

const FILLED = {
  controller_type: 'natural_person',
  controller_full_name: 'Тестовое Имя Фамилия',
  controller_privacy_email: 'privacy@example.test'
};

console.log('Premium UX — layered privacy notice');
console.log('');

// ---------------------------------------------------------------- completeness

check('both locales carry all ten required elements, and nothing else', () => {
  eq(N.REQUIRED_ELEMENTS.length, 10, 'element count');
  const problems = N.assertComplete();
  assert(problems.length === 0, problems.join('; '));
});

check('the elements are the ones Law 195/2024 requires', () => {
  const want = ['controller', 'purposes', 'legal_basis', 'categories', 'recipients',
                'transfers', 'retention', 'rights', 'complaint', 'voluntary'];
  eq(N.REQUIRED_ELEMENTS.join(','), want.join(','), 'element list');
});

check('the notice is layered — a concise layer exists for every locale', () => {
  for (const loc of N.LOCALES) {
    const c = N.CONCISE[loc];
    assert(c && c.heading && c.body && c.link, 'no concise layer for ' + loc);
    // Layer 1 must be genuinely concise, or it is not a layer.
    assert(c.body.length < 400, 'the concise layer for ' + loc + ' is not concise (' + c.body.length + ' chars)');
    // …and must point at layer 2 rather than replacing it.
    assert(/полн|complet/i.test(c.link), 'the concise layer for ' + loc + ' does not link to the full notice');
  }
});

// ---------------------------------------------------------------- no invented legal identity

check('no legal identity is hard-coded anywhere in the module', () => {
  const src = JSON.stringify({ CONCISE: N.CONCISE, FULL: N.FULL });
  // The exact fabrications the owner forbade.
  for (const forbidden of ['SRL', 'S.R.L', 'IDNO', 'ИДНО', 'ОГРН', 'МД-', 'MD-20', 'str.', 'ул.']) {
    assert(src.indexOf(forbidden) === -1, 'the notice contains an invented legal detail: ' + forbidden);
  }
  // No address, no phone, no bare email literal — the only contact is a slot.
  assert(!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(src), 'a literal email address is baked into the notice');
  assert(!/\+373/.test(src), 'a literal Moldovan phone number is baked into the notice');
});

check('the identity is a slot, and only the two the owner named', () => {
  eq(N.slotsUsed().join(','), 'controller_full_name,controller_privacy_email', 'slots used in the copy');
  eq(N.SLOTS.join(','), 'controller_full_name,controller_privacy_email', 'declared slots');
  eq(N.CONTROLLER_TEMPLATE.controller_type, 'natural_person', 'controller type');
  eq(N.CONTROLLER_TEMPLATE.controller_full_name, 'OWNER_INPUT_REQUIRED', 'name placeholder');
  eq(N.CONTROLLER_TEMPLATE.controller_privacy_email, 'OWNER_INPUT_REQUIRED', 'email placeholder');
});

check('the controller is described as a natural person, and the absence of a company is stated', () => {
  assert(/физическое лицо/.test(N.FULL.ru.elements.controller.body), 'RU does not say natural person');
  assert(/persoana fizică/.test(N.FULL.ro.elements.controller.body), 'RO does not say natural person');
  assert(/Отдельного юридического лица FINMENTOR не существует/.test(N.FULL.ru.elements.controller.body),
    'RU does not state that no FINMENTOR legal entity exists');
  assert(/Nu există o persoană juridică separată FINMENTOR/.test(N.FULL.ro.elements.controller.body),
    'RO does not state that no FINMENTOR legal entity exists');
});

// ---------------------------------------------------------------- render refuses rather than degrades

check('rendering REFUSES while the controller identity is unknown', () => {
  const r = N.render('ru', N.CONTROLLER_TEMPLATE);
  eq(r.ok, false, 'a placeholder identity rendered a notice');
  eq(r.error_code, 'CONTROLLER_IDENTITY_REQUIRED', 'error code');
  eq(r.missing.join(','), 'controller_full_name,controller_privacy_email', 'missing slots');
});

check('rendering refuses on a partially filled identity', () => {
  const half = Object.assign({}, FILLED, { controller_privacy_email: '   ' });
  const r = N.render('ru', half);
  eq(r.ok, false, 'a half-filled identity rendered');
  eq(r.missing.join(','), 'controller_privacy_email', 'missing slots');
});

check('rendering refuses a controller type other than natural_person', () => {
  const wrong = Object.assign({}, FILLED, { controller_type: 'legal_entity' });
  eq(N.render('ru', wrong).ok, false, 'a legal-entity controller rendered — the owner decided otherwise');
});

check('a filled identity renders both locales completely', () => {
  for (const loc of N.LOCALES) {
    const r = N.render(loc, FILLED);
    assert(r.ok, loc + ' failed to render: ' + JSON.stringify(r));
    eq(r.notice.full.sections.length, 10, loc + ' section count');
    eq(r.notice.full.sections.map((s) => s.key).join(','), N.REQUIRED_ELEMENTS.join(','), loc + ' section order');
    eq(r.notice.locale, loc, 'locale');
    eq(r.notice.version, N.NOTICE_VERSION, 'version');
    assert(r.notice.acknowledgement.length > 10, loc + ' has no acknowledgement line');
    for (const s of r.notice.full.sections) { assert(s.body.length > 20, loc + '/' + s.key + ' body is a stub'); }
  }
});

check('no placeholder or moustache survives a successful render', () => {
  for (const loc of N.LOCALES) {
    const j = JSON.stringify(N.render(loc, FILLED).notice);
    assert(j.indexOf('OWNER_INPUT_REQUIRED') === -1, loc + ' leaked the placeholder');
    assert(!/\{\{/.test(j), loc + ' leaked an unfilled moustache');
    assert(j.indexOf(FILLED.controller_full_name) !== -1, loc + ' did not substitute the name');
    assert(j.indexOf(FILLED.controller_privacy_email) !== -1, loc + ' did not substitute the email');
  }
});

check('an unknown locale is refused', () => {
  eq(N.render('en', FILLED).ok, false, 'en rendered');
  eq(N.render('', FILLED).ok, false, 'empty locale rendered');
});

// ---------------------------------------------------------------- the legal basis stays server-side

check('the candidate legal basis is never shown to the client', () => {
  eq(N.LEGAL_BASIS_CANDIDATE, 'pre_contractual_request', 'candidate enum');
  for (const loc of N.LOCALES) {
    const j = JSON.stringify(N.render(loc, FILLED).notice);
    assert(j.indexOf('pre_contractual_request') === -1, loc + ' rendered the enum');
    assert(j.indexOf('195/2024') !== -1 || j.indexOf('195/2024') !== -1, loc + ' does not cite the law');
  }
});

check('the legal-basis section describes the ground in words, not in an enum or an article number', () => {
  // A confirmed article citation would be a legal claim. The text states the SUBSTANCE — steps
  // taken at the data subject's request before a contract — which is true regardless of which
  // article a lawyer ultimately points at.
  assert(/до заключения договора/.test(N.FULL.ru.elements.legal_basis.body), 'RU legal basis lost its substance');
  assert(/înainte de încheierea unui contract/.test(N.FULL.ro.elements.legal_basis.body), 'RO legal basis lost its substance');
  assert(!/6\(1\)\(b\)|art\. 6/i.test(N.FULL.ru.elements.legal_basis.body + N.FULL.ro.elements.legal_basis.body),
    'the notice cites a specific article that legal review has not confirmed');
});

check('the pending sentinel is distinct from the candidate', () => {
  eq(N.LEGAL_BASIS_PENDING, 'PENDING_LEGAL_REVIEW', 'pending sentinel');
  assert(N.LEGAL_BASIS_PENDING !== N.LEGAL_BASIS_CANDIDATE, 'pending and candidate collapsed into one value');
});

// ---------------------------------------------------------------- the substantive disclosures

check('the transfer disclosure is present and honest', () => {
  // Supabase, n8n and Google all sit outside Moldova. Saying "we do not transfer data abroad"
  // would be false; naming a specific vendor in a customer notice is a commitment the owner has
  // not made. The text discloses the fact and the destinations.
  assert(/за пределами Республики Молдова/.test(N.FULL.ru.elements.transfers.body), 'RU hides the transfer');
  assert(/în afara Republicii Moldova/.test(N.FULL.ro.elements.transfers.body), 'RO hides the transfer');
});

check('retention states the 72-hour draft rule, matching the TTL actually deployed', () => {
  assert(/72 час/.test(N.FULL.ru.elements.retention.body), 'RU retention does not state 72 hours');
  assert(/72 de ore/.test(N.FULL.ro.elements.retention.body), 'RO retention does not state 72 hours');
});

check('the complaint route names the Moldovan supervisory authority', () => {
  assert(/Национальный центр по защите персональных данных/.test(N.FULL.ru.elements.complaint.body), 'RU authority');
  assert(/Centrul Național pentru Protecția Datelor/.test(N.FULL.ro.elements.complaint.body), 'RO authority');
});

check('the notice makes no security claim it cannot support', () => {
  const src = JSON.stringify({ C: N.CONCISE, F: N.FULL });
  for (const boast of ['военного уровня', 'military', 'банковск', 'bancar', 'шифров', 'criptat', '100%', 'абсолютн']) {
    assert(src.toLowerCase().indexOf(boast.toLowerCase()) === -1, 'unsupportable claim in the notice: ' + boast);
  }
});

check('the notice states that providing data is voluntary and what refusing costs', () => {
  assert(/добровольн/.test(N.FULL.ru.elements.voluntary.body), 'RU does not state voluntariness');
  assert(/voluntar/.test(N.FULL.ro.elements.voluntary.body), 'RO does not state voluntariness');
  assert(/невозможно/.test(N.FULL.ru.elements.voluntary.body), 'RU does not state the consequence');
  assert(/nu poate fi examinată/.test(N.FULL.ro.elements.voluntary.body), 'RO does not state the consequence');
});

check('the notice version is a real version and matches what the record will store', () => {
  assert(/^\d{4}-\d{2}-\d{2}\.v\d+/.test(N.NOTICE_VERSION), 'version is not dated-and-numbered: ' + N.NOTICE_VERSION);
  const rec = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-record.js'));
  const built = rec.buildPrivacyRecord({
    submissionKey: 'sub_' + 'a'.repeat(32),
    ack: { notice_version: N.NOTICE_VERSION, locale: 'ru', shown_at: '2026-08-29T10:00:00.000Z', acknowledged_at: '2026-08-29T10:04:00.000Z' },
    legalBasis: N.LEGAL_BASIS_PENDING
  });
  assert(built.ok, 'the record refused the notice version: ' + JSON.stringify(built));
  eq(built.record.privacy_notice_version, N.NOTICE_VERSION, 'stored version');
  // Both timestamps on ONE row — owner decision 4.
  assert(built.record.privacy_notice_shown_at && built.record.privacy_notice_acknowledged_at,
    'the record does not carry both timestamps');
});

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((f) => console.log('  - ' + f));
  console.log('');
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
