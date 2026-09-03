#!/usr/bin/env node
// FINMENTOR — P9: the Mini App Gateway (identity, replay claim, app session).
//
//   node scripts/build-miniapp-gateway.mjs
//
// REPO-ONLY. Emits n8n/candidate/miniapp-gateway-candidate.json. Never contacts n8n.
//
// ================================ WHAT THIS DEPLOYS ================================
//
//   Gateway Webhook
//     -> Verify InitData        signature (Ed25519) THEN freshness   <- embedded, not retyped
//     -> IF Verified
//          false -> Respond Rejected            (401/400/403, fail closed)
//          true  -> Derive Replay Key
//                -> G5 Replay Claim             THE ONLY Supabase node
//                -> Claim Verdict
//                -> IF Claim Won
//                     false -> Respond Replay Refused   (409)
//                     true  -> Read Cycle Projection      (n8n Data Table, point read)
//                           -> Build App Session          resolves the AUTHORITATIVE cycle
//                           -> IF Cycle Resolved
//                                false -> Respond Cycle Unresolved  (409, never cycle_id '')
//                                true  -> Read User Sessions -> Resolve Session
//                                      -> IF Create Session
//                                           true  -> Create App Session (n8n Data Table)
//                                           false -> IF Session Committed
//                                                      true  -> Read Client Result -> Attach
//                                      -> Respond Bootstrap OK  (200)
//
// ================================ C3.1 — THE AUTHORITATIVE CYCLE (2026-09-03) ================
//
// The resume key is (telegram_user_id, cycle_id). Until C3.1 the Gateway stamped cycle_id ''
// because the authoritative cycle lived only in Bot_Sessions (Google Sheets), which the Gateway
// must never read. The Concierge now writes a two-column PROJECTION on every turn, BEFORE it
// persists the session — n8n Data Table `MiniApp_Cycle_Projection`: telegram_user_id -> cycle_id
// — and the Gateway performs one point read on it. Nothing else is reachable from here.
//
// Fail direction: a missing, empty, malformed or unreadable projection answers 409
// CYCLE_UNRESOLVED and mints NOTHING. The Gateway never invents a cycle and never falls back to
// '' — an old draft can therefore never be resumed across an explicit rotation, because the
// rotation moves the projection first and the resolver filters on the exact cycle.
//
// The order is the owner's required order, and it is STRUCTURAL: `Derive Replay Key` is
// downstream of `IF Verified`, so a forged or stale initData has no path to the claim node. A
// rejected payload cannot consume a replay key because it never reaches the INSERT.
//
// ================================ THE VERIFIER IS EMBEDDED ================================
//
// `Verify InitData` is gateway/n8n/bootstrap-canary.js, read from disk at build time with ONE
// substitution: the BOT_ID sentinel. It is not re-implemented here. That file is already tested
// (gateway/n8n/bootstrap-canary.test.js) and already proven against the n8n Cloud sandbox's
// constraints -- no URLSearchParams, manual percent-decoding exactly once, deterministic
// code-unit key ordering, require('crypto') for Ed25519. Retyping it into a template literal
// would have been a second implementation of a security boundary, which is how the F10 seam
// defect happened: two things that were supposed to agree, and nothing proving they did.
//
// BOT_ID is NON-SECRET configuration (Telegram's own third-party validation takes it in the
// clear). Until it is set the canary fails closed with BOT_ID_NOT_CONFIGURED, so a Gateway
// deployed before the value is known refuses every request rather than accepting any.
//
// ================================ WHAT IS NOT HERE ================================
//
// The SUBMIT path. Its request shape follows the conversation/state-machine specification the
// owner and ChatGPT are defining (execution order steps 7-9), and building it now would mean
// inventing that contract. This deploys the identity half: verify, claim, bind. Submit is added
// once the conversation spec is approved.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CANARY = join(ROOT, 'gateway', 'n8n', 'bootstrap-canary.js');
const OUT = join(ROOT, 'n8n', 'candidate', 'miniapp-gateway-candidate.json');

export const BOT_ID_SENTINEL = 'SET_BOT_ID_BEFORE_CANARY';

