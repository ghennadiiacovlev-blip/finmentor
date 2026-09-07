# FINMENTOR - P6.3 residue sweep: delete the synthetic Submission_Receipts rows, then census
# every surface this phase could have written.
#
#   pwsh scripts/p63-residue-sweep.ps1 -Create        # build the disposable parent/child pair
#   pwsh scripts/p63-residue-sweep.ps1 -EnableParentMcp
#   pwsh scripts/p63-residue-sweep.ps1 -ArmDelete     # switch the parent to DELETE mode
#   pwsh scripts/p63-residue-sweep.ps1 -Disarm
#   pwsh scripts/p63-residue-sweep.ps1 -Show
#   pwsh scripts/p63-residue-sweep.ps1 -Teardown
#
# WHY THIS EXISTS RATHER THAN scripts/p63-receipt-tool.ps1 -Delete.
#
# That switch cannot work and never could: the n8n public API answers
# `DELETE /data-tables/{id}/rows` with "DELETE method not allowed". The tool was written with a
# delete path that had never been exercised, and it was only exercised the day it was needed.
# Deleting a data-table row is possible ONLY from inside a workflow, through the `dataTable`
# node -- which the MCP tool surface also lacks. So the delete has to be a graph.
#
# The census rides along because Bot_Sessions and Pipeline are Google Sheets tabs: reading them
# needs the Sheets credential, which means a workflow too. One instrument, one teardown.
#
# WHY A PARENT AND A CHILD. `test_workflow` PINS every credential-bearing node in the workflow
# it runs, so the Sheets reads in a single workflow would return pinned fiction. A SUB-workflow
# executes for real. (`dataTable` nodes hold no credential and would have executed either way.)
#
# THE GUARDS on the delete:
#
#   1. The synthetic submission keys are written into the node's own filter conditions as
#      literals.
#      They are not expressions and cannot be steered by any row the table contains.
#   2. `Select Receipts` re-reads the table first and refuses unless every allowlisted key is
#      present AND in the state the allowlist expects it in -- COMMITTED with its canary lead,
#      or, for the P6.4 post-claim row, IN_FLIGHT with its correlation and no lead.
#   3. Any row that is NOT allowlisted is counted and REPORTED, never touched. A foreign
#      row is somebody else's, and this sweep has no opinion about it.
#   4. DRYRUN is the default; the mode must be the literal string DELETE.
#
# The census is read-only in both modes and reports COUNTS and identifiers only -- never a
# customer name, email, phone or message body.

