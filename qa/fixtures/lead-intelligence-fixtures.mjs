import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const LI = require('../../n8n/src/lead-intelligence/contract.js');

// Sanitized projection of the live Niagara source semantics observed during the owner audit.
// Identifiers and PII are synthetic; business answers preserve the source meaning and emptiness.
// The deliberately different Lead IDs prove that request_id is the only valid correlation path.
export const NIAGARA_LIVE_SANITIZED_SOURCE = {
  request_id: 'REQ-NIAGARA-SYNTHETIC',
  lead_row: {
    'Lead ID': 'FIN-NIAGARA-LEADS-SYNTHETIC',
    'Diagnostic Score': '82',
    'Tool': 'xray_extended',
    'Raw JSON': JSON.stringify({
      tool: 'xray_extended',
      meta: { request_id: 'REQ-NIAGARA-SYNTHETIC', site_language: 'ru' },
      client: {
        name: 'Александр', company: 'Niagara club', role: 'CEO',
        preferred_contact_channel: 'Telegram',
        phone_or_messenger: '+373 60 123 456', email: 'alexander@niagara.example'
      },
      diagnostic: {
        score: 82, traffic_light: 'GREEN',
        business_model: 'Fitness',
        main_pain: 'Платежи хаотично / кассовые разрывы',
        risk_zones: [
          { key: 'receivables_payables', label: 'Дебиторка и кредиторка', answer: 'Частично', score_percent: 50 },
          { key: 'kpi_dashboard', label: 'KPI, риски и отклонения', answer: 'Частично, разрозненно', score_percent: 50 }
        ],
        wants_review: 'Пока только самооценка'
      },
      answers: {
        quick_diagnostic: [
          { key: 'receivables_payables', label: 'Дебиторка и кредиторка', answer: 'Частично', score_percent: 50 },
          { key: 'kpi_dashboard', label: 'KPI, риски и отклонения', answer: 'Частично, разрозненно', score_percent: 50 }
        ]
      },
      intake: {
        company_profile: { industry_category: 'Услуги / консалтинг', turnover_range: '1–5 млн EUR', employees_range: '100+ сотрудников' },
        financial_control: {
          receivables_control: 'Да', payables_control: 'Да', owner_report: '',
          margin_control: '', payment_approval_rules: ''
        },
        industry_specific: {
          loans_or_investors: 'Несколько источников финансирования',
          capex_or_projects: 'Есть капитальные вложения и отдельные проекты'
        },
        business_pain: { desired_first_step: 'Построить систему контроля' },
        goals: { selected_goals: '' },
        documents_available: { selected_documents: '' }
      }
    })
  },
  pipeline_row: {
    lead_id: 'FIN-NIAGARA-PIPELINE-SYNTHETIC', request_id: 'REQ-NIAGARA-SYNTHETIC',
    company: 'Niagara club', name: 'Александр', role: 'CEO',
    business_model: 'Fitness', industry_category: 'Услуги / консалтинг', turnover_range: '1–5 млн EUR', employees_range: '100+ сотрудников',
    main_pain: 'Платежи хаотично / кассовые разрывы', selected_goals: '', selected_documents: '',
    financial_zone: 'GREEN', source_page: 'questionnaire.html', created_at: '2026-09-09T16:31:00.000Z'
  }
};

const NIAGARA_RAW = JSON.parse(NIAGARA_LIVE_SANITIZED_SOURCE.lead_row['Raw JSON']);
const FC = NIAGARA_RAW.intake.financial_control;
const QUICK = NIAGARA_RAW.answers.quick_diagnostic;
const NIAGARA_ELIGIBILITY = LI.clientResultEligibility({
  source_channel: 'website_xray',
  explicit_request: NIAGARA_RAW.diagnostic.wants_review,
  source_path: 'Leads.Raw JSON.diagnostic.wants_review'
});

