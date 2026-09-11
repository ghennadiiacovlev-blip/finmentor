#!/usr/bin/env node
// FINMENTOR — the published Privacy Policy carries the controller identity the owner supplied,
// and nothing it cannot support.
//
//   node qa/privacy-policy-release.test.mjs
//
// Offline. No tenant, no network, no browser.
//
// WHY THIS GATE EXISTS. The policy pages are the only customer-facing documents that name a legal
// person. Everything about them is easy to get wrong in a way no other test would notice: a
// controller name drifting back to the brand, an invented company form appearing "for completeness",
// a retention deadline stated without an operating review, or one legal basis being stretched over
// unrelated purposes. Each of those is a false statement in a legal document, and each would
// otherwise ship silently.
//
// The two facts this gate is strictest about, because they were both real defects:
//
//   1. The controller was published as «Геннадий Яковлев (FINMENTOR)» / «Ghennadi Iacovlev
//      (FINMENTOR)», which conflates the brand with the legal person. FINMENTOR is the product; the
//      controller is a natural person, named exactly as the owner supplied it and no further.
//
//   2. Retention said data is kept "as long as necessary, then deleted" with no period and no
//      mechanism. The owner has now set 12 months for an unconverted lead and a monthly due-list
//      review, while the separately controlled execution-retention deployment remains unauthorised.

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

const CONTROLLER = 'Iacovlev Ghennadi';
const PRIVACY_EMAIL = 'cfo@finmentor.md';

const POLICIES = [
  {
    file: 'privacy.html', lang: 'RU',
    controller: /Оператор персональных данных: <strong>Iacovlev Ghennadi<\/strong>/,
    contact: /Запросы о персональных данных/,
    brand: /FINMENTOR — название проекта, а не отдельное юридическое лицо/,
    period: /12 месяцев с последнего содержательного взаимодействия/,
    contractual: /Активный\/преобразованный клиент/,
    whoDeletes: /ежемесячная due-list проверка, затем удаление/,
    notAutomated: /еженедельной проверке владельцем/,
    basis: /ст\. 6\(1\)\(b\)/,
    pending: /pre_contractual_request/,
    notCounsel: /действия по инициативе субъекта до заключения договора/,
    separateConsent: /Google Analytics 4:<\/strong> только ваше согласие/,
    humanReview: /проверяется человеком до публикации клиенту/,
    supabase: /AI-поставщик/,
    expiry: /доступ логически истекает через 72 часа/
  },
  {
    file: 'ro/privacy.html', lang: 'RO',
    controller: /Operatorul de date cu caracter personal este <strong>Iacovlev Ghennadi<\/strong>/,
    contact: /Solicitări privind datele personale/,
    brand: /FINMENTOR este denumirea proiectului, nu o persoană juridică separată/,
    period: /12 luni de la ultima interacțiune semnificativă/,
    contractual: /Client activ\/convertit/,
    whoDeletes: /verificare lunară a listei scadente, apoi ștergerea/,
    notAutomated: /verificarea săptămânală a responsabilului/,
    basis: /art\. 6 alin\. \(1\) lit\. b\)/,
    pending: /pre_contractual_request/,
    notCounsel: /demersuri la inițiativa persoanei vizate înainte de încheierea contractului/,
    separateConsent: /Google Analytics 4:<\/strong> numai consimțământul/,
    humanReview: /verificat de o persoană înainte de publicarea către client/,
    supabase: /furnizorul AI/,
    expiry: /accesul expiră logic după 72 de ore/
  }
];

