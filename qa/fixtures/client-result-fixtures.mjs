// FINMENTOR — realistic CLIENT_READY result fixtures for the customer result screen.
//
// Shared by qa/premium-ux-result-render.test.mjs (the golden render gate) and
// scripts/build-result-preview.mjs (the offline visual preview), so the screen a reviewer looks at
// is the screen the gate holds. Shape = the curated contract pinned by qa/client-result-contract:
// { locale, labels, score, zone, zone_label, maturity, summary, key_risks, management_priorities,
//   plan_30_days, tomorrow_actions, recommended_next_step } — and nothing else.
//
// Four cases: RU/RO × scored/unscored. Five risks, three priorities, four stages of two or three
// actions, three next-day actions. The content is advisory prose, not lorem ipsum, because line
// length and wrapping are part of what the preview is for.

export const LABELS_RU = {
  product: 'Финансовый рентген бизнеса', condition: 'Финансовое состояние', score: 'Оценка', zone: 'Зона риска',
  maturity: 'Зрелость финансового управления', risks: 'Ключевые риски', priorities: 'Приоритеты управления',
  plan: 'План финансовых действий на 30 дней', tomorrow: 'Следующее действие', next: 'Рекомендация FINMENTOR'
};

export const LABELS_RO = {
  product: 'Test de sănătate financiară FINMENTOR', condition: 'Starea financiară', score: 'Scor', zone: 'Zona de risc',
  maturity: 'Maturitatea managementului financiar', risks: 'Riscuri-cheie', priorities: 'Priorități de management',
  plan: 'Plan de acțiune financiară pentru 30 de zile', tomorrow: 'Următoarea acțiune', next: 'Recomandarea FINMENTOR'
};

const act = (action, owner_role, expected_output, control_or_kpi, priority) => ({ action, owner_role, expected_output, control_or_kpi, priority });

export const RESULT_RU_SCORE = {
  locale: 'ru',
  labels: LABELS_RU,
  score: 47, zone: 'ORANGE', zone_label: 'Оранжевая зона',
  maturity: {
    score_1_to_5: 2, label: 'Реактивное управление',
    rationale: 'Решения принимаются по факту событий: нет управленческого P&L, платёжного календаря и регулярного контроля дебиторской задолженности.'
  },
  summary: 'Бизнес операционно прибыльный, но финансовое управление реактивное: платежи планируются по остатку на счёте, дебиторская задолженность не контролируется, а управленческая отчётность отсутствует. В ближайшие 30 дней ключевая задача — вернуть контроль над денежным потоком и получить достоверную картину прибыли по направлениям.',
  key_risks: [
    { title: 'Кассовые разрывы', category: 'cash', evidence: 'Оплаты поставщикам зависят от поступлений; в анкете указаны просрочки платежей за последние три месяца.', potential_impact: 'Штрафы, ухудшение условий у поставщиков, остановка закупок.', priority: 'HIGH' },
    { title: 'Неконтролируемая дебиторская задолженность', category: 'receivables', evidence: 'Отсрочки клиентам предоставляются без лимитов; учёт просрочки не ведётся.', potential_impact: 'Замороженные оборотные средства и потери по безнадёжным долгам.', priority: 'HIGH' },
    { title: 'Отсутствие управленческого P&L', category: 'reporting', evidence: 'Прибыль оценивается по остатку на счёте; себестоимость по направлениям не рассчитывается.', potential_impact: 'Убыточные направления финансируются за счёт прибыльных незаметно для собственника.', priority: 'MEDIUM' },
    { title: 'Зависимость от одного клиента', category: 'concentration', evidence: 'Крупнейший клиент формирует существенную долю выручки, по данным анкеты.', potential_impact: 'Потеря клиента оставляет постоянные расходы без покрытия.', priority: 'MEDIUM' },
    { title: 'Смешение личных и бизнес-финансов', category: 'governance', evidence: 'Изъятия собственника не фиксируются как дивиденды или заём.', potential_impact: 'Искажённая картина прибыли и налоговые риски.', priority: 'LOW' }
  ],
  management_priorities: [
    'Платёжный календарь и еженедельный контроль денежного потока',
    'Управленческий P&L по направлениям',
    'Регламент работы с дебиторской задолженностью'
  ],
  plan_30_days: {
    days_1_7: [
      act('Собрать остатки по всем счетам и кассам', 'Собственник', 'Таблица остатков на утро каждого дня', 'ежедневно', 'HIGH'),
      act('Составить реестр обязательств на 30 дней', 'Бухгалтер', 'Реестр платежей с датами и суммами', 'к концу недели', 'HIGH'),
      act('Зафиксировать список просроченной дебиторской задолженности', 'Менеджер по продажам', 'Реестр дебиторов с суммой и сроком просрочки', 'к концу недели', 'HIGH')
    ],
    days_8_14: [
      act('Запустить платёжный календарь на четыре недели', 'Бухгалтер', 'Календарь с планом поступлений и выплат', 'еженедельно', 'HIGH'),
      act('Согласовать с ключевыми поставщиками график платежей', 'Собственник', 'Подтверждённые сроки оплат', 'по итогам переговоров', 'MEDIUM')
    ],
    days_15_21: [
      act('Собрать управленческий P&L за прошлый месяц', 'Бухгалтер', 'P&L по направлениям с маржой', 'до 21-го дня', 'MEDIUM'),
      act('Установить лимиты отсрочки для клиентов', 'Собственник', 'Утверждённые лимиты и сроки', 'по каждому клиенту', 'MEDIUM')
    ],
    days_22_30: [
      act('Утвердить бюджет движения денежных средств на следующий месяц', 'Собственник', 'Бюджет ДДС', 'ежемесячно', 'MEDIUM'),
      act('Разделить личные и бизнес-финансы', 'Собственник', 'Регламент изъятий собственника', 'с первого числа', 'LOW'),
      act('Провести первый еженедельный финансовый обзор', 'Собственник', 'Протокол обзора с решениями', 'еженедельно', 'MEDIUM')
    ]
  },
  tomorrow_actions: [
    'Назначить ответственного за ежедневный контроль остатков',
    'Выгрузить список просроченных счетов клиентов',
    'Согласовать формат платёжного календаря с бухгалтером'
  ],
  recommended_next_step: {
    product: 'FINANCIAL_HEALTH_CHECK', label: 'Финансовый health-check',
    rationale: 'Полная диагностика подтвердит причины кассовых разрывов и позволит выстроить систему контроля денежного потока.'
  }
};