export const NIAGARA_CONTEXT = {
  generated_at: '2026-09-09T16:31:00.000Z', intelligence_version: 1,
  company: 'Niagara club', contact_name: 'Александр', role: 'CEO',
  business: NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.business_model, scale: '1–5 млн EUR · 100+ сотрудников', source: 'website_xray',
  lead_status: 'Новое обращение', data_quality: 'Высокая · есть зоны для проверки',
  commercial_intent_confirmed: false,
  next_action: 'Связаться с Александром и проверить источник кассовых разрывов',
  diagnostic_score: 82, financial_zone: 'GREEN',
  preferred_contact_channel: 'Telegram', telegram_username: '', telegram_chat_id: '',
  telegram_route_verified: false, source_channel: 'website_xray',
  phone: '+373 60 123 456', email: 'alexander@niagara.example',
  client_result_eligible: NIAGARA_ELIGIBILITY.eligible,
  client_result_eligibility_reason: NIAGARA_ELIGIBILITY.reason,
  client_facts: LI.buildClientFacts({
    main_problem: NIAGARA_LIVE_SANITIZED_SOURCE.pipeline_row.main_pain,
    main_problem_source: 'Pipeline.main_pain',
    existing_setup: QUICK.map((row) => row.label + ': ' + row.answer),
    existing_setup_source: 'Leads.Raw JSON.answers.quick_diagnostic',
    desired_first_step: NIAGARA_RAW.intake.business_pain.desired_first_step,
    desired_first_step_source: 'Leads.Raw JSON.intake.business_pain.desired_first_step',
    financial_system: [
      ['Дебиторская задолженность', FC.receivables_control],
      ['Кредиторская задолженность', FC.payables_control],
      ['Отчёт собственника', FC.owner_report],
      ['Контроль маржи', FC.margin_control],
      ['Правила согласования платежей', FC.payment_approval_rules]
    ].filter((entry) => entry[1]).map((entry) => entry[0] + ': ' + entry[1]).join('; '),
    financial_system_source: 'Leads.Raw JSON.intake.financial_control',
    capital_context: NIAGARA_RAW.intake.industry_specific.loans_or_investors + '; ' + NIAGARA_RAW.intake.industry_specific.capex_or_projects,
    capital_context_source: 'Leads.Raw JSON.intake.industry_specific'
  }),
  history: [
    { at: '09.09 19:30', label: 'Получена заявка' },
    { at: '09.09 19:31', label: 'Завершена квалификация' },
    { at: '09.09 19:31', label: 'Подготовлен предварительный анализ' }
  ]
};

