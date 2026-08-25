const TG_PROD_PUBKEY_HEX = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';
const SPKI_PREFIX_HEX = '302a300506032b6570032100';
const LF = String.fromCharCode(10);

const BOT_ID = 'SET_BOT_ID_BEFORE_CANARY';

const MAX_BODY_BYTES = 8192;
const MAX_INITDATA_BYTES = 4096;
const MAX_AUTH_AGE_SECONDS = 900;
const FUTURE_CLOCK_SKEW_SECONDS = 60;
const ALLOWED_CLIENT_VERSIONS = ['b2.1.0'];
const ALLOWED_LOCALES = ['ru', 'ro'];

const UNTRUSTED_KEYS = ['telegram_user_id', 'cycle_id', 'lead_id', 'consent', 'consent_at', 'priority', 'financial_zone', 'canonical_lead_id', 'submit_state'];

const STATUS = {
  BAD_REQUEST: 400,
  TG_INITDATA_MISSING: 400,
  CLIENT_VERSION_UNSUPPORTED: 400,
  TG_INITDATA_INVALID: 401,
  TG_INITDATA_EXPIRED: 401,
  TG_INITDATA_FUTURE: 401,
  TG_USER_MISSING: 401,
  TG_USER_INVALID: 401,
  TG_USER_BOT: 403,
  RATE_LIMITED: 429,
  TEMPORARY_BACKEND_ERROR: 503
};
const RETRYABLE = { RATE_LIMITED: true, TEMPORARY_BACKEND_ERROR: true };

const crypto = require('crypto');
function nowMs() { return Date.now(); }

function decodeOnce(s) {
  return decodeURIComponent(s);
}

function parseInitData(raw) {
  const chunks = raw.split('&');
  const pairs = [];
  const seen = {};
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (c === '') { return { ok: false, reason: 'EMPTY_PAIR' }; }
    const eq = c.indexOf('=');
    if (eq === -1) { return { ok: false, reason: 'MALFORMED_PAIR' }; }
    let k;
    let v;
    try {
      k = decodeOnce(c.substring(0, eq));
      v = decodeOnce(c.substring(eq + 1));
    } catch (e) {
      return { ok: false, reason: 'MALFORMED_PERCENT_ENCODING' };
    }
    if (k === '') { return { ok: false, reason: 'EMPTY_KEY' }; }
    if (Object.prototype.hasOwnProperty.call(seen, k)) {
      return { ok: false, reason: 'DUPLICATE_KEY' };
    }
    seen[k] = true;
    pairs.push([k, v]);
  }
  if (pairs.length === 0) { return { ok: false, reason: 'EMPTY_INITDATA' }; }
  const map = {};
  for (let i = 0; i < pairs.length; i++) { map[pairs[i][0]] = pairs[i][1]; }
  return { ok: true, pairs: pairs, map: map };
}

function buildCanonical(botId, pairs) {
  const kept = [];
  for (let i = 0; i < pairs.length; i++) {
    const k = pairs[i][0];
    if (k === 'hash' || k === 'signature') { continue; }
    kept.push(pairs[i]);
  }
  kept.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
  const lines = [];
  for (let i = 0; i < kept.length; i++) { lines.push(kept[i][0] + '=' + kept[i][1]); }
  return botId + ':WebAppData' + LF + lines.join(LF);
}

