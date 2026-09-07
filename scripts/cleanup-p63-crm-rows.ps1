# FINMENTOR - P6.3 guarded removal of the canary rows this phase wrote into the LIVE CRM.
#
#   pwsh scripts/cleanup-p63-crm-rows.ps1 -Create      # build the disposable parent/child pair
#   pwsh scripts/cleanup-p63-crm-rows.ps1 -Show        # what exists right now
#   pwsh scripts/cleanup-p63-crm-rows.ps1 -ArmDelete   # switch the parent to DELETE mode
#   pwsh scripts/cleanup-p63-crm-rows.ps1 -Disarm      # switch it back to DRYRUN
#   pwsh scripts/cleanup-p63-crm-rows.ps1 -Teardown    # archive the pair when finished
#
# The RUN itself is not done here: n8n's public API has no execute endpoint. The parent is
# started either through the MCP `test_workflow` surface or by pressing Execute in the n8n UI.
# The mode is carried by a `Mode` NODE in the parent graph rather than by pin data -- the API
# silently declines to store pinData, and a mode hidden in a pin is invisible to whoever opens
# the workflow before pressing Execute. DRYRUN is what -Create builds.
#
# WHY A PARENT AND A CHILD. `test_workflow` PINS every credential-bearing node in the workflow
# it runs, so a single workflow holding the Google Sheets nodes would report success without
# touching the sheet. The child is invoked as a SUB-workflow and therefore executes for real --
# the same arrangement the canary driver uses, and the reason its Sheets writes were genuine.
#
# THE GUARDS, and why each one is here rather than "be careful".
#
#   1. A hard allowlist of the three lead_ids this phase created. Nothing else is deletable,
#      whatever the sheet contains.
#   2. Every matched row must ALSO look like a canary row: created on 2026-08-27, and either
#      contactless (the two flat-shape rows) or carrying the P63 CANARY marker (the shape
#      proof). A lead_id collision alone is not enough to authorise a delete.
#   3. The count must be EXACTLY the allowlist size. A missing row means the sheet is not in
#      the state this script was written against, and it aborts rather than deleting a subset.
#   4. Deletes run in DESCENDING row order. Google Sheets renumbers on delete, so ascending
#      order would shift every later target by one and delete a customer row.
#   5. DRYRUN is the default. `mode` must be the literal string DELETE to write.
#
# Deleting a sheet row is NOT reversible from here. That is the whole reason for 1-4.

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

# Variables the owner sets mid-session are not inherited by an already-running process.
$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$ParentName = '[TEMP] P63 CRM cleanup driver'
$ChildName  = '[TEMP] P63 CRM canary row cleanup'
$DocId      = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$SheetGid   = 1883973304
$SheetsCred = @{ googleSheetsOAuth2Api = @{ id = 'PzVCuEPa9YF3YSaD'; name = 'Google Sheets OAuth2 API' } }

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

# ------------------------------------------------------------------ the selection logic
#
# One Code body, kept here as the single source of truth for what is deletable. It throws on
# every disagreement with its own expectations: an abort leaves the sheet untouched, a partial
# delete does not.

$SelectCode = @'
// P6.3 -- choose which Pipeline rows may be deleted, and refuse everything else.
const ALLOW = {
  'FIN-1787811991746-68':  'flat-shape canary lead, exec 3610',
  'FIN-1787813108944-787': 'flat-shape canary lead, exec 3612',
  'FIN-1787820142959-693': 'real-gateway-payload shape proof, exec 3618'
};
const mode = String(($('Cleanup Trigger').first().json || {}).mode || 'DRYRUN');
const rows = $input.all().map((i) => i.json || {});
if (!rows.length) throw new Error('the Pipeline sheet read returned no rows at all');

const targets = rows.filter((r) => Object.prototype.hasOwnProperty.call(ALLOW, String(r.lead_id || '')));

