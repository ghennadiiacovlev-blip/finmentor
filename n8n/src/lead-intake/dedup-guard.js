// Dedup Guard v2 — tiered matching against Pipeline (source of truth).
// strong: lead_id | medium: normalized email / phone / telegram | weak: company+name only within 48h (older weak matches are flagged, never auto-merged).
// Won/Lost rows never absorb a new submission (returning contact = new lead, flagged).
const lead = $('Normalize + Score Lead').first().json;
const rows = $input.all().map(i => i.json).filter(r => r && String(r.lead_id || '').trim() !== '');
function lower(x) { return String(x ?? '').trim().toLowerCase().replace(/ё/g, 'е'); }
function normEmail(x) { const e = lower(x); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; }
function normPhone(x) { const s = String(x ?? '').trim(); if (!s || /^@/.test(s) || /telegram/i.test(s)) return ''; const d = s.replace(/[^\d]/g, ''); return (d.length >= 6 && d.length <= 15) ? d : ''; }
function normTelegram(x) { let s = lower(x); if (!s) return ''; s = s.replace(/^telegram(\s*chat_id)?\s*:\s*/, '').replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').trim(); return (/^[a-z0-9_]{3,32}$/.test(s) || /^\d{5,20}$/.test(s)) ? s : ''; }
function ts(x) { const t = Date.parse(String(x || '')); return Number.isFinite(t) ? t : 0; }
const now = Date.now();
const newest = list => list.slice().sort((a, b) => ts(b.updated_at || b.created_at) - ts(a.updated_at || a.created_at))[0];
const closed = r => ['won', 'lost'].includes(lower(r.deal_stage));
let match = null, matchBy = '', tier = '', possibleDuplicateOf = '';
function consider(candidates, by, t) { if (match || !candidates.length) return; const open = candidates.filter(r => !closed(r)); if (open.length) { match = newest(open); matchBy = by; tier = t; } else { possibleDuplicateOf = newest(candidates).lead_id || ''; matchBy = by + '_closed'; } }
// Strong tier requires proven provenance. A caller-supplied lead_id is not a row-selection
// capability: honouring it let a public request name an existing CRM row and merge into it.
// Normalize only sets provenance_trusted when the request presented the shared internal key
// from Settings, so untrusted callers fall through to contact-based matching below.
if (lead.provenance_trusted && lead.lead_id) consider(rows.filter(r => lower(r.lead_id) === lower(lead.lead_id)), 'lead_id', 'strong');
if (!match && lead.email_norm) consider(rows.filter(r => normEmail(r.email) === lead.email_norm), 'email', 'medium');
if (!match && lead.phone_norm) consider(rows.filter(r => normPhone(r.phone) === lead.phone_norm), 'phone', 'medium');
if (!match && lead.telegram_norm) consider(rows.filter(r => normTelegram(r.telegram) === lead.telegram_norm), 'telegram', 'medium');
if (!match && lead.company_norm && lead.name_norm) {
  const weak = rows.filter(r => lower(r.company) === lead.company_norm && lower(r.name) === lead.name_norm && !closed(r));
  const recent = weak.filter(r => now - ts(r.created_at || r.updated_at) < 48 * 36e5);
  if (recent.length) { match = newest(recent); matchBy = 'company_name_48h'; tier = 'weak'; }
  else if (weak.length) { possibleDuplicateOf = newest(weak).lead_id || ''; matchBy = 'company_name_old'; }
}
const isRetry = !!match && (now - ts(match.updated_at || match.created_at)) < 2 * 60 * 1000;
const PR = { INCOMPLETE: 0, COLD: 1, WARM: 2, HOT: 3 };
const ZR = { UNKNOWN: 0, GREEN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };
const pr = x => PR[String(x || '').toUpperCase()] ?? 0;
const zr = x => ZR[String(x || '').toUpperCase()] ?? 0;
// Escalation may only raise priority/zone, never lower them, and only on a match reached
// through an identity the server derived itself (contact data or proven provenance).
// A weak company+name match is too loose to justify rewriting canonical state.
const escalationAllowed = !!match && !isRetry && tier !== 'weak';
const escalated = escalationAllowed && (pr(lead.lead_priority) > pr(match.priority) || zr(lead.financial_zone) > zr(match.financial_zone));
return [{ json: {
  ...lead,
  submission_lead_id: lead.submission_lead_id || '',
  request_id: lead.request_id || '',
  provenance_trusted: !!lead.provenance_trusted,
  dedup_mode: match ? 'duplicate' : 'new',
  dedup_match_by: match ? matchBy : (possibleDuplicateOf ? matchBy : ''),
  dedup_tier: tier,
  dedup_is_retry: isRetry,
  dedup_escalated: escalated,
  existing_lead_id: match ? String(match.lead_id || '') : '',
  merge_lead_id: match ? String(match.lead_id || lead.lead_id) : lead.lead_id,
  possible_duplicate_of: match ? '' : possibleDuplicateOf,
  existing_row: match || {}
} }];