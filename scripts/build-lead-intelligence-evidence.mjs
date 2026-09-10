#!/usr/bin/env node
// Deterministic, local-only Niagara UAT pages. No network and no production state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { NIAGARA_BRIEF, NIAGARA_CLIENT_DRAFT, NIAGARA_ROW } from '../qa/fixtures/lead-intelligence-fixtures.mjs';

const require = createRequire(import.meta.url);
const RENDER = require('../n8n/src/lead-intelligence/render.js');
const ALERT = require('../n8n/src/lead-intelligence/alert.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'qa-evidence', 'lead-intelligence-v1');
fs.mkdirSync(OUT, { recursive: true });

const auth = { analysis_id: 'XA-NIAGARA-UAT', token: 'uat-not-a-production-token' };
const row = { ...NIAGARA_ROW, review_status: 'OWNER_EDITED' };
const page = (mode) => RENDER.renderOwnerBriefPage({ brief: NIAGARA_BRIEF, client_draft: NIAGARA_CLIENT_DRAFT, row, auth, mode });
const desktopBrief = page('brief');
// Headless Chrome has a wider minimum layout viewport on Windows. Pinning the document to the
// left edge keeps the deterministic 390px capture exact instead of centring and clipping it.
const mobileBrief = desktopBrief.replace('</head>', '<style>html{width:390px;max-width:390px;margin:0;background:#d9d6cf}body{width:390px;max-width:390px;margin:0}.actionsbar{width:390px!important;right:auto!important}</style></head>');
const files = {
  'niagara-owner-brief-desktop.html': desktopBrief,
  'niagara-owner-brief-mobile.html': mobileBrief,
  'niagara-client-result-editor.html': page('edit'),
  'niagara-client-result-preview.html': page('preview')
};

const alert = ALERT.renderLeadIntelligenceAlert({
  company: NIAGARA_BRIEF.header.company,
  contact_name: NIAGARA_BRIEF.header.contact_name,
  role: NIAGARA_BRIEF.header.role,
  business: NIAGARA_BRIEF.header.business,
  scale: NIAGARA_BRIEF.header.scale,
  main_pain: NIAGARA_BRIEF.client_facts.find((x) => x.id === 'main_problem').value,
  observation: NIAGARA_BRIEF.diagnoses[0].conclusion,
  contact: NIAGARA_BRIEF.contact,
  next_action: NIAGARA_BRIEF.next_action.action
});
files['niagara-telegram-alert.html'] = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Niagara Telegram Alert</title><style>
*{box-sizing:border-box}body{margin:0;background:#d8e1e8;font:15px/1.42 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17212b}.stage{width:390px;min-height:760px;margin:0 auto;padding:90px 14px 35px;background:linear-gradient(145deg,#b8c7d1,#e3e9ed)}.bubble{max-width:354px;background:#fff;border-radius:17px 17px 17px 5px;padding:13px 14px;box-shadow:0 2px 7px rgba(20,35,50,.16);white-space:pre-wrap}.bubble b{font-weight:750}.time{text-align:right;color:#81909b;font-size:11px;margin-top:7px}.buttons{margin-top:7px;display:grid;gap:5px}.buttons div{background:#fff;color:#2b6ca3;text-align:center;padding:11px;border-radius:9px;font-weight:650;box-shadow:0 1px 4px rgba(20,35,50,.12)}
</style></head><body><main class="stage"><div class="bubble">${alert.replace(/\n/g, '<br>')}<div class="time">19:31</div></div><div class="buttons"><div>Разбор клиента</div><div>Связаться</div></div></main></body></html>`;

for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), html, 'utf8');
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  fixture: 'Niagara club',
  semantics: 'live-derived sanitized owner audit 2026-09-10; identifiers and PII synthetic',
  source_pairing: 'unique request_id fallback across intentionally mismatched synthetic Lead IDs',
  client_result_eligible: false,
  client_result_reason: 'self-assessment explicitly selected',
  generated_at: '2026-09-10T00:00:00.000Z',
  sources: Object.keys(files)
}, null, 2) + '\n', 'utf8');
console.log('wrote ' + Object.keys(files).length + ' UAT pages to ' + path.relative(ROOT, OUT));
