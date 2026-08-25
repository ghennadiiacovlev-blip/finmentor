import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.MINIAPP_URL || 'http://127.0.0.1:8000/app/';
const outDir = process.env.QA_ARTIFACT_DIR || 'qa-artifacts';
fs.mkdirSync(outDir, { recursive: true });

const report = {
  base,
  generated_at: new Date().toISOString(),
  viewports: {},
  console_errors: [],
  page_errors: [],
  external_requests: [],
  forbidden_requests: [],
  tap_target_warnings: [],
  checks: {}
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isForbiddenUrl(url) {
  return /ghennadi\.app\.n8n\.cloud|sheets\.googleapis\.com|api\.telegram\.org|\/webhook\//i.test(url);
}

async function configurePage(page) {
  page.on('console', msg => {
    if (msg.type() === 'error' && !/Failed to load resource/i.test(msg.text())) {
      report.console_errors.push(msg.text());
    }
  });
  page.on('pageerror', err => report.page_errors.push(String(err)));
  page.on('request', req => {
    const url = req.url();
    if (!url.startsWith('http://127.0.0.1:8000/')) {
      report.external_requests.push(url);
      if (isForbiddenUrl(url)) report.forbidden_requests.push(url);
    }
  });
  await page.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.Telegram=window.Telegram||{};window.Telegram.WebApp=window.Telegram.WebApp||{ready:function(){},expand:function(){},setHeaderColor:function(){},setBackgroundColor:function(){}};'
  }));
}

async function assertNoOverflow(page, label) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth
  }));
  assert(dims.scrollWidth <= dims.innerWidth + 1, `${label}: horizontal overflow ${dims.scrollWidth} > ${dims.innerWidth}`);
}

async function auditCoreTapTargets(page, label) {
  const bad = await page.evaluate(() => {
    const selector = '.btn:not([disabled]), .choice, .segmented button, .mini-action';
    return [...document.querySelectorAll(selector)].filter(el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44);
    }).map(el => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, cls: el.className, text: (el.textContent || '').trim().slice(0, 80), width: r.width, height: r.height };
    });
  });
  if (bad.length) report.tap_target_warnings.push({ label, items: bad });
  assert(bad.length === 0, `${label}: core tap target below 44px`);
}

async function auditFocusVisible(page) {
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { tag: el?.tagName || '', id: el?.id || '', cls: el?.className || '', outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  });
  report.checks.focus_visible = focus;
  assert(focus.outlineStyle !== 'none' && focus.outlineWidth !== '0px', 'focus-visible outline missing');
}

async function clickChoice(page, field, value) {
  await page.locator(`[data-field="${field}"] [data-value="${value}"]`).click();
}

async function runOutsideTelegram(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await configurePage(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-action="start"]');
  assert((await page.locator('#secureChipText').textContent()).trim() === 'Preview', 'outside-Telegram chip should say Preview');
  await assertNoOverflow(page, 'entry-390');
  await auditCoreTapTargets(page, 'entry-390');
  await auditFocusVisible(page);
  await page.screenshot({ path: path.join(outDir, 'b20-entry-390.png'), fullPage: true });

  await page.locator('[data-action="start"]').click();
  await clickChoice(page, 'sector', 'retail');
  await clickChoice(page, 'turnover', 'lt100k');
  await page.locator('[data-action="next"]').click();
  await clickChoice(page, 'cash', 'unclear');
  await clickChoice(page, 'profit', 'partial');
  await clickChoice(page, 'treasury', 'unclear');
  await clickChoice(page, 'kpi', 'partial');
  await page.locator('[data-action="next"]').click();
  await clickChoice(page, 'pain', 'reporting');
  await clickChoice(page, 'urgency', 'none');
  await page.locator('#contextText').fill('QA: нет срочности, нужен понятный финансовый контур.');
  await page.locator('[data-action="preview"]').click();

  const previewText = await page.locator('main').innerText();
  assert(previewText.includes('срочности нет — это не повышает приоритет заявки'), 'urgency=none regression: non-urgent explanation missing');
  report.checks.urgency_none_nonurgent = true;
  await assertNoOverflow(page, 'preview-390');
  await auditCoreTapTargets(page, 'preview-390');
  await page.screenshot({ path: path.join(outDir, 'b20-preview-390.png'), fullPage: true });

  // Back-navigation must retain selected state.
  await page.locator('#backBtn').click();
  assert(await page.locator('[data-field="urgency"] [data-value="none"]').getAttribute('aria-pressed') === 'true', 'back navigation lost urgency selection');
  await page.locator('[data-action="preview"]').click();

  await page.locator('[data-action="contact"]').click();
  await page.locator('#contactName').fill('QA User');
  await page.locator('#contactCompany').fill('QA Company');
  assert(await page.locator('[data-action="consent"]').isDisabled(), 'outside Telegram contact should require phone/email');
  await page.locator('#contactDirect').fill('qa@example.com');
  assert(!(await page.locator('[data-action="consent"]').isDisabled()), 'outside Telegram contact did not unlock with direct contact');
  report.checks.outside_telegram_contact_required = true;
  await page.locator('[data-action="consent"]').click();
  await assertNoOverflow(page, 'consent-390');
  await auditCoreTapTargets(page, 'consent-390');
  await page.screenshot({ path: path.join(outDir, 'b20-consent-390.png'), fullPage: true });

  await page.locator('[data-action="submit-no"]').click();
  const declined = await page.locator('main').innerText();
  assert(declined.includes('Ничего не передано'), 'decline state title missing');
  assert(declined.includes('Передача не выполнена'), 'decline state kicker is not neutral');
  report.checks.decline_is_no_submit = true;

  await context.close();
}

