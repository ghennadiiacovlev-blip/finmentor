#!/usr/bin/env node
// FINMENTOR — an OFFLINE visual preview of the customer result screen (C3.4).
//
//   node scripts/build-result-preview.mjs
//   start .uat/result-preview.html            (Windows)   — or open the file in any browser
//
//   .uat/result-preview.html?case=ru-score
//   .uat/result-preview.html?case=ru-noscore
//   .uat/result-preview.html?case=ro-score
//   .uat/result-preview.html?case=ro-noscore
//   ...&lang=ro                                 (overrides the Telegram language_code hint)
//
// REPO-ONLY. Writes .uat/result-preview.html (git-ignored) and contacts nothing. The page is the
// REAL app-premium files — index.html with app.css, content.js, net.js and app.js inlined exactly
// as scripts/build-miniapp-host.mjs inlines them — plus, BEFORE the app scripts, a stub for the
// three things a Telegram WebView would otherwise supply:
//
//   · window.Telegram.WebApp  — non-empty initData (so bootstrap() runs), a user whose
//     language_code follows ?lang=, and no-op ready/expand/colour/close;
//   · window.FM_ENDPOINTS     — placeholder-free https://preview.invalid/... URLs (the app treats
//     a placeholder as "offline"; these are syntactically real and never reached);
//   · window.fetch            — answers the Gateway POST with a committed, CLIENT_READY bootstrap
//     carrying the fixture ?case= selects (qa/fixtures/client-result-fixtures.mjs — the same
//     fixtures the golden render gate holds), and {ok:true} to anything else.
//
// The Telegram SDK tag is removed (offline, and it would race the stub); the Google Fonts link
// stays so the preview uses the approved faces when the machine is online, and the fallback
// stacks when it is not.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RESULT_FIXTURES, RESULT_CASES } from '../qa/fixtures/client-result-fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const APP = join(ROOT, 'app-premium');
const OUT_DIR = join(ROOT, '.uat');
const OUT = join(OUT_DIR, 'result-preview.html');

const read = (f) => readFileSync(join(APP, f), 'utf8');

const html = read('index.html');
const css = read('app.css');
const content = read('content.js');
const net = read('net.js');
const app = read('app.js');

const fail = [];

// `</script` inside inlined JavaScript or JSON would close the tag early. The sources are checked
// verbatim (as the host builder does); the JSON is serialised with `<` escaped so a fixture can
// never introduce one.
for (const [name, src] of [['content.js', content], ['net.js', net], ['app.js', app]]) {
  if (/<\/script/i.test(src)) { fail.push(name + ' contains a </script> sequence and cannot be inlined verbatim'); }
}
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const ENDPOINTS = {
  gateway: 'https://preview.invalid/webhook/finmentor-miniapp-gateway',
  session: 'https://preview.invalid/webhook/finmentor-miniapp-session',
  submit: 'https://preview.invalid/webhook/finmentor-miniapp-submit'
};

const stub = `<script>
// ── PREVIEW STUB (scripts/build-result-preview.mjs) — not part of the shipped app ──
(function () {
  var FIXTURES = ${json(RESULT_FIXTURES)};
  var CASES = ${json(RESULT_CASES)};
  var q = {};
  try {
    var qs = String(window.location.search || '').replace(/^\\?/, '').split('&');
    for (var i = 0; i < qs.length; i++) {
      if (!qs[i]) { continue; }
      var kv = qs[i].split('=');
      q[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    }
  } catch (e) {}
  var which = CASES.indexOf(q['case']) === -1 ? CASES[0] : q['case'];
  var result = FIXTURES[which];
  var lang = q.lang === 'ro' || q.lang === 'ru' ? q.lang : result.locale;

  window.FM_ENDPOINTS = ${json(ENDPOINTS)};

  window.Telegram = {
    WebApp: {
      initData: 'query_id=x&user=%7B%22id%22%3A1%2C%22language_code%22%3A%22' + lang + '%22%7D&auth_date=1&hash=y',
      initDataUnsafe: { user: { id: 1, first_name: 'Preview', language_code: lang } },
      ready: function () {}, expand: function () {},
      setHeaderColor: function () {}, setBackgroundColor: function () {},
      close: function () {}
    }
  };

  var BOOTSTRAP = {
    ok: true,
    app_session_id: 'AS-' + new Array(65).join('a'),
    expires_at: '2099-01-01T00:00:00.000Z',
    locale: result.locale,
    state: 'submitted', resumed: true, draft: null,
    result: result, result_state: 'CLIENT_READY'
  };
  window.fetch = function (url, init) {
    var body = String(url).indexOf('finmentor-miniapp-gateway') !== -1 ? BOOTSTRAP : { ok: true };
    return Promise.resolve({ status: 200, text: function () { return Promise.resolve(JSON.stringify(body)); } });
  };

  // A small, unobtrusive switcher so a reviewer can walk the four cases without editing the URL.
  document.addEventListener('DOMContentLoaded', function () {
    var bar = document.createElement('div');
    bar.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:9;display:flex;gap:6px;justify-content:center;padding:6px;background:rgba(8,17,31,.92);font:11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase');
    for (var i = 0; i < CASES.length; i++) {
      var a = document.createElement('a');
      a.href = '?case=' + CASES[i];
      a.textContent = CASES[i];
      a.setAttribute('style', 'color:' + (CASES[i] === which ? '#D9C58C' : 'rgba(242,238,228,.5)') + ';text-decoration:none;padding:4px 8px;border:1px solid rgba(242,238,228,' + (CASES[i] === which ? '.3' : '.12') + ');border-radius:8px');
      bar.appendChild(a);
    }
    document.body.appendChild(bar);
  });
})();
</script>`;

