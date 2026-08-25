const fs = require('fs');
const crypto = require('crypto');

const SRC = fs.readFileSync('bootstrap-canary.js', 'utf8');
const LF = String.fromCharCode(10);
const TEST_BOT_ID = '123456789';

// Two builds: deployed (sentinel bot_id) and configured (crypto path reachable)
const SRC_CONFIGURED = SRC.replace(
  "const BOT_ID = 'SET_BOT_ID_BEFORE_CANARY';",
  "const BOT_ID = '" + TEST_BOT_ID + "';"
);

function run(src, item) {
  const fn = new Function('$input', 'require', 'return (async()=>{' + src + '})()');
  return fn({ first: () => ({ json: item }) }, require);
}

function req(body, ct) {
  return { headers: { 'content-type': ct === undefined ? 'application/json' : ct }, body: body };
}

const kp = crypto.generateKeyPairSync('ed25519');
function buildCanonical(botId, fields) {
  const kept = fields.filter(f => f[0] !== 'hash' && f[0] !== 'signature');
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return botId + ':WebAppData' + LF + kept.map(f => f[0] + '=' + f[1]).join(LF);
}
function buildRaw(fields) {
  return fields.map(f => encodeURIComponent(f[0]) + '=' + encodeURIComponent(f[1])).join('&');
}
function synthInitData(authDate, botId, userOverride) {
  const fields = [
    ['user', userOverride || '{"id":279058397,"first_name":"Влад","username":"synthetic_user","language_code":"ru"}'],
    ['auth_date', String(authDate)],
    ['chat_type', 'sender'],
    ['query_id', 'AAHdF6IQAAAAAN0XohDhrOrc']
  ];
  const canonical = buildCanonical(botId, fields);
  const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), kp.privateKey).toString('base64url');
  return buildRaw(fields.concat([['hash', 'c0ffee'], ['signature', sig]]));
}

const nowSec = Math.floor(Date.now() / 1000);
const goodInit = synthInitData(nowSec, TEST_BOT_ID);

