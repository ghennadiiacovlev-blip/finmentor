// Synthetic identities and payloads. Nothing here is, or is derived from, real customer data.
import crypto from 'node:crypto';

export const hex32 = () => crypto.randomBytes(16).toString('hex');
export const publicId = () => `fmr_${hex32()}`;
export const miniappId = () => `sub_${hex32()}`;
export const conciergeId = (chatId, epochMs) => `C-${chatId}-${epochMs}`;

// A synthetic Concierge identity shaped exactly like the deployed one: C-<chat_id>-<epoch ms>.
// The chat id is a number no Telegram account has ever had; it exists only to be searched for.
export const SYNTH_CHAT_ID = '987654321987';
export const SYNTH_EPOCH = '1788000000000';
export const synthConciergeId = () => conciergeId(SYNTH_CHAT_ID, SYNTH_EPOCH);

export const fingerprintOf = (requestId) =>
  crypto.createHash('sha256').update(`finmentor:new_lead:v1:${requestId}`, 'utf8').digest('hex');
export const keyOf = (requestId) => `NEW_LEAD:${fingerprintOf(requestId)}`;

let leadSeq = 0;
export const leadId = () => `SYNTH-LEAD-${String(++leadSeq).padStart(5, '0')}`;

export function payload(overrides = {}) {
  return {
    company: 'Synthetic SRL',
    role: 'CFO',
    objective: 'cash visibility',
    situation: 'synthetic fixture row',
    priority: 'high',
    zone: 'RED',
    next_action: 'call',
    source: 'validation-harness',
    contact_channel: 'telegram',
    contact_value: '@synthetic_handle_only',
    ...overrides,
  };
}

export const ALLOWED_KEYS = ['company', 'role', 'objective', 'situation', 'priority', 'zone',
                             'next_action', 'source', 'contact_channel', 'contact_value', 'lead_id'];

export const ENQUEUE = 'SELECT * FROM alerts.enqueue_new_lead($1,$2,$3,$4,$5::jsonb)';
export const ENQUEUE_B64 = 'SELECT * FROM alerts.enqueue_new_lead_b64($1,$2,$3,$4,$5)';
export const b64 = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

// A fresh, fully-shaped synthetic event.
export function newEvent(route = 'public', over = {}) {
  const rid = route === 'public' ? publicId() : route === 'miniapp' ? miniappId() : conciergeId('555000111', Date.now());
  return { route, rid, lead: leadId(), settled: new Date(), pl: payload(over), key: keyOf(rid), fp: fingerprintOf(rid) };
}
export const enqueueArgs = (e) => [e.route, e.rid, e.lead, e.settled.toISOString(), JSON.stringify(e.pl)];
