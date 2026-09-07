# FINMENTOR - P7.1 live probe that closes F14 and F15 against the REAL Bot_Sessions sheet.
#
#   pwsh scripts/p71-sheet-probe.ps1 -Create            # build the disposable parent/child pair
#   pwsh scripts/p71-sheet-probe.ps1 -Show              # what exists right now
#   pwsh scripts/p71-sheet-probe.ps1 -EnableParentMcp   # let test_workflow start the parent
#   pwsh scripts/p71-sheet-probe.ps1 -Mode PREFLIGHT    # arm: read-only baseline
#   pwsh scripts/p71-sheet-probe.ps1 -Mode WRITE        # arm: append ONE synthetic row
#   pwsh scripts/p71-sheet-probe.ps1 -Mode CLEANUP      # arm: delete that one row
#   pwsh scripts/p71-sheet-probe.ps1 -Teardown          # archive the pair
#
# THE TWO QUESTIONS, both of which P7.0 recorded as OPEN and refused to answer offline.
#
#   F14  `Read Bot Sessions` is pinned to range A:AV = columns 1..48, and `submission_key` is
#        AW = 49. Does widening the range to A:AZ actually make the column readable?
#   F15  `Save Bot Session` maps with autoMapInputData, which P6R-1 proved silently DROPS a key
#        with no matching header. The AW..AZ headers exist but carry zero data on every row --
#        the exact condition under which this node has already been observed reporting a column
#        as missing. Does the write land?
#
# WHY THE NODE PARAMETERS ARE LIFTED FROM THE TRACKED EXPORT AND NEVER TYPED HERE.
# A probe that re-expresses the production Sheets configuration proves something about the
# re-expression. Both A:AV read nodes and the write node take their `parameters` VERBATIM from
# n8n/production/mppzthlkSJFr6Kle.*.json -- including the 40-entry stored `schema` on
# `Save Bot Session`, which is the single material difference between this probe and the
# P6-RESUME canary that already wrote a key with `schema: []`. The widened read is that same
# object with exactly one field changed, and -Create asserts both facts against the LIVE graph
# after it is written, not against the local hashtable that produced it.
#
# WHY A PARENT AND A CHILD. `test_workflow` PINS every credential-bearing node in the workflow
# it runs, so a single workflow holding the Google Sheets nodes would report a confident
# success while touching nothing. The child is invoked as a SUB-workflow and executes for real.
#
# THE GUARDS.
#   1. The probe chat_id is 900000701, inside the reserved synthetic 900000xxx range, and the
#      child re-checks that with a regex before it will write or delete anything.
#   2. WRITE refuses if any row already carries that chat_id. appendOrUpdate matches on
#      chat_id, so an existing row would be OVERWRITTEN rather than appended.
#   3. CLEANUP refuses unless EXACTLY ONE row matches, and that row must also carry the probe
#      session_id, the probe status and the probe cycle_id, and must carry no lead_id. A
#      chat_id match alone is not enough to authorise an irreversible delete.
#   4. The mode lives in a NODE in the parent graph, not in pin data: the public API silently
#      declines to store pinData, and a mode hidden in a pin is invisible to whoever opens the
#      workflow before pressing Execute. PREFLIGHT is what -Create builds.
#
# WHAT THIS NEVER DOES: it does not touch the production Concierge, does not activate anything,
# does not expose the credential-bearing child to MCP, and writes exactly one row whose chat_id
# has never reached a Telegram node.

[CmdletBinding()]
param(
    [switch]$Create,
    [switch]$Show,
    [switch]$Teardown,
    [switch]$EnableParentMcp,
    [ValidateSet('PREFLIGHT', 'WRITE', 'CLEANUP')][string]$Mode
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here

# Variables the owner sets mid-session are not inherited by an already-running process.
$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$ParentName    = '[TEMP] P71 sheet probe driver'
$ChildName     = '[TEMP] P71 Bot_Sessions AW column probe'
$ProdExport    = Join-Path $Root 'n8n/production/mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'
$SheetsCred    = @{ googleSheetsOAuth2Api = @{ id = 'PzVCuEPa9YF3YSaD'; name = 'Google Sheets OAuth2 API' } }
$DocId         = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$SheetGid      = 1584265787
$ChildNodeCnt  = 18
$ParentNodeCnt = 4

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

function Copy-Json { param($o) if ($null -eq $o) { return $null } ($o | ConvertTo-Json -Depth 100) | ConvertFrom-Json }
function Get-JsonHash {
    param($o)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $txt = ($o | ConvertTo-Json -Depth 100 -Compress)
    ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($txt)) | ForEach-Object { $_.ToString('x2') }) -join ''
}

