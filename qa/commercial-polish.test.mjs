#!/usr/bin/env node
// FINMENTOR v1.1.1 — offline public commercial truth contract (RU/RO).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const visible = (source) => source
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&ndash;/g, '–')
  .replace(/&mdash;/g, '—')
  .replace(/\s+/g, ' ');

let pass = 0;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function check(name, fn) {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('  FAIL  ' + name + ' -> ' + error.message); }
}
const has = (source, terms) => terms.every((term) => source.includes(term));

const pages = {
  home: visible(read('index.html')), roHome: visible(read('ro/index.html')),
  consult: visible(read('cfo-consultation.html')), roConsult: visible(read('ro/cfo-consultation.html')),
  health: visible(read('financial-health-check.html')), roHealth: visible(read('ro/financial-health-check.html')),
  system: visible(read('business-control-system.html')), roSystem: visible(read('ro/business-control-system.html')),
  monthly: visible(read('monthly-cfo-support.html')), roMonthly: visible(read('ro/monthly-cfo-support.html')),
};
const htmlFiles = [
  ...readdirSync(ROOT).filter((name) => name.endsWith('.html')),
  ...readdirSync(join(ROOT, 'ro')).filter((name) => name.endsWith('.html')).map((name) => `ro/${name}`),
];
const allRaw = htmlFiles.map(read).join('\n');
const allVisible = htmlFiles.map((file) => visible(read(file))).join('\n');
const allAnchorLabels = htmlFiles.flatMap((file) => [...read(file).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
  .map((match) => visible(match[1]))).join(' ');

check('RU advisory carries premium title and descriptor', () => assert(has(pages.consult, ['CFO Advisory Session', 'Стратегическая CFO-консультация']), 'premium naming missing'));
check('RO advisory descriptor is idiomatic', () => assert(has(pages.roConsult, ['CFO Advisory Session', 'Sesiune strategică de consultanță CFO']), 'premium naming missing'));
check('consultation price and duration are exact', () => assert(has(pages.consult, ['750 €', '60–90 минут']) && has(pages.roConsult, ['750 €', '60–90 de minute']), 'price/duration mismatch'));
check('RU topic, context and decision are required before confirmation', () => assert(has(pages.consult, ['тему вопроса', 'контекст', 'решение нужно принять', 'до подтверждения']), 'qualification missing'));
check('RO topic, context and decision are required before confirmation', () => assert(has(pages.roConsult, ['tema întrebării', 'contextul', 'decizie trebuie luată', 'Înainte de confirmarea']), 'qualification missing'));
check('consultation does not require a full data room', () => assert(pages.consult.includes('не полный data room') && pages.roConsult.includes('nu un dosar complet'), 'data boundary missing'));
check('consultation excludes diagnosis, audit, model and implementation', () => assert(has(pages.consult, ['полная диагностика', 'аудит', 'финансовая модель', 'внедрение']) && has(pages.roConsult, ['diagnosticul complet', 'audit', 'modelul financiar', 'implementarea']), 'scope boundary missing'));

check('PUBLIC CONTROL LIGHT = 0', () => assert(!/Control Light/i.test(allRaw), 'legacy package remains'));
check('PUBLIC MONTHLY SUPPORT FROM EUR 750 = 0', () => assert(!/(?:750\s*€\s*\/\s*(?:мес|месяц|lună)|€\s*750\s*\/\s*month)/i.test(allVisible), 'monthly 750 remains'));
check('CFO Control Partner starts at EUR 1,500/month', () => assert(/CFO Control Partner[\s\S]*?1 500 € \/ месяц/.test(pages.monthly) && /CFO Control Partner[\s\S]*?1 500 € \/ lună/.test(pages.roMonthly), 'Partner price mismatch'));
check('CFO AI Control starts at EUR 3,500/month', () => assert(/CFO AI Control[\s\S]*?3 500 € \/ месяц/.test(pages.monthly) && /CFO AI Control[\s\S]*?3 500 € \/ lună/.test(pages.roMonthly), 'AI price mismatch'));
check('monthly interaction format is agreed positively', () => assert(has(pages.monthly, ['Формат взаимодействия согласовывается заранее', 'частота встреч', 'рабочий контур', 'отчётность', 'каналы коммуникации']) && has(pages.roMonthly, ['Formatul de colaborare se stabilește în prealabil', 'frecvența întâlnirilor', 'circuitul de lucru', 'raportarea', 'canalele de comunicare']), 'defined interaction model missing'));
check('monthly urgent work and major implementation are scoped separately', () => assert(has(pages.monthly, ['Срочные и внеплановые задачи согласовываются отдельно', 'Крупное внедрение Power BI', 'отдельный проект']) && has(pages.roMonthly, ['Sarcinile urgente și neplanificate se convin separat', 'implementare majoră Power BI', 'proiect separat']), 'boundary missing'));

check('Financial Health Check entry price remains EUR 1,500', () => assert(pages.health.includes('от 1 500 €') && pages.roHealth.includes('de la 1 500 €'), 'price mismatch'));
check('Health Check term starts after required data', () => assert(pages.health.includes('1–2 недели после получения необходимых данных') && pages.roHealth.includes('1–2 săptămâni după primirea datelor necesare'), 'data-dependent term missing'));
check('Health Check has a complex-group and incomplete-data condition', () => assert(pages.health.includes('неполных исходных данных') && pages.roHealth.includes('date inițiale incomplete'), 'complexity condition missing'));
check('Health Check diagnoses while Business Control implements', () => assert(pages.health.includes('Диагностика определяет проблему и приоритеты; Business Control System внедряет') && pages.roHealth.includes('Diagnosticul identifică problema și prioritățile; Business Control System implementează'), 'diagnose/implement boundary missing'));

check('Business Control entry price is for its base contour', () => assert(/от 5 000 € за базовый финансовый контур/i.test(pages.system) && /de la 5 000 € pentru circuitul financiar de bază/i.test(pages.roSystem), 'base price missing'));
check('base contour carries all seven approved components', () => {
  assert(has(pages.system, ['P&L', 'Cash Flow', 'Платёжный календарь', 'Ключевые финансовые KPI', 'Базовый план-факт', 'Правила и ответственность', 'Формат / шаблон управленческого отчёта собственника']), 'RU base incomplete');
  assert(has(pages.roSystem, ['P&L', 'Cash Flow', 'Calendarul plăților', 'Indicatori financiari-cheie', 'Analiză de bază plan–realizat', 'Reguli și responsabilități', 'Formatul / șablonul raportului managerial']), 'RO base incomplete');
});
check('treasury, Power BI, automation and ERP are optional modules', () => assert(has(pages.system, ['Дополнительно по задаче', 'казначейства', 'Power BI', 'n8n / Make / AI', '1С / ERP']) && has(pages.roSystem, ['Suplimentar, în funcție de obiectiv', 'trezorerie', 'Power BI', 'n8n / Make / IA', '1C / ERP']), 'optional modules missing'));
check('Power BI is explicitly not mandatory', () => assert(pages.system.includes('Power BI не является обязательным результатом') && pages.roSystem.includes('Power BI nu este un rezultat obligatoriu'), 'Power BI boundary missing'));
check('2–4 months applies only to the base contour', () => assert(pages.system.includes('базовый контур — обычно 2–4 месяца') && pages.roSystem.includes('circuitul de bază — de regulă, 2–4 luni'), 'term mismatch'));
check('complex groups and expanded implementation use a separate plan', () => assert(pages.system.includes('определяются по отдельному плану') && pages.roSystem.includes('se stabilesc printr-un plan separat'), 'separate plan missing'));
check('result claim promises the financial contour', () => assert(pages.system.includes('Собственник получает единый финансовый контур') && pages.roSystem.includes('Proprietarul primește un circuit financiar unitar'), 'result overpromises'));

check('homepage offers parallel work formats', () => assert(has(pages.home, ['Форматы работы FINMENTOR', 'не по обязательной последовательности']) && has(pages.roHome, ['Formatele de lucru FINMENTOR', 'nu după o succesiune obligatorie']), 'false funnel remains'));
check('compact consultation and flagship hooks preserve visual hierarchy', () => assert(/class="packages__expert/.test(read('index.html')) && /package package--flagship/.test(read('index.html')), 'hierarchy hooks missing'));
check('old primary CTA wording is absent', () => assert(!/Discovery Call|Лучше сразу написать|Mai bine scrieți direct/.test(allVisible), 'old CTA remains'));
check('FINMENTOR Bot is not a public CTA label', () => assert(!/FINMENTOR Bot/i.test(allAnchorLabels), 'bot is still presented as the offer'));

check('PREMIUM SELF-TEST Q1 — offer reads as advisory, not a SaaS ladder', () => assert(has(pages.home, ['Форматы работы FINMENTOR', 'CFO Advisory Session', 'CFO Control Partner']) && !/продуктовая лестница|Шаг 1|Шаг 2|Шаг 3/i.test(pages.home), 'ladder framing remains'));
check('PREMIUM SELF-TEST Q2 — EUR 750 buys senior CFO judgement for one issue', () => assert(has(pages.home, ['CFO Advisory Session', 'Стратегическая CFO-консультация', 'оценивает риски', 'реалистичные варианты', 'рекомендуемое направление', '750 €', '60–90 минут']) && has(pages.roHome, ['CFO Advisory Session', 'Sesiune strategică de consultanță CFO', 'evaluează riscurile', 'opțiunile realiste', 'direcția recomandată']), 'advisory value is unclear'));
check('PREMIUM SELF-TEST Q3 — Partner controls decisions and execution', () => assert(has(pages.home, ['Сопровождение и контроль исполнения', 'Контроль решений и исполнения', 'задачи с ответственным, сроком и статусом', 'следующем CFO-цикле']) && has(pages.roHome, ['Parteneriat și controlul execuției', 'Controlul deciziilor și al execuției', 'sarcini cu responsabil, termen și stadiu']), 'execution-control cycle missing'));
check('PREMIUM SELF-TEST Q4 — remote work stays controlled between meetings', () => assert(has(pages.home, ['Совместный рабочий контур', 'Удалённый формат без потери управляемости', 'прозрачный статус исполнения']) && has(pages.roHome, ['Circuit comun de lucru', 'Lucru la distanță fără pierderea controlului', 'stadiul execuției']), 'remote control model missing'));
check('PREMIUM SELF-TEST Q5 — client participation is a professional partnership', () => assert(has(pages.home, ['Результат строится совместно', 'команда клиента обеспечивает необходимые данные', 'исполнение согласованных решений']) && has(pages.roHome, ['Rezultatul se construiește împreună', 'echipa clientului asigură datele necesare', 'executarea deciziilor convenite']), 'partnership model missing'));
check('PREMIUM SELF-TEST Q6 — blunt availability language is absent', () => assert(!/24\/7|неограниченн|apeluri nelimitate|disponibilitatea permanentă|экстренная доступность/i.test(allVisible), 'defensive availability language remains'));
check('PREMIUM SELF-TEST Q7 — task software is absent from the public proposition', () => assert(!/Trello|Jira|Juma|ClickUp/i.test(allVisible), 'task software leaked into public copy'));
check('PREMIUM SELF-TEST Q8 — no calculator or configurator was added', () => assert(!/Оценить формат работы|калькулятор|price calculator|pricing configurator|configurator de preț/i.test(allVisible) && !htmlFiles.some((file) => /calculator|configurator/i.test(file)), 'out-of-scope pricing flow added'));

check('premium addendum — EUR 5K is explicitly a project entry point', () => assert(pages.home.includes('Проекты этого формата начинаются от 5 000 €') && pages.roHome.includes('Proiectele de acest tip pornesc de la 5 000 €'), 'project entry wording missing'));
check('premium addendum — advisory leads with decision value before duration', () => assert(has(pages.consult, ['по одному заранее определённому', 'профессиональное суждение senior CFO', 'оценка рисков', 'реалистичные варианты', 'рекомендуемое направление']) && has(pages.roConsult, ['pentru o singură decizie', 'judecată profesională de CFO senior', 'evaluarea riscurilor', 'opțiuni realiste', 'direcția recomandată']), 'advisory hierarchy missing'));
check('premium addendum — all four offers have distinct jobs', () => assert(has(pages.home, ['одному заранее определённому финансовому или управленческому решению', 'Диагностическая работа по финансовой ситуации компании', 'Базовый финансовый контур', 'Регулярный управленческий цикл']) && has(pages.roHome, ['o singură decizie financiară sau managerială', 'Diagnostic al situației financiare a companiei', 'Circuit financiar de bază', 'Ciclu managerial regulat']), 'offer distinction missing'));
check('premium addendum — pre-engagement scope and client fit are explicit', () => assert(has(pages.home, ['Перед началом работы', 'состояние исходных данных', 'необходимый уровень вовлечённости', 'ожидаемый результат', 'формат взаимодействия и стоимость', 'готовности команды к рабочему процессу', 'если нужен другой формат']) && has(pages.roHome, ['Colaborarea începe', 'starea datelor inițiale', 'nivelul necesar de implicare', 'rezultatul așteptat', 'formatul de colaborare și costul', 'pregătirii echipei pentru procesul de lucru', 'dacă este necesar un alt format']), 'scoping or fit signal missing'));
check('premium addendum — limited engagements preserve direct CFO involvement', () => assert(has(pages.home, ['ограниченное количество проектов одновременно', 'прямую вовлечённость CFO', 'контроль исполнения']) && has(pages.roHome, ['număr limitat de proiecte', 'implicarea directă a CFO-ului', 'controlul execuției']), 'capacity signal missing'));

function jsonLd(file) { return [...read(file).matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((match) => JSON.parse(match[1])); }
function offers(node, out = []) { if (!node || typeof node !== 'object') return out; if (node['@type'] === 'Offer') out.push(node); for (const value of Object.values(node)) offers(value, out); return out; }
check('consultation schemas publish an exact EUR 750 Offer', () => { for (const file of ['cfo-consultation.html', 'ro/cfo-consultation.html']) assert(offers(jsonLd(file)).some((offer) => offer.price === '750' && offer.priceCurrency === 'EUR'), file + ' Offer missing'); });
check('monthly schemas expose 1500/3500 but no 750 Offer', () => { for (const file of ['monthly-cfo-support.html', 'ro/monthly-cfo-support.html']) { const found = offers(jsonLd(file)); assert(found.some((x) => x.price === '1500') && found.some((x) => x.price === '3500') && !found.some((x) => x.price === '750'), file + ' Offer mismatch'); } });
check('sitemap publishes both consultation editions', () => assert(has(read('sitemap.xml'), ['/cfo-consultation.html', '/ro/cfo-consultation.html']), 'sitemap missing'));

check('SELF-TEST Q1 maps one question to the EUR 750 consultation', () => assert(/одному (?:заранее )?(?:конкретному|определённому)[\s\S]*?750 €/.test(pages.home), 'Q1 ambiguous'));
check('SELF-TEST Q2 maps an unclear problem to Health Check', () => assert(/Не понимаю, что не так Financial Health Check/.test(pages.home), 'Q2 ambiguous'));
check('SELF-TEST Q3 maps P&L, Cash Flow and payment control to Business Control', () => assert(/Business Control System[\s\S]*?Управленческий P&L[\s\S]*?Cash Flow[\s\S]*?Платёжный календарь/.test(pages.home), 'Q3 ambiguous'));
check('SELF-TEST Q4 says EUR 5,000 does not include every module', () => assert(pages.home.includes('Опциональные модули не входят автоматически'), 'Q4 ambiguous'));
check('SELF-TEST Q5 limits 2–4 months to the base contour', () => assert(has(pages.home, ['Базовый контур — обычно 2–4 месяца', 'Отдельный план']), 'Q5 ambiguous'));
check('SELF-TEST Q6 presents monthly interaction scope positively', () => assert(/Формат взаимодействия согласовывается заранее:[\s\S]*?Срочные и внеплановые задачи согласовываются отдельно/.test(pages.monthly), 'Q6 ambiguous'));
check('SELF-TEST Q7 requires the topic before confirmation', () => assert(pages.home.includes('Тема, контекст и нужное решение уточняются до подтверждения встречи'), 'Q7 ambiguous'));

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) process.exit(1);
