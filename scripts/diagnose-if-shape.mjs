#!/usr/bin/env node
// FINMENTOR — which IF-node condition shape actually routes?
//
//   node scripts/diagnose-if-shape.mjs --confirm
//
// DISPOSABLE. The gate's two expressions provably evaluate to the same string (measured: both
// "…", same type, same length, equal === true) and the IF node still took the FALSE branch. So the
// fault is the condition SHAPE, not the values.
//
// Four candidate shapes are deployed side by side and fired with matching inputs. Whichever routes
// TRUE is the one to use — measured, not guessed from documentation.

const BASE = (process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = process.env.N8N_API_KEY;
const WRITE_KEY = process.env.N8N_FIX_API_KEY;
if (!process.argv.includes('--confirm')) { console.error('re-run with --confirm'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, tries) {
  let last = null;
  for (let i = 0; i < (tries || 4); i++) {
    try {
      const res = await fetch(BASE + '/api/v1' + path, {
        method,
        headers: Object.assign({ 'X-N8N-API-KEY': method === 'GET' ? READ_KEY : WRITE_KEY },
                               body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const t = await res.text();
      if (!res.ok) { throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + t.slice(0, 200)); }
      return t ? JSON.parse(t) : null;
    } catch (e) { last = e; await sleep(1000); }
  }
  throw last;
}
async function hit(path, body) {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(BASE + '/webhook/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t = await res.text();
      if (res.status !== 404) { return t; }
    } catch (e) { /* */ }
    await sleep(1200);
  }
  return '(no answer)';
}

const SETTINGS = { executionOrder: 'v1', availableInMCP: false, saveExecutionProgress: false,
  saveManualExecutions: false, saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none' };

// An arbitrary value. This tests whether the two sides of a comparison MATCH, so the real owner
// id is irrelevant here — and a real Telegram id is personal data that has no business in a
// diagnostic script.
const OWNER = '999888777';

// A: what is deployed now — string equals, BOTH sides expressions.
const A = { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'a', leftValue: '={{ String($("Src").first().json.chat_id || "") }}',
    rightValue: '={{ String($("Src").first().json.owner || "") }}',
    operator: { type: 'string', operation: 'equals' } }], combinator: 'and' };

// B: the same, plus the operator `name` the editor writes.
const B = { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'b', leftValue: '={{ String($("Src").first().json.chat_id || "") }}',
    rightValue: '={{ String($("Src").first().json.owner || "") }}',
    operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }], combinator: 'and' };

// C: left expression, right LITERAL.
const C = { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'c', leftValue: '={{ String($("Src").first().json.chat_id || "") }}',
    rightValue: OWNER,
    operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' } }], combinator: 'and' };

// D: the shape this repo already runs in production — a numeric verdict against a literal.
const D = { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
  conditions: [{ id: 'd', leftValue: '={{ $json.verdict }}', rightValue: 1,
    operator: { type: 'number', operation: 'equals' } }], combinator: 'and' };

const SHAPES = [['A both-expressions', A], ['B with operator.name', B], ['C right-literal', C], ['D numeric verdict', D]];

const results = [];
for (const [label, cond] of SHAPES) {
  const path = 'p12/ifshape-' + label.split(' ')[0].toLowerCase();
  const wf = {
    name: '[TEMP] P12 if-shape ' + label.split(' ')[0],
    settings: SETTINGS,
    nodes: [
      { parameters: { httpMethod: 'POST', path: path, responseMode: 'responseNode', options: {} },
        id: 'h', name: 'Hook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0] },
      { parameters: { mode: 'runOnceForAllItems', language: 'javaScript',
          jsCode: 'const b = $("Hook").first().json.body || {};\nreturn [{ json: { chat_id: String(b.chat_id || ""), owner: String(b.owner || ""), verdict: String(b.chat_id || "") === String(b.owner || "") ? 1 : 0 } }];' },
        id: 's', name: 'Src', type: 'n8n-nodes-base.code', typeVersion: 2, position: [200, 0] },
      { parameters: Object.assign({ conditions: cond }, { options: {} }),
        id: 'i', name: 'Gate', type: 'n8n-nodes-base.if', typeVersion: 2, position: [400, 0] },
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ branch: "TRUE" }) }}', options: { responseCode: 200 } },
        id: 't', name: 'T', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [600, -100] },
      { parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ branch: "FALSE" }) }}', options: { responseCode: 200 } },
        id: 'f', name: 'F', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [600, 100] }
    ],
    connections: {
      Hook: { main: [[{ node: 'Src', type: 'main', index: 0 }]] },
      Src: { main: [[{ node: 'Gate', type: 'main', index: 0 }]] },
      Gate: { main: [[{ node: 'T', type: 'main', index: 0 }], [{ node: 'F', type: 'main', index: 0 }]] }
    }
  };
  let id = null;
  try {
    id = (await api('POST', '/workflows', wf)).id;
    await api('POST', '/workflows/' + id + '/activate');
    const match = await hit(path, { chat_id: OWNER, owner: OWNER });
    const miss = await hit(path, { chat_id: '111222333', owner: OWNER });
    results.push([label, match.trim(), miss.trim()]);
  } catch (e) {
    results.push([label, 'ERROR ' + e.message.slice(0, 80), '']);
  } finally {
    if (id) {
      try { await api('POST', '/workflows/' + id + '/deactivate'); } catch (e) { /* */ }
      for (let i = 0; i < 6; i++) { try { await api('DELETE', '/workflows/' + id, null, 2); break; } catch (e) { await sleep(1200); } }
    }
  }
}

console.log('');
console.log('IF condition shape — which one routes?');
console.log('='.repeat(78));
console.log('  shape                    matching input        non-matching input');
for (const [label, m, x] of results) {
  console.log('  ' + label.padEnd(24) + ' ' + String(m).padEnd(22) + ' ' + String(x));
}
console.log('');
console.log('  WANTED: matching -> TRUE, non-matching -> FALSE');
console.log('  All temporary workflows deleted.');
console.log('');
