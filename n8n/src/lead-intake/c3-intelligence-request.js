// FINMENTOR C3 — dispatch one authenticated, newly committed lead to owner intelligence.
//
// This node is downstream of IF Committed (New) and Save Lead to CRM. The graph is the primary
// authority; these assertions make the boundary fail closed if a future edit bypasses either
// prerequisite. Public submissions reach Save Lead to CRM too, but never carry graph-proven
// provenance and therefore emit no C3 request.

const lead = $('Restore Lead Context').first().json || {};
if (lead.provenance_trusted !== true) return [];

const commit = $('Commit Verdict (New)').first().json || {};
if (Number(commit.__commit_updated_rows) !== 1 || Number(commit.__commit_ok) !== 1) {
  throw new Error('C3_COMMIT_NOT_VERIFIED');
}

const leadId = String(lead.lead_id || '').trim();
const requestId = String(lead.request_id || '').trim();
if (!leadId || leadId.length > 80 || /[\u0000-\u001f\u007f]/.test(leadId)) {
  throw new Error('C3_LEAD_ID_INVALID');
}
if (!requestId || requestId.length > 80 || /[\u0000-\u001f\u007f]/.test(requestId)) {
  throw new Error('C3_REQUEST_ID_INVALID');
}

return [{ json: {
  event: 'AUTHENTICATED_NEW_COMMITTED',
  lead_id: leadId,
  request_id: requestId,
  source_workflow_id: 'QmIyEW2ZEqKregmN'
} }];
