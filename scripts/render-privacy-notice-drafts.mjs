#!/usr/bin/env node
// FINMENTOR — render the RU and RO privacy notice DRAFTS for owner/legal review.
//
//   node scripts/render-privacy-notice-drafts.mjs
//
// REPO-ONLY. Writes docs/legal/DRAFT_RU_PRIVACY_NOTICE.md and DRAFT_RO_PRIVACY_NOTICE.md.
// It does not touch privacy.html, ro/privacy.html, or anything customer-facing.
//
// WHY THE DRAFTS ARE GENERATED AND NOT WRITTEN BY HAND. The notice text lives in
// n8n/src/premium-ux/privacy-notice.js, which is gated by qa/premium-ux-privacy-notice.test.mjs.
// If the review copy were typed separately it would drift from the copy the product renders, and
// the thing legal signed off would not be the thing customers see.
//
// THE CONTROLLER IDENTITY IS FILLED FROM WHAT THE REPOSITORY ALREADY PUBLISHES, and is marked in
// the output as REQUIRING OWNER CONFIRMATION. Owner decision D6 said `OWNER_INPUT_REQUIRED`; the
// read-only search then found that privacy.html has published a real natural-person controller all
// along. Neither fact cancels the other: the value is used here so legal can review a complete
// document, and it is flagged on every page so it cannot be mistaken for a confirmed decision.
//
// Nothing here claims legal approval. Both files carry DRAFT — NOT LEGALLY APPROVED at the top.

import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT_DIR = join(ROOT, 'docs', 'legal');

const N = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-notice.js'));

// Sourced from privacy.html:97 and the index.html JSON-LD. NOT a decision — an input awaiting one.
const FOUND = {
  controller_type: 'natural_person',
  controller_full_name: 'Геннадий Яковлев / Ghennadi Iacovlev',
  controller_privacy_email: 'cfo@finmentor.md'
};

const BANNER = {
  ru: [
    '> # DRAFT — NOT LEGALLY APPROVED',
    '>',
    '> Проект для проверки владельцем и юристом. Не публиковать. Не использовать в продукте',
    '> до подписания.',
    '>',
    '> **Личность оператора требует подтверждения владельца.** Имя и контакт ниже взяты из уже',
    '> опубликованного `privacy.html`, а не подтверждены отдельно для Premium UX.',
    '>',
    '> **Почтовый / домашний адрес не указан. Требуется юридическая оценка**, обязан ли оператор —',
    '> физическое лицо — публиковать адрес, и какой именно.',
    '>',
    '> **Правовое основание не подтверждено.** Действующая публичная политика называет основанием',
    '> согласие; настоящий проект описывает действия по запросу субъекта до заключения договора.',
    '> Это расхождение должен разрешить юрист.'
  ],
  ro: [
    '> # DRAFT — NOT LEGALLY APPROVED',
    '>',
    '> Proiect pentru verificarea de către proprietar și jurist. A nu se publica. A nu se folosi în',
    '> produs până la semnare.',
    '>',
    '> **Identitatea operatorului necesită confirmarea proprietarului.** Numele și contactul de mai',
    '> jos provin din `privacy.html` deja publicat, nu au fost confirmate separat pentru Premium UX.',
    '>',
    '> **Adresa poștală / de domiciliu nu este indicată. Este necesară o evaluare juridică** privind',
    '> obligația unui operator persoană fizică de a publica o adresă și care anume.',
    '>',
    '> **Temeiul juridic nu este confirmat.** Politica publică în vigoare invocă consimțământul;',
    '> prezentul proiect descrie demersuri la cererea persoanei vizate înainte de contract.',
    '> Discrepanța trebuie soluționată de jurist.'
  ]
};

const LABEL = {
  ru: { version: 'Версия проекта', layer1: 'Слой 1 — краткое уведомление на первом экране сбора данных',
        layer2: 'Слой 2 — полное уведомление', ack: 'Подтверждение при отправке',
        source: 'Источник', note: 'Служебное' },
  ro: { version: 'Versiunea proiectului', layer1: 'Nivelul 1 — informare succintă pe primul ecran de colectare',
        layer2: 'Nivelul 2 — informarea completă', ack: 'Confirmarea la transmitere',
        source: 'Sursa', note: 'Intern' }
};

mkdirSync(OUT_DIR, { recursive: true });

const written = [];
for (const locale of N.LOCALES) {
  const r = N.render(locale, FOUND);
  if (!r.ok) {
    console.error('REFUSING: the notice would not render for ' + locale + ': ' + JSON.stringify(r));
    process.exit(1);
  }
  const n = r.notice;
  const L = LABEL[locale];
  const lines = [];

  lines.push(...BANNER[locale]);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('# ' + n.full.title);
  lines.push('');
  lines.push('**' + L.version + ':** `' + n.version + '`  ');
  lines.push('**' + L.source + ':** `n8n/src/premium-ux/privacy-notice.js` — сгенерировано, не редактировать вручную.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ' + L.layer1);
  lines.push('');
  lines.push('**' + n.concise.heading + '**');
  lines.push('');
  lines.push(n.concise.body);
  lines.push('');
  lines.push('[' + n.concise.link + ' →]');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## ' + L.layer2);
  lines.push('');
  lines.push('_' + n.full.intro + '_');
  lines.push('');
  let i = 0;
  for (const s of n.full.sections) {
    i += 1;
    lines.push('### ' + i + '. ' + s.heading);
    lines.push('');
    lines.push(s.body);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## ' + L.ack);
  lines.push('');
  lines.push('☐ ' + n.acknowledgement);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### ' + L.note);
  lines.push('');
  lines.push('- `privacy_legal_basis` = `PENDING_LEGAL_REVIEW` — кандидат `pre_contractual_request`');
  lines.push('  не активирован и клиенту не показывается.');
  lines.push('- Записывается одна неизменяемая строка при отправке: версия уведомления, локаль,');
  lines.push('  время показа и время подтверждения. UPDATE отсутствует на уровне прав СУБД.');
  lines.push('- Уведомление не содержит утверждений о защите, которые невозможно подтвердить.');
  lines.push('');

  const path = join(OUT_DIR, 'DRAFT_' + locale.toUpperCase() + '_PRIVACY_NOTICE.md');
  writeFileSync(path, lines.join('\n'), 'utf8');
  written.push({ locale, path, sections: n.full.sections.length });
}

console.log('');
console.log('Privacy notice drafts');
for (const w of written) {
  console.log('  ' + w.locale.toUpperCase() + '  docs/legal/DRAFT_' + w.locale.toUpperCase() + '_PRIVACY_NOTICE.md   ' + w.sections + ' sections');
}
console.log('');
console.log('  marked   : DRAFT — NOT LEGALLY APPROVED');
console.log('  controller: filled from privacy.html, flagged as REQUIRING OWNER CONFIRMATION');
console.log('  address  : absent; flagged LEGAL REVIEW REQUIRED');
console.log('  customer-facing privacy.html: NOT MODIFIED');
console.log('');
