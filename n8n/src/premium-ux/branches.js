// FINMENTOR Premium UX — the content contract.
//
// SINGLE SOURCE OF TRUTH for every client-visible option, label and controlled map in the
// Premium Mini App and the Concierge entry. Transcribed from docs/PREMIUM_UX_FINAL_RU_SPEC.md
// (DESIGN = FINAL APPROVED, closure fcfd56e) and the authoritative Telegram copy in the Phase 3
// owner decision.
//
// WHY THIS FILE EXISTS AT ALL. The handoff forbids implementation from inventing, consolidating,
// renaming or removing copy, options or branches. That is only enforceable if there is exactly
// one place the strings live and a gate that compares it to the spec. qa/premium-ux-content.test.mjs
// reads docs/PREMIUM_UX_FINAL_RU_SPEC.md and requires every string below to appear in it verbatim,
// so a drifted label fails the build rather than reaching a client.
//
// Nothing here is executable policy. Skip rules live in draft-contract.js, the Lead Intake
// projection in submit-projection.js, the brief in meeting-brief.js. This module is data.

'use strict';

// ---------------------------------------------------------------- objective taxonomy (spec §4)
// Exactly eight, in spec order. `id` is internal and never shown; `label` is what the client sees
// and what ЗАДАЧА renders verbatim (spec §26).
const OBJECTIVES = [
  { id: 'financial_management', label: 'Финансовое управление', line: 'Отчётность, бюджетирование, контроль, финансовая функция' },
  { id: 'profitability',        label: 'Прибыль и эффективность', line: 'Маржа, расходы, себестоимость, экономика бизнеса' },
  { id: 'cash_flow',            label: 'Денежный поток',          line: 'Cash Flow, кассовые разрывы, ликвидность' },
  { id: 'investment',           label: 'Инвестиция / новый проект', line: 'Финмодель, доходность, сценарии, риски' },
  { id: 'real_estate',          label: 'Недвижимость / сделка',   line: 'Покупка, продажа, аренда, инвестиционная оценка' },
  { id: 'financing',            label: 'Финансирование',          line: 'Банк, инвестор, структура капитала' },
  { id: 'independent_view',     label: 'Нужен независимый взгляд', line: 'Помочь определить, где находится основная проблема' },
  { id: 'other',                label: 'Другая задача',           line: 'Если задача не подходит под категории выше' }
];

const OBJECTIVE_SCREEN = {
  title: 'Что сейчас важнее всего?',
  lead: 'Один пункт. Остальное консультант уточнит в разговоре.'
};

// The last option of every CARD problem set. Selecting it reveals the free-text field on the same
// screen; it is not a separate state.
const PROBLEM_FREE_TEXT_OPTION = 'Опишу ситуацию своими словами';

