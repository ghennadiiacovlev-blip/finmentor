#!/usr/bin/env node
// FINMENTOR production responsive visual audit.
//
// This deliberately complements (rather than replaces) the canonical QA suite. It renders every
// public RU/RO page at every release viewport, traverses the complete scroll range, and checks
// painted text geometry/occlusion at intermediate positions. No forms are submitted and no page
// state outside the temporary browser profile is mutated.

import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA
    ? process.env.LOCALAPPDATA.replace(/\\/g, '/') + '/Google/Chrome/Application/chrome.exe'
    : '',
].find((path) => path && existsSync(path));
const ALL_WIDTHS = [320, 375, 390, 393, 430, 768, 1024, 1280, 1440, 1728];
const WIDTHS = (arg('--widths') || ALL_WIDTHS.join(',')).split(',').map(Number);
if (WIDTHS.some((width) => !ALL_WIDTHS.includes(width))) throw new Error(`unsupported widths: ${WIDTHS.join(',')}`);
const HEIGHT_FOR = (width) => width <= 430 ? 844 : width <= 768 ? 1024 : 1000;
const REQUESTED_ORIGIN = arg('--origin') || 'https://www.finmentor.md';
const PHASE = arg('--phase') || 'before';
const ONLY = arg('--only');
const EXACT_ROUTES = (arg('--routes') || '').split(',').map((route) => route.trim()).filter(Boolean);
const LIMIT = Number(arg('--limit') || 0);
const MOTION = arg('--motion') || 'reduced';
const MOTION_SETTLE_MS = MOTION === 'reduced' ? 0 : 1100;
const STATEMENT_WORDS_ONLY = process.argv.includes('--statement-words');
const TABLES_ONLY = process.argv.includes('--tables-only');
const CONTRACTS_ONLY = process.argv.includes('--contracts-only');
const OUT = join(ROOT, 'qa-artifacts', 'production-responsive-correction', PHASE);
const SHOT_OUT = join(OUT, 'screenshots');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function git(...args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

function publicRoutes() {
  const xml = readFileSync(join(ROOT, 'sitemap.xml'), 'utf8');
  const indexed = [...xml.matchAll(/<loc>https:\/\/www\.finmentor\.md([^<]*)<\/loc>/g)]
    .map((match) => match[1] || '/');
  const routes = [...new Set([...indexed, '/thank-you.html', '/ro/thank-you.html', '/404.html'])];
  if (routes.length !== 93) throw new Error(`public route inventory drifted: ${routes.length} != 93`);
  let selected = ONLY ? routes.filter((route) => route.includes(ONLY)) : routes;
  if (EXACT_ROUTES.length) selected = selected.filter((route) => EXACT_ROUTES.includes(route));
  if (STATEMENT_WORDS_ONLY) {
    selected = selected.filter((route) => {
      const relative = route === '/' || route.endsWith('/')
        ? `${route.replace(/^\/+/, '')}index.html`
        : route.replace(/^\/+/, '');
      const file = join(ROOT, relative);
      return existsSync(file) && /(?:statement-screen__keyword|fx-word__term)/.test(readFileSync(file, 'utf8'));
    });
  }
  if (TABLES_ONLY) {
    selected = selected.filter((route) => {
      const relative = route === '/' || route.endsWith('/')
        ? `${route.replace(/^\/+/, '')}index.html`
        : route.replace(/^\/+/, '');
      const file = join(ROOT, relative);
      return existsSync(file) && /<table\b/i.test(readFileSync(file, 'utf8'));
    });
  }
  return LIMIT ? selected.slice(0, LIMIT) : selected;
}

function slug(route) {
  if (route === '/') return 'ru-home';
  return route.replace(/^\//, '').replace(/\/$/, '-home').replace(/\.html$/, '').replace(/[^a-z0-9-]+/gi, '-');
}

function localServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.avif': 'image/avif', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
  };
  return createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' || pathname.endsWith('/')
      ? `${pathname.replace(/^\/+/, '')}index.html`
      : pathname.replace(/^\/+/, '');
    const file = normalize(join(ROOT, relative));
    if (!file.startsWith(normalize(ROOT)) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'content-type': mime[extname(file).toLowerCase()] || 'application/octet-stream' });
    response.end(readFileSync(file));
  });
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP websocket timeout')), 10_000);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result || {});
        return;
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params || {});
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(listener);
  }
  once(method, timeout = 25_000) {
    return new Promise((resolve, reject) => {
      let timer;
      const listener = (params) => {
        clearTimeout(timer);
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== listener));
        resolve(params);
      };
      timer = setTimeout(() => {
        this.events.set(method, (this.events.get(method) || []).filter((item) => item !== listener));
        reject(new Error(`${method} timeout`));
      }, timeout);
      this.on(method, listener);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function chromeTarget(port) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error('Chrome target unavailable');
}

const BOOTSTRAP = `(() => {
  try {
    sessionStorage.setItem('fm_intro_played', '1');
    localStorage.setItem('finmentor_cookie_consent', 'deny');
    localStorage.setItem('finmentor_language', 'ru');
    document.documentElement.classList.add('intro-skip');
  } catch {}
})()`;

const SETTLE = `new Promise(async (resolve) => {
  try { await document.fonts.ready; } catch {}
  const pending = [...document.images].filter((image) => !image.complete).map((image) =>
    Promise.race([
      image.decode ? image.decode().catch(() => {}) : new Promise((done) => {
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      }),
      new Promise((done) => setTimeout(done, 2500)),
    ])
  );
  await Promise.all(pending);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  resolve({ height: document.documentElement.scrollHeight, ready: document.readyState });
})`;

