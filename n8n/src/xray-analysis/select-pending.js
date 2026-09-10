// FINMENTOR X-Ray Analysis — "Select Pending Leads".
//
// Input: the XRay_Analysis rows ($input), plus Pipeline rows and settings read by name.
// Output: at most xray_max_per_run Pipeline rows. New leads are marked NEW_ANALYSIS. A legacy
//         row is upgraded only when its exact analysis_id is explicitly authorised in Settings.
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
const backfillEnabled = cfg.xray_backfill_enabled === true;
const backfillTargetAnalysisId = String(cfg.xray_backfill_target_analysis_id || '').trim();

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

// Explicit target mode is surgical: resolve exactly one ledger row and exactly one eligible
// Pipeline row, reject every ambiguity, and return no fresh work during that sweep. There is no
// ordering, fuzzy identity, request-id or company fallback. A populated target is inert while
// backfill is disabled, so normal fresh analysis continues.
if (backfillEnabled && backfillTargetAnalysisId) {
  const targetedRows = analysisItems.filter((row) =>
    row && String(row.analysis_id || '').trim() === backfillTargetAnalysisId);
  if (targetedRows.length !== 1) return [];

  const target = targetedRows[0];
  const targetLeadId = String(target.lead_id || '').trim();
  if (!targetLeadId || !needsUpgrade(target)) return [];

  const leadLedgerRows = analysesByLead[targetLeadId] || [];
  if (leadLedgerRows.length !== 1 || leadLedgerRows[0] !== target) return [];

  const pipelineMatches = eligiblePipeline.filter((row) => String(row.lead_id || '').trim() === targetLeadId);
  if (pipelineMatches.length !== 1) return [];

  return [{ json: {
    ...pipelineMatches[0],
    analysis_mode: 'UPGRADE_EXISTING',
    existing_analysis: target
  } }];
}

// No explicit target means no legacy migration authority. Fresh leads remain eligible under the
// normal cap; any lead that already has a ledger row is excluded exactly as before.
const fresh = eligiblePipeline.filter((pipe) => {
  const id = String(pipe.lead_id).trim();
  return (analysesByLead[id] || []).length === 0;
}).slice(0, cap).map((pipe) => ({ ...pipe, analysis_mode: 'NEW_ANALYSIS' }));

return fresh.map(r => ({ json: r }));
