// Build Pipeline Row v2 — the canonical new-lead row for the Pipeline tab.
//
// v2 adds the structured attribution and idempotency columns (Pipeline AZ:BG). Versioned
// here rather than string-spliced at deploy time: the row object is built inline inside the
// return statement, so there is no `row` variable for a patch to attach to — the previous
// deploy script assumed one, and its guard correctly refused to splice blindly.
//
// utm_source / utm_medium / utm_campaign stay LAST touch. First touch is a separate
// dimension so a later merge can advance last touch without destroying how the lead arrived.

const item = $input.first().json;
const cfg = (function(){ try { return $('Settings to Object').first().json.settings || {}; } catch(e){ return {}; } })();

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function addHours(dateIso, hours) {
  const d = new Date(dateIso || new Date().toISOString());
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

const priority = pick(item.lead_priority, item.lead_temperature, 'COLD');
const createdAt = pick(item.created_at, new Date().toISOString());

let dealStage = 'New';
let slaHours = 72;
let nextAction = pick(item.next_action, 'Оставить в CRM / nurturing');

if (priority === 'HOT') {
  dealStage = 'Qualified';
  slaHours = Number(cfg.sla_hot_hours || 4);
  nextAction = pick(item.next_action, 'Ответить сегодня / предложить Discovery Call');
}

if (priority === 'WARM') {
  dealStage = 'New';
  slaHours = Number(cfg.sla_warm_hours || 24);
  nextAction = pick(item.next_action, 'Назначить Financial Health Check / короткий квалификационный контакт');
}

if (priority === 'COLD') {
  dealStage = 'Nurture';
  slaHours = 168;
  nextAction = pick(item.next_action, 'Оставить в CRM / nurturing');
}

if (priority === 'INCOMPLETE') {
  dealStage = 'Incomplete';
  slaHours = Number(cfg.sla_warm_hours || 24);
  nextAction = pick(item.next_action, 'Проверить контакт / consent');
}

// Attribution travels in the client payload meta, which normalize preserved verbatim in
// raw_json. Parsed defensively: a malformed payload must never break the CRM write.
const __meta = (function () { try { return JSON.parse(item.raw_json || '{}').meta || {}; } catch (e) { return {}; } })();
const __first = (__meta.attribution_first_touch && typeof __meta.attribution_first_touch === 'object') ? __meta.attribution_first_touch : {};
const __consent = __meta.analytics_consent === true;

return [
  {
    json: {
      lead_id: pick(item.lead_id),
      created_at: createdAt,
      updated_at: new Date().toISOString(),

      priority,
      financial_zone: pick(item.financial_zone, item.risk_zone, item.score_zone),
      status: pick(item.status),
      deal_stage: dealStage,
      next_action: nextAction,
      next_follow_up_at: addHours(createdAt, slaHours),
      sla_hours: slaHours,
      responsible: cfg.default_responsible || 'Геннадий',

      company: pick(item.company),
      name: pick(item.name),
      role: pick(item.role),
      email: pick(item.email),
      phone: pick(item.phone),
      telegram: pick(item.telegram),

      business_model: pick(item.business_model),
      industry_category: pick(item.industry_category),
      turnover_range: pick(item.turnover_range),
      employees_range: pick(item.employees_range),

      main_pain: pick(item.main_pain),
      selected_problems: pick(item.selected_problems),
      selected_goals: pick(item.selected_goals),
      work_interest: pick(item.work_interest),

      documents_status: pick(item.documents_status),
      selected_documents: pick(item.selected_documents),
      preferred_meeting_format: pick(item.preferred_meeting_format),

      priority_reason: pick(item.priority_reason),
      critical_flags: pick(item.critical_flags),

      source_page: pick(item.page_url),
      utm_source: pick(item.utm_source),
      utm_medium: pick(item.utm_medium),
      utm_campaign: pick(item.utm_campaign),

      comment: '',

      // Operational Pipeline fields
      last_contacted_at: '',
      meeting_date: '',
      documents_requested_at: '',
      proposal_sent_at: '',
      deal_value_estimate: '',
      close_reason: '',
      sla_status: 'Active',
      sla_snooze_until: '',
      owner_note: '',

      // --- structured attribution and idempotency (Pipeline AZ:BG) ---
      // request_id is client-minted: a correlation and retry key, never a selection
      // capability. See docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md section 2.5.
      request_id: String(item.request_id || ''),
      analytics_consent: __consent ? 'TRUE' : 'FALSE',
      // GA identifiers are written only under accepted consent.
      ga_client_id: __consent ? String(__meta.ga_client_id || '') : '',
      ga_session_id: __consent ? String(__meta.ga_session_id || '') : '',
      utm_source_first: String(__first.utm_source || ''),
      utm_medium_first: String(__first.utm_medium || ''),
      utm_campaign_first: String(__first.utm_campaign || ''),
      first_touch_at: String(__first.captured_at || '')
    }
  }
];
