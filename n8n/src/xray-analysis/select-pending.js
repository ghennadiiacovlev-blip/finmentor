// FINMENTOR X-Ray Analysis — "Select Pending Leads".
//
// Input: the XRay_Analysis rows ($input), plus Pipeline rows and settings read by name.
// Output: at most xray_max_per_run Pipeline rows that have NO analysis row yet.
//
// FAIL CLOSED. If the XRay_Analysis read errored, nothing is pending: analysing on top of an
// unreadable ledger would re-run the model and re-alert the owner for every lead.
//
// Consent gate. INCOMPLETE leads (no valid contact or no explicit consent) are never sent to
// the model; Normalize + Score Lead sets that priority exactly when consent is missing.

const cfg = $('Settings to Object').first().json.settings || {};
if (cfg.xray_analysis_enabled === false) return [];

const analysisItems = $input.all().map(i => i.json);
if (analysisItems.some(r => r && r.error)) return [];
const analysed = new Set(analysisItems.map(r => String(r.lead_id || '').trim()).filter(Boolean));

const pipelineItems = $('Read Pipeline').all().map(i => i.json);
if (pipelineItems.some(r => r && r.error)) return [];

const since = Date.parse(cfg.xray_analysis_since || '') || 0;
const cap = Number(cfg.xray_max_per_run) > 0 ? Number(cfg.xray_max_per_run) : 3;

function ts(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; }

const pending = pipelineItems
  .filter(r => r && String(r.lead_id || '').trim() !== '')
  .filter(r => !analysed.has(String(r.lead_id).trim()))
  .filter(r => String(r.priority || '').toUpperCase() !== 'INCOMPLETE')
  .filter(r => String(r.status || '').toLowerCase() !== 'incomplete lead')
  .filter(r => ts(r.created_at) >= since)
  .sort((a, b) => ts(a.created_at) - ts(b.created_at))
  .slice(0, cap);

return pending.map(r => ({ json: r }));