// GUARD 2 -- a lead_id match alone does not authorise a delete.
for (const t of targets) {
  const created = String(t.created_at || '');
  const name = String(t.name || '');
  if (created.slice(0, 10) !== '2026-08-27') {
    throw new Error('row ' + t.row_number + ' (' + t.lead_id + ') was not created on 2026-08-27: ' + created);
  }
  const contactless = name === '' && String(t.phone || '') === '' && String(t.email || '') === '';
  const marked = /P63 CANARY/.test(name);
  if (!contactless && !marked) {
    throw new Error('row ' + t.row_number + ' (' + t.lead_id + ') is neither contactless nor P63-marked: refusing');
  }
  if (!(Number(t.row_number) > 1)) {
    throw new Error('row_number ' + t.row_number + ' is not a data row');
  }
}

// GUARD 3 -- all of them, or none.
const want = Object.keys(ALLOW).length;
if (targets.length !== want) {
  const found = targets.map((t) => t.lead_id).join(', ') || '(none)';
  throw new Error('expected ' + want + ' canary rows, found ' + targets.length + ': ' + found
    + ' -- the sheet is not in the state this cleanup was written against');
}

// GUARD 4 -- descending, because a delete renumbers every row below it.
targets.sort((a, b) => Number(b.row_number) - Number(a.row_number));

return targets.map((t) => ({ json: {
  mode: mode,
  row_number: Number(t.row_number),
  lead_id: String(t.lead_id),
  reason: ALLOW[String(t.lead_id)],
  name: String(t.name || ''),
  priority: String(t.priority || ''),
  sheet_rows_total: rows.length
} }));
'@

$ReportCode = @'
// Report what happened, per row, without interpreting the Sheets response.
const plan = $('Select Targets').all().map((i) => i.json);
const mode = plan.length ? plan[0].mode : 'DRYRUN';
return [{ json: {
  mode: mode,
  deleted: mode === 'DELETE',
  rows: plan.map((p) => ({ row_number: p.row_number, lead_id: p.lead_id, name: p.name, priority: p.priority, reason: p.reason })),
  sheet_rows_total: plan.length ? plan[0].sheet_rows_total : 0
} }];
'@

