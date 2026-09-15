#!/usr/bin/env node
// FINMENTOR C1 post-deploy public-surface smoke. Read-only except for n8n execution logs:
// invalid endpoint requests are rejected before any ledger/session/business write.

const URLS = {
  host: 'https://ghennadi.app.n8n.cloud/webhook/finmentor-premium-miniapp',
  gateway: 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-gateway',
  session: 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-session',
  submit: 'https://ghennadi.app.n8n.cloud/webhook/finmentor-miniapp-submit'
};

let passed = 0;
const failures = [];
function check(name, value, detail) {
  if (value) { passed++; console.log('PASS ' + name); }
  else { failures.push(name + (detail ? ': ' + detail : '')); console.log('FAIL ' + name); }
}

const hostResponse = await fetch(URLS.host, { signal: AbortSignal.timeout(30000) });
const html = await hostResponse.text();
check('Mini App host returns 200', hostResponse.status === 200, 'status ' + hostResponse.status);
check('host serves the company-name screen', html.includes('Как называется компания?'));
check('host serves the separate business-activity screen', html.includes('Чем занимается компания?'));
check('host serves approved diagnosis terminology', html.includes('Финансовая диагностика'));
check('host contains no retired Financial X-Ray term', !html.includes('Финансовый рентген'));
check('host has all three production API endpoints',
  html.includes(URLS.gateway) && html.includes(URLS.session) && html.includes(URLS.submit));
check('host has no unresolved production URL placeholder', !/__PREMIUM_[A-Z_]+__/.test(html));

for (const name of ['gateway', 'session', 'submit']) {
  const response = await fetch(URLS[name], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch (error) { body = null; }
  check(name + ' rejects an unsigned/empty request', response.status >= 400 && response.status < 500,
    'status ' + response.status + ', body ' + text.slice(0, 200));
  check(name + ' rejection creates no success/session/lead claim',
    !body || (body.ok !== true && !body.app_session_id && !body.lead_id), text.slice(0, 200));
}

console.log('\nC1 PRODUCTION SMOKE: ' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  for (const failure of failures) console.log('  - ' + failure);
  process.exit(1);
}
