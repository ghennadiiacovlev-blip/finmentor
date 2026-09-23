#!/usr/bin/env node
// Final production audit: browser accessibility-tree and touch-target sweep for all indexed pages.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const routes=[...readFileSync(join(ROOT,'sitemap.xml'),'utf8').matchAll(/<loc>https:\/\/www\.finmentor\.md\/([^<]*)<\/loc>/g)].map(m=>'/'+(m[1]||'index.html')).map(p=>p.endsWith('/')?p+'index.html':p);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif'};
function serve(){return createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);const rel=pathname==='/'?'index.html':pathname.replace(/^\/+/, '');const file=normalize(join(ROOT,rel));if(!file.startsWith(normalize(ROOT))||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'content-type':mime[extname(file).toLowerCase()]||'application/octet-stream'});createReadStream(file).pipe(res);});}
class CDP{constructor(url){this.url=url;this.id=0;this.waiters=new Map();this.events=new Map();}async open(){this.ws=new WebSocket(this.url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('ws timeout')),5000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const w=this.waiters.get(m.id);if(!w)return;this.waiters.delete(m.id);m.error?w.reject(new Error(m.error.message)):w.resolve(m.result||{});return;}for(const fn of this.events.get(m.method)||[])fn(m.params||{});});}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.waiters.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}on(method,fn){if(!this.events.has(method))this.events.set(method,[]);this.events.get(method).push(fn);}once(method,timeout=12000){return new Promise((resolve,reject)=>{const fn=p=>{clearTimeout(t);this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));resolve(p);};const t=setTimeout(()=>{this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));reject(new Error(method+' timeout'));},timeout);this.on(method,fn);});}close(){try{this.ws.close();}catch{}}}
async function target(port){for(let i=0;i<80;i++){try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const p=list.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl;}catch{}await sleep(100);}throw new Error('target missing');}

async function main(){
  const server=serve();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;const debugPort=9339;const profile=mkdtempSync(join(tmpdir(),'finmentor-a11y-'));
  const proc=spawn(CHROME,['--headless=new',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-extensions','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});let cdp;
  try{
    cdp=new CDP(await target(debugPort));await cdp.open();await Promise.all([cdp.send('Page.enable'),cdp.send('Runtime.enable'),cdp.send('Accessibility.enable')]);
    const defects=[];const scrollRegions=[];let axControls=0,touchControls=0;
    const interactiveRoles=new Set(['button','link','textbox','searchbox','checkbox','radio','combobox','slider','spinbutton','switch','menuitem','tab','DisclosureTriangle']);
    async function evaluate(expression){const o=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(o.exceptionDetails)throw new Error(o.exceptionDetails.text);return o.result?.value;}
    async function navigate(route){const loaded=cdp.once('Page.loadEventFired');await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`});await loaded;await sleep(20);}
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    for(const route of routes){
      await navigate(route);
      const tree=(await cdp.send('Accessibility.getFullAXTree')).nodes||[];
      const live=tree.filter(n=>!n.ignored);
      const empty=live.filter(n=>interactiveRoles.has(n.role?.value)&&!(n.name?.value||'').trim());
      axControls+=live.filter(n=>interactiveRoles.has(n.role?.value)).length;
      if(empty.length)defects.push(`${route}@1440: ${empty.length} unnamed AX controls (${empty.slice(0,5).map(n=>n.role?.value).join(', ')})`);
      if(!live.some(n=>n.role?.value==='main'))defects.push(`${route}@1440: no main landmark in AX tree`);
      if(!live.some(n=>n.role?.value==='navigation'))defects.push(`${route}@1440: no navigation landmark in AX tree`);
      const dom=await evaluate(`(() => {
        const missingRefs=[]; for(const e of document.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')) for(const a of ['aria-labelledby','aria-describedby','aria-controls']) if(e.hasAttribute(a)) for(const id of e.getAttribute(a).trim().split(/\\s+/)) if(id&&!document.getElementById(id)) missingRefs.push(a+'='+id);
        const unnamedScroll=[...document.querySelectorAll('.fin-table-wrap[tabindex]')].filter(e=>!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length;
        const visibleFocusableInHidden=[...document.querySelectorAll('[aria-hidden="true"] a[href],[aria-hidden="true"] button,[aria-hidden="true"] input,[aria-hidden="true"] select,[aria-hidden="true"] textarea,[aria-hidden="true"] [tabindex]')].filter(e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden'&&r.width>0&&r.height>0;}).length;
        return {missingRefs,unnamedScroll,visibleFocusableInHidden};
      })()`);
      if(dom.missingRefs.length)defects.push(`${route}@1440: missing ARIA references ${dom.missingRefs.slice(0,5).join(', ')}`);
      if(dom.visibleFocusableInHidden)defects.push(`${route}@1440: ${dom.visibleFocusableInHidden} visible focusables inside aria-hidden`);
      if(dom.unnamedScroll)scrollRegions.push({route,count:dom.unnamedScroll});
    }

    await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    for(const route of routes){
      await navigate(route);
      const touch=await evaluate(`(() => {
        const visible=e=>{const r=e.getBoundingClientRect(),c=getComputedStyle(e);return !e.closest('[aria-hidden="true"]')&&c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&r.width>0&&r.height>0&&e.getClientRects().length>0;};
        const nodes=[...document.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(visible);const bad=[];
        for(const e of nodes){let target=e;if((e.type==='checkbox'||e.type==='radio')&&e.closest('label'))target=e.closest('label');const r=target.getBoundingClientRect();const inlineText=e.tagName==='A'&&(getComputedStyle(e).display==='inline'||e.closest('.crumbs,.breadcrumbs,.footer,.doc-foot__links'))&&!e.matches('.btn,.lang__btn,.nav__link,.nav__sublink,.mobile-menu__link,.mobile-menu__sublink,.legal-back,.q-back,.contact-btn');if(!inlineText&&(r.width<23.5||r.height<23.5))bad.push({tag:e.tagName,cls:e.className||'',text:((e.textContent||'').trim()||e.getAttribute('aria-label')||e.name||'').slice(0,50),w:Math.round(r.width),h:Math.round(r.height)});}
        return {count:nodes.length,bad:bad.slice(0,8)};
      })()`);
      touchControls+=touch.count;if(touch.bad.length)defects.push(`${route}@390: undersized targets ${JSON.stringify(touch.bad)}`);
    }
    console.log('A11Y_INDEXED_PAGES='+routes.length);
    console.log('AX_INTERACTIVE_NODES='+axControls);
    console.log('TOUCH_INTERACTIVE_NODES='+touchControls);
    console.log('UNNAMED_TABLE_SCROLL_REGIONS='+scrollRegions.reduce((n,x)=>n+x.count,0));
    console.log('A11Y_DEFECTS='+defects.length);
    if(scrollRegions.length)console.log('SCROLL_REGION_PAGES='+scrollRegions.map(x=>x.route+':'+x.count).join(', '));
    if(defects.length){console.log(defects.join('\n'));process.exitCode=1;}
  }finally{if(cdp)cdp.close();proc.kill();server.close();for(let i=0;i<6;i++){try{rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(250);}}}
}
main().catch(e=>{console.error('A11Y_SWEEP_FAIL='+e.stack);process.exitCode=1;});