// ---------------------------------------------------------------- problem sets (spec §5, §7, §8)
// `mode: 'cards'` → advisory cards + the free-text option above.
// `mode: 'free_text'` → no diagnostic cards at all (spec §7, §8). The client is never auto-diagnosed
// from this text; see meeting-brief.js, which quotes it and never interprets it.
const PROBLEMS = {
  financial_management: {
    mode: 'cards',
    title: 'Где сейчас основная сложность?',
    options: [
      ['Нет своевременной управленческой отчётности', 'Цифры появляются слишком поздно для принятия решений'],
      ['Не доверяем данным', 'Отчёты есть, но цифры расходятся или вызывают вопросы'],
      ['Нет бюджета и план-факта', 'Сложно контролировать отклонения и заранее видеть результат'],
      ['Финансы зависят от ручной работы', 'Много Excel, сверок и процессов, завязанных на отдельных людей'],
      ['Нет полноценной финансовой функции', 'Нужно выстроить роль CFO, ответственность и систему управления'],
      ['Система есть, но хотим её улучшить', 'Нужно повысить качество, скорость и управляемость']
    ]
  },
  profitability: {
    mode: 'cards',
    title: 'Где сейчас теряется экономический результат?',
    options: [
      ['Не понимаем реальную прибыль', 'Бухгалтерский результат не даёт полной управленческой картины'],
      ['Снижается маржа', 'Выручка есть, но прибыльность бизнеса ухудшается'],
      ['Расходы растут быстрее бизнеса', 'Нужно определить причины и точки контроля'],
      ['Не видим прибыль по направлениям', 'Непонятно, какие продукты, объекты или подразделения создают результат'],
      ['Не уверены в себестоимости', 'Нужно правильно распределить затраты и определить экономику продукта'],
      ['Нужно пересмотреть цены', 'Нет уверенности, что текущая цена обеспечивает нужную доходность']
    ]
  },
  cash_flow: {
    mode: 'cards',
    title: 'Что именно происходит с деньгами?',
    options: [
      ['Прибыль есть, денег не хватает', 'Продажи идут, но на счёте постоянно тесно'],
      ['Нет ясного прогноза', 'Непонятно, что будет с деньгами через 2–3 месяца'],
      ['Кассовые разрывы повторяются', 'Приходится закрывать их срочно и дорого'],
      ['Платежи идут хаотично', 'Нет календаря и приоритетов по оплатам'],
      ['Проблемы с дебиторкой', 'Деньги слишком долго остаются у клиентов']
    ]
  },
  investment: {
    mode: 'cards',
    title: 'Какое решение нужно принять по проекту?',
    options: [
      ['Стоит ли инвестировать', 'Нужно объективно оценить экономическую целесообразность'],
      ['Неясна реальная доходность', 'Нужно проверить возврат капитала и денежные потоки'],
      ['Слишком много неопределённости', 'Нужно сравнить сценарии и ключевые риски'],
      ['Есть предложение партнёра', 'Нужно проверить экономику и условия сделки'],
      ['Нужно определить объём инвестиций', 'CAPEX и будущая потребность в финансировании пока неясны'],
      ['Есть финансовая модель, но ей не доверяем', 'Нужна независимая проверка']
    ]
  },
  real_estate: {
    mode: 'cards',
    title: 'Какое решение рассматриваете?',
    options: [
      ['Покупка объекта', ''],
      ['Продажа объекта', ''],
      ['Оставить объект и сдавать в аренду', ''],
      ['Нужно определить справедливую стоимость', ''],
      ['Реконструкция / redevelopment', ''],
      ['Нужно проверить доходность объекта', ''],
      ['Есть риск по арендатору или договору', '']
    ]
  },
  financing: {
    mode: 'cards',
    title: 'Что сейчас требует решения?',
    options: [
      ['Нужно банковское финансирование', ''],
      ['Нужно привлечь инвестора', ''],
      ['Не устраивает текущая долговая нагрузка', ''],
      ['Нужно рефинансирование', ''],
      ['Нужно финансирование нового проекта', ''],
      ['Нужно подготовиться к переговорам с банком', ''],
      ['Неясно, сколько долга бизнес может безопасно обслуживать', '']
    ]
  },
  independent_view: {
    mode: 'free_text',
    title: 'Какое решение сейчас сложно принять?',
    copy: [
      'Опишите ситуацию своими словами.',
      'Особенно полезно понять, какое решение вы откладываете или где вам не хватает финансовой информации.'
    ],
    placeholder: 'Например: бизнес растёт, но я не понимаю, почему денег становится меньше и могу ли сейчас открывать ещё одну точку.'
  },
  other: {
    mode: 'free_text',
    title: 'Расскажите о задаче',
    copy: ['Опишите ситуацию так, как рассказали бы её консультанту на первой встрече.'],
    placeholder: 'Что происходит, какое решение нужно принять и что сейчас мешает его принять?'
  }
};

