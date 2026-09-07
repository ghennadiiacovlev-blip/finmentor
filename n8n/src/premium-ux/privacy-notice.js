// FINMENTOR Premium UX — the layered privacy notice, as a TEMPLATE.
//
// Owner decision 4 asked for two layers, not one wall of text:
//
//   LAYER 1  a concise notice on the FIRST screen that collects personal data, so a person knows
//            what is happening before they type anything;
//   LAYER 2  the full notice, reachable from layer 1 and from the submit screen, acknowledged at
//            Submit.
//
// One immutable row is written at submit, carrying BOTH timestamps — shown_at (captured when
// layer 1 rendered) and acknowledged_at (captured at Submit). There is no UPDATE anywhere in the
// path; see privacy-record.js for why that is a structural property and not a promise.
//
// THE LEGAL IDENTITY. The controller is a NATURAL PERSON in the Republic of Moldova (owner
// decision, 2026-08-29). The name and privacy contact were left open for a year of drafts, because
// inventing "FINMENTOR SRL", a registration number or an address would be a fabricated legal
// record — the single worst thing this file could contain. So the identity stayed a SLOT, and
// `render()` refuses to produce a notice while any slot is unfilled, which means the product could
// never be activated for customers with a placeholder notice on screen even by accident.
//
// The owner supplied both values on 2026-09-04 (Gate 1) and they are now recorded verbatim in
// `CONTROLLER` at the foot of this file — nothing more: no company form, no registration number,
// no address. The refusal machinery is untouched and still guards the render path.

'use strict';

const NOTICE_VERSION = '2026-08-29.v1-draft';

// The technical enum. Owner decision 3: `pre_contractual_request` is a CANDIDATE, chosen because a
// consultation brief is a step taken at the data subject's own request before any contract exists
// (Law 195/2024 art. 6(1)(b)). Production activation is blocked pending legal confirmation, and the
// value is SERVER-SIDE ONLY — it is never sent to the client, never rendered, and never named in
// the notice text, because a legal-basis label a lawyer has not confirmed must not appear in a
// document a customer reads.
const LEGAL_BASIS_CANDIDATE = 'pre_contractual_request';
const LEGAL_BASIS_PENDING = 'PENDING_LEGAL_REVIEW';

// Every slot must be supplied before a notice can be rendered.
const SLOTS = ['controller_full_name', 'controller_privacy_email'];
const OWNER_INPUT_REQUIRED = 'OWNER_INPUT_REQUIRED';

// Fixed, non-negotiable facts about the controller that the owner HAS decided.
const CONTROLLER_TYPE = 'natural_person';

// The ten elements an informed-consent notice must carry under Law 195/2024 (and, for anyone who
// reads this from a GDPR habit, art. 13 GDPR — the lists coincide for this purpose). Each key below
// must be present in both locales; `assertComplete()` enforces it, so a translation cannot silently
// ship one element short.
const REQUIRED_ELEMENTS = [
  'controller',        // 1. who the controller is, and how to reach them
  'purposes',          // 2. what the data is used for
  'legal_basis',       // 3. on what ground
  'categories',        // 4. which data
  'recipients',        // 5. who else sees it
  'transfers',         // 6. whether it leaves Moldova
  'retention',         // 7. how long it is kept
  'rights',            // 8. the data subject's rights
  'complaint',         // 9. the supervisory authority
  'voluntary'          // 10. whether providing it is required, and what happens if you do not
];

// --------------------------------------------------------------------------- layer 1 (concise)

const CONCISE = {
  ru: {
    heading: 'Коротко о данных',
    body: 'Мы собираем то, что вы указываете в брифе, чтобы рассмотреть обращение, подготовить консультанта и связаться с вами. Данные не используются для рекламы и не передаются третьим лицам, кроме поставщиков хостинга и инфраструктуры.',
    link: 'Полная информация об обработке данных'
  },
  ro: {
    heading: 'Pe scurt despre date',
    body: 'Colectăm datele pe care le indicați în brief pentru a examina solicitarea, a pregăti consultantul și a vă contacta. Datele nu sunt folosite pentru publicitate și nu sunt transmise terților, cu excepția furnizorilor de găzduire și infrastructură.',
    link: 'Informația completă despre prelucrarea datelor'
  }
};

