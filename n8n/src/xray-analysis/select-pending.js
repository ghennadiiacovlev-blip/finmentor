// FINMENTOR X-Ray Analysis — "Select Pending Leads".
//
// Input: the XRay_Analysis rows ($input), plus Pipeline rows and settings read by name.
// Output: at most xray_max_per_run Pipeline rows. New leads are marked NEW_ANALYSIS. A failed
//         row is retried in place under the bounded ledger contract below. A legacy row is
//         upgraded only when its exact analysis_id is explicitly authorised in Settings.
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
const now = Date.now();
const RETRY_MAX = 3;
const SCHEDULE_NEW_GRACE_MS = 15 * 60 * 1000;

function retryMeta(row) {
  const raw = String((row || {}).validation_errors || '');
  const attemptMatch = /(?:^|[|;])ATTEMPT=(\d+)/i.exec(raw);
  const nextMatch = /(?:^|[|;])NEXT=([^|;]+)/i.exec(raw);
  const attempt = attemptMatch ? Number(attemptMatch[1]) : 1;
  const fallbackNext = ts((row || {}).created_at) + 5 * 60 * 1000;
  const nextAt = nextMatch && ts(nextMatch[1]) ? ts(nextMatch[1]) : fallbackNext;
  return { attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1, nextAt };
}

function retryableFailed(row) {
  if (!row || String(row.review_status || '').toUpperCase() !== 'ANALYSIS_FAILED') return false;
  if (String(row.owner_brief_json || '').trim() !== '' || String(row.analysis_json || '').trim() !== '') return false;
  const meta = retryMeta(row);
  return meta.attempt < RETRY_MAX && now >= meta.nextAt;
}

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

// C3 targeted mode is the same approved NEW_ANALYSIS path with a cardinality of one. It may select
// only the exact committed lead named by the internal trigger. The ordinary schedule path never
// executes Validate C3 Lead Target and therefore remains byte-for-byte equivalent below.
let c3TargetLeadId = '';
try {
  const target = $('Validate C3 Lead Target').first().json || {};
  if (target.c3_targeted === true) {
    // An ineligible targeted invocation is not a schedule tick. It must finish empty instead of
    // falling through and unexpectedly consuming unrelated backlog work.
    if (target.c3_target_eligible !== true) return [];
    c3TargetLeadId = String(target.c3_target_lead_id || '').trim();
  }
} catch (e) {}
if (c3TargetLeadId) {
  const pipelineMatches = eligiblePipeline.filter((row) => String(row.lead_id || '').trim() === c3TargetLeadId);
  if (pipelineMatches.length !== 1) return [];
  if ((analysesByLead[c3TargetLeadId] || []).length !== 0) return [];
  return [{ json: { ...pipelineMatches[0], analysis_mode: 'NEW_ANALYSIS', c3_targeted: true } }];
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

// Failed attempts are retried against the SAME analysis_id. Exactly one failed row and one
// Pipeline row are required; ambiguity fails closed. A successful row is never selected again.
const retries = eligiblePipeline.filter((pipe) => {
  const id = String(pipe.lead_id).trim();
  const rows = analysesByLead[id] || [];
  return rows.length === 1 && retryableFailed(rows[0]);
}).map((pipe) => ({
  ...pipe,
  analysis_mode: 'RETRY_FAILED',
  existing_analysis: analysesByLead[String(pipe.lead_id).trim()][0]
}));

// The schedule gives a just-committed lead fifteen minutes for the immediate intake dispatch to
// finish. This removes the only normal race in which the schedule and the immediate trigger could
// both start the model before either had written its ledger row. Older unanalysed leads remain a
// deterministic fallback. C3 targeted mode above is immediate and has no grace.
const fresh = eligiblePipeline.filter((pipe) => {
  const id = String(pipe.lead_id).trim();
  return (analysesByLead[id] || []).length === 0 && now - ts(pipe.created_at) >= SCHEDULE_NEW_GRACE_MS;
}).map((pipe) => ({ ...pipe, analysis_mode: 'NEW_ANALYSIS' }));

const selected = retries.concat(fresh).slice(0, cap);

return selected.map(r => ({ json: r }));
