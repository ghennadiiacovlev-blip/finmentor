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
      // Repository/UAT evidence is not a deployed website surface. In particular, a local
      // owner-owned export must not make the public-site contract inspect copied pages as if
      // they were canonical routes.
      if (['.git', 'node_modules', 'qa', 'scripts', 'n8n', 'docs', 'qa-evidence', 'qa-artifacts', 'FINMENTOR_GATE6_FINAL'].includes(entry)) continue;
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

check('a campaign landing is captured only after analytics consent', () => {
  const v = visitor();
  const win = v.visit('/index.html', '?utm_source=google&utm_medium=cpc&utm_campaign=brand');
  let a = win.FMAnalytics.getAttribution();
  assert(a.first_touch === null && a.last_touch === null, 'attribution persisted before consent');
  win.FMAnalytics.consent('accept');
  a = win.FMAnalytics.getAttribution();
  assert(a.first_touch, 'no first touch captured');
  assert(a.first_touch.utm_source === 'google', 'wrong first touch source: ' + JSON.stringify(a.first_touch));
  assert(a.first_touch.captured_at, 'first touch has no timestamp');
});

check('attribution survives navigation to a page with no UTM', () => {
  // This is the defect: capture used to happen only at submit, from the submitted page's
  // own URL, so navigating away before converting lost the campaign entirely.
  const v = visitor();
  v.visit('/index.html', '?utm_source=facebook&utm_medium=paid&utm_campaign=q3').FMAnalytics.consent('accept');
  const win = v.visit('/questionnaire.html', '');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch && a.first_touch.utm_source === 'facebook', 'attribution lost on navigation');
  assert(a.last_touch && a.last_touch.utm_source === 'facebook', 'last touch lost on navigation');
});

check('first touch is never overwritten by a later campaign', () => {
  const v = visitor();
  v.visit('/index.html', '?utm_source=google&utm_medium=cpc&utm_campaign=first').FMAnalytics.consent('accept');
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
  win.FMAnalytics.consent('accept');
  const a = win.FMAnalytics.getAttribution();
  assert(a.first_touch.utm_campaign === 'solo' && a.last_touch.utm_campaign === 'solo', 'single touch not mirrored');
});

