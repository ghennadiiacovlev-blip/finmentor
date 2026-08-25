// ---- node tail: build the prompt from the safe projection only -------------------------
// Concatenated after ai-safe-projection.js by scripts/patch-ai-minimization.ps1 to form the
// jsCode of the "Build AI Work Plan Prompt" node. n8n Code nodes cannot require() local
// files, so the shared projection core is inlined rather than imported. The regression
// gate exercises that same core file, and the patcher verifies the deployed node contains
// it byte for byte.

const item = $input.first().json;

let raw = {};
try {
  raw = item.raw_json ? JSON.parse(item.raw_json) : {};
} catch (e) {
  raw = {};
}

const projection = buildAiSafeProjection(item, raw);

// Fail closed. If anything identifying survived, produce no AI item at all. The lead is
// already committed to the CRM at this point, so skipping the plan costs an internal
// convenience, never the lead itself.
const leak = projectionLeak(projection);
if (leak) {
  return [];
}

const systemPrompt = `
Ты — FINMENTOR CFO Diagnostic Agent (финансовый рентген).

Роль: финансовый директор, эксперт по управленческому учёту и архитектор CFO-системы.
Готовишь ВНУТРЕННИЙ план работы с потенциальным клиентом для собственника FINMENTOR.

Жёсткие правила:
- Не выдумывай факты, которых нет в анкете.
- Если по зоне нет данных — ставь статус NEEDS_CLARIFICATION и пиши "нужно уточнить".
- Отделяй факты (из анкеты) от гипотез (пиши "гипотеза:" в internal_sales_notes).
- Не обещай гарантированный финансовый результат, не продавай агрессивно.
- Пиши профессионально, по-русски, в стиле premium CFO advisory.
- Анкета обезличена: контактные данные не передаются. Не запрашивай и не додумывай имя,
  компанию, email, телефон или Telegram клиента, не обращайся к клиенту по имени.

FINMENTOR — CFO-система для собственника: финансовая диагностика, управленческие модели,
Cash Flow и платёжный контроль, маржа, KPI, риски, Power BI dashboard, n8n/Make автоматизация.
Флагманские модули: Real Estate Control System; Retail Margin Engine; Treasury / Payment Discipline;
Supplier Rating; Working Capital Control; Margin Factor Analysis; Power BI Owner Dashboard; n8n/Make CFO Automation.

ЗАДАЧА — провести диагностику по измерениям и заполнить financial_control_map.
Обязательно оцени каждую зону (если данных нет — NEEDS_CLARIFICATION):
Cash Flow; P&L (управленческий); Working Capital; Payment Discipline; AR (дебиторка); AP (кредиторка);
Inventory (запасы); Payroll; Budgeting; Margin; Cost Centers; Data Reliability; Single Source of Truth;
Tax Risk; Currency Risk; Owner Reporting; Remote Work Readiness; Documents Available; Commercial Intent.

Для каждой зоны:
- status: OK / PARTIAL / NO / NEEDS_CLARIFICATION
- risk: краткий риск
- business_consequence: к чему это ведёт для бизнеса
- recommended_action: что сделать
- finmentor_module: какой модуль FINMENTOR закрывает зону

Верни СТРОГО JSON. Без markdown, без \`\`\`json, без текста до или после JSON.

Формат ответа:

{
  "executive_summary": "",
  "diagnosis_summary": "",
  "financial_maturity_level": "Initial / Developing / Controlled / Advanced",
  "financial_zone": "GREEN / YELLOW / ORANGE / RED",
  "risk_level": "LOW / MEDIUM / HIGH / CRITICAL",
  "main_pain": "",
  "financial_control_map": [
    {
      "area": "Cash Flow",
      "status": "OK / PARTIAL / NO / NEEDS_CLARIFICATION",
      "risk": "",
      "business_consequence": "",
      "recommended_action": "",
      "finmentor_module": ""
    }
  ],
  "main_risks": [],
  "quick_wins": [],
  "documents_to_request": [],
  "discovery_call_agenda": [],
  "first_7_days_plan": [],
  "questions_to_clarify": [],
  "automation_opportunities": [],
  "power_bi_opportunities": [],
  "n8n_make_opportunities": [],
  "recommended_offer": "",
  "recommended_first_step": "",
  "internal_sales_notes": "",
  "client_message": "",
  "confidence": "LOW / MEDIUM / HIGH"
}
`;

const userPrompt = `
Проанализируй обезличенную анкету FINMENTOR (финансовый рентген) и подготовь внутренний план работы с клиентом.

Профиль бизнеса и диагностика:
${JSON.stringify(projection.card, null, 2)}

Ответы анкеты (обезличенный источник фактов, бери факты только отсюда):
${JSON.stringify(projection.questionnaire, null, 2)}

Сделай:
1. executive_summary — 2-3 предложения для собственника FINMENTOR.
2. Заполни financial_control_map по ВСЕМ зонам из системного промпта.
3. main_risks (3-7), risk_level, financial_zone, financial_maturity_level.
4. quick_wins — что можно дать клиенту быстро.
5. recommended_offer (диагностика / CFO-система / флагманский модуль / регулярный контроль / автоматизация) + recommended_first_step.
6. discovery_call_agenda, documents_to_request, questions_to_clarify, first_7_days_plan.
7. automation_opportunities, power_bi_opportunities, n8n_make_opportunities.
8. internal_sales_notes (факты + гипотезы отдельно).
9. client_message — короткое обезличенное сообщение клиенту после анкеты, без обращения по имени.

Верни только JSON.
`;

// item still carries lead_id and contact fields for the downstream CRM writes. Only the
// two prompt strings are handed to the model, and neither references those fields.
return [
  {
    json: {
      ...item,
      ai_system_prompt: systemPrompt,
      ai_user_prompt: userPrompt
    }
  }
];
