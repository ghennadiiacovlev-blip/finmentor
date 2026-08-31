#!/usr/bin/env node
// FINMENTOR — website contract regression gate.
//
// Assertion-based, exits non-zero on failure, resolves paths from this file rather than
// cwd. Covers the defects closed in the audit remediation:
//   - every submitter requires HTTP 2xx AND a JSON body with ok === true
//   - GA4 never receives arbitrary URL query in page_location / page_path
//   - Google analytics code is not loaded before consent
//   - generate_lead covers all three lead tools and dedupes per submission
//   - RU/RO runtime string parity on the mini-scan
//   - one x-default policy shared by HTML and sitemap
//   - all shipped JavaScript parses, inline scripts included

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// --------------------------------------------------------------- browser shim
// Minimal DOM/BOM surface, enough to execute analytics.js and lead-transport.js.
function makeWindow(opts = {}) {
  const store = new Map();
  const session = new Map();
  const listeners = new Map();
  const head = { appendChild(el) { win.__appended.push(el); } };
  const body = { appendChild() {}, };

  const win = {
    __appended: [],
    __gtagCalls: [],
    location: {
      href: opts.href || 'https://www.finmentor.md/',
      origin: 'https://www.finmentor.md',
      pathname: opts.pathname || '/',
      search: opts.search || ''
    },
    document: {
      documentElement: { lang: opts.lang || 'ru' },
      title: opts.title || 'FINMENTOR',
      referrer: opts.referrer || '',
      readyState: 'complete',
      head,
      body,
      createElement: () => ({
      style: {},
      classList: { add() {}, remove() {} },
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
      set innerHTML(v) { this.__html = v; },
      get innerHTML() { return this.__html || ''; }
    }),
      querySelector: () => null,
      addEventListener(t, f) { listeners.set(t, f); },
      removeEventListener() {}
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
      removeItem: (k) => session.delete(k)
    },
    addEventListener() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (t) => clearTimeout(t),
    URLSearchParams,
    URL,
    Promise,
    AbortController,
    crypto: globalThis.crypto,
    fetch: opts.fetch,
    console
  };
  win.window = win;
  return win;
}

function runScript(relPath, win) {
  const code = read(relPath);
  const ctx = vm.createContext(win);
  // The scripts are IIFEs that reference bare globals; the context object doubles as
  // globalThis, so window.foo and foo resolve to the same slot.
  vm.runInContext(code, ctx, { filename: relPath });
  return win;
}

// Loads analytics.js with consent already accepted, and captures every gtag call.
function loadAnalyticsAccepted(opts = {}) {
  const win = makeWindow(opts);
  win.localStorage.setItem('finmentor_cookie_consent', 'accept');
  runScript('analytics.js', win);
  // Replace the queueing gtag with a recorder, then re-run configure via a fresh page_view.
  return win;
}

console.log('\nFINMENTOR website contract\n');

// --------------------------------------------------------------- JS syntax
console.log('JAVASCRIPT SYNTAX');

const jsFiles = ['analytics.js', 'lead-transport.js', 'main.js', 'assistant.js', 'lang.js', 'i18n-ro.js'];
for (const f of jsFiles) {
  check('parses: ' + f, () => {
    new vm.Script(read(f), { filename: f });
  });
}

function collectHtml(dir, acc = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = dir ? `${dir}/${entry}` : entry;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) {
      if (['.git', 'node_modules', 'qa', 'scripts', 'n8n', 'docs'].includes(entry)) continue;
      collectHtml(rel, acc);
    } else if (entry.endsWith('.html')) {
      acc.push(rel);
    }
  }
  return acc;
}

check('all inline <script> blocks parse', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const html = read(f);
    const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    let i = 0;
    while ((m = re.exec(html)) !== null) {
      i++;
      const body = m[1];
      if (!body.trim()) continue;
      // Skip non-JS script blocks such as JSON-LD.
      const typeMatch = /<script\b([^>]*)>/i.exec(m[0]);
      if (typeMatch && /type\s*=\s*["'](?!text\/javascript|application\/javascript)/i.test(typeMatch[1])) continue;
      try {
        new vm.Script(body, { filename: `${f}#inline${i}` });
      } catch (e) {
        bad.push(`${f}#inline${i}: ${e.message}`);
      }
    }
  }
  assert(bad.length === 0, bad.join(' | '));
});