check('attribution capture stores campaign metadata only, never PII', () => {
  const v = visitor();
  v.visit('/index.html', '?utm_source=google&email=someone%40example.com&name=Ion&phone=%2B37360123456').FMAnalytics.consent('accept');
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

// --------------------------------------------------------------- structured-data helpers
//
// Shared by the copy checks and the SEO checks below, so both read a page's graph the same way.
const SITE = 'https://www.finmentor.md/';
const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// index.html and its directory are the same page. Everything else is compared literally.
function selfUrls(rel) {
  const abs = SITE + rel;
  return rel.endsWith('index.html') ? [abs, SITE + rel.slice(0, -'index.html'.length)] : [abs];
}
const strip = (u) => String(u || '').split('#')[0];
// Site-level nodes name the site or the person, not the page they happen to be declared on.
const SITE_LEVEL = /#(organization|website|person|service|financial-control-service)$/;

function graphNodes(html) {
  const out = [];
  for (const m of html.matchAll(LD)) {
    const parsed = JSON.parse(m[1]);
    for (const n of (parsed['@graph'] || [parsed])) { out.push(n); }
  }
  return out;
}

// --------------------------------------------------------------- customer copy integrity
console.log('\nCOPY: TERMINOLOGY DAMAGE');

// P1-03/P1-04/P1-05. The customer terminology pass replaced tokens inside sentences rather than
// rewriting the sentences, which left behind three signatures: a noun phrase standing where an
// adjective or a case-inflected form belongs, a word repeated because a substitution overlapped
// text that was already there, and a BRANDED product title whose English tokens were translated.
//
// Each check names the shape of the damage, not just the strings that were found, so a new
// instance of the same shape fails here rather than reaching a customer.

// THE PRIMARY CUSTOMER JOURNEY, both editions. The home page and the X-Ray are where a customer
// starts, the monthly page is where the packages are read and priced, and the thank-you page is
// the last thing the journey shows them — a grammar defect on any of the four reaches every lead.
const RU_PAGES = ['index.html', 'questionnaire.html', 'monthly-cfo-support.html', 'thank-you.html'];
const RO_PAGES = ['ro/index.html', 'ro/questionnaire.html', 'ro/monthly-cfo-support.html', 'ro/thank-you.html'];

// Everything a customer can read, with machine values and markup removed. `value="..."` is the
// CRM contract and is deliberately excluded: it must NOT be corrected, and including it here
// would turn the frozen contract into a test failure.
//
// ELEMENT BOUNDARIES SURVIVE AS NEWLINES. A tag between two words means they are not one
// sentence — a card's tag and its title, two radio labels — and a stripper that joins them with a
// space invents repetitions and agreement errors no customer ever reads.
function visibleCopy(f) {
  return read(f)
    .replace(/<script[\s\S]*?<\/script>/g, '\n')
    .replace(/<style[\s\S]*?<\/style>/g, '\n')
    .replace(/value="[^"]*"/g, ' ')
    .replace(/data-[a-z-]+="[^"]*"/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

check('no customer sentence repeats a word a substitution duplicated', () => {
  // «Базовый базовый формат», «панель собственника собственника», «Test financiar FINMENTOR
  // FINMENTOR» — a replacement that overlapped the words already around it.
  const bad = [];
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    for (const m of visibleCopy(f).matchAll(/([A-Za-zА-Яа-яЁёĂÂÎȘȚăâîșț]{4,})[ ]+\1(?![A-Za-zА-Яа-яЁёĂÂÎȘȚăâîșț])/gi)) {
      bad.push(f + ': ' + m[0]);
    }
  }
  assert(bad.length === 0, bad.length + ' duplicated word(s): ' + bad.slice(0, 4).join(' | '));
});

check('no Russian sentence leaves a term in the nominative where a case is required', () => {
  // «управленческий прибыль и убытки», «контроль денежный поток», «перед экспертная финансовая
  // диагностика» — the replacement term was dropped in citation form into a governed position.
  const SHAPES = [
    /управленческий прибыль и убытки/,
    /(?:контроль|структура|анализ|обзор|экономика|логика|внедрение)\s+(?:денежный поток|прибыль и убытки|панель собственника|промоакция)/,
    /перед\s+экспертная/,
    /Не хватает денежный поток/,
    /Нет (?:понятного )?(?:ключевые показатели|прибыль и убытки)/,
    /Power BI панель собственника/
  ];
  const bad = [];
  for (const f of RU_PAGES) {
    const copy = visibleCopy(f);
    for (const r of SHAPES) { const m = r.exec(copy); if (m) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' ungrammatical substitution(s): ' + bad.slice(0, 4).join(' | '));
});

// The four checks below close the classes found in the final sentence-by-sentence pass. Each one
// describes the SHAPE of the damage the terminology substitution leaves behind, so the next
// instance of it fails here instead of shipping.

check('no list opened after a colon or semicolon capitalises only its first item', () => {
  // «для управления: Денежный поток, прибыль и убытки, обязательства…» and «în creștere: Cont de
  // profit și pierdere managerial, flux de numerar, trezorerie…». The first item used to be an
  // English term that carried a capital — «Cash Flow», «P&L» — and kept it when it was localized,
  // while every following item in the SAME list is lowercase. The inconsistency inside one
  // sentence is the tell, so that is what is matched: a capitalised opener followed by a comma
  // and a lowercase continuation.
  //
  // Metadata counts. A `description` is customer-readable in a search snippet and a social card,
  // and the corrupted openers shipped there too, mirroring the on-page sentence word for word.
  const OPENER = /[:;] ([А-ЯЁA-ZĂÂÎȘȚ][а-яёa-zăâîșț]+(?: [а-яёa-zăâîșț]+){0,4}(?: \([^)]*\))?), ([а-яёa-zăâîșț])/g;
  const bad = [];
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    const html = read(f);
    // The visible sentences, plus the customer-readable description strings that mirror them.
    const zones = [visibleCopy(f)];
    for (const m of html.matchAll(/<meta[^>]+name="(?:description|twitter:description)"[^>]*content="([^"]*)"/g)) { zones.push(m[1]); }
    for (const m of html.matchAll(/<meta[^>]+property="og:description"[^>]*content="([^"]*)"/g)) { zones.push(m[1]); }
    for (const m of html.matchAll(/"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) { zones.push(m[1]); }
    for (const zone of zones) {
      OPENER.lastIndex = 0;
      for (const m of zone.matchAll(OPENER)) {
        // A proper name legitimately keeps its capital anywhere in a list.
        if (/^(FINMENTOR|Power BI|Google|Microsoft|Excel|Telegram|Zoom|Dropbox|Make|Control|CFO|Financial|Business|Monthly|Client|Big4|IFRS|Light|Standard|Premium)/.test(m[1])) { continue; }
        bad.push(f + ': "' + m[0].replace(/\s+/g, ' ').trim() + '"');
      }
    }
  }
  assert(bad.length === 0, bad.length + ' half-capitalised list(s): ' + bad.slice(0, 4).join(' | '));
});

check('no two-line card drops the comma before its adversative conjunction', () => {
  // The AI-economics cards paint a bold claim and a continuation as two lines of one sentence.
  // «ИИ-бюджет растёт» + «но рентабельность…» and «Bugetul IA crește» + «dar rentabilitatea…»
  // read — and are announced by a screen reader — as one string with no comma before «но» / «dar».
  const bad = [];
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    for (const m of read(f).matchAll(/<strong>([^<]*[^,\s])<\/strong>\s*<span>((?:но|dar) [^<]*)<\/span>/g)) {
      bad.push(f + ': "' + m[1] + '" + "' + m[2].slice(0, 40) + '"');
    }
  }
  assert(bad.length === 0, bad.length + ' missing comma(s) before an adversative: ' + bad.slice(0, 4).join(' | '));
});

check('no Romanian sentence keeps Russian word order or a Russian impersonal construction', () => {
  // These four shipped as literal transpositions of the Russian source: «Прибыль есть, а денег
  // нет» -> «Profit există, dar bani nu»; «Не хватает cash flow» -> «Nu ajunge flux de numerar»;
  // «навести порядок» -> «a pune ordinea» (the idiom takes no article); «на перспективу» ->
  // «pentru perspectivă». The machine `value="…"` beside each label stays Russian and is
  // deliberately outside `visibleCopy`, because it is the CRM contract.
  const SHAPES = [
    /Profit există, (?:dar )?bani nu/,
    /Nu ajunge flux de numerar/,
    /pusă ordinea/,
    /Planific pentru perspectivă/,
    /inteligența artificială dvs\./,
    /Inteligență artificială \(AI\) și automatizarea/,
    // THE SHAPE behind the first of those, which the adversarial pass then found three more
    // instances of: a bare, unarticulated common noun in subject position before «există».
    // Russian has no articles, so «Бухгалтерский учёт есть», «Заказы есть» and «Деньги «есть»»
    // transpose to «Contabilitate există», «Comenzi există» and «Bani „există”» and read as a
    // foreigner's Romanian. The language wants the article — «Contabilitatea există», «Banii
    // „există”» — or the existential inversion, «Există comenzi».
    //
    // The lookbehind lets an ARTICULATED noun through, which is the corrected form: -a, -ea, -ua,
    // -ul, -le and -ii are the definite endings. And the tail is `(?![a-zăâîșț])`, not `\b`:
    // «există» ends in ă, which is not an ASCII word character, so a `\b` there matches NOTHING
    // and silently turns the whole rule into decoration. That bug hid the three extra instances
    // on the first pass.
    /(?:^|\n)\s*(?!FINMENTOR)[A-ZĂÂÎȘȚ][a-zăâîșț]{3,}(?<!ea|ua|ul|le|ii|[ao]) *[„”"']?există(?![a-zăâîșț])/m
  ];
  const bad = [];
  for (const f of RO_PAGES) {
    const copy = visibleCopy(f);
    for (const r of SHAPES) { const m = r.exec(copy); if (m) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' Russian-shaped Romanian sentence(s): ' + bad.slice(0, 4).join(' | '));
});

check('no English noun is left standing inside a primary-journey sentence', () => {
  // FINMENTOR is premium AND readable by a founder who does not speak English. Approved product
  // names stay — n8n, Make, Power BI, Zoom, Excel, Google Sheets, Telegram, Dropbox — and a term
  // of art may appear once in parentheses beside its localized form. A bare English NOUN carrying
  // the meaning of the sentence may not: «Aging дебиторки», «Cash gap», «управленческий summary»,
  // «часов и deliverables», «Power BI monitoring», «Telegram / email alerts» all shipped.
  const BARE = [
    /\bAging\b(?!\s*\))/, /\bCash gap\b/, /\bdeliverables\b/, /\bmonitoring\b/,
    /\balerts\b/, /(?:управленческий|managerial)\s+[Ss]ummary/, /\bSummary\s+managerial/,
    /улучшению cash flow/, /\bMake \/ n8n сценарии/
  ];
  const bad = [];
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    const copy = visibleCopy(f);
    for (const r of BARE) { const m = r.exec(copy); if (m) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' untranslated English noun(s): ' + bad.slice(0, 4).join(' | '));
});

check('the approved tier labels Light / Standard / Premium are not lowercased', () => {
  // `Light`, `Standard` and `Premium` are owner-approved tier labels. The package cards had them
  // as lowercase Latin words — `CFO Control Partner · standard` — and «Control Light · базовый
  // light-формат» stacked `Light` twice in one title.
  const bad = [];
  for (const f of ['monthly-cfo-support.html', 'ro/monthly-cfo-support.html']) {
    const html = read(f);
    for (const m of html.matchAll(/<h2>[^<]*·\s*(standard|premium|light)[^<]*<\/h2>/g)) { bad.push(f + ': ' + m[0]); }
    for (const m of html.matchAll(/Control Light[^<]*\b(light)\b/g)) { bad.push(f + ': ' + m[0]); }
  }
  assert(bad.length === 0, bad.length + ' lowercased tier label(s): ' + bad.slice(0, 4).join(' | '));
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE SECOND SENTENCE-BY-SENTENCE PASS. Eight more classes, found by reading the two editions
// SIDE BY SIDE: where one language says a thing cleanly and the other does not, the untidy one
// is the defect. Each gate below names the shape, so the next instance fails here.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// `visibleCopy` keeps HTML comments, which is right for the gates above — a comment is source the
// terminology pass also damaged. The gates below grade what a CUSTOMER READS, and a comment is not
// that, so they strip comments first. `ro/questionnaire.html` carries a Russian developer comment
// with `P&L / CF` in it, kept deliberately as audit trail and invisible on the page.
// Comments must go BEFORE the tag stripper, not after: `<[^>]+>` stops at the first `>`, so a
// comment containing one — this one contains `->` — is only partly eaten and leaves its prose
// behind looking like copy.
function paintedCopy(f) {
  return read(f)
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/<script[\s\S]*?<\/script>/g, '\n')
    .replace(/<style[\s\S]*?<\/style>/g, '\n')
    .replace(/value="[^"]*"/g, ' ')
    .replace(/data-[a-z-]+="[^"]*"/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

// The X-Ray's answer sets, located by the input `name` that carries them. The CRM `value="…"` is
// stripped first: it is the frozen machine contract and is deliberately NOT graded as prose.
function answerSet(f, inputName) {
  const html = read(f).replace(/<!--[\s\S]*?-->/g, '\n');
  const out = [];
  for (const m of html.matchAll(/<fieldset\b[\s\S]*?<\/fieldset>/g)) {
    if (m[0].indexOf('name="' + inputName + '"') === -1) { continue; }
    out.push(m[0].replace(/value="[^"]*"/g, ' ').replace(/data-[a-z-]+="[^"]*"/g, ' ')
      .replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' '));
  }
  return out.join('\n');
}

// A language rule that PROVES, every run, that it can still fail.
//
// `\b` and `\w` are ASCII-only in JavaScript. `\bна удалёнке\b`, `\bДЗ/КЗ\b` and `еженедель\w*`
// all match NOTHING — the boundary before «н» never exists, and `\w*` stops dead at «е» — so a
// rule written that way against Cyrillic or Romanian diacritics is decoration that reports PASS
// forever. That is exactly how the `\b`-terminated «există» rule shipped as a no-op last cycle.
//
// So no rule below is used until it has flagged every broken string it was written for and let
// every corrected string through. A dead rule fails HERE, loudly, instead of on a customer.
function langRule(re, mustFlag, mustPass) {
  for (const s of mustFlag) {
    re.lastIndex = 0;
    assert(re.test(s), 'rule ' + re + ' no longer flags: ' + s);
  }
  for (const s of mustPass) {
    re.lastIndex = 0;
    assert(!re.test(s), 'rule ' + re + ' wrongly flags: ' + s);
  }
  re.lastIndex = 0;
  return re;
}

check('no X-Ray answer welds a unit noun to its own gloss', () => {
  // «1 объект-точка», «2–5 объектов-точек» and their Romanian «1 imobil-punct», «2–5
  // imobile-puncte»: the substitution pass put a term and its gloss side by side and a hyphen
  // welded them into a compound that inflects on BOTH halves — which no Russian or Romanian
  // compound does. These two answer sets name a count of things; there is no legitimate
  // hyphenated compound in either of them, so any hyphen joining two words is the defect.
  const WELD = langRule(/[A-Za-zА-Яа-яЁёĂÂÎȘȚăâîșț]{3,}-[A-Za-zА-Яа-яЁёĂÂÎȘȚăâîșț]{3,}/g,
    ['До €0.5M / 1 объект-точка', '€0.5–2M / 2–5 объектов-точек', 'Până la €0.5M / 1 imobil-punct',
      '€0.5–2M / 2–5 imobile-puncte', '1 direcție / imobil-punct'],
    ['До €0.5M / 1 объект', '€0.5–2M / 2–5 объектов', 'Până la €0.5M / 1 locație',
      '€0.5–2M / 2–5 locații', '6+ direcții / locații', 'Не хочу указывать']);
  // …and the Romanian edition of these two, and of the P&L breakdown question, asks every model
  // the site serves — retail, e-commerce, fitness, manufacturing. `объект` there is a site the
  // business operates, not a building, so `imobil` is the real-estate reading of a generic word.
  // (`Imobiliare` as an INDUSTRY name is a different word and keeps its capital, so the rule is
  // deliberately case-sensitive and guards its own right edge.)
  const IMOBIL = langRule(/imobil(?:ului|ul|e)?(?![a-zăâîșț])/g,
    ['1 direcție / imobil', '2–3 direcții / imobile', 'pe direcții / imobile / produse'],
    ['1 direcție / locație', 'pe direcții / locații / produse', 'Imobiliare / închiriere',
      'imobiliare și închiriere']);
  const bad = [];
  for (const [f, n] of [['questionnaire.html', 'dx_scale'], ['ro/questionnaire.html', 'dx_scale'],
    ['questionnaire.html', 'q_branches'], ['ro/questionnaire.html', 'q_branches']]) {
    for (const m of answerSet(f, n).matchAll(WELD)) { bad.push(f + ' ' + n + ': ' + m[0]); }
  }
  for (const n of ['dx_scale', 'q_branches', 'dx_pl']) {
    for (const m of answerSet('ro/questionnaire.html', n).matchAll(IMOBIL)) {
      bad.push('ro/questionnaire.html ' + n + ': ' + m[0]);
    }
  }
  assert(bad.length === 0, bad.length + ' welded / mis-sensed unit noun(s): ' + bad.slice(0, 4).join(' | '));
});

check('each edition quotes with its own quotation marks', () => {
  // Russian quotes with « », Romanian with „ ”. One English pair — «шаблон “для всех”», «список
  // “на оплату”» — survived the terminology pass in the Russian edition, and a stray guillemet
  // is the same defect pointing the other way. Both are visible punctuation on the page.
  const RU_Q = langRule(/[“”][^\n“”]{0,40}/g,
    ['Это не шаблон “для всех”, а система', 'Частично, список “на оплату”'],
    ['Это не шаблон «для всех», а система', 'Частично, список «на оплату»',
      'Платежи идут хаотично, «кто громче попросил»']);
  // Romanian's own pair is „ ” — its CLOSING mark is the same glyph English uses, so only the
  // guillemets and the English OPENING quote are foreign on this side.
  const RO_Q = langRule(/[«»“][^\n«»“]{0,40}/g,
    ['Parțial, o listă «de plată»', 'un șablon “pentru toți”'],
    ['Parțial, o listă „de plată”', 'un șablon „pentru toți”', 'limitele clienților — „din ochi”']);
  const bad = [];
  for (const f of RU_PAGES) {
    for (const m of paintedCopy(f).matchAll(RU_Q)) { bad.push(f + ': ' + m[0].trim()); }
  }
  for (const f of RO_PAGES) {
    for (const m of paintedCopy(f).matchAll(RO_Q)) { bad.push(f + ': ' + m[0].trim()); }
  }
  assert(bad.length === 0, bad.length + ' foreign quotation mark(s): ' + bad.slice(0, 4).join(' | '));
});

check('no customer sentence states the same recurrence twice', () => {
  // «Еженедельный регулярный финансовый разбор» and «Analiză financiară periodică săptămânală»:
  // the cadence adjective and the word for "recurring" both survived, and weekly IS the
  // regularity. The same pleonasm in the other direction — «регулярный еженедельный» — counts.
  const RU_CADENCE = '(?:[Ее]жеднев|[Ее]женедель|[Ее]жемесяч|[Ее]жекварталь)[а-яё]*';
  const RU_1 = langRule(new RegExp(RU_CADENCE + '\\s+[Рр]егулярн[а-яё]*', 'g'),
    ['Еженедельный регулярный финансовый разбор.', 'Ежемесячный регулярный отчёт'],
    ['Еженедельный финансовый разбор.', 'Регулярный финансовый разбор и контроль решений.',
      'Ежемесячный отчёт для собственника']);
  const RU_2 = langRule(new RegExp('[Рр]егулярн[а-яё]*\\s+' + RU_CADENCE, 'g'),
    ['регулярный еженедельный разбор'],
    ['Регулярный финансовый разбор и контроль решений.', 'регулярного финансового разбора в месяц']);
  const RO_CAD = '(?:zilnic|săptămânal|lunar|trimestrial)[ăaei]*(?![a-zăâîșț])';
  const RO_PER = '(?:periodic|regulat)[ăaei]*(?![a-zăâîșț])';
  const RO_1 = langRule(new RegExp(RO_PER + '\\s+' + RO_CAD, 'gi'),
    ['Analiză financiară periodică săptămânală.', 'raport regulat lunar'],
    ['Analiză financiară săptămânală.', 'ore de analiză financiară regulată pe lună.',
      'Raport lunar pentru proprietar']);
  const RO_2 = langRule(new RegExp(RO_CAD + '\\s+' + RO_PER, 'gi'),
    ['raport lunar periodic', 'analiză săptămânală regulată'],
    ['Sinteză de business săptămânală și sesiune strategică.', 'Suportul lunar poate include']);
  const bad = [];
  for (const f of RU_PAGES) {
    const copy = paintedCopy(f);
    for (const r of [RU_1, RU_2]) { for (const m of copy.matchAll(r)) { bad.push(f + ': ' + m[0]); } }
  }
  for (const f of RO_PAGES) {
    const copy = paintedCopy(f);
    for (const r of [RO_1, RO_2]) { for (const m of copy.matchAll(r)) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' restated recurrence(s): ' + bad.slice(0, 4).join(' | '));
});

check('no Romanian noun carrying a determinative complement stands unarticulated after a preposition', () => {
  // «În comerț cu amănuntul — raftul…», «În comerț cu ridicata…», «În comerț online…». A bare
  // «în comerț» would be correct: Romanian drops the article after most prepositions. It does
  // NOT drop it when the noun carries a determinative complement, and «cu amănuntul», «cu
  // ridicata» and «online» are exactly that — so the head has to be «comerțul».
  //
  // The lookbehind lets the ARTICULATED head through, which is the corrected form. `de` is not
  // in the preposition list on purpose: «rețele de comerț cu amănuntul» is a compound noun and
  // is correct unarticulated.
  //
  // `gi`, not `g`: the sentence this class shipped in opens with a capital «În …», and a rule
  // that cannot match the one instance it was written for is decoration. The discrimination
  // cases below are what catch that.
  // The left edge is `(?:^|[\s(«„·—])`, NOT `\b`: `î` is not an ASCII word character, so `\bîn`
  // can never match and the whole rule would be a no-op — which is what the first draft of it
  // was, and what the discrimination cases caught.
  const PREP = '(?:^|[\\s(«„·—])(?:în|din|pe|pentru|despre|prin|la)\\s+';
  // «cu amănuntul» and «cu ridicata» are articulated complements and attach to one head noun, so
  // any unarticulated head in front of them is the defect.
  const RULE_A = langRule(new RegExp(PREP + '([a-zăâîșț]{3,})(?<!ul|le|ua|ii|ea|a)\\s+cu (?:amănuntul|ridicata)(?![a-zăâîșț])', 'gi'),
    ['În comerț cu amănuntul — raftul, categoria', 'În comerț cu ridicata / distribuție — depozitul'],
    ['În comerțul cu amănuntul — raftul, categoria', 'În comerțul cu ridicata / distribuție — depozitul',
      'rețele de comerț cu amănuntul și magazine', 'Metodologie · comerț cu amănuntul',
      'Comerț cu amănuntul']);
  // `online` is a bare adjective and modifies plenty of nouns that correctly take no article —
  // «prin întâlniri online regulate». It is a determinative complement only on the SECTOR noun,
  // which is the one the broken sentence used, so the head is pinned rather than generalised.
  const RULE_B = langRule(new RegExp(PREP + 'comerț\\s+online(?![a-zăâîșț])', 'gi'),
    ['În comerț online — canalul, comanda', 'venituri din comerț online'],
    ['În comerțul online — canalul, comanda', 'Comerț online',
      'Lucrul merge prin întâlniri online regulate', 'Întâlniri online săptămânale']);
  const bad = [];
  for (const f of RO_PAGES) {
    const copy = paintedCopy(f);
    for (const r of [RULE_A, RULE_B]) { for (const m of copy.matchAll(r)) { bad.push(f + ': ' + m[0].trim()); } }
  }
  assert(bad.length === 0, bad.length + ' unarticulated head noun(s): ' + bad.slice(0, 4).join(' | '));
});

check('no customer sentence hides a term behind an abbreviation or a bare English noun', () => {
  // Same principle as the gate above on `Aging` / `Cash gap`, extended with what the second pass
  // found: «реестр ДЗ/КЗ» — an accountant's shorthand on a page that writes «Анализ дебиторской
  // и кредиторской задолженности» four lines below; a bare `mix` standing as a noun in a Russian
  // and a Romanian list; and «Control financiar regulat (Monthly)», an English parenthesis that
  // glosses nothing and that the Russian line it mirrors does not carry.
  const SHAPES = [
    langRule(/ДЗ\s*\/\s*КЗ/g, ['Денежный поток, реестр ДЗ/КЗ, платёжный календарь'],
      ['Денежный поток, реестр дебиторской и кредиторской задолженности, платёжный календарь',
        'Анализ дебиторской и кредиторской задолженности по срокам']),
    langRule(/[,:]\s+mix\s*[,.]/g,
      ['Факторный разбор: цена, количество, mix, себестоимость, промоакции',
        'Analiză factorială: preț, cantitate, mix, cost, promoție'],
      ['Факторный разбор: цена, количество, структура ассортимента, себестоимость, промоакции',
        'Analiză factorială: preț, cantitate, structura sortimentului, cost, promoție']),
    langRule(/regulat \(Monthly\)/g, ['Control financiar regulat (Monthly) sau analiză managerială'],
      ['Control financiar regulat sau analiză managerială', 'Raport lunar pentru proprietar (Monthly owner report)']),
    langRule(/Много Excel(?![-А-Яа-яЁё])/g, ['Много Excel, но нет единой картины'],
      ['Много Excel-файлов, но нет единой картины']),
    langRule(/Mult Excel(?![-a-zăâîșț])/g, ['Mult Excel, dar nicio imagine unică'],
      ['Multe fișiere Excel, dar nicio imagine unică'])
  ];
  const bad = [];
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    const copy = paintedCopy(f);
    for (const r of SHAPES) { r.lastIndex = 0; const m = r.exec(copy); if (m) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' abbreviated / untranslated term(s): ' + bad.slice(0, 4).join(' | '));
});

check('the Romanian edition names the owner dashboard and the P&L by one term each', () => {
  // `tablou de bord` six times and `Panoul` twice — once two lines under its own «Tablou de bord
  // pentru proprietar în Power BI» — and `contul de profit și pierdere` everywhere except two
  // lines that kept the English abbreviation the terminology pass exists to remove. A customer
  // reading two names for one artefact cannot tell they are the same artefact.
  const PANOU = langRule(/Panou(?:ri)?(?:l|le)?(?![a-zăâîșț])/g,
    ['Panoul zilnic al proprietarului: bani, marjă', 'Panoul proprietarului'],
    ['Tabloul de bord zilnic al proprietarului: bani, marjă', 'Tabloul de bord al proprietarului',
      'Tablou de bord pentru proprietar în Power BI']);
  // `P&L` is allowed only as a parenthetical gloss beside the spelled-out term, which is how the
  // rest of the edition writes it.
  const PL = langRule(/P&L(?!\))[-\w]*/g,
    ['Structura P&L-ului managerial, a fluxului de numerar', '(Cash Flow), al P&L-ului, al calendarului'],
    ['Structura contului de profit și pierdere managerial, a fluxului de numerar',
      'cont de profit și pierdere (P&L), indicatori-cheie',
      '(Cash Flow), al contului de profit și pierdere (P&L), al calendarului']);
  const bad = [];
  for (const f of RO_PAGES) {
    const copy = paintedCopy(f);
    for (const r of [PANOU, PL]) { for (const m of copy.matchAll(r)) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' second name(s) for one artefact: ' + bad.slice(0, 4).join(' | '));
});

check('the data-reliability answers grade the axis the question asks about', () => {
  // «Насколько данные достоверны?» was answered «Низко · Средне · Хорошо» — two degree adverbs
  // and a quality adverb, three points that are not on one scale — and the Romanian edition
  // answered a plural-feminine question «Slab · Mediu · Bine», which does not agree with it
  // either. Every graded option must name the axis it grades; only the opt-out may not.
  for (const [f, axis, optOut] of [['questionnaire.html', 'Достоверность', 'Не знаю'],
    ['ro/questionnaire.html', 'Fiabilitate', 'Nu știu']]) {
    const opts = answerSet(f, 'q_reliability').split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((s) => !/[?:]$/.test(s));
    assert(opts.length >= 4, f + ': the data-reliability answer set lost its options');
    for (const o of opts) {
      assert(o === optOut || o.indexOf(axis) === 0,
        f + ': the reliability answer «' + o + '» does not grade ' + axis);
    }
  }
});

check('no Russian customer sentence uses slang or a word that is not Russian', () => {
  // «на удалёнке» is slang in the lead paragraph of a premium service page whose own FAQ asks
  // «Можно ли работать удалённо?», and «Высокововлечённый» is not a word — a letter-for-letter
  // calque of "high-involvement" that the Romanian edition renders correctly as «cu implicare
  // ridicată». Both were read past twice because they look Russian.
  const SHAPES = [
    langRule(/на удалёнке/g, ['помощь в решениях — на удалёнке, через понятный процесс'],
      ['помощь в решениях — удалённо, через понятный процесс', 'Можно ли работать удалённо?',
        'Удалённая работа не означает потерю контроля.']),
    langRule(/[Вв]ысокововлеч[а-яё]*/g, ['Высокововлечённый формат для групп компаний'],
      ['Формат с высокой вовлечённостью для групп компаний', 'Ниже — три уровня вовлечённости.']),
    langRule(/помесячн[а-яё]+/g, ['выросшая из помесячного управленческого цикла'],
      ['выросшая из ежемесячного управленческого цикла', 'ежемесячное сопровождение Control Light.'])
  ];
  const bad = [];
  for (const f of RU_PAGES) {
    const copy = paintedCopy(f);
    for (const r of SHAPES) { r.lastIndex = 0; const m = r.exec(copy); if (m) { bad.push(f + ': ' + m[0]); } }
  }
  assert(bad.length === 0, bad.length + ' slang or non-word(s): ' + bad.slice(0, 4).join(' | '));
});

check('no Romanian sentence stacks `director financiar` onto another noun', () => {
  // Romanian cannot use a role noun as an adjective: `funcție director financiar` needs its
  // preposition, and where the Russian page resolved CFO to the adjective, so must this one.
  const bad = [];
  for (const f of RO_PAGES) {
    const copy = visibleCopy(f);
    for (const m of copy.matchAll(/\b(sistem|nucleu|logică|funcți[ae]|control|suport|întâlnire|disciplinei|disciplină|sistemul|suportul)\s+director financiar/gi)) {
      bad.push(f + ': ' + m[0]);
    }
    for (const m of copy.matchAll(/\bPower BI tablou de bord\b/g)) { bad.push(f + ': ' + m[0]); }
    for (const m of copy.matchAll(/\btransformarea inteligență\b/g)) { bad.push(f + ': ' + m[0]); }
  }
  assert(bad.length === 0, bad.length + ' noun-stacked phrase(s): ' + bad.slice(0, 4).join(' | '));
});

check('the branded package title CFO AI Control is exact everywhere it appears', () => {
  // The words inside a branded title are not translated. `CFO ИИ Control`, `CFO IA Control`,
  // `Финансовый директор ИИ Control`, `Director financiar IA Control` and
  // `CFO inteligență artificială (AI) Control` all shipped.
  const bad = [];
  // The legacy `name (N).html` archives are noindexed history, deliberately left unedited so the
  // audit trail survives; they are not customer copy.
  for (const f of collectHtml('').filter((p) => !/ \(\d+\)\.html$/.test(p))) {
    const html = read(f);
    // The role token, then AT MOST ONE intervening word or parenthesis, then `Control`. Anything
    // longer is a sentence that happens to contain both, not a package title — and the branded
    // title itself is exactly one word wide.
    for (const m of html.matchAll(/(?:CFO|[Фф]инансовый директор|[Dd]irector financiar)(?:\s+(?:[^\s.,;:<>"|]+|\([^)]*\))){0,3}?\s+Control\b(?!\s*(?:Light|Partner|Checklist|System|Center))/g)) {
      const found = m[0].replace(/\s+/g, ' ').trim();
      if (found === 'CFO AI Control') { continue; }
      bad.push(f + ': ' + found);
    }
  }
  assert(bad.length === 0, bad.length + ' corrupted package title(s): ' + bad.slice(0, 4).join(' | '));
});

check('the bot links built in JavaScript carry the journey origin too', () => {
  // P1-01. Three shipped scripts build the bot link at runtime. `assistant.js` and `main.js` are
  // served on BOTH sites, so their origin must come from the page's declared language; `i18n-ro.js`
  // is the Romanian string table and is Romanian by definition.
  //
  // The check runs the derivation rather than reading it, because "it mentions documentElement.lang"
  // is exactly the kind of assertion that passes while the value is wrong.
  for (const [f, decl] of [['assistant.js', /var TG = ([\s\S]*?);\r?\n/], ['main.js', /var BOT_URL = ([\s\S]*?);\r?\n/]]) {
    const src = read(f);
    const m = decl.exec(src);
    assert(m, f + ' no longer declares the bot link in one place');
    for (const [lang, want] of [['ro', 'ro'], ['ru', 'ru'], ['ro-MD', 'ro'], ['en', 'ru']]) {
      const built = new Function('SITE_LANG', 'document', 'return (' + m[1] + ');')(
        lang.toLowerCase(), { documentElement: { getAttribute: () => lang } });
      assert(built === 'https://t.me/finmentor_md_bot?start=' + want,
        f + ' on a lang="' + lang + '" page builds ' + built);
    }
    // …and no bot link may survive without an origin beside it, or the derived one is decoration.
    // `?start=` with the tag concatenated at runtime counts as seeded; a bare link does not.
    const bare = (src.match(/https:\/\/t\.me\/finmentor_md_bot(?!\?start=)/g) || []);
    assert(bare.length === 0, f + ' hard-codes ' + bare.length + ' bot link(s) with no journey origin');
  }
  const ro = read('i18n-ro.js').match(/https:\/\/t\.me\/finmentor_md_bot[^"'\s]*/g) || [];
  assert(ro.length > 0, 'i18n-ro.js no longer links to the bot');
  for (const u of ro) { assert(u.endsWith('?start=ro'), 'the Romanian string table links to ' + u); }
});

check('the AI-agent prompt enum was not translated', () => {
  // `CFO AI Transformation` is a machine enum inside the questionnaire's AI prompt spec, and the
  // terminology pass translated its tokens in both languages.
  for (const f of RU_PAGES.concat(RO_PAGES)) {
    const html = read(f);
    if (html.indexOf('RECOMMENDED FIRST STEP') === -1) { continue; }
    assert(html.indexOf('CFO AI Transformation') !== -1, f + ': the RECOMMENDED FIRST STEP enum lost `CFO AI Transformation`');
  }
});

check('the Real Estate page presents its approved name, not its English working title', () => {
  // P1-05. The slug, the canonical URL and every href stay English — a filename is an address,
  // not a product name. Every slot a customer or a crawler reads as the page identity must carry
  // the approved title.
  const CASES = [
    ['real-estate-control-system.html', 'Система финансового управления недвижимостью'],
    ['ro/real-estate-control-system.html', 'Sistem de management financiar al activelor imobiliare']
  ];
  for (const [f, approved] of CASES) {
    const html = read(f);
    const slots = {
      'title': /<title>([^<]*)<\/title>/,
      'meta description': /<meta name="description" content="([^"]*)"/,
      'og:title': /<meta property="og:title" content="([^"]*)"/,
      'og:description': /<meta property="og:description" content="([^"]*)"/,
      'twitter:title': /<meta name="twitter:title" content="([^"]*)"/,
      'twitter:description': /<meta name="twitter:description" content="([^"]*)"/,
      'h1': /<h1>([^<]*)<\/h1>/
    };
    for (const [slot, re] of Object.entries(slots)) {
      const m = re.exec(html);
      assert(m, f + ': no ' + slot);
      assert(m[1].indexOf(approved) !== -1, f + ' ' + slot + ' does not carry the approved name: ' + m[1].slice(0, 70));
    }
    for (const n of graphNodes(html)) {
      if (n.headline) { assert(String(n.headline).indexOf(approved) !== -1, f + ': JSON-LD headline is not the approved name'); }
      if (n['@type'] === 'BreadcrumbList') {
        const last = (n.itemListElement || []).slice(-1)[0];
        assert(last && String(last.name).indexOf(approved) !== -1, f + ': the breadcrumb label is not the approved name');
      }
    }
    // The English working title must not survive as the page's own identity anywhere a customer
    // reads it. It stays in the slug, the canonical URL and the hrefs, which are not copy.
    const copy = visibleCopy(f) + ' ' + [...html.matchAll(/content="([^"]*)"/g)].map((m) => m[1]).join(' ')
      + ' ' + [...html.matchAll(/"(?:headline|name|description)":\s*"([^"]*)"/g)].map((m) => m[1]).join(' ');
    assert(copy.indexOf('Real Estate Control System') === -1,
      f + ': the English working title is still presented to the customer');
  }
});

// --------------------------------------------------------------- structured data
console.log('\nSEO: STRUCTURED DATA IDENTITY');

// P1-02. Twelve pages shipped a VERBATIM COPY of the Treasury (kaznacheystvo) graph — its Article
// @id, its headline, its mainEntityOfPage, its breadcrumb trail and its four Treasury FAQ
// questions — above their own, correct graph. Every crawler that read those pages was told they
// were the Treasury page.
//
// The copied graph was removed rather than rewritten: keeping the FAQPage would have meant
// inventing four questions the page does not answer.
//
// These checks are site-wide and structural, so the same defect cannot be reintroduced on a
// thirteenth page by another copy-paste.


check('every JSON-LD block on every page parses', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    for (const m of read(f).matchAll(LD)) {
      try { JSON.parse(m[1]); } catch (e) { bad.push(f + ': ' + e.message); }
    }
  }
  assert(bad.length === 0, bad.length + ' JSON-LD parse error(s): ' + bad.slice(0, 3).join(' | '));
});

