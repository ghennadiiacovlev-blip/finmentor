// FINMENTOR V1 — validate a targeted, post-commit owner-intelligence invocation.
// There is no public webhook: only Lead Intake can call this internal trigger.

const items = $input.all().map((item) => item.json || {});
if (items.length !== 1) throw new Error('C3_TARGET_CARDINALITY_INVALID');

const request = items[0];
const leadId = String(request.lead_id || '').trim();
const requestId = String(request.request_id || '').trim();
const settlementMode = request.event === 'ELIGIBLE_MERGE_COMMITTED' ? 'merged'
  : request.event === 'ELIGIBLE_NEW_COMMITTED' ? 'new' : '';
if (!settlementMode || String(request.settlement_mode || settlementMode) !== settlementMode) throw new Error('C3_EVENT_INVALID');
if (request.source_workflow_id !== 'QmIyEW2ZEqKregmN') throw new Error('C3_SOURCE_INVALID');
if (!leadId || leadId.length > 80 || /[\u0000-\u001f\u007f]/.test(leadId)) throw new Error('C3_LEAD_ID_INVALID');
if (!requestId || requestId.length > 80 || /[\u0000-\u001f\u007f]/.test(requestId)) throw new Error('C3_REQUEST_ID_INVALID');

return [{ json: {
  c3_targeted: true,
  c3_target_eligible: request.eligible === true,
  c3_target_lead_id: leadId,
  c3_request_id: requestId,
  c3_settlement_mode: settlementMode
} }];
