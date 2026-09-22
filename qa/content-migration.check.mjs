#!/usr/bin/env node
// FINMENTOR — IA 2.0 content-migration proof.
//
//   node qa/content-migration.check.mjs [baseline-rev]
//
// The homepage became nine scenes; everything else moved to hub pages. This proves that
// nothing meaningful was lost: every text block of 12+ words and every internal link on the
// BASELINE homepage (RU and RO) must exist on the new homepage or on a hub page. Deliberate
// edits are listed below with their replacement, and the replacement must be present.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.argv[2] || '392efde';
const HUBS = ['index.html', 'owner.html', 'capital-management.html', 'business-models.html', 'about.html', 'materials.html'];
// Homepage material cards are teasers of the library: they are proven by their link reaching
// materials.html (which titles its own cards), not by identical teaser text.
const TEASERS = /<a class="material-card[\s\S]*?<\/a>/g;

// Owner-approved wording changes (brief IA 2.0 §3, §11, §47): [baseline text, replacement].
const EDITS = {
  ru: [
    ['Платежи согласуются хаотично, без приоритетов и фондов.', 'Платежи согласуются без приоритетов и резервов.'],
    ['Собственник не видит ключевые показатели, риски и отклонения в одном месте.', 'Собственник не видит деньги, результат и риски в одной системе.'],
    ['Это диагностика, а не аудит, due diligence, полная финансовая модель или внедрение системы.', 'Это диагностика, а не аудит, комплексная проверка (due diligence), полная финансовая модель или внедрение системы.'],
    ['Строительство, development, расширение и инвестиционные программы.', 'Строительство, девелопмент, расширение и инвестиционные программы.'],
    ['План действий (Roadmap) на 30 / 60 / 90 дней', 'План действий на 30 / 60 / 90 дней'],
    // Final homepage polish: practice situations as a two-line headline + one meaning line
    // (owner-approved wording); the headline carries the first clause.
    ['Прибыль есть, но денег не хватает — деньги застревали в дебиторке, запасах и хаотичных платежах.', 'Прибыль есть. Денег не хватает. Деньги застряли в дебиторской задолженности, запасах и хаотичных платежах.'],
    ['Много Excel-файлов, но нет единой картины — прибыль, деньги и обязательства порознь.', 'Отчётов много. Единой картины нет. Прибыль, деньги и обязательства существуют отдельно.'],
  ],
  ro: [
    ['Plățile se aprobă haotic, fără priorități și fonduri.', 'Plățile se aprobă fără priorități și fără rezerve.'],
    ['Proprietarul nu vede indicatorii-cheie, riscurile și abaterile într-un singur loc.', 'Proprietarul nu vede banii, rezultatul și riscurile într-un singur sistem.'],
    ['Este un diagnostic, nu audit, due diligence, model financiar complet sau implementare de sistem.', 'Este un diagnostic, nu audit, verificare aprofundată (due diligence), model financiar complet sau implementare de sistem.'],
    ['Construcții, development, extindere și programe de investiții.', 'Construcții, dezvoltare imobiliară, extindere și programe de investiții.'],
    ['Plan de acțiune (Roadmap) pentru 30 / 60 / 90 de zile', 'Plan de acțiune pentru 30 / 60 / 90 de zile'],
    ['Există profit, dar banii nu ajung — rămâneau blocați în creanțe, stocuri și plăți haotice.', 'Există profit. Banii nu ajung. Banii au rămas blocați în creanțe, stocuri și plăți haotice.'],
    ['Plăți în fiecare zi, dar fără priorități — deciziile se luau manual.', 'Plățile se fac. Priorități nu există. Deciziile se luau manual.'],
    ['Multe fișiere Excel, dar nicio imagine unică — profitul, banii și obligațiile stau separat.', 'Rapoarte sunt multe. O imagine unică nu există. Profitul, banii și obligațiile stau separat.'],
  ],
};

