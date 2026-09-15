// FINMENTOR C1 — carry Telegram-owned context into the existing Mini App draft contract.
// Pure: no I/O, no schema changes, no scoring, and no X-Ray logic.
'use strict';

const C1_PREFIX = 'C1:';
const FIELD_NAMES = [
  'company_name', 'business_activity', 'role', 'turnover_band', 'objective',
  'problem', 'problem_free_text', 'desired_outcome', 'desired_outcome_free_text',
  'current_setup', 'decision_horizon', 'documents', 'contact_channel', 'contact_value',
  'important_context', 'locale', 'contact_name'
];

function str(value) { return String(value === undefined || value === null ? '' : value).trim(); }

function readContextNote(value) {
  try {
    const note = JSON.parse(String(value || '{}'));
    return note && note.v === 1 && note.kind === 'premium_context'
      ? note
      : { v: 1, kind: 'premium_context' };
  } catch (e) {
    return { v: 1, kind: 'premium_context' };
  }
}

function fullName(session) {
  const s = session || {};
  const telegramName = [str(s.first_name), str(s.last_name)].filter(Boolean).join(' ');
  return str(s.contact_name) || telegramName;
}

function projectionEnvelope(reset, session) {
  const s = session || {};
  const note = readContextNote(s.notes);
  return C1_PREFIX + JSON.stringify({
    v: 1,
    reset: str(reset),
    original_text: String(note.original_text || s.free_text_request || '').slice(0, 500),
    extracted: note.extracted && typeof note.extracted === 'object' ? note.extracted : {},
    context_confirmed: note.context_confirmed === true,
    first_name: str(s.first_name).slice(0, 100),
    last_name: str(s.last_name).slice(0, 100),
    contact_name: str(s.contact_name).slice(0, 200)
  });
}

function readProjection(value) {
  const raw = String(value || '');
  if (!raw.startsWith(C1_PREFIX)) { return { v: 1, reset: raw }; }
  try {
    const parsed = JSON.parse(raw.slice(C1_PREFIX.length));
    return parsed && parsed.v === 1 ? parsed : { v: 1, reset: '' };
  } catch (e) {
    return { v: 1, reset: '' };
  }
}

function field(value, source, confirmed, at) {
  const present = value !== null && value !== undefined && value !== '';
  return {
    value: present ? value : null,
    source: present ? source : null,
    confirmed: present && confirmed === true,
    at: present && confirmed === true ? String(at || '') : null
  };
}

function draftFromProjection(value, cycleId, nowIso) {
  const p = readProjection(value);
  const fields = {};
  for (const name of FIELD_NAMES) { fields[name] = field(null, null, false, null); }

  const extracted = p.extracted && typeof p.extracted === 'object' ? p.extracted : {};
  const confirmed = p.context_confirmed === true;
  const extractedSource = confirmed ? 'user_confirmed' : 'ai_inferred';
  for (const name of ['company_name', 'business_activity', 'role', 'turnover_band', 'objective']) {
    const valueNow = str(extracted[name]);
    if (valueNow) { fields[name] = field(valueNow, extractedSource, confirmed, nowIso); }
  }

  const original = String(p.original_text || '').slice(0, 500);
  if (original) { fields.important_context = field(original, 'user_explicit', true, nowIso); }

  const tgName = [str(p.first_name), str(p.last_name)].filter(Boolean).join(' ');
  const displayName = str(p.contact_name) || tgName;
  if (displayName) {
    const explicit = str(p.contact_name) && str(p.contact_name) !== tgName;
    fields.contact_name = field(displayName, explicit ? 'user_explicit' : 'telegram_carried', true, nowIso);
  }

  return {
    v: 1,
    cycle_id: String(cycleId || ''),
    step: 'APP_BOOTSTRAP',
    updated_at: String(nowIso || ''),
    fields
  };
}

module.exports = {
  C1_PREFIX,
  FIELD_NAMES,
  readContextNote,
  fullName,
  projectionEnvelope,
  readProjection,
  draftFromProjection
};
