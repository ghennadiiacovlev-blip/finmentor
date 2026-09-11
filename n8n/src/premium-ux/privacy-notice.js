// FINMENTOR Privacy & Data Governance v1 — controlled notice content.
//
// This module is the authority for the notice version, the two-layer Mini App copy and the
// semantics that the public RU/RO policies must expose. The browser bundle is generated from
// MINI_APP by scripts/build-premium-app-content.mjs; the submit candidate is generated with the
// same NOTICE_VERSION and LEGAL_BASIS by scripts/build-premium-endpoints.mjs.

'use strict';

const NOTICE_VERSION = 'pn-2026-09-11.v1';
const UPDATED_DATE = '2026-09-11';
const LEGAL_BASIS = 'pre_contractual_request';

const CONTROLLER_TYPE = 'natural_person';
const SLOTS = ['controller_full_name', 'controller_privacy_email'];
const OWNER_INPUT_REQUIRED = 'OWNER_INPUT_REQUIRED';
const CONTROLLER_TEMPLATE = {
  controller_type: CONTROLLER_TYPE,
  controller_full_name: OWNER_INPUT_REQUIRED,
  controller_privacy_email: OWNER_INPUT_REQUIRED
};
const CONTROLLER = {
  controller_type: CONTROLLER_TYPE,
  controller_full_name: 'Iacovlev Ghennadi',
  controller_privacy_email: 'cfo@finmentor.md'
};

const MINI_APP = {
  ru: {
    lines: [
      'Используем данные брифа, чтобы рассмотреть ваш запрос, подготовить консультанта и связаться с вами.',
      'В Intake и Financial X-Ray искусственный интеллект получает минимизированные, псевдонимизированные данные без прямых идентификаторов; результат проверяет человек до публикации. Юридически значимых полностью автоматических решений нет.',
      'Полная информация доступна по ссылке ниже. Отправка подтверждает ознакомление с ней, но не является согласием на маркетинг.',
      'Не указывайте пароли, PIN/CVV, полные данные банковских карт и другую информацию, которая не нужна для финансового анализа.'
    ],
    links: ['Полная политика конфиденциальности'],
    entryLink: 'Конфиденциальность и данные',
    primary: 'Передать консультанту'
  },
  ro: {
    lines: [
      'Folosim datele din brief pentru a examina solicitarea, a pregăti consultantul și a vă contacta.',
      'În Intake și Financial X-Ray, inteligența artificială primește date minimizate și pseudonimizate, fără identificatori direcți; rezultatul este verificat de o persoană înainte de publicare. Nu există decizii exclusiv automate cu efecte juridice sau similare semnificative.',
      'Informația completă este disponibilă prin linkul de mai jos. Trimiterea confirmă că ați luat cunoștință de ea, dar nu reprezintă consimțământ pentru marketing.',
      'Nu indicați parole, PIN/CVV, datele complete ale cardurilor bancare sau alte informații care nu sunt necesare pentru analiza financiară.'
    ],
    links: ['Politica de confidențialitate completă'],
    entryLink: 'Confidențialitate și date',
    primary: 'Trimite consultantului'
  }
};

const CONCISE = {
  ru: { heading: 'Коротко о данных', body: MINI_APP.ru.lines.join(' '), link: MINI_APP.ru.links[0] },
  ro: { heading: 'Pe scurt despre date', body: MINI_APP.ro.lines.join(' '), link: MINI_APP.ro.links[0] }
};

// Public pages may use different headings and layout, but every semantic key must remain present
// in both languages. qa/privacy-data-governance.test.mjs locks the pages to this inventory.
const REQUIRED_ELEMENTS = [
  'controller', 'purposes', 'legal_basis', 'categories', 'recipients', 'transfers',
  'retention', 'rights', 'complaint', 'ai_processing', 'automated_decisions', 'marketing',
  'voluntary'
];
const FULL_POLICY_SEMANTICS = REQUIRED_ELEMENTS.slice();
const LOCALES = ['ru', 'ro'];