for (const p of POLICIES) {
  const html = read(p.file);

  check(p.lang + ': the controller is named exactly as the owner supplied it', () => {
    assert(p.controller.test(html), 'the controller line is missing or altered');
    assert(html.indexOf(CONTROLLER) !== -1, 'the supplied name does not appear');
  });

  check(p.lang + ': the old brand-as-controller wording is gone', () => {
    assert(!/Оператор данных — Геннадий Яковлев \(FINMENTOR\)/.test(html), 'RU old controller line survives');
    assert(!/Operatorul de date — Ghennadi Iacovlev \(FINMENTOR\)/.test(html), 'RO old controller line survives');
  });

  check(p.lang + ': FINMENTOR is described as product and brand, not as the controller', () => {
    assert(p.brand.test(html), 'the brand/controller distinction is missing');
  });

  check(p.lang + ': the privacy contact address is present and reachable', () => {
    assert(p.contact.test(html), 'the privacy contact line is missing');
    assert(html.indexOf('mailto:' + PRIVACY_EMAIL) !== -1, 'no mailto link for the privacy contact');
  });

  check(p.lang + ': no company form, registration number, VAT or street address was invented', () => {
    for (const invented of ['SRL', 'S.R.L.', 'IDNO', 'IDNP', 'TVA', 'VAT', 'НДС', 'ИНН']) {
      assert(html.indexOf(invented) === -1, 'invented legal detail present: ' + invented);
    }
  });

  check(p.lang + ': retention states the owner-decided 12-month period for an unconverted lead', () => {
    assert(p.period.test(html), 'the 12-month period is missing');
  });

  check(p.lang + ': contractual, accounting and legal periods are carved out, not replaced', () => {
    assert(p.contractual.test(html), 'contractual retention is not carved out');
  });

  check(p.lang + ': deletion periods are paired with owner-run review controls', () => {
    assert(p.whoDeletes.test(html), 'the monthly due-list control is missing');
    assert(p.notAutomated.test(html), 'the weekly owner/responsible-person review is missing');
    assert(!/удаляется автоматически|se șterge automat/.test(html), 'the page invents automatic deletion');
  });

  check(p.lang + ': the 72-hour rule is described as expiry, not as automatic deletion', () => {
    assert(p.expiry.test(html), 'the 72-hour expiry is missing');
    assert(!/удаляется автоматически через 72|se șterge automat după 72/.test(html), 'claims automatic deletion at 72h');
  });

  check(p.lang + ': the customer-request basis is purpose-specific and matches the stored enum', () => {
    assert(p.basis.test(html), 'the statutory basis is not cited');
    assert(p.pending.test(html), 'the stored purpose-specific enum is missing');
    assert(p.notCounsel.test(html), 'the pre-contractual substance is missing');
    assert(!/PENDING_LEGAL_REVIEW/.test(html), 'the retired pending sentinel is public');
  });

  check(p.lang + ': optional purposes stay on separate, withdrawable consent', () => {
    assert(p.separateConsent.test(html), 'analytics and optional marketing are not carved onto consent');
  });

  check(p.lang + ': AI, human review and the processor category are present', () => {
    assert(p.humanReview.test(html), 'the human-review sentence is missing');
    assert(p.supabase.test(html), 'the processor sentence is missing');
    // GATE 3: RU names it Financial X-Ray; RO now names it by the canonical Romanian product
        // name, which superseded the retired one.
        assert(/Financial X-Ray|Test(ul|ului)? financiar FINMENTOR/.test(html), 'the analysis is not named');
  });

  check(p.lang + ': the page makes no absolute security or compliance guarantee', () => {
    for (const claim of ['100% secure', '100% безопас', 'military-grade', 'полностью соответствует GDPR', 'garantăm securitatea']) {
      assert(html.toLowerCase().indexOf(claim.toLowerCase()) === -1, 'unsupported claim: ' + claim);
    }
  });
}

check('both languages name the same controller and the same contact address', () => {
  const ru = read('privacy.html');
  const ro = read('ro/privacy.html');
  for (const html of [ru, ro]) {
    assert(html.indexOf(CONTROLLER) !== -1, 'controller missing in one language');
    assert(html.indexOf(PRIVACY_EMAIL) !== -1, 'privacy contact missing in one language');
  }
});