const cases = [
  ['DEPLOYED config gate', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru' })],
  ['guard: wrong content-type', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru' }, 'text/plain')],
  ['guard: jsonp content-type', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru' }, 'application/jsonp')],
  ['guard: bad client_version', SRC, req({ init_data: goodInit, client_version: 'b9.9.9', locale: 'ru' })],
  ['guard: bad locale', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'de' })],
  ['guard: init_data missing', SRC, req({ client_version: 'b2.1.0', locale: 'ru' })],
  ['guard: init_data empty', SRC, req({ init_data: '', client_version: 'b2.1.0', locale: 'ru' })],
  ['guard: body too large', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru', pad: 'x'.repeat(9000) })],
  ['CRYPTO: synthetic sig vs PROD key', SRC_CONFIGURED, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: malformed percent', SRC_CONFIGURED, req({ init_data: 'auth_date=1&user=%ZZ&signature=abc', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: duplicate key', SRC_CONFIGURED, req({ init_data: goodInit + '&auth_date=' + nowSec, client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: malformed pair', SRC_CONFIGURED, req({ init_data: 'auth_date', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: signature absent', SRC_CONFIGURED, req({ init_data: 'auth_date=' + nowSec + '&user=%7B%22id%22%3A1%7D', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: empty pair', SRC_CONFIGURED, req({ init_data: 'auth_date=' + nowSec + '&&signature=abc', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: empty key', SRC_CONFIGURED, req({ init_data: '=x&auth_date=' + nowSec + '&signature=abc', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: invalid sig chars', SRC_CONFIGURED, req({ init_data: 'auth_date=' + nowSec + '&user=%7B%22id%22%3A1%7D&signature=abc%2Bdef', client_version: 'b2.1.0', locale: 'ru' })],
  ['CRYPTO: auth_date decimal', SRC_CONFIGURED, req({ init_data: 'auth_date=1.5&user=%7B%22id%22%3A1%7D&signature=abc', client_version: 'b2.1.0', locale: 'ru' })],
  ['TRUST: untrusted fields present', SRC, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru', telegram_user_id: '999', consent: true, lead_id: 'L-1' })]
];

(async () => {
  for (const [name, src, item] of cases) {
    const out = await run(src, item);
    const j = out[0].json;
    console.log(
      name.padEnd(36),
      '| ' + String(j.statusCode).padEnd(4),
      '| ' + String(j.response.ok).padEnd(5),
      '| ' + String(j.response.error_code || 'ACCEPT').padEnd(28),
      '| ' + String(j.log.stage || '-').padEnd(20),
      '| ' + (j.log.detail || '')
    );
  }

  const SRC_SELF = SRC_CONFIGURED.replace(
    "const TG_PROD_PUBKEY_HEX = 'e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d';",
    "const TG_PROD_PUBKEY_HEX = '" + Buffer.from(kp.publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex') + "';"
  );
  console.log('\n=== SUCCESS-PATH SHAPE (self-signed key substituted, proves accept branch) ===');
  const ok = (await run(SRC_SELF, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru', consent: true })))[0].json;
  console.log('status:', ok.statusCode);
  console.log('response:', JSON.stringify(ok.response, null, 1));
  console.log('log:', JSON.stringify(ok.log, null, 1));

  console.log('\n=== TAMPER / FRESHNESS against self-signed baseline ===');
  const tamper = goodInit.replace('first_name%22%3A%22', 'first_name%22%3A%22X');
  const t1 = (await run(SRC_SELF, req({ init_data: tamper, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('tampered value        ->', t1.statusCode, t1.response.error_code, t1.log.detail || '');

  const SRC_SELF_OTHERBOT = SRC_SELF.replace("const BOT_ID = '" + TEST_BOT_ID + "';", "const BOT_ID = '987654321';");
  const t2 = (await run(SRC_SELF_OTHERBOT, req({ init_data: goodInit, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('bot_id changed        ->', t2.statusCode, t2.response.error_code, t2.log.detail || '');

  const stale = synthInitData(nowSec - 901, TEST_BOT_ID);
  const t3 = (await run(SRC_SELF, req({ init_data: stale, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('stale (>900s)         ->', t3.statusCode, t3.response.error_code, t3.log.detail || '');

  const edge = synthInitData(nowSec - 899, TEST_BOT_ID);
  const t3b = (await run(SRC_SELF, req({ init_data: edge, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('age 899s              ->', t3b.statusCode, t3b.response.error_code || 'ACCEPT');

  const fut = synthInitData(nowSec + 61, TEST_BOT_ID);
  const t4 = (await run(SRC_SELF, req({ init_data: fut, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('future +61s           ->', t4.statusCode, t4.response.error_code, t4.log.detail || '');

  const fut60 = synthInitData(nowSec + 60, TEST_BOT_ID);
  const t4b = (await run(SRC_SELF, req({ init_data: fut60, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('future +60s           ->', t4b.statusCode, t4b.response.error_code || 'ACCEPT');

  const decimalAuth = synthInitData('1.5', TEST_BOT_ID);
  const t4c = (await run(SRC_SELF, req({ init_data: decimalAuth, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('auth_date decimal     ->', t4c.statusCode, t4c.response.error_code, t4c.log.stage || '');

  const botUser = synthInitData(nowSec, TEST_BOT_ID, '{"id":7,"first_name":"Bot","is_bot":true}');
  const t5 = (await run(SRC_SELF, req({ init_data: botUser, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('user is_bot           ->', t5.statusCode, t5.response.error_code, t5.log.detail || '');

  const noUser = (() => {
    const fields = [['auth_date', String(nowSec)], ['query_id', 'X']];
    const canonical = buildCanonical(TEST_BOT_ID, fields);
    const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), kp.privateKey).toString('base64url');
    return buildRaw(fields.concat([['signature', sig]]));
  })();
  const t6 = (await run(SRC_SELF, req({ init_data: noUser, client_version: 'b2.1.0', locale: 'ru' })))[0].json;
  console.log('user missing          ->', t6.statusCode, t6.response.error_code, t6.log.detail || '');

  console.log('\n=== REDACTION SCAN of success response+log ===');
  const blob = JSON.stringify(ok.response) + JSON.stringify(ok.log);
  const sigVal = goodInit.split('signature=')[1];
  console.log('contains raw init_data :', blob.indexOf(goodInit) !== -1);
  console.log('contains signature     :', blob.indexOf(sigVal) !== -1);
  console.log('contains hash value    :', blob.indexOf('c0ffee') !== -1);
  console.log('contains pubkey hex    :', blob.indexOf('e7bf03a2') !== -1);
  console.log('untrusted echoed back  :', JSON.stringify(ok.response).indexOf('999') !== -1 || JSON.stringify(ok.response).indexOf('consent') !== -1);
})();
