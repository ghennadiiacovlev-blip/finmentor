// FINMENTOR V1 — dispatch one eligible, committed submission to owner intelligence.
//
// This node is downstream of a committed New/Merge verdict and Save Lead to CRM. The graph is the primary
// authority; these assertions make the boundary fail closed if a future edit bypasses either
// prerequisite. Both approved authorities converge here:
//   internal — receipt commit updated exactly one row;
//   public   — the successful Pipeline append reached Respond New Lead, or the successful
//              Pipeline merge update reached Respond Merged.
// Provenance is never used as an eligibility shortcut.

let merged = false;
try { merged = $('Restore Lead Context (Merged)').isExecuted === true; } catch (e) {}
const lead = merged
  ? ($('Restore Lead Context (Merged)').first().json || {})
  : ($('Restore Lead Context').first().json || {});
const internal = lead.provenance_trusted === true;
let commitAuthority = '';
if (internal) {
  const commit = merged
    ? ($('Commit Verdict (Merge)').first().json || {})
    : ($('Commit Verdict (New)').first().json || {});
  if (Number(commit.__commit_updated_rows) !== 1 || Number(commit.__commit_ok) !== 1) return [];
  commitAuthority = merged ? 'RECEIPT_COMMIT_MERGE' : 'RECEIPT_COMMIT';
} else {
  // A committed public merge is a new request on an existing lead. Every eligible lead's legacy
  // intake alert is suppressed in favour of the single X-Ray owner alert, so returning nothing
  // here left a website request that merged with no owner alert at all (2026-09-18 RU incident).
  // Respond Merged is reachable only from a successful Update Pipeline (Merge); a public retry
  // settles through Respond Retry and never reaches this node, and X-Ray analyses one request_id
  // at most once, so this cannot replay an alert for an already-settled request.
  let publicCommitted = false;
  try {
    publicCommitted = merged
      ? $('Respond Merged').isExecuted === true && $('Update Pipeline (Merge)').isExecuted === true
      : $('Respond New Lead').isExecuted === true && $('Save to Pipeline').isExecuted === true;
  } catch (e) {}
  if (!publicCommitted) return [];
  commitAuthority = merged ? 'PUBLIC_PIPELINE_MERGE' : 'PUBLIC_PIPELINE_COMMIT';
}

const leadId = String(lead.lead_id || '').trim();
const requestId = String(lead.request_id || '').trim();
if (!leadId || leadId.length > 80 || /[\u0000-\u001f\u007f]/.test(leadId)) {
  throw new Error('C3_LEAD_ID_INVALID');
}
if (!requestId || requestId.length > 80 || /[\u0000-\u001f\u007f]/.test(requestId)) {
  throw new Error('C3_REQUEST_ID_INVALID');
}
if (!internal && !/^fmr_[0-9a-f]{32}$/.test(requestId)) throw new Error('C3_PUBLIC_REQUEST_ID_INVALID');

// Exact existing Lead Intake eligibility: Normalize + Score Lead maps missing valid contact or
// missing explicit consent to INCOMPLETE / Incomplete Lead. No score or threshold is re-derived.
const eligible = String(lead.lead_priority || '').toUpperCase() !== 'INCOMPLETE'
  && String(lead.status || '').toLowerCase() !== 'incomplete lead';

const envelope = {
  event: merged ? 'ELIGIBLE_MERGE_COMMITTED' : 'ELIGIBLE_NEW_COMMITTED',
  lead_id: leadId,
  request_id: requestId,
  eligible,
  commit_authority: commitAuthority,
  source_workflow_id: 'QmIyEW2ZEqKregmN'
};
if (merged) envelope.settlement_mode = 'merged';
return [{ json: envelope }];