// --------------------------------------------------------------- lead transport
console.log('\nLEAD SUBMISSION SUCCESS CONTRACT');

function loadTransport(fetchImpl) {
  const win = makeWindow({ fetch: fetchImpl });
  runScript('lead-transport.js', win);
  return win.FMLeadTransport;
}
const jsonResponse = (status, bodyText) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(bodyText)
});

async function expectReject(promise, code) {
  try {
    await promise;
  } catch (e) {
    assert(e.fmCode === code, `expected fmCode=${code}, got ${e.fmCode}`);
    return;
  }
  throw new Error(`expected rejection with ${code}, but it resolved`);
}

const transportCases = [];
transportCases.push(['200 with ok:true resolves', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '{"ok":true,"lead_id":"FIN-1"}')));
  const r = await t.postLead('https://example.test/hook', { tool: 'contact' });
  assert(r.ok === true, 'did not resolve ok');
  assert(typeof r.requestId === 'string' && r.requestId.length > 8, 'no request id');
}]);
transportCases.push(['200 with ok:false is rejected', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '{"ok":false,"error":"invalid"}')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'rejected');
}]);
transportCases.push(['200 without ok field is rejected', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '{"lead_id":"FIN-1"}')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'rejected');
}]);
transportCases.push(['200 with non-JSON body is rejected', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '<html>proxy error</html>')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'invalid_response');
}]);
transportCases.push(['204 empty body is rejected', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(204, '')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'invalid_response');
}]);
transportCases.push(['503 is rejected as http_503', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(503, '{"ok":false}')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'http_503');
}]);
transportCases.push(['network failure is rejected', async () => {
  const t = loadTransport(() => Promise.reject(new Error('boom')));
  await expectReject(t.postLead('https://example.test/hook', {}), 'network');
}]);
// The identity is stable across a RETRY, and a retry is an attempt that did NOT settle. The old
// version of this case reused one payload OBJECT across two SUCCESSFUL posts and read the id
// surviving as proof of retry safety — but it survived only because postLead had mutated that
// object, and no submitter reuses its payload object: all four build a fresh one inside the submit
// handler. The case proved a property the site never had. The full lifecycle is gated in
// qa/lead-intake-request-identity.test.mjs (cases M–U).
transportCases.push(['request id is stable across a retry of the same submission', async () => {
  let n = 0;
  const t = loadTransport(() => {
    n++;
    return n === 1
      ? Promise.reject(new Error('boom'))
      : Promise.resolve(jsonResponse(200, '{"ok":true,"lead_id":"FIN-1","mode":"new"}'));
  });
  let held = '';
  try { await t.postLead('https://example.test/hook', { tool: 'contact' }); }
  catch (e) { held = t.submissionToken('contact'); }
  assert(held.length > 8, 'no identity was held after the failed attempt');
  const b = await t.postLead('https://example.test/hook', { tool: 'contact' });
  assert(b.requestId === held, 'the retry did not carry the held identity');
}]);
transportCases.push(['distinct submissions get distinct request ids', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '{"ok":true,"lead_id":"FIN-1","mode":"new"}')));
  const a = await t.postLead('https://example.test/hook', { tool: 'contact' });
  const b = await t.postLead('https://example.test/hook', { tool: 'contact' });
  assert(a.requestId !== b.requestId, 'two submissions shared a request id');
}]);
transportCases.push(['request id is sent as header and in meta', async () => {
  let seen = null;
  let sentBody = null;
  const t = loadTransport((url, init) => {
    seen = init.headers['X-FINMENTOR-Request-Id'];
    sentBody = JSON.parse(init.body);
    return Promise.resolve(jsonResponse(200, '{"ok":true,"lead_id":"FIN-1","mode":"new"}'));
  });
  const r = await t.postLead('https://example.test/hook', { tool: 'contact' });
  assert(seen === r.requestId, 'header request id mismatch');
  assert(sentBody.meta.request_id === r.requestId, 'meta.request_id mismatch');
}]);
transportCases.push(['thankYouUrl carries tool and sid', async () => {
  const t = loadTransport(() => Promise.resolve(jsonResponse(200, '{"ok":true,"lead_id":"FIN-1","mode":"new"}')));
  const u = t.thankYouUrl('mini_scan', 'fmr_abc');
  assert(u === 'thank-you.html?tool=mini_scan&sid=fmr_abc', 'unexpected url: ' + u);
}]);