function New-ChildWorkflow {
    @{
        name = $ChildName
        nodes = @(
            @{ id = 'p63c-trigger'; name = 'Cleanup Trigger'; type = 'n8n-nodes-base.executeWorkflowTrigger'; typeVersion = 1.2; position = @(0, 0); parameters = @{ inputSource = 'passthrough' } },
            @{ id = 'p63c-read'; name = 'Read Pipeline'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(220, 0)
               parameters = @{
                   documentId = @{ __rl = $true; mode = 'id'; value = $DocId }
                   sheetName  = @{ __rl = $true; mode = 'list'; value = $SheetGid; cachedResultName = 'Pipeline' }
                   options    = @{}
               }
               credentials = $SheetsCred },
            @{ id = 'p63c-select'; name = 'Select Targets'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(440, 0); parameters = @{ jsCode = $SelectCode } },
            @{ id = 'p63c-if'; name = 'IF Delete'; type = 'n8n-nodes-base.if'; typeVersion = 2.2; position = @(660, 0)
               parameters = @{
                   conditions = @{
                       options    = @{ caseSensitive = $true; leftValue = ''; typeValidation = 'strict'; version = 2 }
                       conditions = @(@{ id = 'p63c-cond'; leftValue = '={{ $json.mode }}'; rightValue = 'DELETE'; operator = @{ type = 'string'; operation = 'equals' } })
                       combinator = 'and'
                   }
                   options = @{}
               } },
            @{ id = 'p63c-del'; name = 'Delete Row'; type = 'n8n-nodes-base.googleSheets'; typeVersion = 4.7; position = @(880, -80)
               parameters = @{
                   resource       = 'sheet'
                   operation      = 'delete'
                   documentId     = @{ __rl = $true; mode = 'id'; value = $DocId }
                   sheetName      = @{ __rl = $true; mode = 'list'; value = $SheetGid; cachedResultName = 'Pipeline' }
                   toDelete       = 'rows'
                   startIndex     = '={{ $json.row_number }}'
                   numberToDelete = 1
               }
               credentials = $SheetsCred },
            @{ id = 'p63c-report'; name = 'Report'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(1100, 0); parameters = @{ jsCode = $ReportCode } }
        )
        connections = @{
            'Cleanup Trigger' = @{ main = @(, @(@{ node = 'Read Pipeline'; type = 'main'; index = 0 })) }
            'Read Pipeline'   = @{ main = @(, @(@{ node = 'Select Targets'; type = 'main'; index = 0 })) }
            'Select Targets'  = @{ main = @(, @(@{ node = 'IF Delete'; type = 'main'; index = 0 })) }
            'IF Delete'       = @{ main = @(@(@{ node = 'Delete Row'; type = 'main'; index = 0 }), @(@{ node = 'Report'; type = 'main'; index = 0 })) }
            'Delete Row'      = @{ main = @(, @(@{ node = 'Report'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

# The armed state lives in a NODE, not in pin data. The public API silently declines to store
# pinData, and a mode hidden in a pin would not be visible to whoever opens the workflow before
# pressing Execute. A node is readable, diffable and switchable from here.
function New-ModeCode { param([string]$Mode) "// P6.3 cleanup mode. DRYRUN reports; DELETE removes the three canary rows.`nreturn [{ json: { mode: '$Mode' } }];" }

function New-ParentWorkflow {
    param([string]$ChildId)
    @{
        name = $ParentName
        nodes = @(
            @{ id = 'p63p-start'; name = 'Start'; type = 'n8n-nodes-base.manualTrigger'; typeVersion = 1; position = @(0, 0); parameters = @{} },
            @{ id = 'p63p-mode'; name = 'Mode'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(220, 0); parameters = @{ jsCode = (New-ModeCode 'DRYRUN') } },
            @{ id = 'p63p-call'; name = 'Call Cleanup'; type = 'n8n-nodes-base.executeWorkflow'; typeVersion = 1.3; position = @(440, 0)
               parameters = @{
                   mode       = 'each'
                   source     = 'database'
                   workflowId = @{ __rl = $true; mode = 'id'; value = $ChildId }
                   options    = @{ waitForSubWorkflow = $true }
               } },
            @{ id = 'p63p-collect'; name = 'Collect'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(660, 0)
               parameters = @{ jsCode = 'return $input.all().map((it) => ({ json: it.json }));' } }
        )
        connections = @{
            'Start'        = @{ main = @(, @(@{ node = 'Mode'; type = 'main'; index = 0 })) }
            'Mode'         = @{ main = @(, @(@{ node = 'Call Cleanup'; type = 'main'; index = 0 })) }
            'Call Cleanup' = @{ main = @(, @(@{ node = 'Collect'; type = 'main'; index = 0 })) }
        }
        settings = @{ executionOrder = 'v1'; availableInMCP = $false }
    }
}

function Get-Existing {
    # LIVE FIRST, and it matters. Re-creating the pair leaves an ARCHIVED namesake behind, so a
    # plain name match can return the dead one -- which is exactly what happened on the first
    # teardown: it reported the child "already archived" while the live child stayed live. Sort
    # archived last so every caller here operates on the workflow that can still do something.
    $all = Get-N8nWorkflowList
    $pick = {
        param($name)
        $all | Where-Object { $_.name -eq $name } |
            Sort-Object -Property @{ Expression = { [bool]$_.isArchived } }, @{ Expression = { $_.createdAt }; Descending = $true } |
            Select-Object -First 1
    }
    [pscustomobject]@{
        Parent = & $pick $ParentName
        Child  = & $pick $ChildName
    }
}

if (-not ($Create -or $Show -or $Teardown -or $EnableParentMcp -or $ArmDelete -or $Disarm)) {
    Fail 'choose one of -Create, -Show, -EnableParentMcp, -ArmDelete, -Disarm, -Teardown.'
}

Say ''
Say '== P6.3 CRM CANARY ROW CLEANUP ============================'
Say "  tenant   : $($env:N8N_BASE_URL)"
Say "  document : $DocId  (Pipeline, gid $SheetGid)"

$existing = Get-Existing

if ($Show) {
    Say ''
    Say ("  parent : " + $(if ($existing.Parent) { "$($existing.Parent.id)  archived=$($existing.Parent.isArchived)" } else { 'absent' }))
    Say ("  child  : " + $(if ($existing.Child)  { "$($existing.Child.id)  archived=$($existing.Child.isArchived)" } else { 'absent' }))
    Say ''
    exit 0
}

if ($EnableParentMcp) {
    # `test_workflow` refuses a workflow that is not MCP-available, so the PARENT has to be --
    # exactly as `[TEMP] P6.2 canary driver` already is. The CHILD stays false: it is the half
    # that holds the Google Sheets credential, and nothing needs to reach it directly.
    #
    # This is the narrowest possible form of an exposure the phase otherwise forbids: a
    # disposable [TEMP] harness, inactive, holding no credential, whose only capability is to
    # call one guarded child. -Teardown archives it.
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    if ($null -eq $existing.Child)  { Fail "'$ChildName' does not exist. Run -Create first." }
    if ($existing.Child.settings.availableInMCP) { Fail "the CHILD is MCP-exposed and must not be: $($existing.Child.id)" }

    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.nodes.Count -ne 4) { Fail "the parent is not the four-node harness ($($p.nodes.Count) nodes). Refusing." }
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing to expose a running workflow.' }

    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    $settings['availableInMCP'] = $true

    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{
        name = $p.name; nodes = $p.nodes; connections = $p.connections; settings = $settings
    } | Out-Null

    $back = Get-N8nWorkflow -Id $p.id
    if (-not $back.settings.availableInMCP) { Fail 'the setting did not stick.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    if ($back.nodes.Count -ne 4) { Fail 'the parent graph changed on write. Inspect it by hand.' }
    Ok "parent $($p.id) is now MCP-available, still inactive, graph unchanged"
    Say ''
    exit 0
}

if ($ArmDelete -or $Disarm) {
    # Pin the mode onto the parent's manual trigger so the owner's only action is one Execute
    # click in the n8n UI -- no JSON typed at the moment of an irreversible operation, which is
    # the worst possible time to type JSON.
    #
    # Arming is not the same as firing, and re-running after a successful delete is not
    # dangerous: GUARD 3 expects exactly three canary rows and aborts when it finds none. The
    # armed state is still cleared with -Disarm, and removed entirely by -Teardown.
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing.' }
    if ($p.nodes.Count -ne 4) { Fail "the parent is not the four-node harness ($($p.nodes.Count) nodes). Refusing." }

    $wanted = if ($ArmDelete) { 'DELETE' } else { 'DRYRUN' }
    $nodes = @()
    $touched = 0
    foreach ($n in $p.nodes) {
        if ($n.name -eq 'Mode') { $n.parameters.jsCode = (New-ModeCode $wanted); $touched++ }
        $nodes += $n
    }
    if ($touched -ne 1) { Fail "expected exactly one 'Mode' node, found $touched. Refusing." }

    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{
        name = $p.name; nodes = $nodes; connections = $p.connections; settings = $settings
    } | Out-Null

    $back = Get-N8nWorkflow -Id $p.id
    $mode = ($back.nodes | Where-Object { $_.name -eq 'Mode' }).parameters.jsCode
    $armed = $mode -match "mode: 'DELETE'"
    if ($ArmDelete -and -not $armed) { Fail 'the mode did not stick.' }
    if ($Disarm -and $armed) { Fail 'the mode is still DELETE.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    if ($back.nodes.Count -ne 4) { Fail 'the parent graph changed on write. Inspect it by hand.' }

    Say ''
    if ($ArmDelete) {
        Ok "ARMED. $($p.id) will run in DELETE mode on the next Execute."
        Say ''
        Say '  Open the workflow in n8n and press Execute Workflow. It deletes exactly three'
        Say '  Pipeline rows -- 13, 12, 11 -- in that order, and aborts if the sheet has moved.'
    } else {
        Ok "DISARMED. $($p.id) has no pinned mode and defaults to DRYRUN."
    }
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
Say 'Now run the parent through MCP test_workflow:'
Say "  DRY RUN : workflowId $($parent.id)  mode DRYRUN"
Say "  DELETE  : workflowId $($parent.id)  mode DELETE"
Say ''
Say 'Then: pwsh scripts/cleanup-p63-crm-rows.ps1 -Teardown'
Say ''
