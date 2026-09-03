// PostgreSQL states the atomic INSERT verdict; row counts or read-before-write never arbitrate.
const row = $input.first().json;
const claimed = Number(row.claimed);
const source = $('Build Analysis Claim').item.json;
return { json: {
  claim_won: source.claim_valid === true && claimed === 1 ? 1 : 0,
  lead_id: source.lead_id || '', analysis_version: source.analysis_version || '', claim_key: source.claim_key || ''
} };
