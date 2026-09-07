// Dedup Guard v3 — the dedup READ VERDICT, then tiered matching against Pipeline.
// strong: lead_id | medium: normalized email / phone / telegram | weak: company+name only within 48h (older weak matches are flagged, never auto-merged).
// Won/Lost rows never absorb a new submission (returning contact = new lead, flagged).
//
// ===================== P9-R4: FAIL CLOSED ON A READ THAT DID NOT SUCCEED =====================
//
// v2 opened straight into `rows = $input.all()...filter(lead_id)` and read the survivors' COUNT
// as its verdict. That is fail-OPEN, and P9-R3 proved it live: `Read Pipeline (Dedup)` carried
// `alwaysOutputData: true` with `onError: 'continueErrorOutput'`, so a Sheets failure emitted on
// BOTH outputs — the error item on output 1 and a synthetic `{}` on output 0. The filter dropped
// the synthetic item, `rows` became `[]`, and "store unreachable" was indistinguishable from
// "no existing lead matched". The execution then reached `Save to Pipeline` — a write — and
// `Respond New Lead` won the race against `Respond Infra Failed`, so the caller was told
// `{"ok":true,"mode":"new"}` at HTTP 200 while n8n recorded the run as an error.
//
// Two measured facts constrain what can fix it, both from P9-R3/P9-R4 harness runs:
//
//   1. The output-0 item on a failure was BYTE-IDENTICAL to the one a legitimately empty read
//      produces — `{"json":{},"pairedItem":[{"item":0,"input":0}]}`. So no check on this node's
//      input could tell them apart while the error stayed on a separate output.
//   2. The success branch ran to COMPLETION before the error branch started (Dedup Guard at
//      index 10, IF Internal (Infra) at 31). So no cross-branch lookup and no "the stop node
//      will get there first" argument could work either.
//
// The fix moves the failure onto the REGULAR output: `Read Pipeline (Dedup)` now carries
// `onError: 'continueRegularOutput'`. Measured consequences, not assumed ones:
//
//   read succeeds, N rows  -> output 0 = N row items
//   read succeeds, 0 rows  -> output 0 = one `{}`, manufactured by alwaysOutputData, which is
//                             still required so an empty Pipeline sheet does not stall the graph
//   read FAILS             -> output 0 = one `{ error: <message> }` item, and NOTHING ELSE.
//                             alwaysOutputData no longer manufactures an anonymous item on a
//                             failure, because there is no separate success output for it to
//                             appear on.
//
// There is now exactly ONE branch out of the read, so there is no race, no second responder and
// no parallel write path — structurally, not by ordering luck. This node is the single consumer,
// and it refuses to proceed unless every item is POSITIVELY classifiable. It carries
// `onError: 'continueErrorOutput'` and no `alwaysOutputData`, so a throw here produces no item on
// output 0 at all: the write path cannot start, and output 1 carries the existing
// `IF Internal (Infra) -> Respond Infra Failed` contract (HTTP 503, CRM_UNAVAILABLE,
// retryable: true) — one response, and the correct one.
//
// The classification below is deliberately not "does it look like an error". An item is a FAULT
// unless it is recognisably the empty-sheet marker or recognisably a Pipeline row. An unexpected
// shape fails closed rather than being filtered away, which is precisely what v2 did wrong.
const PIPELINE_FIELDS = ['lead_id', 'name', 'company', 'email', 'phone', 'telegram',
  'deal_stage', 'priority', 'financial_zone', 'created_at', 'updated_at', 'request_id'];

const readItems = $input.all().map(i => i.json);
for (const r of readItems) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    throw new Error('DEDUP_READ_FAULT: the dedup read produced a non-object item');
  }
  const keys = Object.keys(r);
  // The empty-sheet marker. Under continueRegularOutput this can ONLY arise from a SUCCESSFUL
  // read that matched nothing — a failure delivers the error item instead. That is the measured
  // distinction the whole fix rests on.
  if (keys.length === 0) { continue; }
  const looksLikeRow = keys.some(k => PIPELINE_FIELDS.includes(k));
  if (looksLikeRow) { continue; }
  // No recognised Pipeline field. An `error` key here is n8n's failure item; anything else is a
  // shape this node cannot vouch for. Both fail closed, and both are retryable to the caller.
  if (Object.prototype.hasOwnProperty.call(r, 'error')) {
    throw new Error('DEDUP_READ_FAULT: the dedup read returned an error item: '
      + String(r.error && r.error.message ? r.error.message : r.error).slice(0, 200));
  }
  throw new Error('DEDUP_READ_FAULT: the dedup read returned an unrecognised item shape: '
    + keys.slice(0, 8).join(','));
}

