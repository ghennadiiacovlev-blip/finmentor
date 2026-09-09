#!/usr/bin/env node
// FINMENTOR — deterministic source contract for the final editorial + legal release.
// Rendered overflow, clipping, navigation fit and CTA wrapping remain browser-grade checks in
// qa/visual-evidence.mjs; this gate locks the shared structures and the factual copy correction.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const css = read('style.css');
const ruMaterials = read('materials.html');
const roMaterials = read('ro/materials.html');
const ruShelf = read('supplier-shelf-credit.html');
const roShelf = read('ro/supplier-shelf-credit.html');
const ruHome = read('index.html');
const roHome = read('ro/index.html');

const ARTICLE_SLUGS = [
  'ai-dlya-cfo.html',
  'capacity-released.html',
  'cash-flow.html',
  'fcf-postavshiki.html',
  'kaznacheystvo.html',
  'margin-factor-analysis-flags.html',
  'methodology.html',
  'platezhnyy-kalendar.html',
  'power-bi-dlya-sobstvennika.html',
  'pribyl-vs-cash.html',
  'renewal-revenue-at-risk.html',
  'supplier-rating-purchasing-priorities.html',
  'supplier-shelf-credit.html',
  'treasury-waterfall.html',
  'upravlencheskiy-pl.html',
  'working-capital.html'
];
const LEGAL = ['privacy.html', 'terms.html', 'ro/privacy.html', 'ro/terms.html'];

let pass = 0;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function check(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('FAIL ' + name + ' — ' + error.message); }
}
const count = (text, re) => (text.match(re) || []).length;
const hrefs = (html) => [...html.matchAll(/<a class="kb-item" href="([^"]+\.html)"/g)].map((m) => m[1]);
const capitalSection = (html) => {
  const start = html.indexOf('<section class="sec capital-logic');
  const end = html.indexOf('<section class="audience', start);
  assert(start >= 0 && end > start, 'Capital Management section boundaries missing');
  return html.slice(start, end);
};

function machineSignature(html) {
  const form = html.match(/<form\b[\s\S]*?<\/form>/i);
  assert(form, 'questionnaire form missing');
  const controls = [...form[0].matchAll(/<(?:form|input|select|textarea|button)\b[^>]*>/gi)]
    .map((m) => m[0].replace(/\s+/g, ' ').trim());
  return [controls.length, createHash('sha256').update(controls.join('\n')).digest('hex')];
}

check('Materials inventory keeps every approved public destination in RU and RO', () => {
  for (const slug of ARTICLE_SLUGS) {
    assert(hrefs(ruMaterials).includes(slug), 'RU Materials lost ' + slug);
    assert(hrefs(roMaterials).includes(slug), 'RO Materials lost ' + slug);
  }
});

check('all public long-form materials opt into one article system in both languages', () => {
  for (const slug of ARTICLE_SLUGS) {
    for (const file of [slug, 'ro/' + slug]) {
      assert(/<body class="[^"]*article-page/.test(read(file)), file + ' lacks article-page');
    }
  }
});

check('the shared article body uses a controlled 70ch reading measure', () => {
  assert(/\.article-page \.doc\s*\{[^}]*max-width:\s*70ch[^}]*margin-inline:\s*auto/s.test(css), 'article measure is not 70ch and centred');
});

check('the priority shelf article exposes five editorial decision stages in RU and RO', () => {
  assert(count(ruShelf, /data-editorial-step=/g) === 5, 'RU does not have five stages');
  assert(count(roShelf, /data-editorial-step=/g) === 5, 'RO does not have five stages');
  assert(ruShelf.includes('03 · Финансовый механизм') && ruShelf.includes('05 · Решение'), 'RU stage logic missing');
  assert(roShelf.includes('03 · Mecanismul financiar') && roShelf.includes('05 · Decizia'), 'RO stage logic missing');
});

check('the priority article preserves its five owner-approved financial headings', () => {
  for (const heading of ['Почему проблема существует', 'Что обычно видит менеджмент', 'Что происходит финансово', 'Управленческая логика FINMENTOR', 'Управленческий вывод']) {
    assert(ruShelf.includes('<h2>' + heading + '</h2>'), 'RU heading missing: ' + heading);
  }
  for (const heading of ['De ce există problema', 'Ce vede de obicei managementul', 'Ce se întâmplă financiar', 'Logica managerială FINMENTOR', 'Concluzia managerială']) {
    assert(roShelf.includes('<h2>' + heading + '</h2>'), 'RO heading missing: ' + heading);
  }
});