# ------------------------------------------------------------------ production parameters
if (-not (Test-Path $ProdExport)) { Fail "the tracked Concierge export is missing: $ProdExport" }
$Prod = Get-Content -Path $ProdExport -Raw | ConvertFrom-Json
$ProdRead = $Prod.nodes | Where-Object { $_.name -eq 'Read Bot Sessions' }
$ProdSave = $Prod.nodes | Where-Object { $_.name -eq 'Save Bot Session' }
if ($null -eq $ProdRead) { Fail 'Read Bot Sessions is not in the tracked export' }
if ($null -eq $ProdSave) { Fail 'Save Bot Session is not in the tracked export' }
if ($ProdRead.parameters.options.dataLocationOnSheet.values.range -ne 'A:AV') {
    Fail "the production read range is '$($ProdRead.parameters.options.dataLocationOnSheet.values.range)', not A:AV. F14 has moved -- re-derive it before probing."
}
if ($ProdSave.parameters.columns.mappingMode -ne 'autoMapInputData') {
    Fail 'the production write no longer auto-maps. F15 has moved -- re-derive it before probing.'
}

$ReadAvParams = Copy-Json $ProdRead.parameters
$ReadAzParams = Copy-Json $ProdRead.parameters
$ReadAzParams.options.dataLocationOnSheet.values.range = 'A:AZ'
$SaveParams   = Copy-Json $ProdSave.parameters

$ProdReadHash = Get-JsonHash $ProdRead.parameters
$ProdSaveHash = Get-JsonHash $ProdSave.parameters

# ------------------------------------------------------------------ the child code bodies

$CollapseCode = @'
// Collapse to a single item. A Google Sheets read node runs once per INPUT item, so feeding it
// the previous read's rows would re-read the sheet ~30 times and duplicate every row.
return [{ json: { collapsed: true, from: $input.all().length } }];
'@

$PlanCode = @'
// P7.1 -- decide what this run does, and refuse anything the phase did not authorise.
//
// This node also performs the MINT, in a real n8n Code node, through require('crypto') -- the
// only form P7.0's exec 3651 found to answer on this tenant. If the platform ever changes
// under us this throws here, in a disposable probe, instead of on the /start path.

const PROBE_CHAT_ID    = '900000701';
const PROBE_SESSION_ID = 'p71-f14-f15';
const PROBE_STATUS     = 'qa_p71';
const PROBE_CYCLE_ID   = 'C-900000701-P71';
const B21C = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];

const mode = String((($('Probe Trigger').first().json) || {}).mode || '');
if (['PREFLIGHT', 'WRITE', 'CLEANUP'].indexOf(mode) === -1) {
  throw new Error('unknown mode: ' + JSON.stringify(mode));
}
// GUARD 1 -- the reserved synthetic range. Anything outside it belongs to a real person.
if (!/^900000[0-9]{3}$/.test(PROBE_CHAT_ID)) {
  throw new Error('probe chat_id is outside the reserved synthetic range');
}

const av = $('Read AV Pre').all().map((i) => i.json || {});
const az = $('Read AZ Pre').all().map((i) => i.json || {});
if (!av.length) { throw new Error('the A:AV read returned no rows at all'); }
if (!az.length) { throw new Error('the A:AZ read returned no rows at all'); }

const cell = (r, c) => (r[c] === undefined || r[c] === null) ? '' : String(r[c]);
const keyUnion = (rows) => {
  const s = {};
  rows.forEach((r) => Object.keys(r).forEach((k) => { s[k] = 1; }));
  return Object.keys(s).sort();
};
const populated = (rows, c) => rows.filter((r) => cell(r, c) !== '').length;
const isProbe = (r) => cell(r, 'chat_id') === PROBE_CHAT_ID;

const existing = az.filter(isProbe);
// GUARD 2 -- appendOrUpdate matches on chat_id, so an existing row would be OVERWRITTEN.
if (mode !== 'CLEANUP' && existing.length !== 0) {
  throw new Error('chat_id ' + PROBE_CHAT_ID + ' already has ' + existing.length
    + ' row(s) -- refusing, because appendOrUpdate would overwrite rather than append');
}
if (mode === 'CLEANUP' && existing.length !== 1) {
  throw new Error('cleanup expects exactly one probe row, found ' + existing.length);
}

let submissionKey = '';
if (mode === 'WRITE') {
  const rb = require('crypto').randomBytes;
  if (typeof rb !== 'function') { throw new Error('require(crypto).randomBytes is not a function'); }
  const buf = rb(16);
  if (!buf || buf.length !== 16) { throw new Error('randomBytes did not return 16 bytes'); }
  let hex = '';
  for (let i = 0; i < 16; i++) {
    const b = buf[i];
    if (!Number.isInteger(b) || b < 0 || b > 255) { throw new Error('randomBytes returned a non-byte at ' + i); }
    hex += b.toString(16).padStart(2, '0');
  }
  submissionKey = 'sub_' + hex;
  if (!/^sub_[0-9a-f]{32}$/.test(submissionKey)) { throw new Error('the mint produced a malformed key'); }
}

