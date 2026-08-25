// FINMENTOR Command Center — Settings sheet rows to a config object.
//
// Deployed as the n8n Code node "Settings to Object".
//
// Divergence from the shared version used by other workflows: the hardcoded owner chat id
// fallback has been removed. A literal id baked into code is an authorisation bypass — it
// keeps granting access even if the owner clears or changes the allowlist in Settings.
// The Settings sheet is now the only policy source, and an unset allowlist denies everyone.

const rows = $input.all().map(i => i.json);
const settings = {};
for (const r of rows) {
  const key = (r.key ?? r.Key ?? '').toString().trim();
  if (!key) continue;
  settings[key] = (r.value ?? r.Value ?? '').toString().trim();
}
function bool(v, def) {
  if (v === undefined || v === '') return def;
  return String(v).toLowerCase() === 'true' || v === '1';
}
function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
const cfg = {
  owner_chat_id: settings.owner_chat_id || '',
  manager_chat_id: settings.manager_chat_id || '',
  // No literal fallback. Empty here means deny-all downstream.
  allowed_chat_ids: (settings.allowed_chat_ids || settings.owner_chat_id || ''),
  sla_hot_hours: num(settings.sla_hot_hours, 4),
  sla_warm_hours: num(settings.sla_warm_hours, 24),
  sla_repeat_hours: num(settings.sla_repeat_hours, 6),
  default_responsible: settings.default_responsible || 'Геннадий',
  ai_model: settings.ai_model || 'gpt-4.1-mini',
  ai_enabled_for_hot: bool(settings.ai_enabled_for_hot, true),
  ai_enabled_for_warm: bool(settings.ai_enabled_for_warm, true),
  ai_enabled_for_cold: bool(settings.ai_enabled_for_cold, false),
  auto_reply_enabled: bool(settings.auto_reply_enabled, false),
  auto_reply_default_lang: (settings.auto_reply_default_lang || 'ru').toLowerCase(),
  follow_up_enabled: bool(settings.follow_up_enabled, false),
  followup_hot_hours: num(settings.followup_hot_hours, 24),
  followup_warm_hours: num(settings.followup_warm_hours, 72),
  timezone: settings.timezone || 'Europe/Chisinau',
  currency: settings.currency || 'EUR'
};
return [{ json: { settings: cfg } }];