check('financial mechanism and management conclusion receive restrained semantic treatments', () => {
  for (const html of [ruShelf, roShelf]) {
    assert(html.includes('article-section--financial'), 'financial mechanism class missing');
    assert(html.includes('article-conclusion'), 'management conclusion class missing');
  }
  assert(/\.article-conclusion\s*\{[^}]*border-top:\s*1px solid var\(--gold-500\)/s.test(css), 'conclusion hairline missing');
});

check('the priority article closes with one contextual assessment action per language', () => {
  for (const [name, html, label] of [
    ['RU', ruShelf, 'Передать ситуацию на финансовую оценку'],
    ['RO', roShelf, 'Trimiteți situația pentru evaluare financiară']
  ]) {
    const band = html.slice(html.lastIndexOf('<section class="cta-band'), html.lastIndexOf('</section>') + 10);
    assert(count(band, /<a\b/g) === 1, name + ' final CTA has competing links');
    assert(band.includes(label), name + ' contextual CTA wording missing');
  }
});

check('article lead and author/source strip have a reusable editorial hierarchy', () => {
  assert(/\.article-page \.doc-hero__lead\s*\{[^}]*max-width:\s*64ch[^}]*line-height:\s*1\.72/s.test(css), 'lead treatment missing');
  assert(/\.article-page \.doc-hero__context,[\s\S]*?border-top:\s*1px solid var\(--glass-border-gold\)/s.test(css), 'source strip hairline missing');
});

check('public article headings remain semantically valid and scan-worthy', () => {
  for (const slug of ARTICLE_SLUGS) {
    for (const file of [slug, 'ro/' + slug]) {
      const html = read(file);
      assert(count(html, /<h1\b/g) === 1, file + ' must have one H1');
      assert(count(html, /<h2\b/g) >= 2, file + ' has no usable H2 hierarchy');
      const firstH2 = html.search(/<h2\b/), firstH3 = html.search(/<h3\b/);
      assert(firstH3 === -1 || firstH2 < firstH3, file + ' starts with H3 before H2');
    }
  }
});

check('article canonical and RU/RO alternate metadata survive the presentation pass', () => {
  for (const slug of ARTICLE_SLUGS) {
    const ru = read(slug), ro = read('ro/' + slug);
    assert(ru.includes('rel="canonical"') && ro.includes('rel="canonical"'), slug + ' canonical missing');
    assert(ru.includes('hreflang="ru"') && ru.includes('hreflang="ro"'), slug + ' RU alternates missing');
    assert(ro.includes('hreflang="ru"') && ro.includes('hreflang="ro"'), slug + ' RO alternates missing');
  }
});

check('Materials RU/RO use shared CSS without page-local design drift', () => {
  for (const [file, html] of [['materials.html', ruMaterials], ['ro/materials.html', roMaterials]]) {
    assert(html.includes('<body class="materials-page">'), file + ' body marker missing');
    assert(!/<style>[\s\S]*?\.materials-nav/.test(html), file + ' still duplicates Materials CSS');
  }
});

