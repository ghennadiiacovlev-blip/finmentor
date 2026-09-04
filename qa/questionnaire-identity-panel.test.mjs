#!/usr/bin/env node
// FINMENTOR — the required identity fields are editable where they are reported missing.
//
//   node qa/questionnaire-identity-panel.test.mjs
//
// Offline and static, like the rest of the canonical suite: it reads questionnaire.html and
// ro/questionnaire.html and holds the structure of the fix. The BEHAVIOUR (ten owner scenarios,
// including a real submit) is proven in a headless browser by the targeted run recorded in
// docs/FINDING_XRAY_IDENTITY_FIELDS_UNREACHABLE.md — a browser cannot run inside this suite,
// which is offline by contract.
//
// THE DEFECT. `q_name`, `q_company`, `q_email`, `q_telegram` are the canonical identity inputs
// Lead Intake reads, and they sit inside `<section id="extendedIntake" hidden>`, which only the
// quick diagnostic's «continue» button opens. A visitor who scrolled past the diagnostic was told
// those three were missing and had nowhere to type them: the chips scrolled into a collapsed
// section. The form could not be completed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { failures.push(name + ': ' + e.message); console.log('  FAIL  ' + name + ' -> ' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const PAGES = [
  { file: 'questionnaire.html', label: 'RU', head: 'Контактные данные', name: 'Имя', company: 'Компания', contact: 'Контакт', placeholder: 'Email или @Telegram', errors: ['Укажите имя', 'Укажите компанию', 'Укажите email или @Telegram', 'Проверьте формат: email или @Telegram'] },
  { file: 'ro/questionnaire.html', label: 'RO', head: 'Date de contact', name: 'Nume', company: 'Companie', contact: 'Contact', placeholder: 'Email sau @Telegram', errors: ['Indicați numele', 'Indicați compania', 'Indicați email sau @Telegram', 'Verificați formatul: email sau @Telegram'] }
];

console.log('\nFINMENTOR — X-Ray questionnaire: required identity is editable where it is missing\n');