// ---------------------------------------------------------------- desired outcome sets (spec §6)
// Single selection: "в первую очередь". An empty explanatory line renders a title-only card — the
// same component with its second row omitted, never a new variant.
const OUTCOMES = {
  financial_management: {
    title: 'Какой результат вам нужен в первую очередь?',
    options: [
      ['Получать управленческую отчётность вовремя', 'P&L, Cash Flow, Balance и ключевые показатели'],
      ['Настроить бюджетирование и план-факт', 'Планировать результат и контролировать отклонения'],
      ['Создать понятную систему финансового контроля', 'Ответственность, правила, сроки и контрольные точки'],
      ['Выстроить финансовую функцию / CFO', 'Определить процессы, роли и формат управления'],
      ['Автоматизировать финансовую отчётность', 'Снизить ручную работу и зависимость от Excel'],
      ['Провести диагностику существующей системы', 'Понять, что работает, а что необходимо перестроить']
    ]
  },
  profitability: {
    title: 'Что хотите получить на выходе?',
    options: [
      ['Понять реальную прибыльность бизнеса', ''],
      ['Найти источники потерь и лишних расходов', ''],
      ['Посчитать прибыль по направлениям / продуктам', ''],
      ['Определить корректную себестоимость', ''],
      ['Пересмотреть цены и маржинальность', ''],
      ['Создать систему постоянного контроля эффективности', '']
    ]
  },
  cash_flow: {
    title: 'Какой результат вам нужен в первую очередь?',
    options: [
      ['Понять причины кассовых разрывов', 'Найти, где именно теряется ликвидность'],
      ['Получить прогноз движения денег', 'Понимать cash position на несколько месяцев вперёд'],
      ['Настроить платежи и контроль', 'Платёжный календарь, приоритеты, ответственность'],
      ['Подготовиться к банку / финансированию', 'Показать понятный прогноз и способность обслуживать обязательства'],
      ['Построить систему управления Cash Flow', 'Не разовый расчёт, а работающий процесс'],
      ['Нужна рекомендация, с чего начать', 'Сначала определить правильный формат решения']
    ]
  },
  investment: {
    title: 'Какой результат вам нужен?',
    options: [
      ['GO / NO-GO по инвестиции', ''],
      ['Профессиональная финансовая модель', ''],
      ['Расчёт IRR / NPV / Payback / MOIC', ''],
      ['Сравнение нескольких сценариев', ''],
      ['Оптимальная структура финансирования', ''],
      ['Независимая проверка проекта или предложения партнёра', '']
    ]
  },
  real_estate: {
    title: 'Что нужно получить для принятия решения?',
    options: [
      ['Оценить инвестиционную привлекательность', ''],
      ['Определить максимальную цену покупки', ''],
      ['Определить минимальную цену продажи', ''],
      ['Посчитать доходность владения', ''],
      ['Сравнить: продать или оставить', ''],
      ['Построить DCF / сценарную модель', ''],
      ['Оценить риски арендаторов и денежных потоков', '']
    ]
  },
  financing: {
    title: 'Какого результата ожидаете?',
    options: [
      ['Определить необходимый объём финансирования', ''],
      ['Подготовить финансовую модель для банка', ''],
      ['Определить безопасную долговую нагрузку', ''],
      ['Сравнить варианты финансирования', ''],
      ['Подготовить материалы для инвестора', ''],
      ['Выстроить структуру капитала', '']
    ]
  },
  independent_view: {
    title: 'Чем FINMENTOR должен помочь в первую очередь?',
    options: [
      ['Разобраться, где находится основная проблема', ''],
      ['Определить приоритеты', ''],
      ['Получить независимую оценку ситуации', ''],
      ['Понять, какие цифры нужно начать контролировать', ''],
      ['Подготовить варианты решения', ''],
      ['Сначала обсудить ситуацию с консультантом', '']
    ]
  },
  other: {
    title: 'Какой результат был бы для вас полезен?',
    options: [
      ['Получить расчёт', ''],
      ['Получить финансовую модель', ''],
      ['Сравнить варианты', ''],
      ['Проверить существующий расчёт / предложение', ''],
      ['Получить независимую рекомендацию', ''],
      ['Обсудить задачу с консультантом', ''],
      ['Опишу ожидаемый результат сам', '']
    ]
  }
};

// The one outcome option that opens a free-text field (spec §6.8, Другая задача only).
const OUTCOME_FREE_TEXT_OPTION = 'Опишу ожидаемый результат сам';

// ---------------------------------------------------------------- shared sets (spec §9–§14)

const COMPANY_SCREEN = { title: 'Компания', lead: 'Только то, что меняет подготовку консультанта.' };

// spec §9 — exactly six, nothing above €10 млн collapsed.
const SCALE_OPTIONS = [
  'до €500 тыс.',
  '€500 тыс. – €2 млн',
  '€2–10 млн',
  '€10–50 млн',
  '€50 млн+',
  'Предпочитаю не указывать'
];

