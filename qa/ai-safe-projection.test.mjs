#!/usr/bin/env node
// FINMENTOR — AI data-minimisation regression gate.
//
// Exercises the real projection core that is inlined into the Lead Intake
// "Build AI Work Plan Prompt" node. Assertion-based, non-zero exit on failure, paths
// resolved from this file rather than cwd.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const proj = require(join(HERE, '..', 'n8n', 'src', 'lead-intake', 'ai-safe-projection.js'));
const { buildAiSafeProjection, projectionLeak, scrubString } = proj;

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failures.push(name + ': ' + e.message);
    console.log('  FAIL  ' + name + ' -> ' + e.message);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// A realistic normalised lead card plus the raw client payload it came from.
const ITEM = {
  lead_id: 'FIN-20260825-001',
  company: 'ACME Distribution SRL',
  name: 'Ion Popescu',
  role: 'Owner',
  email: 'ion.popescu@acme-distribution.md',
  phone: '+373 60 123 456',
  telegram: '@ionpopescu',
  business_model: 'distribution',
  industry_category: 'wholesale',
  turnover_range: '1-5M EUR',
  employees_range: '20-50',
  has_cfo: 'no',
  lead_priority: 'HOT',
  financial_zone: 'RED',
  priority_reason: 'cash gap reported',
  diagnostic_score: 74,
  urgency: 'high',
  main_pain: 'cash_gap',
  selected_problems: ['ar_overdue', 'no_payment_calendar'],
  selected_goals: ['cash_forecast'],
  selected_documents: ['bank_statements'],
  documents_status: 'partial',
  work_interest: 'cfo_system',
  preferred_meeting_format: 'online',
  critical_flags: ['cash_gap'],
  next_action: 'discovery_call',
  site_language: 'ru'
};

const RAW = {
  tool: 'xray_extended',
  lead: {
    name: 'Ion Popescu',
    contact: 'ion.popescu@acme-distribution.md',
    company: 'ACME Distribution SRL',
    email: 'ion.popescu@acme-distribution.md',
    telegram: '@ionpopescu'
  },
  answers: {
    business: 'Distribuție FMCG',
    message: 'Sunăți-mă la +373 60 123 456 sau scrieți la ion.popescu@acme-distribution.md',
    ar_days: 75,
    inventory_days: 90
  },
  signals: { model: 'distribution', urgency: 'high', score_zone: 'RED', first_step: 'xray' },
  diagnostic: { business_model_key: 'distribution', urgency: 'high' },
  business_profile: { industry_category: 'wholesale', turnover_range: '1-5M EUR' },
  completion: { completion_score: 0.9, data_quality_hint: 'good' },
  meta: {
    page_url: 'https://www.finmentor.md/questionnaire.html?email=ion.popescu%40acme-distribution.md&utm_source=fb',
    referrer: 'https://facebook.com/',
    analytics_consent: true,
    ga_client_id: '1234567890.1234567890',
    ga_session_id: '1756100000',
    request_id: 'fmr_abc123',
    utm_source: 'fb',
    consent: true,
    site_language: 'ru'
  }
};

console.log('\nFINMENTOR AI safe projection\n');

const p = buildAiSafeProjection(ITEM, RAW);
const text = JSON.stringify(p);

console.log('IDENTITY AND CONTACT DATA MUST NOT REACH THE MODEL');

const forbiddenValues = {
  'email address': 'ion.popescu@acme-distribution.md',
  'local part of email': 'ion.popescu',
  'phone number': '373 60 123 456',
  'personal name': 'Popescu',
  'company name': 'ACME',
  'telegram handle': 'ionpopescu',
  'lead id': 'FIN-20260825-001',
  'ga client id': '1234567890.1234567890',
  'ga session id': '1756100000',
  'request id': 'fmr_abc123',
  'submission page url': 'finmentor.md/questionnaire.html',
  'referrer': 'facebook.com'
};
for (const [label, value] of Object.entries(forbiddenValues)) {
  check(label + ' is absent', () => {
    assert(!text.includes(value), 'found "' + value + '" in projection');
  });
}

const forbiddenKeys = ['email', 'phone', 'telegram', 'lead_id', 'ga_client_id', 'ga_session_id',
  'analytics_consent', 'request_id', 'utm_source', 'referrer', 'page_url', 'consent', 'contact'];
