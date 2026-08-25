import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHmac,
  generateKeyPairSync,
  sign as signEd25519
} from 'node:crypto';
import {
  TELEGRAM_ED25519_PUBLIC_KEYS,
  TelegramInitDataError,
  buildBotDataCheckString,
  buildThirdPartyDataCheckString,
  parseInitData,
  validateInitDataEd25519,
  validateInitDataHmac
} from './telegram-initdata.mjs';

const NOW = 1_800_000_000;
const BOT_TOKEN = '123456789:TEST_ONLY_TOKEN_NOT_A_REAL_SECRET';
const BOT_ID = '123456789';

function expectCode(fn, code) {
  assert.throws(fn, error => error instanceof TelegramInitDataError && error.code === code);
}

function makeBaseParams(overrides = {}) {
  return new Map(Object.entries({
    auth_date: String(NOW - 10),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: 551662084, first_name: 'QA', username: 'qa_user', language_code: 'ru' }),
    ...overrides
  }));
}

function encodeStrict(params) {
  return [...params.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function signHmac(params) {
  const dataCheckString = buildBotDataCheckString(params);
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN, 'utf8').digest();
  const hash = createHmac('sha256', secret).update(dataCheckString, 'utf8').digest('hex');
  params.set('hash', hash);
  return encodeStrict(params);
}

function rawEd25519PublicHex(publicKey) {
  const der = publicKey.export({ format: 'der', type: 'spki' });
  assert.equal(der.length, 44);
  return der.subarray(12).toString('hex');
}

function signThirdParty(params, privateKey) {
  params.set('hash', '0'.repeat(64));
  const dataCheckString = buildThirdPartyDataCheckString(params, BOT_ID);
  const signature = signEd25519(null, Buffer.from(dataCheckString, 'utf8'), privateKey).toString('base64url');
  params.set('signature', signature);
  return encodeStrict(params);
}

function reverseRawQuery(raw) {
  return raw.split('&').reverse().join('&');
}

test('strict parser decodes percent escapes exactly once and preserves raw plus', () => {
  const params = parseInitData(
    'auth_date=1800000000&start_param=deep%2541link%20with%20space%2Fslash%2Bplus&raw_plus=a+b&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22%D0%92%D0%BB%D0%B0%D0%B4%22%7D'
  );
  assert.equal(params.get('start_param'), 'deep%41link with space/slash+plus');
  assert.equal(params.get('raw_plus'), 'a+b');
  assert.deepEqual(JSON.parse(params.get('user')), { id: 1, first_name: 'Влад' });
});

test('strict parser rejects malformed percent escapes and duplicate decoded keys', () => {
  expectCode(() => parseInitData('auth_date=%ZZ'), 'TG_INITDATA_INVALID');
  expectCode(() => parseInitData('auth_date=1&auth%5Fdate=2'), 'TG_INITDATA_DUPLICATE_KEY');
});

test('HMAC validation accepts a fresh valid initData payload', () => {
  const initData = signHmac(makeBaseParams());
  const result = validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW, maxAgeSeconds: 900 });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'hmac-sha256');
  assert.equal(result.user.telegram_user_id, '551662084');
  assert.equal(result.user.first_name, 'QA');
});

test('HMAC validation rejects tampering', () => {
  const initData = signHmac(makeBaseParams()).replace('qa_user', 'qb_user');
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW }), 'TG_INITDATA_INVALID');
});

test('freshness accepts exact policy boundaries and rejects outside them', () => {
  const fresh = signHmac(makeBaseParams({ auth_date: String(NOW - 899) }));
  assert.equal(validateInitDataHmac(fresh, BOT_TOKEN, { nowSeconds: NOW, maxAgeSeconds: 900 }).ok, true);

  const stale = signHmac(makeBaseParams({ auth_date: String(NOW - 901) }));
  expectCode(() => validateInitDataHmac(stale, BOT_TOKEN, { nowSeconds: NOW, maxAgeSeconds: 900 }), 'TG_INITDATA_EXPIRED');

  const futureAllowed = signHmac(makeBaseParams({ auth_date: String(NOW + 60) }));
  assert.equal(validateInitDataHmac(futureAllowed, BOT_TOKEN, { nowSeconds: NOW, futureSkewSeconds: 60 }).ok, true);

  const futureRejected = signHmac(makeBaseParams({ auth_date: String(NOW + 61) }));
  expectCode(() => validateInitDataHmac(futureRejected, BOT_TOKEN, { nowSeconds: NOW, futureSkewSeconds: 60 }), 'TG_INITDATA_FUTURE');
});