// The detector is intentionally paint-aware. It considers text line rectangles, asks the browser
// what is actually on top at multiple points, and ignores only ancestors/descendants belonging to
// the same component. This catches a following editorial sheet covering copy even when neither the
// document nor the copied element overflows horizontally.
const SCAN = `(() => {
  const y = Math.round(scrollY);
  const rectCache = new WeakMap();
  const styleCache = new WeakMap();
  const rectOf = (element) => {
    if (!rectCache.has(element)) rectCache.set(element, element.getBoundingClientRect());
    return rectCache.get(element);
  };
  const styleOf = (element) => {
    if (!styleCache.has(element)) styleCache.set(element, getComputedStyle(element));
    return styleCache.get(element);
  };
  const visible = (element) => {
    const rect = rectOf(element);
    if (rect.bottom < -2 || rect.top > innerHeight + 2 || rect.right < -2 || rect.left > innerWidth + 2) return false;
    if (element.closest('[hidden],[inert]')) return false;
    const closedDetails = element.closest('details:not([open])');
    if (closedDetails && !element.closest('summary')) return false;
    if (typeof element.checkVisibility === 'function'
      && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const style = styleOf(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.02
      || rect.width <= 0.5 || rect.height <= 0.5) return false;
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const nodeStyle = styleOf(node);
      const nodeRect = rectOf(node);
      const visuallyClipped = nodeStyle.clip !== 'auto' || (nodeStyle.clipPath && nodeStyle.clipPath !== 'none');
      if (visuallyClipped && nodeRect.width <= 2 && nodeRect.height <= 2) return false;
    }
    return true;
  };
  const selector = (element) => {
    if (!element) return '';
    if (element.id) return '#' + CSS.escape(element.id);
    const classes = [...element.classList].slice(0, 3).map((name) => '.' + CSS.escape(name)).join('');
    return element.localName + classes;
  };
  const textRect = (element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect();
  };
  const box = (rect) => ({
    left: Math.round(rect.left * 10) / 10,
    top: Math.round(rect.top * 10) / 10,
    right: Math.round(rect.right * 10) / 10,
    bottom: Math.round(rect.bottom * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  });
  const directionalSeparation = (first, second) => {
    const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
    const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
    if (overlapX > 0.5 && overlapY > 0.5) return { axis: 'overlap', gap: -Math.min(overlapX, overlapY) };
    if (overlapY > 0.5 && second.left >= first.right - 0.5) return { axis: 'horizontal', gap: second.left - first.right };
    if (second.top >= first.bottom - 0.5) return { axis: 'vertical', gap: second.top - first.bottom };
    return { axis: 'diagonal', gap: Math.hypot(
      Math.max(0, second.left - first.right, first.left - second.right),
      Math.max(0, second.top - first.bottom, first.top - second.bottom),
    ) };
  };
  const positionedChrome = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.matches('header,nav,[role="navigation"]')
        && /fixed|sticky/.test(styleOf(node).position)) return true;
    }
    return false;
  };
  const sameComponent = (a, b) => {
    if (a.contains(b) || b.contains(a)) return true;
    // The persistent site header is intentionally painted above document flow while the page
    // scrolls beneath it. That transient crossing is not a content collision; header-internal
    // geometry is covered by the dedicated navigation tests and captures.
    const headerA = a.closest('#header,header.site-header,header.header');
    const headerB = b.closest('#header,header.site-header,header.header');
    if (headerA || headerB) return true;
    if (positionedChrome(a) || positionedChrome(b)) return true;
    // The compact assistant launcher is persistent global chrome, like the header. Arbitrary
    // flow text can pass beneath it while scrolling; the launcher's own geometry is covered by
    // the functional and responsive component checks.
    if (a.closest('.fa-launch') || b.closest('.fa-launch')) return true;
    const semanticA = a.closest('details,section,article,figure,form,fieldset,table,dl,[role="dialog"]');
    const semanticB = b.closest('details,section,article,figure,form,fieldset,table,dl,[role="dialog"]');
    if (semanticA && semanticA === semanticB) return true;
    if (a.closest('main.nf') && a.closest('main.nf') === b.closest('main.nf')) return true;
    // The editorial stage is intentionally pinned while its sibling sheet rises over it. Text
    // from those two layers can share viewport coordinates during the hand-off without being a
    // collision in either reading surface.
    const sceneA = a.closest('.fx-scene');
    const sceneB = b.closest('.fx-scene');
    if (sceneA && sceneA === sceneB) {
      const stageA = a.closest('.fx-stage,.fx-hold');
      const stageB = b.closest('.fx-stage,.fx-hold');
      const sheetA = a.closest('.fx-sheet');
      const sheetB = b.closest('.fx-sheet');
      if ((stageA && sheetB) || (sheetA && stageB)) return true;
    }
    const ca = a.closest('a,button,label,li,[class*="card"],[class*="tile"],[class*="item"],nav,header,footer');
    const cb = b.closest('a,button,label,li,[class*="card"],[class*="tile"],[class*="item"],nav,header,footer');
    return Boolean(ca && ca === cb);
  };
  const intentionalScroller = (element) => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 2) return true;
    }
    return false;
  };
  const issues = [];
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.nodeValue.replace(/\\s+/g, ' ').trim();
      if (!text || !node.parentElement) return NodeFilter.FILTER_REJECT;
      if (node.parentElement.closest('script,style,svg,canvas,noscript,.visually-hidden,.sr-only')) return NodeFilter.FILTER_REJECT;
      if (!visible(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let node;
  while ((node = walker.nextNode())) {
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 0.5 || rect.height < 0.5 || rect.bottom < -1 || rect.top > innerHeight + 1) continue;
      lines.push({
        element: node.parentElement,
        rect,
        text: node.nodeValue.replace(/\\s+/g, ' ').trim().slice(0, 90),
      });
    }
  }

  for (const line of lines) {
    if (!intentionalScroller(line.element) && (line.rect.left < -1.5 || line.rect.right > innerWidth + 1.5)) {
      issues.push({ type: 'text-outside-viewport', selector: selector(line.element), text: line.text,
        box: [Math.round(line.rect.left), Math.round(line.rect.top), Math.round(line.rect.right), Math.round(line.rect.bottom)] });
    }
    const top = Math.max(1, line.rect.top + Math.min(3, line.rect.height / 3));
    const bottom = Math.min(innerHeight - 1, line.rect.bottom - Math.min(3, line.rect.height / 3));
    const points = [
      [Math.max(1, line.rect.left + Math.min(4, line.rect.width / 4)), (top + bottom) / 2],
      [Math.min(innerWidth - 1, line.rect.right - Math.min(4, line.rect.width / 4)), (top + bottom) / 2],
      [Math.min(innerWidth - 1, Math.max(1, (line.rect.left + line.rect.right) / 2)), (top + bottom) / 2],
    ];
    const blockers = points.map(([x, pointY]) => document.elementFromPoint(x, pointY))
      .filter((hit) => hit && !sameComponent(line.element, hit));
    if (blockers.length >= 2) {
      const blocker = blockers[0];
      // Flow content naturally passes below the fixed global header at arbitrary scroll offsets.
      // We keep genuine sticky editorial layers eligible but exclude only this global chrome.
      if (blocker.closest('#header,header.site-header,header.header')) continue;
      const blockerStyle = getComputedStyle(blocker);
      const blockerRect = blocker.getBoundingClientRect();
      if (blockerRect.width > 5 && blockerRect.height > 5 && blockerStyle.pointerEvents !== 'none') {
        issues.push({ type: 'painted-text-occluded', selector: selector(line.element), text: line.text,
          blocker: selector(blocker), blockerPosition: blockerStyle.position,
          box: [Math.round(line.rect.left), Math.round(line.rect.top), Math.round(line.rect.right), Math.round(line.rect.bottom)] });
      }
    }
  }

  // A meaningful text container with hidden/clip overflow and larger content is an actual reading
  // defect. Decorative/media containers and line-clamped excerpts are excluded deliberately.
  for (const element of document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,a,button,li,dt,dd,label,blockquote')) {
    if (!element.textContent.trim() || element.closest('[aria-hidden="true"],svg')) continue;
    const rect = rectOf(element);
    if (rect.bottom < -1 || rect.top > innerHeight + 1 || !visible(element)) continue;
    const style = styleOf(element);
    const clippedY = /hidden|clip/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2;
    const clippedX = /hidden|clip/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2;
    if ((clippedX || clippedY) && style.webkitLineClamp === 'none') {
      issues.push({ type: 'clipped-meaningful-text', selector: selector(element),
        text: element.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90),
        client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] });
    }
  }

  // Detect collisions between line boxes from unrelated content components. Tiny glyph-boundary
  // contacts are ignored; at least 22% of the smaller line must be obstructed.
  for (let i = 0; i < lines.length && issues.length < 80; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j];
      if (sameComponent(a.element, b.element)) continue;
      const iw = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const ih = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (iw <= 2 || ih <= 2) continue;
      const overlap = iw * ih;
      const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      if (overlap / smaller < 0.22) continue;
      issues.push({ type: 'unrelated-text-collision', selector: selector(a.element), text: a.text,
        with: selector(b.element), withText: b.text, overlapRatio: Number((overlap / smaller).toFixed(2)) });
    }
  }

  // In normal-motion mode an element inside the viewport can legitimately remain hidden until
  // the observer's root margin is crossed. Reduced motion has no transitional state, so a hidden
  // reveal there is always actionable.
  const hiddenReveal = (matchMedia('(prefers-reduced-motion: reduce)').matches
    ? [...document.querySelectorAll('.reveal,[data-reveal],[data-reveal-delay]')]
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) < 0.05;
    })
    .slice(0, 8)
    .map((element) => ({ type: 'visible-region-hidden-by-reveal', selector: selector(element),
      text: element.textContent.replace(/\\s+/g, ' ').trim().slice(0, 90) }))
    : []);
  issues.push(...hiddenReveal);

  // These two editorial compositions place independent text objects in adjacent tracks. Generic
  // paint/overflow checks miss a collision when both nodes belong to one semantic section, so the
  // contract uses the actual post-font text ranges and requires a measurable gap.
  const statement = document.querySelector('.pg-owner #profit-question');
  if (statement) {
    const keyword = statement.querySelector('.statement-screen__keyword');
    const copy = statement.querySelector('.statement-screen__copy');
    const rightColumn = statement.querySelector('.capital-chain');
    if (keyword && copy && rightColumn) {
      const keywordRect = textRect(keyword);
      const copyRect = copy.getBoundingClientRect();
      const rightRect = textRect(rightColumn);
      const separation = directionalSeparation(keywordRect, rightRect);
      if (keywordRect.left < copyRect.left - 1 || keywordRect.right > copyRect.right + 1) {
        issues.push({ type: 'statement-keyword-outside-column', selector: selector(keyword),
          text: keyword.textContent.trim(), fontSize: styleOf(keyword).fontSize,
          keyword: box(keywordRect), column: box(copyRect) });
      }
      if (separation.axis === 'overlap') {
        issues.push({ type: 'statement-column-overlap', selector: selector(keyword),
          text: keyword.textContent.trim(), keyword: box(keywordRect), rightColumn: box(rightRect) });
      } else if (separation.gap < 24) {
        issues.push({ type: 'statement-column-gap-too-small', selector: selector(keyword),
          text: keyword.textContent.trim(), axis: separation.axis,
          gap: Math.round(separation.gap * 10) / 10, keyword: box(keywordRect), rightColumn: box(rightRect) });
      }
    }
  }

  for (const [index, row] of [...document.querySelectorAll('.pg-capital .capital-states > div')].entries()) {
    const label = row.querySelector('dt');
    const description = row.querySelector('dd');
    if (!label || !description) continue;
    const labelRect = textRect(label);
    const descriptionRect = textRect(description);
    const separation = directionalSeparation(labelRect, descriptionRect);
    if (separation.axis === 'overlap') {
      issues.push({ type: 'capital-label-description-overlap', row: index + 1,
        label: label.textContent.trim(), labelBox: box(labelRect), descriptionBox: box(descriptionRect) });
    } else if (separation.gap < 6) {
      issues.push({ type: 'capital-label-description-gap-too-small', row: index + 1,
        label: label.textContent.trim(), axis: separation.axis,
        gap: Math.round(separation.gap * 10) / 10,
        labelBox: box(labelRect), descriptionBox: box(descriptionRect) });
    }
  }

  // Regression for the defect that document-overflow checks missed: a complete word can fit the
  // viewport and still be cut by its own clip-path/mask or by a clipping ancestor. Statement words
  // are measured even when aria-hidden because their visible lettering is deliberately decorative.
  for (const element of document.querySelectorAll('.statement-screen__keyword,.fx-word__term')) {
    const rect = rectOf(element);
    if (rect.bottom < -1 || rect.top > innerHeight + 1) continue;
    const style = styleOf(element);
    const text = element.textContent.replace(/\\s+/g, ' ').trim();
    const range = document.createRange();
    range.selectNodeContents(element);
    const ink = range.getBoundingClientRect();
    if (style.clipPath !== 'none' || style.webkitMaskImage !== 'none' || style.maskImage !== 'none') {
      issues.push({ type: 'statement-word-clipped-by-mask', selector: selector(element), text,
        clipPath: style.clipPath, maskImage: style.webkitMaskImage || style.maskImage,
        animationName: style.animationName });
    }
    if ((/hidden|clip/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1)
      || (/hidden|clip/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1)) {
      issues.push({ type: 'statement-word-container-clips-text', selector: selector(element), text,
        client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] });
    }
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const ancestorStyle = styleOf(ancestor);
      if (!/hidden|clip/.test(ancestorStyle.overflowX + ' ' + ancestorStyle.overflowY)) continue;
      const ancestorRect = rectOf(ancestor);
      if (ink.left < ancestorRect.left - 1 || ink.right > ancestorRect.right + 1
        || ink.top < ancestorRect.top - 1 || ink.bottom > ancestorRect.bottom + 1) {
        issues.push({ type: 'statement-word-clipped-by-ancestor', selector: selector(element), text,
          ancestor: selector(ancestor), ink: [ink.left, ink.top, ink.right, ink.bottom].map(Math.round),
          ancestorBox: [ancestorRect.left, ancestorRect.top, ancestorRect.right, ancestorRect.bottom].map(Math.round) });
        break;
      }
    }
  }

  return {
    y,
    docHeight: document.documentElement.scrollHeight,
    issues: issues.slice(0, 80),
  };
})()`;