const FULL = {
  ru: {
    title: 'Обработка персональных данных',
    intro: 'Информация подготовлена с учётом Закона Республики Молдова № 195/2024 о защите персональных данных в действующей редакции.',
    elements: {
      controller: { heading: 'Кто обрабатывает данные', body: 'Оператор — физическое лицо {{controller_full_name}}, Республика Молдова. FINMENTOR — название проекта, а не отдельное юридическое лицо. Контакт по вопросам конфиденциальности: {{controller_privacy_email}}.' },
      purposes: { heading: 'Для чего', body: 'Данные используются для рассмотрения обращения, подготовки и проведения финансового разбора, связи и прогресса по запросу, защиты сервиса от повторов и злоупотреблений, исполнения договора, а аналитика сайта — только после согласия.' },
      legal_basis: { heading: 'Правовые основания', body: 'Обращение и необходимая коммуникация обрабатываются для действий по вашему запросу до заключения договора (ст. 6(1)(b)); минимальные меры безопасности и предотвращения повторов — в законном интересе безопасности; Google Analytics 4 — только на основании согласия. Для активного клиента применяются договорные и обязательные законодательные основания.' },
      categories: { heading: 'Какие данные', body: 'Имя, роль, компания, выбранный контакт, Telegram-идентификатор, сведения о бизнесе и финансовом учёте, ответы и свободный текст, переписка, данные сессии и подтверждения ознакомления, минимальные журналы безопасности, а после согласия — разрешённые данные аналитики.' },
      recipients: { heading: 'Кто имеет доступ', body: 'Оператор и необходимые поставщики по категориям: хостинг, база данных, автоматизация, рабочие таблицы, мессенджер, электронная почта, веб-аналитика и поставщик AI. Отдельный реестр поставщиков и подтверждающих документов поддерживается оператором.' },
      transfers: { heading: 'Международные передачи', body: 'Некоторые поставщики могут обрабатывать данные за пределами Республики Молдова. Для фактической обработки в ЕЭЗ специальное разрешение по главе о международных передачах не требуется; для иных направлений оператор проверяет применимый законный механизм. Неподтверждённые гарантии не заявляются.' },
      retention: { heading: 'Сроки хранения', body: 'Незавершённая сессия логически истекает через 72 часа, а прошедшие срок записи удаляются при еженедельной проверке. Непреобразованный лид хранится 12 месяцев с последнего содержательного взаимодействия и затем удаляется при ежемесячной проверке, если нет иного основания. Активные клиенты — срок договора плюс применимые бухгалтерские и установленные законом сроки. Подтверждение ознакомления — 3 года после закрытия или последнего связанного взаимодействия как внутренний доказательственный срок.' },
      rights: { heading: 'Ваши права', body: 'В применимых случаях вы можете запросить доступ, исправление, удаление, ограничение, возразить против обработки и получить переносимость данных. Если обработка основана на согласии, его можно отозвать без влияния на законность предшествующей обработки. Обычный срок ответа — один месяц.' },
      complaint: { heading: 'Жалоба', body: 'Вы вправе обратиться с жалобой в Национальный центр по защите персональных данных Республики Молдова (CNPDCP).' },
      ai_processing: { heading: 'AI и Financial X-Ray', body: 'Для AI используется минимизированная, псевдонимизированная проекция: прямые идентификаторы удаляются до обработки. Поскольку оператор может связать результат с обращением, эти данные не называются анонимными. Financial X-Ray — предварительный управленческий анализ с проверкой человеком до публикации клиенту.' },
      automated_decisions: { heading: 'Автоматизированные решения', body: 'FINMENTOR не принимает исключительно автоматизированных решений, создающих юридические или аналогично значимые последствия для субъекта данных.' },
      marketing: { heading: 'Маркетинг', body: 'В версии v1 маркетинг не используется. Ознакомление с политикой не является маркетинговым согласием; будущий маркетинг потребует отдельного законного основания и выбора.' },
      voluntary: { heading: 'Обязательно ли предоставлять данные', body: 'Предоставление данных добровольно, но без минимальных сведений FINMENTOR не сможет рассмотреть запрос или ответить на него.' }
    },
    acknowledgement: 'Отправляя бриф, я подтверждаю, что ознакомился с информацией об обработке персональных данных.'
  },
  ro: {
    title: 'Prelucrarea datelor cu caracter personal',
    intro: 'Informația este pregătită ținând cont de Legea Republicii Moldova nr. 195/2024 privind protecția datelor cu caracter personal, în versiunea în vigoare.',
    elements: {
      controller: { heading: 'Cine prelucrează datele', body: 'Operatorul este persoana fizică {{controller_full_name}}, Republica Moldova. FINMENTOR este denumirea proiectului, nu o persoană juridică separată. Contact pentru confidențialitate: {{controller_privacy_email}}.' },
      purposes: { heading: 'În ce scop', body: 'Datele sunt folosite pentru examinarea solicitării, pregătirea și efectuarea analizei financiare, comunicarea și progresul solicitării, protecția serviciului împotriva repetărilor și abuzurilor, executarea contractului, iar analitica site-ului — numai după consimțământ.' },
      legal_basis: { heading: 'Temeiurile juridice', body: 'Solicitarea și comunicarea necesară sunt prelucrate pentru demersuri la cererea dvs. înainte de încheierea contractului (art. 6 alin. (1) lit. b)); măsurile minime de securitate și prevenire a repetărilor — în interesul legitim de securitate; Google Analytics 4 — numai în baza consimțământului. Pentru clienții activi se aplică temeiurile contractuale și obligațiile legale.' },
      categories: { heading: 'Ce date', body: 'Numele, rolul, compania, contactul ales, identificatorul Telegram, informații despre afacere și evidența financiară, răspunsuri și text liber, corespondență, date de sesiune și dovada informării, jurnale minime de securitate, iar după consimțământ — datele de analiză permise.' },
      recipients: { heading: 'Cine are acces', body: 'Operatorul și furnizorii necesari pe categorii: găzduire, bază de date, automatizare, foi de calcul de lucru, mesagerie, e-mail, analiză web și furnizor AI. Operatorul menține separat registrul furnizorilor și al dovezilor.' },
      transfers: { heading: 'Transferuri internaționale', body: 'Unii furnizori pot prelucra date în afara Republicii Moldova. Pentru prelucrarea efectivă în SEE nu este necesară o autorizare specială potrivit capitolului privind transferurile internaționale; pentru alte destinații operatorul verifică mecanismul legal aplicabil. Nu sunt declarate garanții neverificate.' },
      retention: { heading: 'Termene de păstrare', body: 'Sesiunea nefinalizată expiră logic după 72 de ore, iar înregistrările expirate se șterg la verificarea săptămânală. Un lead neconvertit se păstrează 12 luni de la ultima interacțiune semnificativă și apoi se șterge la verificarea lunară, dacă nu există alt temei. Clienții activi — durata contractului plus termenele contabile și legale aplicabile. Dovada informării — 3 ani după închidere sau ultima interacțiune asociată, ca termen probator intern.' },
      rights: { heading: 'Drepturile dvs.', body: 'După caz, puteți cere accesul, rectificarea, ștergerea, restricționarea, vă puteți opune prelucrării și puteți solicita portabilitatea datelor. Dacă prelucrarea se bazează pe consimțământ, acesta poate fi retras fără a afecta legalitatea prelucrării anterioare. Termenul obișnuit de răspuns este de o lună.' },
      complaint: { heading: 'Plângere', body: 'Aveți dreptul să depuneți o plângere la Centrul Național pentru Protecția Datelor cu Caracter Personal al Republicii Moldova (CNPDCP).' },
      ai_processing: { heading: 'AI și Financial X-Ray', body: 'Pentru AI se folosește o proiecție minimizată și pseudonimizată: identificatorii direcți sunt eliminați înainte de prelucrare. Deoarece operatorul poate asocia rezultatul cu solicitarea, datele nu sunt descrise ca anonime. Financial X-Ray este o analiză managerială preliminară, verificată de o persoană înainte de publicarea către client.' },
      automated_decisions: { heading: 'Decizii automatizate', body: 'FINMENTOR nu ia decizii bazate exclusiv pe prelucrare automată care produc efecte juridice sau efecte similare semnificative asupra persoanei vizate.' },
      marketing: { heading: 'Marketing', body: 'În versiunea v1 nu se utilizează marketingul. Luarea la cunoștință a politicii nu este consimțământ pentru marketing; orice marketing viitor va necesita un temei legal și o alegere separată.' },
      voluntary: { heading: 'Este obligatorie furnizarea datelor', body: 'Furnizarea datelor este voluntară, dar fără informațiile minime FINMENTOR nu poate examina solicitarea sau răspunde.' }
    },
    acknowledgement: 'Prin trimiterea briefului confirm că am luat cunoștință de informația privind prelucrarea datelor cu caracter personal.'
  }
};