[CmdletBinding()]
param(
    [switch]$Create,
    [switch]$Show,
    [switch]$Teardown,
    [switch]$EnableParentMcp,
    [switch]$ArmDelete,
    [switch]$Disarm
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$ParentName   = '[TEMP] P63 residue sweep driver'
$ChildName    = '[TEMP] P63 residue sweep'
$DocId        = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$PipelineGid  = 1883973304
$SessionsGid  = 1584265787
$ReceiptTable = 'fV23lsh9uq8uFHox'
$SheetsCred   = @{ googleSheetsOAuth2Api = @{ id = 'PzVCuEPa9YF3YSaD'; name = 'Google Sheets OAuth2 API' } }

$Key1 = 'sub_63a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
$Key2 = 'sub_63b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'
$Key3 = 'sub_63c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'
$Key4 = 'sub_64a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'   # P6.4 post-claim injection, left IN_FLIGHT on purpose

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

$SelectCode = @'
// P6.3 -- authorise the receipt delete, or refuse it. Nothing here writes.
// Each key carries the state it is EXPECTED to be in. A synthetic row in some other state
// means the table is not what this sweep was written against, and guessing is worse than
// aborting -- so the state is part of the allowlist, not an afterthought.
//
// P6.4 adds a deliberately AMBIGUOUS row: the post-claim injection leaves its receipt
// IN_FLIGHT on purpose (F13). It cannot be settled, because settling it would require
// asserting whether the Pipeline write landed -- which is exactly the question the design
// refuses to guess at. It is therefore removed as SYNTHETIC RESIDUE by the operator path,
// never transitioned to COMMITTED or rolled back to READY.
const ALLOW = {
  'sub_63a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1': { state: 'COMMITTED', lead: 'FIN-1787811991746-68' },
  'sub_63b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2': { state: 'COMMITTED', lead: 'FIN-1787813108944-787' },
  'sub_63c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3': { state: 'COMMITTED', lead: 'FIN-1787820142959-693' },
  'sub_64a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1': { state: 'IN_FLIGHT', lead: '', corr: 'req-p64-POSTCLAIM-1' }
};
const mode = String(($('Sweep Trigger').first().json || {}).mode || 'DRYRUN');
const rows = $input.all().map((i) => i.json || {}).filter((r) => Object.keys(r).length);

const mine = rows.filter((r) => Object.prototype.hasOwnProperty.call(ALLOW, String(r.submission_key || '')));
const foreign = rows.filter((r) => !Object.prototype.hasOwnProperty.call(ALLOW, String(r.submission_key || '')));

// GUARD 2 -- every canary key must be present AND settled to the lead it settled to. A key
// that is present but in some other state means the table is not what this sweep was written
// against, and guessing is worse than aborting.
// The allowlist spans every phase this instrument has swept, so by design some of its keys
// are ALREADY GONE. Requiring all of them to be present would make the sweep abort the moment
// it succeeded once, so the strictness lives where it actually protects something: every row
// that IS present must be allowlisted and must be in the exact state the allowlist expects.
// Absence is reported, never treated as an error.
const wantKeys = Object.keys(ALLOW);
const alreadyGone = wantKeys.filter((k) => !mine.some((r) => String(r.submission_key) === k));
if (mine.length === 0) {
  throw new Error('no allowlisted receipt rows are present -- nothing to sweep, and a run that '
    + 'deletes nothing should say so rather than report success');
}
for (const r of mine) {
  const k = String(r.submission_key);
  const want = ALLOW[k];
  if (String(r.commit_state) !== want.state) {
    throw new Error(k + ' is ' + r.commit_state + ', expected ' + want.state + ': refusing');
  }
  if (String(r.canonical_lead_id) !== want.lead) {
    throw new Error(k + ' carries lead ' + r.canonical_lead_id + ', expected ' + (want.lead || '(none)') + ': refusing');
  }
  if (want.corr && String(r.correlation_id) !== want.corr) {
    throw new Error(k + ' carries correlation ' + r.correlation_id + ', expected ' + want.corr + ': refusing');
  }
}

// GUARD 3 -- foreign rows are reported, never touched.
return [{ json: {
  mode: mode,
  canary_rows: mine.map((r) => ({ id: r.id, submission_key: r.submission_key, commit_state: r.commit_state, canonical_lead_id: r.canonical_lead_id })),
  already_gone: alreadyGone,
  foreign_row_count: foreign.length,
  table_rows_before: rows.length
} }];
'@

$ReportCode = @'
// Census. Counts and identifiers only -- no customer name, email, phone or message body.
const plan = $('Select Receipts').first().json;

// P6.3's OWN markers -- every identifier this phase minted, and nothing else.
const LEADS = ['FIN-1787811991746-68', 'FIN-1787813108944-787', 'FIN-1787820142959-693'];
const KEYS  = ['sub_63a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'sub_63b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'sub_63c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
               'sub_64a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'];
const TG    = ['999000001', '123456789', '999000002', '999000004'];

// A SEPARATE class, counted but never conflated with the above. `finmentor-qa.invalid` is the
// synthetic email domain used by EARLIER phases; seven Pipeline rows from 2026-08-25 carry it.
// Folding those into "P6.3 residue" would have made this phase look dirty and, worse, would
// have put somebody else's rows inside a delete allowlist. They are reported for the owner and
// left alone.
const LEGACY = ['finmentor-qa.invalid'];

const live = (name) => { try { return $(name).all().map((i) => i.json || {}).filter((r) => Object.keys(r).length); } catch (e) { return []; } };

const receipts = live('Read Receipts After');
const sessions = live('Read Bot_Sessions');
const pipeline = live('Read Pipeline');

// Deliberately blunt: scans the whole serialised row rather than named columns, so a marker
// that landed in a column nobody thought of is still found.
const isP63 = (row) => {
  const s = JSON.stringify(row);
  return LEADS.some((x) => s.indexOf(x) !== -1)
      || KEYS.some((x) => s.indexOf(x) !== -1)
      || s.indexOf('req-p63') !== -1
      || s.indexOf('req-p64') !== -1
      || s.indexOf('P63 CANARY') !== -1
      || s.indexOf('P63-CANARY') !== -1
      || s.indexOf('P64 CANARY') !== -1
      || TG.some((x) => String(row.telegram || '') === x || String(row.chat_id || '') === x || String(row.user_id || '') === x);
};
const isLegacy = (row) => { const s = JSON.stringify(row); return LEGACY.some((x) => s.indexOf(x) !== -1); };

const scan = (rows, idField) => {
  const p63 = rows.filter(isP63);
  const legacy = rows.filter((r) => !isP63(r) && isLegacy(r));
  return {
    total: rows.length,
    p63_residue: p63.length,
    p63_ids: p63.map((r) => String(r[idField] || r.row_number || r.id || '?')),
    legacy_qa_rows: legacy.length,
    legacy_qa_ids: legacy.map((r) => String(r[idField] || r.row_number || r.id || '?'))
  };
};

return [{ json: {
  mode: plan.mode,
  receipts_deleted: plan.mode === 'DELETE',
  receipts_before: plan.table_rows_before,
  foreign_receipt_rows_untouched: plan.foreign_row_count,
  residue: {
    submission_receipts: scan(receipts, 'submission_key'),
    bot_sessions: scan(sessions, 'chat_id'),
    pipeline: scan(pipeline, 'lead_id')
  }
} }];
'@

function New-ModeCode { param([string]$Mode) "// P6.3 residue sweep mode. DRYRUN censuses only; DELETE also removes the three receipts.`nreturn [{ json: { mode: '$Mode' } }];" }

function New-DataTableNode {
    param([string]$Id, [string]$Name, [int[]]$Pos, [string]$Operation, $Filters)
    $p = @{
        resource    = 'row'
        operation   = $Operation
        dataTableId = @{ __rl = $true; mode = 'id'; value = $ReceiptTable }
    }
    if ($Operation -eq 'get') { $p['returnAll'] = $true; $p['filters'] = @{ conditions = @() } }
    else { $p['matchType'] = 'anyCondition'; $p['filters'] = $Filters }
    @{ id = $Id; name = $Name; type = 'n8n-nodes-base.dataTable'; typeVersion = 1.1; position = $Pos
       parameters = $p; alwaysOutputData = $true; executeOnce = $true }
}

function New-SheetReadNode {
    param([string]$Id, [string]$Name, [int[]]$Pos, [int]$Gid, [string]$Tab)
    @{ id = $Id; name = $Name; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = $Pos
       parameters = @{
           documentId = @{ __rl = $true; mode = 'id'; value = $DocId }
           sheetName  = @{ __rl = $true; mode = 'list'; value = $Gid; cachedResultName = $Tab }
           options    = @{}
       }
       credentials = $SheetsCred; alwaysOutputData = $true; executeOnce = $true }
}

function New-ChildWorkflow {
    # The three keys are LITERALS in the filter, not expressions. Nothing the table contains can
    # widen what this node deletes.
    $delFilters = @{ conditions = @(
        @{ keyName = 'submission_key'; condition = 'eq'; keyValue = $Key1 },
        @{ keyName = 'submission_key'; condition = 'eq'; keyValue = $Key2 },
        @{ keyName = 'submission_key'; condition = 'eq'; keyValue = $Key3 },
        @{ keyName = 'submission_key'; condition = 'eq'; keyValue = $Key4 }
    ) }
    @{
        name = $ChildName
        nodes = @(
            @{ id = 'p63s-trigger'; name = 'Sweep Trigger'; type = 'n8n-nodes-base.executeWorkflowTrigger'; typeVersion = 1.2; position = @(0, 0); parameters = @{ inputSource = 'passthrough' } },
            (New-DataTableNode 'p63s-read'  'Read Receipts'       @(200, 0)  'get' $null),
            @{ id = 'p63s-select'; name = 'Select Receipts'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(400, 0); parameters = @{ jsCode = $SelectCode } },
            @{ id = 'p63s-if'; name = 'IF Delete'; type = 'n8n-nodes-base.if'; typeVersion = 2.2; position = @(600, 0)
               parameters = @{
                   conditions = @{
                       options    = @{ caseSensitive = $true; leftValue = ''; typeValidation = 'strict'; version = 2 }
                       conditions = @(@{ id = 'p63s-cond'; leftValue = '={{ $json.mode }}'; rightValue = 'DELETE'; operator = @{ type = 'string'; operation = 'equals' } })
                       combinator = 'and'
                   }
                   options = @{}
               } },
            (New-DataTableNode 'p63s-del'   'Delete Receipts'     @(800, -120) 'deleteRows' $delFilters),
            (New-DataTableNode 'p63s-after' 'Read Receipts After' @(1000, 0)   'get' $null),
            (New-SheetReadNode 'p63s-bs'    'Read Bot_Sessions'   @(1200, 0)   $SessionsGid 'Bot_Sessions'),
            (New-SheetReadNode 'p63s-pl'    'Read Pipeline'       @(1400, 0)   $PipelineGid 'Pipeline'),
            @{ id = 'p63s-report'; name = 'Report'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1600, 0); parameters = @{ jsCode = $ReportCode } }
        )
        connections = @{
            'Sweep Trigger'       = @{ main = @(, @(@{ node = 'Read Receipts'; type = 'main'; index = 0 })) }
            'Read Receipts'       = @{ main = @(, @(@{ node = 'Select Receipts'; type = 'main'; index = 0 })) }
            'Select Receipts'     = @{ main = @(, @(@{ node = 'IF Delete'; type = 'main'; index = 0 })) }
            'IF Delete'           = @{ main = @(@(@{ node = 'Delete Receipts'; type = 'main'; index = 0 }), @(@{ node = 'Read Receipts After'; type = 'main'; index = 0 })) }
            'Delete Receipts'     = @{ main = @(, @(@{ node = 'Read Receipts After'; type = 'main'; index = 0 })) }
            'Read Receipts After' = @{ main = @(, @(@{ node = 'Read Bot_Sessions'; type = 'main'; index = 0 })) }
            'Read Bot_Sessions'   = @{ main = @(, @(@{ node = 'Read Pipeline'; type = 'main'; index = 0 })) }
            'Read Pipeline'       = @{ main = @(, @(@{ node = 'Report'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function New-ParentWorkflow {
    param([string]$ChildId)
    @{
        name = $ParentName
        nodes = @(
            @{ id = 'p63sp-start'; name = 'Start'; type = 'n8n-nodes-base.manualTrigger'; typeVersion = 1; position = @(0, 0); parameters = @{} },
            @{ id = 'p63sp-mode'; name = 'Mode'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(220, 0); parameters = @{ jsCode = (New-ModeCode 'DRYRUN') } },
            @{ id = 'p63sp-call'; name = 'Call Sweep'; type = 'n8n-nodes-base.executeWorkflow'; typeVersion = 1.3; position = @(440, 0)
               parameters = @{ mode = 'each'; source = 'database'; workflowId = @{ __rl = $true; mode = 'id'; value = $ChildId }; options = @{ waitForSubWorkflow = $true } } },
            @{ id = 'p63sp-collect'; name = 'Collect'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(660, 0)
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
    # LIVE FIRST -- an archived namesake from an earlier -Create must never shadow the live one.
    $all = Get-N8nWorkflowList
    $pick = {
        param($name)
        $all | Where-Object { $_.name -eq $name } |
            Sort-Object -Property @{ Expression = { [bool]$_.isArchived } }, @{ Expression = { $_.createdAt }; Descending = $true } |
            Select-Object -First 1
    }
    [pscustomobject]@{ Parent = & $pick $ParentName; Child = & $pick $ChildName }
}

if (-not ($Create -or $Show -or $Teardown -or $EnableParentMcp -or $ArmDelete -or $Disarm)) {
    Fail 'choose one of -Create, -Show, -EnableParentMcp, -ArmDelete, -Disarm, -Teardown.'
}

Say ''
Say '== P6.3 RESIDUE SWEEP ====================================='
Say "  tenant   : $($env:N8N_BASE_URL)"
Say "  receipts : $ReceiptTable      sheets: Pipeline gid $PipelineGid, Bot_Sessions gid $SessionsGid"

$existing = Get-Existing

if ($Show) {
    Say ''
    Say ("  parent : " + $(if ($existing.Parent) { "$($existing.Parent.id)  archived=$($existing.Parent.isArchived)" } else { 'absent' }))
    Say ("  child  : " + $(if ($existing.Child)  { "$($existing.Child.id)  archived=$($existing.Child.isArchived)" } else { 'absent' }))
    Say ''
    exit 0
}

if ($Teardown) {
    foreach ($w in @($existing.Parent, $existing.Child)) {
        if ($null -eq $w) { continue }
        if ($w.isArchived) { Ok "$($w.name) already archived"; continue }
        Invoke-N8n -Method POST -Path "/workflows/$($w.id)/archive" -Write | Out-Null
        Ok "archived $($w.name)  ($($w.id))"
    }
    Say ''
    Say 'Teardown complete. Both workflows are archived, not deleted.'
    exit 0
}

if ($EnableParentMcp) {
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    if ($null -eq $existing.Child)  { Fail "'$ChildName' does not exist. Run -Create first." }
    if ($existing.Child.settings.availableInMCP) { Fail "the CHILD is MCP-exposed and must not be: $($existing.Child.id)" }
    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing.' }
    if ($p.nodes.Count -ne 4) { Fail "the parent is not the four-node harness ($($p.nodes.Count) nodes). Refusing." }
    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    $settings['availableInMCP'] = $true
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{ name = $p.name; nodes = $p.nodes; connections = $p.connections; settings = $settings } | Out-Null
    $back = Get-N8nWorkflow -Id $p.id
    if (-not $back.settings.availableInMCP) { Fail 'the setting did not stick.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    Ok "parent $($p.id) is now MCP-available, still inactive"
    Say ''
    exit 0
}

if ($ArmDelete -or $Disarm) {
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing.' }
    if ($p.nodes.Count -ne 4) { Fail "the parent is not the four-node harness ($($p.nodes.Count) nodes). Refusing." }
    $wanted = if ($ArmDelete) { 'DELETE' } else { 'DRYRUN' }
    $nodes = @(); $touched = 0
    foreach ($n in $p.nodes) {
        if ($n.name -eq 'Mode') { $n.parameters.jsCode = (New-ModeCode $wanted); $touched++ }
        $nodes += $n
    }
    if ($touched -ne 1) { Fail "expected exactly one 'Mode' node, found $touched. Refusing." }
    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{ name = $p.name; nodes = $nodes; connections = $p.connections; settings = $settings } | Out-Null
    $back = Get-N8nWorkflow -Id $p.id
    $armed = (($back.nodes | Where-Object { $_.name -eq 'Mode' }).parameters.jsCode) -match "mode: 'DELETE'"
    if ($ArmDelete -and -not $armed) { Fail 'the mode did not stick.' }
    if ($Disarm -and $armed) { Fail 'the mode is still DELETE.' }
    Say ''
    if ($ArmDelete) { Ok "ARMED. $($p.id) will delete the three receipts on the next Execute." }
    else { Ok "DISARMED. $($p.id) censuses only." }
    Say ''
    exit 0
}

# -- Create ---------------------------------------------------------------------------------
if ($existing.Child -and -not $existing.Child.isArchived) { Fail "a LIVE '$ChildName' already exists ($($existing.Child.id)). Tear it down first." }
if ($existing.Parent -and -not $existing.Parent.isArchived) { Fail "a LIVE '$ParentName' already exists ($($existing.Parent.id)). Tear it down first." }

$child = Invoke-N8n -Method POST -Path '/workflows' -Body (New-ChildWorkflow) -Write
Ok "child  created: $($child.id)"
$parent = Invoke-N8n -Method POST -Path '/workflows' -Body (New-ParentWorkflow -ChildId $child.id) -Write
Ok "parent created: $($parent.id)"

foreach ($w in @($child, $parent)) {
    $back = Get-N8nWorkflow -Id $w.id
    if ($back.active) { Fail "$($back.name) came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($w.id)" }
    if ($back.settings.availableInMCP) { Fail "$($back.name) came back with availableInMCP true: $($w.id)" }
}
Ok 'both are INACTIVE and not exposed to MCP'
Say ''
Say "  next: -EnableParentMcp, run DRYRUN, then -ArmDelete and run again."
Say ''
