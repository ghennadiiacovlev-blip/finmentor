// FINMENTOR X-Ray Analysis — "Select Pending Leads".
//
// Input: the XRay_Analysis rows ($input), plus Pipeline rows and settings read by name.
// Output: at most xray_max_per_run Pipeline rows. New leads are marked NEW_ANALYSIS. A bounded
//         number of legacy rows lacking Lead Intelligence v1 fields are marked UPGRADE_EXISTING.
//
// FAIL CLOSED. If the XRay_Analysis read errored, nothing is pending: analysing on top of an
// unreadable ledger would re-run the model and re-alert the owner for every lead.
//
// Consent gate. INCOMPLETE leads (no valid contact or no explicit consent) are never sent to
// the model; Normalize + Score Lead sets that priority exactly when consent is missing.

const cfg = $('Settings to Object').first().json.settings || {};
if (cfg.xray_analysis_enabled === false) return [];

let analysisItems;
try { analysisItems = $('Read XRay_Analysis').all().map(i => i.json); }
catch (e) { analysisItems = $input.all().map(i => i.json); }
if (analysisItems.some(r => r && (r.error || r.errorMessage))) return [];
const analysisRows = analysisItems.filter((r) => r && String(r.lead_id || '').trim());
const analysesByLead = {};
for (const row of analysisRows) {
  const id = String(row.lead_id || '').trim();
  if (!analysesByLead[id]) analysesByLead[id] = [];
  analysesByLead[id].push(row);
}

const pipelineItems = $('Read Pipeline').all().map(i => i.json);
if (pipelineItems.some(r => r && r.error)) return [];

const since = Date.parse(cfg.xray_analysis_since || '') || 0;
const cap = Number(cfg.xray_max_per_run) > 0 ? Number(cfg.xray_max_per_run) : 3;
const backfillEnabled = cfg.xray_backfill_enabled !== false;
const backfillCap = Math.min(Number(cfg.xray_backfill_max_per_run) > 0 ? Number(cfg.xray_backfill_max_per_run) : 1, cap);

function ts(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; }

const eligiblePipeline = pipelineItems
  .filter(r => r && String(r.lead_id || '').trim() !== '')
  .filter(r => String(r.priority || '').toUpperCase() !== 'INCOMPLETE')
  .filter(r => String(r.status || '').toLowerCase() !== 'incomplete lead')
  .filter(r => ts(r.created_at) >= since)
  .sort((a, b) => ts(a.created_at) - ts(b.created_at));

function needsUpgrade(row) {
  if (!row || String(row.review_status || '').toUpperCase() === 'ANALYSIS_FAILED') return false;
  if (/^(COMPLETE|FAILED)$/.test(String(row.lead_intelligence_upgrade_status || '').toUpperCase())) return false;
  return String(row.owner_brief_json || '').trim() === '' || String(row.analysis_version || '').trim() !== 'lead-intelligence-v1';
}

// Ambiguous ledgers fail closed: a lead with multiple analysis rows is neither upgraded nor
// treated as new. It requires an explicit ledger repair outside this sweep.
const upgrades = backfillEnabled ? eligiblePipeline.filter((pipe) => {
  const rows = analysesByLead[String(pipe.lead_id).trim()] || [];
  return rows.length === 1 && needsUpgrade(rows[0]);
}).slice(0, backfillCap).map((pipe) => ({
  ...pipe,
  analysis_mode: 'UPGRADE_EXISTING',
  existing_analysis: analysesByLead[String(pipe.lead_id).trim()][0]
})) : [];

const upgradeIds = new Set(upgrades.map((r) => String(r.lead_id)));
const fresh = eligiblePipeline.filter((pipe) => {
  const id = String(pipe.lead_id).trim();
  return !upgradeIds.has(id) && (analysesByLead[id] || []).length === 0;
}).slice(0, Math.max(0, cap - upgrades.length)).map((pipe) => ({ ...pipe, analysis_mode: 'NEW_ANALYSIS' }));

const pending = upgrades.concat(fresh);

return pending.map(r => ({ json: r }));
