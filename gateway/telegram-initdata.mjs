import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature
} from 'node:crypto';

export const TELEGRAM_ED25519_PUBLIC_KEYS = Object.freeze({
  production: 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d',
  test: '40055058a4ee38156a06562e52eece92a771bcd8346a8c4615cb7376eddf72ec'
});

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export class TelegramInitDataError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'TelegramInitDataError';
    this.code = code;
  }
}

function assertString(value, code) {
  if (typeof value !== 'string' || !value.length) throw new TelegramInitDataError(code);
}

function normalizeNow(nowSeconds) {
  const value = nowSeconds == null ? Math.floor(Date.now() / 1000) : Number(nowSeconds);
  if (!Number.isFinite(value)) throw new TypeError('nowSeconds must be finite');
  return Math.floor(value);
}

function safeEqualHex(expectedHex, receivedHex) {
  try {
    const a = Buffer.from(String(expectedHex), 'hex');
    const b = Buffer.from(String(receivedHex), 'hex');
    return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function parseInitData(initData) {
  assertString(initData, 'TG_INITDATA_MISSING');
  if (Buffer.byteLength(initData, 'utf8') > 16 * 1024) {
    throw new TelegramInitDataError('TG_INITDATA_TOO_LARGE');
  }

  const params = new URLSearchParams(initData);
  const entries = [...params.entries()];
  if (!entries.length) throw new TelegramInitDataError('TG_INITDATA_INVALID');

  const seen = new Set();
  for (const [key] of entries) {
    if (seen.has(key)) throw new TelegramInitDataError('TG_INITDATA_DUPLICATE_KEY');
    seen.add(key);
  }
  return params;
}

export function buildBotDataCheckString(paramsOrInitData) {
  const params = typeof paramsOrInitData === 'string' ? parseInitData(paramsOrInitData) : paramsOrInitData;
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function buildThirdPartyDataCheckString(paramsOrInitData, botId) {
  const params = typeof paramsOrInitData === 'string' ? parseInitData(paramsOrInitData) : paramsOrInitData;
  const normalizedBotId = String(botId ?? '').trim();
  if (!/^\d+$/.test(normalizedBotId)) throw new TelegramInitDataError('TG_BOT_ID_INVALID');

  const body = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  return `${normalizedBotId}:WebAppData\n${body}`;
}

export function validateFreshness(params, options = {}) {
  const maxAgeSeconds = Number(options.maxAgeSeconds ?? 900);
  const futureSkewSeconds = Number(options.futureSkewSeconds ?? 60);
  const now = normalizeNow(options.nowSeconds);
  const raw = params.get('auth_date');

  if (!raw || !/^\d+$/.test(raw)) throw new TelegramInitDataError('TG_INITDATA_AUTH_DATE_INVALID');
  const authDate = Number(raw);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new TelegramInitDataError('TG_INITDATA_AUTH_DATE_INVALID');
  }
  if (authDate > now + futureSkewSeconds) throw new TelegramInitDataError('TG_INITDATA_FUTURE');
  if (now - authDate > maxAgeSeconds) throw new TelegramInitDataError('TG_INITDATA_EXPIRED');
  return authDate;
}

export function parseValidatedUser(params) {
  const rawUser = params.get('user');
  if (!rawUser) throw new TelegramInitDataError('TG_USER_MISSING');

  let user;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new TelegramInitDataError('TG_USER_INVALID');
  }

  const id = user && user.id;
  if (!(typeof id === 'number' || typeof id === 'string') || !/^\d+$/.test(String(id))) {
    throw new TelegramInitDataError('TG_USER_INVALID');
  }
  if (user.is_bot === true) throw new TelegramInitDataError('TG_USER_BOT');

  return {
    telegram_user_id: String(id),
    first_name: typeof user.first_name === 'string' ? user.first_name : '',
    last_name: typeof user.last_name === 'string' ? user.last_name : '',
    username: typeof user.username === 'string' ? user.username : '',
    language_code: typeof user.language_code === 'string' ? user.language_code : '',
    allows_write_to_pm: user.allows_write_to_pm === true
  };
}

export function validateInitDataHmac(initData, botToken, options = {}) {
  assertString(botToken, 'TG_BOT_TOKEN_MISSING');
  const params = parseInitData(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash || !/^[a-fA-F0-9]{64}$/.test(receivedHash)) {
    throw new TelegramInitDataError('TG_INITDATA_HASH_MISSING');
  }

  const dataCheckString = buildBotDataCheckString(params);
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken, 'utf8').digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString, 'utf8').digest('hex');

  if (!safeEqualHex(expectedHash, receivedHash)) {
    throw new TelegramInitDataError('TG_INITDATA_INVALID');
  }

  const authDate = validateFreshness(params, options);
  const user = parseValidatedUser(params);

  return {
    ok: true,
    method: 'hmac-sha256',
    auth_date: authDate,
    query_id: params.get('query_id') || '',
    start_param: params.get('start_param') || '',
    user
  };
}

function decodeBase64Url(value) {
  assertString(value, 'TG_INITDATA_SIGNATURE_MISSING');
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new TelegramInitDataError('TG_INITDATA_SIGNATURE_INVALID');
  }
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(normalized + padding, 'base64');
  } catch {
    throw new TelegramInitDataError('TG_INITDATA_SIGNATURE_INVALID');
  }
}

function publicKeyFromRawHex(hex) {
  if (!/^[a-fA-F0-9]{64}$/.test(String(hex))) {
    throw new TelegramInitDataError('TG_PUBLIC_KEY_INVALID');
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(hex, 'hex')]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export function validateInitDataEd25519(initData, botId, options = {}) {
  const params = parseInitData(initData);
  const signature = decodeBase64Url(params.get('signature'));
  if (signature.length !== 64) throw new TelegramInitDataError('TG_INITDATA_SIGNATURE_INVALID');

  const environment = options.environment === 'test' ? 'test' : 'production';
  const publicKeyHex = options.publicKeyHex || TELEGRAM_ED25519_PUBLIC_KEYS[environment];
  const publicKey = publicKeyFromRawHex(publicKeyHex);
  const dataCheckString = buildThirdPartyDataCheckString(params, botId);

  const valid = verifySignature(null, Buffer.from(dataCheckString, 'utf8'), publicKey, signature);
  if (!valid) throw new TelegramInitDataError('TG_INITDATA_INVALID');

  const authDate = validateFreshness(params, options);
  const user = parseValidatedUser(params);

  return {
    ok: true,
    method: 'ed25519',
    environment,
    auth_date: authDate,
    query_id: params.get('query_id') || '',
    start_param: params.get('start_param') || '',
    user
  };
}
