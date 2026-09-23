#!/usr/bin/env node
// Final production audit: local rendered performance/resource sanity checks.
// Timings are deliberately not presented as production CWV; network is local and external hosts are blocked.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.avif':'image/avif'};
function serve(){return createServer((req,res)=>{const p=decodeURIComponent(new URL(req.url,'http://x').pathname),rel=p==='/'?'index.html':p.replace(/^\/+/,''),f=normalize(join(ROOT,rel));if(!f.startsWith(normalize(ROOT))||!existsSync(f)||!statSync(f).isFile()){res.writeHead(404);res.end();return}res.writeHead(200,{'content-type':mime[extname(f).toLowerCase()]||'application/octet-stream','cache-control':'public,max-age=3600'});createReadStream(f).pipe(res);});}
class CDP{constructor(url){this.url=url;this.id=0;this.waiters=new Map();this.events=new Map();}async open(){this.ws=new WebSocket(this.url);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('ws timeout')),5000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',reject,{once:true});});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const w=this.waiters.get(m.id);if(!w)return;this.waiters.delete(m.id);m.error?w.reject(new Error(m.error.message)):w.resolve(m.result||{});return}for(const fn of this.events.get(m.method)||[])fn(m.params||{});});}send(method,params={}){const id=++this.id;return new Promise((resolve,reject)=>{this.waiters.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}on(method,fn){if(!this.events.has(method))this.events.set(method,[]);this.events.get(method).push(fn);}once(method,timeout=12000){return new Promise((resolve,reject)=>{const fn=p=>{clearTimeout(t);this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));resolve(p);},t=setTimeout(()=>{this.events.set(method,(this.events.get(method)||[]).filter(x=>x!==fn));reject(new Error(method+' timeout'));},timeout);this.on(method,fn);});}close(){try{this.ws.close();}catch{}}}
async function target(port){for(let i=0;i<80;i++){try{const a=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json(),p=a.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch{}await sleep(100)}throw new Error('target missing')}

async function main(){
  const server=serve();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,debugPort=9340,profile=mkdtempSync(join(tmpdir(),'finmentor-perf-'));
  const proc=spawn(CHROME,['--headless=new',`--remote-debugging-port=${debugPort}`,`--user-data-dir=${profile}`,'--no-first-run','--disable-extensions','--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:'ignore',windowsHide:true});let cdp;
  try{
    cdp=new CDP(await target(debugPort));await cdp.open();await Promise.all([cdp.send('Page.enable'),cdp.send('Runtime.enable'),cdp.send('Network.enable')]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__auditPerf={cls:0,lcp:null};try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__auditPerf.cls+=e.value}).observe({type:'layout-shift',buffered:true})}catch(e){}try{new PerformanceObserver(l=>{const a=l.getEntries();const e=a[a.length-1];if(e)window.__auditPerf.lcp={url:e.url||'',size:e.size||0,tag:e.element&&e.element.tagName||'',cls:e.element&&e.element.className||''}}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}`});
    const routes=['/index.html','/ro/index.html','/about.html','/capital-management.html','/materials.html','/supplier-shelf-credit.html','/cfo-consultation.html','/questionnaire.html'];
    const defects=[],watches=[];let surfaces=0;
    async function evaluate(expression){const o=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(o.exceptionDetails)throw new Error(o.exceptionDetails.text);return o.result?.value}
    for(const width of [390,1440]){
      await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:2,mobile:width<600});
      for(const route of routes){
        await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});const loaded=cdp.once('Page.loadEventFired');await cdp.send('Page.navigate',{url:`http://127.0.0.1:${port}${route}`});await loaded;await sleep(450);surfaces++;
        const r=await evaluate(`(() => {const entries=performance.getEntriesByType('resource'),local=entries.filter(e=>e.name.startsWith(location.origin)),counts={};for(const e of local)counts[e.name]=(counts[e.name]||0)+1;const duplicates=Object.entries(counts).filter(x=>x[1]>1&&!new URL(x[0]).pathname.endsWith('/favicon.svg')).map(x=>x[0].replace(location.origin,''));const imgs=[...document.images].filter(i=>i.getClientRects().length).map(i=>{const r=i.getBoundingClientRect(),c=getComputedStyle(i),paint=r.width>0&&r.height>0,loaded=i.complete&&i.naturalWidth>0;return {src:(i.currentSrc||i.src).replace(location.origin,''),broken:i.complete&&i.naturalWidth===0,distorted:loaded&&paint&&c.objectFit==='fill'&&Math.abs((r.width/r.height)-(i.naturalWidth/i.naturalHeight))>.03,soft:loaded&&paint&&!/wordmark|icon-|apple-touch|favicon/.test(i.currentSrc||i.src)&&(r.width*devicePixelRatio)>i.naturalWidth*1.1,natural:i.naturalWidth+'x'+i.naturalHeight,paint:Math.round(r.width)+'x'+Math.round(r.height)}});return {cls:window.__auditPerf.cls,lcp:window.__auditPerf.lcp,dom:document.getElementsByTagName('*').length,duplicates,broken:imgs.filter(i=>i.broken),distorted:imgs.filter(i=>i.distorted),soft:imgs.filter(i=>i.soft),resources:local.length,bytes:local.reduce((n,e)=>n+(e.decodedBodySize||0),0),styles:[...document.styleSheets].length,scripts:document.scripts.length}})()`);
        if(r.cls>.1)defects.push(`${route}@${width}: CLS ${r.cls.toFixed(3)}`);if(r.duplicates.length)defects.push(`${route}@${width}: duplicate local resources ${r.duplicates.join(', ')}`);if(r.broken.length)defects.push(`${route}@${width}: broken images ${JSON.stringify(r.broken)}`);if(r.distorted.length)defects.push(`${route}@${width}: distorted images ${JSON.stringify(r.distorted)}`);if(r.soft.length)watches.push(`${route}@${width}: DPR2 source-size watch ${JSON.stringify(r.soft)}`);
        console.log(`PERF_SURFACE=${route}@${width} CLS=${r.cls.toFixed(3)} DOM=${r.dom} RES=${r.resources} BYTES=${r.bytes} LCP=${JSON.stringify(r.lcp)}`);
      }
    }
    console.log('PERFORMANCE_SURFACES='+surfaces);console.log('PERFORMANCE_DEFECTS='+defects.length);console.log('QUALITY_WATCHES='+watches.length);if(watches.length)console.log(watches.join('\n'));if(defects.length){console.log(defects.join('\n'));process.exitCode=1;}
  }finally{if(cdp)cdp.close();proc.kill();server.close();for(let i=0;i<6;i++){try{rmSync(profile,{recursive:true,force:true});break}catch{await sleep(250)}}}
}
main().catch(e=>{console.error('PERFORMANCE_AUDIT_FAIL='+e.stack);process.exitCode=1});