export const NIAGARA_AI = {
  diagnoses: [
    {
      conclusion: 'Быстрая диагностика оценивает контроль дебиторки и кредиторки как частичный, а расширенная анкета сообщает, что оба контроля есть.',
      evidence_fact_ids: ['existing_setup', 'financial_system'],
      hypothesis: 'Два слоя анкеты используют разные критерии контроля либо отражают разрыв между наличием реестров и регулярностью управления ими.',
      economic_implication: 'До проверки нельзя считать качество контроля оборотного капитала подтверждённым.'
    },
    {
      conclusion: 'Проблема выглядит шире, чем отсутствие одного отчёта: нужно проверить связку прогноза, платёжной дисциплины, оборотного капитала и капитальных вложений.',
      evidence_fact_ids: ['financial_system', 'capital_context'],
      hypothesis: 'Причина может находиться в качестве прогноза, горизонте планирования, дебиторской задолженности, CAPEX или структуре финансирования.',
      economic_implication: 'Без разделения операционного и инвестиционного денежного потока владелец не видит истинную потребность в ликвидности.'
    },
    {
      conclusion: 'Зелёная диагностическая зона не отменяет конкретный ликвидный симптом и не доказывает, что финансовый контур работает операционно.',
      evidence_fact_ids: ['main_problem', 'financial_system'],
      hypothesis: 'Высокий общий балл может скрывать локальный, но экономически существенный разрыв в казначействе и управлении платежами.',
      economic_implication: 'Приоритет разговора — причина денежных разрывов, а не обсуждение общего балла.'
    }
  ],
  pain_map: [
    { area: 'Ликвидность', attention: 'Высокий приоритет', observation: 'Клиент выбрал проблему «Платежи хаотично / кассовые разрывы».', consequence: 'Риск срыва платежей и привлечения срочных денег на невыгодных условиях.', economic_category: 'liquidity', evidence_fact_ids: ['main_problem'] },
    { area: 'Оборотный капитал', attention: 'Проверить', observation: 'Быстрая диагностика говорит «Частично», а расширенная анкета — «Да» по контролю дебиторки и кредиторки.', consequence: 'До сверки критериев нельзя считать качество контроля подтверждённым.', economic_category: 'working capital', evidence_fact_ids: ['existing_setup','financial_system'] },
    { area: 'Капитал и CAPEX', attention: 'Проверить', observation: 'Есть несколько источников финансирования и капитальные проекты.', consequence: 'Инвестиционные платежи могут конкурировать с операционной ликвидностью и повышать стоимость капитала.', economic_category: 'cost of capital', evidence_fact_ids: ['capital_context'] },
    { area: 'Управленческая дисциплина', attention: 'Проверить', observation: 'Регулярность отчёта собственника, контроль маржи и правила согласования платежей источником не подтверждены.', consequence: 'Решения могут приниматься поздно, а прогноз — терять управленческую ценность.', economic_category: 'management speed', evidence_fact_ids: ['main_problem'] }
  ],
  unknowns: [
    { item: 'Почему быстрая диагностика оценивает контроль дебиторки и кредиторки как «Частично», а расширенная анкета отвечает «Да».', why: 'Нужно сверить критерий ответа и фактический рабочий процесс до вывода о качестве контроля.' },
    { item: 'Горизонт и частота обновления прогноза денежных средств.', why: 'Без этого нельзя оценить, когда система замечает будущий разрыв.' },
    { item: 'Фактическая причина последних кассовых разрывов.', why: 'Нужно отделить ошибки прогноза от дисциплины платежей и дефицита оборотного капитала.' },
    { item: 'Возрастная структура дебиторской задолженности.', why: 'Просроченная дебиторка может быть прямым источником дефицита денег.' },
    { item: 'Структура долга и стоимость каждого источника финансирования.', why: 'Это определяет цену покрытия разрывов и риск рефинансирования.' },
    { item: 'Потребность CAPEX в деньгах и календарь проектов.', why: 'Инвестиционные выплаты могут создавать пики нагрузки на ликвидность.' },
    { item: 'Кто имеет право менять приоритеты платежей.', why: 'Нужна ясность, исполняется ли платёжный календарь как правило управления.' }
  ],
  first_meeting_objective: 'Сверить противоречивые ответы о контроле дебиторки и кредиторки и понять источник хаотичных платежей и кассовых разрывов.',
  conversation_opening: 'Вы выбрали проблему «Платежи хаотично / кассовые разрывы». При этом быстрая диагностика оценивает контроль дебиторки и кредиторки как частичный, а расширенная анкета отвечает «Да». Я бы начал с того, что именно работает на практике и где возникает разрыв.',
  discovery_questions: [
    { question: 'Когда вы обычно понимаете, что возникает кассовый разрыв?', why: 'Проверяем горизонт и качество прогноза денежных средств.' },
    { question: 'Что стало причиной двух последних разрывов: задержка поступлений, внеплановый платёж, CAPEX или отклонение от бюджета?', why: 'Отделяем симптом от повторяющегося корневого механизма.' },
    { question: 'Как часто обновляются Cash Flow и платёжный календарь, и кто отвечает за факт против прогноза?', why: 'Проверяем рабочий процесс и персональную ответственность.' },
    { question: 'Какая доля дебиторской задолженности просрочена и как менялась её оборачиваемость?', why: 'Проверяем, сколько ликвидности связано в оборотном капитале.' },
    { question: 'Какие платежи по CAPEX и проектам ожидаются в ближайшие три–шесть месяцев?', why: 'Проверяем будущую потребность в капитале и пики денежной нагрузки.' },
    { question: 'Какие источники финансирования используются для покрытия разрывов и какова их полная стоимость?', why: 'Оцениваем стоимость капитала и риск зависимости от срочного финансирования.' },
    { question: 'Какое управленческое решение должно стать проще после устранения этой проблемы?', why: 'Фиксируем критерий результата и границу будущего решения.' }
  ],
  solution_hypothesis: {
    product: 'FINANCIAL_HEALTH_CHECK', format: 'Financial Health Check — как независимая диагностика',
    rationale: 'Сначала нужно разложить источник кассовых разрывов по прогнозу, оборотному капиталу, платёжному управлению, CAPEX и финансированию. Продажа новой отчётности до этого была бы преждевременной.',
    confirmation_conditions: ['Разрывы повторяются, а не являются единичным событием.', 'Существующие отчёты не связывают прогноз, платёжные решения и факт.', 'Клиент готов предоставить данные по дебиторке, долгу и CAPEX.'],
    if_confirmed: 'Провести Financial Health Check, затем определить, нужен ли локальный ремонт процесса или Business Control System.',
    do_not_offer_yet: 'Не предлагать Business Control System или постоянное сопровождение до подтверждения системной причины.'
  },
  next_action: {
    action: 'Связаться с Александром.', purpose: 'Проверить источник кассовых разрывов.',
    success_condition: 'Понятна причина, определён список нужных данных и согласован следующий шаг.', due_date: '2026-09-10'
  }
};

