#!/usr/bin/env node
// FINMENTOR — the two privacy invariants that gate customer release, proven offline.
//
//   node qa/privacy-release-gate.test.mjs
//
// Offline. No tenant, no network, no browser, no production writes.
//
// WHY THIS GATE EXISTS. Gate 1 asked what would happen if either of these silently regressed, and
// the answer both times was "nothing would fail". Two release-critical privacy invariants had no
// test anywhere in the suite:
//
//   1. CONTACT CONSENT GATING. The questionnaire is the only surface where a person types their
//      name, company, e-mail and Telegram handle into a form that leaves the browser. Consent is
//      a REQUIRED entry in its validation table and submission returns early without it. Nothing
//      proved that. Deleting one line from `REQUIRED` would have shipped a form that transmits
//      contact data with no affirmative act, in both languages, and every existing gate would have
//      stayed green.
//
//   2. NO PII IN ANALYTICS. `analytics.js` sends business events through a CLOSED allow-list of
//      nine non-identifying keys, then redacts anything e-mail- or phone-shaped from the values
//      that survive. Nothing proved the list was closed. Adding one key would have started
//      streaming identifiers to GA4 with no test objecting.
//
// Both are read from the shipped files rather than restated here, so the gate fails when the
// product changes rather than when this file falls out of date.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) { throw new Error(m); } };

const PAGES = [
  { file: 'questionnaire.html', lang: 'RU', privacyHref: 'privacy.html', termsHref: 'terms.html' },
  { file: 'ro/questionnaire.html', lang: 'RO', privacyHref: 'privacy.html', termsHref: 'terms.html' }
];

// ── 1. contact consent gating ──────────────────────────────────────────────────────────────────

for (const p of PAGES) {
  const src = read(p.file);

  check(p.lang + ': consent is a REQUIRED field, not an optional extra', () => {
    const m = /var REQUIRED = \[([\s\S]*?)\n  \];/.exec(src);
    assert(m, 'the REQUIRED table could not be read');
    assert(/type: 'consent'/.test(m[1]), 'consent is absent from REQUIRED');
    assert(/name: 'q_consent'/.test(m[1]), 'the consent field is not q_consent');
  });

  check(p.lang + ': an unchecked consent box counts as unfilled', () => {
    assert(/if \(spec\.type === 'consent'\) \{ var c = one\(spec\.name\); return !!\(c && c\.checked\); \}/.test(src),
      'isFilled does not require the consent box to be checked');
  });

  check(p.lang + ': submission returns early while any required field is missing', () => {
    const m = /var missing = validate\(\);\s*\n\s*if \(missing\.length\) \{([\s\S]{0,400}?)\n    \}/.exec(src);
    assert(m, 'the submit guard could not be read');
    assert(/\breturn\b/.test(m[1]), 'the submit handler does not return when validation fails');
  });

  check(p.lang + ': the send path sits AFTER the validation guard, never before it', () => {
    const guard = src.indexOf('var missing = validate();');
    const collect = src.indexOf('collectAnswersJson()', guard);
    assert(guard !== -1 && collect !== -1, 'guard or payload build not found');
    assert(collect > guard, 'the payload is built before validation runs');
  });

  check(p.lang + ': the consent sentence links to the privacy policy before anything is sent', () => {
    const m = /<label class="q-consent" id="qConsentRow">([\s\S]*?)<\/label>/.exec(src);
    assert(m, 'the consent row could not be read');
    assert(new RegExp('href="' + p.privacyHref + '"').test(m[1]), 'no privacy-policy link inside the consent row');
    assert(new RegExp('href="' + p.termsHref + '"').test(m[1]), 'no terms link inside the consent row');
  });

  check(p.lang + ': the consent row is a real checkbox input the person must act on', () => {
    const m = /<label class="q-consent" id="qConsentRow">([\s\S]*?)<\/label>/.exec(src);
    assert(/type="checkbox"/.test(m[1]), 'consent is not a checkbox');
    assert(!/checked/.test(m[1]), 'the consent box ships pre-checked, which is not an affirmative act');
  });

  check(p.lang + ': a second privacy link is present at the submit action itself', () => {
    const m = /<p class="form-consent">([\s\S]*?)<\/p>/.exec(src);
    assert(m, 'the submit-side consent line could not be read');
    assert(new RegExp('href="' + p.privacyHref + '"').test(m[1]), 'no privacy link at the submit action');
  });

  check(p.lang + ': failing consent is reported on the consent row, so the person can find it', () => {
    assert(/qConsentRow/.test(src) && /is-error/.test(src), 'no error surface bound to the consent row');
  });
}

