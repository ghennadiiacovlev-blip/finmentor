import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHmac,
  generateKeyPairSync,
  sign as signEd25519
} from 'node:crypto';
import {
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
  const values = {
    auth_date: String(NOW - 10),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify({ id: 551662084, first_name: 'QA', username: 'qa_user', language_code: 'ru' }),
    ...overrides
  };
  return new URLSearchParams(values);
}

function signHmac(params) {
  const dataCheckString = buildBotDataCheckString(params);
  const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN, 'utf8').digest();
  const hash = createHmac('sha256', secret).update(dataCheckString, 'utf8').digest('hex');
  params.set('hash', hash);
  return params.toString();
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
  return params.toString();
}

test('HMAC validation accepts a fresh valid initData payload', () => {
  const initData = signHmac(makeBaseParams());
  const result = validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW, maxAgeSeconds: 900 });
  assert.equal(result.ok, true);
  assert.equal(result.method, 'hmac-sha256');
  assert.equal(result.user.telegram_user_id, '551662084');
  assert.equal(result.user.first_name, 'QA');
});

test('HMAC validation rejects tampering', () => {
  const params = makeBaseParams();
  const initData = signHmac(params).replace('QA', 'QB');
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW }), 'TG_INITDATA_INVALID');
});

test('freshness rejects stale auth_date', () => {
  const initData = signHmac(makeBaseParams({ auth_date: String(NOW - 901) }));
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW, maxAgeSeconds: 900 }), 'TG_INITDATA_EXPIRED');
});

test('freshness rejects auth_date too far in the future', () => {
  const initData = signHmac(makeBaseParams({ auth_date: String(NOW + 61) }));
  expectCode(() => validateInitDataHmac(initData, BOT_TOKEN, { nowSeconds: NOW, futureSkewSeconds: 60 }), 'TG_INITDATA_FUTURE');
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

test('Ed25519 validation rejects tampering', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const initData = signThirdParty(makeBaseParams(), privateKey).replace('qa_user', 'qb_user');
  expectCode(() => validateInitDataEd25519(initData, BOT_ID, {
    nowSeconds: NOW,
    publicKeyHex: rawEd25519PublicHex(publicKey)
  }), 'TG_INITDATA_INVALID');
});

test('third-party data check string excludes hash and signature', () => {
  const params = makeBaseParams();
  params.set('hash', 'abc');
  params.set('signature', 'def');
  const value = buildThirdPartyDataCheckString(params, BOT_ID);
  assert.ok(value.startsWith(`${BOT_ID}:WebAppData\n`));
  assert.equal(value.includes('hash='), false);
  assert.equal(value.includes('signature='), false);
});
