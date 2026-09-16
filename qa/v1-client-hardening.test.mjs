#!/usr/bin/env node
// Offline gate for the bounded Concierge half of the 2026-09-16 client-hardening cutover.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_NODES, prepareConcierge } from '../scripts/deploy-v1-client-hardening-concierge.mjs';
import {
  CONTEXT_PROJECTION_LEGACY,
  CONTEXT_PROJECTION_WITH_LOCALE,
  projectionInputNode
} from '../scripts/deploy-c3-concierge-cycle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-concierge-candidate.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const stable = (value) => JSON.stringify(value);
const node = (workflow, name) => workflow.nodes.find((item) => item.name === name);
const START = '// ============ P1-01';
const END = '// ============ end P1-01 ============';
const URL = 'https://tenant.invalid/webhook/finmentor-premium-miniapp';

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.log('  FAIL  ' + name + ' -> ' + error.message); }
}
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const eq = (actual, expected, message) => {
  if (stable(actual) !== stable(expected)) throw new Error(message + ' (got ' + stable(actual) + ', want ' + stable(expected) + ')');
};

function marked(code) {
  const start = code.indexOf(START);
  const end = code.indexOf(END) + END.length;
  if (start < 0 || end < END.length) throw new Error('fixture locale markers missing');
  return code.slice(start, end);
}

function liveFixture() {
  const live = clone(tracked);
  live.name = 'FINMENTOR Telegram Client Concierge PREMIUM AI GUARDED';
  const desired = marked(node(live, 'Get Bot Session').parameters.jsCode);
  const tail = desired.indexOf('const storedLocale =');
  const legacy = desired.slice(0, tail) + [
    's.language = resolveCustomerLocale({',
    '  messageText: String(p.message_text || ""),',
    '  sessionLocale: s.language,',
    '  telegramLanguageCode: p.language',
    '});',
    END
  ].join('\n');
  for (const name of ['Get Bot Session', 'Build Bot Response']) {
    const base = node(live, name);
    if (name === 'Get Bot Session') base.parameters.jsCode = base.parameters.jsCode.replace(desired, legacy);
    else {
      base.parameters.jsCode = base.parameters.jsCode
        .split('__PREMIUM_MINIAPP_URL__').join(URL)
        // Model the older live renderer so this fixture proves that both response-node
        // bodies are replaced, while preserving the live-only Mini App URL.
        .replace(/const LANGUAGE_CALLBACK = \{[^;]+\};/, 'const LANGUAGE_CALLBACK = {};');
    }
    const premium = clone(base);
    premium.name = name + ' (Premium)';
    premium.id = String(premium.id || name) + '-premium';
    live.nodes.push(premium);
  }
  const projection = projectionInputNode([0, 0]);
  projection.parameters.jsCode = projection.parameters.jsCode.replace(CONTEXT_PROJECTION_WITH_LOCALE, CONTEXT_PROJECTION_LEGACY);
  live.nodes.push(projection);
  return live;
}

console.log('V1 client hardening — bounded Concierge cutover');
console.log('');

check('the prepared workflow changes exactly the five authorised Code-node bodies', () => {
  const live = liveFixture();
  const result = prepareConcierge(live, tracked);
  eq(result.failures, [], 'preflight failures');
  const changed = live.nodes.filter((before) => stable(before) !== stable(node(result.out, before.name))).map((item) => item.name).sort();
  eq(changed, ALLOWED_NODES.slice().sort(), 'changed node set');
});

check('nodes, edges, settings and all non-code metadata remain byte-identical', () => {
  const live = liveFixture();
  const out = prepareConcierge(live, tracked).out;
  eq(out.connections, live.connections, 'connections');
  eq(out.settings, live.settings, 'settings');
  eq(out.nodes.length, live.nodes.length, 'node count');
  for (const before of live.nodes) {
    const after = clone(node(out, before.name));
    const baseline = clone(before);
    if (ALLOWED_NODES.includes(before.name)) {
      baseline.parameters.jsCode = ''; after.parameters.jsCode = '';
    }
    eq(after, baseline, before.name + ': metadata drift');
  }
});

check('both session branches carry the explicit one-time selector and no Telegram-hint preference', () => {
  const out = prepareConcierge(liveFixture(), tracked).out;
  for (const name of ['Get Bot Session', 'Get Bot Session (Premium)']) {
    const code = node(out, name).parameters.jsCode;
    assert(code.includes('selectedLocale'), name + ': selector missing');
    assert(code.includes('s.__language_choice_required = !explicitLocale;'), name + ': cold-choice marker missing');
    assert(code.includes('s.language = explicitLocale ? resolvedLocale : "";'), name + ': Telegram hint can persist');
  }
});

check('both customer renderers expose only the two mapped selector callbacks', () => {
  const out = prepareConcierge(liveFixture(), tracked).out;
  for (const name of ['Build Bot Response', 'Build Bot Response (Premium)']) {
    const code = node(out, name).parameters.jsCode;
    assert(code.includes('"Română": "p|lang_ro"') && code.includes('"Русский": "p|lang_ru"'), name + ': selector callbacks missing');
    assert(!code.includes('callback_data: "p|lang"'), name + ': unmapped five-button language callback present');
    assert(code.includes(URL), name + ': live Mini App URL was not preserved');
  }
});

check('the cycle projection carries only the normalised persisted locale', () => {
  const out = prepareConcierge(liveFixture(), tracked).out;
  const code = node(out, 'Prepare Cycle Projection').parameters.jsCode;
  assert(code.includes(CONTEXT_PROJECTION_WITH_LOCALE), 'locale projection not installed');
  assert(!code.includes(CONTEXT_PROJECTION_LEGACY), 'locale-blind projection remains');
});

check('an unknown session-locale block is refused instead of spliced blindly', () => {
  const live = liveFixture();
  node(live, 'Get Bot Session (Premium)').parameters.jsCode = 'return [{ json: {} }];';
  const result = prepareConcierge(live, tracked);
  assert(result.failures.some((value) => /locale block markers/.test(value)), 'unknown session code was accepted');
});

check('an unknown projection function is refused instead of silently losing locale', () => {
  const live = liveFixture();
  const projection = node(live, 'Prepare Cycle Projection');
  projection.parameters.jsCode = projection.parameters.jsCode.replace(CONTEXT_PROJECTION_LEGACY, 'function contextProjection() { return "unknown"; }');
  const result = prepareConcierge(live, tracked);
  assert(result.failures.some((value) => /contextProjection anchor/.test(value)), 'unknown projection code was accepted');
});

console.log('');
if (failures.length) {
  failures.forEach((failure) => console.log('FAILED: ' + failure));
  console.log('ASSERTIONS: ' + passed + ' passed, ' + failures.length + ' failed');
  process.exit(1);
}
console.log('ASSERTIONS: ' + passed + ' passed');