const PAGE_BASELINE = `(() => {
  const visible = (element) => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.02
      && rect.width > 0.5 && rect.height > 0.5;
  };
  return {
    title: document.title,
    language: document.documentElement.lang,
    h1Count: [...document.querySelectorAll('h1')].filter(visible).length,
    docOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    brokenImages: [...document.images].filter((image) => image.complete && image.naturalWidth === 0)
      .map((image) => image.currentSrc || image.src).slice(0, 10),
    bodyHeight: document.documentElement.scrollHeight,
    sections: [...document.querySelectorAll('main > section,main > article,body > section,footer')]
      .map((element) => Math.round(element.getBoundingClientRect().top + scrollY))
      .filter((top) => top >= 0),
  };
})()`;

const CONTRACTS = `(() => {
  const round = (n) => Math.round(n * 10) / 10;
  const textBox = (element) => {
    if (!element) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const rect = range.getBoundingClientRect();
    return { left: round(rect.left), top: round(rect.top + scrollY), right: round(rect.right),
      bottom: round(rect.bottom + scrollY), width: round(rect.width), height: round(rect.height) };
  };
  const contracts = {};
  const statement = document.querySelector('.pg-owner #profit-question');
  if (statement) {
    const keyword = statement.querySelector('.statement-screen__keyword');
    const copy = statement.querySelector('.statement-screen__copy');
    const right = statement.querySelector('.capital-chain');
    const copyRect = copy?.getBoundingClientRect();
    contracts.ownerStatement = {
      keyword: textBox(keyword),
      rightColumn: textBox(right),
      copyColumn: copyRect ? { left: round(copyRect.left), top: round(copyRect.top + scrollY),
        right: round(copyRect.right), bottom: round(copyRect.bottom + scrollY),
        width: round(copyRect.width), height: round(copyRect.height) } : null,
      fontSize: keyword ? getComputedStyle(keyword).fontSize : null,
    };
  }
  const stateRows = [...document.querySelectorAll('.pg-capital .capital-states > div')];
  if (stateRows.length) {
    contracts.capitalStates = stateRows.map((row) => ({
      label: row.querySelector('dt')?.textContent.trim() || '',
      labelBox: textBox(row.querySelector('dt')),
      descriptionBox: textBox(row.querySelector('dd')),
    }));
  }
  const tiles = [...document.querySelectorAll('.ab-mosaic__tile')];
  if (tiles.length) {
    const data = tiles.map((tile) => {
      const rect = tile.getBoundingClientRect();
      const index = tile.querySelector('.fx-index')?.getBoundingClientRect();
      const title = tile.querySelector('.ab-mosaic__text')?.getBoundingClientRect();
      const style = getComputedStyle(tile);
      return { top: round(rect.top + scrollY), bottom: round(rect.bottom + scrollY), height: round(rect.height),
        indexTop: index ? round(index.top - rect.top) : null,
        titleBottom: title ? round(rect.bottom - title.bottom) : null,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        justify: style.justifyContent };
    });
    const rows = [];
    for (const item of data) {
      let row = rows.find((candidate) => Math.abs(candidate.top - item.top) < 2);
      if (!row) { row = { top: item.top, items: [] }; rows.push(row); }
      row.items.push(item);
    }
    contracts.aboutPractice = {
      count: tiles.length,
      data,
      rowHeightSpread: rows.map((row) => round(Math.max(...row.items.map((x) => x.height)) - Math.min(...row.items.map((x) => x.height)))),
      rowTitleBottomSpread: rows.map((row) => round(Math.max(...row.items.map((x) => x.titleBottom)) - Math.min(...row.items.map((x) => x.titleBottom)))),
      indexAtTop: data.every((item) => item.indexTop !== null && item.indexTop <= parseFloat(item.padding[0]) + 2),
      titlesAtBottom: data.every((item) => item.titleBottom !== null && item.titleBottom <= parseFloat(item.padding[2]) + 2),
      consistentPadding: new Set(data.map((item) => item.padding.join('|'))).size === 1,
      spaceBetween: data.every((item) => item.justify === 'space-between'),
    };
  }
  const contact = document.querySelector('.contact-strip');
  if (contact) {
    const buttons = [...contact.querySelectorAll('a,button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: round(rect.left), right: round(rect.right), top: round(rect.top + scrollY),
        bottom: round(rect.bottom + scrollY), width: round(rect.width) };
    });
    contracts.contactStrip = { buttons, insideViewport: buttons.every((button) => button.left >= -1 && button.right <= innerWidth + 1) };
  }
  const related = document.querySelector('.related__grid');
  if (related) {
    const cards = [...related.children].map((card) => {
      const rect = card.getBoundingClientRect();
      return { top: round(rect.top + scrollY), left: round(rect.left), width: round(rect.width), height: round(rect.height) };
    });
    contracts.relatedGrid = { count: cards.length, cards };
  }
  const tableWrapSelector = '.fin-table-wrap, .art-table-wrap, .fcf-table-wrap, .cb-table-wrap, .retail-table-wrap, .table-scroll';
  const financialTables = [...document.querySelectorAll('.rd-page .rd-sheet table')];
  if (financialTables.length) {
    const tableIssues = [];
    let smallCount = 0;
    let complexCount = 0;
    const summaries = financialTables.map((table, tableIndex) => {
      const headers = [...table.querySelectorAll('thead tr:first-child > th')];
      const rows = [...table.querySelectorAll('tbody > tr')];
      const columnCount = Math.max(headers.length, ...rows.map((row) => row.children.length));
      const small = columnCount > 0 && columnCount <= 3;
      small ? smallCount++ : complexCount++;
      const wrap = table.closest(tableWrapSelector);
      const tableRect = table.getBoundingClientRect();
      const wrapRect = wrap?.getBoundingClientRect();
      const pseudo = wrap ? getComputedStyle(wrap, '::after') : null;
      const pseudoOverlay = Boolean(pseudo && pseudo.content !== 'none' && Number(pseudo.opacity) > 0.02
        && parseFloat(pseudo.width) > 1 && pseudo.backgroundImage !== 'none');
      const geometryViolations = [];
      let priorRowBottom = -Infinity;

      rows.forEach((row, rowIndex) => {
        const cells = [...row.children];
        let priorCellBottom = -Infinity;
        cells.forEach((cell, cellIndex) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const cellRect = cell.getBoundingClientRect();
          const rangeRects = [...range.getClientRects()].filter((rect) => rect.width > 0.25 && rect.height > 0.25);
          const outsideCell = rangeRects.some((rect) => rect.left < cellRect.left - 1 || rect.right > cellRect.right + 1
            || rect.top < cellRect.top - 1 || rect.bottom > cellRect.bottom + 1);
          if (outsideCell) geometryViolations.push({ row: rowIndex + 1, cell: cellIndex + 1, type: 'text-outside-cell' });
          if (small && innerWidth <= 760) {
            const expected = headers[cellIndex]?.textContent.trim() || '';
            if (!expected || cell.getAttribute('data-table-label') !== expected) {
              geometryViolations.push({ row: rowIndex + 1, cell: cellIndex + 1, type: 'mobile-label-mismatch' });
            }
            if (cellRect.top < priorCellBottom - 1) {
              geometryViolations.push({ row: rowIndex + 1, cell: cellIndex + 1, type: 'mobile-field-order' });
            }
            priorCellBottom = cellRect.bottom;
          }
        });
        const rowRect = row.getBoundingClientRect();
        if (small && innerWidth <= 760 && rowRect.top < priorRowBottom - 1) {
          geometryViolations.push({ row: rowIndex + 1, type: 'mobile-row-order' });
        }
        priorRowBottom = rowRect.bottom;
      });

      const scrollOverflow = wrap ? table.scrollWidth - wrap.clientWidth : 0;
      const accessibleScroll = !wrap || scrollOverflow <= 1 || (wrap.tabIndex >= 0 && wrap.getAttribute('role') === 'region'
        && Boolean(wrap.getAttribute('aria-label') || wrap.getAttribute('aria-labelledby')));
      const mobileCard = table.classList.contains('financial-table--cards')
        && Boolean(wrap?.classList.contains('financial-table-wrap--cards'));
      const mobileContained = !wrapRect || (tableRect.left >= wrapRect.left - 1 && tableRect.right <= wrapRect.right + 1);
      const desktopNative = innerWidth <= 760 || (getComputedStyle(table).display === 'table'
        && (!rows[0] || getComputedStyle(rows[0]).display === 'table-row')
        && (!rows[0]?.children[0] || getComputedStyle(rows[0].children[0]).display === 'table-cell'));

      if (pseudoOverlay) tableIssues.push({ type: 'financial-table-data-overlay', table: tableIndex + 1 });
      if (!accessibleScroll) tableIssues.push({ type: 'financial-table-scroll-not-accessible', table: tableIndex + 1 });
      if (!desktopNative) tableIssues.push({ type: 'financial-table-desktop-layout-changed', table: tableIndex + 1 });
      if (small && innerWidth <= 760 && (!mobileCard || scrollOverflow > 1 || !mobileContained)) {
        tableIssues.push({ type: 'financial-table-mobile-card-broken', table: tableIndex + 1,
          mobileCard, scrollOverflow: round(scrollOverflow), mobileContained });
      }
      geometryViolations.forEach((violation) => tableIssues.push({
        ...violation, type: 'financial-table-rendered-text-geometry', violationType: violation.type,
        table: tableIndex + 1,
      }));

      return {
        table: tableIndex + 1,
        caption: table.querySelector('caption')?.textContent.trim() || '',
        columnCount,
        rowCount: rows.length,
        small,
        mobileCard,
        scrollOverflow: round(scrollOverflow),
        pseudoOverlay,
        accessibleScroll,
        geometryViolationCount: geometryViolations.length,
      };
    });
    contracts.financialTables = { count: financialTables.length, smallCount, complexCount, issues: tableIssues, summaries };
  }
  const photoHero = document.querySelector('.rd-cover--photo');
  if (photoHero) {
    const sheet = photoHero.nextElementSibling?.matches('.rd-sheet') ? photoHero.nextElementSibling : null;
    const content = photoHero.querySelector('.fx-stage__content');
    const scrim = photoHero.querySelector('.fx-stage__scrim');
    const firstScene = sheet?.querySelector('section.rd-scene');
    const heroRect = photoHero.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    const contentRect = content?.getBoundingClientRect();
    const text = [...(content?.querySelectorAll('.crumbs,.doc-hero__eyebrow,h1,.doc-hero__lead,.doc-hero__context') || [])]
      .map((element) => textBox(element)).filter(Boolean);
    const sheetStyle = sheet ? getComputedStyle(sheet) : null;
    contracts.photoHero = {
      hero: { left: round(heroRect.left), top: round(heroRect.top + scrollY), right: round(heroRect.right),
        bottom: round(heroRect.bottom + scrollY), width: round(heroRect.width), height: round(heroRect.height) },
      sheet: sheetRect ? { left: round(sheetRect.left), top: round(sheetRect.top + scrollY), right: round(sheetRect.right),
        bottom: round(sheetRect.bottom + scrollY), width: round(sheetRect.width), height: round(sheetRect.height) } : null,
      content: contentRect ? { left: round(contentRect.left), top: round(contentRect.top + scrollY), right: round(contentRect.right),
        bottom: round(contentRect.bottom + scrollY), width: round(contentRect.width), height: round(contentRect.height) } : null,
      text,
      sheetOverlap: sheetRect ? round(heroRect.bottom - sheetRect.top) : null,
      sheetRadius: sheetStyle ? parseFloat(sheetStyle.borderTopLeftRadius) : null,
      firstSceneMarginTop: firstScene ? parseFloat(getComputedStyle(firstScene).marginTop) : null,
      scrimFloor: scrim ? parseFloat(getComputedStyle(scrim).getPropertyValue('--rd-copy-scrim-floor')) : null,
      scrimBackground: scrim ? getComputedStyle(scrim).backgroundImage : null,
    };
  }
  return contracts;
})()`;

