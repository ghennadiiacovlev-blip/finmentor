// FINMENTOR C3 — validate a targeted, internal owner-intelligence invocation.
// No public trigger is added. Scheduled runs never execute this node.

const items = $input.all().map((item) => item.json || {});
if (items.length !== 1) throw new Error('C3_TARGET_CARDINALITY_INVALID');

const request = items[0];
const leadId = String(request.lead_id || '').trim();
const requestId = String(request.request_id || '').trim();
if (request.event !== 'AUTHENTICATED_NEW_COMMITTED') throw new Error('C3_EVENT_INVALID');
if (request.source_workflow_id !== 'QmIyEW2ZEqKregmN') throw new Error('C3_SOURCE_INVALID');
if (!leadId || leadId.length > 80 || /[\u0000-\u001f\u007f]/.test(leadId)) throw new Error('C3_LEAD_ID_INVALID');
if (!requestId || requestId.length > 80 || /[\u0000-\u001f\u007f]/.test(requestId)) throw new Error('C3_REQUEST_ID_INVALID');

return [{ json: {
  c3_targeted: true,
  c3_target_lead_id: leadId,
  c3_request_id: requestId
} }];