check('Materials cards read as an editorial three-column system with a two-column feature lead', () => {
  assert(/\.materials-list\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s.test(css), 'journal grid missing');
  assert(/#featured \.materials-list\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s.test(css), 'featured grid missing');
  assert(/\.kb-item__title\s*\{[^}]*font-family:\s*var\(--font-display\)/s.test(css), 'editorial card titles missing');
});

check('inner-page navigation uses calm desktop spacing and the approved drawer below 920px', () => {
  assert(/\.doc-bar__nav\s*\{[^}]*gap:\s*clamp\(12px,\s*1\.5vw,\s*22px\)[^}]*white-space:\s*nowrap/s.test(css), 'desktop nav rhythm missing');
  const lock = css.slice(css.lastIndexOf('/* v16 cascade lock'));
  assert(/@media \(max-width:\s*920px\)[\s\S]*?\.doc-bar nav\s*\{\s*display:\s*none/.test(lock), 'drawer breakpoint missing');
  assert(/\.doc-bar \.burger\s*\{\s*display:\s*block/.test(lock), 'approved burger is not activated');
});

check('RU and RO Materials navigation retain the required hierarchy and language switch', () => {
  for (const text of ['На главную', 'Материалы', 'Финансовый рентген', 'Обсудить задачу']) assert(ruMaterials.includes(text), 'RU nav lost ' + text);
  for (const text of ['Pagina principală', 'Materiale', 'Test financiar FINMENTOR', 'Discutați situația']) assert(roMaterials.includes(text), 'RO nav lost ' + text);
  assert(count(ruMaterials, /data-lang-switch=/g) === 2 && count(roMaterials, /data-lang-switch=/g) === 2, 'language switch parity lost');
});

check('all four legal pages use the shared FINMENTOR legal design system', () => {
  for (const file of LEGAL) {
    const html = read(file);
    assert(html.includes('<body class="legal-page">'), file + ' body marker missing');
    assert(html.includes('<header class="legal-bar">') && html.includes('legal-bar__row'), file + ' shared header missing');
    assert(!/<style>[\s\S]*?\.legal/.test(html), file + ' still carries inline legal CSS');
  }
});

check('legal document headers retain one H1, updated date and restrained jurisdiction eyebrow', () => {
  for (const file of LEGAL) {
    const html = read(file);
    assert(count(html, /<h1\b/g) === 1, file + ' must have one H1');
    assert(count(html, /class="legal__updated"/g) === 1, file + ' updated date missing');
    assert(count(html, /class="legal__eyebrow"/g) === 1, file + ' legal eyebrow missing');
    assert(count(html, /<h2\b/g) >= 9, file + ' section hierarchy incomplete');
  }
});

check('legal RU/RO switch and calm home navigation are reciprocal', () => {
  for (const file of LEGAL) {
    const html = read(file);
    assert(count(html, /data-lang-switch=/g) === 2, file + ' language controls incomplete');
    assert(/class="legal-back" href="index\.html"/.test(html), file + ' home link missing');
  }
  assert(read('privacy.html').includes('href="ro/privacy.html"') && read('ro/privacy.html').includes('href="../privacy.html"'), 'privacy switch is not reciprocal');
  assert(read('terms.html').includes('href="ro/terms.html"') && read('ro/terms.html').includes('href="../terms.html"'), 'terms switch is not reciprocal');
});

check('legal pages keep working email and same-language Privacy/Terms footer access', () => {
  for (const file of ['privacy.html', 'ro/privacy.html']) assert(read(file).includes('href="mailto:cfo@finmentor.md"'), file + ' email link missing');
  for (const file of LEGAL) {
    const html = read(file);
    assert(html.includes('href="privacy.html"') && html.includes('href="terms.html"'), file + ' same-language footer links incomplete');
  }
});

check('Privacy factual copy matches the current mini-scan submit control in RU and RO', () => {
  const ru = read('privacy.html'), ro = read('ro/privacy.html');
  assert(ru.includes('«Отправить результат FINMENTOR»') && !ru.includes('«Отправить результат в FINMENTOR Bot»'), 'RU stale mini-scan label remains');
  assert(ro.includes('„Trimiteți rezultatul către FINMENTOR”') && !ro.includes('„Trimiteți rezultatul în FINMENTOR Bot”'), 'RO stale mini-scan label remains');
  assert(read('working-capital-scan.html').includes('id="scanSend">Отправить результат FINMENTOR</button>'), 'RU live control differs');
  assert(read('ro/working-capital-scan.html').includes('id="scanSend">Trimiteți rezultatul către FINMENTOR</button>'), 'RO live control differs');
});

check('Terms keep FINMENTOR factual identity and Romanian IA terminology without overclaims', () => {
  for (const file of ['terms.html', 'ro/terms.html']) {
    const html = read(file);
    assert(html.includes('FINMENTOR™') && html.includes('finmentor.md'), file + ' identity or domain missing');
    assert(!html.includes('FINMENTOR®'), file + ' invents a registered trademark');
    assert(!/bank-grade|ISO certified|end-to-end encrypted|GDPR compliant/i.test(html), file + ' contains an unsupported overclaim');
  }
  assert(read('ro/terms.html').includes('inteligență artificială (IA)'), 'RO ordinary legal prose did not adopt IA');
});

check('legal reading width, list rhythm, note treatment and mobile header are shared tokens', () => {
  assert(/\.legal\s*\{[^}]*max-width:\s*78ch/s.test(css), 'legal measure is not 78ch');
  assert(/\.legal li\s*\{[^}]*padding-left:\s*22px/s.test(css), 'legal list rhythm missing');
  assert(/\.legal__note\s*\{[^}]*border-top:\s*1px solid var\(--gold-500\)/s.test(css), 'legal note hairline missing');
  assert(/@media \(max-width:\s*480px\)[\s\S]*?\.legal-bar__row\s*\{[^}]*flex-wrap:\s*wrap/s.test(css), 'legal mobile header rule missing');
});

check('normal article and legal prose never opts into character-level breaking', () => {
  assert(!/word-break\s*:\s*break-all/i.test(css), 'break-all returned');
  assert(/\.legal p,[\s\S]*?word-break:\s*normal;[\s\S]*?overflow-wrap:\s*normal;/s.test(css), 'legal wrap safety missing');
  assert(/\.article-page \.doc p,[\s\S]*?word-break:\s*normal;[\s\S]*?overflow-wrap:\s*normal;/s.test(css), 'article wrap safety missing');
});

check('the existing questionnaire machine signatures remain byte-equivalent at the control layer', () => {
  const expected = {
    ru: [409, 'dfef750eb765e6eb391594a6365b8cfa36cfa9e1704ed0085d9009c155aadcc3'],
    ro: [409, '9c01529ea43e1c82b5fe4ac3ad7c5388cf2c6ce82d822ed039897e2391fe98e4']
  };
  for (const [key, file] of [['ru', 'questionnaire.html'], ['ro', 'ro/questionnaire.html']]) {
    const got = machineSignature(read(file));
    assert(got[0] === expected[key][0] && got[1] === expected[key][1], key + ' questionnaire controls changed');
  }
});

check('visual evidence covers editorial, navigation and all legal responsive surfaces', () => {
  const visual = read('qa/visual-evidence.mjs');
  for (const marker of ['ru-materials', 'ro-materials', 'ru-retail-article', 'ro-retail-article',
    'ru-additional-article', 'ro-additional-article', 'ru-privacy', 'ro-privacy', 'ru-terms', 'ro-terms',
    'ru-capital-logic', 'ro-capital-logic', 'ru-capital-preservation', 'ro-capital-preservation',
    'ru-capital-control', 'ro-capital-control']) {
    assert(visual.includes("id: '" + marker + "'"), 'visual surface missing: ' + marker);
  }
  assert(visual.includes('ARTICLE HEADING / CONCLUSION INTEGRITY = PASS'), 'article visual gate missing');
  assert(visual.includes('LEGAL PAGE INTEGRITY = PASS'), 'legal visual gate missing');
  assert(visual.includes('CAPITAL MANAGEMENT INTEGRITY = PASS'), 'capital visual gate missing');
});

check('new editorial interactions retain focus and reduced-motion protection', () => {
  assert(css.includes('.legal-back:focus-visible') && css.includes('.legal a:focus-visible'), 'legal focus treatment missing');
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)', css.indexOf('v16 — Final editorial')));
  assert(reduced.includes('.kb-item:hover') && reduced.includes('transform: none'), 'Materials reduced-motion rule missing');
});

check('Capital Management sits after asset logic and before the existing client and offer sequence', () => {
  for (const [name, html, asset] of [
    ['RU', ruHome, 'Одна финансовая логика — разные активы'],
    ['RO', roHome, 'O singură logică financiară — active diferite']
  ]) {
    const assetAt = html.indexOf(asset);
    const capitalAt = html.indexOf('id="capital-logic"');
    const audienceAt = html.indexOf('id="audience"');
    const offersAt = html.indexOf('class="packages" id="solutions"');
    assert(assetAt >= 0 && assetAt < capitalAt, name + ' capital logic does not follow asset logic');
    assert(capitalAt < audienceAt && audienceAt < offersAt, name + ' existing narrative order changed');
  }
});

check('Capital positioning defines management capital without equating it to cash, equity or total assets', () => {
  assert(ruHome.includes('Управленчески капитал — это не только деньги или собственный капитал в балансе.'), 'RU management definition missing');
  assert(roHome.includes('În management, capitalul nu înseamnă doar numerar sau capitalul propriu din bilanț.'), 'RO management definition missing');
  for (const html of [ruHome, roHome]) {
    assert(!/Total Assets\s*=\s*Capital|Equity\s*=\s*(?:Management )?Capital/i.test(html), 'accounting identity overclaim found');
    assert(!/максимальн\w* доходност|randament maxim/i.test(html), 'maximum-return promise found');
  }
});

check('Capital Map keeps location and performance as two dimensions with risk as an overlay', () => {
  for (const [name, html] of [['RU', ruHome], ['RO', roHome]]) {
    const map = html.slice(html.indexOf('<article class="capital-map'), html.indexOf('</article>', html.indexOf('<article class="capital-map')) + 10);
    assert(count(map, /<section class="capital-dimension"/g) === 2, name + ' does not have two dimensions');
    assert(count(map, /<li>/g) === 5, name + ' location dimension does not have five forms');
    assert(count(map, /<dt>/g) === 5, name + ' performance dimension does not have five states');
    assert(count(map, /<aside class="capital-risk">/g) === 1, name + ' risk is not a separate overlay');
    assert(map.includes('capital-map__question'), name + ' owner-level CFO question missing');
  }
});

check('Capital control preserves four CFO principles and one decision loop without a product CTA', () => {
  for (const [name, html] of [['RU', ruHome], ['RO', roHome]]) {
    const section = capitalSection(html);
    assert(count(section, /class="capital-principle reveal"/g) === 4, name + ' does not keep four CFO principles');
    assert(count(section, /<div class="capital-flow/g) === 1, name + ' has more than one capital flow');
    assert(section.includes('capital-logic__mechanisms') && section.includes('capital-logic__reserve') && section.includes('capital-logic__closing'), name + ' decision logic is incomplete');
    assert(!/<a\b|class="btn/.test(section), name + ' capital thought-leadership section contains a CTA');
  }
});

check('capital preservation distinguishes profit, loss, freezing, value erosion and capital consumption', () => {
  for (const [name, html, labels] of [
    ['RU', ruHome, ['Прибыль ещё не означает сохранение капитала.', 'Потеря капитала', 'Замораживание капитала', 'Разрушение стоимости', 'Потребление капитала']],
    ['RO', roHome, ['Profitul contabil nu înseamnă automat că valoarea capitalului este protejată.', 'Pierderea capitalului', 'Capital blocat', 'Erodarea valorii', 'Consumul capitalului']]
  ]) {
    const section = capitalSection(html);
    assert(section.includes('capital-preservation'), name + ' preservation layer missing');
    for (const label of labels) assert(section.includes(label), name + ' preservation concept missing: ' + label);
    assert(count(section, /class="capital-preservation__grid"/g) === 1, name + ' has more than one preservation grid');
  }
});

check('capital preservation keeps return-on versus return-of capital, owner question and one seven-step control loop', () => {
  const ru = capitalSection(ruHome), ro = capitalSection(roHome);
  assert(ru.includes('Доход на капитал ≠ возврат самого капитала.'), 'RU return-on/return-of distinction missing');
  assert(ro.includes('Randamentul capitalului nu este același lucru cu restituirea capitalului însuși.'), 'RO return-on/return-of distinction missing');
  assert(ru.includes('Компания живёт на доход от капитала или постепенно расходует сам капитал?'), 'RU owner question missing');
  assert(ro.includes('Compania trăiește din randamentul capitalului sau consumă treptat capitalul însuși?'), 'RO owner question missing');
  for (const [name, section] of [['RU', ru], ['RO', ro]]) {
    const flow = section.slice(section.indexOf('<div class="capital-flow'), section.indexOf('</div>', section.indexOf('<div class="capital-flow')) + 6);
    assert(count(flow, /<span>/g) === 7, name + ' capital-control loop must contain seven questions');
    assert(count(section, /<div class="capital-flow/g) === 1, name + ' contains multiple competing capital flows');
    assert(section.includes('capital-preservation__checks'), name + ' sale/CAPEX/real-value checks missing');
  }
});

check('Romanian capital language is natural and retains liquidity, sustainable return and risk', () => {
  for (const phrase of ['Harta capitalului', 'Numerar și lichiditate', 'Capital de lucru',
    'Active operaționale și generatoare de venit', 'Capital subutilizat', 'Capital blocat',
    'randament sustenabil', 'nivel de risc acceptabil']) {
    assert(roHome.includes(phrase), 'RO capital terminology missing: ' + phrase);
  }
});

check('Capital Map uses one restrained editorial surface and responsive two-to-one-column composition', () => {
  assert(/\.capital-map\s*\{[^}]*border-top:\s*1px solid var\(--gold-500\)[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.025\)/s.test(css), 'restrained Capital Map surface missing');
  assert(/\.capital-map__dimensions\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s.test(css), 'desktop two-column map missing');
  assert(/@media \(max-width:\s*820px\)[\s\S]*?\.capital-map__head,[\s\S]*?\.capital-map__dimensions\s*\{\s*grid-template-columns:\s*1fr/s.test(css), 'single-column map handoff missing');
  assert(!/\.capital-(?:map|logic)[^{]*\{[^}]*animation:/s.test(css), 'decorative capital animation found');
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
