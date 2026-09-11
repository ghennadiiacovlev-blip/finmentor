#!/usr/bin/env node
// FINMENTOR — canonical two-layer privacy notice contract.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-notice.js'));
const PR = require(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-record.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('  FAIL  ' + name + ' -> ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => { if (actual !== expected) throw new Error(message + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'); };
const text = (locale, key) => N.FULL[locale].elements[key].body;
const source = readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-notice.js'), 'utf8');

console.log('Premium UX — canonical layered privacy notice');
console.log('');

check('canonical version is pn-2026-09-11.v1', () => eq(N.NOTICE_VERSION, 'pn-2026-09-11.v1', 'version'));
check('canonical update date is 2026-09-11', () => eq(N.UPDATED_DATE, '2026-09-11', 'date'));
check('new acknowledgement basis is pre_contractual_request', () => eq(N.LEGAL_BASIS, 'pre_contractual_request', 'basis'));
check('controller is exact', () => eq(N.CONTROLLER.controller_full_name, 'Iacovlev Ghennadi', 'controller'));
check('privacy contact is exact', () => eq(N.CONTROLLER.controller_privacy_email, 'cfo@finmentor.md', 'contact'));
check('controller remains a natural person', () => eq(N.CONTROLLER.controller_type, 'natural_person', 'type'));
check('the thirteen full-policy semantics are explicit', () => eq(N.REQUIRED_ELEMENTS.length, 13, 'semantic count'));
check('RU and RO full content is structurally complete', () => assert(N.assertComplete().length === 0, N.assertComplete().join('; ')));
check('full-policy semantics equal the render inventory', () => eq(N.FULL_POLICY_SEMANTICS.join(','), N.REQUIRED_ELEMENTS.join(','), 'inventory'));
check('both Mini App locales have the same compact shape', () => eq(JSON.stringify(Object.keys(N.MINI_APP.ru)), JSON.stringify(Object.keys(N.MINI_APP.ro)), 'shape'));
check('both Mini App layers remain concise', () => { for (const locale of N.LOCALES) assert(N.CONCISE[locale].body.length < 700, locale + ' is not concise'); });
check('both Mini App layers point to full information', () => { assert(/полн/i.test(N.CONCISE.ru.link), 'RU link'); assert(/complet/i.test(N.CONCISE.ro.link), 'RO link'); });
check('RU has one data-minimisation warning', () => eq(N.MINI_APP.ru.lines.filter((line) => /PIN\/CVV/.test(line)).length, 1, 'warning count'));
check('RO has the semantic warning', () => assert(/parole.*PIN\/CVV.*cardurilor/i.test(N.MINI_APP.ro.lines.join(' ')), 'RO warning'));
check('RU AI copy says minimised and pseudonymised', () => assert(/минимизированн.*псевдонимизированн/i.test(text('ru', 'ai_processing')), 'RU AI terms'));
check('RO AI copy says minimised and pseudonymised', () => assert(/minimizat.*pseudonimizat/i.test(text('ro', 'ai_processing')), 'RO AI terms'));
check('direct identifiers are removed before AI', () => { assert(/прямые идентификаторы удаляются/i.test(text('ru', 'ai_processing')), 'RU'); assert(/identificatorii direcți sunt eliminați/i.test(text('ro', 'ai_processing')), 'RO'); });
check('linkable AI data is not called anonymous', () => { assert(/не называются анонимными/i.test(text('ru', 'ai_processing')), 'RU'); assert(/nu sunt descrise ca anonime/i.test(text('ro', 'ai_processing')), 'RO'); });
check('human review before publication is explicit', () => { assert(/проверкой человеком до публикации/i.test(text('ru', 'ai_processing')), 'RU'); assert(/verificată de o persoană înainte de publicarea/i.test(text('ro', 'ai_processing')), 'RO'); });
check('no solely automated significant decision is explicit', () => { assert(/не принимает исключительно автоматизированных решений/i.test(text('ru', 'automated_decisions')), 'RU'); assert(/nu ia decizii bazate exclusiv/i.test(text('ro', 'automated_decisions')), 'RO'); });
check('marketing is not used or bundled in v1', () => { assert(/маркетинг не используется/i.test(text('ru', 'marketing')), 'RU'); assert(/nu se utilizează marketingul/i.test(text('ro', 'marketing')), 'RO'); });
check('purpose-specific bases include request security and analytics', () => { const all = text('ru', 'legal_basis'); assert(/6\(1\)\(b\)/.test(all) && /безопасност/i.test(all) && /согласия/i.test(all), 'RU bases'); });
check('RU rights cover access rectification deletion restriction objection portability', () => { for (const token of ['доступ', 'исправлен', 'удален', 'ограничен', 'возраз', 'переносим']) assert(new RegExp(token, 'i').test(text('ru', 'rights')), token); });
check('RO rights cover access rectification deletion restriction objection portability', () => { for (const token of ['acces', 'rectific', 'șterg', 'restric', 'opune', 'portabil']) assert(new RegExp(token, 'i').test(text('ro', 'rights')), token); });
check('consent withdrawal is conditional', () => { assert(/Если обработка основана на согласии/i.test(text('ru', 'rights')), 'RU'); assert(/Dacă prelucrarea se bazează pe consimțământ/i.test(text('ro', 'rights')), 'RO'); });
check('ordinary one-month response is in RU', () => assert(/один месяц/i.test(text('ru', 'rights')), 'RU month'));
check('ordinary one-month response is in RO', () => assert(/o lună/i.test(text('ro', 'rights')), 'RO month'));
check('complaint route names CNPDCP in both locales', () => { assert(/CNPDCP/.test(text('ru', 'complaint')), 'RU'); assert(/CNPDCP/.test(text('ro', 'complaint')), 'RO'); });
check('retention states 72-hour session expiry', () => { assert(/72 часа/.test(text('ru', 'retention')), 'RU'); assert(/72 de ore/.test(text('ro', 'retention')), 'RO'); });
check('retention states 12 months from meaningful interaction', () => { assert(/12 месяцев.*с последнего содержательного/i.test(text('ru', 'retention')), 'RU'); assert(/12 luni.*ultima interacțiune semnificativă/i.test(text('ro', 'retention')), 'RO'); });
check('active-client retention is not one universal date', () => { assert(/договор.*бухгалтерские.*законом/i.test(text('ru', 'retention')), 'RU'); assert(/contract.*contabile.*legale/i.test(text('ro', 'retention')), 'RO'); });
check('acknowledgement evidence has the internal three-year period', () => { assert(/3 года/i.test(text('ru', 'retention')), 'RU'); assert(/3 ani/i.test(text('ro', 'retention')), 'RO'); });
check('EEA transfer rule is represented', () => { assert(/ЕЭЗ.*специальное разрешение.*не требуется/i.test(text('ru', 'transfers')), 'RU'); assert(/SEE.*nu este necesară o autorizare specială/i.test(text('ro', 'transfers')), 'RO'); });
check('no transfer safeguard is presented as verified without evidence', () => { assert(/Неподтверждённые гарантии не заявляются/i.test(text('ru', 'transfers')), 'RU'); assert(/Nu sunt declarate garanții neverificate/i.test(text('ro', 'transfers')), 'RO'); });
check('processor disclosure uses categories, not selected vendor names', () => eq(N.assertNoVendorNames().length, 0, 'vendors'));
check('successful render substitutes identity and exposes canonical version', () => { const r = N.render('ru', N.CONTROLLER); assert(r.ok, JSON.stringify(r)); eq(r.notice.version, N.NOTICE_VERSION, 'render version'); assert(JSON.stringify(r.notice).includes('Iacovlev Ghennadi'), 'identity'); });
check('successful render leaves no placeholder', () => assert(!/OWNER_INPUT_REQUIRED|\{\{/.test(JSON.stringify(N.render('ro', N.CONTROLLER).notice)), 'placeholder'));
check('unknown locale is rejected', () => eq(N.render('en', N.CONTROLLER).error_code, 'BAD_LOCALE', 'locale'));
check('placeholder controller is rejected', () => eq(N.render('ru', N.CONTROLLER_TEMPLATE).error_code, 'CONTROLLER_IDENTITY_REQUIRED', 'controller'));
check('new-path source contains no pending legal-review sentinel', () => assert(!/PENDING_LEGAL_REVIEW/.test(source + readFileSync(join(ROOT, 'n8n', 'src', 'premium-ux', 'privacy-record.js'), 'utf8')), 'pending sentinel'));

console.log('');
if (failures.length) {
  console.log('FAILURES (' + failures.length + '):');
  failures.forEach((failure) => console.log('  - ' + failure));
  console.log('ASSERTIONS: ' + pass + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + pass + ' passed');