// PROCESSORS ARE DESCRIBED BY ROLE, NEVER BY NAME.
//
// «Telegram» was named individually here while every other processor was a category, and that
// inconsistency is the whole problem: naming one vendor and not the others reads as a complete
// list when it is not, and it commits the controller to a disclosure the others do not carry.
// Either every processor is named or none is; the approved model is by role, so none is.
//
// `assertNoVendorNames()` enforces it, so this cannot regress back into prose.

// --------------------------------------------------------------------------- layer 2 (full)
//
// `{{controller_full_name}}` and `{{controller_privacy_email}}` are the only substitutions. They
// are written as explicit moustaches so an unfilled notice is visibly broken rather than plausibly
// complete.

const FULL = {
  ru: {
    title: 'Обработка персональных данных',
    intro: 'Настоящая информация предоставляется в соответствии с Законом Республики Молдова № 195/2024 о защите персональных данных.',
    elements: {
      controller: {
        heading: 'Кто обрабатывает данные',
        body: 'Оператор персональных данных — физическое лицо {{controller_full_name}}, Республика Молдова. Отдельного юридического лица FINMENTOR не существует; FINMENTOR — наименование проекта. Вопросы об обработке данных: {{controller_privacy_email}}.'
      },
      purposes: {
        heading: 'Для чего',
        body: 'Рассмотрение вашего обращения, подготовка консультанта к встрече и связь с вами по этому обращению. Данные не используются для рекламных рассылок и для автоматизированного принятия решений, имеющих для вас юридические последствия.'
      },
      legal_basis: {
        heading: 'На каком основании',
        body: 'Обработка необходима для действий, предпринимаемых по вашему запросу до заключения договора.'
      },
      categories: {
        heading: 'Какие данные',
        body: 'Имя и роль, название компании, масштаб бизнеса, описание задачи и контекста, желаемый результат, срок решения, выбранный канал связи и его значение (Telegram, e-mail или телефон), а также сведения о наличии материалов. Технически сохраняется идентификатор вашего Telegram-аккаунта, необходимый для связи брифа с вами.'
      },
      recipients: {
        heading: 'Кто ещё имеет доступ',
        body: 'Консультант, который готовится к встрече с вами. Поставщики инфраструктуры, действующие как обработчики по поручению оператора: хостинг базы данных, платформа автоматизации, сервис таблиц и мессенджер, через который вы обратились. Данные не продаются и не передаются для маркетинга третьих лиц.'
      },
      transfers: {
        heading: 'Передача за пределы Республики Молдова',
        body: 'Инфраструктура поставщиков расположена за пределами Республики Молдова, в том числе в Европейском союзе и Соединённых Штатах Америки. Это означает трансграничную передачу данных.'
      },
      retention: {
        heading: 'Сколько хранится',
        // GATE 1 CORRECTION 2026-09-04: this paragraph used to say the unfinished brief «удаляется
        // автоматически через 72 часа» and that the transmitted request «после чего удаляется».
        // Neither mechanism exists. What the 72 h TTL actually does is EXPIRE the session — an
        // expired brief can no longer be opened, edited or submitted — and no automatic deletion
        // job runs anywhere in the stack; `idempotency-receipt.js` records that no canonical
        // retention period is even defined yet. A notice may not describe a deletion that does not
        // happen, so it now states the expiry that is real and keeps deletion as the RIGHT the
        // person can exercise, which the controller can honour by hand today.
        body: 'Незавершённый бриф перестаёт быть доступен через 72 часа: открыть, изменить или отправить его больше нельзя. Обращение, по которому не начались договорные отношения, хранится 12 месяцев с момента последнего содержательного взаимодействия, после чего удаляется; вы можете запросить удаление раньше. Если начинаются договорные отношения, применяются отдельные договорные, бухгалтерские и установленные законом сроки. Удаление выполняется оператором; автоматическое удаление по расписанию пока не реализовано. Запись о том, какую версию этой информации вы получили и когда подтвердили, хранится отдельно как доказательство и не содержит содержания вашего обращения.'
      },
      rights: {
        heading: 'Ваши права',
        body: 'Вы вправе получить доступ к своим данным, потребовать их исправления или удаления, ограничить обработку, возразить против обработки и получить данные в переносимом виде. Обращение по адресу {{controller_privacy_email}}.'
      },
      complaint: {
        heading: 'Жалоба',
        body: 'Вы вправе подать жалобу в Национальный центр по защите персональных данных Республики Молдова.'
      },
      voluntary: {
        heading: 'Обязательно ли это',
        body: 'Предоставление данных добровольно. Без них обращение рассмотреть невозможно — консультанту нечего готовить и некуда ответить. Отказ не влечёт никаких иных последствий.'
      }
    },
    acknowledgement: 'Я ознакомился с информацией об обработке персональных данных.'
  },
  ro: {
    title: 'Prelucrarea datelor cu caracter personal',
    intro: 'Prezenta informație este furnizată în conformitate cu Legea Republicii Moldova nr. 195/2024 privind protecția datelor cu caracter personal.',
    elements: {
      controller: {
        heading: 'Cine prelucrează datele',
        body: 'Operatorul de date cu caracter personal este persoana fizică {{controller_full_name}}, Republica Moldova. Nu există o persoană juridică separată FINMENTOR; FINMENTOR este denumirea proiectului. Întrebări privind prelucrarea datelor: {{controller_privacy_email}}.'
      },
      purposes: {
        heading: 'În ce scop',
        body: 'Examinarea solicitării dumneavoastră, pregătirea consultantului pentru întâlnire și contactarea dumneavoastră în legătură cu această solicitare. Datele nu sunt folosite pentru comunicări publicitare și nici pentru decizii automate cu efecte juridice asupra dumneavoastră.'
      },
      legal_basis: {
        heading: 'În ce temei',
        body: 'Prelucrarea este necesară pentru demersuri efectuate la cererea dumneavoastră înainte de încheierea unui contract.'
      },
      categories: {
        heading: 'Ce date',
        body: 'Numele și rolul, denumirea companiei, dimensiunea afacerii, descrierea sarcinii și a contextului, rezultatul dorit, termenul deciziei, canalul de contact ales și valoarea acestuia (Telegram, e-mail sau telefon), precum și informația despre existența materialelor. Tehnic se păstrează identificatorul contului dumneavoastră Telegram, necesar pentru a lega brieful de dumneavoastră.'
      },
      recipients: {
        heading: 'Cine mai are acces',
        body: 'Consultantul care se pregătește pentru întâlnirea cu dumneavoastră. Furnizorii de infrastructură, care acționează ca persoane împuternicite de operator: găzduirea bazei de date, platforma de automatizare, serviciul de foi de calcul și serviciul de mesagerie prin care ne-ați contactat. Datele nu se vând și nu se transmit pentru marketingul terților.'
      },
      transfers: {
        heading: 'Transfer în afara Republicii Moldova',
        body: 'Infrastructura furnizorilor este situată în afara Republicii Moldova, inclusiv în Uniunea Europeană și Statele Unite ale Americii. Aceasta înseamnă un transfer transfrontalier de date.'
      },
      retention: {
        heading: 'Cât timp se păstrează',
        // Same GATE 1 correction as the RU body above, kept semantically identical.
        body: 'Un brief nefinalizat devine indisponibil după 72 de ore: nu mai poate fi deschis, modificat sau trimis. Solicitarea pentru care nu au început relații contractuale se păstrează 12 luni de la ultima interacțiune semnificativă, după care se șterge; puteți cere ștergerea mai devreme. Dacă încep relații contractuale, se aplică termene separate contractuale, contabile și legale. Ștergerea este efectuată de operator; ștergerea automată programată nu este încă implementată. Înregistrarea despre versiunea acestei informații pe care ați primit-o și momentul confirmării se păstrează separat, ca dovadă, și nu conține conținutul solicitării dumneavoastră.'
      },
      rights: {
        heading: 'Drepturile dumneavoastră',
        body: 'Aveți dreptul de acces la datele dumneavoastră, de a cere rectificarea sau ștergerea acestora, de a restricționa prelucrarea, de a vă opune prelucrării și de a primi datele într-un format portabil. Adresați-vă la {{controller_privacy_email}}.'
      },
      complaint: {
        heading: 'Plângere',
        body: 'Aveți dreptul de a depune o plângere la Centrul Național pentru Protecția Datelor cu Caracter Personal al Republicii Moldova.'
      },
      voluntary: {
        heading: 'Este obligatoriu',
        body: 'Furnizarea datelor este voluntară. Fără ele solicitarea nu poate fi examinată — consultantul nu are ce pregăti și unde răspunde. Refuzul nu atrage alte consecințe.'
      }
    },
    acknowledgement: 'Am luat cunoștință de informația privind prelucrarea datelor cu caracter personal.'
  }
};

