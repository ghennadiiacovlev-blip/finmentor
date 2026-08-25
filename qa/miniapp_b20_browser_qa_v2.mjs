import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.MINIAPP_URL || 'http://127.0.0.1:8000/app/';
const outDir = process.env.QA_ARTIFACT_DIR || 'qa-artifacts';
fs.mkdirSync(outDir, { recursive: true });

const report = { generated_at:new Date().toISOString(), base, console_errors:[], page_errors:[], external_requests:[], forbidden_requests:[], checks:{} };
const assert = (ok,msg) => { if(!ok) throw new Error(msg); };
const forbidden = u => /ghennadi\.app\.n8n\.cloud|sheets\.googleapis\.com|api\.telegram\.org|\/webhook\//i.test(u);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function prep(page){
  page.on('console',m=>{ if(m.type()==='error'&&!/Failed to load resource/i.test(m.text())) report.console_errors.push(m.text()); });
  page.on('pageerror',e=>report.page_errors.push(String(e)));
  page.on('request',r=>{ const u=r.url(); if(!u.startsWith('http://127.0.0.1:8000/')){ report.external_requests.push(u); if(forbidden(u)) report.forbidden_requests.push(u); } });
  await page.route('https://telegram.org/js/telegram-web-app.js',route=>route.fulfill({status:200,contentType:'application/javascript',body:'window.Telegram=window.Telegram||{};window.Telegram.WebApp=window.Telegram.WebApp||{ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){}};'}));
}

async function noOverflow(page,label){
  const x=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth}));
  assert(x.sw<=x.iw+1,`${label}: horizontal overflow ${x.sw}>${x.iw}`);
}