export const RESULT_RU_NOSCORE = Object.assign({}, RESULT_RU_SCORE, {
  score: null, zone: 'UNKNOWN', zone_label: 'Без оценки',
  summary: 'По имеющимся ответам количественная оценка не сформирована: не хватает данных о выручке, структуре затрат и остатках денежных средств. Качественная картина при этом указывает на реактивное управление денежным потоком и отсутствие управленческой отчётности; приоритет ближайших 30 дней — собрать исходные данные и вернуть контроль над платежами.'
});

export const RESULT_RO_SCORE = {
  locale: 'ro',
  labels: LABELS_RO,
  score: 47, zone: 'ORANGE', zone_label: 'Zonă portocalie',
  maturity: {
    score_1_to_5: 2, label: 'Control reactiv',
    rationale: 'Deciziile se iau după producerea evenimentelor: nu există P&L managerial, calendar de plăți și nici un control regulat al creanțelor.'
  },
  summary: 'Afacerea este profitabilă operațional, însă managementul financiar este reactiv: plățile sunt planificate după soldul contului, creanțele nu sunt controlate, iar raportarea managerială lipsește. În următoarele 30 de zile, sarcina-cheie este recâștigarea controlului asupra fluxului de numerar și obținerea unei imagini fidele a profitului pe linii de activitate.',
  key_risks: [
    { title: 'Decalaje de numerar', category: 'cash', evidence: 'Plățile către furnizori depind de încasări; chestionarul indică întârzieri la plată în ultimele trei luni.', potential_impact: 'Penalități, condiții mai slabe de la furnizori, oprirea achizițiilor.', priority: 'HIGH' },
    { title: 'Creanțe necontrolate', category: 'receivables', evidence: 'Termenele de plată sunt acordate clienților fără limite; întârzierile nu sunt evidențiate.', potential_impact: 'Capital de lucru blocat și pierderi din creanțe nerecuperabile.', priority: 'HIGH' },
    { title: 'Lipsa unui P&L managerial', category: 'reporting', evidence: 'Profitul este apreciat după soldul contului; costul pe linii de activitate nu este calculat.', potential_impact: 'Liniile neprofitabile sunt finanțate din cele profitabile fără ca proprietarul să observe.', priority: 'MEDIUM' },
    { title: 'Dependența de un singur client', category: 'concentration', evidence: 'Cel mai mare client generează o pondere semnificativă a veniturilor, conform chestionarului.', potential_impact: 'Pierderea clientului lasă costurile fixe neacoperite.', priority: 'MEDIUM' },
    { title: 'Amestecarea finanțelor personale cu cele ale afacerii', category: 'governance', evidence: 'Retragerile proprietarului nu sunt înregistrate ca dividende sau împrumut.', potential_impact: 'Imagine distorsionată a profitului și riscuri fiscale.', priority: 'LOW' }
  ],
  management_priorities: [
    'Calendar de plăți și control săptămânal al fluxului de numerar',
    'P&L managerial pe linii de activitate',
    'Procedură de lucru cu creanțele'
  ],
  plan_30_days: {
    days_1_7: [
      act('Colectați soldurile din toate conturile și casieriile', 'Proprietar', 'Tabel al soldurilor în fiecare dimineață', 'zilnic', 'HIGH'),
      act('Întocmiți registrul obligațiilor pe 30 de zile', 'Contabil', 'Registru de plăți cu date și sume', 'până la finalul săptămânii', 'HIGH'),
      act('Fixați lista creanțelor restante', 'Manager de vânzări', 'Registru al debitorilor cu sume și termene depășite', 'până la finalul săptămânii', 'HIGH')
    ],
    days_8_14: [
      act('Lansați calendarul de plăți pe patru săptămâni', 'Contabil', 'Calendar cu planul încasărilor și plăților', 'săptămânal', 'HIGH'),
      act('Conveniți cu furnizorii-cheie un grafic de plăți', 'Proprietar', 'Termene de plată confirmate', 'după negocieri', 'MEDIUM')
    ],
    days_15_21: [
      act('Întocmiți P&L managerial pentru luna precedentă', 'Contabil', 'P&L pe linii de activitate, cu marjă', 'până în ziua 21', 'MEDIUM'),
      act('Stabiliți limite de amânare a plății pentru clienți', 'Proprietar', 'Limite și termene aprobate', 'pentru fiecare client', 'MEDIUM')
    ],
    days_22_30: [
      act('Aprobați bugetul fluxului de numerar pentru luna următoare', 'Proprietar', 'Buget al fluxului de numerar', 'lunar', 'MEDIUM'),
      act('Separați finanțele personale de cele ale afacerii', 'Proprietar', 'Procedură pentru retragerile proprietarului', 'de la începutul lunii', 'LOW'),
      act('Organizați prima revizuire financiară săptămânală', 'Proprietar', 'Proces-verbal cu decizii', 'săptămânal', 'MEDIUM')
    ]
  },
  tomorrow_actions: [
    'Desemnați un responsabil pentru controlul zilnic al soldurilor',
    'Extrageți lista facturilor restante ale clienților',
    'Conveniți cu contabilul formatul calendarului de plăți'
  ],
  recommended_next_step: {
    product: 'FINANCIAL_HEALTH_CHECK', label: 'Diagnostic financiar complet',
    rationale: 'O diagnoză completă va confirma cauzele decalajelor de numerar și va permite construirea unui sistem de control al fluxului de numerar.'
  }
};

export const RESULT_RO_NOSCORE = Object.assign({}, RESULT_RO_SCORE, {
  score: null, zone: 'UNKNOWN', zone_label: 'Fără scor',
  summary: 'Pe baza răspunsurilor disponibile nu a fost formulată o evaluare cantitativă: lipsesc datele despre venituri, structura costurilor și soldurile de numerar. Imaginea calitativă indică totuși un control reactiv al fluxului de numerar și absența raportării manageriale; prioritatea următoarelor 30 de zile este colectarea datelor de intrare și recâștigarea controlului asupra plăților.'
});

export const RESULT_FIXTURES = {
  'ru-score': RESULT_RU_SCORE,
  'ru-noscore': RESULT_RU_NOSCORE,
  'ro-score': RESULT_RO_SCORE,
  'ro-noscore': RESULT_RO_NOSCORE
};

export const RESULT_CASES = Object.keys(RESULT_FIXTURES);