test('duplicate query keys are rejected', () => {
  expectCode(() => parseInitData('auth_date=1&auth_date=2&hash=' + '0'.repeat(64)), 'TG_INITDATA_DUPLICATE_KEY');
});

test('missing user is rejected after valid HMAC', () => {
  const params = makeBaseParams();
  params.delete('user');
  const initData = signHmac(params);
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW }), 'TG_USER_MISSING');
});

test('bot user is rejected after valid HMAC', () => {
  const initData = signHmac(makeBaseParams({ user: JSON.stringify({ id: 1, first_name: 'Bot', is_bot: true }) }));
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW }), 'TG_USER_BOT');
});

test('third-party data check string excludes hash/signature and sorts by code units', () => {
  const params = new Map([
    ['user', '{}'],
    ['auth_date', String(NOW)],
    ['start_param', 'x'],
    ['chat_type', 'private'],
    ['query_id', 'q'],
    ['chat_instance', 'c'],
    ['hash', 'abc'],
    ['signature', 'def']
  ]);
  const value = buildThirdPartyDataCheckString(params, BOT_ID);
  assert.equal(value, `${BOT_ID}:WebAppData\nauth_date=${NOW}\nchat_instance=c\nchat_type=private\nquery_id=q\nstart_param=x\nuser={}`);
  assert.equal(value.includes('hash='), false);
  assert.equal(value.includes('signature='), false);
});

test('Ed25519 validation accepts a valid third-party payload', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const initData = signThirdParty(makeBaseParams(), privateKey);
  const result = validateInitDataEd25519(initData, BOT_ID, {
    nowSeconds: NOW,
    maxAgeSeconds: 900,
    publicKeyHex: rawEd25519PublicHex(publicKey)
  });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'ed25519');
  assert.equal(result.user.telegram_user_id, '551662084');
});

test('Ed25519 canonicalization is order-independent', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const initData = signThirdParty(makeBaseParams({ start_param: 'abc', chat_type: 'private' }), privateKey);
  const reordered = reverseRawQuery(initData);
  const result = validateInitDataEd25519(reordered, BOT_ID, {
    nowSeconds: NOW,
    publicKeyHex: rawEd25519PublicHex(publicKey)
  });
  assert.equal(result.ok, true);
});

test('Ed25519 validation rejects value tamper, bot-id tamper, added field and removed field', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = rawEd25519PublicHex(publicKey);
  const initData = signThirdParty(makeBaseParams({ start_param: 'abc' }), privateKey);

  expectCode(() => validateInitDataEd25519(initData.replace('qa_user', 'qb_user'), BOT_ID, { nowSeconds: NOW, publicKeyHex }), 'TG_INITDATA_INVALID');
  expectCode(() => validateInitDataEd25519(initData, '123456780', { nowSeconds: NOW, publicKeyHex }), 'TG_INITDATA_INVALID');
  expectCode(() => validateInitDataEd25519(initData + '&extra=1', BOT_ID, { nowSeconds: NOW, publicKeyHex }), 'TG_INITDATA_INVALID');

  const removed = initData.split('&').filter(part => !part.startsWith('start_param=')).join('&');
  expectCode(() => validateInitDataEd25519(removed, BOT_ID, { nowSeconds: NOW, publicKeyHex }), 'TG_INITDATA_INVALID');
});

test('Ed25519 hash field is excluded behaviorally', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyHex = rawEd25519PublicHex(publicKey);
  const initData = signThirdParty(makeBaseParams(), privateKey);
  const changedHash = initData.replace(/hash=[^&]+/, 'hash=' + 'f'.repeat(64));
  const result = validateInitDataEd25519(changedHash, BOT_ID, { nowSeconds: NOW, publicKeyHex });
  assert.equal(result.ok, true);
});

test('Telegram production public key imports successfully and rejects synthetic signature', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const initData = signThirdParty(makeBaseParams(), privateKey);
  expectCode(() => validateInitDataEd25519(initData, BOT_ID, {
    nowSeconds: NOW,
    publicKeyHex: TELEGRAM_ED25519_PUBLIC_KEYS.production
  }), 'TG_INITDATA_INVALID');
});