// Owner-approved SPLITS (homepage Formats, CFO Advisory Session): one baseline block, set as a
// visible purpose line on the panel and the remainder inside «Состав и условия». Narrow by
// construction: the baseline block must match exactly, it must equal its parts joined by one
// space (nothing dropped or reworded), and every part must be present as written.
const SPLITS = {
  ru: [[
    'Экспертная CFO-сессия по одному заранее определённому финансовому или управленческому решению. CFO FINMENTOR оценивает риски, сравнивает реалистичные варианты и формирует рекомендуемое направление — без обязательства продолжать сотрудничество.',
    ['Экспертная CFO-сессия по одному заранее определённому финансовому или управленческому решению.', 'CFO FINMENTOR оценивает риски, сравнивает реалистичные варианты и формирует рекомендуемое направление — без обязательства продолжать сотрудничество.'],
  ]],
  ro: [[
    'Sesiune CFO de expertiză pentru o singură decizie financiară sau managerială stabilită în prealabil. CFO-ul FINMENTOR evaluează riscurile, compară opțiunile realiste și formulează direcția recomandată — fără obligația continuării colaborării.',
    ['Sesiune CFO de expertiză pentru o singură decizie financiară sau managerială stabilită în prealabil.', 'CFO-ul FINMENTOR evaluează riscurile, compară opțiunile realiste și formulează direcția recomandată — fără obligația continuării colaborării.'],
  ]],
};

const BLOCK =/<\/?(?:p|li|h[1-6]|dt|dd|div|section|article|aside|ul|ol|dl|summary|details|figure|figcaption|header|footer|nav|main|br|form|label|button|table|tr|td|th|blockquote)\b[^>]*>/gi;
const norm = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&rarr;/g, '→').replace(/&ne;/g, '≠').replace(/&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ').trim();
function blocks(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return main.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(BLOCK, '\n').replace(/<[^>]+>/g, '').split('\n').map(norm).filter((t) => t.split(' ').length >= 12);
}
const text = (html) => norm(html.slice(html.indexOf('<main'), html.indexOf('</main>'))
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, ' ').replace(BLOCK, ' ').replace(/<[^>]+>/g, ''));
const links = (html) => [...html.slice(html.indexOf('<main'), html.indexOf('</main>')).matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  .filter((h) => !/^(https?:|mailto:|tel:|#)/.test(h)).map((h) => h.replace(/^index\.html#/, '#'));

let failures = 0, checked = 0, linkChecked = 0;
for (const lang of ['ru', 'ro']) {
  const p = (f) => (lang === 'ro' ? 'ro/' : '') + f;
  const base = execSync(`git show ${BASE}:${p('index.html')}`, { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8');
  const pages = HUBS.map((f) => readFileSync(join(ROOT, p(f)), 'utf8'));
  const now = pages.map(text).join(' \n ');
  const nowLinks = new Set(pages.flatMap(links).concat(pages.flatMap((h) => [...h.matchAll(/\bid="([^"]+)"/g)].map((m) => '#' + m[1]))));
  const edits = new Map(EDITS[lang]);
  for (const [, replacement] of EDITS[lang]) {
    if (!now.includes(replacement)) { failures++; console.log(`FAIL ${lang} declared replacement missing: ${replacement}`); }
  }
  const splits = new Map(SPLITS[lang]);
  for (const [whole, parts] of SPLITS[lang]) {
    if (parts.join(' ') !== whole) { failures++; console.log(`FAIL ${lang} declared split does not recompose its baseline: ${whole.slice(0, 80)}`); }
    for (const part of parts) if (!now.includes(part)) { failures++; console.log(`FAIL ${lang} declared split part missing: ${part}`); }
  }
  for (const b of blocks(base.replace(TEASERS, ' '))) {
    checked++;
    if (now.includes(b)) continue;
    if (splits.has(b) && splits.get(b).every((part) => now.includes(part))) continue;
    const edited = [...edits.keys()].find((k) => b.includes(k));
    if (edited && now.includes(b.replace(edited, edits.get(edited)))) continue;
    failures++; console.log(`FAIL ${lang} text not found anywhere: ${b.slice(0, 140)}`);
  }
  for (const h of new Set(links(base))) {
    linkChecked++;
    if (nowLinks.has(h)) continue;
    failures++; console.log(`FAIL ${lang} internal link no longer reachable: ${h}`);
  }
}
console.log(`\ncontent-migration: ${checked} text blocks and ${linkChecked} internal links from ${BASE} checked; ${failures ? failures + ' missing' : 'nothing lost'}`);
process.exit(failures ? 1 : 0);