for (const p of PAGES) {
  const src = read(p.file);

  check(p.label + ': the canonical identity inputs are still the only ones, and still in the intake block', () => {
    for (const n of ['q_name', 'q_company', 'q_email', 'q_telegram']) {
      const hits = (src.match(new RegExp('name="' + n + '"', 'g')) || []).length;
      assert(hits === 1, n + ' appears ' + hits + ' times — a second source of truth');
    }
    assert(/id="extendedIntake" hidden/.test(src), 'the intake block is no longer the collapsed one this fix is about');
  });

  check(p.label + ': the notice carries three real inputs, not only chips', () => {
    assert(/id="qValidateFields"/.test(src), 'the identity panel is missing');
    for (const id of ['qvfName', 'qvfCompany', 'qvfContact']) { assert(src.includes('id="' + id + '"'), 'missing input ' + id); }
    const panel = /<div class="q-validate__fields"[\s\S]*?<\/div><ul class="q-validate__list"/.exec(src);
    assert(panel, 'the panel is not inside the notice, above the chip list');
    assert((panel[0].match(/<input /g) || []).length === 3, 'the panel holds ' + (panel[0].match(/<input /g) || []).length + ' inputs, expected 3');
  });

  check(p.label + ': the panel inputs can never reach the payload (no name attribute)', () => {
    const panel = /<div class="q-validate__fields"[\s\S]*?<\/div><ul/.exec(src)[0];
    assert(!/<input[^>]*\sname=/.test(panel), 'a panel input carries a name attribute');
    // the collector reads named fields explicitly; nothing else is serialised
    assert(/textVal\('q_name'\)/.test(src) && /textVal\('q_company'\)/.test(src), 'the payload no longer reads the canonical inputs');
  });

  check(p.label + ': all three are labelled required, with the contact placeholder the owner approved', () => {
    for (const l of [p.name, p.company, p.contact]) { assert(src.includes('>' + l + ' <span class="q-vf__req">*</span>'), 'no required mark on ' + l); }
    assert(src.includes('placeholder="' + p.placeholder + '"'), 'contact placeholder is not ' + p.placeholder);
    assert(src.includes(p.head), 'the panel has no heading');
  });

  check(p.label + ': every keystroke writes through to the canonical input', () => {
    assert(/vfWrite\(pair\[1\], pair\[0\]\.value\)/.test(src), 'name/company do not write through');
    assert(/function vfApplyContact/.test(src) && /vfWrite\('q_email', v\)/.test(src) && /vfWrite\('q_telegram', normalizeTelegram\(v\) \|\| v\)/.test(src), 'contact does not write through to the canonical fields');
    assert(/vfOwned\.email/.test(src) && /vfOwned\.telegram/.test(src), 'the panel can clear a value it did not write');
  });

  check(p.label + ': eligibility and the notice recompute immediately', () => {
    assert(/function vfRecheck/.test(src) && /quietMissing\(\)/.test(src), 'no live recheck');
    assert(/if \(miss\.length === 0\) hideSummary\(\); else showSummary\(miss\);/.test(src), 'the notice does not clear when nothing is missing');
    assert(/function hideSummary\(\)\s*\{[\s\S]*?vfBox\.hidden = true;/.test(src), 'the panel outlives the notice');
  });

  check(p.label + ': a required field in a collapsed block is opened, not silently scrolled to', () => {
    assert(/function revealBlock/.test(src) && /closest\('\.q-block\[hidden\]'\)/.test(src), 'no reveal for collapsed blocks');
    assert(/revealBlock\(target\);\s*\n\s*target\.scrollIntoView/.test(src), 'scrollToSpec does not reveal before scrolling');
  });

  check(p.label + ': pressing submit with a missing field focuses that field', () => {
    assert(/var inline = vfInputOf\(spec\);/.test(src), 'scrollToSpec does not prefer the panel control');
    assert(/inline\.focus\(\{ preventScroll: true \}\)/.test(src), 'the panel control is not focused');
    assert(/scrollToSpec\(missing\[0\]\)/.test(src), 'submit no longer jumps to the first missing field');
  });

  check(p.label + ': identity is a field here, never also a chip', () => {
    assert(/if \(IDENTITY_KEY\[spec\.key\]\) return;/.test(src), 'identity is still rendered as a chip too');
  });

  check(p.label + ': the required errors are visible and specific', () => {
    for (const m of p.errors) { assert(src.includes(m), 'missing error copy: ' + m); }
    assert(/\.q-vf\.is-error \.q-vf__err \{ display: block; \}/.test(src), 'error text is never shown');
    assert(/aria-invalid/.test(src), 'no accessible invalid state');
  });

  check(p.label + ': mobile-first — one column, a second only when there is room', () => {
    assert(/\.q-validate__fields \{ display: grid; grid-template-columns: 1fr;/.test(src), 'the panel is not single-column by default');
    assert(/@media \(min-width: 560px\) \{ \.q-validate__fields \{ grid-template-columns: 1fr 1fr; \}/.test(src), 'no wider layout');
    assert(/\.q-vf input \{[^}]*width: 100%/.test(src), 'inputs do not fill the column');
  });

  check(p.label + ': the panel is visually a form, not a status chip', () => {
    assert(/\.q-validate__fields \{[^}]*border: 1px solid var\(--glass-border-gold\)/.test(src), 'no border separating fields from chips');
    assert(/\.q-vf input:focus \{ outline: none; border-color: var\(--accent\); \}/.test(src), 'focus does not follow the design system');
    assert(!/#[0-9a-fA-F]{6}/.test(/\.q-validate__fields[\s\S]*?@media \(min-width: 560px\)[^}]*\}/.exec(src)[0].replace(/rgba\([^)]*\)/g, '')), 'a raw hex colour was introduced');
  });

  check(p.label + ': submit is never silently disabled', () => {
    assert(!/submitBtn\.disabled = true;/.test(src.replace(/function setSubmitting[\s\S]*?\n  \}/, '')), 'the button is disabled outside the in-flight lock');
  });
}

check('RO panel copy carries no Cyrillic (the RO page gate)', () => {
  const ro = read('ro/questionnaire.html');
  const panel = /<div class="q-validate__fields"[\s\S]*?<\/div><ul/.exec(ro)[0];
  assert(!/[Ѐ-ӿ]/.test(panel), 'Cyrillic in the RO panel markup');
  for (const lit of ["'Indicați numele'", "'Indicați compania'", "'Indicați email sau @Telegram'"]) { assert(ro.includes(lit), 'missing RO error literal ' + lit); }
  assert(!/'Укажите имя'/.test(ro), 'Russian error copy leaked into the RO page');
});

console.log('\nASSERTIONS: ' + pass + ' passed' + (failures.length ? ', ' + failures.length + ' failed' : ''));
if (failures.length) { console.log(failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
