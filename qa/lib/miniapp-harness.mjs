// FINMENTOR — a Mini App harness small enough to trust.
//
// Boots content.js + net.js + app.js into ONE scope over a stubbed DOM, a stubbed `fetch` and a
// stubbed Telegram WebApp — the same three things a real Telegram WebView supplies. Every gate that
// drives the real client code uses this, so there is one shim rather than one per gate drifting
// away from the others.
//
// It is deliberately not jsdom. A shim you can read in two minutes cannot quietly satisfy an
// assertion the browser would fail; a full DOM implementation can, and the defect this whole phase
// exists to close was a CSS cascade rule that no headless DOM would have caught either.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const APP = join(ROOT, 'app-premium');

export function makeNode(tag) {
  const n = {
    tagName: String(tag).toUpperCase(),
    className: '',
    textContent: '',
    _html: '',
    // Assigning innerHTML REPLACES the subtree. render() clears #main with `innerHTML = ''`, so a
    // shim that kept the old children would let two screens coexist and every assertion about
    // "the rendered screen" would be a lie.
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    attrs: {},
    style: {},
    children: [],
    listeners: {},
    disabled: false,
    hidden: false,
    type: '',
    value: '',
    placeholder: '',
    maxLength: 0,
    get firstChild() { return this.children[0] || null; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) {
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) { this.children.push(c); } else { this.children.splice(i, 0, c); }
      return c;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    fire(ev, arg) { (this.listeners[ev] || []).forEach((f) => f(arg)); }
  };
  Object.defineProperty(n.style, 'cssText', { set() {}, get() { return ''; }, configurable: true });
  return n;
}

export const walk = (node, out = []) => { out.push(node); node.children.forEach((c) => walk(c, out)); return out; };
export const all = (root) => walk(root, []);
export const hasClass = (n, c) => String(n.className || '').split(/\s+/).indexOf(c) !== -1;
export const byClass = (root, c) => all(root).filter((n) => hasClass(n, c));
export const text = (root) => all(root).map((n) => n.textContent).filter(Boolean).join(' | ');

const CONTENT = readFileSync(join(APP, 'content.js'), 'utf8');
const NET = readFileSync(join(APP, 'net.js'), 'utf8');
const APPJS = readFileSync(join(APP, 'app.js'), 'utf8');

export const SESSION_ID = 'AS-' + 'a'.repeat(64);
export const INIT_DATA = 'user=%7B%22id%22%3A551662084%2C%22first_name%22%3A%22Ghennadi%22%7D&auth_date=1788000000&signature=x&hash=y';

// The bootstrap answer a healthy Gateway gives.
export const OK_BOOTSTRAP = {
  ok: true, app_session_id: SESSION_ID, expires_at: '2099-01-01T00:00:00.000Z', locale: 'ru',
  // The Gateway resolves which session this user and cycle already own, so the answer says
  // WHICH session it is and hands back its stored draft. A fresh mint carries state 'draft',
  // resumed false and no draft.
  state: 'draft', resumed: false, draft: null
};

// A bootstrap that RESUMED an existing brief.
export const resumedBootstrap = (draft, state) => Object.assign({}, OK_BOOTSTRAP, {
  state: state || 'draft', resumed: true, draft: draft
});

// `opts.responder({url, method, body})` returns { status, body } | { throws } | { raw }.
// `opts.telegram` false runs the app outside Telegram. `opts.endpoints` false leaves it offline.
export function boot(opts) {
  const o = opts || {};
  const sent = [];
  const main = makeNode('main');
  const stages = makeNode('nav');
  const back = makeNode('button');

  const responder = o.responder || (({ url }) => ({
    status: 200,
    body: /gateway/.test(url) ? OK_BOOTSTRAP : { ok: true }
  }));

  function stubFetch(url, init) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    sent.push({ url, method: init.method, body });
    const r = responder({ url, method: init.method, body }) || {};
    if (r.throws) { return Promise.reject(Object.assign(new Error(r.throws), { name: r.name || 'TypeError' })); }
    return Promise.resolve({
      status: r.status === undefined ? 200 : r.status,
      text: () => Promise.resolve(r.raw !== undefined ? r.raw : JSON.stringify(r.body))
    });
  }

  const closed = { count: 0 };
  const win = {
    console: { warn() {}, log() {} },
    matchMedia: () => ({ matches: true }),
    scrollTo: () => {},
    FM_CONTENT: null,
    FM_ENDPOINTS: o.endpoints === false ? {
      gateway: '__PREMIUM_GATEWAY_URL__', session: '__PREMIUM_SESSION_URL__', submit: '__PREMIUM_SUBMIT_URL__'
    } : {
      gateway: 'https://n8n.test/webhook/finmentor-miniapp-gateway',
      session: 'https://n8n.test/webhook/finmentor-miniapp-session',
      submit: 'https://n8n.test/webhook/finmentor-miniapp-submit'
    },
    Telegram: o.telegram === false ? undefined : {
      WebApp: {
        initData: o.initData === undefined ? INIT_DATA : o.initData,
        initDataUnsafe: { user: { id: 551662084, first_name: 'Ghennadi', language_code: o.languageCode || 'ru' } },
        ready() { this.readyCalls = (this.readyCalls || 0) + 1; },
        expand() { this.expandCalls = (this.expandCalls || 0) + 1; },
        setHeaderColor() {}, setBackgroundColor() {},
        close() { closed.count++; }
      }
    }
  };

  const doc = { createElement: makeNode, getElementById: (id) => ({ main, stages, back }[id]) };

  new Function('window', CONTENT)(win);
  new Function('window', 'fetch', 'setTimeout', 'clearTimeout', 'AbortController', NET)(
    win, stubFetch, setTimeout, clearTimeout, globalThis.AbortController
  );
  new Function('window', 'document', 'setTimeout', 'Promise', APPJS)(win, doc, setTimeout, Promise);

  return {
    win, main, stages, back, sent, closed,
    net: win.FM_NET,
    api: win.FM_APP,
    C: win.FM_CONTENT,
    // Screens render synchronously; the network does not. `settle` drains the microtask queue so a
    // test can assert on what the client did with an answer without sprinkling awaits.
    settle: () => new Promise((r) => setTimeout(r, 0)),
    state: () => win.FM_APP.current(),
    to: (url) => sent.filter((s) => s.url.indexOf(url) !== -1)
  };
}