const VENDOR_NAMES = ['GitHub', 'Google', 'n8n', 'Supabase', 'Telegram', 'OpenAI'];
const VENDOR_SCOPED = ['recipients'];
const MOUSTACHE = /\{\{([a-z_]+)\}\}/g;

function assertComplete() {
  const problems = [];
  for (const locale of LOCALES) {
    const full = FULL[locale];
    if (!full || !full.title || !full.intro || !full.acknowledgement) problems.push(locale + ': shell incomplete');
    for (const key of REQUIRED_ELEMENTS) {
      const value = full && full.elements && full.elements[key];
      if (!value || !value.heading || !value.body) problems.push(locale + ': element "' + key + '" missing');
    }
    for (const key of Object.keys((full && full.elements) || {})) {
      if (REQUIRED_ELEMENTS.indexOf(key) === -1) problems.push(locale + ': unexpected element "' + key + '"');
    }
  }
  return problems;
}

function assertNoVendorNames() {
  const problems = [];
  for (const locale of LOCALES) {
    for (const key of VENDOR_SCOPED) {
      const body = FULL[locale].elements[key].body;
      for (const vendor of VENDOR_NAMES) {
        if (new RegExp('\\b' + vendor + '\\b', 'i').test(body)) problems.push(locale + '/' + key + ': ' + vendor);
      }
    }
  }
  return problems;
}

