const puppeteer = require(process.cwd() + '/node_modules/puppeteer-core');

const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);

  await page.goto('http://127.0.0.1:8765/?debug_ga4=1', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  const denied = await page.evaluate(() => window.FMAnalytics.enrichLeadPayload({meta:{marker:'deny'}}, 100));
  assert(denied.meta.analytics_consent === false, 'Denied consent must remain false');
  assert(!('ga_client_id' in denied.meta), 'Denied consent leaked ga_client_id');
  assert(!('ga_session_id' in denied.meta), 'Denied consent leaked ga_session_id');
  console.log('DENIED_CONTEXT_PASS');

  await page.evaluate(() => localStorage.setItem('finmentor_cookie_consent', 'accept'));
  await page.reload({waitUntil: 'networkidle2', timeout: 60000});
  await new Promise(r => setTimeout(r, 2500));

  const accepted = await page.evaluate(() => window.FMAnalytics.enrichLeadPayload({meta:{marker:'accept'}}, 3500));
  assert(accepted.meta.analytics_consent === true, 'Accepted consent must remain true');
  assert(typeof accepted.meta.ga_client_id === 'string' && accepted.meta.ga_client_id.length > 3, 'Accepted context missing ga_client_id');
  console.log('ACCEPTED_CONTEXT_PASS', JSON.stringify({
    client_id_present: !!accepted.meta.ga_client_id,
    session_id_present: !!accepted.meta.ga_session_id
  }));

  await browser.close();
})().catch(err => {
  console.error('BROWSER_QA_FAIL', err && err.stack ? err.stack : err);
  process.exit(1);
});