export const NIAGARA_BRIEF = LI.normalizeOwnerBrief(NIAGARA_AI, {
  ...NIAGARA_CONTEXT,
  contact: LI.buildReachability(NIAGARA_CONTEXT)
});

export const NIAGARA_CLIENT_DRAFT = {
  executive_summary: 'У бизнеса сформирован базовый контур финансового контроля, однако кассовые разрывы показывают, что прогноз и платёжные решения требуют дополнительной проверки.',
  financial_maturity: { score_1_to_5: 4, label: 'Система сформирована', rationale: 'Основные инструменты существуют; ключевой вопрос — качество их операционного применения.' },
  key_risks: [
    { title: 'Повторяющиеся кассовые разрывы', evidence: 'Указано в анкете', potential_impact: 'Риск несвоевременных платежей и дорогого краткосрочного финансирования.', priority: 'HIGH' },
    { title: 'Частичный контроль дебиторской задолженности', evidence: 'Указано в анкете', potential_impact: 'Средства могут дольше оставаться в оборотном капитале.', priority: 'MEDIUM' }
  ],
  management_priorities: ['Проверить качество прогноза денежных средств.', 'Разобрать дебиторскую задолженность и календарь CAPEX.', 'Закрепить правила приоритизации платежей.'],
  plan_30_days: {
    days_1_7: [{ action: 'Сверить прогноз с фактическим движением денег.' }],
    days_8_14: [{ action: 'Провести анализ дебиторской и кредиторской задолженности.' }],
    days_15_21: [{ action: 'Разделить операционные и инвестиционные платежи.' }],
    days_22_30: [{ action: 'Зафиксировать платёжные правила и контроль отклонений.' }]
  },
  tomorrow_actions: ['Собрать Cash Flow, платёжный календарь и данные по задолженности.'],
  recommended_next_step: { product: 'FINANCIAL_HEALTH_CHECK', label: 'Financial Health Check', rationale: 'Независимая диагностика позволит подтвердить источник разрывов до выбора формата решения.' }
};

export const NIAGARA_ROW = {
  analysis_id: 'XA-NIAGARA-UAT', lead_id: 'FIN-NIAGARA-PIPELINE-SYNTHETIC', locale: 'ru', review_status: 'OWNER_EDITED',
  score: '82', zone: 'GREEN', client_result_eligible: false,
  owner_brief_json: JSON.stringify(NIAGARA_BRIEF), client_result_draft_json: JSON.stringify(NIAGARA_CLIENT_DRAFT),
  created_at: '2026-09-09T16:31:00.000Z'
};