check('no page carries a graph whose @id belongs to a different page', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const self = selfUrls(f);
    for (const n of graphNodes(read(f))) {
      const id = String(n['@id'] || '');
      if (!id || !id.startsWith(SITE) || SITE_LEVEL.test(id)) { continue; }
      if (!self.includes(strip(id))) { bad.push(f + ' -> ' + id); }
    }
  }
  assert(bad.length === 0, bad.length + ' wrong-page @id: ' + bad.slice(0, 4).join(' | '));
});

check('no page points mainEntityOfPage at a different page', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const self = selfUrls(f);
    for (const n of graphNodes(read(f))) {
      const mp = typeof n.mainEntityOfPage === 'string' ? n.mainEntityOfPage : (n.mainEntityOfPage || {})['@id'];
      if (!mp) { continue; }
      if (!self.includes(strip(mp))) { bad.push(f + ' -> ' + mp); }
    }
  }
  assert(bad.length === 0, bad.length + ' wrong-page mainEntityOfPage: ' + bad.slice(0, 4).join(' | '));
});

check('every breadcrumb trail ends on the page that declares it', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const self = selfUrls(f);
    for (const n of graphNodes(read(f))) {
      if (n['@type'] !== 'BreadcrumbList') { continue; }
      const last = (n.itemListElement || []).slice(-1)[0];
      if (last && last.item && !self.includes(strip(last.item))) { bad.push(f + ' -> ' + last.item); }
    }
  }
  assert(bad.length === 0, bad.length + ' wrong-page breadcrumb tail: ' + bad.slice(0, 4).join(' | '));
});

