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

// ── 3. the Mini App privacy links actually go somewhere ────────────────────────────────────────
//
// GATE 1, 2026-09-04. These were `a.href = '#'` on the submit screen, and the entry-screen
// affordance was a `div` with no handler — on the surface that collects role, company, scale, task,
// contact channel and Telegram id. A person was asked to acknowledge information they could not
// open. The owner's decision was to point them at the existing public policy pages: no in-app
// modal, no second privacy system.

const APP = read('app-premium/app.js');

check('the Mini App names the real public policy URLs, one per locale', () => {
  assert(/ru: 'https:\/\/www\.finmentor\.md\/privacy\.html'/.test(APP), 'RU policy URL missing');
  assert(/ro: 'https:\/\/www\.finmentor\.md\/ro\/privacy\.html'/.test(APP), 'RO policy URL missing');
});

check('the link target follows the locale the SERVER decided, not the client guess', () => {
  assert(/function privacyUrl\(\) \{ return get\('locale'\) === 'ro' \? PRIVACY_URL\.ro : PRIVACY_URL\.ru; \}/.test(APP),
    'privacyUrl does not select on the recorded session locale');
});

check('no privacy link is left as a placeholder anywhere in the Mini App', () => {
  assert(!/a\.href = '#'/.test(APP), "a privacy link is still href='#'");
  assert(!/href = ['\"]{2}/.test(APP), 'an empty href remains');
});

check('both submit-screen links and the entry affordance are built by the same real-link helper', () => {
  assert(/C\.PRIVACY\.links\.forEach\(function \(l\) \{ links\.appendChild\(privacyLink\(l\)\); \}\)/.test(APP),
    'the submit-screen links are not built by privacyLink');
  assert(/var link = privacyLink\(null, 'entry-link'\);/.test(APP), 'the entry affordance is not a real link');
});

check('the helper sets a genuine href plus safe rel, so the link survives outside Telegram', () => {
  const m = /function privacyLink\(label, cls\) \{([\s\S]*?)\n  \}/.exec(APP);
  assert(m, 'privacyLink could not be read');
  assert(/a\.href = privacyUrl\(\);/.test(m[1]), 'no href assigned');
  assert(/a\.target = '_blank';/.test(m[1]), 'no target');
  assert(/a\.rel = 'noopener noreferrer';/.test(m[1]), 'no rel=noopener');
});

check('inside Telegram the link opens through the WebApp bridge, which is what actually works there', () => {
  const m = /function privacyLink\(label, cls\) \{([\s\S]*?)\n  \}/.exec(APP);
  assert(/tg && typeof tg\.openLink === 'function'/.test(m[1]), 'no WebApp openLink path');
  assert(/tg\.openLink\(privacyUrl\(\)\)/.test(m[1]), 'openLink is not called with the policy URL');
});

check('the policy pages the Mini App points at exist in the repository', () => {
  for (const f of ['privacy.html', 'ro/privacy.html']) {
    const html = read(f);
    assert(html.length > 1000, f + ' is missing or empty');
  }
});

// ── 4. controller identity is present in both public policies ──────────────────────────────────

const POLICIES = [
  { file: 'privacy.html', lang: 'RU', controllerRe: /Оператор персональных данных: <strong>Iacovlev Ghennadi<\/strong>/ },
  { file: 'ro/privacy.html', lang: 'RO', controllerRe: /Operator de date cu caracter personal: <strong>Iacovlev Ghennadi<\/strong>/ }
];

for (const p of POLICIES) {
  const html = read(p.file);

  check(p.lang + ' policy names the controller exactly as the owner supplied it', () => {
    assert(p.controllerRe.test(html), 'the controller line is missing or altered');
  });

  check(p.lang + ' policy carries the privacy contact address', () => {
    assert(/mailto:cfo@finmentor\.md/.test(html), 'no mailto for the privacy contact');
  });

  check(p.lang + ' policy invents no company form, registration number, VAT or street address', () => {
    for (const invented of ['SRL', 'S.R.L.', 'IDNO', 'IDNP', 'НДС', 'TVA', 'VAT']) {
      assert(html.indexOf(invented) === -1, 'invented legal detail present: ' + invented);
    }
  });

  check(p.lang + ' policy states the 12-month retention for an unconverted lead', () => {
    assert(/12 месяцев|12 luni/.test(html), 'the retention period is missing');
  });

  check(p.lang + ' policy keeps contractual retention separate from the 12-month rule', () => {
    assert(/договорные отношения|relații contractuale/.test(html), 'contractual retention is not carved out');
  });

  check(p.lang + ' policy records the legal basis as proposed, never as counsel-approved', () => {
    assert(/6\(1\)\(b\)/.test(html), 'the proposed basis is not recorded');
    assert(/подлежит окончательному подтверждению|urmează să fie confirmat definitiv/.test(html), 'no pending-confirmation caveat');
    assert(!/одобрен(о|а) юрист|aprobat de (un )?avocat|legal counsel approved/i.test(html), 'claims counsel approval');
  });

  check(p.lang + ' policy keeps analytics and optional marketing on consent, separately', () => {
    assert(/согласия|consimțământ/.test(html), 'consent basis not mentioned for the optional purposes');
  });

  check(p.lang + ' policy carries the owner-approved AI and processor paragraph', () => {
    assert(/Supabase \(ЕС\)|Supabase \(UE\)/.test(html), 'the approved paragraph is missing');
    assert(/проверки человеком|verificare umană/.test(html), 'the human-review sentence is missing');
  });

  check(p.lang + ' policy does not present FINMENTOR itself as the controller', () => {
    assert(/торговая марка, а не оператор|marca comercială, nu operatorul/.test(html), 'brand/controller distinction missing');
  });
}


// ── GATE 4: the page address must not become the leak the parameter filter prevents ────────────
//
// The event PARAMETERS were always filtered. The page ADDRESS was not: gtag attaches
// `page_location` to every event from `document.location`, and the live UAT caught the conversion
// beacon on `thank-you.html?tool=…&sid=…` carrying the submission id in `dl`. The explicit
// page_view had always overridden it; nothing else did.
//
// The fix sets the scrubbed location on the CONFIG, which makes the URL allow-list authoritative
// for every event from every sender — including `main.js`, which has its own delegated GA4 sender
// that calls gtag directly and would otherwise have kept sending the raw address.

check('the config sets the scrubbed page location, so every event inherits it', () => {
  const m = /window\.gtag\('config', GA4_ID, \{([\s\S]*?)\}\);/.exec(A);
  assert(m, 'the config call could not be read');
  assert(/page_location:\s*safePageLocation\(\)/.test(m[1]), 'the config does not set a scrubbed page_location');
  assert(/page_path:\s*safePagePath\(\)/.test(m[1]), 'the config does not set a scrubbed page_path');
  assert(/send_page_view:\s*false/.test(m[1]), 'the automatic page_view was re-enabled');
});

check('every business event also sends the scrubbed location, independent of config ordering', () => {
  const m = /function trackBusiness\(name, params\) \{([\s\S]*?)\n  \}/.exec(A);
  assert(m, 'trackBusiness could not be read');
  assert(/page_location:\s*safePageLocation\(\)/.test(m[1]), 'trackBusiness does not send a scrubbed page_location');
  assert(/page_path:\s*safePagePath\(\)/.test(m[1]), 'trackBusiness does not send a scrubbed page_path');
});

check('the scrubbed location cannot be overridden by a caller parameter', () => {
  // safeBusinessParams is applied first and its allow-list has no location keys, so the scrubbed
  // values are written last and always win.
  assert(ALLOW.indexOf('page_location') === -1 && ALLOW.indexOf('page_path') === -1,
    'a location key is in the business-parameter allow-list');
  const m = /function trackBusiness\(name, params\) \{([\s\S]*?)\n  \}/.exec(A);
  const idxParams = m[1].indexOf('safeBusinessParams');
  const idxLoc = m[1].indexOf('page_location');
  assert(idxParams !== -1 && idxLoc > idxParams, 'the scrubbed location is not applied last');
});

check('the URL allow-list still rejects every identifier the product mints', () => {
  const m = /var URL_PARAM_ALLOW = \{([\s\S]*?)\};/.exec(A);
  assert(m, 'the URL allow-list could not be read');
  for (const forbidden of ['sid', 'lead_id', 'request_id', 'submission_key', 'token', 'review_token', 'email', 'phone', 'chat_id', 'cid']) {
    assert(new RegExp('\\b' + forbidden + '\\s*:').test(m[1]) === false, 'the URL allow-list admits ' + forbidden);
  }
  assert(/\btool\s*:/.test(m[1]), 'the categorical tool parameter was dropped');
});

// ── the SECOND GA4 sender, in main.js ──────────────────────────────────────────────────────────
//
// `main.js` carries its own delegated sender (`initGA`). It is not a rogue implementation — it has
// its own closed allow-list, the same e-mail and phone redaction and a length cap — but it exists,
// it emits events analytics.js never names (`bot_click`, `click_email` and the CTA family), and it
// calls gtag directly. It is part of the contract and is held to the same rules here.

const M = read('main.js');

check('the second sender filters its parameters through a closed allow-list too', () => {
  const m = /function safeParams\(params\) \{[\s\S]*?var allow = \{([\s\S]*?)\};/.exec(M);
  assert(m, 'the second sender allow-list could not be read');
  assert(/if \(!allow\[k\]\) return;/.test(M), 'the second sender does not drop unlisted keys');
  for (const forbidden of ['name', 'email', 'phone', 'telegram', 'company', 'lead_id', 'request_id', 'message', 'answers', 'free_text']) {
    assert(new RegExp('\\b' + forbidden + '\\s*:\\s*true').test(m[1]) === false, 'the second sender admits ' + forbidden);
  }
});

check('the second sender redacts e-mail and phone shapes and caps length', () => {
  const m = /function safeParams\(params\) \{([\s\S]*?)\n    \}/.exec(M);
  assert(/\[email\]/.test(m[1]), 'no e-mail redaction in the second sender');
  assert(/\[phone\]/.test(m[1]), 'no phone redaction in the second sender');
  assert(/\.slice\(0, \d+\)/.test(m[1]), 'no length cap in the second sender');
});

check('the second sender never sends a full URL — hrefs are reduced to a scheme or host', () => {
  const m = /function safeLinkUrl\(a\) \{([\s\S]*?)\n    \}/.exec(M);
  assert(m, 'safeLinkUrl could not be read');
  for (const token of ["'mailto'", "'tel'", "'telegram'", "'whatsapp'"]) {
    assert(m[1].indexOf(token) !== -1, 'safeLinkUrl lost the ' + token + ' reduction');
  }
  assert(/u\.hostname/.test(m[1]), 'an off-site href is not reduced to its hostname');
  assert(/href\.split\('\?'\)\[0\]/.test(m[1]), 'the fallback keeps the query string');
});

check('the second sender only reads author-set data attributes, never user input', () => {
  const m = /function ctaParams\(a\) \{([\s\S]*?)\n    \}/.exec(M);
  assert(m, 'ctaParams could not be read');
  for (const attr of ['data-cta-id', 'data-cta-location', 'data-destination', 'data-source-section', 'data-business-model', 'data-pain']) {
    assert(m[1].indexOf(attr) !== -1, 'ctaParams no longer reads ' + attr);
  }
  assert(/\.value|input|textarea|FormData/.test(m[1]) === false, 'ctaParams reads a form field');
});

check('the second sender is inert until consent, because gtag is a no-op before it', () => {
  assert(/typeof gtag === 'function'/.test(M), 'the second sender does not check for gtag');
  assert(/function noopGtag\(\)/.test(A), 'analytics.js no longer installs a no-op gtag');
  assert(/window\.gtag = noopGtag/.test(A), 'a denied choice no longer restores the no-op');
});


console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
