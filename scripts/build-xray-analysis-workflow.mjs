// FINMENTOR — builds the "FINMENTOR X-Ray Analysis" n8n workflow as Workflow SDK code.
//
// Usage: node scripts/build-xray-analysis-workflow.mjs  -> n8n/candidate/xray-analysis-workflow.sdk.js
//
// The Code-node bodies are the tracked modules under n8n/src/xray-analysis/, inlined verbatim
// (labels.js is spliced into validate-analysis.js at the marker). The emitted SDK code is
// what was passed to the n8n MCP `create_workflow_from_code`; the tenant workflow id is
// recorded in docs/C1_XRAY_ANALYSIS_DEPLOYMENT.md after creation.
//
// Design (C1):
//   sweep  : every 10 min -> Settings -> Pipeline -> XRay_Analysis -> pending leads (fail-closed,
//            consent-gated, capped) -> atomic PostgreSQL claim -> Leads raw row -> closed-
//            allowlist input -> OpenAI (json) -> strict validate (score/zone deterministic) ->
//            XRay_Analysis row (AI_DRAFT) -> narrow Pipeline projection -> owner Telegram alert.
//   failure: OpenAI error output -> ANALYSIS_FAILED row (so the sweep does not loop) -> owner notice.
//   review : GET renders a read-only review page. POST performs the PostgreSQL CAS
//            AI_DRAFT -> CLIENT_READY, then idempotently projects Sheets/customer result.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'n8n', 'src', 'xray-analysis');
const OUT = path.join(ROOT, 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js');

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const labels = read('labels.js').replace(/if \(typeof module[\s\S]*$/, '').trim();
const code = {
  settings: read('settings.js'),
  selectPending: read('select-pending.js'),
  buildClaim: read('build-claim.js'),
  claimVerdict: read('claim-verdict.js'),
  buildInput: read('build-input.js'),
  validate: read('validate-analysis.js').replace('// __XRAY_LABELS__ (inlined by the builder)', labels),
  failed: read('analysis-failed.js'),
  reviewSurface: read('review-surface.js'),
  review: read('review-verdict.js'),
  reviewCas: read('review-cas-verdict.js'),
  clientResult: read('build-client-result.js')
};
for (const [k, v] of Object.entries(code)) {
  if (/__XRAY_LABELS__/.test(v)) throw new Error('marker not replaced in ' + k);
}

const DOC = { __rl: true, value: '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A', mode: 'list', cachedResultName: 'FINMENTOR_LEADS_CRM_PREMIUM_FINAL' };
const SHEET = (name, gid) => gid ? ({ __rl: true, value: gid, mode: 'list', cachedResultName: name }) : ({ __rl: true, value: name, mode: 'name' });
const SHEETS_CRED = "{ googleSheetsOAuth2Api: { id: 'PzVCuEPa9YF3YSaD', name: 'Google Sheets OAuth2 API' } }";
const TG_CRED = "{ telegramApi: { id: 'Mj41qrGHfrthCtAw', name: 'FINMENTOR Leads Bot FINAL' } }";
const OPENAI_CRED = "{ openAiApi: { id: 'MC2uu5oVRKPe7iIH', name: 'OpenAI account' } }";
const POSTGRES_CRED = "{ postgres: { id: 'B6wRirWfjqoASXU3', name: 'FINMENTOR Supabase G5' } }";
const CLIENT_RESULT_TABLE = 'XRay_Client_Results';
const CLAIM_QUERY = [
  'with ins as (',
  '  insert into public.finmentor_xray_analysis_claims (lead_id, analysis_version, claim_key)',
  "  values ($1, $2, $3)",
  '  on conflict (lead_id, analysis_version) do nothing',
  '  returning claim_key',
  ') select (select count(*) from ins)::int as claimed'
].join('\n');
const CLAIM_STATE_QUERY = [
  'update public.finmentor_xray_analysis_claims',
  'set status = $1, analysis_id = $2',
  "where claim_key = $3 and status = 'CLAIMED'",
  'returning claim_key, status'
].join('\n');
const REVIEW_CAS_QUERY = [
  'with changed as (',
  '  update public.finmentor_xray_analysis_claims',
  "  set status = 'CLIENT_READY', reviewed_at = now()",
  "  where claim_key = $1 and analysis_id = $2 and status = 'AI_DRAFT'",
  '  returning status',
  ')',
  'select coalesce((select status from changed),',
  '  (select status from public.finmentor_xray_analysis_claims where claim_key = $1 and analysis_id = $2)) as authority_status,',
  '  (select count(*) from changed)::int as cas_won'
].join('\n');

const J = (v) => JSON.stringify(v);
const CODE = (s) => J(s); // Code-node bodies as safe string literals

const sheetsRead = (name, sheet, extra = '') => `
const ${name} = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: ${J(name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim())}, executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(sheet)}, options: {} ${extra} },
    credentials: ${SHEETS_CRED} },
  output: [{}]
});`;

const sdk = `import { workflow, node, trigger, ifElse, expr } from '@n8n/workflow-sdk';

const sweepTrigger = trigger({
  type: 'n8n-nodes-base.scheduleTrigger', version: 1.4,
  config: { name: 'Every 10 Minutes', parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } } },
  output: [{}]
});

const readSettings = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Settings', executeOnce: true, retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('Settings', 1871239368))}, options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ key: 'owner_chat_id', value: '' }]
});

const settingsToObject = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Settings to Object', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.settings)} } },
  output: [{ settings: { owner_chat_id: '', xray_ai_model: 'gpt-4.1' } }]
});

const readPipeline = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Pipeline', executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('Pipeline', 1883973304))}, options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ lead_id: '', priority: '', status: '', created_at: '' }]
});

const readAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read XRay_Analysis', executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))}, options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '', lead_id: '', review_status: '' }]
});

const selectPending = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Select Pending Leads', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.selectPending)} } },
  output: [{ lead_id: '', priority: '', financial_zone: '', company: '' }]
});

const buildClaim = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Analysis Claim', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.buildClaim)} } },
  output: [{ claim_valid: true, lead_id: '', analysis_version: 'xray-v2', claim_key: '' }]
});

const claimAnalysis = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Claim Analysis Authority', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: ${J(CLAIM_QUERY)},
      options: { queryReplacement: expr('{{ $json.lead_id }},{{ $json.analysis_version }},{{ $json.claim_key }}') } },
    credentials: ${POSTGRES_CRED} },
  output: [{ claimed: 1 }]
});

const claimVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Analysis Claim Verdict', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: ${CODE(code.claimVerdict)} } },
  output: [{ claim_won: 1, lead_id: '', analysis_version: 'xray-v2', claim_key: '' }]
});

const ifClaimWon = ifElse({
  version: 2.2,
  config: { name: 'IF Analysis Claim Won', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.claim_won }}'), operator: { type: 'number', operation: 'equals' }, rightValue: 1 }], combinator: 'and' } } }
});

const readLeadRaw = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Lead Raw', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('Leads', 409890193))},
      filtersUI: { values: [{ lookupColumn: 'Lead ID', lookupValue: expr('{{ $json.lead_id }}') }] }, combineFilters: 'AND', options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ 'Lead ID': '', 'Raw JSON': '{}', 'Diagnostic Score': '' }]
});

const buildInput = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Analysis Input', parameters: { mode: 'runOnceForEachItem', language: 'javaScript', jsCode: ${CODE(code.buildInput)} } },
  output: [{ lead_id: '', locale: 'ru', score: 47, zone: 'ORANGE', ai_model: 'gpt-4.1', ai_system_prompt: '', ai_user_prompt: '' }]
});

const aiAnalysis = node({
  type: '@n8n/n8n-nodes-langchain.openAi', version: 2.3,
  config: { name: 'AI X-Ray Analysis', onError: 'continueErrorOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000,
    parameters: { resource: 'text', operation: 'response',
      modelId: { __rl: true, mode: 'id', value: expr('{{ $json.ai_model }}') },
      responses: { values: [ { role: 'system', content: expr('{{ $json.ai_system_prompt }}') }, { role: 'user', content: expr('{{ $json.ai_user_prompt }}') } ] },
      simplify: true, builtInTools: {},
      options: { temperature: 0.3, maxTokens: 6000, textFormat: { textOptions: { type: 'json_object' } } } },
    credentials: ${OPENAI_CRED} },
  output: [{ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }]
});

const validateRows = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Validate + Store Rows', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.validate)} } },
  output: [{ analysis_row: { analysis_id: '', lead_id: '' }, pipeline_row: { lead_id: '' }, owner_alert: { text: '', review_url: '', crm_url: '' } }]
});

const analysisRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Analysis Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.analysis_row) }}'), options: {} } },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT' }]
});

const saveAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Save XRay_Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'append', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '', lead_id: '' }]
});

const persistClaimState = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Persist Analysis Claim State', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: ${J(CLAIM_STATE_QUERY)},
      options: { queryReplacement: expr("{{ $('Validate + Store Rows').item.json.claim_state }},{{ $('Validate + Store Rows').item.json.analysis_row.analysis_id }},{{ $('Validate + Store Rows').item.json.claim_key }}") } },
    credentials: ${POSTGRES_CRED} },
  output: [{ claim_key: '', status: 'AI_DRAFT' }]
});

const ifAnalysisValid = ifElse({
  version: 2.2,
  config: { name: 'IF Analysis Valid', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr("{{ $('Validate + Store Rows').item.json.is_valid }}"), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } }
});

const pipelineRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Pipeline Row', parameters: { mode: 'raw', jsonOutput: expr("{{ JSON.stringify($('Validate + Store Rows').item.json.pipeline_row) }}"), options: {} } },
  output: [{ lead_id: '', xray_analysis_status: 'AI_DRAFT' }]
});

const updatePipeline = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Update Pipeline X-Ray', retryOnFail: true, onError: 'continueRegularOutput',
    parameters: { resource: 'sheet', operation: 'update', documentId: ${J(DOC)}, sheetName: ${J(SHEET('Pipeline', 1883973304))},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['lead_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: ${SHEETS_CRED} },
  output: [{ lead_id: '' }]
});

const ownerAlert = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Owner Alert', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Validate + Store Rows').item.json.owner_alert.text }}"),
      replyMarkup: 'inlineKeyboard',
      inlineKeyboard: { rows: [
        { row: { buttons: [ { text: '✅ Проверить и открыть клиенту', additionalFields: { url: expr("{{ $('Validate + Store Rows').item.json.owner_alert.review_url }}") } } ] } },
        { row: { buttons: [ { text: '📊 Открыть CRM', additionalFields: { url: expr("{{ $('Validate + Store Rows').item.json.owner_alert.crm_url }}") } } ] } }
      ] },
      additionalFields: { appendAttribution: false, parse_mode: 'HTML', disable_web_page_preview: true } },
    credentials: ${TG_CRED} },
  output: [{ ok: true }]
});

const failedRowBuild = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Analysis Failed Row', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.failed)} } },
  output: [{ analysis_row: { analysis_id: '', review_status: 'ANALYSIS_FAILED' }, owner_text: '' }]
});

const failedRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Failed Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.analysis_row) }}'), options: {} } },
  output: [{ analysis_id: '', review_status: 'ANALYSIS_FAILED' }]
});

const saveFailed = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Save Failed Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'append', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '' }]
});

const persistFailedClaim = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'Persist Failed Claim State', onError: 'stopWorkflow',
    parameters: { operation: 'executeQuery', query: ${J(CLAIM_STATE_QUERY)},
      options: { queryReplacement: expr("{{ $('Analysis Failed Row').item.json.claim_state }},{{ $('Analysis Failed Row').item.json.analysis_row.analysis_id }},{{ $('Analysis Failed Row').item.json.claim_key }}") } },
    credentials: ${POSTGRES_CRED} },
  output: [{ claim_key: '', status: 'ANALYSIS_FAILED' }]
});

const ownerFailureNotice = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Failure Notice', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Analysis Failed Row').item.json.owner_text }}"),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    credentials: ${TG_CRED} },
  output: [{ ok: true }]
});

const validationFailureNotice = node({
  type: 'n8n-nodes-base.telegram', version: 1.2,
  config: { name: 'Telegram Validation Failure Notice', onError: 'continueRegularOutput',
    parameters: { resource: 'message', operation: 'sendMessage',
      chatId: expr("{{ $('Settings to Object').first().json.settings.owner_chat_id }}"),
      text: expr("{{ $('Validate + Store Rows').item.json.owner_text }}"),
      additionalFields: { appendAttribution: false, parse_mode: 'HTML' } },
    credentials: ${TG_CRED} },
  output: [{ ok: true }]
});

const reviewGetWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Review GET Webhook', parameters: { httpMethod: 'GET', path: 'finmentor-xray-review', responseMode: 'responseNode', options: {} } },
  output: [{ query: { a: 'XA-1', t: 'token' } }]
});

const readForReviewGet = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Analysis For Review GET', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))},
      filtersUI: { values: [{ lookupColumn: 'analysis_id', lookupValue: expr('{{ $json.query.a }}') }] }, combineFilters: 'AND', options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT', review_token: '' }]
});

const reviewSurface = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Render Review Surface', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.reviewSurface)} } },
  output: [{ http_status: 200, html: '' }]
});

const respondReviewSurface = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Surface', parameters: { respondWith: 'text', responseBody: expr('{{ $json.html }}'),
    options: { responseCode: expr('{{ $json.http_status }}'), responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Referrer-Policy', value: 'no-referrer' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const reviewPostWebhook = trigger({
  type: 'n8n-nodes-base.webhook', version: 2.1,
  config: { name: 'Review POST Webhook', parameters: { httpMethod: 'POST', path: 'finmentor-xray-review', responseMode: 'responseNode', options: {} } },
  output: [{ body: { a: 'XA-1', t: 'token' } }]
});

const readForReviewPost = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Read Analysis For Review POST', alwaysOutputData: true, onError: 'continueRegularOutput', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'read', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))},
      filtersUI: { values: [{ lookupColumn: 'analysis_id', lookupValue: expr('{{ $json.body.a }}') }] }, combineFilters: 'AND', options: {} },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '', lead_id: '', review_status: 'AI_DRAFT', review_token: '' }]
});

const reviewVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Review POST Verdict', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.review)} } },
  output: [{ verdict: 'CAS_REQUEST', analysis_id: '', claim_key: '', http_status: 200 }]
});

const ifCasRequest = ifElse({
  version: 2.2,
  config: { name: 'IF CAS Request', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.verdict }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'CAS_REQUEST' }], combinator: 'and' } } }
});

const reviewCas = node({
  type: 'n8n-nodes-base.postgres', version: 2.6,
  config: { name: 'CAS Review Promotion', onError: 'continueErrorOutput',
    parameters: { operation: 'executeQuery', query: ${J(REVIEW_CAS_QUERY)},
      options: { queryReplacement: expr("{{ $json.claim_key }},{{ $json.analysis_id }}") } },
    credentials: ${POSTGRES_CRED} },
  output: [{ authority_status: 'CLIENT_READY', cas_won: 1 }]
});

const reviewCasVerdict = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Review CAS Verdict', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.reviewCas)} } },
  output: [{ verdict: 'PROMOTED', proceed_update: true, update_row: {}, pipeline_row: {} }]
});

const ifPromote = ifElse({
  version: 2.2,
  config: { name: 'IF CAS Promoted Or Ready', parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ leftValue: expr('{{ $json.proceed_update }}'), operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' } } }
});

const promoteRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Promote Row', parameters: { mode: 'raw', jsonOutput: expr('{{ JSON.stringify($json.update_row) }}'), options: {} } },
  output: [{ analysis_id: '', review_status: 'CLIENT_READY' }]
});

const promoteAnalysis = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Promote Analysis', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'update', documentId: ${J(DOC)}, sheetName: ${J(SHEET('XRay_Analysis'))},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['analysis_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: ${SHEETS_CRED} },
  output: [{ analysis_id: '' }]
});

const pipelineStatusRow = node({
  type: 'n8n-nodes-base.set', version: 3.4,
  config: { name: 'Pipeline Status Row', parameters: { mode: 'raw', jsonOutput: expr("{{ JSON.stringify($('Review CAS Verdict').item.json.pipeline_row) }}"), options: {} } },
  output: [{ lead_id: '', xray_analysis_status: 'CLIENT_READY' }]
});

const updatePipelineStatus = node({
  type: 'n8n-nodes-base.googleSheets', version: 4.7,
  config: { name: 'Update Pipeline Review Status', retryOnFail: true,
    parameters: { resource: 'sheet', operation: 'update', documentId: ${J(DOC)}, sheetName: ${J(SHEET('Pipeline', 1883973304))},
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['lead_id'], schema: [] }, options: { cellFormat: 'RAW' } },
    credentials: ${SHEETS_CRED} },
  output: [{ lead_id: '' }]
});

const buildClientResult = node({
  type: 'n8n-nodes-base.code', version: 2,
  config: { name: 'Build Curated Client Result', parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${CODE(code.clientResult)} } },
  output: [{ authority_key: '', lead_id: '', review_status: 'CLIENT_READY', result_json: '{}' }]
});

const publishClientResult = node({
  type: 'n8n-nodes-base.dataTable', version: 1.1,
  config: { name: 'Publish Curated Client Result', onError: 'stopWorkflow',
    parameters: { resource: 'row', operation: 'upsert', dataTableId: { __rl: true, mode: 'name', value: ${J(CLIENT_RESULT_TABLE)} },
      matchType: 'allConditions', filters: { conditions: [{ keyName: 'authority_key', condition: 'eq', keyValue: expr('{{ $json.authority_key }}') }] },
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] }, options: {} } },
  output: [{ authority_key: '', review_status: 'CLIENT_READY' }]
});

const respondPromoted = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Done', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="robots" content="noindex"><title>FINMENTOR</title><p>Анализ подтверждён и доступен клиенту.</p></html>',
    options: { responseCode: 200, responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const respondDenied = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Denied', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="robots" content="noindex"><title>FINMENTOR</title><p>Подтверждение отклонено.</p></html>',
    options: { responseCode: expr('{{ $json.http_status }}'), responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'X-Robots-Tag', value: 'noindex, nofollow' }] } } } },
  output: [{}]
});

const respondReviewUnavailable = node({
  type: 'n8n-nodes-base.respondToWebhook', version: 1.5,
  config: { name: 'Respond Review Store Unavailable', parameters: { respondWith: 'text', responseBody: '<!doctype html><html lang="ru"><meta charset="utf-8"><p>Хранилище временно недоступно. Повторите позже.</p></html>',
    options: { responseCode: 503, responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Referrer-Policy', value: 'no-referrer' }] } } } },
  output: [{}]
});

export default workflow('finmentor-xray-analysis', 'FINMENTOR X-Ray Analysis')
  .add(sweepTrigger)
  .to(readSettings)
  .to(settingsToObject)
  .to(readPipeline)
  .to(readAnalysis)
  .to(selectPending)
  .to(buildClaim)
  .to(claimAnalysis)
  .to(claimVerdict)
  .to(ifClaimWon
    .onTrue(readLeadRaw))
  .to(buildInput)
  .to(aiAnalysis
    .onError(failedRowBuild.to(failedRow.to(saveFailed.to(persistFailedClaim.to(ownerFailureNotice))))))
  .to(validateRows)
  .to(analysisRow)
  .to(saveAnalysis)
  .to(persistClaimState)
  .to(ifAnalysisValid
    .onTrue(pipelineRow.to(updatePipeline.to(ownerAlert)))
    .onFalse(validationFailureNotice))
  .add(reviewGetWebhook)
  .to(readForReviewGet)
  .to(reviewSurface)
  .to(respondReviewSurface)
  .add(reviewPostWebhook)
  .to(readForReviewPost)
  .to(reviewVerdict)
  .to(ifCasRequest
    .onTrue(reviewCas
      .onError(respondReviewUnavailable)
      .to(reviewCasVerdict)
      .to(ifPromote
        .onTrue(promoteRow.to(promoteAnalysis.to(pipelineStatusRow.to(updatePipelineStatus.to(buildClientResult.to(publishClientResult.to(respondPromoted)))))))
        .onFalse(respondDenied)))
    .onFalse(respondDenied));
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, sdk);
console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + sdk.length + ' chars)');