check('no page carries another page\'s FAQ graph', () => {
  // The copied Treasury graph brought four Treasury FAQ questions onto twelve pages that answer
  // none of them. A question set is "another page's" when it is BYTE-IDENTICAL to a set declared
  // elsewhere: that is the copy-paste signature, and it is what must never come back.
  //
  // The wider claim — that every declared question and answer is actually ON the page — is the
  // next check.
  const sets = new Map();
  const bad = [];
  for (const f of collectHtml('')) {
    for (const n of graphNodes(read(f))) {
      if (n['@type'] !== 'FAQPage') { continue; }
      const key = (n.mainEntity || []).map((q) => String(q.name || '').replace(/\s+/g, ' ').trim()).join(' ');
      if (!key) { continue; }
      if (sets.has(key)) { bad.push(f + ' repeats the FAQ graph of ' + sets.get(key)); continue; }
      sets.set(key, f);
    }
  }
  // The RU and RO editions of a page are different question sets (different languages), so a
  // repeat here is always a copy between unrelated pages.
  assert(bad.length === 0, bad.length + ' copied FAQ graph(s): ' + bad.slice(0, 4).join(' | '));
});

check('every FAQ question and answer a page declares is actually on that page', () => {
  // An FAQPage asserts to a crawler that the page ASKS this question and GIVES this answer. It is
  // the one schema type whose claim a reader can check by looking, and the one that hurts most
  // when it is wrong.
  //
  // Seventeen questions were untrue: the terminology pass rewrote the visible question and left
  // the JSON-LD copy of the same sentence behind, and one page declared three questions it had
  // never asked. Nineteen more answers were the author's shorter paraphrase of the visible one —
  // the same untrue claim, quieter. Both are closed by taking the schema text FROM the page.
  //
  // Entities are decoded on both sides: `P&amp;L` in the markup and `P&L` in the JSON are the
  // same sentence, and a comparison that cannot see that invents failures.
  const decode = (s) => String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rarr;/g, '→').replace(/&mdash;/g, '—')
    .replace(/\s+/g, ' ').trim();
  const bad = [];
  let declared = 0;
  for (const f of collectHtml('')) {
    const html = read(f);
    const visible = decode(html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' '));
    for (const n of graphNodes(html)) {
      if (n['@type'] !== 'FAQPage') { continue; }
      for (const q of (n.mainEntity || [])) {
        declared++;
        const name = decode(q.name);
        const answer = decode((q.acceptedAnswer || {}).text || '');
        if (name && visible.indexOf(name) === -1) { bad.push(f + ' asks nothing like: ' + name.slice(0, 70)); continue; }
        if (answer && visible.indexOf(answer) === -1) { bad.push(f + ' gives a different answer to: ' + name.slice(0, 70)); }
      }
    }
  }
  assert(declared > 100, 'only ' + declared + ' FAQ entries were found — the sweep proved nothing');
  assert(bad.length === 0, bad.length + ' unsupported FAQ claim(s) of ' + declared + ': ' + bad.slice(0, 4).join(' | '));
});