const out = {
  mode: mode,
  probe_chat_id: PROBE_CHAT_ID,
  PRE_AV_ROWS: av.length,
  PRE_AZ_ROWS: az.length,
  PRE_AV_KEY_UNION: keyUnion(av).length,
  PRE_AZ_KEY_UNION: keyUnion(az).length,
  PRE_AV_SEES_SUBMISSION_KEY: keyUnion(av).indexOf('submission_key') !== -1,
  PRE_AZ_SEES_SUBMISSION_KEY: keyUnion(az).indexOf('submission_key') !== -1,
  PRE_B21C_POPULATED: B21C.map((c) => c + '=' + populated(az, c)).join(' '),
  PRE_PROBE_ROWS: existing.length,
  submission_key: submissionKey
};

if (mode === 'WRITE') {
  const now = new Date().toISOString();
  out.__row = {
    session_id: PROBE_SESSION_ID,
    chat_id: PROBE_CHAT_ID,
    cycle_id: PROBE_CYCLE_ID,
    state: 'MENU',
    status: PROBE_STATUS,
    created_at: now,
    updated_at: now,
    submission_key: submissionKey,
    lead_mode: 'new',
    lead_priority: 'p71',
    financial_zone: 'p71',
    // THE CONTROL. There is no such column. If this survives the round trip the probe is
    // measuring something other than header matching, and every other result here is suspect.
    p71_absent_column: 'MUST_BE_DROPPED'
  };
}
return [{ json: out }];
'@

$BuildRowCode = @'
// The item handed to autoMapInputData IS the row: its top-level keys are matched by name
// against the live header row. Nothing else may be on it.
const plan = $('Plan').first().json || {};
if (String(plan.mode) !== 'WRITE') { throw new Error('the write path was reached in mode ' + plan.mode); }
const row = plan.__row;
if (!row || typeof row !== 'object') { throw new Error('the plan carried no row to write'); }
if (!/^sub_[0-9a-f]{32}$/.test(String(row.submission_key || ''))) { throw new Error('the row carries no well-formed key'); }
if (!/^900000[0-9]{3}$/.test(String(row.chat_id || ''))) { throw new Error('the row chat_id is outside the reserved range'); }
return [{ json: row }];
'@

$SelectDeleteCode = @'
// P7.1 cleanup -- one row, positively identified on five independent fields, or nothing.
const PROBE_CHAT_ID    = '900000701';
const PROBE_SESSION_ID = 'p71-f14-f15';
const PROBE_STATUS     = 'qa_p71';
const PROBE_CYCLE_ID   = 'C-900000701-P71';

const cell = (r, c) => (r[c] === undefined || r[c] === null) ? '' : String(r[c]);
const rows = $('Read AZ Pre').all().map((i) => i.json || {});
const hits = rows.filter((r) => cell(r, 'chat_id') === PROBE_CHAT_ID);

if (hits.length !== 1) { throw new Error('expected exactly one probe row, found ' + hits.length); }
const t = hits[0];
if (cell(t, 'session_id') !== PROBE_SESSION_ID) { throw new Error('REFUSING DELETE: session_id is ' + cell(t, 'session_id')); }
if (cell(t, 'status')     !== PROBE_STATUS)     { throw new Error('REFUSING DELETE: status is ' + cell(t, 'status')); }
if (cell(t, 'cycle_id')   !== PROBE_CYCLE_ID)   { throw new Error('REFUSING DELETE: cycle_id is ' + cell(t, 'cycle_id')); }
// A row carrying a lead_id has reached the CRM and is not disposable, whatever else it says.
if (cell(t, 'lead_id') !== '') { throw new Error('REFUSING DELETE: the row carries lead_id ' + cell(t, 'lead_id')); }
const rn = Number(t.row_number);
if (!Number.isInteger(rn) || rn <= 1) { throw new Error('REFUSING DELETE: row_number ' + t.row_number + ' is not a data row'); }

return [{ json: { row_number: rn, chat_id: cell(t, 'chat_id'), session_id: cell(t, 'session_id'), cycle_id: cell(t, 'cycle_id') } }];
'@

$PassthroughCode = @'
// PREFLIGHT writes nothing. It exists so the post-read pair runs on every mode, and the
// baseline is therefore measured by the same nodes that measure the result.
return [{ json: { wrote: false, deleted: false } }];
'@

$VerdictCode = @'
// P7.1 verdict. Aggregates and the probe row only -- no customer field value is ever emitted.
const PROBE_CHAT_ID  = '900000701';
const PROBE_CYCLE_ID = 'C-900000701-P71';
const B21C = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];