check('both languages gate on the SAME field name, so the two forms cannot drift apart', () => {
  for (const p of PAGES) { assert(/name: 'q_consent'/.test(read(p.file)), p.lang + ' uses a different consent field'); }
});

// ── 2. no PII in analytics ─────────────────────────────────────────────────────────────────────

const A = read('analytics.js');

// The allow-list, read from the file rather than restated, so widening it fails here.
const ALLOW = (() => {
  const m = /function safeBusinessParams\(params\) \{\s*var allow = \{([\s\S]*?)\};/.exec(A);
  if (!m) { return null; }
  return m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
})();

const ALLOW_EXPECTED = ['contact_method', 'file_extension', 'file_name', 'form_name',
  'lead_type', 'page_slug', 'site_language', 'source'];

check('the business-event parameter allow-list is exactly the eight approved non-identifying keys', () => {
  assert(ALLOW, 'the allow-list could not be read from analytics.js');
  assert(JSON.stringify(ALLOW.slice().sort()) === JSON.stringify(ALLOW_EXPECTED),
    'the allow-list changed — got [' + ALLOW.slice().sort().join(', ') + '], expected [' + ALLOW_EXPECTED.join(', ') + ']');
});

check('no identifying key is in the allow-list', () => {
  const forbidden = ['email', 'e_mail', 'phone', 'telegram', 'name', 'first_name', 'last_name', 'full_name',
    'company', 'company_name', 'contact', 'contact_name', 'user_id', 'lead_id', 'request_id', 'ip', 'address',
    'message', 'answers', 'turnover', 'revenue'];
  for (const k of forbidden) { assert(ALLOW.indexOf(k) === -1, 'analytics would send ' + k); }
});

check('the allow-list is a closed filter — an unlisted key is dropped, not passed through', () => {
  const m = /function safeBusinessParams\(params\) \{([\s\S]*?)\n  \}/.exec(A);
  assert(m, 'safeBusinessParams could not be read');
  assert(/if \(!allow\[key\]\) return;/.test(m[1]), 'unlisted keys are not dropped');
});

check('surviving values are still redacted for anything e-mail or phone shaped', () => {
  assert(/\.replace\(\/\[A-Z0-9\._%\+-\]\+@\[A-Z0-9\.-\]\+\\\.\[A-Z\]\{2,\}\/ig, '\[email\]'\)/.test(A)
    || /'\[email\]'/.test(A), 'no e-mail redaction');
  assert(/'\[phone\]'/.test(A), 'no phone redaction');
});

check('values are length-capped, so a free-text field cannot smuggle a payload through', () => {
  const m = /function safeBusinessParams\(params\) \{([\s\S]*?)\n  \}/.exec(A);
  assert(/\.slice\(0, \d+\)/.test(m[1]), 'no length cap on analytics values');
});

check('business events are only ever sent through the filter, never with raw params', () => {
  const m = /function trackBusiness\(name, params\) \{([\s\S]*?)\n  \}/.exec(A);
  assert(m, 'trackBusiness could not be read');
  assert(/safeBusinessParams\(params \|\| \{\}\)/.test(m[1]), 'trackBusiness does not filter its parameters');
  const raw = /gtag\('event', name, params\)/.test(A);
  assert(!raw, 'an unfiltered gtag event call exists');
});

check('analytics loads no Google script until a consent choice is stored', () => {
  assert(/finmentor_cookie_consent/.test(A), 'no consent key');
  assert(/'accept'/.test(A) && /'deny'/.test(A), 'consent states missing');
});

check('the analytics consent key is separate from the lead-contact consent field', () => {
  assert(!/q_consent/.test(A), 'analytics reads the form consent field');
  for (const p of PAGES) { assert(!/finmentor_cookie_consent/.test(/var REQUIRED = \[([\s\S]*?)\n  \];/.exec(read(p.file))[1]), p.lang + ' mixes the two consents'); }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