const LOCALES = ['ru', 'ro'];
const MOUSTACHE = /\{\{\s*([a-z_]+)\s*\}\}/g;

// Vendor names that must not appear as RECIPIENTS. The rule is scoped to the recipients element
// on purpose:
//
//   * `recipients` answers "who else sees this". Naming one vendor there and not the others reads
//     as a complete list when it is not.
//   * `categories` answers "what data". It legitimately says the contact channel may be Telegram
//     and that a Telegram account identifier is stored — that is the DATA, and describing it by
//     category instead («мессенджер») would make the disclosure less true, not more consistent.
//
// So the same word is forbidden in one section and required in another, and that is not an
// inconsistency: the two sections are answering different questions.
const VENDOR_NAMES = [
  'Telegram', 'Supabase', 'Google', 'n8n', 'OpenAI', 'GitHub',
  'Amazon', 'AWS', 'Cloudflare', 'Microsoft', 'Meta', 'WhatsApp', 'Viber'
];
const VENDOR_SCOPED = ['recipients', 'transfers'];

function assertNoVendorNames() {
  const found = [];
  for (const loc of LOCALES) {
    for (const el of VENDOR_SCOPED) {
      const e = (FULL[loc] && FULL[loc].elements[el]) || {};
      const text = String(e.heading || '') + ' ' + String(e.body || '');
      for (const v of VENDOR_NAMES) {
        // '\\b' — a word boundary. '\b' in a JS string literal is a BACKSPACE character, so the
        // first version of this check silently tested for a control code and found nothing.
        if (new RegExp('\\b' + v + '\\b', 'i').test(text)) { found.push(loc + '/' + el + ': ' + v); }
      }
    }
    const c = CONCISE[loc] || {};
    for (const v of VENDOR_NAMES) {
      if (new RegExp('\\b' + v + '\\b', 'i').test(String(c.body || ''))) { found.push(loc + '/concise: ' + v); }
    }
  }
  return found;
}