const plan = $('Plan').first().json || {};
const mode = String(plan.mode);
const cell = (r, c) => (r[c] === undefined || r[c] === null) ? '' : String(r[c]);
const has  = (r, c) => Object.prototype.hasOwnProperty.call(r, c);
const populated = (rows, c) => rows.filter((r) => cell(r, c) !== '').length;
const isProbe = (r) => cell(r, 'chat_id') === PROBE_CHAT_ID;

const avPost = $('Read AV Post').all().map((i) => i.json || {});
const azPost = $('Read AZ Post').all().map((i) => i.json || {});
const avProbe = avPost.filter(isProbe);
const azProbe = azPost.filter(isProbe);

const out = {
  MODE: mode,
  PRE_AV_ROWS: plan.PRE_AV_ROWS,
  PRE_AZ_ROWS: plan.PRE_AZ_ROWS,
  PRE_AV_SEES_SUBMISSION_KEY: plan.PRE_AV_SEES_SUBMISSION_KEY,
  PRE_AZ_SEES_SUBMISSION_KEY: plan.PRE_AZ_SEES_SUBMISSION_KEY,
  PRE_B21C_POPULATED: plan.PRE_B21C_POPULATED,
  POST_AV_ROWS: avPost.length,
  POST_AZ_ROWS: azPost.length,
  POST_PROBE_ROWS_AV: avProbe.length,
  POST_PROBE_ROWS_AZ: azProbe.length,
  POST_B21C_POPULATED: B21C.map((c) => c + '=' + populated(azPost, c)).join(' '),
  // No row outside the probe may gain a B.2.1-C value. The no-backfill guarantee, measured
  // rather than asserted.
  OTHER_ROWS_WITH_B21C: azPost.filter((r) => !isProbe(r)).filter((r) => B21C.some((c) => cell(r, c) !== '')).length
};

if (mode === 'WRITE') {
  const expect = String(plan.submission_key || '');
  if (!/^sub_[0-9a-f]{32}$/.test(expect)) { throw new Error('the plan carried no minted key'); }
  const a = avProbe.length === 1 ? avProbe[0] : {};
  const z = azProbe.length === 1 ? azProbe[0] : {};

  // F14 -- the SAME row, at the SAME moment, through two reads that differ in ONE field.
  // AV must find the row and must see cycle_id (AQ, column 43), which proves the read is
  // healthy and the truncation is specifically past AV rather than somewhere earlier.
  out.F14_ROW_VISIBLE_THROUGH_AV = avProbe.length === 1;
  out.F14_AV_SEES_cycle_id       = cell(a, 'cycle_id') === PROBE_CYCLE_ID;
  out.F14_AV_SEES_submission_key = has(a, 'submission_key');
  out.F14_AV_FIELDS              = Object.keys(a).length;
  out.F14_AZ_SEES_submission_key = has(z, 'submission_key');
  out.F14_AZ_FIELDS              = Object.keys(z).length;
  out.F14_CLOSED                 = (avProbe.length === 1) && (cell(a, 'cycle_id') === PROBE_CYCLE_ID)
                                   && !has(a, 'submission_key') && has(z, 'submission_key');

  // F15 -- did autoMapInputData, carrying the production 40-entry schema, persist the key?
  out.F15_KEY_READBACK           = cell(z, 'submission_key');
  out.F15_KEY_PERSISTED          = cell(z, 'submission_key') === expect;
  out.F15_lead_mode              = cell(z, 'lead_mode');
  out.F15_lead_priority          = cell(z, 'lead_priority');
  out.F15_financial_zone         = cell(z, 'financial_zone');
  out.F15_ALL_FOUR_PERSISTED     = cell(z, 'submission_key') === expect && cell(z, 'lead_mode') === 'new'
                                   && cell(z, 'lead_priority') === 'p71' && cell(z, 'financial_zone') === 'p71';
  // The control. An unrecognised key must still be dropped, or this measures nothing.
  out.CONTROL_UNKNOWN_KEY_DROPPED = !has(z, 'p71_absent_column');
  out.CYCLE_ID_PERSISTED          = cell(z, 'cycle_id') === PROBE_CYCLE_ID;
  out.F15_CLOSED                  = out.F15_ALL_FOUR_PERSISTED && out.CONTROL_UNKNOWN_KEY_DROPPED;
}

if (mode === 'CLEANUP') {
  const target = $('Select Delete Target').first().json || {};
  const cells = B21C.reduce((n, c) => n + populated(azPost, c), 0);
  out.DELETED_ROW_NUMBER           = target.row_number;
  out.CLEANUP_PROBE_ROWS_REMAINING = azProbe.length;
  out.CLEANUP_B21C_CELLS_REMAINING = cells;
  out.CLEANUP_CLEAN                = azProbe.length === 0 && cells === 0;
}

