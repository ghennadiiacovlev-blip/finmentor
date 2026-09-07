# FINMENTOR - P7.1b guarded sweep of the SIX dead trailing columns AZ:BE on Bot_Sessions.
#
#   pwsh scripts/p71b-column-sweep.ps1 -Create            # build the disposable parent/child pair
#   pwsh scripts/p71b-column-sweep.ps1 -Show              # what exists right now
#   pwsh scripts/p71b-column-sweep.ps1 -EnableParentMcp   # let test_workflow start the parent
#   pwsh scripts/p71b-column-sweep.ps1 -Mode AUDIT        # arm: read-only. Proves, deletes nothing.
#   pwsh scripts/p71b-column-sweep.ps1 -Mode SWEEP        # arm: re-prove, then delete AZ:BE
#   pwsh scripts/p71b-column-sweep.ps1 -Teardown          # archive the pair
#
# WHAT IS BEING DELETED AND WHY.
# P7.1 measured the live header row of Bot_Sessions from a full-width row (exec 3660). The tail is:
#
#     AV 48  submission_key    |  AZ 52  key                        <- dead, P2/P4 canary
#     AW 49  lead_mode         |  BA 53  __rows_seen                <- dead, P6-RESUME canary
#     AX 50  lead_priority     |  BB 54  __advance                  <- dead, P6-RESUME canary
#     AY 51  financial_zone    |  BC 55  __reason                   <- dead, P6-RESUME canary
#                              |  BD 56  __verified_submission_key  <- dead, P4 canary
#                              |  BE 57  p71_absent_column          <- dead, P7.1 control
#
# AV:AY is the intended production tail. AZ:BE is residue: six columns nothing designed, created
# one at a time by `Save Bot Session`, whose autoMapInputData does NOT drop an unrecognised key -
# P7.1 proved it APPENDS A NEW COLUMN for it. That is finding F16 and it is why this residue exists.
#
# WHY THIS IS SAFE TO DELETE AND WHY THE SCRIPT STILL REFUSES TO TRUST THAT.
# Nothing recreates these columns: the production Concierge export - the ONLY tracked writer of
# Bot_Sessions - contains zero occurrences of all six names and no bare `key:` property anywhere.
# -Create re-runs that scan against the tracked tree and refuses if it ever stops being true.
# Everything else is proven LIVE, in the same execution, microseconds before the delete:
#
#   P1  the six ARE the physical trailing columns, in that order, at 52..57
#   P2  AV:AY are exactly submission_key, lead_mode, lead_priority, financial_zone
#   P3  every cell in AZ:BE is empty on every row - no customer or business data
#   P4  no row anywhere extends past BE
#   P5  no synthetic 900000xxx row is left on the sheet
#
# and AFTER the delete, in the same execution:
#
#   P6  the header ends exactly at AY financial_zone, 51 columns
#   P7  the grid lost exactly 6 columns
#   P8  A:AY is IDENTICAL cell-for-cell to the pre-image, every row, byte for byte
#   P9  the row count is unchanged
#
# P8 is the load-bearing one and it is a real comparison, not a hash of a summary: the post proof
# reads the PRE values node and the POST values node and walks every cell of A:AY in both. No Code
# node ever emits a customer value - only counts, booleans, header names and a digest.
#
# WHY THE SHEETS NODE IS NOT USED. Its delete operation takes a column INDEX whose base is a UI
# detail; the Sheets v4 API deleteDimension takes an explicit 0-based half-open range, so the
# request says startIndex 51, endIndex 57 and cannot be off by one silently. It is also ONE
# request - the sweep is a single atomic batchUpdate, not six.
#
# WHY A PARENT AND A CHILD. `test_workflow` PINS every credential-bearing node and every HTTP
# Request node in the workflow it runs. A single workflow would report a confident success while
# touching nothing. The child is invoked as a SUB-workflow and executes for real.

