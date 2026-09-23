#!/usr/bin/env node
// Final production audit: all indexed sitemap pages at every required viewport width.
// Dependency-free Chrome/CDP; external network is blocked and no forms are submitted.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTHS = [320, 390, 430, 768, 1024, 1280, 1440, 1728];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif' };

function pathsFromSitemap() {
  const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>https:\/\/www\.finmentor\.md\/([^<]*)<\/loc>/g)]
    .map((m) => '/' + (m[1] || 'index.html'))
    .map((p) => p.endsWith('/') ? p + 'index.html' : p);
}

function serve() {
  return createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
}

class CDP {
  constructor(url) { this.url=url; this.id=0; this.waiters=new Map(); this.events=new Map(); }
  async open() {
    this.ws=new WebSocket(this.url);
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('websocket timeout')),5000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',reject,{once:true});});
    this.ws.addEventListener('message',(e)=>{const m=JSON.parse(e.data);if(m.id){const w=this.waiters.get(m.id);if(!w)return;this.waiters.delete(m.id);m.error?w.reject(new Error(m.error.message)):w.resolve(m.result||{});return;}for(const fn of this.events.get(m.method)||[])fn(m.params||{});});
  }
  send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.waiters.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
  on(method,fn){if(!this.events.has(method))this.events.set(method,[]);this.events.get(method).push(fn);}
  once(method,timeout=12000){return new Promise((resolve,reject)=>{const fn=(p)=>{clearTimeout(t);this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));resolve(p);};const t=setTimeout(()=>{this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));reject(new Error(method+' timeout'));},timeout);this.on(method,fn);});}
  close(){try{this.ws.close();}catch{}}
}

async function target(port){for(let i=0;i<80;i++){try{const list=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const p=list.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl;}catch{}await sleep(100);}throw new Error('Chrome target missing');}

async function main(){
  const routes=pathsFromSitemap();
  if(routes.length!==90)throw new Error('sitemap route count drifted: '+routes.length);
  const server=serve();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const profile=mkdtempSync(join(tmpdir(),'finmentor-responsive-'));const debugPort=9338;
  const proc=spawn(CHROME,['--headless=new',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});
  let cdp;
  try{
    cdp=new CDP(await target(debugPort));await cdp.open();await Promise.all([cdp.send('Page.enable'),cdp.send('Runtime.enable')]);
    await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    const defects=[];let surfaces=0;
    async function evaluate(expression){const o=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(o.exceptionDetails)throw new Error(o.exceptionDetails.text);return o.result?.value;}
    for(const width of WIDTHS){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});
      for(const route of routes){
        const loaded=cdp.once('Page.loadEventFired');await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`});await loaded;await sleep(15);
        const result=await evaluate(`(() => {
          document.querySelectorAll('.reveal').forEach(x=>x.classList.add('is-visible','revealed','in-view'));
          const visible=e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&Number(c.opacity)!==0&&r.width>0&&r.height>0};
          const intentionalScroller=e=>{for(let x=e;x&&x!==document.body;x=x.parentElement){const c=getComputedStyle(x);if(/auto|scroll/.test(c.overflowX)&&x.scrollWidth>x.clientWidth+1)return true;}return false;};
          const badText=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(n){return n.nodeValue.trim()&&n.parentElement&&visible(n.parentElement)&&!intentionalScroller(n.parentElement)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
          let n;while((n=walker.nextNode())){const range=document.createRange();range.selectNodeContents(n);for(const r of range.getClientRects()){if(r.width>0&&(r.left<-1||r.right>innerWidth+1)){badText.push({text:n.nodeValue.trim().slice(0,60),left:Math.round(r.left),right:Math.round(r.right)});break;}}if(badText.length>=5)break;}
          const badActions=[...document.querySelectorAll('a,button,summary')].filter(e=>visible(e)&&!intentionalScroller(e)).map(e=>({e,r:e.getBoundingClientRect()})).filter(x=>x.r.left<-1||x.r.right>innerWidth+1||x.r.width>innerWidth+1).slice(0,5).map(x=>({text:(x.e.textContent||x.e.getAttribute('aria-label')||'').trim().slice(0,60),left:Math.round(x.r.left),right:Math.round(x.r.right),width:Math.round(x.r.width)}));
          const brokenImages=[...document.images].filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src')).slice(0,5);
          return {docOverflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),badText,badActions,brokenImages,h1:document.querySelectorAll('h1').length,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
        })()`);
        surfaces++;
        if(result.docOverflow>1||result.badText.length||result.badActions.length||result.brokenImages.length||result.h1!==1||!result.reduced)defects.push({route,width,...result});
      }
      console.log(`WIDTH_${width}=90/90`);
    }
    console.log('RESPONSIVE_SURFACES='+surfaces);
    console.log('RESPONSIVE_DEFECTS='+defects.length);
    if(defects.length){console.log(JSON.stringify(defects.slice(0,30),null,2));process.exitCode=1;}
  }finally{
    if(cdp)cdp.close();proc.kill();server.close();for(let i=0;i<6;i++){try{rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(250);}}
  }
}

main().catch(e=>{console.error('RESPONSIVE_SWEEP_FAIL='+e.stack);process.exitCode=1;});