function assertComplete() {
  const problems = [];
  for (const loc of LOCALES) {
    const f = FULL[loc];
    if (!f) { problems.push('missing locale: ' + loc); continue; }
    if (!CONCISE[loc]) { problems.push('missing concise layer: ' + loc); }
    for (const el of REQUIRED_ELEMENTS) {
      const e = f.elements[el];
      if (!e || !String(e.heading || '').trim() || !String(e.body || '').trim()) {
        problems.push(loc + ': element "' + el + '" is missing or empty');
      }
    }
    for (const k of Object.keys(f.elements)) {
      if (REQUIRED_ELEMENTS.indexOf(k) === -1) { problems.push(loc + ': unexpected element "' + k + '"'); }
    }
  }
  return problems;
}

// Every moustache found anywhere in the notice, in either locale.
function slotsUsed() {
  const seen = {};
  const walk = (v) => {
    if (typeof v === 'string') { let m; MOUSTACHE.lastIndex = 0; while ((m = MOUSTACHE.exec(v))) { seen[m[1]] = true; } return; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) { walk(v[k]); } }
  };
  walk(FULL);
  walk(CONCISE);
  return Object.keys(seen).sort();
}

// Renders one locale. REFUSES rather than degrades: an unfilled or placeholder slot produces an
// error, never a notice reading "OWNER_INPUT_REQUIRED" to a customer.
function render(locale, controller) {
  const c = controller || {};
  if (LOCALES.indexOf(locale) === -1) { return { ok: false, error_code: 'BAD_LOCALE' }; }

  const gaps = [];
  if (String(c.controller_type || '') !== CONTROLLER_TYPE) { gaps.push('controller_type'); }
  for (const slot of SLOTS) {
    const v = String(c[slot] === undefined || c[slot] === null ? '' : c[slot]).trim();
    if (!v || v === OWNER_INPUT_REQUIRED) { gaps.push(slot); }
  }
  if (gaps.length) { return { ok: false, error_code: 'CONTROLLER_IDENTITY_REQUIRED', missing: gaps }; }

  const incomplete = assertComplete();
  if (incomplete.length) { return { ok: false, error_code: 'NOTICE_INCOMPLETE', problems: incomplete }; }

  const named = assertNoVendorNames();
  if (named.length) { return { ok: false, error_code: 'VENDOR_NAMED_AS_RECIPIENT', problems: named }; }

  const fill = (s) => String(s).replace(MOUSTACHE, (m, k) => {
    if (SLOTS.indexOf(k) === -1) { throw new Error('unknown slot: ' + k); }
    return String(c[k]);
  });

  const f = FULL[locale];
  const sections = REQUIRED_ELEMENTS.map((el) => ({
    key: el, heading: fill(f.elements[el].heading), body: fill(f.elements[el].body)
  }));

  const out = {
    version: NOTICE_VERSION,
    locale: locale,
    concise: { heading: CONCISE[locale].heading, body: fill(CONCISE[locale].body), link: CONCISE[locale].link },
    full: { title: f.title, intro: f.intro, sections: sections },
    acknowledgement: f.acknowledgement
  };

  // Nothing may reach a customer with a moustache still in it.
  const rendered = JSON.stringify(out);
  MOUSTACHE.lastIndex = 0;
  if (MOUSTACHE.test(rendered)) { return { ok: false, error_code: 'UNFILLED_SLOT' }; }
  if (rendered.indexOf(OWNER_INPUT_REQUIRED) !== -1) { return { ok: false, error_code: 'PLACEHOLDER_LEAKED' }; }
  // The legal-basis enum is server-side only; it must never appear in what the client receives.
  if (rendered.indexOf(LEGAL_BASIS_CANDIDATE) !== -1) { return { ok: false, error_code: 'LEGAL_BASIS_LEAKED' }; }

  return { ok: true, notice: out };
}