// spec §10 — multi-select, eleven options. Canonical order is this order; a stored value is
// always sorted into it so rows are comparable (see submit-projection.js).
const CURRENT_SETUP = {
  title: 'На что уже можно опереться?',
  copy: 'Выберите всё, что действительно используется сегодня.',
  options: [
    'Бухгалтерский учёт',
    '1C / ERP',
    'Excel / ручные отчёты',
    'Управленческий P&L',
    'Cash Flow',
    'Бюджет',
    'План-факт',
    'BI / dashboards',
    'CFO / финансовая команда',
    'Финансовая модель',
    'Система есть, но требует улучшения'
  ]
};

// spec §11 — five, locked.
const DECISION_HORIZON = {
  title: 'Когда решение должно начать работать?',
  options: [
    ['В течение недели', 'Есть конкретная ситуация или решение'],
    ['2–4 недели', 'Результат нужен в ближайший месяц'],
    ['1–3 месяца', 'Можно провести полноценный цикл анализа'],
    ['Сначала хочу обсудить подход', 'Пока уточняем задачу и формат работы'],
    ['Жёсткого срока нет', '']
  ]
};

// OWNER DECISION A (Phase 3) — binary upload is deferred. v1 records AVAILABILITY only, into the
// existing documents_status / selected_documents. The UX must not pretend a file was uploaded, so
// there is no attach control and no file list anywhere in this contract.
const DOCUMENTS = {
  title: 'Материалы для подготовки',
  copy: [
    'Если у вас уже есть материалы по задаче, отметьте, что доступно.',
    'Специально готовить документы сейчас не требуется.'
  ],
  minimisation: [
    'Загружайте только материалы, необходимые для рассмотрения задачи.',
    'По возможности не включайте персональные данные сотрудников, клиентов или других третьих лиц, если они не нужны для анализа.'
  ],
  options: [
    'P&L',
    'Cash Flow',
    'Balance',
    'Бюджет',
    'Платёжный календарь',
    'Дебиторская и кредиторская задолженность',
    'Финансовая модель',
    'Другие материалы по задаче'
  ],
  continueWithout: 'Продолжить без материалов'
};

// spec §13 — three channels. Telegram selected ⇒ no phone and no email is requested.
const CONTACT = {
  title: 'Как удобнее продолжить?',
  options: [
    { id: 'telegram', label: 'Здесь, в Telegram' },
    { id: 'phone', label: 'По телефону' },
    { id: 'email', label: 'По email' }
  ],
  telegramNote: 'В Telegram номер телефона не нужен.'
};

// spec §14 — optional. Empty ⇒ the whole «Важно до встречи» section is omitted from the brief.
const IMPORTANT_CONTEXT = {
  label: 'Есть ли что-то, что особенно важно знать до разговора?',
  placeholder: 'Например: через месяц встреча с банком; решение нужно принять до определённой даты; есть предложение партнёра, которое необходимо проверить.'
};

// spec §16 §26 §27
const REVIEW = {
  title: 'Бриф для консультанта',
  lead: 'Проверьте, правильно ли FINMENTOR понял ситуацию.',
  enough: 'Этого достаточно, чтобы консультант подготовился к первому разговору.',
  primary: 'Передать консультанту',
  secondary: 'Изменить',
  tertiary: 'Добавить важное',
  // §27 — factual only. Never «частично», never «готовы».
  materialsStatus: { present: 'Материалы — приложены', absent: 'Материалы — не приложены' }
};

// spec §17 — the controlled advisory map. Exactly eight keys, three lines each. NOT a diagnosis
// and never a model call: meeting-brief.js looks this up and renders nothing for an unknown key.
const FOCUS_MAP = Object.freeze({
  financial_management: ['Качество управленческой информации', 'Планирование и контроль', 'Организация финансовой функции'],
  profitability:        ['Факторы прибыли и маржи', 'Себестоимость и структура расходов', 'Экономика направлений / продуктов'],
  cash_flow:            ['Ликвидность и причины cash gap', 'Оборотный капитал', 'Прогноз движения денежных средств'],
  investment:           ['Экономика проекта и исходные допущения', 'Доходность и чувствительность сценариев', 'Структура инвестиций и ключевые риски'],
  real_estate:          ['Денежный поток объекта', 'Доходность и стоимость капитала', 'Сценарии владения / продажи'],
  financing:            ['Потребность в капитале', 'Способность обслуживать обязательства', 'Структура финансирования'],
  independent_view:     ['Управленческое решение, которое нужно принять', 'Качество доступной финансовой информации', 'Приоритеты для дальнейшего анализа'],
  other:                ['Контекст задачи', 'Решение, которое требуется принять', 'Каких данных не хватает для следующего шага']
});

