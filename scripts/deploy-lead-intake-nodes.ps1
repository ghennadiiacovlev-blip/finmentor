# FINMENTOR — deploy reviewed Lead Intake Code-node sources (INDP1-02).
#
# Installs n8n/src/lead-intake/normalize-score-lead.js and dedup-guard.js into the live
# workflow. Lead Intake is the revenue path, so this asserts that only the named nodes
# changed, that active state is preserved, and that what n8n stored matches the reviewed
# files byte for byte before reporting success.

param(
    [string]$WorkflowId = 'QmIyEW2ZEqKregmN',
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "LEAD INTAKE DEPLOY ABORTED: $m" }

$srcDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'n8n/src/lead-intake'
$map = [ordered]@{
    'Normalize + Score Lead' = 'normalize-score-lead.js'
    'Dedup Guard'            = 'dedup-guard.js'
}

$sources = @{}
foreach ($node in $map.Keys) {
    $p = Join-Path $srcDir $map[$node]
    if (-not (Test-Path $p)) { Fail "missing source: $p" }
    $sources[$node] = Get-Content -Raw -Encoding UTF8 $p
}

# The trust boundary must be present in what we are about to ship.
if ($sources['Normalize + Score Lead'] -notmatch 'provenanceTrusted') { Fail 'normalize source does not compute provenanceTrusted' }
# The comments quote the old expression by design, so this checks executable lines only.
$normalizeExec = ($sources['Normalize + Score Lead'] -split "`n" | Where-Object { $_.TrimStart() -notlike '//*' }) -join "`n"
if ($normalizeExec -match 'pick\(incoming\.lead_id') { Fail 'normalize source still adopts the caller lead_id' }
if ($sources['Dedup Guard'] -notmatch 'lead\.provenance_trusted && lead\.lead_id') { Fail 'dedup source does not gate the strong tier on provenance' }

Write-Host "FINMENTOR Lead Intake node deploy  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

$wf = Get-N8nWorkflow -Id $WorkflowId
$wasActive = [bool]$wf.active
Write-Host "  $WorkflowId  active=$wasActive  nodes=$($wf.nodes.Count)  $($wf.name)"

if (-not $SnapshotDir) { $SnapshotDir = Join-Path $env:TEMP "finmentor-intake-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null
Save-WorkflowSnapshot -Workflow $wf -Directory $SnapshotDir -Label 'before' | Out-Null
Write-Host "  rollback snapshot: $SnapshotDir"

$targets = @($map.Keys)
$othersBefore = ($wf.nodes | Where-Object { $targets -notcontains $_.name } | Sort-Object name | ConvertTo-Json -Depth 100)

foreach ($node in $map.Keys) {
    $n = @($wf.nodes | Where-Object { $_.name -eq $node })
    if ($n.Count -ne 1) { Fail "expected exactly one node '$node'; found $($n.Count)" }
    if ($n[0].type -ne 'n8n-nodes-base.code') { Fail "node '$node' is $($n[0].type), expected a Code node" }
    Write-Host ("    {0}: {1} -> {2} chars" -f $node, $n[0].parameters.jsCode.Length, $sources[$node].Length)
    $n[0].parameters.jsCode = $sources[$node]
}

Write-Host '  preflight: PASS'
if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. No workflow was changed.'; return }

$body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
$null = Invoke-N8n -Method Put -Path "/workflows/$WorkflowId" -Body $body -Write
Start-Sleep -Milliseconds 1000

$verify = Get-N8nWorkflow -Id $WorkflowId
if ([bool]$verify.active -ne $wasActive)     { Fail "active state changed ($wasActive -> $($verify.active))" }
if ($verify.nodes.Count -ne $wf.nodes.Count) { Fail 'node count changed' }

$norm = { param($s) ($s -replace "`r`n", "`n").TrimEnd() }
foreach ($node in $map.Keys) {
    $deployed = ($verify.nodes | Where-Object { $_.name -eq $node }).parameters.jsCode
    if ((& $norm $deployed) -ne (& $norm $sources[$node])) { Fail "read-after-write: '$node' does not match the reviewed source" }
}

$othersAfter = ($verify.nodes | Where-Object { $targets -notcontains $_.name } | Sort-Object name | ConvertTo-Json -Depth 100)
if ($othersAfter -ne $othersBefore) { Fail 'read-after-write: a node outside the target set was modified' }

Save-WorkflowSnapshot -Workflow $verify -Directory $SnapshotDir -Label 'after' | Out-Null

Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host '  only target nodes changed: PASS'
Write-Host "  active unchanged: $($verify.active)"
Write-Host "  structural hash: $((Get-WorkflowStructuralHash -Workflow $verify).Substring(0,16))"