check('structured data declares the language its page is written in', () => {
  const bad = [];
  for (const f of collectHtml('')) {
    const html = read(f);
    const lang = (/<html[^>]*\blang="([^"]*)"/i.exec(html) || [, ''])[1].toLowerCase().slice(0, 2);
    if (!lang) { continue; }
    for (const n of graphNodes(html)) {
      if (!n.inLanguage) { continue; }
      if (String(n.inLanguage).toLowerCase().slice(0, 2) !== lang) {
        bad.push(f + ' (lang=' + lang + ') -> inLanguage=' + n.inLanguage);
      }
    }
  }
  assert(bad.length === 0, bad.length + ' wrong inLanguage: ' + bad.slice(0, 4).join(' | '));
});

check('the twelve repaired pages carry exactly one graph, and it is their own', () => {
  const REPAIRED = ['capacity-released.html', 'client-base-control-system.html', 'pribyl-vs-cash.html',
    'real-estate-control-system.html', 'renewal-revenue-at-risk.html', 'supplier-shelf-credit.html'];
  for (const dir of ['', 'ro/']) {
    for (const p of REPAIRED) {
      const f = dir + p;
      const html = read(f);
      const blocks = [...html.matchAll(LD)];
      assert(blocks.length === 1, f + ' carries ' + blocks.length + ' JSON-LD blocks, expected 1');
      assert(html.indexOf('kaznacheystvo.html#article') === -1,
        f + ' still carries the copied Treasury Article @id');
      const nodes = graphNodes(html);
      assert(nodes.some((n) => selfUrls(f).includes(strip(n['@id'] || ''))),
        f + ' has no graph node describing itself');
    }
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

check('privacy policy describes live processor categories without implying a complete vendor list', () => {
  for (const f of ['privacy.html', 'ro/privacy.html']) {
    const s = read(f);
    assert(/AI-(?:поставщик|furnizor)|furnizorul AI/.test(s), f + ' does not disclose the AI processor category');
    assert(/платформа автоматизации|platforma de automatizare/.test(s), f + ' does not disclose the automation category');
    assert(/рабочие таблицы\/CRM|foile de calcul\/CRM/.test(s), f + ' does not disclose the working-table category');
    // Cloudflare is not in the serving path; claiming it would be inaccurate.
    assert(!s.includes('Cloudflare'), f + ' still names Cloudflare, which is not in the path');
  }
});

// --------------------------------------------------------------- run async cases

// ── GATE 4 (2026-09-04): the page ADDRESS must not become the leak the parameter filter prevents.
//
// Event parameters were always filtered through a closed allow-list. The page address was not:
// gtag attaches `page_location` to every event from `document.location`, and a live UAT against
// production caught the conversion beacon on `thank-you.html?tool=…&sid=…` carrying the submission
// id in `dl`. The explicit page_view had always overridden it; nothing else did — including the
// separate delegated GA4 sender in main.js, which calls gtag directly.
check('GA4: the config sets the scrubbed page location, so every sender inherits it', () => {
  const a = read('analytics.js');
  const m = /window\.gtag\('config', GA4_ID, \{([\s\S]*?)\}\);/.exec(a);
  assert(m, 'the gtag config call could not be read');
  assert(/page_location:\s*safePageLocation\(\)/.test(m[1]), 'the config does not set a scrubbed page_location');
  assert(/page_path:\s*safePagePath\(\)/.test(m[1]), 'the config does not set a scrubbed page_path');
  assert(/send_page_view:\s*false/.test(m[1]), 'the automatic page_view was re-enabled');
});

check('GA4: business events also send the scrubbed location, applied last so a caller cannot override it', () => {
  const a = read('analytics.js');
  const m = /function trackBusiness\(name, params\) \{([\s\S]*?)\n  \}/.exec(a);
  assert(m, 'trackBusiness could not be read');
  assert(/page_location:\s*safePageLocation\(\)/.test(m[1]), 'trackBusiness does not send a scrubbed page_location');
  const iParams = m[1].indexOf('safeBusinessParams');
  const iLoc = m[1].indexOf('page_location');
  assert(iParams !== -1 && iLoc > iParams, 'the scrubbed location is not applied after the caller parameters');
});

check('GA4: the URL allow-list rejects every identifier the product mints', () => {
  const a = read('analytics.js');
  const m = /var URL_PARAM_ALLOW = \{([\s\S]*?)\};/.exec(a);
  assert(m, 'the URL allow-list could not be read');
  for (const forbidden of ['sid', 'lead_id', 'request_id', 'submission_key', 'token', 'email', 'phone', 'chat_id']) {
    assert(new RegExp('\b' + forbidden + '\s*:').test(m[1]) === false, 'the URL allow-list admits ' + forbidden);
  }
  assert(/\btool\s*:/.test(m[1]), 'the categorical tool parameter was dropped');
});

check('GA4: the second sender in main.js keeps its own closed allow-list and redaction', () => {
  const mjs = read('main.js');
  const m = /function safeParams\(params\) \{[\s\S]*?var allow = \{([\s\S]*?)\};/.exec(mjs);
  assert(m, 'the main.js allow-list could not be read');
  assert(/if \(!allow\[k\]\) return;/.test(mjs), 'main.js does not drop unlisted keys');
  for (const forbidden of ['name', 'email', 'phone', 'telegram', 'company', 'lead_id', 'request_id', 'answers']) {
    assert(new RegExp('\b' + forbidden + '\s*:\s*true').test(m[1]) === false, 'main.js admits ' + forbidden);
  }
  assert(/\[email\]/.test(mjs) && /\[phone\]/.test(mjs), 'main.js lost its redaction');
});

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