const FOCUS_DISCLAIMER = 'Финальный объём анализа консультант определит после изучения материалов.';

// spec §18 — no checkbox. The acknowledgement is the submit action itself.
const PRIVACY = {
  lines: [
    'FINMENTOR использует указанные вами данные для рассмотрения обращения, подготовки консультанта и связи с вами.',
    'Передавая brief, вы подтверждаете, что ознакомились с информацией об обработке персональных данных.'
  ],
  links: ['Как мы обрабатываем данные', 'Политика конфиденциальности'],
  entryLink: 'Конфиденциальность и данные',
  primary: 'Передать консультанту'
};

// spec §19
const EDIT = {
  title: 'Что хотите изменить?',
  lead: 'Поправим один пункт и вернёмся к брифу.',
  back: 'Вернуться к брифу',
  // Order is the approved Edit Selector order. Each maps to the field it edits.
  rows: [
    { field: 'company_name', label: 'Компания' },
    { field: 'role', label: 'Роль' },
    { field: 'turnover_band', label: 'Масштаб' },
    { field: 'objective', label: 'Задача' },
    { field: 'problem', label: 'Проблема' },
    { field: 'desired_outcome', label: 'Ожидаемый результат' },
    { field: 'current_setup', label: 'Текущая система' },
    { field: 'decision_horizon', label: 'Срок' },
    { field: 'documents', label: 'Материалы' },
    { field: 'contact_channel', label: 'Контакт' },
    { field: 'important_context', label: 'Важный контекст' }
  ]
};

// spec §21 — shown ONLY after authoritative committed success.
const SUCCESS = {
  title: 'Принято',
  status: 'Передано консультанту',
  lines: [
    'Контекст передан команде FINMENTOR.',
    'Консультант увидит информацию о компании, вашу задачу и приложенные материалы до первого разговора.',
    'Повторять всё сначала не потребуется.'
  ],
  nextTitle: 'Что дальше',
  next: ['FINMENTOR изучит brief.', 'При необходимости уточним детали.', 'Согласуем следующий контакт.'],
  primary: 'Вернуться в Telegram'
};

// spec §22 — must never resemble success.
const FAILURE = {
  title: 'Заявка пока не отправлена',
  lines: [
    'Возникла техническая ошибка при передаче.',
    'Ваше обращение не считается принятым.',
    'Повторно проходить вопросы не нужно.'
  ],
  primary: 'Повторить отправку',
  secondary: 'Вернуться к резюме'
};

// spec §24 — four stages, no percentages, no step counts.
const STAGES = ['Контекст', 'Задача', 'Подготовка', 'Проверка'];

