// FINMENTOR Lead Intelligence v1 — prepare an automatic customer-ready notification.
// Emits a transport request only for an eligible result and a verified Telegram route.

// __LEAD_INTELLIGENCE_NOTIFICATION__ (inlined by the builder)

const verdict = $('Review POST Verdict').first().json || {};
const row = verdict.source_row || {};
let analysis = {}; let brief = {};
try { analysis = JSON.parse(String(row.analysis_json || '{}')) || {}; } catch (e) { analysis = {}; }
try { brief = JSON.parse(String(row.owner_brief_json || '')) || {}; } catch (e) { brief = analysis.owner_brief || {}; }
if (!brief || typeof brief !== 'object') brief = {};
brief.client_result_eligible = row.client_result_eligible === true;
const prepared = LI_NOTIFY.clientNotification({
  row: Object.assign({}, row, { review_status: 'CLIENT_READY' }),
  brief,
  client_result_url: '__PREMIUM_MINIAPP_URL__'
});
return [{ json: {
  auto_send: prepared.eligible === true,
  reason: prepared.reason || '',
  transport_request: prepared.request || null
} }];