check('the controller appears exactly once as the controller declaration in each language', () => {
  const ru = read('privacy.html').match(/Оператор персональных данных: <strong>Iacovlev Ghennadi<\/strong>/g) || [];
  const ro = read('ro/privacy.html').match(/Operatorul de date cu caracter personal este <strong>Iacovlev Ghennadi<\/strong>/g) || [];
  assert(ru.length === 1, 'RU declares the controller ' + ru.length + ' times');
  assert(ro.length === 1, 'RO declares the controller ' + ro.length + ' times');
});


// ── GATE 3: the Romanian journey must not offer a route into a Russian-only conversation ──────
//
// Every Romanian page carries CTAs to the public Telegram contact, whose non-owner branch answers
// in Russian. Three of them on the landing page were pure duplicates: ghost buttons reading
// «Mai simplu: scrieți direct → FINMENTOR Bot» sitting immediately beside the primary
// «Începeți Testul financiar FINMENTOR» button, so they added no route the reader did not already
// have. Those three are removed. The rest stay, because they are the contact and fallback routes
// the approved privacy policy names, and a Romanian first-contact branch in the Concierge now
// answers them in Romanian.

const RO_PAGES = ['ro/index.html', 'ro/questionnaire.html', 'ro/thank-you.html'];

check('the three duplicate landing CTAs are gone', () => {
  const h = read('ro/index.html');
  assert(h.indexOf('Mai simplu: scrieți direct') === -1, 'a duplicate ghost CTA survives');
  const ghosts = (h.match(/btn--ghost[^>]*t\.me\/finmentor_md_bot/g) || []).length;
  assert(ghosts === 0, ghosts + ' ghost Telegram buttons remain on the landing page');
});

check('Telegram was not removed globally — the contact and fallback routes remain', () => {
  const h = read('ro/index.html');
  const left = (h.match(/t\.me\/finmentor_md_bot/g) || []).length;
  assert(left === 6, 'expected the 6 contact/fallback links to remain, found ' + left);
});

check('every affected RO page still offers a working customer route', () => {
  for (const f of RO_PAGES) {
    const h = read(f);
    const hasForm = /questionnaire\.html/.test(h);
    const hasMail = /mailto:cfo@finmentor\.md/.test(h);
    assert(hasForm || hasMail, f + ' has no questionnaire and no email route');
  }
});

check('the landing page keeps its primary Romanian diagnostic CTA', () => {
  const h = read('ro/index.html');
  const primary = (h.match(/Începeți Testul financiar FINMENTOR/g) || []).length;
  assert(primary >= 3, 'the primary RO CTA count fell to ' + primary);
});

check('the RU pages were not touched by the Romanian CTA cleanup', () => {
  const ru = read('index.html');
  assert(/t\.me\/finmentor_md_bot/.test(ru), 'the RU landing lost its Telegram links');
  assert(ru.indexOf('Mai simplu') === -1, 'Romanian copy leaked into the RU page');
});

check('the RO privacy page carries the canonical product name and no superseded one', () => {
  const h = read('ro/privacy.html');
  assert(h.indexOf('Financial X-Ray') !== -1, 'the canonical name is missing from the AI paragraph');
  assert(h.indexOf('Testul de sănătate') === -1, 'a superseded product name survives');
  assert(!/Radiografi[ae]i? Financiar/.test(h), 'a superseded product name survives');
});

check('the Gate 1 legal meaning survived the terminology fix', () => {
  const h = read('ro/privacy.html');
  assert(/art\. 6 alin\. \(1\) lit\. b\)/.test(h), 'the legal basis citation was lost');
  assert(/pre_contractual_request/.test(h), 'the purpose-specific enum was lost');
  assert(/Iacovlev Ghennadi/.test(h), 'the controller was lost');
  assert(/12 luni de la ultima interacțiune semnificativă/.test(h), 'the retention period was lost');
});


console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) { process.exit(1); }