// ---------------------------------------------------------------- Telegram copy
// AUTHORITATIVE, Phase 3 owner decision C. Not invented, not paraphrased.
const TG_COPY = {
  TG_ENTRY: {
    text: [
      'Здравствуйте.',
      'FINMENTOR поможет подготовить контекст до первой встречи — чтобы консультант заранее понимал вашу компанию, задачу и ожидаемый результат.',
      'Можно сразу описать ситуацию своими словами или подготовить краткий бриф.',
      'Перед отправкой вы сможете всё проверить и изменить.'
    ],
    actions: ['Описать задачу', 'Подготовить бриф']
  },
  TG_FREEFORM_PROBLEM: {
    text: [
      'Опишите ситуацию так, как рассказали бы её консультанту на первой встрече.',
      'Полезно указать, чем занимается компания, что сейчас происходит, какое решение нужно принять и что мешает принять его уверенно.',
      'Необязательно отвечать по пунктам — напишите своими словами.'
    ],
    actions: []
  },
  TG_CONFIRM_CONTEXT: {
    header: 'Проверьте, правильно ли FINMENTOR понял ваш контекст.',
    // Rendered ONLY for values actually extracted with sufficient structure. An absent value
    // renders no label at all — never «Компания: —».
    labels: {
      company_name: 'Компания',
      role: 'Ваша роль',
      turnover_band: 'Масштаб',
      objective: 'Задача',
      problem_summary: 'Основная ситуация'
    },
    closing: 'Если всё верно, я перенесу этот контекст в бриф и не буду спрашивать его повторно.',
    actions: ['Всё верно', 'Исправить']
  },
  TG_OPEN_BRIEF: {
    text: [
      'Контекст сохранён.',
      'Осталось несколько уточнений, которые помогут консультанту подготовиться до встречи.',
      'Откройте бриф и завершите подготовку обращения.'
    ],
    actions: ['Открыть бриф']
  },
  TG_SUBMITTED: {
    text: ['Последнее обращение уже передано FINMENTOR.', 'Что хотите сделать?'],
    actions: ['Добавить к обращению', 'Начать новый вопрос']
  },
  TG_APPEND_MESSAGE: {
    text: [
      'Добавьте информацию к уже переданному обращению.',
      'Она будет связана с текущим запросом и не создаст новое обращение.',
      'Напишите сообщение одним текстом.'
    ],
    actions: [],
    done: {
      text: ['Добавил информацию к текущему обращению.', 'Новое обращение не создавалось.'],
      actions: ['Вернуться', 'Начать новый вопрос']
    }
  },
  TG_NEW_REQUEST_CONFIRM: {
    text: [
      'Начать новый вопрос?',
      'Текущее обращение останется сохранено и не изменится.',
      'Для новой задачи будет создан отдельный бриф.'
    ],
    actions: ['Начать новый вопрос', 'Вернуться']
  },
  TG_INFRA_FAILURE: {
    text: [
      'Сейчас не удалось продолжить из-за технической ошибки.',
      'Обращение не считается отправленным.',
      'Не начинайте новый вопрос — сначала попробуйте повторить текущее действие.'
    ],
    actions: ['Повторить', 'Вернуться']
  },
  TG_RESUME_DRAFT: {
    text: ['У вас есть незавершённый бриф.', 'Продолжить с того места, где остановились?'],
    actions: ['Продолжить', 'Начать заново']
  },
  TG_RESUME_DISCARD_CONFIRM: {
    text: ['Текущий черновик будет заменён новым обращением.'],
    actions: ['Начать новое', 'Вернуться']
  }
};

// ---------------------------------------------------------------- lookups

const OBJECTIVE_IDS = OBJECTIVES.map((o) => o.id);
const OBJECTIVE_LABELS = OBJECTIVES.map((o) => o.label);

function objectiveById(id) { return OBJECTIVES.find((o) => o.id === id) || null; }
function objectiveByLabel(label) { return OBJECTIVES.find((o) => o.label === label) || null; }

// Every problem label a branch may legitimately produce, free-text option included.
function problemLabels(objectiveId) {
  const p = PROBLEMS[objectiveId];
  if (!p) { return []; }
  if (p.mode === 'free_text') { return []; }
  return p.options.map((o) => o[0]).concat([PROBLEM_FREE_TEXT_OPTION]);
}
function outcomeLabels(objectiveId) {
  const o = OUTCOMES[objectiveId];
  return o ? o.options.map((x) => x[0]) : [];
}
function isFreeTextProblem(objectiveId) {
  const p = PROBLEMS[objectiveId];
  return !!p && p.mode === 'free_text';
}

module.exports = {
  OBJECTIVES, OBJECTIVE_IDS, OBJECTIVE_LABELS, OBJECTIVE_SCREEN,
  PROBLEMS, PROBLEM_FREE_TEXT_OPTION,
  OUTCOMES, OUTCOME_FREE_TEXT_OPTION,
  COMPANY_SCREEN, SCALE_OPTIONS, CURRENT_SETUP, DECISION_HORIZON, DOCUMENTS,
  CONTACT, IMPORTANT_CONTEXT, REVIEW, FOCUS_MAP, FOCUS_DISCLAIMER,
  PRIVACY, EDIT, SUCCESS, FAILURE, STAGES, TG_COPY,
  objectiveById, objectiveByLabel, problemLabels, outcomeLabels, isFreeTextProblem
};