[CmdletBinding()]
param(
    [switch]$Create,
    [switch]$Show,
    [switch]$Teardown,
    [switch]$EnableParentMcp,
    [ValidateSet('AUDIT', 'SWEEP')][string]$Mode
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

$ParentName    = '[TEMP] P71b column sweep driver'
$ChildName     = '[TEMP] P71b Bot_Sessions trailing column sweep'
$ProdExport    = Join-Path $Root 'n8n/production/mppzthlkSJFr6Kle.finmentor-telegram-client-concierge-premium-ai-guarded.json'
$SheetsCred    = @{ googleSheetsOAuth2Api = @{ id = 'PzVCuEPa9YF3YSaD'; name = 'Google Sheets OAuth2 API' } }
$DocId         = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$SheetGid      = 1584265787
$SheetTitle    = 'Bot_Sessions'
$ChildNodeCnt  = 10
$ParentNodeCnt = 4
$DropNames     = @('key', '__rows_seen', '__advance', '__reason', '__verified_submission_key', 'p71_absent_column')

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

# ------------------------------------------------------------------ offline pre-proof
function Assert-NoTrackedEmitter {
    if (-not (Test-Path $ProdExport)) { Fail "the tracked Concierge export is missing: $ProdExport" }
    $prod = Get-Content -Path $ProdExport -Raw

    # The distinctive five must not appear ANYWHERE in the tracked workflow tree.
    $tree = Get-ChildItem -Path (Join-Path $Root 'n8n') -Recurse -File -Include *.json, *.js
    foreach ($name in @('__rows_seen', '__advance', '__reason', '__verified_submission_key', 'p71_absent_column')) {
        $hit = @($tree | Where-Object { (Get-Content -Path $_.FullName -Raw) -match [regex]::Escape($name) })
        if ($hit.Count) { Fail "'$name' is referenced by tracked code ($($hit[0].Name)) -- it is NOT dead residue. Refusing." }
    }
    # `key` is too common to scan for as a word, so scan for the only form that could make it a
    # Bot_Sessions COLUMN: a bare `key` property on a row object, in the sole tracked writer.
    if ($prod -match '[^_A-Za-z0-9\\"'']key[\\"'']?\s*:') { Fail "the production Concierge contains a bare 'key:' property -- it may write that column. Refusing." }
    foreach ($name in $DropNames) {
        if ($name -eq 'key') { continue }
        if ($prod -match [regex]::Escape($name)) { Fail "'$name' appears in the production Concierge export. Refusing." }
    }
    Ok "no tracked code emits any of the six names (production Concierge is the only tracked Bot_Sessions writer)"
}

# ------------------------------------------------------------------ the child code bodies

$ProvePreCode = @'
// P7.1b -- the LIVE pre-proof. Every guard below must hold or nothing downstream runs.
//
// Emits counts, booleans, header names and a digest. NEVER a customer value: the post proof
// reads the raw values nodes directly, so no cell content has to travel through here.

const SHEET_ID   = 1584265787;
const TITLE      = 'Bot_Sessions';
const KEEP_TAIL  = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone']; // AV..AY 48..51
const DROP       = ['key', '__rows_seen', '__advance', '__reason', '__verified_submission_key', 'p71_absent_column']; // AZ..BE 52..57
const KEEP_COLS  = 51;   // A..AY
const DROP_FROM0 = 51;   // 0-based, inclusive -- column AZ
const DROP_TO0   = 57;   // 0-based, exclusive -- one past BE
const READ_CEIL  = 1000; // the row ceiling of the values read; hitting it means we did not see the sheet
const GRID_CEIL  = 130;  // A..DZ, the column ceiling of the values read

const mode = String((($('Sweep Trigger').first().json) || {}).mode || '');
if (['AUDIT', 'SWEEP'].indexOf(mode) === -1) { throw new Error('unknown mode: ' + JSON.stringify(mode)); }

// ---- the sheet itself
const meta = $('Get Meta Pre').first().json || {};
const props = (meta.sheets || []).map((s) => s.properties || {}).filter((p) => p.title === TITLE);
if (props.length !== 1) { throw new Error('expected exactly one sheet titled ' + TITLE + ', found ' + props.length); }
if (Number(props[0].sheetId) !== SHEET_ID) { throw new Error('sheetId is ' + props[0].sheetId + ', expected ' + SHEET_ID); }
const grid = props[0].gridProperties || {};
const gridCols = Number(grid.columnCount);
const gridRows = Number(grid.rowCount);
if (!Number.isInteger(gridCols) || gridCols < DROP_TO0) { throw new Error('grid columnCount ' + grid.columnCount + ' cannot contain BE'); }
if (gridCols > GRID_CEIL) { throw new Error('grid columnCount ' + gridCols + ' exceeds the A:DZ read window -- widen it before proving anything'); }

// ---- the values. Google truncates TRAILING empty cells, so a short row means empty to the right.
const vals = ($('Get Values Pre').first().json || {}).values || [];
if (!vals.length) { throw new Error('the values read returned nothing'); }
if (vals.length >= READ_CEIL) { throw new Error('the values read hit its ' + READ_CEIL + '-row ceiling; it did not see the whole sheet'); }
const cell = (r, i) => (!r || r[i] === undefined || r[i] === null) ? '' : String(r[i]);
const header = vals[0].map((v, i) => cell(vals[0], i));
const rows = vals.slice(1);

// ---- P1: the six ARE the physical trailing columns, in that order
if (header.length !== DROP_TO0) { throw new Error('the header row is ' + header.length + ' columns wide, expected ' + DROP_TO0); }
for (let i = 0; i < DROP.length; i++) {
  if (header[DROP_FROM0 + i] !== DROP[i]) {
    throw new Error('column ' + (DROP_FROM0 + i + 1) + ' is "' + header[DROP_FROM0 + i] + '", expected "' + DROP[i] + '"');
  }
}
// ---- P2: AV:AY are the intended production tail
for (let i = 0; i < KEEP_TAIL.length; i++) {
  if (header[47 + i] !== KEEP_TAIL[i]) {
    throw new Error('column ' + (48 + i) + ' is "' + header[47 + i] + '", expected "' + KEEP_TAIL[i] + '"');
  }
}
// No kept column may be unnamed, and no name may repeat -- either would make "unchanged" unprovable.
const seen = {};
for (let i = 0; i < KEEP_COLS; i++) {
  if (header[i] === '') { throw new Error('column ' + (i + 1) + ' inside A:AY has an empty header'); }
  if (seen[header[i]]) { throw new Error('duplicate header "' + header[i] + '" inside A:AY'); }
  seen[header[i]] = 1;
}

// ---- P3 + P4: nothing lives at or past AZ, and nothing extends past BE
let dirty = 0, longest = header.length, past = 0;
for (const r of rows) {
  if (r.length > longest) { longest = r.length; }
  if (r.length > DROP_TO0) { past++; }
  for (let i = DROP_FROM0; i < r.length; i++) { if (cell(r, i) !== '') { dirty++; } }
}
if (past)  { throw new Error(past + ' row(s) extend past column BE'); }
if (dirty) { throw new Error(dirty + ' non-empty cell(s) found in AZ:BE -- this is NOT dead residue. Refusing.'); }

// ---- P5: no synthetic residue left behind by any probe
const CHAT = header.indexOf('chat_id');
if (CHAT === -1) { throw new Error('there is no chat_id column'); }
const synthetic = rows.filter((r) => /^900000[0-9]{3}$/.test(cell(r, CHAT))).length;
if (synthetic) { throw new Error(synthetic + ' synthetic 900000xxx row(s) are still on the sheet'); }

// A cheap order-sensitive digest of A:AY, for the record. The real comparison is cell-by-cell
// in the post proof; this only has to make an accidental change visible at a glance.
const SEP_CELL = '<0001>', SEP_ROW = '<0002>';
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
const digest = fnv(rows.map((r) => { const o = []; for (let i = 0; i < KEEP_COLS; i++) { o.push(cell(r, i)); } return o.join(SEP_CELL); }).join(SEP_ROW));

const out = {
  MODE: mode,
  PRE_GRID_COLUMNS: gridCols,
  PRE_GRID_ROWS: gridRows,
  PRE_HEADER_WIDTH: header.length,
  PRE_DATA_ROWS: rows.length,
  PRE_LONGEST_ROW: longest,
  PRE_HEADER_TAIL: header.slice(43).join(' '),
  PRE_KEEP_TAIL_OK: true,
  PRE_DROP_TAIL_OK: true,
  PRE_AZ_BE_NON_EMPTY_CELLS: dirty,
  PRE_ROWS_PAST_BE: past,
  PRE_SYNTHETIC_ROWS: synthetic,
  PRE_A_AY_DIGEST: digest,
  PRE_ALL_GUARDS_PASS: true
};

if (mode === 'SWEEP') {
  // 0-based, half-open: [51, 57) == columns 52..57 == AZ..BE. One request, one atomic operation.
  out.BATCH_REQUEST = {
    requests: [{ deleteDimension: { range: { sheetId: SHEET_ID, dimension: 'COLUMNS', startIndex: DROP_FROM0, endIndex: DROP_TO0 } } }]
  };
  out.DELETING = DROP.join(' ');
}
return [{ json: out }];
'@

$NoMutationCode = @'
// AUDIT deletes nothing. It exists so the post read pair runs on both modes, and the baseline is
// therefore measured by the same nodes that measure the result.
return [{ json: { deleted: false } }];
'@

$ProvePostCode = @'
// P7.1b -- the LIVE post-proof. Compares the raw PRE and POST value grids cell by cell over A:AY.

const SHEET_ID  = 1584265787;
const TITLE     = 'Bot_Sessions';
const KEEP_TAIL = ['submission_key', 'lead_mode', 'lead_priority', 'financial_zone'];
const KEEP_COLS = 51;

const pre  = $('Prove Pre').first().json || {};
const mode = String(pre.MODE);
const cell = (r, i) => (!r || r[i] === undefined || r[i] === null) ? '' : String(r[i]);

const meta = $('Get Meta Post').first().json || {};
const props = (meta.sheets || []).map((s) => s.properties || {}).filter((p) => p.title === TITLE);
if (props.length !== 1) { throw new Error('expected exactly one sheet titled ' + TITLE + ' after the sweep'); }
if (Number(props[0].sheetId) !== SHEET_ID) { throw new Error('the sheetId changed'); }
const gridCols = Number((props[0].gridProperties || {}).columnCount);

const preVals  = ($('Get Values Pre').first().json  || {}).values || [];
const postVals = ($('Get Values Post').first().json || {}).values || [];
if (!postVals.length) { throw new Error('the post values read returned nothing'); }
const postHeader = postVals[0].map((v, i) => cell(postVals[0], i));
const preRows  = preVals.slice(1);
const postRows = postVals.slice(1);

const expectedWidth = (mode === 'SWEEP') ? KEEP_COLS : pre.PRE_HEADER_WIDTH;

// ---- P9: the row count is unchanged
const rowsSame = postRows.length === preRows.length;

// ---- P8: A:AY identical, cell for cell, every row. The load-bearing check.
let diffCells = 0, firstDiffRow = 0, firstDiffCol = 0;
const n = Math.min(preRows.length, postRows.length);
for (let r = 0; r < n; r++) {
  for (let c = 0; c < KEEP_COLS; c++) {
    if (cell(preRows[r], c) !== cell(postRows[r], c)) {
      diffCells++;
      if (!firstDiffRow) { firstDiffRow = r + 2; firstDiffCol = c + 1; }
    }
  }
}
// ---- and the kept headers themselves
let headerDiff = 0;
for (let c = 0; c < KEEP_COLS; c++) { if (cell(preVals[0], c) !== postHeader[c]) { headerDiff++; } }

// ---- P6: the header ends exactly at AY
const endsAtAY = postHeader.length === KEEP_COLS && postHeader[KEEP_COLS - 1] === 'financial_zone';
let keepTailOk = true;
for (let i = 0; i < KEEP_TAIL.length; i++) { if (postHeader[47 + i] !== KEEP_TAIL[i]) { keepTailOk = false; } }

// ---- no row extends past the kept width, and no synthetic residue survives
let past = 0;
for (const r of postRows) { if (r.length > expectedWidth) { past++; } }
const CHAT = postHeader.indexOf('chat_id');
const synthetic = (CHAT === -1) ? -1 : postRows.filter((r) => /^900000[0-9]{3}$/.test(cell(r, CHAT))).length;

const SEP_CELL = '<0001>', SEP_ROW = '<0002>';
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); };
const digest = fnv(postRows.map((r) => { const o = []; for (let i = 0; i < KEEP_COLS; i++) { o.push(cell(r, i)); } return o.join(SEP_CELL); }).join(SEP_ROW));