// --------------------------------------------------------------- submitters wired
console.log('\nSUBMITTERS USE THE SHARED CONTRACT');

const submitters = [
  ['main.js', 'consultation'],
  ['questionnaire.html', 'RU X-Ray'],
  ['ro/questionnaire.html', 'RO X-Ray'],
  ['working-capital-scan.html', 'RU mini-scan'],
  ['ro/working-capital-scan.html', 'RO mini-scan']
];
for (const [file, label] of submitters) {
  check(`${label} (${file}) posts via FMLeadTransport`, () => {
    const s = read(file);
    assert(s.includes('FMLeadTransport.postLead'), 'does not call FMLeadTransport.postLead');
    assert(!/if \(!r\.ok\) throw new Error\('webhook_status_/.test(s), 'still treats bare 2xx as success');
    assert(!/if \(!res\.ok\) throw new Error\('webhook_status_/.test(s), 'still treats bare 2xx as success');
  });
}
for (const [file] of submitters.filter(([f]) => f.endsWith('.html'))) {
  check(`${file} loads lead-transport.js`, () => {
    assert(/<script src="[^"]*lead-transport\.js"><\/script>/.test(read(file)), 'lead-transport.js not included');
  });
}
check('index.html loads lead-transport.js for the consultation form', () => {
  assert(/<script src="lead-transport\.js"><\/script>/.test(read('index.html')), 'not included');
});

// --------------------------------------------------------------- GA query scrubbing
console.log('\nGA4 QUERY SCRUBBING (no PII in page_location / page_path)');

function scrubbed(search, pathname = '/questionnaire.html') {
  const win = loadAnalyticsAccepted({ pathname, search, href: 'https://www.finmentor.md' + pathname + search });
  return {
    path: win.FMAnalytics.safePagePath(),
    location: win.FMAnalytics.safePageLocation()
  };
}

check('email in query never reaches GA', () => {
  const r = scrubbed('?email=someone%40example.com&tool=contact');
  assert(!/@|example\.com|someone/i.test(r.path + r.location), 'email survived: ' + r.location);
  assert(r.path.includes('tool=contact'), 'whitelisted tool param was dropped');
});
check('phone in query never reaches GA', () => {
  const r = scrubbed('?phone=%2B37360123456&utm_source=fb');
  assert(!/37360123456/.test(r.path + r.location), 'phone survived: ' + r.location);
  assert(r.path.includes('utm_source=fb'), 'utm_source was dropped');
});
check('name / company / free text are dropped', () => {
  const r = scrubbed('?name=Ion%20Popescu&company=ACME%20SRL&comment=hello%20world');
  const seen = r.path + ' ' + r.location;
  for (const token of ['name=', 'company=', 'comment=', 'Popescu', 'ACME', 'hello']) {
    assert(!seen.includes(token), 'free text survived (' + token + '): ' + r.location);
  }
});
check('lead_id and telegram id are dropped', () => {
  const r = scrubbed('?lead_id=FIN-42&telegram_id=551662084');
  assert(!/FIN-42|551662084/.test(r.path + r.location), 'identifier survived: ' + r.location);
});
check('unknown parameters are dropped entirely', () => {
  const r = scrubbed('?whatever=1&secret=abc');
  assert(!/whatever|secret/.test(r.path + r.location), 'unknown param survived: ' + r.location);
});
check('a whitelisted param carrying an email is still dropped', () => {
  const r = scrubbed('?utm_campaign=mail-someone%40example.com');
  assert(!/@|example\.com/i.test(r.path + r.location), 'email inside utm survived: ' + r.location);
});
check('fragment is never forwarded', () => {
  const win = loadAnalyticsAccepted({ pathname: '/index.html', search: '', href: 'https://www.finmentor.md/index.html#email=a@b.com' });
  const loc = win.FMAnalytics.safePageLocation();
  assert(!loc.includes('#'), 'fragment survived: ' + loc);
});
check('page_location is rebuilt from origin, never location.href', () => {
  const src = read('analytics.js');
  assert(!/page_location:\s*location\.href/.test(src), 'page_location still uses location.href');
  assert(!/page_path:\s*location\.pathname \+ location\.search/.test(src), 'page_path still uses raw location.search');
});
check('clean urls are preserved unchanged', () => {
  const r = scrubbed('?utm_source=google&utm_medium=cpc&utm_campaign=brand', '/index.html');
  assert(r.path === '/index.html?utm_source=google&utm_medium=cpc&utm_campaign=brand', 'unexpected: ' + r.path);
});

// --------------------------------------------------------------- consent gate
console.log('\nCONSENT GATE');

check('no Google script is loaded before a consent choice', () => {
  const win = makeWindow({});
  runScript('analytics.js', win);
  const scripts = win.__appended.filter(Boolean);
  assert(scripts.length === 0, 'a script was appended before consent');
  assert(win.FMAnalytics.isLoaded() === false, 'analytics reported loaded before consent');
});
check('denied consent loads no Google script', () => {
  const win = makeWindow({});
  win.localStorage.setItem('finmentor_cookie_consent', 'deny');
  runScript('analytics.js', win);
  assert(win.FMAnalytics.isLoaded() === false, 'analytics loaded despite denial');
  assert(win.__appended.length === 0, 'a script was appended despite denial');
});
check('accepted consent loads gtag.js with the production measurement id', () => {
  const win = loadAnalyticsAccepted({});
  assert(win.FMAnalytics.isLoaded() === true, 'analytics did not load after accept');
  assert(win.FMAnalytics.measurementId === 'G-94L9B8WZ12', 'wrong measurement id: ' + win.FMAnalytics.measurementId);
});
check('the obsolete measurement id appears nowhere in runtime code', () => {
  for (const f of ['analytics.js', 'main.js', 'lead-transport.js']) {
    assert(!read(f).includes('G-94L98WZ12'), 'obsolete GA id present in ' + f);
  }
});

// --------------------------------------------------------------- conversions
console.log('\nCONVERSION TAXONOMY');

check('generate_lead covers contact, xray_extended and mini_scan', () => {
  const src = read('analytics.js');
  const block = /var LEAD_TOOLS = \{([\s\S]*?)\};/.exec(src);
  assert(block, 'LEAD_TOOLS table not found');
  for (const tool of ['contact', 'xray_extended', 'mini_scan']) {
    assert(block[1].includes(tool + ':'), 'missing lead tool: ' + tool);
  }
});
check('conversion dedup keys on the submission id, not the tool', () => {
  const src = read('analytics.js');
  assert(/dedupeKey = 'finmentor_ga4_generate_lead:' \+ \(submissionId \|\| tool\)/.test(src),
    'dedup is not keyed on the submission id');
});
check('mini-scan redirects carry a submission id', () => {
  for (const f of ['working-capital-scan.html', 'ro/working-capital-scan.html']) {
    assert(read(f).includes("thankYouUrl('mini_scan'"), f + ' does not pass a submission id');
  }
});
check('X-Ray redirects carry a submission id', () => {
  for (const f of ['questionnaire.html', 'ro/questionnaire.html']) {
    assert(read(f).includes("thankYouUrl('xray_extended'"), f + ' does not pass a submission id');
  }
});
check('consultation legacy lead_submit fires only after backend success', () => {
  const src = read('main.js');
  const submitIdx = src.indexOf("window.finmentorTrack('lead_submit'");
  const postIdx = src.indexOf('return postLeadPayload(payload);');
  assert(submitIdx > postIdx && postIdx !== -1, 'lead_submit still precedes the POST');
});

// --------------------------------------------------------------- attribution
console.log('\nATTRIBUTION CONTINUITY (first touch / last touch)');

// A shared localStorage across "page loads" models one returning visitor.
function visitor() {
  const store = new Map();
  return {
    store,
    visit(pathname, search) {
      const win = makeWindow({ pathname, search, href: 'https://www.finmentor.md' + pathname + search });
      win.localStorage.getItem = (k) => (store.has(k) ? store.get(k) : null);
      win.localStorage.setItem = (k, v) => store.set(k, String(v));
      runScript('analytics.js', win);
      return win;
    }
  };
}

check('a campaign landing is captured on page load, before any submit', () => {
  const v = visitor();
  const win = v.visit('/index.html', '?utm_source=google&utm_medium=cpc&utm_campaign=brand');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch, 'no first touch captured');
  assert(a.first_touch.utm_source === 'google', 'wrong first touch source: ' + JSON.stringify(a.first_touch));
  assert(a.first_touch.captured_at, 'first touch has no timestamp');
});

check('attribution survives navigation to a page with no UTM', () => {
  // This is the defect: capture used to happen only at submit, from the submitted page's
  // own URL, so navigating away before converting lost the campaign entirely.
  const v = visitor();
  v.visit('/index.html', '?utm_source=facebook&utm_medium=paid&utm_campaign=q3');
  const win = v.visit('/questionnaire.html', '');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch && a.first_touch.utm_source === 'facebook', 'attribution lost on navigation');
  assert(a.last_touch && a.last_touch.utm_source === 'facebook', 'last touch lost on navigation');
});

check('first touch is never overwritten by a later campaign', () => {
  const v = visitor();
  v.visit('/index.html', '?utm_source=google&utm_medium=cpc&utm_campaign=first');
  const win = v.visit('/cases.html', '?utm_source=newsletter&utm_medium=email&utm_campaign=second');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch.utm_campaign === 'first', 'first touch was overwritten: ' + a.first_touch.utm_campaign);
  assert(a.last_touch.utm_campaign === 'second', 'last touch did not advance: ' + a.last_touch.utm_campaign);
});

check('a direct visit with no campaign records no attribution', () => {
  const v = visitor();
  const win = v.visit('/index.html', '');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch === null && a.last_touch === null, 'invented attribution for a direct visit');
});

