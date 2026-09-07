// FINMENTOR — G5: durable single-use claim over Telegram initData.
//
// WHY THIS EXISTS. Nothing prevented one initData from creating two app sessions. The
// pre-activation review STOPPED G5 rather than fake it, because neither store we had could do
// atomic create-if-absent for an unseen key: the n8n Data Table cannot, and Google Sheets'
// appendOrUpdate is last-write-wins. Emulating it read-then-write loses the only case that
// matters -- two tabs replaying one initData at the same instant.
//
// Postgres can. `telegram_initdata_replays.replay_key` is a PRIMARY KEY, so an INSERT either
// wins or raises 23505 and there is no window in between. THE DATABASE IS THE AUTHORITY. This
// module must never SELECT-then-INSERT, never count rows to decide, and never treat "I did not
// find it a moment ago" as permission -- that is the race, rewritten.
//
// ORDERING IS THE OTHER HALF, and it is structural here rather than conventional:
//
//   1. verify the Telegram signature      <- throws
//   2. verify freshness                   <- throws (inside the validator, after the signature)
//   3. derive replay_key from AUTHENTICATED canonical material
//   4. atomic INSERT
//   5. 23505 -> REPLAY_REFUSED
//   6. only then may the caller create or continue a session
//
// Steps 1-2 throw before step 4 exists as a possibility, so a forged or stale initData CANNOT
// consume a replay key. That is not a promise about call order -- there is no reachable path
// from a failed validation to the store.

import { createHash } from 'node:crypto';
import {
  parseInitData,
  buildBotDataCheckString,
  validateInitDataHmac,
  TelegramInitDataError
} from './telegram-initdata.mjs';

export const G5_OUTCOME = Object.freeze({
  CLAIMED: 'CLAIMED',
  REPLAY_REFUSED: 'REPLAY_REFUSED',
  STORE_UNAVAILABLE: 'REPLAY_STORE_UNAVAILABLE'
});

// Domain-separated so the key space can be rotated without colliding with anything already
// stored. The digest covers the exact bytes Telegram signed plus the signature itself, so two
// different signed payloads cannot share a key and one payload always yields the same key.
export const G5_KEY_DOMAIN = 'finmentor:g5:v1';

export function deriveReplayKey(initData) {
  const params = parseInitData(initData);
  const hash = params.get('hash') || '';
  if (!/^[a-fA-F0-9]{64}$/.test(hash)) { throw new TelegramInitDataError('TG_INITDATA_HASH_MISSING'); }
  const canonical = buildBotDataCheckString(params);
  return createHash('sha256')
    .update(G5_KEY_DOMAIN + '\n' + canonical + '\n' + hash.toLowerCase(), 'utf8')
    .digest('hex');
}

// The store contract. `insertClaim` performs ONE unconditional INSERT and reports which way it
// went. It must not read first. Anything it throws is treated as an outage.
//
//   insertClaim({ replay_key, expires_at, correlation_id }) ->
//     { inserted: true }  | { conflict: true }
//
export async function claimInitData(input) {
  const {
    initData,
    botToken,
    store,
    nowSeconds,
    maxAgeSeconds = 900,
    correlationId = null
  } = input || {};

  // 1 + 2. Signature THEN freshness. Both throw, and both throw before the store is reachable.
  //        A caller cannot skip this to get at step 4: the key is derived from what this
  //        returns having validated, and the store call lives after it in the same function.
  const validated = validateInitDataHmac(initData, botToken, { nowSeconds, maxAgeSeconds });

  // 3. Derived from the AUTHENTICATED canonical material, never from anything the caller framed.
  const replayKey = deriveReplayKey(initData);

  // Retention only. The claim is authoritative because the INSERT won, never because this is in
  // the future -- expiry must never be consulted to decide whether a replay is allowed.
  const expiresAt = new Date((validated.auth_date + maxAgeSeconds) * 1000).toISOString();

  // 4 + 5. One INSERT. The unique violation IS the answer; nothing here arbitrates.
  let result;
  try {
    result = await store.insertClaim({
      replay_key: replayKey,
      expires_at: expiresAt,
      correlation_id: correlationId
    });
  } catch (e) {
    // 6-FAIL-CLOSED. An unreachable ledger means we cannot know whether this initData was
    // already used, and "cannot know" must never resolve to "proceed".
    return Object.freeze({
      ok: false,
      outcome: G5_OUTCOME.STORE_UNAVAILABLE,
      replay_key: replayKey,
      reason: e && e.message ? String(e.message).slice(0, 200) : 'store error'
    });
  }

  if (result && result.conflict) {
    return Object.freeze({
      ok: false,
      outcome: G5_OUTCOME.REPLAY_REFUSED,
      replay_key: replayKey
    });
  }
  if (!result || result.inserted !== true) {
    // An adapter that answers neither way is an adapter we cannot trust. Fail closed.
    return Object.freeze({
      ok: false,
      outcome: G5_OUTCOME.STORE_UNAVAILABLE,
      replay_key: replayKey,
      reason: 'store returned no verdict'
    });
  }

  // 6. Only now may a session be created or continued.
  return Object.freeze({
    ok: true,
    outcome: G5_OUTCOME.CLAIMED,
    replay_key: replayKey,
    auth_date: validated.auth_date,
    expires_at: expiresAt,
    // The validated user is passed back for the CALLER's session logic. It is deliberately not
    // written to the ledger: the ledger holds a digest and two timestamps, nothing else.
    user: validated.user,
    query_id: validated.query_id
  });
}

export { TelegramInitDataError };