function importRawEd25519(hex) {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) { throw new Error('bad key length'); }
  const der = Buffer.concat([Buffer.from(SPKI_PREFIX_HEX, 'hex'), raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function verifyCanonical(canonical, sigB64url, keyObj) {
  if (typeof sigB64url !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(sigB64url)) { return false; }
  let sig;
  try { sig = Buffer.from(sigB64url, 'base64url'); }
  catch (e) { return false; }
  if (sig.length !== 64) { return false; }
  return crypto.verify(null, Buffer.from(canonical, 'utf8'), keyObj, sig);
}

function fail(code, stage, extra) {
  const out = {
    statusCode: STATUS[code] || 400,
    response: { ok: false, error_code: code, retryable: RETRYABLE[code] === true },
    log: { outcome: 'REJECT', error_code: code, stage: stage }
  };
  if (extra) { out.log.detail = extra; }
  return out;
}

function handle(item) {
  const tStart = nowMs();
  const headers = item.headers || {};
  const body = item.body || {};
  const correlationId = crypto.randomUUID();

  const contentType = String(headers['content-type'] || headers['Content-Type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return fail('BAD_REQUEST', 'CONTENT_TYPE', 'expected application/json');
  }

  let bodyBytes;
  try { bodyBytes = Buffer.byteLength(JSON.stringify(body), 'utf8'); }
  catch (e) { return fail('BAD_REQUEST', 'BODY_UNSERIALISABLE'); }
  if (bodyBytes > MAX_BODY_BYTES) {
    return fail('BAD_REQUEST', 'BODY_TOO_LARGE');
  }

  const ignoredUntrusted = [];
  for (let i = 0; i < UNTRUSTED_KEYS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(body, UNTRUSTED_KEYS[i])) {
      ignoredUntrusted.push(UNTRUSTED_KEYS[i]);
    }
  }

  const clientVersion = body.client_version;
  if (ALLOWED_CLIENT_VERSIONS.indexOf(clientVersion) === -1) {
    return fail('CLIENT_VERSION_UNSUPPORTED', 'CLIENT_VERSION');
  }

  const locale = body.locale;
  if (ALLOWED_LOCALES.indexOf(locale) === -1) {
    return fail('BAD_REQUEST', 'LOCALE');
  }

  const initData = body.init_data;
  if (typeof initData !== 'string' || initData.length === 0) {
    return fail('TG_INITDATA_MISSING', 'INITDATA_PRESENCE');
  }
  if (Buffer.byteLength(initData, 'utf8') > MAX_INITDATA_BYTES) {
    return fail('BAD_REQUEST', 'INITDATA_TOO_LARGE');
  }

  if (BOT_ID === 'SET_BOT_ID_BEFORE_CANARY') {
    return fail('TEMPORARY_BACKEND_ERROR', 'CONFIG', 'BOT_ID_NOT_CONFIGURED');
  }

  const tGuards = nowMs();

  const parsed = parseInitData(initData);
  if (!parsed.ok) {
    return fail('TG_INITDATA_INVALID', 'PARSE', parsed.reason);
  }
  const tParse = nowMs();

  const presentFields = [];
  for (let i = 0; i < parsed.pairs.length; i++) { presentFields.push(parsed.pairs[i][0]); }

  if (!parsed.map.signature) {
    return fail('TG_INITDATA_INVALID', 'SIGNATURE_PRESENCE', 'signature field absent');
  }

  const canonical = buildCanonical(BOT_ID, parsed.pairs);
  const tCanon = nowMs();

  let key;
  try { key = importRawEd25519(TG_PROD_PUBKEY_HEX); }
  catch (e) { return fail('TEMPORARY_BACKEND_ERROR', 'KEY_IMPORT'); }

  const sigOk = verifyCanonical(canonical, parsed.map.signature, key);
  const tVerify = nowMs();

  if (!sigOk) {
    return fail('TG_INITDATA_INVALID', 'ED25519_VERIFY', 'signature did not verify against Telegram production key');
  }

  const rawAuthDate = parsed.map.auth_date;
  if (typeof rawAuthDate !== 'string' || !/^[0-9]+$/.test(rawAuthDate)) {
    return fail('TG_INITDATA_INVALID', 'AUTH_DATE_PARSE');
  }
  const authDate = Number(rawAuthDate);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return fail('TG_INITDATA_INVALID', 'AUTH_DATE_PARSE');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - authDate;
  if (age > MAX_AUTH_AGE_SECONDS) {
    return fail('TG_INITDATA_EXPIRED', 'FRESHNESS', 'age_seconds=' + age);
  }
  if (age < -FUTURE_CLOCK_SKEW_SECONDS) {
    return fail('TG_INITDATA_FUTURE', 'FRESHNESS', 'age_seconds=' + age);
  }

  if (!parsed.map.user) {
    return fail('TG_USER_MISSING', 'USER_PRESENCE');
  }
  let user;
  try { user = JSON.parse(parsed.map.user); }
  catch (e) { return fail('TG_USER_INVALID', 'USER_PARSE'); }
  if (!user || typeof user !== 'object' || user.id === undefined || user.id === null) {
    return fail('TG_USER_INVALID', 'USER_SHAPE');
  }
  const telegramUserId = String(user.id);
  if (!/^[0-9]+$/.test(telegramUserId)) {
    return fail('TG_USER_INVALID', 'USER_ID_SHAPE');
  }
  if (user.is_bot === true) {
    return fail('TG_USER_BOT', 'USER_IS_BOT');
  }

  const tEnd = nowMs();

  return {
    statusCode: 200,
    response: {
      ok: true,
      validation: 'telegram_ed25519',
      safe_user: {
        telegram_user_id: telegramUserId,
        first_name: user.first_name === undefined ? null : String(user.first_name),
        username: user.username === undefined ? null : String(user.username),
        language_code: user.language_code === undefined ? null : String(user.language_code)
      },
      auth_date: authDate,
      client_version: clientVersion,
      locale: locale
    },
    log: {
      outcome: 'ACCEPT',
      correlation_id: correlationId,
      validation: 'telegram_ed25519',
      telegram_user_id: telegramUserId,
      auth_date: authDate,
      age_seconds: age,
      present_fields: presentFields,
      canonical_field_count: canonical.split(LF).length - 1,
      untrusted_fields_ignored: ignoredUntrusted,
      timings_ms: {
        guards: tGuards - tStart,
        parse: tParse - tGuards,
        canonicalize: tCanon - tParse,
        verify: tVerify - tCanon,
        validator_total: tVerify - tGuards,
        handler_total: tEnd - tStart
      },
      side_effects: { lead_intake_calls: 0, pipeline_writes: 0, consent_writes: 0, sheets_writes: 0 }
    }
  };
}

const input = $input.first().json;
const result = handle(input);
result.log.correlation_id = result.log.correlation_id || crypto.randomUUID();
result.log.timer_note = 'Date.now, 1ms resolution; sub-ms figures are in the B.2.1-A verify-only probe';
return [{ json: result }];
