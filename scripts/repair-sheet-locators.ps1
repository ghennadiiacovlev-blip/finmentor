# FINMENTOR — repair stale Google Sheets locators across production workflows.
#
# Two defects share one root cause. Several append nodes carry a sheet NAME where n8n
# expects a numeric gid, and their cachedResultUrl still points at a superseded
# spreadsheet (16Eepil...). n8n resolves the value as an id, so the node fails with
# "Sheet with ID <name> not found". This is what fails the Daily Digest on every run and
# what would fail SLA Lead Watch and Followup Sequence the first time their branch carries
# a row — those nodes have simply never executed in retained history.
#
# Only locators whose target is unambiguous are repaired, and only on the canonical
# spreadsheet. Dry-run by default; -Apply performs a PUT then read-after-write verification.

param(
    [string[]]$WorkflowIds = @('LZ2mvKXbBikmeVTn', 'zeLOCuf0K1bkaKl2', 'imeJIDeNyaWDyXzh'),
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "LOCATOR REPAIR ABORTED: $m" }

$DOC_ID  = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$DOC_URL = "https://docs.google.com/spreadsheets/d/$DOC_ID/edit"

# Canonical tab gids, confirmed against live spreadsheet metadata.
$CANONICAL = @{
    'Settings'        = 1871239368
    'Leads'           = 409890193
    'Lead_Answers'    = 936189533
    'Pipeline'        = 1883973304
    'AI_Plans'        = 962064347
    'Activities'      = 623316892
    'Status_Log'      = 1810362432
    'Followups'       = 1651979710
    'Source_Analytics' = 532676168
    'Dashboard_Feed'  = 1289462207
    'Bot_Sessions'    = 1584265787
    'Bot_Events'      = 1612014214
}

if (-not $SnapshotDir) { $SnapshotDir = Join-Path $env:TEMP "finmentor-locators-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null

Write-Host "FINMENTOR sheet locator repair  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"
Write-Host "  snapshot: $SnapshotDir"

$totalFixed = 0

foreach ($id in $WorkflowIds) {
    $wf = Get-N8nWorkflow -Id $id
    Save-WorkflowSnapshot -Workflow $wf -Directory $SnapshotDir -Label "$id-before" | Out-Null
    $wasActive = [bool]$wf.active
    Write-Host "`n  $id  active=$wasActive  $($wf.name)"

    $changes = @()
    foreach ($n in @($wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.googleSheets' })) {
        $sv = $n.parameters.sheetName.value
        if ($sv -is [string] -and $sv -notmatch '^\d+$') {
            if (-not $CANONICAL.ContainsKey($sv)) { Fail "node '$($n.name)' references unknown tab '$sv'" }
            if ($n.parameters.documentId.value -ne $DOC_ID) { Fail "node '$($n.name)' does not target the canonical spreadsheet" }
            $gid = $CANONICAL[$sv]
            $n.parameters.sheetName = [pscustomobject]@{
                __rl             = $true
                value            = $gid
                mode             = 'list'
                cachedResultName = $sv
                cachedResultUrl  = "$DOC_URL#gid=$gid"
            }
            $changes += "$($n.name): '$sv' -> gid $gid"
        }
        # Critical writes must survive a transient Google 5xx. Retained history contains a
        # 503 on a Settings read with no retry configured, which failed a whole run.
        if ($null -eq $n.PSObject.Properties['retryOnFail']) { $n | Add-Member -NotePropertyName retryOnFail -NotePropertyValue $true }
        else { $n.retryOnFail = $true }
        if ($null -eq $n.PSObject.Properties['maxTries']) { $n | Add-Member -NotePropertyName maxTries -NotePropertyValue 3 }
        else { $n.maxTries = 3 }
        if ($null -eq $n.PSObject.Properties['waitBetweenTries']) { $n | Add-Member -NotePropertyName waitBetweenTries -NotePropertyValue 2000 }
        else { $n.waitBetweenTries = 2000 }
    }

    if ($changes.Count -eq 0) {
        Write-Host '    no name-mode locators; retry settings normalised only'
    } else {
        foreach ($c in $changes) { Write-Host "    $c" }
    }
    $totalFixed += $changes.Count

    $ser = $wf.nodes | ConvertTo-Json -Depth 100
    if ($ser -match '16Eepil') { Fail "$id`: a stale spreadsheet reference remains" }

    if (-not $Apply) { continue }

    $body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
    $null = Invoke-N8n -Method Put -Path "/workflows/$id" -Body $body -Write
    Start-Sleep -Milliseconds 800

    $verify = Get-N8nWorkflow -Id $id
    foreach ($n in @($verify.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.googleSheets' })) {
        $sv = $n.parameters.sheetName.value
        if ($sv -is [string] -and $sv -notmatch '^\d+$') { Fail "read-after-write $id`: node '$($n.name)' still uses a name locator" }
        if ($n.retryOnFail -ne $true) { Fail "read-after-write $id`: node '$($n.name)' has no retry" }
    }
    if (($verify.nodes | ConvertTo-Json -Depth 100) -match '16Eepil') { Fail "read-after-write $id`: stale spreadsheet reference remains" }
    if ([bool]$verify.active -ne $wasActive) { Fail "read-after-write $id`: active state changed ($wasActive -> $($verify.active))" }

    Save-WorkflowSnapshot -Workflow $verify -Directory $SnapshotDir -Label "$id-after" | Out-Null
    Write-Host "    read-after-write: PASS   active unchanged: $($verify.active)   hash=$((Get-WorkflowStructuralHash -Workflow $verify).Substring(0,16))"
}

Write-Host "`n  locators repaired: $totalFixed"
if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. No workflow was changed.' }