// What the deploy-time injector must supply, and what it looks like before the owner has decided.
const CONTROLLER_TEMPLATE = {
  controller_type: CONTROLLER_TYPE,
  controller_full_name: OWNER_INPUT_REQUIRED,
  controller_privacy_email: OWNER_INPUT_REQUIRED
};

// THE CONTROLLER, SUPPLIED BY THE OWNER 2026-09-04 (Gate 1). Recorded verbatim as given, and
// deliberately nothing more: no company form, no registration number, no address, no VAT number.
// FINMENTOR is the product and the brand; it is NOT the controller, and the notice text says so in
// both locales. These two values were never inferred from the domain, the repository, the Telegram
// account or any earlier document — every one of those would have produced a different, wrong name.
//
// They live here rather than in a deploy script because a legal identity is content, not
// configuration: it belongs beside the text that renders it, where a reviewer reading the notice
// can see exactly who it names. `render()` still validates, so the placeholder refusal remains the
// safety net if this is ever emptied.
const CONTROLLER = {
  controller_type: CONTROLLER_TYPE,
  controller_full_name: 'Iacovlev Ghennadi',
  controller_privacy_email: 'cfo@finmentor.md'
};

module.exports = {
  NOTICE_VERSION, LEGAL_BASIS_CANDIDATE, LEGAL_BASIS_PENDING,
  CONTROLLER_TYPE, SLOTS, OWNER_INPUT_REQUIRED, CONTROLLER_TEMPLATE, CONTROLLER,
  REQUIRED_ELEMENTS, LOCALES, CONCISE, FULL,
  assertComplete, assertNoVendorNames, VENDOR_NAMES, VENDOR_SCOPED, slotsUsed, render
};