function slotsUsed() {
  const found = Object.create(null);
  const walk = (value) => {
    if (typeof value === 'string') {
      let match; MOUSTACHE.lastIndex = 0;
      while ((match = MOUSTACHE.exec(value))) found[match[1]] = true;
    } else if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) walk(value[key]);
    }
  };
  walk(FULL);
  return Object.keys(found).sort();
}

function render(locale, controller) {
  if (LOCALES.indexOf(locale) === -1) return { ok: false, error_code: 'BAD_LOCALE' };
  const c = controller || {};
  const missing = [];
  if (String(c.controller_type || '') !== CONTROLLER_TYPE) missing.push('controller_type');
  for (const slot of SLOTS) {
    const value = String(c[slot] == null ? '' : c[slot]).trim();
    if (!value || value === OWNER_INPUT_REQUIRED) missing.push(slot);
  }
  if (missing.length) return { ok: false, error_code: 'CONTROLLER_IDENTITY_REQUIRED', missing };
  const completeness = assertComplete();
  if (completeness.length) return { ok: false, error_code: 'NOTICE_INCOMPLETE', problems: completeness };
  const vendors = assertNoVendorNames();
  if (vendors.length) return { ok: false, error_code: 'VENDOR_NAMED_AS_RECIPIENT', problems: vendors };

  const fill = (value) => String(value).replace(MOUSTACHE, (all, key) => String(c[key]));
  const full = FULL[locale];
  const notice = {
    version: NOTICE_VERSION,
    updated_at: UPDATED_DATE,
    locale,
    concise: { heading: CONCISE[locale].heading, body: CONCISE[locale].body, link: CONCISE[locale].link },
    full: { title: full.title, intro: full.intro, sections: REQUIRED_ELEMENTS.map((key) => ({ key, heading: fill(full.elements[key].heading), body: fill(full.elements[key].body) })) },
    acknowledgement: full.acknowledgement
  };
  const serialised = JSON.stringify(notice);
  if (/\{\{/.test(serialised) || serialised.indexOf(OWNER_INPUT_REQUIRED) !== -1) return { ok: false, error_code: 'UNFILLED_SLOT' };
  if (serialised.indexOf(LEGAL_BASIS) !== -1) return { ok: false, error_code: 'LEGAL_BASIS_ENUM_LEAKED' };
  return { ok: true, notice };
}

module.exports = {
  NOTICE_VERSION, UPDATED_DATE, LEGAL_BASIS,
  CONTROLLER_TYPE, SLOTS, OWNER_INPUT_REQUIRED, CONTROLLER_TEMPLATE, CONTROLLER,
  MINI_APP, CONCISE, REQUIRED_ELEMENTS, FULL_POLICY_SEMANTICS, LOCALES, FULL,
  VENDOR_NAMES, VENDOR_SCOPED, assertComplete, assertNoVendorNames, slotsUsed, render
};