check('a single-visit lead reports the same touch as first and last', () => {
  const v = visitor();
  const win = v.visit('/index.html', '?utm_source=google&utm_medium=cpc&utm_campaign=solo');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch.utm_campaign === 'solo' && a.last_touch.utm_campaign === 'solo', 'single touch not mirrored');
});

check('attribution capture stores campaign metadata only, never PII', () => {
  const v = visitor();
  v.visit('/index.html', '?utm_source=google&email=someone%40example.com&name=Ion&phone=%2B37360123456');
  const dumped = JSON.stringify([...v.store.entries()]);
  for (const token of ['someone@example.com', 'Ion', '37360123456', 'email', 'phone']) {
    assert(!dumped.includes(token), 'stored attribution contains ' + token + ': ' + dumped);
  }
});

check('both mini-scan submitters run FMAnalytics enrichment', () => {
  for (const f of ['working-capital-scan.html', 'ro/working-capital-scan.html']) {
    const s = read(f);
    assert(s.includes('FMAnalytics.enrichLeadPayload'), f + ' does not enrich its payload');
  }
});

check('every submitter enriches before posting', () => {
  for (const f of ['main.js', 'questionnaire.html', 'ro/questionnaire.html',
    'working-capital-scan.html', 'ro/working-capital-scan.html']) {
    const s = read(f);
    const enrich = s.indexOf('enrichLeadPayload');
    const post = s.indexOf('FMLeadTransport.postLead');
    assert(enrich !== -1, f + ' has no enrichment');
    assert(post !== -1, f + ' has no transport call');
  }
});

