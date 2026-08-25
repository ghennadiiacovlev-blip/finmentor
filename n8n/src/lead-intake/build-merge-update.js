// Build Merge Update v3 — safe merge into the canonical Pipeline row.
//
// Never overwrite non-empty values with empty; never downgrade priority/zone; never move
// deal_stage backwards; escalation reopens SLA.
//
// v3 adds the attribution and idempotency policy from
// docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md section 1.5. Before v3 this node wrote no
// attribution at all — not even the existing last-touch utm columns — so every documented
// merge rule was unimplemented on the one path where merges actually happen.
const item = $input.first().json;
const ex = item.existing_row || {};
const now = new Date().toISOString();
const cfg = (() => { try { return $('Settings to Object').first().json.settings || {}; } catch (e) { return {}; } })();
const fill = (o, n) => (o !== undefined && o !== null && String(o).trim() !== '') ? o : (n ?? '');
const PR = { INCOMPLETE: 0, COLD: 1, WARM: 2, HOT: 3 };
const ZR = { UNKNOWN: 0, GREEN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };
const pr = x => PR[String(x || '').toUpperCase()] ?? 0;
const zr = x => ZR[String(x || '').toUpperCase()] ?? 0;
const upd = {
  lead_id: item.existing_lead_id || item.lead_id,
  updated_at: now,
  last_activity_at: now,
  name: fill(ex.name, item.name), company: fill(ex.company, item.company), role: fill(ex.role, item.role),
  email: fill(ex.email, item.email), phone: fill(ex.phone, item.phone), telegram: fill(ex.telegram, item.telegram),
  business_model: fill(ex.business_model, item.business_model), industry_category: fill(ex.industry_category, item.industry_category),
  turnover_range: fill(ex.turnover_range, item.turnover_range), employees_range: fill(ex.employees_range, item.employees_range),
  main_pain: fill(ex.main_pain, item.main_pain), selected_problems: fill(ex.selected_problems, item.selected_problems),
  selected_goals: fill(ex.selected_goals, item.selected_goals), work_interest: fill(ex.work_interest, item.work_interest),
  documents_status: fill(ex.documents_status, item.documents_status), selected_documents: fill(ex.selected_documents, item.selected_documents),
  preferred_meeting_format: fill(ex.preferred_meeting_format, item.preferred_meeting_format),
  priority: ex.priority || item.lead_priority,
  financial_zone: ex.financial_zone || item.financial_zone,
  priority_reason: ex.priority_reason || item.priority_reason || '',
  critical_flags: fill(ex.critical_flags, item.critical_flags),
  next_action: ex.next_action || item.next_action,
  status: ex.status || item.status,
  deal_stage: ex.deal_stage || 'New',
  sla_status: ex.sla_status || 'Active',
  next_follow_up_at: ex.next_follow_up_at || '',
  sla_hours: ex.sla_hours || '',
  comment: ex.comment || ''
};
if (item.dedup_escalated) {
  if (pr(item.lead_priority) > pr(ex.priority)) { upd.priority = item.lead_priority; upd.next_action = item.next_action; upd.status = item.status; }
  if (zr(item.financial_zone) > zr(ex.financial_zone)) upd.financial_zone = item.financial_zone;
  upd.priority_reason = '[эскалация ' + now.slice(0, 16) + '] ' + (item.priority_reason || '');
  upd.critical_flags = item.critical_flags || ex.critical_flags || '';
  const st = String(ex.deal_stage || '').toLowerCase();
  if (['', 'new', 'incomplete', 'nurture'].includes(st)) upd.deal_stage = upd.priority === 'HOT' ? 'Qualified' : 'New';
  if (!ex.sla_status || ['done', 'nurture', 'snoozed'].includes(String(ex.sla_status).toLowerCase())) upd.sla_status = 'Active';
  const slaH = upd.priority === 'HOT' ? Number(cfg.sla_hot_hours || 4) : Number(cfg.sla_warm_hours || 24);
  upd.next_follow_up_at = new Date(Date.now() + slaH * 36e5).toISOString();
  upd.sla_hours = slaH;
}

// --- attribution and idempotency (docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md 1.5) -------
//
// A retry is not a new touch. Everything below is a no-op when Dedup Guard reports one, so
// replaying the same submission can never advance last touch, rotate the idempotency key or
// alter the consent record.
const __meta = (function () { try { return JSON.parse(item.raw_json || '{}').meta || {}; } catch (e) { return {}; } })();
const __first = (__meta.attribution_first_touch && typeof __meta.attribution_first_touch === 'object') ? __meta.attribution_first_touch : {};
const genuine = !item.dedup_is_retry;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
const s = v => String(v ?? '').trim();
// Keep the stored value unless this is a genuine submission carrying a non-empty one.
// A blank never erases something already known.
const advance = (oldVal, newVal) => (genuine && s(newVal) !== '') ? s(newVal) : s(oldVal);
// Written once and never rewritten. A legacy row that predates first-touch capture may
// still be populated, because filling a blank is not overwriting a known value.
const keepFirst = (oldVal, newVal) => (s(oldVal) !== '') ? s(oldVal) : (genuine ? s(newVal) : '');

upd.request_id = advance(ex.request_id, item.request_id);

// Consent is current state: a genuine later submission that says false records false. It is
// the visitor's latest stated preference and the server-side GA4 sender is gated on it, so
// recording it is what actually stops downstream analytics for this lead.
const consentPresent = has(__meta, 'analytics_consent');
const consentNew = __meta.analytics_consent === true;
upd.analytics_consent = (genuine && consentPresent)
  ? (consentNew ? 'TRUE' : 'FALSE')
  : s(ex.analytics_consent);

// GA identifiers are only ever written under accepted consent. They are never erased by a
// later blank or by a later refusal: the values were collected lawfully under the consent in
// force at the time, and a form submission is not a withdrawal request. Withdrawal and
// erasure are a separate process and are deliberately not implemented here.
const gaAllowed = genuine && consentNew;
upd.ga_client_id = (gaAllowed && s(__meta.ga_client_id) !== '') ? s(__meta.ga_client_id) : s(ex.ga_client_id);
upd.ga_session_id = (gaAllowed && s(__meta.ga_session_id) !== '') ? s(__meta.ga_session_id) : s(ex.ga_session_id);

// First touch — how the lead was introduced. That fact does not change.
upd.utm_source_first = keepFirst(ex.utm_source_first, __first.utm_source);
upd.utm_medium_first = keepFirst(ex.utm_medium_first, __first.utm_medium);
upd.utm_campaign_first = keepFirst(ex.utm_campaign_first, __first.utm_campaign);
upd.first_touch_at = keepFirst(ex.first_touch_at, __first.captured_at);

// Last touch — what converted them this time. Advances on each genuine campaign arrival.
upd.utm_source = advance(ex.utm_source, item.utm_source);
upd.utm_medium = advance(ex.utm_medium, item.utm_medium);
upd.utm_campaign = advance(ex.utm_campaign, item.utm_campaign);

const note = 'merge ' + now.slice(0, 16) + ' via ' + item.dedup_match_by + ' from ' + item.source + ' (' + (item.submission_lead_id || item.lead_id) + ')' + (item.dedup_escalated ? ' ESCALATED' : '');
upd.comment = String((ex.comment ? ex.comment + ' | ' : '') + note).slice(-2000);
return [{ json: upd }];