async function coreTargets(page,label){
  const bad=await page.evaluate(()=>[...document.querySelectorAll('.btn:not([disabled]),.choice,.segmented button,.mini-action')].filter(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&(r.width<44||r.height<44)}).map(el=>({text:(el.textContent||'').trim().slice(0,60),w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
  assert(!bad.length,`${label}: core tap target below 44px ${JSON.stringify(bad)}`);
}

async function choose(page,field,value){ await page.locator(`[data-field="${field}"] [data-value="${value}"]`).click(); }
async function settle(){ await sleep(350); }

async function outside(browser){
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),page=await ctx.newPage(); await prep(page); await page.goto(base,{waitUntil:'domcontentloaded'}); await page.waitForSelector('[data-action="start"]');
  assert((await page.locator('#secureChipText').textContent()).trim()==='Preview','outside Telegram must show Preview');
  await noOverflow(page,'entry390'); await coreTargets(page,'entry390');
  await page.keyboard.press('Tab'); const focus=await page.evaluate(()=>{const s=getComputedStyle(document.activeElement);return {tag:document.activeElement.tagName,outline:s.outlineStyle,width:s.outlineWidth}}); assert(focus.outline!=='none'&&focus.width!=='0px','focus-visible missing'); report.checks.focus_visible=focus;
  await settle(); await page.screenshot({path:path.join(outDir,'b20-entry-390.png'),fullPage:true});

  await page.locator('[data-action="start"]').click(); await choose(page,'sector','retail'); await choose(page,'turnover','lt100k'); await page.locator('[data-action="next"]').click();
  await choose(page,'cash','unclear'); await choose(page,'profit','partial'); await choose(page,'treasury','unclear'); await choose(page,'kpi','partial'); await page.locator('[data-action="next"]').click();
  await choose(page,'pain','reporting'); await choose(page,'urgency','none'); await page.locator('#contextText').fill('QA: нет срочности.'); await page.locator('[data-action="preview"]').click();
  const preview=await page.locator('main').innerText(); assert(preview.includes('срочности нет — это не повышает приоритет заявки'),'urgency=none became urgent'); report.checks.urgency_none_nonurgent=true;
  await settle(); await noOverflow(page,'preview390'); await coreTargets(page,'preview390'); await page.screenshot({path:path.join(outDir,'b20-preview-390.png'),fullPage:true});

  await page.locator('#backBtn').click(); assert(await page.locator('[data-field="urgency"] [data-value="none"]').getAttribute('aria-pressed')==='true','back navigation lost state'); report.checks.back_state_retained=true; await page.locator('[data-action="preview"]').click();
  await page.locator('[data-action="contact"]').click(); await page.locator('#contactName').fill('QA User'); await page.locator('#contactCompany').fill('QA Company'); assert(await page.locator('[data-action="consent"]').isDisabled(),'outside Telegram must require direct contact'); await page.locator('#contactDirect').fill('qa@example.com'); assert(!(await page.locator('[data-action="consent"]').isDisabled()),'direct contact did not unlock consent'); report.checks.outside_telegram_contact_required=true;
  await page.locator('[data-action="consent"]').click(); await settle(); await noOverflow(page,'consent390'); await coreTargets(page,'consent390'); await page.screenshot({path:path.join(outDir,'b20-consent-390.png'),fullPage:true});
  await page.locator('[data-action="submit-no"]').click(); await settle(); const declined=await page.locator('main').innerText(); const orb=(await page.locator('.success-orb').textContent()).trim();
  report.checks.decline_text=declined; report.checks.decline_orb=orb; assert(declined.includes('Ничего не передано'),'decline title missing'); assert(orb!=='✓','decline still uses success checkmark'); report.checks.decline_is_no_submit=true; await page.screenshot({path:path.join(outDir,'b20-declined-390.png'),fullPage:true});
  await ctx.close();
}

async function telegram(browser){
  const ctx=await browser.newContext({viewport:{width:430,height:932}}); await ctx.addInitScript(()=>{window.Telegram={WebApp:{initData:'qa-placeholder',initDataUnsafe:{user:{id:551662084,first_name:'QA Telegram'}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},openLink(){},close(){}}};});
  const page=await ctx.newPage(); await prep(page); await page.goto(base,{waitUntil:'domcontentloaded'}); await page.waitForSelector('[data-action="start"]'); assert((await page.locator('#secureChipText').textContent()).trim()==='Telegram','Telegram context not detected'); await settle(); await noOverflow(page,'entry430'); await coreTargets(page,'entry430'); await page.screenshot({path:path.join(outDir,'b20-entry-430.png'),fullPage:true});
  await page.locator('[data-action="start"]').click(); await choose(page,'sector','services'); await choose(page,'turnover','100k_500k'); await page.locator('[data-action="next"]').click(); for(const f of ['cash','profit','treasury','kpi']) await choose(page,f,'partial'); await page.locator('[data-action="next"]').click(); await choose(page,'pain','control'); await choose(page,'urgency','month'); await page.locator('[data-action="preview"]').click(); await page.locator('[data-action="contact"]').click();
  assert(await page.locator('#contactName').inputValue()==='QA Telegram','Telegram name prefill missing'); await page.locator('#contactCompany').fill('Telegram QA Co'); assert(!(await page.locator('[data-action="consent"]').isDisabled()),'Telegram should allow direct contact optional'); report.checks.telegram_contact_optional=true; await page.locator('[data-action="consent"]').click(); assert((await page.locator('#consentText').innerText()).includes('Telegram-контекст'),'consent must name Telegram context'); await page.locator('[data-action="submit-yes"]').click(); await settle(); assert((await page.locator('main').innerText()).includes('Прототип: запрос готов к передаче'),'YES handoff state missing'); report.checks.explicit_yes_path=true; await page.screenshot({path:path.join(outDir,'b20-submitted-430.png'),fullPage:true}); await ctx.close();
}

const browser=await chromium.launch({headless:true});
try{await outside(browser);await telegram(browser);}finally{await browser.close();}
report.external_requests=[...new Set(report.external_requests)]; report.forbidden_requests=[...new Set(report.forbidden_requests)]; report.checks.no_forbidden_network=!report.forbidden_requests.length; report.checks.no_console_errors=!report.console_errors.length&&!report.page_errors.length;
assert(!report.forbidden_requests.length,`forbidden requests ${report.forbidden_requests.join(',')}`); assert(!report.console_errors.length,`console errors ${report.console_errors.join('|')}`); assert(!report.page_errors.length,`page errors ${report.page_errors.join('|')}`);
fs.writeFileSync(path.join(outDir,'b20-browser-qa.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