async function runTelegram(browser) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.Telegram = { WebApp: {
      initData: 'qa-signed-placeholder-not-used-for-write',
      initDataUnsafe: { user: { id: 551662084, first_name: 'QA Telegram' } },
      ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){}, openLink(){}, close(){}
    }};
  });
  const page = await context.newPage();
  await configurePage(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-action="start"]');
  assert((await page.locator('#secureChipText').textContent()).trim() === 'Telegram', 'Telegram chip not detected');
  await assertNoOverflow(page, 'entry-430');
  await auditCoreTapTargets(page, 'entry-430');
  await page.screenshot({ path: path.join(outDir, 'b20-entry-430.png'), fullPage: true });

  await page.locator('[data-action="start"]').click();
  await clickChoice(page, 'sector', 'services');
  await clickChoice(page, 'turnover', '100k_500k');
  await page.locator('[data-action="next"]').click();
  for (const field of ['cash','profit','treasury','kpi']) await clickChoice(page, field, 'partial');
  await page.locator('[data-action="next"]').click();
  await clickChoice(page, 'pain', 'control');
  await clickChoice(page, 'urgency', 'month');
  await page.locator('[data-action="preview"]').click();
  await page.locator('[data-action="contact"]').click();
  assert((await page.locator('#contactName').inputValue()) === 'QA Telegram', 'Telegram first_name prefill missing');
  await page.locator('#contactCompany').fill('Telegram QA Co');
  assert(!(await page.locator('[data-action="consent"]').isDisabled()), 'Telegram context should allow direct contact to remain optional');
  report.checks.telegram_contact_optional = true;
  await page.locator('[data-action="consent"]').click();
  const consentText = await page.locator('#consentText').innerText();
  assert(consentText.includes('Telegram-контекст'), 'Telegram consent copy must name Telegram context');
  await page.locator('[data-action="submit-yes"]').click();
  const submitted = await page.locator('main').innerText();
  assert(submitted.includes('Прототип: запрос готов к передаче'), 'YES mock handoff state missing');
  report.checks.explicit_yes_path = true;

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await runOutsideTelegram(browser);
    await runTelegram(browser);
  } finally {
    await browser.close();
  }

  const uniqueExternal = [...new Set(report.external_requests)];
  report.external_requests = uniqueExternal;
  report.forbidden_requests = [...new Set(report.forbidden_requests)];
  report.checks.no_forbidden_network = report.forbidden_requests.length === 0;
  report.checks.no_console_errors = report.console_errors.length === 0 && report.page_errors.length === 0;

  assert(report.forbidden_requests.length === 0, `forbidden network requests: ${report.forbidden_requests.join(', ')}`);
  assert(report.console_errors.length === 0, `console errors: ${report.console_errors.join(' | ')}`);
  assert(report.page_errors.length === 0, `page errors: ${report.page_errors.join(' | ')}`);

  fs.writeFileSync(path.join(outDir, 'b20-browser-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch(err => {
  report.failure = String(err && err.stack ? err.stack : err);
  fs.writeFileSync(path.join(outDir, 'b20-browser-qa.json'), JSON.stringify(report, null, 2));
  console.error(report.failure);
  process.exit(1);
});