const out = {
  MODE: mode,
  PRE_GRID_COLUMNS: pre.PRE_GRID_COLUMNS,
  POST_GRID_COLUMNS: gridCols,
  GRID_COLUMNS_LOST: pre.PRE_GRID_COLUMNS - gridCols,
  PRE_HEADER_WIDTH: pre.PRE_HEADER_WIDTH,
  POST_HEADER_WIDTH: postHeader.length,
  POST_HEADER_TAIL: postHeader.slice(43).join(' '),
  PRE_DATA_ROWS: pre.PRE_DATA_ROWS,
  POST_DATA_ROWS: postRows.length,
  ROW_COUNT_UNCHANGED: rowsSame,
  A_AY_CELLS_COMPARED: n * KEEP_COLS,
  A_AY_CELLS_DIFFERENT: diffCells,
  A_AY_FIRST_DIFF: diffCells ? ('row ' + firstDiffRow + ' col ' + firstDiffCol) : 'none',
  A_AY_HEADERS_DIFFERENT: headerDiff,
  PRE_A_AY_DIGEST: pre.PRE_A_AY_DIGEST,
  POST_A_AY_DIGEST: digest,
  DIGEST_MATCH: digest === pre.PRE_A_AY_DIGEST,
  ENDS_AT_AY: endsAtAY,
  KEEP_TAIL_INTACT: keepTailOk,
  ROWS_PAST_KEPT_WIDTH: past,
  SYNTHETIC_ROWS: synthetic
};

