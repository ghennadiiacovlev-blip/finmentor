// Build the only key allowed to claim X-Ray analysis authority.
const VERSION = 'xray-v2';
return $input.all().map(item => {
  const leadId = String(item.json.lead_id || '').trim();
  if (!leadId) return { json: { claim_valid: false } };
  return { json: { claim_valid: true, lead_id: leadId, analysis_version: VERSION, claim_key: leadId + '|' + VERSION } };
});