return [{ json: out }];
'@

# ------------------------------------------------------------------ graphs

function New-ChildWorkflow {
    $sheetRl = @{ __rl = $true; mode = 'list'; value = $SheetGid; cachedResultName = 'Bot_Sessions' }
    @{
        name = $ChildName
        nodes = @(
            @{ id = 'p71c-trigger'; name = 'Probe Trigger'; type = 'n8n-nodes-base.executeWorkflowTrigger'; typeVersion = 1.2; position = @(0, 0); parameters = @{ inputSource = 'passthrough' } },
            @{ id = 'p71c-readav1'; name = 'Read AV Pre'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(200, 0); parameters = (Copy-Json $ReadAvParams); credentials = $SheetsCred },
            @{ id = 'p71c-col1'; name = 'Collapse Pre'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(400, 0); parameters = @{ jsCode = $CollapseCode } },
            @{ id = 'p71c-readaz1'; name = 'Read AZ Pre'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(600, 0); parameters = (Copy-Json $ReadAzParams); credentials = $SheetsCred },
            @{ id = 'p71c-col2'; name = 'Collapse Pre 2'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(800, 0); parameters = @{ jsCode = $CollapseCode } },
            @{ id = 'p71c-plan'; name = 'Plan'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1000, 0); parameters = @{ jsCode = $PlanCode } },
            @{ id = 'p71c-ifw'; name = 'IF Write'; type = 'n8n-nodes-base.if'; typeVersion = 2.2; position = @(1200, 0)
               parameters = @{
                   conditions = @{
                       options    = @{ caseSensitive = $true; leftValue = ''; typeValidation = 'strict'; version = 2 }
                       conditions = @(@{ id = 'p71c-cw'; leftValue = '={{ $json.mode }}'; rightValue = 'WRITE'; operator = @{ type = 'string'; operation = 'equals' } })
                       combinator = 'and'
                   }
                   options = @{}
               } },
            @{ id = 'p71c-buildrow'; name = 'Build Probe Row'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1400, -180); parameters = @{ jsCode = $BuildRowCode } },
            @{ id = 'p71c-save'; name = 'Save Probe Row'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(1600, -180); parameters = (Copy-Json $SaveParams); credentials = $SheetsCred },
            @{ id = 'p71c-ifc'; name = 'IF Cleanup'; type = 'n8n-nodes-base.if'; typeVersion = 2.2; position = @(1400, 180)
               parameters = @{
                   conditions = @{
                       options    = @{ caseSensitive = $true; leftValue = ''; typeValidation = 'strict'; version = 2 }
                       conditions = @(@{ id = 'p71c-cc'; leftValue = '={{ $json.mode }}'; rightValue = 'CLEANUP'; operator = @{ type = 'string'; operation = 'equals' } })
                       combinator = 'and'
                   }
                   options = @{}
               } },
            @{ id = 'p71c-seldel'; name = 'Select Delete Target'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1600, 100); parameters = @{ jsCode = $SelectDeleteCode } },
            @{ id = 'p71c-del'; name = 'Delete Probe Row'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(1800, 100)
               parameters = @{
                   resource       = 'sheet'
                   operation      = 'delete'
                   documentId     = @{ __rl = $true; mode = 'id'; value = $DocId }
                   sheetName      = $sheetRl
                   toDelete       = 'rows'
                   startIndex     = '={{ $json.row_number }}'
                   numberToDelete = 1
               }
               credentials = $SheetsCred },
            @{ id = 'p71c-pass'; name = 'No Mutation'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1600, 320); parameters = @{ jsCode = $PassthroughCode } },
            @{ id = 'p71c-col3'; name = 'Collapse Post'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(2000, 0); parameters = @{ jsCode = $CollapseCode } },
            @{ id = 'p71c-readav2'; name = 'Read AV Post'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(2200, 0); parameters = (Copy-Json $ReadAvParams); credentials = $SheetsCred },
            @{ id = 'p71c-col4'; name = 'Collapse Post 2'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(2400, 0); parameters = @{ jsCode = $CollapseCode } },
            @{ id = 'p71c-readaz2'; name = 'Read AZ Post'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(2600, 0); parameters = (Copy-Json $ReadAzParams); credentials = $SheetsCred },
            @{ id = 'p71c-verdict'; name = 'Verdict'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(2800, 0); parameters = @{ jsCode = $VerdictCode } }
        )
        connections = @{
            'Probe Trigger'        = @{ main = @(, @(@{ node = 'Read AV Pre'; type = 'main'; index = 0 })) }
            'Read AV Pre'          = @{ main = @(, @(@{ node = 'Collapse Pre'; type = 'main'; index = 0 })) }
            'Collapse Pre'         = @{ main = @(, @(@{ node = 'Read AZ Pre'; type = 'main'; index = 0 })) }
            'Read AZ Pre'          = @{ main = @(, @(@{ node = 'Collapse Pre 2'; type = 'main'; index = 0 })) }
            'Collapse Pre 2'       = @{ main = @(, @(@{ node = 'Plan'; type = 'main'; index = 0 })) }
            'Plan'                 = @{ main = @(, @(@{ node = 'IF Write'; type = 'main'; index = 0 })) }
            'IF Write'             = @{ main = @(@(@{ node = 'Build Probe Row'; type = 'main'; index = 0 }), @(@{ node = 'IF Cleanup'; type = 'main'; index = 0 })) }
            'Build Probe Row'      = @{ main = @(, @(@{ node = 'Save Probe Row'; type = 'main'; index = 0 })) }
            'Save Probe Row'       = @{ main = @(, @(@{ node = 'Collapse Post'; type = 'main'; index = 0 })) }
            'IF Cleanup'           = @{ main = @(@(@{ node = 'Select Delete Target'; type = 'main'; index = 0 }), @(@{ node = 'No Mutation'; type = 'main'; index = 0 })) }
            'Select Delete Target' = @{ main = @(, @(@{ node = 'Delete Probe Row'; type = 'main'; index = 0 })) }
            'Delete Probe Row'     = @{ main = @(, @(@{ node = 'Collapse Post'; type = 'main'; index = 0 })) }
            'No Mutation'          = @{ main = @(, @(@{ node = 'Collapse Post'; type = 'main'; index = 0 })) }
            'Collapse Post'        = @{ main = @(, @(@{ node = 'Read AV Post'; type = 'main'; index = 0 })) }
            'Read AV Post'         = @{ main = @(, @(@{ node = 'Collapse Post 2'; type = 'main'; index = 0 })) }
            'Collapse Post 2'      = @{ main = @(, @(@{ node = 'Read AZ Post'; type = 'main'; index = 0 })) }
            'Read AZ Post'         = @{ main = @(, @(@{ node = 'Verdict'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function New-ModeCode {
    param([string]$M)
    "// P7.1 probe mode. PREFLIGHT reads only. WRITE appends ONE synthetic row. CLEANUP deletes it.`nreturn [{ json: { mode: '$M' } }];"
}

function New-ParentWorkflow {
    param([string]$ChildId)
    @{
        name = $ParentName
        nodes = @(
            @{ id = 'p71p-start'; name = 'Start'; type = 'n8n-nodes-base.manualTrigger'; typeVersion = 1; position = @(0, 0); parameters = @{} },
            @{ id = 'p71p-mode'; name = 'Mode'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(220, 0); parameters = @{ jsCode = (New-ModeCode 'PREFLIGHT') } },
            @{ id = 'p71p-call'; name = 'Call Probe'; type = 'n8n-nodes-base.executeWorkflow'; typeVersion = 1.3; position = @(440, 0)
               parameters = @{
                   mode       = 'each'
                   source     = 'database'
                   workflowId = @{ __rl = $true; mode = 'id'; value = $ChildId }
                   options    = @{ waitForSubWorkflow = $true }
               } },
            @{ id = 'p71p-collect'; name = 'Collect'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(660, 0)
               parameters = @{ jsCode = 'return $input.all().map((it) => ({ json: it.json }));' } }
        )
        connections = @{
            'Start'      = @{ main = @(, @(@{ node = 'Mode'; type = 'main'; index = 0 })) }
            'Mode'       = @{ main = @(, @(@{ node = 'Call Probe'; type = 'main'; index = 0 })) }
            'Call Probe' = @{ main = @(, @(@{ node = 'Collect'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function Get-Existing {
    # LIVE FIRST: re-creating a pair leaves an ARCHIVED namesake behind, and a plain name match
    # can return the dead one while the live one keeps running.
    $all = Get-N8nWorkflowList
    $pick = {
        param($name)
        $all | Where-Object { $_.name -eq $name } |
            Sort-Object -Property @{ Expression = { [bool]$_.isArchived } }, @{ Expression = { $_.createdAt }; Descending = $true } |
            Select-Object -First 1
    }
    [pscustomobject]@{ Parent = & $pick $ParentName; Child = & $pick $ChildName }
}

if (-not ($Create -or $Show -or $Teardown -or $EnableParentMcp -or $Mode)) {
    Fail 'choose one of -Create, -Show, -EnableParentMcp, -Mode <PREFLIGHT|WRITE|CLEANUP>, -Teardown.'
}

Say ''
Say '== P7.1 Bot_Sessions AW COLUMN PROBE ======================'
Say "  tenant   : $($env:N8N_BASE_URL)"
Say "  document : $DocId  (Bot_Sessions, gid $SheetGid)"
Say "  read AV  : $($ReadAvParams.options.dataLocationOnSheet.values.range)   (production, verbatim)"
Say "  read AZ  : $($ReadAzParams.options.dataLocationOnSheet.values.range)   (production + one changed field)"

$existing = Get-Existing

if ($Show) {
    Say ''
    Say ("  parent : " + $(if ($existing.Parent) { "$($existing.Parent.id)  archived=$($existing.Parent.isArchived)" } else { 'absent' }))
    Say ("  child  : " + $(if ($existing.Child)  { "$($existing.Child.id)  archived=$($existing.Child.isArchived)" } else { 'absent' }))
    if ($existing.Parent -and -not $existing.Parent.isArchived) {
        $p = Get-N8nWorkflow -Id $existing.Parent.id
        $m = ($p.nodes | Where-Object { $_.name -eq 'Mode' }).parameters.jsCode
        $armed = if ($m -match "mode: '([A-Z]+)'") { $Matches[1] } else { 'UNKNOWN' }
        Say "  armed  : $armed    parentMcp=$($p.settings.availableInMCP)  active=$($p.active)"
    }
    Say ''
    exit 0
}

if ($Create) {
    if ($existing.Child  -and -not $existing.Child.isArchived)  { Fail "the child already exists and is live: $($existing.Child.id). Use -Teardown first." }
    if ($existing.Parent -and -not $existing.Parent.isArchived) { Fail "the parent already exists and is live: $($existing.Parent.id). Use -Teardown first." }

    Say ''
    Say '-- creating the child (holds the credential, MCP-invisible) --'
    $child = Invoke-N8n -Method POST -Path '/workflows' -Write -Body (New-ChildWorkflow)
    if (-not $child.id) { Fail 'the API returned no child id; check the UI before retrying.' }
    Ok "child created: $($child.id)"

    $liveChild = Get-N8nWorkflow -Id $child.id
    if ($liveChild.active) { Fail "the child came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($child.id)" }
    if ($liveChild.settings.availableInMCP) { Fail "the child came back MCP-exposed: $($child.id)" }
    if ($liveChild.nodes.Count -ne $ChildNodeCnt) { Fail "the child has $($liveChild.nodes.Count) nodes, expected $ChildNodeCnt" }
    Ok "child inactive, MCP-invisible, $ChildNodeCnt nodes"

    # FIDELITY. The whole point of the probe is that it runs the PRODUCTION configuration, so
    # prove that against the LIVE object rather than against the local hashtable that made it.
    $liveAv  = ($liveChild.nodes | Where-Object { $_.name -eq 'Read AV Pre' }).parameters
    $liveAv2 = ($liveChild.nodes | Where-Object { $_.name -eq 'Read AV Post' }).parameters
    $liveAz  = ($liveChild.nodes | Where-Object { $_.name -eq 'Read AZ Pre' }).parameters
    $liveAz2 = ($liveChild.nodes | Where-Object { $_.name -eq 'Read AZ Post' }).parameters
    $liveSv  = ($liveChild.nodes | Where-Object { $_.name -eq 'Save Probe Row' }).parameters
    if ((Get-JsonHash $liveAv)  -ne $ProdReadHash) { Fail 'Read AV Pre does not match the production Read Bot Sessions parameters' }
    if ((Get-JsonHash $liveAv2) -ne $ProdReadHash) { Fail 'Read AV Post does not match the production Read Bot Sessions parameters' }
    if ((Get-JsonHash $liveSv)  -ne $ProdSaveHash) { Fail 'Save Probe Row does not match the production Save Bot Session parameters' }
    Ok 'both A:AV reads and the write carry the PRODUCTION parameters byte-for-byte'

    # And the widened reads differ from production in exactly one field.
    foreach ($az in @($liveAz, $liveAz2)) {
        $probe = Copy-Json $az
        if ($probe.options.dataLocationOnSheet.values.range -ne 'A:AZ') { Fail 'a widened read is not A:AZ' }
        $probe.options.dataLocationOnSheet.values.range = 'A:AV'
        if ((Get-JsonHash $probe) -ne $ProdReadHash) { Fail 'a widened read differs from production in more than the range' }
    }
    Ok 'both widened reads differ from production in EXACTLY one field: range A:AV -> A:AZ'

    $sk = @($liveSv.columns.schema | ForEach-Object { $_.id })
    if ($sk -contains 'submission_key') { Fail 'the production write schema now lists submission_key -- F15 has moved' }
    if ($sk -contains 'cycle_id')       { Fail 'the production write schema now lists cycle_id -- the F15 prior has moved' }
    Ok "the write carries the production $($sk.Count)-entry schema, listing neither submission_key nor cycle_id"

    Say ''
    Say '-- creating the parent (credential-free driver) --'
    $parent = Invoke-N8n -Method POST -Path '/workflows' -Write -Body (New-ParentWorkflow -ChildId $child.id)
    if (-not $parent.id) { Fail 'the API returned no parent id; check the UI before retrying.' }
    $liveParent = Get-N8nWorkflow -Id $parent.id
    if ($liveParent.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($parent.id)" }
    if ($liveParent.nodes.Count -ne $ParentNodeCnt) { Fail "the parent has $($liveParent.nodes.Count) nodes, expected $ParentNodeCnt" }
    if (@($liveParent.nodes | Where-Object { $_.PSObject.Properties['credentials'] -and $_.credentials }).Count -ne 0) { Fail 'the parent holds a credential and must not' }
    Ok "parent created: $($parent.id)  inactive, credential-free, $ParentNodeCnt nodes, armed PREFLIGHT"

    Say ''
    Say '  next: -EnableParentMcp, then -Mode PREFLIGHT, then run the parent with test_workflow.'
    Say ''
    exit 0
}

if ($EnableParentMcp) {
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    if ($null -eq $existing.Child)  { Fail "'$ChildName' does not exist. Run -Create first." }
    if ($existing.Child.settings.availableInMCP) { Fail "the CHILD is MCP-exposed and must not be: $($existing.Child.id)" }

    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.nodes.Count -ne $ParentNodeCnt) { Fail "the parent is not the $ParentNodeCnt-node harness ($($p.nodes.Count) nodes). Refusing." }
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing to expose a running workflow.' }

    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    $settings['availableInMCP'] = $true
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{ name = $p.name; nodes = $p.nodes; connections = $p.connections; settings = $settings } | Out-Null

    $back = Get-N8nWorkflow -Id $p.id
    if (-not $back.settings.availableInMCP) { Fail 'the setting did not stick.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    if ($back.nodes.Count -ne $ParentNodeCnt) { Fail 'the parent graph changed on write. Inspect it by hand.' }
    Ok "parent $($p.id) is MCP-available, still inactive, graph unchanged"
    Say ''
    exit 0
}

if ($Mode) {
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing.' }
    if ($p.nodes.Count -ne $ParentNodeCnt) { Fail "the parent is not the $ParentNodeCnt-node harness ($($p.nodes.Count) nodes). Refusing." }

    $nodes = @(); $touched = 0
    foreach ($n in $p.nodes) {
        if ($n.name -eq 'Mode') { $n.parameters.jsCode = (New-ModeCode $Mode); $touched++ }
        $nodes += $n
    }
    if ($touched -ne 1) { Fail "expected exactly one 'Mode' node, found $touched. Refusing." }

    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{ name = $p.name; nodes = $nodes; connections = $p.connections; settings = $settings } | Out-Null

    $back = Get-N8nWorkflow -Id $p.id
    $js = ($back.nodes | Where-Object { $_.name -eq 'Mode' }).parameters.jsCode
    if ($js -notmatch "mode: '$Mode'") { Fail 'the mode did not stick.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    if ($back.nodes.Count -ne $ParentNodeCnt) { Fail 'the parent graph changed on write. Inspect it by hand.' }

    Say ''
    Ok "ARMED $Mode on parent $($back.id)"
    if ($Mode -eq 'WRITE')   { Say '  the next run APPENDS one row with chat_id 900000701 to the live Bot_Sessions sheet.' }
    if ($Mode -eq 'CLEANUP') { Say '  the next run DELETES that row. It refuses unless exactly one row matches on five fields.' }
    Say ''
    exit 0
}

if ($Teardown) {
    $done = 0
    foreach ($w in @($existing.Parent, $existing.Child)) {
        if ($null -eq $w) { continue }
        if ($w.isArchived) { Say "  already archived: $($w.id)  $($w.name)"; continue }
        $live = Get-N8nWorkflow -Id $w.id
        if ($live.active) { Fail "$($w.id) is ACTIVE. DEACTIVATE IT BY HAND before archiving." }
        # Strip MCP exposure before archiving, so an unarchive cannot restore a reachable driver.
        $settings = @{}
        foreach ($prop in $live.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
        $settings['availableInMCP'] = $false
        Invoke-N8n -Method PUT -Path "/workflows/$($w.id)" -Write -Body @{ name = $live.name; nodes = $live.nodes; connections = $live.connections; settings = $settings } | Out-Null
        $back = Get-N8nWorkflow -Id $w.id
        if ($back.settings.availableInMCP) { Fail "$($w.id) came back MCP-exposed" }
        Invoke-N8n -Method POST -Path "/workflows/$($w.id)/archive" -Write | Out-Null
        $after = Get-N8nWorkflow -Id $w.id
        if (-not $after.isArchived) { Fail "$($w.id) did not archive" }
        Ok "archived $($w.id)  $($w.name)"
        $done++
    }
    Say ''
    Say "  archived $done workflow(s)."
    Say ''
    exit 0
}
