// FINMENTOR — independent verification of a live B.2.1-B CAS gate execution (Phase 10).
//
//   node scripts/verify-live-cas-execution.mjs <execution-json>
//
// Nothing here trusts the workflow's self-reported verdict. It takes the raw stored row out
// of the retained execution and re-derives everything with the repo's own projection module:
// completeness, field-by-field equality, and the SHA-256 projection_version. If the repo
// module and the deployed n8n Code node ever diverge, this fails.
//
// Fetch the execution as RAW BYTES — PowerShell's Invoke-RestMethod coerces ISO-8601 strings
// into DateTime and silently drops milliseconds, which would corrupt the hash input:
//
//   $h = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY }
//   (Invoke-WebRequest "$base/api/v1/executions/<id>?includeData=true" -Headers $h
//      -UseBasicParsing).Content | Set-Content exec.json
//
// Verified against execution 3400 (2026-08-25, manual, success): 22/22 PASS.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const P = require(join(HERE, '..', 'n8n', 'src', 'miniapp-readmodel', 'projection.js'));
const EXEC_PATH = process.argv[2];
if (!EXEC_PATH) {
  console.error('usage: node scripts/verify-live-cas-execution.mjs <execution-json>');
  console.error('fetch with: GET /api/v1/executions/<id>?includeData=true  (raw bytes, no type coercion)');
  process.exit(2);
}

const exec = JSON.parse(readFileSync(resolve(EXEC_PATH), 'utf8'));
const rd = exec.data.resultData.runData;

const out = (node) => rd[node][0].data.main[0];
const rowsB = out('Read Back B').map((x) => x.json);
const rowsA = out('Read Back A').map((x) => x.json);
const build = out('Build Case')[0].json;
const verdict = out('Final Verdict')[0].json;
const verdictA = out('Verdict A')[0].json;

let pass = 0;
const fail = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail.push(name + (detail ? ' -> ' + detail : '')); console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); }
};

console.log('\nIndependent verification of live execution 3400');
console.log('(repo module recomputing against the raw stored row)\n');

check('execution succeeded', exec.status === 'success', exec.status);
check('execution mode was manual', exec.mode === 'manual', exec.mode);
check('all 12 nodes ran', Object.keys(rd).length === 12, Object.keys(rd).length + ' nodes');

// --- the stored row, straight from the tenant -------------------------------------------
const row = rowsB[0];
check('limit-2 read returned exactly one row', rowsB.length === 1, rowsB.length + ' rows');
check('stored row is well-formed by repo rules', P.storedRowDefects(row).length === 0,
  P.storedRowDefects(row).join(','));

const stored = P.stripStoredRow(row);
const expected = P.buildSafeProjection(build.new_projection);

check('every mirrored field present in the stored row',
  P.PROJECTION_FIELDS.every((f) => Object.prototype.hasOwnProperty.call(row, f)));
check('stored row equals the intended projection field-by-field',
  P.diffProjections(expected, stored).length === 0,
  P.diffProjections(expected, stored).join(','));
check('session_id converged to the new generation', stored.session_id === 'S-NEW', stored.session_id);

// The load-bearing one: the repo module, offline, reproducing the live hash.
const recomputed = P.projectionVersion(stored);
check('repo module reproduces the stored projection_version',
  recomputed === String(row.projection_version),
  recomputed.slice(0, 16) + ' vs ' + String(row.projection_version).slice(0, 16));
check('stored hash also equals the hash of the intended projection',
  recomputed === P.projectionVersion(expected));

// --- fast read decision on the real row --------------------------------------------------
const fast = P.evaluateFastRead({ rows: rowsB });
check('repo fast-read serves the live row as a HIT', fast.decision === 'HIT', fast.reason);
check('cache_valid is true in the tenant', String(row.cache_valid) === 'true', String(row.cache_valid));
check('publish carried the commit token', String(row.sync_token) === 'TOK-COMMIT', String(row.sync_token));

// --- negative control, re-derived rather than trusted ------------------------------------
const rowA = rowsA[0];
const storedA = P.stripStoredRow(rowA);
const diffA = P.diffProjections(expected, storedA);
check('negative control: incomplete publish left session_id stale',
  String(rowA.session_id) === 'S-OLD', String(rowA.session_id));
check('negative control: repo verifier rejects that row',
  P.verifyStoredRow({ rows: rowsA, commitToken: 'TOK-COMMIT', expected }).reason === 'FIELD_MISMATCH',
  P.verifyStoredRow({ rows: rowsA, commitToken: 'TOK-COMMIT', expected }).reason);
check('negative control: only session_id differed', diffA.length === 1 && diffA[0] === 'session_id',
  diffA.join(','));
check('negative control: the OLD verifier would have accepted it',
  P.projectionVersion(expected) === String(rowA.projection_version));

// --- CAS semantics -----------------------------------------------------------------------
check('stale token updated zero rows', verdict.stale_token_updated_rows === 0,
  String(verdict.stale_token_updated_rows));
check('complete publish updated exactly one row', verdict.complete_publish_updated_rows === 1,
  String(verdict.complete_publish_updated_rows));

// --- no authority write was structurally possible ----------------------------------------
const wfNodes = Object.keys(rd);
const forbidden = wfNodes.filter((n) => /sheet|http|execute ?workflow|bot_session/i.test(n));
check('no Sheets / HTTP / sub-workflow node ran', forbidden.length === 0, forbidden.join(','));
check('synthetic identity only', String(row.chat_id) === '990000001', String(row.chat_id));

// --- the workflow agreed with us ---------------------------------------------------------
check('workflow self-report agrees with independent recomputation',
  verdict.GATE === 'PASS' && verdictA.NEGATIVE_CONTROL === 'PASS');

console.log('\n' + (fail.length ? 'FAIL' : 'PASS') + '  ' + pass + ' independent checks passed, ' + fail.length + ' failed');
if (fail.length) { fail.forEach((f) => console.error('  - ' + f)); process.exit(1); }