let page = html
  .replace('<link rel="stylesheet" href="app.css" />', '<style>\n' + css + '\n</style>')
  .replace('<script src="content.js"></script>', stub + '\n  <script>\n' + content + '\n</script>')
  .replace('<script src="net.js"></script>', '<script>\n' + net + '\n</script>')
  .replace('<script src="app.js"></script>', '<script>\n' + app + '\n</script>')
  .replace('<link rel="icon" href="../favicon.svg" type="image/svg+xml" />', '')
  .replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', '')
  // The placeholder block stays in the page (the stub overrides FM_ENDPOINTS before the app
  // reads it), but no placeholder may survive in a page anyone might mistake for a build.
  .replace("gateway: '__PREMIUM_GATEWAY_URL__'", "gateway: '" + ENDPOINTS.gateway + "'")
  .replace("session: '__PREMIUM_SESSION_URL__'", "session: '" + ENDPOINTS.session + "'")
  .replace("submit:  '__PREMIUM_SUBMIT_URL__'", "submit:  '" + ENDPOINTS.submit + "'");

for (const [what, marker] of [['stylesheet', 'href="app.css"'], ['content.js', 'src="content.js"'],
                              ['net.js', 'src="net.js"'], ['app.js', 'src="app.js"']]) {
  if (page.indexOf(marker) !== -1) { fail.push('failed to inline ' + what); }
}
if (page.indexOf('__PREMIUM_') !== -1) { fail.push('a deploy placeholder survived in the preview'); }
if (page.indexOf('telegram-web-app.js') !== -1) { fail.push('the Telegram SDK tag survived (it would race the stub)'); }
if (page.indexOf('PREVIEW STUB') > page.indexOf('window.FM_NET') && page.indexOf('window.FM_NET') !== -1) { fail.push('the stub is not ahead of the app scripts'); }
// The injected JSON must not be able to close the tag: nothing inside the stub, before its own
// closing tag, may spell `</script`.
if (/<\/script/i.test(stub.slice(0, stub.lastIndexOf('</script>')))) { fail.push('the injected stub contains a </script sequence'); }
if (json(RESULT_FIXTURES).indexOf('<') !== -1) { fail.push('the fixture JSON carries an unescaped <'); }
if (page.indexOf('fonts.googleapis.com') === -1) { fail.push('the Google Fonts link was lost'); }

if (fail.length) {
  console.error('');
  console.error('REFUSING TO WRITE the result preview:');
  for (const f of fail) { console.error('  - ' + f); }
  console.error('');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, page, 'utf8');

console.log('');
console.log('Customer result screen — offline preview');
console.log('  out        : .uat/result-preview.html (git-ignored)');
console.log('  size       : ' + (Buffer.byteLength(page, 'utf8') / 1024).toFixed(1) + ' KB, self-contained');
console.log('  cases      : ' + RESULT_CASES.map((c) => '?case=' + c).join('  '));
console.log('  open       : start .uat\\result-preview.html   (append ?case=ru-noscore etc.)');
console.log('  network    : none (fetch and Telegram are stubbed; only the font link is remote)');
console.log('');