for (const key of forbiddenKeys) {
  check('key "' + key + '" is absent', () => {
    assert(!text.includes('"' + key + '"'), 'key ' + key + ' present in projection');
  });
}

check('the raw lead and meta sections are dropped wholesale', () => {
  assert(!('lead' in p.questionnaire), 'raw.lead survived');
  assert(!('meta' in p.questionnaire), 'raw.meta survived');
});

check('PII pasted into a free-text answer is scrubbed, not passed through', () => {
  const msg = p.questionnaire.answers && p.questionnaire.answers.message;
  assert(typeof msg === 'string', 'free-text answer was dropped entirely instead of scrubbed');
  assert(!/@|373 60|popescu/i.test(msg), 'free-text answer still carries contact data: ' + msg);
  assert(msg.includes('[contact removed]'), 'scrub marker missing: ' + msg);
});

console.log('\nANALYSIS DATA MUST SURVIVE');

const required = ['business_model', 'industry_category', 'turnover_range', 'employees_range',
  'has_cfo', 'lead_priority', 'financial_zone', 'diagnostic_score', 'urgency', 'main_pain',
  'selected_problems', 'documents_status', 'work_interest', 'critical_flags', 'next_action'];
for (const field of required) {
  check('card retains ' + field, () => {
    assert(p.card[field] !== undefined, field + ' was dropped from the projection');
  });
}
check('questionnaire retains business answers', () => {
  assert(p.questionnaire.answers, 'answers section dropped');
  assert(p.questionnaire.answers.ar_days === 75, 'numeric business answer dropped');
  assert(p.questionnaire.answers.inventory_days === 90, 'numeric business answer dropped');
  assert(p.questionnaire.signals, 'signals section dropped');
  assert(p.questionnaire.diagnostic, 'diagnostic section dropped');
});

console.log('\nFAIL-CLOSED LEAK DETECTOR');

check('a clean projection reports no leak', () => {
  assert(projectionLeak(p) === '', 'clean projection flagged: ' + projectionLeak(p));
});
check('leak detector is not stateful across calls', () => {
  for (let i = 0; i < 5; i++) {
    assert(projectionLeak(p) === '', 'flagged on call ' + i);
  }
});
check('an injected email is detected', () => {
  assert(projectionLeak({ card: { note: 'x@y.com' } }) === 'email-shaped value', 'email not detected');
});
check('an injected phone is detected', () => {
  assert(projectionLeak({ card: { note: '+37360123456' } }) === 'phone-shaped value', 'phone not detected');
});
check('an injected url is detected', () => {
  assert(projectionLeak({ card: { note: 'https://example.com/x' } }) === 'url', 'url not detected');
});
check('an injected forbidden key is detected', () => {
  assert(projectionLeak({ card: { ga_client_id: 'a' } }).startsWith('forbidden key'), 'key not detected');
});
check('detection repeats reliably for the same input', () => {
  const bad = { card: { note: 'a@b.com' } };
  for (let i = 0; i < 5; i++) {
    assert(projectionLeak(bad) === 'email-shaped value', 'missed on call ' + i);
  }
});

console.log('\nSCRUBBER');

check('scrubString removes emails, phones, handles and urls', () => {
  const out = scrubString('write a@b.com or call +373 60 123 456 or @handle see https://x.io/p');
  assert(!out.includes('a@b.com'), 'email survived');
  assert(!out.includes('373 60 123 456'), 'phone survived');
  assert(!out.includes('@handle'), 'handle survived');
  assert(!out.includes('https://x.io'), 'url survived');
});

console.log('\nDEPLOYED NODE MATCHES THE REVIEWED SOURCE');

check('the node tail references only the projection, never the raw item fields', () => {
  const { readFileSync } = require('node:fs');
  const tail = readFileSync(join(HERE, '..', 'n8n', 'src', 'lead-intake', 'build-ai-prompt.tail.js'), 'utf8');
  const prompt = tail.slice(tail.indexOf('const userPrompt'));
  const banned = ['${item.email}', '${item.phone}', '${item.telegram}', '${item.name}',
    '${item.company}', '${item.lead_id}', 'JSON.stringify(raw)'];
  for (const b of banned) {
    assert(!prompt.includes(b), 'prompt still interpolates ' + b);
  }
});

console.log('\n' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('\nAI SAFE PROJECTION GATE: FAIL');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('AI SAFE PROJECTION GATE: PASS');