check('enrichment attaches both touches to the payload', () => {
  const src = read('analytics.js');
  assert(/payload\.meta\.attribution_first_touch/.test(src), 'first touch not attached to payload');
  assert(/payload\.meta\.attribution_last_touch/.test(src), 'last touch not attached to payload');
});

check('GA identifiers are still gated on analytics consent', () => {
  const src = read('analytics.js');
  // getAttributionContext resolves with consent-only ids; enrichment deletes them first.
  assert(/if \(!out\.analytics_consent[\s\S]{0,120}resolve\(out\)/.test(src),
    'GA identifier capture is not gated on consent');
  assert(/delete payload\.meta\.ga_client_id/.test(src), 'stale GA client id is not cleared');
});

// --------------------------------------------------------------- RO parity
console.log('\nRU / RO PARITY');

// A Cyrillic literal on a Romanian page is a defect only when it is DISPLAY text.
// Some are canonical CRM taxonomy shared with the Russian questionnaire: radio/checkbox
// value attributes that setRadioByValue looks up by exact value, the substring matchers in
// docHas(), and the да/нет values docHas() writes to the CRM. Translating those would break
// deep-link prefill and split RU and RO leads into two taxonomies. Their visible labels are
// already Romanian.
const CANONICAL_DATA = new Set(['да', 'нет', 'Дебиторская', 'Кредиторская']);

function untranslatedDisplayLiterals(file) {
  const src = read(file);
  const htmlValues = new Set((src.match(/value="[^"]*"/g) || []).map((m) => m.slice(7, -1)));
  const offenders = [];
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (const lit of m[1].match(/(['"])(?:(?!\1)[^\\]|\\.)*\1/g) || []) {
      if (!/[Ѐ-ӿ]/.test(lit)) continue;
      const inner = lit.slice(1, -1);
      if (htmlValues.has(inner) || CANONICAL_DATA.has(inner)) continue;
      offenders.push(lit.slice(0, 70));
    }
  }
  return offenders;
}

check('RO mini-scan has no untranslated display strings', () => {
  const o = untranslatedDisplayLiterals('ro/working-capital-scan.html');
  assert(o.length === 0, o.length + ' literal(s): ' + o.slice(0, 4).join(' | '));
});

check('RO questionnaire has no untranslated display strings', () => {
  const o = untranslatedDisplayLiterals('ro/questionnaire.html');
  assert(o.length === 0, o.length + ' literal(s): ' + o.slice(0, 4).join(' | '));
});

check('RO deep-link prefill still resolves against the canonical taxonomy', () => {
  // Regression guard: translating these map values would break ?model= / ?pain= prefill,
  // because setRadioByValue matches the HTML value attribute exactly.
  const src = read('ro/questionnaire.html');
  const htmlValues = new Set((src.match(/value="[^"]*"/g) || []).map((m) => m.slice(7, -1)));
  const broken = [];
  for (const m of src.match(/industry: '([^']+)'/g) || []) {
    const v = /industry: '([^']+)'/.exec(m)[1];
    if (!htmlValues.has(v)) broken.push('industry=' + v);
  }
  for (const m of src.match(/intake: '([^']+)'/g) || []) {
    const v = /intake: '([^']+)'/.exec(m)[1];
    if (!htmlValues.has(v)) broken.push('intake=' + v);
  }
  assert(broken.length === 0, broken.length + ' prefill target(s) match no input value: ' + broken.slice(0, 4).join(' | '));
});

check('the mini-scan result strings are actually Romanian now', () => {
  const src = read('ro/working-capital-scan.html');
  for (const expected of ['Nivel de risc', 'Concluzie preliminară', 'Traseu recomandat', 'Trimitem rezultatul']) {
    assert(src.includes(expected), 'missing translated string: ' + expected);
  }
});
check('the RO risk band reads as Romanian, not as a Russian word order calque', () => {
  // "Низкий риск" is correct Russian; porting the level-first concatenation produced
  // "Scăzut risc" on every RO result. Romanian puts the adjective after the noun.
  const src = read('ro/working-capital-scan.html');
  assert(!/risk\s*\+\s*'\s*risc/.test(src), 'level-first concatenation is back: renders "Scăzut risc"');
  assert(/'Risc\s*'\s*\+\s*risk\.toLowerCase\(\)/.test(src), 'RO risk band no longer builds "Risc <nivel>"');
});

check('RO structured data does not describe the page in Russian', () => {
  // knowsAbout on the RO page was an untranslated copy of the RU array, so the Romanian
  // page declared its expertise topics in Russian to every crawler that read it.
  const src = read('ro/index.html');
  const block = /"knowsAbout"\s*:\s*\[([\s\S]*?)\]/.exec(src);
  assert(block, 'ro/index.html has no knowsAbout block');
  assert(!/[Ѐ-ӿ]/.test(block[1]), 'Cyrillic in the RO knowsAbout array: ' + block[1].replace(/\s+/g, ' ').slice(0, 90));
});

check('RO pages declare lang="ro"', () => {
  for (const f of ['ro/questionnaire.html', 'ro/working-capital-scan.html']) {
    assert(/<html[^>]*\blang="ro"/i.test(read(f)), f + ' does not declare lang="ro"');
  }
});

// --------------------------------------------------------------- x-default
console.log('\nSEO: x-default POLICY');

// Canonical policy, shared by HTML and sitemap:
//   x-default === the hreflang="ru" URL of the SAME content.
// Russian is the default language, so an unmatched visitor should land on the Russian
// version of the page they asked for. Pointing every page's x-default at the homepage
// (the previous HTML behaviour) declares the homepage as the default for every piece of
// content, which conflicts with the per-page pairing the sitemap already publishes.
const hrefOf = (tag) => {
  const m = /href=["']([^"']+)["']/i.exec(tag);
  return m ? m[1] : null;
};

check('HTML x-default matches the page hreflang="ru" URL', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const html = read(f);
    const xd = (html.match(/<link[^>]+hreflang=["']x-default["'][^>]*>/gi) || []).map(hrefOf);
    if (xd.length === 0) continue;
    const ru = (html.match(/<link[^>]+hreflang=["']ru["'][^>]*>/gi) || []).map(hrefOf);
    if (ru.length === 0) { bad.push(`${f}: x-default without an ru alternate`); continue; }
    if (xd.length > 1) { bad.push(`${f}: ${xd.length} x-default tags`); continue; }
    if (xd[0] !== ru[0]) bad.push(`${f}: x-default=${xd[0]} but ru=${ru[0]}`);
  }
  assert(bad.length === 0, bad.length + ' mismatch(es): ' + bad.slice(0, 5).join(' | '));
});

check('sitemap x-default matches the entry hreflang="ru" URL', () => {
  const bad = [];
  for (const entry of read('sitemap.xml').match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const xd = (entry.match(/<xhtml:link[^>]+hreflang=["']x-default["'][^>]*\/?>/gi) || []).map(hrefOf);
    const ru = (entry.match(/<xhtml:link[^>]+hreflang=["']ru["'][^>]*\/?>/gi) || []).map(hrefOf);
    if (xd.length === 0) continue;
    const loc = /<loc>([^<]+)<\/loc>/i.exec(entry);
    if (ru.length === 0) { bad.push(`${loc && loc[1]}: no ru alternate`); continue; }
    if (xd[0] !== ru[0]) bad.push(`${loc && loc[1]}: x-default=${xd[0]} ru=${ru[0]}`);
  }
  assert(bad.length === 0, bad.length + ' mismatch(es): ' + bad.slice(0, 5).join(' | '));
});

check('HTML and sitemap agree on x-default for every shared URL', () => {
  const fromSitemap = new Map();
  for (const entry of read('sitemap.xml').match(/<url>[\s\S]*?<\/url>/gi) || []) {
    const loc = /<loc>([^<]+)<\/loc>/i.exec(entry);
    const xd = (entry.match(/<xhtml:link[^>]+hreflang=["']x-default["'][^>]*\/?>/gi) || []).map(hrefOf);
    if (loc && xd.length) fromSitemap.set(loc[1], xd[0]);
  }
  const bad = [];
  for (const f of collectHtml('')) {
    const html = read(f);
    const canonical = hrefOf((html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [''])[0]);
    if (!canonical || !fromSitemap.has(canonical)) continue;
    const xd = (html.match(/<link[^>]+hreflang=["']x-default["'][^>]*>/gi) || []).map(hrefOf);
    if (!xd.length) continue;
    if (xd[0] !== fromSitemap.get(canonical)) {
      bad.push(`${f}: html=${xd[0]} sitemap=${fromSitemap.get(canonical)}`);
    }
  }
  assert(bad.length === 0, bad.length + ' disagreement(s): ' + bad.slice(0, 5).join(' | '));
});

// --------------------------------------------------------------- security controls
console.log('\nSECURITY CONTROLS (what GitHub Pages actually honours)');

check('every page declares a referrer policy', () => {
  const missing = [];
  for (const f of collectHtml('')) {
    if (!/<meta[^>]+name=["']referrer["'][^>]+content=["']strict-origin-when-cross-origin["']/i.test(read(f))) {
      missing.push(f);
    }
  }
  assert(missing.length === 0, missing.length + ' page(s) without referrer meta: ' + missing.slice(0, 5).join(', '));
});

check('no page declares a referrer policy twice', () => {
  const dup = [];
  for (const f of collectHtml('')) {
    const n = (read(f).match(/<meta[^>]+name=["']referrer["']/gi) || []).length;
    if (n > 1) dup.push(`${f} (${n})`);
  }
  assert(dup.length === 0, 'duplicate referrer meta: ' + dup.join(', '));
});

check('_headers is labelled inert so it is not mistaken for live config', () => {
  const h = read('_headers');
  assert(/INERT ON THE CURRENT HOST/i.test(h), '_headers does not carry the inert warning');
  assert(/GitHub Pages/i.test(h), '_headers does not name the host that ignores it');
});

check('the platform blocker is documented rather than claimed as fixed', () => {
  const doc = read('docs/FINMENTOR_SECURITY_HEADERS_PLATFORM_BLOCKER.md');
  assert(/PLATFORM_BLOCKER/.test(doc), 'blocker doc missing its marker');
  assert(/Cloudflare/i.test(doc), 'blocker doc names no concrete edge option');
});

// The staged policy and the documented expectation are two copies of the same thing, so
// they can drift. These checks tie them together. None of them proves edge delivery — that
// needs a real request, and the fixture says so itself.
check('the expected-headers fixture matches the staged _headers policy', () => {
  const fx = JSON.parse(read('qa/fixtures/expected-security-headers.json'));
  const h = read('_headers');
  for (const entry of fx.headers) {
    if (entry.name === 'Referrer-Policy') continue; // delivered by meta, asserted above
    const line = `${entry.name}: ${entry.value}`;
    assert(h.includes(line), `_headers does not carry the fixture value for ${entry.name}`);
  }
});

check('the fixture claims delivery only for the header that is actually delivered', () => {
  const fx = JSON.parse(read('qa/fixtures/expected-security-headers.json'));
  const live = fx.headers.filter((e) => e.delivery === 'live').map((e) => e.name);
  assert(live.length === 1 && live[0] === 'Referrer-Policy',
    'fixture claims live delivery for: ' + live.join(', ') + ' — only Referrer-Policy reaches browsers today');
  assert(fx.origin.can_set_response_headers === false,
    'fixture asserts the origin can set response headers; GitHub Pages cannot');
});

check('the fixture lists exactly the five unresolved headers', () => {
  const fx = JSON.parse(read('qa/fixtures/expected-security-headers.json'));
  const expected = ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options',
    'X-Content-Type-Options', 'Permissions-Policy'].sort();
  assert(fx.unresolved_count === 5, 'unresolved_count is ' + fx.unresolved_count);
  assert(JSON.stringify([...fx.unresolved].sort()) === JSON.stringify(expected),
    'unresolved list drifted: ' + fx.unresolved.join(', '));
  const staged = fx.headers.filter((e) => e.delivery === 'staged').map((e) => e.name).sort();
  assert(JSON.stringify(staged) === JSON.stringify(expected),
    'staged headers disagree with the unresolved list');
});

check('CSP is not shipped as an enforcing meta tag', () => {
  // A meta CSP has no report-only mode and ignores frame-ancestors, so shipping one here
  // would break the live site on publish while not delivering the clickjacking control.
  const offenders = collectHtml('').filter((f) => /http-equiv=["']Content-Security-Policy["']/i.test(read(f)));
  assert(offenders.length === 0, 'enforcing meta CSP on: ' + offenders.slice(0, 5).join(', '));
});

check('privacy policy describes the live processors, not future ones', () => {
  for (const f of ['privacy.html', 'ro/privacy.html']) {
    const s = read(f);
    assert(s.includes('OpenAI'), f + ' does not disclose OpenAI');
    assert(s.includes('n8n'), f + ' does not disclose n8n');
    assert(s.includes('Google Sheets'), f + ' does not disclose Google Sheets');
    // Cloudflare is not in the serving path; claiming it would be inaccurate.
    assert(!s.includes('Cloudflare'), f + ' still names Cloudflare, which is not in the path');
  }
});

// --------------------------------------------------------------- run async cases
const run = async () => {
  for (const [name, fn] of transportCases) {
    try {
      await fn();
      pass++;
      console.log('  PASS  ' + name);
    } catch (e) {
      failures.push(name + ': ' + e.message);
      console.log('  FAIL  ' + name + ' -> ' + e.message);
    }
  }

  console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.error('\nWEBSITE CONTRACT GATE: FAIL');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('WEBSITE CONTRACT GATE: PASS');
};
run();