if (mode === 'SWEEP') {
  const resp = $('Delete Tail Columns').first().json || {};
  out.DELETED = pre.DELETING;
  out.BATCH_SPREADSHEET_ID = resp.spreadsheetId || '';
  out.SWEEP_CLEAN = endsAtAY && keepTailOk && rowsSame && diffCells === 0 && headerDiff === 0
                    && digest === pre.PRE_A_AY_DIGEST && (pre.PRE_GRID_COLUMNS - gridCols) === 6
                    && past === 0 && synthetic === 0;
} else {
  out.AUDIT_OK = rowsSame && diffCells === 0 && headerDiff === 0 && digest === pre.PRE_A_AY_DIGEST
                 && postHeader.length === pre.PRE_HEADER_WIDTH && gridCols === pre.PRE_GRID_COLUMNS
                 && past === 0 && synthetic === 0;
  out.PRE_DROP_TAIL = pre.PRE_HEADER_TAIL;
}
return [{ json: out }];
'@

# ------------------------------------------------------------------ graphs

function New-ChildWorkflow {
    $metaUrl   = "https://sheets.googleapis.com/v4/spreadsheets/$DocId" + '?fields=sheets(properties(sheetId,title,gridProperties))'
    $valuesUrl = "https://sheets.googleapis.com/v4/spreadsheets/$DocId/values/$SheetTitle" + '!A1:DZ1000?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING'
    $httpGet = {
        param($id, $name, $url, $x, $y)
        @{ id = $id; name = $name; type = 'n8n-nodes-base.httpRequest'; typeVersion = 4.2; position = @($x, $y)
           parameters = @{ method = 'GET'; url = $url; authentication = 'predefinedCredentialType'; nodeCredentialType = 'googleSheetsOAuth2Api'; options = @{} }
           credentials = $SheetsCred }
    }
    @{
        name = $ChildName
        nodes = @(
            @{ id = 'p71b-trigger'; name = 'Sweep Trigger'; type = 'n8n-nodes-base.executeWorkflowTrigger'; typeVersion = 1.2; position = @(0, 0); parameters = @{ inputSource = 'passthrough' } },
            (& $httpGet 'p71b-meta1'   'Get Meta Pre'    $metaUrl    200 0),
            (& $httpGet 'p71b-vals1'   'Get Values Pre'  $valuesUrl  400 0),
            @{ id = 'p71b-pre'; name = 'Prove Pre'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(600, 0); parameters = @{ jsCode = $ProvePreCode } },
            @{ id = 'p71b-if'; name = 'IF Sweep'; type = 'n8n-nodes-base.if'; typeVersion = 2.2; position = @(800, 0)
               parameters = @{
                   conditions = @{
                       options    = @{ caseSensitive = $true; leftValue = ''; typeValidation = 'strict'; version = 2 }
                       conditions = @(@{ id = 'p71b-cs'; leftValue = '={{ $json.MODE }}'; rightValue = 'SWEEP'; operator = @{ type = 'string'; operation = 'equals' } })
                       combinator = 'and'
                   }
                   options = @{}
               } },
            @{ id = 'p71b-del'; name = 'Delete Tail Columns'; type = 'n8n-nodes-base.httpRequest'; typeVersion = 4.2; position = @(1000, -140)
               parameters = @{
                   method = 'POST'
                   url = "https://sheets.googleapis.com/v4/spreadsheets/$DocId" + ':batchUpdate'
                   authentication = 'predefinedCredentialType'
                   nodeCredentialType = 'googleSheetsOAuth2Api'
                   sendBody = $true
                   contentType = 'json'
                   specifyBody = 'json'
                   jsonBody = '={{ JSON.stringify($json.BATCH_REQUEST) }}'
                   options = @{}
               }
               credentials = $SheetsCred },
            @{ id = 'p71b-pass'; name = 'No Mutation'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1000, 140); parameters = @{ jsCode = $NoMutationCode } },
            (& $httpGet 'p71b-meta2'  'Get Meta Post'    $metaUrl   1200 0),
            (& $httpGet 'p71b-vals2'  'Get Values Post'  $valuesUrl 1400 0),
            @{ id = 'p71b-post'; name = 'Prove Post'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1600, 0); parameters = @{ jsCode = $ProvePostCode } }
        )
        connections = @{
            'Sweep Trigger'       = @{ main = @(, @(@{ node = 'Get Meta Pre'; type = 'main'; index = 0 })) }
            'Get Meta Pre'        = @{ main = @(, @(@{ node = 'Get Values Pre'; type = 'main'; index = 0 })) }
            'Get Values Pre'      = @{ main = @(, @(@{ node = 'Prove Pre'; type = 'main'; index = 0 })) }
            'Prove Pre'           = @{ main = @(, @(@{ node = 'IF Sweep'; type = 'main'; index = 0 })) }
            'IF Sweep'            = @{ main = @(@(@{ node = 'Delete Tail Columns'; type = 'main'; index = 0 }), @(@{ node = 'No Mutation'; type = 'main'; index = 0 })) }
            'Delete Tail Columns' = @{ main = @(, @(@{ node = 'Get Meta Post'; type = 'main'; index = 0 })) }
            'No Mutation'         = @{ main = @(, @(@{ node = 'Get Meta Post'; type = 'main'; index = 0 })) }
            'Get Meta Post'       = @{ main = @(, @(@{ node = 'Get Values Post'; type = 'main'; index = 0 })) }
            'Get Values Post'     = @{ main = @(, @(@{ node = 'Prove Post'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function New-ModeCode {
    param([string]$M)
    "// P7.1b mode. AUDIT proves and deletes nothing. SWEEP re-proves, then deletes AZ:BE.`nreturn [{ json: { mode: '$M' } }];"
}

function New-ParentWorkflow {
    param([string]$ChildId)
    @{
        name = $ParentName
        nodes = @(
            @{ id = 'p71bp-start'; name = 'Start'; type = 'n8n-nodes-base.manualTrigger'; typeVersion = 1; position = @(0, 0); parameters = @{} },
            @{ id = 'p71bp-mode'; name = 'Mode'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(220, 0); parameters = @{ jsCode = (New-ModeCode 'AUDIT') } },
            @{ id = 'p71bp-call'; name = 'Call Sweep'; type = 'n8n-nodes-base.executeWorkflow'; typeVersion = 1.3; position = @(440, 0)
               parameters = @{
                   mode       = 'each'
                   source     = 'database'
                   workflowId = @{ __rl = $true; mode = 'id'; value = $ChildId }
                   options    = @{ waitForSubWorkflow = $true }
               } },
            @{ id = 'p71bp-collect'; name = 'Collect'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(660, 0)
               parameters = @{ jsCode = 'return $input.all().map((it) => ({ json: it.json }));' } }
        )
        connections = @{
            'Start'      = @{ main = @(, @(@{ node = 'Mode'; type = 'main'; index = 0 })) }
            'Mode'       = @{ main = @(, @(@{ node = 'Call Sweep'; type = 'main'; index = 0 })) }
            'Call Sweep' = @{ main = @(, @(@{ node = 'Collect'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function Get-Existing {
    # LIVE FIRST: a plain name match can return an archived namesake while the live one keeps running.
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
    Fail 'choose one of -Create, -Show, -EnableParentMcp, -Mode <AUDIT|SWEEP>, -Teardown.'
}

Say ''
Say '== P7.1b TRAILING COLUMN SWEEP  AZ:BE ====================='
Say "  tenant   : $($env:N8N_BASE_URL)"
Say "  document : $DocId  ($SheetTitle, gid $SheetGid)"
Say "  deleting : $($DropNames -join ', ')"
Say "  keeping  : everything in A:AY, ending at AY financial_zone"

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
    Say '-- offline pre-proof --'
    Assert-NoTrackedEmitter

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

    # The delete request must be built by the guard node and by nothing else. Assert against the
    # LIVE graph that the URL is a batchUpdate on the right document and that the body is an
    # expression referencing the proven request -- never a literal range typed into the node.
    $del = ($liveChild.nodes | Where-Object { $_.name -eq 'Delete Tail Columns' })
    if ($del.parameters.method -ne 'POST') { Fail 'the delete node is not a POST' }
    if ($del.parameters.url -ne ("https://sheets.googleapis.com/v4/spreadsheets/$DocId" + ':batchUpdate')) { Fail "the delete node targets $($del.parameters.url)" }
    if ($del.parameters.jsonBody -ne '={{ JSON.stringify($json.BATCH_REQUEST) }}') { Fail 'the delete body is not the proven request' }
    Ok 'the delete is one batchUpdate whose body can only come from the guard node'

    $onlyDeleter = @($liveChild.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.httpRequest' -and $_.parameters.method -eq 'POST' })
    if ($onlyDeleter.Count -ne 1) { Fail "the child holds $($onlyDeleter.Count) mutating HTTP nodes, expected exactly 1" }
    Ok 'exactly one mutating call exists in the whole graph'

    Say ''
    Say '-- creating the parent (credential-free driver) --'
    $parent = Invoke-N8n -Method POST -Path '/workflows' -Write -Body (New-ParentWorkflow -ChildId $child.id)
    if (-not $parent.id) { Fail 'the API returned no parent id; check the UI before retrying.' }
    $liveParent = Get-N8nWorkflow -Id $parent.id
    if ($liveParent.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($parent.id)" }
    if ($liveParent.nodes.Count -ne $ParentNodeCnt) { Fail "the parent has $($liveParent.nodes.Count) nodes, expected $ParentNodeCnt" }
    if (@($liveParent.nodes | Where-Object { $_.PSObject.Properties['credentials'] -and $_.credentials }).Count -ne 0) { Fail 'the parent holds a credential and must not' }
    Ok "parent created: $($parent.id)  inactive, credential-free, $ParentNodeCnt nodes, armed AUDIT"

    Say ''
    Say '  next: -EnableParentMcp, then -Mode AUDIT, then run the parent with test_workflow.'
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
    if ($Mode -eq 'SWEEP') { Assert-NoTrackedEmitter }
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
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($back.id)" }
    if ($back.nodes.Count -ne $ParentNodeCnt) { Fail 'the parent graph changed on write. Inspect it by hand.' }

    Say ''
    Ok "ARMED $Mode on parent $($back.id)"
    if ($Mode -eq 'SWEEP') { Say '  the next run DELETES columns AZ:BE from the live Bot_Sessions sheet, after re-proving all five guards.' }
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
