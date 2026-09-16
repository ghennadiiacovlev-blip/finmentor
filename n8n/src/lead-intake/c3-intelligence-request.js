// FINMENTOR V1 — dispatch one eligible, newly committed lead to owner intelligence.
//
// This node is downstream of IF Committed (New) and Save Lead to CRM. The graph is the primary
// authority; these assertions make the boundary fail closed if a future edit bypasses either
// prerequisite. Both approved authorities converge here:
//   internal — receipt commit updated exactly one row;
//   public   — the successful Pipeline append reached Respond New Lead.
// Provenance is never used as an eligibility shortcut.

const lead = $('Restore Lead Context').first().json || {};
const internal = lead.provenance_trusted === true;
let commitAuthority = '';
if (internal) {
  const commit = $('Commit Verdict (New)').first().json || {};
  if (Number(commit.__commit_updated_rows) !== 1 || Number(commit.__commit_ok) !== 1) return [];
  commitAuthority = 'RECEIPT_COMMIT';
} else {
  let publicNew = false;
  try { publicNew = $('Respond New Lead').isExecuted === true && $('Save to Pipeline').isExecuted === true; } catch (e) {}
  if (!publicNew) return [];
  commitAuthority = 'PUBLIC_PIPELINE_COMMIT';
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

return [{ json: {
  event: 'ELIGIBLE_NEW_COMMITTED',
  lead_id: leadId,
  request_id: requestId,
  eligible,
  commit_authority: commitAuthority,
  source_workflow_id: 'QmIyEW2ZEqKregmN'
} }];