const lead = $('Normalize + Score Lead').first().json;
// Unchanged from v2 on purpose: the read is now verified above, so filtering on lead_id here is
// once again only about selecting real rows, not about inferring whether the read worked.
const rows = readItems.filter(r => r && String(r.lead_id || '').trim() !== '');
function lower(x) { return String(x ?? '').trim().toLowerCase().replace(/ё/g, 'е'); }
function normEmail(x) { const e = lower(x); return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : ''; }
// Must stay identical to normalizePhoneIdentity in Normalize + Score Lead. Stripping every
// non-digit from an arbitrary string turned digit-bearing emails into phone identities, which
// let a crafted address collide with a real subscriber's number and merge into their row.
function normPhone(x) {
  const s = String(x ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) return '';
  if (/telegram|t\.me/i.test(s)) return '';
  const core = s.split(/[(,;]/)[0].trim();
  if (!/^[+\d][\d\s().\-\/]*$/.test(core)) return '';
  const d = core.replace(/[^\d]/g, '');
  return (d.length >= 6 && d.length <= 15) ? d : '';
}
function normTelegram(x) { let s = lower(x); if (!s) return ''; s = s.replace(/^telegram(\s*chat_id)?\s*:\s*/, '').replace(/^https?:\/\/t\.me\//, '').replace(/^@/, '').trim(); return (/^[a-z0-9_]{3,32}$/.test(s) || /^\d{5,20}$/.test(s)) ? s : ''; }
function ts(x) { const t = Date.parse(String(x || '')); return Number.isFinite(t) ? t : 0; }
const now = Date.now();
const newest = list => list.slice().sort((a, b) => ts(b.updated_at || b.created_at) - ts(a.updated_at || a.created_at))[0];
const closed = r => ['won', 'lost'].includes(lower(r.deal_stage));
let match = null, matchBy = '', tier = '', possibleDuplicateOf = '';
function consider(candidates, by, t) { if (match || !candidates.length) return; const open = candidates.filter(r => !closed(r)); if (open.length) { match = newest(open); matchBy = by; tier = t; } else { possibleDuplicateOf = newest(candidates).lead_id || ''; matchBy = by + '_closed'; } }
// Idempotency tier — CORROBORATED, never standalone.
//
// request_id is minted in the browser by lead-transport.js, and that function also accepts
// a caller-supplied payload.meta.request_id. It is therefore attacker-controllable and is
// NOT a server-owned key. Matching on it alone would hand back exactly the capability
// INDP1-02 removed: anyone who learned a request_id could name the row it belongs to.
//
// It is honoured only when the same row is ALSO reached by an identity the server derived
// itself from the submitted contact data. That combination means "this is the same
// submission arriving again", which is a retry signal, not a selection capability.
let requestIdCorroborated = false;
if (lead.request_id) {
  const rid = String(lead.request_id).trim();
  const sameRequest = rows.filter(r => String(r.request_id || '').trim() !== '' && String(r.request_id || '').trim() === rid);
  const corroborated = sameRequest.filter(r =>
    (lead.email_norm && normEmail(r.email) === lead.email_norm) ||
    (lead.phone_norm && normPhone(r.phone) === lead.phone_norm) ||
    (lead.telegram_norm && normTelegram(r.telegram) === lead.telegram_norm));
  if (corroborated.length) {
    consider(corroborated, 'request_id+identity', 'strong');
    requestIdCorroborated = !!match && matchBy === 'request_id+identity';
  }
}
// Strong tier requires proven provenance. A caller-supplied lead_id is not a row-selection
// capability: honouring it let a public request name an existing CRM row and merge into it.
// Normalize only sets provenance_trusted for requests that arrived through the authenticated
// internal route, so untrusted callers fall through to contact-based matching below.
if (lead.provenance_trusted && lead.lead_id) consider(rows.filter(r => lower(r.lead_id) === lower(lead.lead_id)), 'lead_id', 'strong');
if (!match && lead.email_norm) consider(rows.filter(r => normEmail(r.email) === lead.email_norm), 'email', 'medium');
if (!match && lead.phone_norm) consider(rows.filter(r => normPhone(r.phone) === lead.phone_norm), 'phone', 'medium');
if (!match && lead.telegram_norm) consider(rows.filter(r => normTelegram(r.telegram) === lead.telegram_norm), 'telegram', 'medium');
if (!match && lead.company_norm && lead.name_norm) {
  const weak = rows.filter(r => lower(r.company) === lead.company_norm && lower(r.name) === lead.name_norm && !closed(r));
  const recent = weak.filter(r => now - ts(r.created_at || r.updated_at) < 48 * 36e5);
  if (recent.length) { match = newest(recent); matchBy = 'company_name_48h'; tier = 'weak'; }
  else if (weak.length) { possibleDuplicateOf = newest(weak).lead_id || ''; matchBy = 'company_name_old'; }
}
// A corroborated request_id IS the same submission, whatever the clock says, so it is a
// retry regardless of the two-minute window. That in turn suppresses escalation below and
// tells Build Merge Update to leave attribution alone.
const isRetry = requestIdCorroborated || (!!match && (now - ts(match.updated_at || match.created_at)) < 2 * 60 * 1000);
const PR = { INCOMPLETE: 0, COLD: 1, WARM: 2, HOT: 3 };
const ZR = { UNKNOWN: 0, GREEN: 1, YELLOW: 2, ORANGE: 3, RED: 4 };
const pr = x => PR[String(x || '').toUpperCase()] ?? 0;
const zr = x => ZR[String(x || '').toUpperCase()] ?? 0;
// Escalation may only raise priority/zone, never lower them, and only on a match reached
// through an identity the server derived itself (contact data or proven provenance).
// A weak company+name match is too loose to justify rewriting canonical state.
const escalationAllowed = !!match && !isRetry && tier !== 'weak';
const escalated = escalationAllowed && (pr(lead.lead_priority) > pr(match.priority) || zr(lead.financial_zone) > zr(match.financial_zone));
return [{ json: {
  ...lead,
  submission_lead_id: lead.submission_lead_id || '',
  request_id: lead.request_id || '',
  provenance_trusted: !!lead.provenance_trusted,
  dedup_mode: match ? 'duplicate' : 'new',
  dedup_match_by: match ? matchBy : (possibleDuplicateOf ? matchBy : ''),
  dedup_tier: tier,
  dedup_is_retry: isRetry,
  dedup_request_id_corroborated: requestIdCorroborated,
  dedup_escalated: escalated,
  existing_lead_id: match ? String(match.lead_id || '') : '',
  merge_lead_id: match ? String(match.lead_id || lead.lead_id) : lead.lead_id,
  possible_duplicate_of: match ? '' : possibleDuplicateOf,
  existing_row: match || {}
} }];