const REPRESENTATIVE = new Set([
  '/', '/ro/', '/about.html', '/ro/about.html', '/owner.html', '/ro/owner.html',
  '/capital-management.html', '/ro/capital-management.html', '/business-models.html', '/ro/business-models.html',
  '/real-estate-control-system.html', '/ro/real-estate-control-system.html',
  '/retail-margin-engine.html', '/ro/retail-margin-engine.html', '/materials.html', '/ro/materials.html',
  '/cases.html', '/ro/cases.html', '/working-capital-scan.html', '/ro/working-capital-scan.html',
  '/contact.html', '/ro/contact.html', '/privacy.html', '/ro/privacy.html',
  '/thank-you.html', '/ro/thank-you.html', '/404.html',
]);

const SECTION_CAPTURES = new Map([
  ['/owner.html', [{ selector: '#profit-question', label: 'statement-section', padding: 0, reveal: true }]],
  ['/ro/owner.html', [{ selector: '#profit-question', label: 'statement-section', padding: 0, reveal: true }]],
  ['/capital-management.html', [{ selector: '[aria-labelledby="capital-state-title"]', label: 'capital-states-section', padding: 20, reveal: true }]],
  ['/ro/capital-management.html', [{ selector: '[aria-labelledby="capital-state-title"]', label: 'capital-states-section', padding: 20, reveal: true }]],
  ['/capex-hurdle-rate.html', [
    { selector: '.fin-table-wrap', index: 0, label: 'financial-table-1', padding: 12 },
    { selector: '.fin-table-wrap', index: 1, label: 'financial-table-2', padding: 12 },
  ]],
  ['/ro/capex-hurdle-rate.html', [
    { selector: '.fin-table-wrap', index: 0, label: 'financial-table-1', padding: 12 },
    { selector: '.fin-table-wrap', index: 1, label: 'financial-table-2', padding: 12 },
  ]],
  ['/real-estate-control-system.html', [
    { selector: '.rd-cover--photo', label: 'hero-transition', padding: 0, extendBottom: 260 },
  ]],
  ['/ro/real-estate-control-system.html', [
    { selector: '.rd-cover--photo', label: 'hero-transition', padding: 0, extendBottom: 260 },
  ]],
]);

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = [issue.route, issue.width, issue.type, issue.selector, issue.text, issue.blocker, issue.with,
      issue.table, issue.row, issue.cell, issue.violationType].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  if (!CHROME) throw new Error('Chrome executable was not found');
  mkdirSync(SHOT_OUT, { recursive: true });
  const routes = publicRoutes();
  let server;
  let origin = REQUESTED_ORIGIN;
  if (REQUESTED_ORIGIN === 'local') {
    server = localServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  const profile = mkdtempSync(join(tmpdir(), 'finmentor-production-responsive-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  let cdp;
  const startedAt = new Date().toISOString();
  const results = [];
  const allIssues = [];
  try {
    cdp = new CDP(await chromeTarget(port));
    await cdp.open();
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOTSTRAP });
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: MOTION === 'reduced' ? 'reduce' : 'no-preference' }],
    });
    const evaluate = async (expression) => {
      const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      return response.result?.value;
    };
    for (const width of WIDTHS) {
      const height = HEIGHT_FOR(width);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: width <= 430 ? 2 : 1, mobile: width <= 430,
        screenWidth: width, screenHeight: height,
      });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: width <= 430, maxTouchPoints: 5 });
      let completed = 0;
      for (const route of routes) {
        const url = new URL(route, origin).href;
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url });
        await loaded;
        await evaluate(SETTLE);
        if (MOTION_SETTLE_MS) await sleep(MOTION_SETTLE_MS);
        const baseline = await evaluate(PAGE_BASELINE);
        const routeIssues = [];
        if (baseline.docOverflow > 1) routeIssues.push({ type: 'document-horizontal-overflow', amount: baseline.docOverflow });
        if (baseline.h1Count !== 1) routeIssues.push({ type: 'visible-h1-count', count: baseline.h1Count });
        if (baseline.brokenImages.length) routeIssues.push({ type: 'broken-images', images: baseline.brokenImages });

        const maxY = Math.max(0, baseline.bodyHeight - height);
        const points = new Set([0, maxY]);
        // Overlapping viewport-sized samples cover the whole document. Section-boundary samples
        // used to duplicate most positions and multiply style/layout work without increasing
        // visual coverage.
        const step = Math.max(420, Math.floor(height * 0.82));
        if (!CONTRACTS_ONLY) {
          for (let y = 0; y <= maxY; y += step) points.add(Math.min(maxY, y));
          for (const y of [...points].sort((a, b) => a - b)) {
            await evaluate(`scrollTo(0, ${Math.round(y)}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
            if (MOTION_SETTLE_MS) await sleep(MOTION_SETTLE_MS);
            const scan = await evaluate(SCAN);
            routeIssues.push(...scan.issues.map((issue) => ({ ...issue, y: scan.y })));
          }
        }
        await evaluate('scrollTo(0,0)');
        const contracts = await evaluate(CONTRACTS);
        if (contracts.aboutPractice) {
          const contract = contracts.aboutPractice;
          if (contract.count !== 6 || contract.rowHeightSpread.some((spread) => spread > 1)
            || contract.rowTitleBottomSpread.some((spread) => spread > 1)
            || !contract.indexAtTop || !contract.titlesAtBottom || !contract.consistentPadding || !contract.spaceBetween) {
            routeIssues.push({ type: 'about-practice-approved-composition-broken', contract });
          }
        }
        if (contracts.contactStrip && !contracts.contactStrip.insideViewport) {
          routeIssues.push({ type: 'contact-actions-outside-viewport', contract: contracts.contactStrip });
        }
        if (contracts.financialTables?.issues.length) {
          routeIssues.push(...contracts.financialTables.issues);
        }
        if (contracts.photoHero) {
          const hero = contracts.photoHero;
          const textOutside = hero.text.some((rect) => rect.left < hero.hero.left - 1 || rect.right > hero.hero.right + 1
            || rect.top < hero.hero.top - 1 || rect.bottom > hero.hero.bottom + 1);
          const textHitsSheet = hero.sheet && hero.text.some((rect) => rect.bottom > hero.sheet.top - 12);
          if (!hero.sheet || hero.sheetOverlap < 20 || hero.sheetOverlap > 70 || hero.sheetRadius < 20) {
            routeIssues.push({ type: 'photo-hero-sheet-geometry', contract: hero });
          }
          if (hero.firstSceneMarginTop > 1) {
            routeIssues.push({ type: 'photo-hero-double-transition-gap', contract: hero });
          }
          if (textOutside || textHitsSheet) {
            routeIssues.push({ type: 'photo-hero-text-outside-stage', textOutside, textHitsSheet, contract: hero });
          }
          if (!hero.scrimBackground || hero.scrimBackground === 'none' || !(hero.scrimFloor >= 0.65)) {
            routeIssues.push({ type: 'photo-hero-insufficient-copy-scrim', contract: hero });
          }
        }

        const unique = dedupeIssues(routeIssues.map((issue) => ({ route, width, ...issue })));
        allIssues.push(...unique);
        results.push({ route, url, width, height, baseline, contracts, issues: unique });

        const sectionCaptures = SECTION_CAPTURES.get(route) || [];
        if (sectionCaptures.length && (width === 320 || width === 390 || width === 1440)) {
          for (const sectionCapture of sectionCaptures) {
            if (sectionCapture.reveal) {
              await evaluate(`(() => {
                const elements = document.querySelectorAll(${JSON.stringify(sectionCapture.selector)});
                elements[${sectionCapture.index || 0}]?.scrollIntoView({ block: 'center' });
                return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
              })()`);
              await sleep(Math.max(700, MOTION_SETTLE_MS));
            }
            const clip = await evaluate(`(() => {
              const elements = document.querySelectorAll(${JSON.stringify(sectionCapture.selector)});
              const element = elements[${sectionCapture.index || 0}];
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              const padding = ${sectionCapture.padding};
              const extendBottom = ${sectionCapture.extendBottom || 0};
              const x = Math.max(0, rect.left + scrollX - padding);
              const y = Math.max(0, rect.top + scrollY - padding);
              return { x, y, width: Math.min(document.documentElement.scrollWidth - x, rect.width + padding * 2),
                height: Math.min(document.documentElement.scrollHeight - y, rect.height + padding * 2 + extendBottom), scale: 1 };
            })()`);
            if (clip) {
              const capture = await cdp.send('Page.captureScreenshot', {
                format: 'png', captureBeyondViewport: true, fromSurface: true, clip,
              });
              writeFileSync(join(SHOT_OUT, `${slug(route)}-${width}-${sectionCapture.label}.png`), Buffer.from(capture.data, 'base64'));
            }
          }
        }

        if (REPRESENTATIVE.has(route) && (width === 390 || width === 1440)) {
          const shotPoints = [
            ['initial', 0], ['middle', Math.round(maxY / 2)], ['final', maxY],
          ];
          for (const [label, y] of shotPoints) {
            await evaluate(`scrollTo(0, ${y}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
            await sleep(90);
            const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
            writeFileSync(join(SHOT_OUT, `${slug(route)}-${width}-${label}.png`), Buffer.from(capture.data, 'base64'));
          }
          if ((route === '/' || route === '/ro/') && (width === 390 || width === 1440)) {
            await evaluate('scrollTo(0,0)');
            const capture = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
            writeFileSync(join(SHOT_OUT, `${slug(route)}-${width}-full.png`), Buffer.from(capture.data, 'base64'));
          }
        }
        completed++;
        if (completed % 10 === 0 || completed === routes.length) {
          console.log(`PROGRESS_${width}=${completed}/${routes.length}`);
        }
      }
      console.log(`WIDTH_${width}=${completed}/${routes.length} issues=${allIssues.filter((issue) => issue.width === width).length}`);
    }
  } finally {
    cdp?.close();
    chrome.kill();
    server?.close();
    for (let attempt = 0; attempt < 8; attempt++) {
      try { rmSync(profile, { recursive: true, force: true }); break; }
      catch { await sleep(250); }
    }
  }

  const uniqueIssues = dedupeIssues(allIssues);
  const report = {
    schema: 1,
    phase: PHASE,
    motion: MOTION,
    origin: REQUESTED_ORIGIN === 'local' ? `${origin} (local production-commit server)` : origin,
    startedAt,
    finishedAt: new Date().toISOString(),
    commit: git('rev-parse', 'HEAD'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    widths: WIDTHS,
    routeCount: routes.length,
    surfaceCount: results.length,
    financialTableCount: results.filter((result) => result.width === WIDTHS[0])
      .reduce((sum, result) => sum + (result.contracts.financialTables?.count || 0), 0),
    scrollInspectionCount: results.reduce((sum, result) => sum + new Set(result.issues.map((issue) => issue.y).filter(Number.isFinite)).size, 0),
    issueCount: uniqueIssues.length,
    issues: uniqueIssues,
    results,
  };
  const json = JSON.stringify(report, null, 2) + '\n';
  writeFileSync(join(OUT, 'chromium-scroll-audit.json'), json);
  writeFileSync(join(OUT, 'chromium-scroll-audit.sha256'), createHash('sha256').update(json).digest('hex') + '\n');
  writeFileSync(join(OUT, 'chromium-scroll-audit-summary.txt'), [
    `origin=${report.origin}`, `commit=${report.commit}`, `routes=${report.routeCount}`, `widths=${WIDTHS.join(',')}`,
    `surfaces=${report.surfaceCount}`, `issues=${report.issueCount}`,
    ...Object.entries(Object.groupBy(uniqueIssues, (issue) => issue.type)).map(([type, entries]) => `${type}=${entries.length}`),
  ].join('\n') + '\n');
  console.log(`AUDIT_ROUTES=${report.routeCount}`);
  console.log(`AUDIT_SURFACES=${report.surfaceCount}`);
  if (TABLES_ONLY) console.log(`AUDIT_FINANCIAL_TABLES=${report.financialTableCount}`);
  console.log(`AUDIT_ISSUES=${report.issueCount}`);
  console.log(`AUDIT_REPORT=${join(OUT, 'chromium-scroll-audit.json')}`);
  if (uniqueIssues.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`PRODUCTION_RESPONSIVE_AUDIT_FAIL=${error.stack || error}`);
  process.exitCode = 1;
});