// The FINMENTOR client bot numeric id. NON-SECRET: Telegram's own third-party validation takes
// it in the clear, and it is not the token. It is the builder default so the artifact is
// reproducible -- a generator that needed an env var to reproduce its own output would fail the
// byte-exact binding this repo checks everywhere else. The sentinel guard stays in the canary,
// so a body built WITHOUT a configured id still fails closed.
export const CONFIGURED_BOT_ID = '8917808598';
export const G5_TABLE = 'telegram_initdata_replays';
export const APP_SESSION_TABLE = 'MiniApp_App_Sessions';
export const APP_SESSION_AUTHORITY_TABLE = 'finmentor_app_session_authority';
// C3.1 — the Concierge-written cycle projection (two business columns, one row per user) and the
// X-Ray-written customer result projection (CLIENT_READY rows only). Both are n8n Data Tables:
// no credential, no Sheets authority, point reads only.
export const CYCLE_PROJECTION_TABLE = 'MiniApp_Cycle_Projection';
export const CLIENT_RESULT_TABLE = 'XRay_Client_Results';
export const CYCLE_ID_RE = /^C-[0-9]+-[0-9]+$/;
export const SUPABASE_CREDENTIAL = { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' };
export const NEON_CREDENTIAL_ID = 'LWefMXHbpCWhvobq';
export const WEBHOOK_PATH = 'finmentor-miniapp-gateway';
// OWNER DECISION 5 (2026-08-29): 1800s is rejected for the Premium UX. A 30-minute window
// contradicts «Продолжить незавершённый бриф» — a client who steps away for an hour would find no
// session to resume, and the Telegram copy promises otherwise.
//
// The closed Gateway contract does NOT fix this value. Contract §6 requires only "server-side
// TTL", i.e. a BOUNDED lifetime, and never names a number. The G5 replay ledger is a separate
// clock entirely (auth_date + 900s in Derive Replay Key) and is untouched by this change.
//
// Fixed hard expiry, stamped server-side at bootstrap. No sliding extension, and the client
// cannot influence it: expires_at is written by the Gateway and only ever read afterwards.
export const APP_SESSION_TTL_SECONDS = 259200; // 72 hours

export const NODES = [
  'Gateway Webhook', 'Verify InitData', 'IF Verified', 'Respond Rejected',
  'Derive Replay Key', 'G5 Replay Claim', 'Claim Verdict', 'IF Claim Won',
  'Respond Replay Refused', 'Respond Store Unavailable',
  // ── C3.1 authoritative cycle, added 2026-09-03 ──────────────────────────────────────────────
  'Read Cycle Projection', 'Build App Session', 'IF Cycle Store Readable', 'IF Cycle Resolved', 'Respond Cycle Unresolved',
  // ── resume, added 2026-08-30 ────────────────────────────────────────────────────────────────
  'Read User Sessions', 'Resolve Session', 'IF Session Store Readable', 'IF Create Session', 'Claim Session Authority',
  'Apply Session Authority', 'IF Session Authority Proven', 'Build Session Row', 'Create App Session', 'Read Back Sessions', 'Finalise Session',
  // ── C3.4 customer result surface, added 2026-09-03 ──────────────────────────────────────────
  'IF Session Persistence Verified', 'IF Session Committed', 'Read Client Result', 'Attach Client Result',
  'IF Result Store Readable', 'Respond Application Store Unavailable', 'Respond Bootstrap OK'
];

// The ONE node permitted to hold the Supabase credential.
export const G5_CLAIM_NODE = 'G5 Replay Claim';

// ---------------------------------------------------------------- node bodies

// Derivation must equal gateway/g5-replay-claim.mjs deriveReplayKey(). The gate executes both
// over the same vectors and requires identical digests, because "these two agree" is a claim
// about behaviour, not about the text looking similar.
const DERIVE_CODE = [
  "// P9 — derive the G5 replay key from AUTHENTICATED canonical material.",
  "//",
  "// Reached ONLY from the verified branch: signature and freshness have already passed. The",
  "// digest covers the exact bytes Telegram signed plus the signature, domain-separated so the",
  "// key space can be rotated. Identical to gateway/g5-replay-claim.mjs; the gate proves it by",
  "// executing both, not by comparing source.",
  "const crypto = require('crypto');",
  "const LF = String.fromCharCode(10);",
  "const DOMAIN = 'finmentor:g5:v1';",
  "",
  "const wh = $('Gateway Webhook').first().json;",
  "const initData = String((wh.body || {}).init_data || '');",
  "",
  "function decodeOnce(s) { return decodeURIComponent(s); }",
  "const pairs = [];",
  "const seen = {};",
  "const chunks = initData.split('&');",
  "for (let i = 0; i < chunks.length; i++) {",
  "  const c = chunks[i];",
  "  if (c === '') { throw new Error('G5_PARSE'); }",
  "  const eq = c.indexOf('=');",
  "  if (eq === -1) { throw new Error('G5_PARSE'); }",
  "  const k = decodeOnce(c.substring(0, eq));",
  "  const v = decodeOnce(c.substring(eq + 1));",
  "  if (k === '') { throw new Error('G5_PARSE'); }",
  "  if (Object.prototype.hasOwnProperty.call(seen, k)) { throw new Error('G5_PARSE'); }",
  "  seen[k] = true;",
  "  pairs.push([k, v]);",
  "}",
  "const hash = String(seen.hash ? (pairs.filter(function (p) { return p[0] === 'hash'; })[0] || ['', ''])[1] : '');",
  "if (!/^[a-fA-F0-9]{64}$/.test(hash)) { throw new Error('G5_HASH_MISSING'); }",
  "",
  "// buildBotDataCheckString: every field except `hash`, sorted by code unit, k=v joined by LF.",
  "const canonical = pairs",
  "  .filter(function (p) { return p[0] !== 'hash'; })",
  "  .sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; })",
  "  .map(function (p) { return p[0] + '=' + p[1]; })",
  "  .join(LF);",
  "",
  "const replayKey = crypto.createHash('sha256')",
  "  .update(DOMAIN + LF + canonical + LF + hash.toLowerCase(), 'utf8')",
  "  .digest('hex');",
  "",
  "const v = $('Verify InitData').first().json;",
  "const authDate = Number(v.response.auth_date);",
  "const expiresAt = new Date((authDate + 900) * 1000).toISOString();",
  "",
  "// The raw initData stops here. Nothing downstream carries it, and nothing writes it.",
  "return [{ json: {",
  "  replay_key: replayKey,",
  "  expires_at: expiresAt,",
  "  correlation_id: String(v.log.correlation_id || '').slice(0, 80),",
  "  telegram_user_id: String(v.response.safe_user.telegram_user_id),",
  "  auth_date: authDate,",
  "  locale: String(v.response.locale || '')",
  "} }];"
].join('\n');

// ON CONFLICT DO NOTHING is still the whole arbitration: Postgres decides and we only read the
// answer. The INSERT is wrapped in a data-modifying CTE so the statement ALWAYS returns exactly
// one row, carrying its own verdict in `claimed`.
//
// P9-R2. It used to return the INSERTed row itself, so a won claim was one row and a lost claim
// was zero rows. A store OUTAGE was also zero rows on the success output — the claim node carried
// alwaysOutputData, so an error emitted an empty item there as well — and zero rows is exactly
// what a genuine conflict looks like. An unreachable ledger was therefore answered
// 409 REPLAY_REFUSED retryable:false: "you already used this context, never come back."
//
// The verdict is now a value the query STATES rather than a row count we infer, and zero success
// rows is unreachable. An outage produces no success item at all, so the error output is the only
// path left and it answers 503.
//
// A data-modifying WITH runs exactly once and always to completion, independently of whether the
// outer query reads it, so the INSERT is not conditional on the SELECT. G5 semantics are
// unchanged: one atomic INSERT ... ON CONFLICT DO NOTHING, no SELECT-before-INSERT, no schema
// change, fail-closed routing untouched.
const CLAIM_QUERY = [
  'with ins as (',
  '  insert into public.' + G5_TABLE + ' (replay_key, expires_at, correlation_id)',
  "  values ($1, $2::timestamptz, nullif($3, ''))",
  '  on conflict (replay_key) do nothing',
  '  returning replay_key',
  ')',
  'select (select count(*) from ins)::int as claimed'
].join('\n');

const CLAIM_VERDICT_CODE = [
  "// P9 — read Postgres' verdict. This node does NOT arbitrate and must never learn to:",
  "// no SELECT, no count of existing rows, no 'not found so proceed'. The claim query returns",
  "// exactly one row carrying \`claimed\`: 1 when this execution won the key, 0 when the key was",
  "// already held.",
  "//",
  "// P9-R2. This used to infer the verdict from the NUMBER of rows on the success output, which",
  "// made a store outage indistinguishable from a conflict. Read the value; never count rows.",
  "const rows = $input.all();",
  "const claimed = rows.length === 1 ? Number(rows[0].json.claimed) : NaN;",
  "const d = $('Derive Replay Key').first().json;",
  "return [{ json: {",
  "  // Only an explicit claimed = 1 wins. Anything else — no row, several rows, a missing or",
  "  // unparseable column — refuses. Ambiguity must never mint a session.",
  "  claim_won: claimed === 1 ? 1 : 0,",
  "  replay_key: d.replay_key,",
  "  telegram_user_id: d.telegram_user_id,",
  "  correlation_id: d.correlation_id,",
  "  locale: d.locale",
  "} }];"
].join('\n');

// ── THE AUTHORITATIVE SESSION RULE ────────────────────────────────────────────────────────────
//
// The approved client copy promises «Можно продолжить с того места, где остановились», and the
// app session has a 72 h TTL. Minting a new session on every open contradicted both: closing the
// Mini App and reopening it lost the brief, because a new SIGNED CONTEXT was being treated as a
// new BUSINESS REQUEST. It is not. A new brief comes from an explicit new application cycle.
//
// So after G5 has verified, freshness-checked and CLAIMED the new signed context — none of which
// changes — the Gateway resolves which session that Telegram user and cycle already own.
//
// ── WHY A RULE AND NOT A CONSTRAINT ──────────────────────────────────────────────────────────
//
// The n8n Data Table has no unique index, so first-creation cannot be made atomic inside it. Two
// genuinely concurrent opens can therefore both find nothing and both insert. What CAN be made
// exact is which row is AUTHORITATIVE, and that is what this rule is: a total order over the
// user's live rows that every concurrent execution computes identically from the same data.
//
//   · rows for THIS telegram_user_id and THIS cycle_id
//   · not expired
//   · state draft or submitted   (superseded and anything else is out)
//   · ordered by created_at DESC, then app_session_id DESC as a total tie-break
//
// Both racers return the SAME app_session_id and write to the same draft. The losing row is never
// handed to anyone, can never win a later evaluation, and expires with its TTL. It is inert, not
// merely unlikely — which is the difference between arbitration and hoping.
//
// A `submitted` session is resolvable so that reopening after a committed submission shows the
// committed result rather than dropping the client back into qualification.
//
// C3.4 — TERMINAL IS TERMINAL, BEYOND THE TTL. The 72 h TTL bounds a DRAFT. A committed session
// is the record of a submission the consultant already has, and the customer's analysis reaches
// them days later, after human review. Letting the committed row age out would turn a reopen
// into a fresh questionnaire under the same cycle — the exact drop-back the terminal rule forbids
// — so `submitted` rows stay authoritative for their cycle regardless of expires_at. The Submit
// endpoint already applies the same rule (committed is checked before expiry).
const AUTHORITATIVE_RULE = [
  'function authoritative(rows, userId, cycleId, nowMs) {',
  '  const live = (rows || [])',
  "    .filter(r => r && String(r.app_session_id || '').trim() !== '')",
  '    .filter(r => String(r.telegram_user_id || "") === String(userId))',
  '    .filter(r => String(r.cycle_id || "") !== "" && String(r.cycle_id || "") === String(cycleId))',
  '    .filter(r => { const st = String(r.state || ""); return st === "draft" || st === "submitted"; })',
  '    .filter(r => { if (String(r.state) === "submitted") { return true; } const t = new Date(String(r.expires_at)).getTime(); return Number.isFinite(t) && t > nowMs; });',
  '  live.sort((a, b) => {',
  '    const ta = String(a.created_at || ""), tb = String(b.created_at || "");',
  '    if (ta !== tb) { return ta < tb ? 1 : -1; }',
  '    return String(a.app_session_id) < String(b.app_session_id) ? 1 : -1;',
  '  });',
  '  return live[0] || null;',
  '}',
  '',
  '// The bootstrap answer, built in JavaScript. A branch inside a {{ }} template fails silently',
  '// and returns an empty body; this cannot.',
  'function answer(row, locale, resumed) {',
  '  let draft = null;',
  '  try { draft = JSON.parse(String(row.draft_json || "null")); } catch (e) { draft = null; }',
  '  return {',
  '    app_session_id: String(row.app_session_id),',
  '    expires_at: String(row.expires_at),',
  '    state: String(row.state || "draft"),',
  '    resumed: resumed ? 1 : 0,',
  '    // Server-side only: the committed lead behind a submitted session, read by the client',
  '    // result lookup. It is NOT part of __response.',
  '    lead_id: String(row.lead_id || ""),',
  '    __response: {',
  '      ok: true,',
  '      app_session_id: String(row.app_session_id),',
  '      expires_at: String(row.expires_at),',
  '      locale: String(locale || "ru"),',
  '      state: String(row.state || "draft"),',
  '      resumed: !!resumed,',
  '      // The stored draft, so the client can hydrate without a second round trip. It is the',
  '      // The stored draft. It is the client own material returning to it, and nothing else.',
  '      draft: draft && draft.fields ? draft : null',
  '    }',
  '  };',
  '}'
].join('\n');

const RESOLVE_SESSION_CODE = [
  AUTHORITATIVE_RULE,
  '',
  "const c = $('Claim Verdict').first().json;",
  "const cand = $('Build App Session').first().json;",
  'const rows = $input.all().map(i => i.json);',
  'if (rows.some(r => r && (r.error || r.errorMessage))) { return [{ json: { session_store_error: 1, create: 0 } }]; }',
  'const found = authoritative(rows, cand.telegram_user_id, cand.cycle_id, Date.now());',
  '',
  '// Nothing live for this user and cycle: mint. `create` is read by IF Create Session and by',
  '// nothing else, so it never reaches the Data Table.',
  'if (!found) { return [{ json: { create: 1 } }]; }',
  'return [{ json: Object.assign({ create: 0 }, answer(found, c.locale, true)) }];'
].join('\n');

// After the insert, the SAME rule is applied to a fresh read. In the ordinary case the candidate
// is the only live row and wins trivially. Under a concurrent open there are two, and both
// executions arrive here, read both, and return the same winner.
const FINALISE_SESSION_CODE = [
  AUTHORITATIVE_RULE,
  '',
  "const c = $('Claim Verdict').first().json;",
  "const cand = $('Apply Session Authority').first().json;",
  'const rows = $input.all().map(i => i.json);',
  'if (rows.some(r => r && (r.error || r.errorMessage))) { return [{ json: { persistence_error: 1 } }]; }',
  'const found = authoritative(rows, cand.telegram_user_id, cand.cycle_id, Date.now());',
  '',
  '// The read cannot come back empty — this execution inserted a row a moment ago. If it does,',
  '// the store is not answering and the honest reply is the candidate we hold, which is also the',
  '// row we just wrote.',
  'if (!found || String(found.app_session_id) !== String(cand.app_session_id)) { return [{ json: { persistence_error: 1 } }]; }',
  'const row = found;',
  'const resumed = String(row.app_session_id) !== String(cand.app_session_id);',
  'return [{ json: answer(row, c.locale, resumed) }];'
].join('\n');

const BUILD_SESSION_ROW_CODE = [
  '// The Data Table insert uses autoMapInputData, so its input must be EXACTLY the row and',
  '// nothing else. Resolve Session carries a control flag, so the row is re-emitted here rather',
  '// than that node being taught to hide it.',
  "return [{ json: $('Apply Session Authority').first().json }];"
].join('\n');

// PostgreSQL serializes concurrent first-open attempts for one user/cycle.  Both executions
// receive the same server-generated 256-bit bearer; expired drafts rotate atomically.
const SESSION_AUTHORITY_QUERY = [
  'insert into public.' + APP_SESSION_AUTHORITY_TABLE + ' (telegram_user_id, cycle_id, app_session_id, state, created_at, expires_at, updated_at)',
  "values ($1, $2, $3, 'draft', $4::timestamptz, $5::timestamptz, now())",
  'on conflict (telegram_user_id, cycle_id) do update set',
  "  app_session_id = case when public." + APP_SESSION_AUTHORITY_TABLE + ".state = 'draft' and public." + APP_SESSION_AUTHORITY_TABLE + '.expires_at <= now() then excluded.app_session_id else public.' + APP_SESSION_AUTHORITY_TABLE + '.app_session_id end,',
  "  state = case when public." + APP_SESSION_AUTHORITY_TABLE + ".state = 'draft' and public." + APP_SESSION_AUTHORITY_TABLE + ".expires_at <= now() then 'draft' else public." + APP_SESSION_AUTHORITY_TABLE + '.state end,',
  "  created_at = case when public." + APP_SESSION_AUTHORITY_TABLE + ".state = 'draft' and public." + APP_SESSION_AUTHORITY_TABLE + '.expires_at <= now() then excluded.created_at else public.' + APP_SESSION_AUTHORITY_TABLE + '.created_at end,',
  "  expires_at = case when public." + APP_SESSION_AUTHORITY_TABLE + ".state = 'draft' and public." + APP_SESSION_AUTHORITY_TABLE + '.expires_at <= now() then excluded.expires_at else public.' + APP_SESSION_AUTHORITY_TABLE + '.expires_at end,',
  '  updated_at = now()',
  'returning telegram_user_id, cycle_id, app_session_id, state, created_at, expires_at'
].join('\n');

const APPLY_SESSION_AUTHORITY_CODE = [
  "const source = $('Build App Session').first().json;",
  'const rows = $input.all().map(i => i.json);',
  'if (rows.length !== 1) { return [{ json: { authority_error: 1 } }]; }',
  'const r = rows[0];',
  "if (!/^AS-[0-9a-f]{64}$/.test(String(r.app_session_id || '')) || String(r.telegram_user_id || '') !== String(source.telegram_user_id) || String(r.cycle_id || '') !== String(source.cycle_id)) return [{ json: { authority_error: 1 } }];",
  'return [{ json: { app_session_id: String(r.app_session_id), telegram_user_id: String(r.telegram_user_id), chat_id: String(r.telegram_user_id), cycle_id: String(r.cycle_id), replay_key: String(source.replay_key), state: String(r.state || "draft"), created_at: new Date(r.created_at).toISOString(), expires_at: new Date(r.expires_at).toISOString(), updated_at: new Date().toISOString(), draft_json: "" } }];'
].join('\n');

// C3.4 — the customer result, attached to a COMMITTED session only. The X-Ray workflow writes
// `XRay_Client_Results` exclusively on CLIENT_READY promotion, so a row here is by construction
// human-reviewed. Anything else — no row, a row for another lead, a non-CLIENT_READY row, an
// unparseable JSON — yields result: null and result_state PENDING, never a partial analysis.
const ATTACH_CLIENT_RESULT_CODE = [
  "const s = $('Resolve Session').first().json;",
  "const leadId = String(s.lead_id || '');",
  "const allRows = $input.all().map(i => i.json);",
  "if (allRows.some(r => r && (r.error || r.errorMessage))) return [{ json: { result_store_error: 1 } }];",
  "const rows = allRows",
  "  .filter(r => r && !r.error && !r.errorMessage)",
  "  .filter(r => leadId !== '' && String(r.lead_id || '') === leadId)",
  "  .filter(r => String(r.review_status || '') === 'CLIENT_READY');",
  "rows.sort((a, b) => String(b.published_at || '') < String(a.published_at || '') ? -1 : 1);",
  "let result = null;",
  "if (rows[0]) { try { result = JSON.parse(String(rows[0].result_json || 'null')); } catch (e) { result = null; } }",
  "if (!result || typeof result !== 'object' || Array.isArray(result)) { result = null; }",
  "if (result) { const allowed = ['locale','labels','score','zone','maturity','key_risks','management_priorities','plan_30_days','tomorrow_actions','recommended_next_step']; result = Object.fromEntries(Object.entries(result).filter(([k]) => allowed.includes(k))); }",
  "const out = Object.assign({}, s);",
  "out.__response = Object.assign({}, s.__response, { result: result, result_state: result ? 'CLIENT_READY' : 'PENDING' });",
  "return [{ json: out }];"
].join('\n');

const BUILD_SESSION_CODE = [
  "// P9 — mint the app session AFTER the replay claim was won, never before.",
  "//",
  "// app_session_id is 32 random bytes from crypto.randomBytes, hex-encoded. It is NOT the",
  "// storage row id and is not derived from the Telegram user: exposing a row id would leak",
  "// ordering and let a caller guess neighbours.",
  "//",
  "// The session is a BINDING with a TTL. It is not proof of consent, it is not an identity",
  "// claim on its own, and it never becomes a second CRM: one Telegram user, one authoritative",
  "// cycle, a state, and a bounded draft.",
  "//",
  "// C3.1 — THE CYCLE IS RESOLVED HERE, SERVER-SIDE, FROM THE CONCIERGE PROJECTION. $input is the",
  "// point read on MiniApp_Cycle_Projection for this Telegram user. Exactly one usable row is",
  "// expected; if several exist the most recently projected wins. A missing, malformed or",
  "// unreadable projection resolves to NOTHING: the item below carries cycle_id '' and no session",
  "// fields, IF Cycle Resolved routes it to a 409, and no row is ever written. The Gateway never",
  "// mints a cycle and never resumes under ''.",
  "const crypto = require('crypto');",
  "const c = $('Claim Verdict').first().json;",
  "const CYCLE_ID_RE = " + String(CYCLE_ID_RE) + ";",
  "const projectionRows = $input.all().map(i => i.json);",
  "if (projectionRows.some(r => r && (r.error || r.errorMessage))) return [{ json: { cycle_id: '', cycle_store_error: 1 } }];",
  "const proj = projectionRows",
  "  .filter(r => r && typeof r === 'object' && !r.error && !r.errorMessage)",
  "  .filter(r => String(r.telegram_user_id || '') === String(c.telegram_user_id))",
  "  .filter(r => CYCLE_ID_RE.test(String(r.cycle_id || '')))",
  "  .filter(r => String(r.authority_key || '') === String(c.telegram_user_id) + '|' + String(r.cycle_id || ''))",
  "  .filter(r => String(r.cycle_sequence || '') === String(r.cycle_id || '').split('-').pop());",
  "proj.sort((a, b) => {",
  "  const sa = BigInt(String(a.cycle_sequence)), sb = BigInt(String(b.cycle_sequence));",
  "  if (sa !== sb) return sa < sb ? 1 : -1;",
  "  const ka = String(a.authority_key || ''), kb = String(b.authority_key || '');",
  "  if (ka !== kb) return ka < kb ? 1 : -1;",
  "  return Number(b.id || 0) - Number(a.id || 0);",
  "});",
  "const cycleId = proj[0] ? String(proj[0].cycle_id) : '';",
  "if (cycleId === '') { return [{ json: { cycle_id: '', cycle_unresolved: 1 } }]; }",
  "const now = new Date();",
  "const TTL_SECONDS = " + APP_SESSION_TTL_SECONDS + ";",
  "return [{ json: {",
  "  app_session_id: 'AS-' + crypto.randomBytes(32).toString('hex'),",
  "  telegram_user_id: String(c.telegram_user_id),",
  "  chat_id: String(c.telegram_user_id),",
  "  // The AUTHORITATIVE application cycle, projected by the Concierge. Never '' past this point.",
  "  cycle_id: cycleId,",
  "  replay_key: String(c.replay_key),",
  "  state: 'draft',",
  "  created_at: now.toISOString(),",
  "  expires_at: new Date(now.getTime() + TTL_SECONDS * 1000).toISOString(),",
  "  updated_at: now.toISOString(),",
  "  draft_json: ''",
  "} }];"
].join('\n');

// P9-R1. `responseCode` MUST be a number, or an n8n expression that EVALUATES to one.
//
// The string '=200' is neither. The leading '=' marks the value as an expression, but the
// body '200' contains no {{ }}, so n8n evaluates it to the STRING '200' and hands that to
// the HTTP layer -- which throws while writing the response, AFTER the graph has already
// finished. The execution is recorded as a SUCCESS and the caller receives a bare 500.
//
// That is exactly how A and B failed live on 2026-08-29 while C succeeded: C is the only
// respond node whose code was a real {{ }} expression. Proven in isolation on a
// credential-free probe: '=409' -> 500, '={{ 409 }}' -> 409, 409 -> 409.
//
// Fixed codes are emitted as plain numbers, which is what the n8n editor itself stores and
// needs no expression evaluation at all. A dynamic code must use {{ }}.
const respond = (name, id, x, y, codeExpr, bodyExpr) => {
  const literalExpressionCode = typeof codeExpr === 'string' && /^=(?!.*{{)/.test(codeExpr);
  if (literalExpressionCode) {
    throw new Error(
      'respond(' + name + '): responseCode ' + JSON.stringify(codeExpr) +
      ' is an expression with no {{ }} and evaluates to a string, which returns HTTP 500. ' +
      'Use a plain number, or a {{ }} expression.'
    );
  }
  return {
  parameters: {
    respondWith: 'json',
    responseBody: bodyExpr,
    options: { responseCode: codeExpr }
  },
  id: id, name: name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1,
  position: [x, y]
  };
};

export function buildGateway(options) {
  const botId = (options && options.botId) || CONFIGURED_BOT_ID;
  const canarySrc = readFileSync(CANARY, 'utf8');
  if (canarySrc.indexOf("const BOT_ID = '" + BOT_ID_SENTINEL + "';") === -1) {
    throw new Error('the tracked canary no longer carries the BOT_ID sentinel');
  }
  const verifyCode = canarySrc.replace(
    "const BOT_ID = '" + BOT_ID_SENTINEL + "';",
    "const BOT_ID = '" + botId + "';"
  );

  const wf = {
    name: 'FINMENTOR Mini App Gateway',
    nodes: [
      { parameters: {
          httpMethod: 'POST', path: WEBHOOK_PATH, responseMode: 'responseNode',
          options: { rawBody: false }
        },
        id: 'gw-01-webhook', name: 'Gateway Webhook', type: 'n8n-nodes-base.webhook',
        typeVersion: 2, position: [-620, 0], webhookId: 'e2f1c0d4-9a7b-4c11-8f3e-6b2a5d9c7e10' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: verifyCode },
        id: 'gw-02-verify', name: 'Verify InitData', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [-400, 0] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-verified', leftValue: '={{ $json.statusCode }}', rightValue: 200,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-03-ifverified', name: 'IF Verified', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [-180, 0] },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: DERIVE_CODE },
        id: 'gw-04-derive', name: 'Derive Replay Key', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [40, -120] },

      { parameters: { operation: 'executeQuery', query: CLAIM_QUERY,
          options: { queryReplacement: '={{ $json.replay_key }},={{ $json.expires_at }},={{ $json.correlation_id }}' } },
        id: 'gw-05-claim', name: G5_CLAIM_NODE, type: 'n8n-nodes-base.postgres',
        typeVersion: 2.6, position: [260, -120],
        credentials: { postgres: SUPABASE_CREDENTIAL },
        // FAIL CLOSED. An unreachable ledger routes to a 503; it must never fall through to the
        // session branch, because "cannot know whether this was replayed" is not "proceed".
        //
        // P9-R2. alwaysOutputData is deliberately ABSENT, and its absence is gated below. With it,
        // an error fired BOTH outputs — the error item on output 1 and an empty item on output 0 —
        // and the empty one ran ahead through Claim Verdict to commit a 409 before
        // Respond Store Unavailable could answer. The CTE is what makes the flag unnecessary: a
        // conflict now returns a row of its own accord, so the zero-row success case is gone.
        onError: 'continueErrorOutput' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: CLAIM_VERDICT_CODE },
        id: 'gw-06-verdict', name: 'Claim Verdict', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [480, -220] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-claimwon', leftValue: '={{ $json.claim_won }}', rightValue: 1,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-07-ifclaim', name: 'IF Claim Won', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [700, -220] },

      // C3.1 — the ONE read the Gateway makes outside its own session store: a point read on the
      // Concierge's cycle projection. No credential. alwaysOutputData so a user with no projection
      // still reaches Build App Session, which answers CYCLE_UNRESOLVED rather than nothing.
      { parameters: { resource: 'row', operation: 'get',
          dataTableId: { __rl: true, mode: 'name', value: CYCLE_PROJECTION_TABLE },
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'telegram_user_id', condition: 'eq',
            keyValue: '={{ $json.telegram_user_id }}' }] },
          returnAll: true },
        id: 'gw-07b-readcycle', name: 'Read Cycle Projection', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [900, -320],
        alwaysOutputData: true, onError: 'continueRegularOutput' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: BUILD_SESSION_CODE },
        id: 'gw-08-buildsession', name: 'Build App Session', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [920, -320] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-cycle-readable', leftValue: '={{ Number($json.cycle_store_error || 0) }}', rightValue: 0,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-08-ifcyclestore', name: 'IF Cycle Store Readable', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1010, -320] },

      // Read every row this Telegram user owns. `returnAll` matters: without it the node answers
      // with the first match only and the rule would order a set of one.
      { parameters: { resource: 'row', operation: 'get',
          dataTableId: { __rl: true, mode: 'name', value: APP_SESSION_TABLE },
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'telegram_user_id', condition: 'eq',
            keyValue: '={{ $json.telegram_user_id }}' }] },
          returnAll: true },
        id: 'gw-08a-readsessions', name: 'Read User Sessions', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [1040, -320],
        // A user with no rows yet must still produce an item, or the resolver never runs and the
        // caller gets an empty 200. Safe with continueRegularOutput: one output, always.
        alwaysOutputData: true, onError: 'continueRegularOutput' },

      // C3.1 — a non-empty cycle is the ONLY way past this point. String notEmpty on the exact
      // field the session row carries, so the refusal item (cycle_id '') can never reach the store.
      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-cycle-resolved', leftValue: '={{ $json.cycle_id }}', rightValue: '',
            operator: { type: 'string', operation: 'notEmpty', singleValue: true } }], combinator: 'and' }, options: {} },
        id: 'gw-08a-ifcycle', name: 'IF Cycle Resolved', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1040, -220] },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: RESOLVE_SESSION_CODE },
        id: 'gw-08b-resolve', name: 'Resolve Session', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [1140, -320] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-session-readable', leftValue: '={{ Number($json.session_store_error || 0) }}', rightValue: 0,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-08b-ifstore', name: 'IF Session Store Readable', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1190, -320] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-create-session', leftValue: '={{ $json.create }}', rightValue: 1,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-08c-ifcreate', name: 'IF Create Session', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1240, -320] },

      { parameters: { operation: 'executeQuery', query: SESSION_AUTHORITY_QUERY,
          options: { queryReplacement: '={{ $(\'Build App Session\').first().json.telegram_user_id }},={{ $(\'Build App Session\').first().json.cycle_id }},={{ $(\'Build App Session\').first().json.app_session_id }},={{ $(\'Build App Session\').first().json.created_at }},={{ $(\'Build App Session\').first().json.expires_at }}' } },
        id: 'gw-08c-claimsession', name: 'Claim Session Authority', type: 'n8n-nodes-base.postgres',
        typeVersion: 2.6, position: [1290, -430], credentials: { postgres: SUPABASE_CREDENTIAL },
        onError: 'continueErrorOutput' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: APPLY_SESSION_AUTHORITY_CODE },
        id: 'gw-08c-applysession', name: 'Apply Session Authority', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [1330, -430] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-authority-proven', leftValue: '={{ Number($json.authority_error || 0) }}', rightValue: 0,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-08c-ifauthority', name: 'IF Session Authority Proven', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1360, -430] },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: BUILD_SESSION_ROW_CODE },
        id: 'gw-08d-buildrow', name: 'Build Session Row', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [1340, -400] },

      { parameters: { resource: 'row', operation: 'upsert',
          dataTableId: { __rl: true, mode: 'name', value: APP_SESSION_TABLE },
          matchType: 'allConditions', filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq', keyValue: '={{ $json.app_session_id }}' }] },
          columns: { mappingMode: 'autoMapInputData', matchingColumns: [], schema: [], value: {} },
          options: {} },
        id: 'gw-09-createsession', name: 'Create App Session', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [1440, -400],
        // The session-store failure branch (gw-store-failure, live since 2026-08-30): an insert
        // error leaves on output 1 towards Session Store Verdict -> 503, never onward. No
        // alwaysOutputData, so this is not the P9-R2 pair. The branch's nodes are live-only and
        // are preserved by the deploy merge; the flag is modelled here so the candidate node
        // equals the live node.
        onError: 'continueErrorOutput' },

      { parameters: { resource: 'row', operation: 'get',
          dataTableId: { __rl: true, mode: 'name', value: APP_SESSION_TABLE },
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'app_session_id', condition: 'eq',
            keyValue: '={{ $(\'Apply Session Authority\').first().json.app_session_id }}' }] },
          returnAll: true },
        id: 'gw-09a-readback', name: 'Read Back Sessions', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [1540, -400],
        alwaysOutputData: true, onError: 'continueRegularOutput' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: FINALISE_SESSION_CODE },
        id: 'gw-09b-finalise', name: 'Finalise Session', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [1640, -400] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-persistence-verified', leftValue: '={{ Number($json.persistence_error || 0) }}', rightValue: 0,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-09b-ifpersist', name: 'IF Session Persistence Verified', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1690, -400] },

      // C3.4 — the resume branch forks on the stored state: a committed session looks up its
      // customer result; a draft answers directly, exactly as before.
      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-session-committed', leftValue: '={{ $json.state }}', rightValue: 'submitted',
            operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-09c-ifcommitted', name: 'IF Session Committed', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1340, -240] },

      { parameters: { resource: 'row', operation: 'get',
          dataTableId: { __rl: true, mode: 'name', value: CLIENT_RESULT_TABLE },
          matchType: 'allConditions',
          filters: { conditions: [{ keyName: 'lead_id', condition: 'eq',
            keyValue: '={{ $json.lead_id }}' }] },
          returnAll: true },
        id: 'gw-09d-readresult', name: 'Read Client Result', type: 'n8n-nodes-base.dataTable',
        typeVersion: 1, position: [1460, -240],
        alwaysOutputData: true, onError: 'continueRegularOutput' },

      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ATTACH_CLIENT_RESULT_CODE },
        id: 'gw-09e-attachresult', name: 'Attach Client Result', type: 'n8n-nodes-base.code',
        typeVersion: 2, position: [1580, -240] },

      { parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{ id: 'gw-result-readable', leftValue: '={{ Number($json.result_store_error || 0) }}', rightValue: 0,
            operator: { type: 'number', operation: 'equals' } }], combinator: 'and' }, options: {} },
        id: 'gw-09e-ifresult', name: 'IF Result Store Readable', type: 'n8n-nodes-base.if',
        typeVersion: 2.2, position: [1640, -240] },

      // The whole answer is assembled in JavaScript by Resolve Session or Finalise Session and
      // merely serialised here — the two nodes emit the same `__response` shape, so this responder
      // does not need to know which path reached it.
      respond('Respond Bootstrap OK', 'gw-10-ok', 1760, -320, 200,
        '={{ JSON.stringify($json.__response) }}'),

      respond('Respond Rejected', 'gw-11-rejected', 40, 140,
        '={{ $json.statusCode }}',
        '={{ JSON.stringify({ ok: false, error_code: $json.response.error_code, retryable: $json.response.retryable === true }) }}'),

      respond('Respond Replay Refused', 'gw-12-replay', 920, -100, 409,
        '={{ JSON.stringify({ ok: false, error_code: \'REPLAY_REFUSED\', retryable: false }) }}'),

      respond('Respond Store Unavailable', 'gw-13-store', 480, 40, 503,
        '={{ JSON.stringify({ ok: false, error_code: \'REPLAY_STORE_UNAVAILABLE\', retryable: true }) }}'),

      // C3.1 — no authoritative cycle for this user: nothing is minted, nothing is resumed. The
      // client tells the customer to return to the bot chat; the Concierge projects the cycle on
      // its next turn. Not retryable: a retry without a bot turn cannot change the answer.
      respond('Respond Cycle Unresolved', 'gw-14-cycle', 1140, -120, 409,
        '={{ JSON.stringify({ ok: false, error_code: \'CYCLE_UNRESOLVED\', retryable: false }) }}'),

      respond('Respond Application Store Unavailable', 'gw-15-appstore', 1320, 40, 503,
        '={{ JSON.stringify({ ok: false, error_code: \'APPLICATION_STORE_UNAVAILABLE\', retryable: true }) }}')
    ],
    connections: {
      'Gateway Webhook': { main: [[{ node: 'Verify InitData', type: 'main', index: 0 }]] },
      'Verify InitData': { main: [[{ node: 'IF Verified', type: 'main', index: 0 }]] },
      'IF Verified': { main: [
        [{ node: 'Derive Replay Key', type: 'main', index: 0 }],
        [{ node: 'Respond Rejected', type: 'main', index: 0 }]
      ] },
      'Derive Replay Key': { main: [[{ node: G5_CLAIM_NODE, type: 'main', index: 0 }]] },
      // output 0 = query result, output 1 = error (fail closed)
      [G5_CLAIM_NODE]: { main: [
        [{ node: 'Claim Verdict', type: 'main', index: 0 }],
        [{ node: 'Respond Store Unavailable', type: 'main', index: 0 }]
      ] },
      'Claim Verdict': { main: [[{ node: 'IF Claim Won', type: 'main', index: 0 }]] },
      'IF Claim Won': { main: [
        [{ node: 'Read Cycle Projection', type: 'main', index: 0 }],
        [{ node: 'Respond Replay Refused', type: 'main', index: 0 }]
      ] },
      'Read Cycle Projection': { main: [[{ node: 'Build App Session', type: 'main', index: 0 }]] },
      'Build App Session': { main: [[{ node: 'IF Cycle Store Readable', type: 'main', index: 0 }]] },
      'IF Cycle Store Readable': { main: [
        [{ node: 'IF Cycle Resolved', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      // TRUE: an authoritative cycle. FALSE: 409, and nothing is written.
      'IF Cycle Resolved': { main: [
        [{ node: 'Read User Sessions', type: 'main', index: 0 }],
        [{ node: 'Respond Cycle Unresolved', type: 'main', index: 0 }]
      ] },
      'Read User Sessions': { main: [[{ node: 'Resolve Session', type: 'main', index: 0 }]] },
      'Resolve Session': { main: [[{ node: 'IF Session Store Readable', type: 'main', index: 0 }]] },
      'IF Session Store Readable': { main: [
        [{ node: 'IF Create Session', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      // TRUE: nothing live for this user and cycle -> mint. FALSE: resume; a committed session
      // fetches its customer result first, a draft answers directly.
      'IF Create Session': { main: [
        [{ node: 'Claim Session Authority', type: 'main', index: 0 }],
        [{ node: 'IF Session Committed', type: 'main', index: 0 }]
      ] },
      'Claim Session Authority': { main: [
        [{ node: 'Apply Session Authority', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      'Apply Session Authority': { main: [[{ node: 'IF Session Authority Proven', type: 'main', index: 0 }]] },
      'IF Session Authority Proven': { main: [
        [{ node: 'Build Session Row', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      'IF Session Committed': { main: [
        [{ node: 'Read Client Result', type: 'main', index: 0 }],
        [{ node: 'Respond Bootstrap OK', type: 'main', index: 0 }]
      ] },
      'Read Client Result': { main: [[{ node: 'Attach Client Result', type: 'main', index: 0 }]] },
      'Attach Client Result': { main: [[{ node: 'IF Result Store Readable', type: 'main', index: 0 }]] },
      'IF Result Store Readable': { main: [
        [{ node: 'Respond Bootstrap OK', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      'Build Session Row': { main: [[{ node: 'Create App Session', type: 'main', index: 0 }]] },
      'Create App Session': { main: [
        [{ node: 'Read Back Sessions', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] },
      'Read Back Sessions': { main: [[{ node: 'Finalise Session', type: 'main', index: 0 }]] },
      'Finalise Session': { main: [[{ node: 'IF Session Persistence Verified', type: 'main', index: 0 }]] },
      'IF Session Persistence Verified': { main: [
        [{ node: 'Respond Bootstrap OK', type: 'main', index: 0 }],
        [{ node: 'Respond Application Store Unavailable', type: 'main', index: 0 }]
      ] }
    },
    settings: {
      executionOrder: 'v1',
      availableInMCP: false,
      // NO EXECUTION DATA IS RETAINED. The webhook item carries raw initData in memory, and n8n
      // would otherwise persist it in execution history -- which is exactly the "no raw initData
      // persistence" rule, lost to a default. Proof therefore comes from HTTP responses and the
      // ledger's own state, which is better evidence anyway: it is what a caller actually sees.
      saveDataSuccessExecution: 'none',
      saveDataErrorExecution: 'none',
      saveManualExecutions: false,
      saveExecutionProgress: false
    }
  };
  return wf;
}

export const serialize = (wf) => JSON.stringify(wf, null, 2) + '\n';

export function verifyGateway(wf) {
  const failures = [];
  const byName = (n) => wf.nodes.find((x) => x.name === n);
  NODES.forEach((n) => { if (!byName(n)) { failures.push('missing node: ' + n); } });
  if (wf.nodes.length !== NODES.length) { failures.push('node count is ' + wf.nodes.length + ', expected ' + NODES.length); }

  // Only the replay claim and atomic first-open authority may hold a credential. Both use the
  // existing FINMENTOR Supabase/Postgres primitive; no Sheets credential is present.
  const credNodes = wf.nodes.filter((n) => n.credentials);
  const allowedCredentialNodes = [G5_CLAIM_NODE, 'Claim Session Authority'].sort();
  if (JSON.stringify(credNodes.map(n => n.name).sort()) !== JSON.stringify(allowedCredentialNodes)) failures.push('unexpected credential-bearing node set');
  for (const n of credNodes) if ((n.credentials.postgres || {}).id !== SUPABASE_CREDENTIAL.id) failures.push(n.name + ' does not use the approved Supabase credential');
  if (wf.nodes.some(n => n.type === 'n8n-nodes-base.googleSheets')) failures.push('Gateway gained Google Sheets authority');
  // the Neon credential must appear nowhere
  if (JSON.stringify(wf).indexOf(NEON_CREDENTIAL_ID) !== -1) { failures.push('the Neon credential is referenced'); }
  // no raw initData retention
  if (wf.settings.saveDataSuccessExecution !== 'none' || wf.settings.saveDataErrorExecution !== 'none') {
    failures.push('execution data retention is on; raw initData would be persisted');
  }
  if (wf.settings.availableInMCP !== false) { failures.push('availableInMCP is not false'); }
  // P9-R1. Every response code must reach the HTTP layer as a NUMBER. An '=' value with no
  // {{ }} evaluates to a string, and the caller gets 500 after the graph has already run.
  wf.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook').forEach((n) => {
    const c = (n.parameters.options || {}).responseCode;
    if (typeof c === 'number') { return; }
    if (typeof c === 'string' && c.indexOf('{{') !== -1) { return; }
    failures.push(n.name + ' responseCode ' + JSON.stringify(c) + ' does not evaluate to a number; it returns 500');
  });

  // P9-R2. The claim query and the alwaysOutputData flag are ONE mechanism and are gated as one.
  // Either half alone re-opens the defect: with the flag, an error also emits an empty success
  // item; without the CTE, an empty success item is indistinguishable from a conflict. Together
  // they made a total store outage answer 409 "already used, do not retry" instead of 503.
  const claim = byName(G5_CLAIM_NODE);
  if (claim) {
    if (claim.alwaysOutputData) {
      failures.push(G5_CLAIM_NODE + ' carries alwaysOutputData; an error would also emit an empty success item and answer 409, not 503');
    }
    if (claim.onError !== 'continueErrorOutput') {
      failures.push(G5_CLAIM_NODE + ' does not route its error output; a store outage would never reach the 503');
    }
    const q = String((claim.parameters || {}).query || '');
    if (!/\bas\s+claimed\b/i.test(q)) {
      failures.push('the claim query returns no \`claimed\` verdict column; the verdict would be inferred from a row count again');
    }
    if (!/on conflict \(replay_key\) do nothing/i.test(q)) {
      failures.push('the claim query lost its ON CONFLICT DO NOTHING arbitration');
    }
    const insertAt = q.search(/insert\s+into/i);
    if (insertAt === -1) { failures.push('the claim query does not INSERT'); }
    else if (/\bselect\b/i.test(q.slice(0, insertAt))) {
      failures.push('the claim query SELECTs before it INSERTs; that is the race G5 exists to prevent');
    }
  }

  // The verdict must READ the column. A node that still counts rows would pass every check above.
  const verdict = byName('Claim Verdict');
  if (verdict && !/\bclaimed\b/.test(String((verdict.parameters || {}).jsCode || ''))) {
    failures.push('Claim Verdict does not read the \`claimed\` column');
  }

  return { ok: failures.length === 0, failures };
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-miniapp-gateway.mjs');
if (isMain) {
  const botId = process.env.FINMENTOR_BOT_ID || CONFIGURED_BOT_ID;
  const wf = buildGateway({ botId });
  const v = verifyGateway(wf);
  if (!v.ok) {
    console.error('REFUSING TO WRITE: the Gateway candidate failed verification.');
    v.failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  writeFileSync(OUT, serialize(wf), 'utf8');
  console.log('Mini App Gateway candidate: n8n/candidate/miniapp-gateway-candidate.json');
  console.log('  nodes          : ' + wf.nodes.length);
  console.log('  credential     : ' + SUPABASE_CREDENTIAL.name + ' on two narrow atomic claim nodes');
  console.log('  BOT_ID         : ' + (botId === BOT_ID_SENTINEL ? 'SENTINEL (fails closed)' : 'configured'));
  console.log('  exec retention : none (no raw initData persisted)');
  console.log('  verification   : PASS');
}
