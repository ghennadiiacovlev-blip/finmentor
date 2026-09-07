// FINMENTOR X-Ray Analysis — Settings (key/value rows) -> config object.
// Deployed as the n8n Code node "Settings to Object" in the X-Ray Analysis workflow.
// The Settings tab is the only source of chat ids; nothing is hard-coded here.
//
// New keys read by this workflow (all optional, all with safe defaults):
//   xray_analysis_enabled  true|false          master switch
//   xray_ai_model          gpt-4.1             model id for the analysis
//   xray_analysis_since    ISO timestamp       leads created before it are never analysed
//   xray_max_per_run       3                   cap per sweep, protects the OpenAI budget
//   xray_review_base_url   https://.../webhook/finmentor-xray-review   the owner review link

const rows = $input.all().map(i => i.json);
const s = {};
for (const r of rows) {
  const k = (r.key ?? r.Key ?? '').toString().trim();
  if (k) s[k] = (r.value ?? r.Value ?? '').toString().trim();
}
function bool(v, d) { if (v === undefined || v === '') return d; return ['true', '1', 'yes'].includes(String(v).toLowerCase()); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }
function iso(v, d) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? new Date(t).toISOString() : d; }

const cfg = {
  owner_chat_id: s.owner_chat_id || '',
  timezone: s.timezone || 'Europe/Chisinau',
  xray_analysis_enabled: bool(s.xray_analysis_enabled, true),
  xray_ai_model: s.xray_ai_model || 'gpt-4.1',
  xray_analysis_since: iso(s.xray_analysis_since, '2026-09-03T00:00:00.000Z'),
  xray_max_per_run: Math.min(num(s.xray_max_per_run, 3), 10),
  xray_review_base_url: s.xray_review_base_url || 'https://ghennadi.app.n8n.cloud/webhook/finmentor-xray-review',
  crm_url: 'https://docs.google.com/spreadsheets/d/1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A/edit'
};
return [{ json: { settings: cfg } }];
