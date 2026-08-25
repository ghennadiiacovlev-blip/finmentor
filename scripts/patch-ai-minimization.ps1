# FINMENTOR — install AI_SAFE_PROJECTION into Lead Intake (INDP1-03).
#
# Replaces the jsCode of "Build AI Work Plan Prompt" with the reviewed projection core
# plus the prompt tail. The model stops receiving name, company, email, phone, Telegram,
# lead_id and the full raw payload (page URL + query, GA ids, consent metadata, referrer).
#
# Lead Intake is live production. This touches exactly one Code node: no other node,
# no connection, no credential and no active state is modified, and all of that is
# asserted by read-after-write before the script reports success.

param(
    [string]$WorkflowId = 'QmIyEW2ZEqKregmN',
    [string]$NodeName   = 'Build AI Work Plan Prompt',
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "AI MINIMIZATION PATCH ABORTED: $m" }

$srcDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'n8n/src/lead-intake'
$core = Get-Content -Raw -Encoding UTF8 (Join-Path $srcDir 'ai-safe-projection.js')
$tail = Get-Content -Raw -Encoding UTF8 (Join-Path $srcDir 'build-ai-prompt.tail.js')

# n8n Code nodes cannot require() local files, so the CommonJS export block is stripped and
# the core is inlined ahead of the tail. The exports exist only for the regression gate.
$marker = 'module.exports = {'
$idx = $core.IndexOf($marker)
if ($idx -lt 0) { Fail 'could not find the module.exports block in ai-safe-projection.js' }
$coreInline = $core.Substring(0, $idx).TrimEnd()

$jsCode = $coreInline + "`n`n" + $tail

# Strip line comments before the ban check: the source comments quote the very patterns
# being banned, and matching those would be a false positive.
$executable = ($jsCode -split "`n" | Where-Object { $_.TrimStart() -notlike "//*" }) -join "`n"
foreach ($banned in @('${item.email}', '${item.phone}', '${item.telegram}', '${item.name}', '${item.company}', '${item.lead_id}', 'JSON.stringify(raw)')) {
    if ($executable.Contains($banned)) { Fail "assembled code still interpolates $banned" }
}
if ($jsCode -notmatch 'buildAiSafeProjection') { Fail 'assembled code does not call buildAiSafeProjection' }
if ($jsCode -notmatch 'projectionLeak')        { Fail 'assembled code does not call projectionLeak' }
if ($jsCode -match 'module\.exports')          { Fail 'export block leaked into the node code' }

Write-Host "FINMENTOR AI minimization patch  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

$wf = Get-N8nWorkflow -Id $WorkflowId
$wasActive = [bool]$wf.active
$hashBefore = Get-WorkflowStructuralHash -Workflow $wf
Write-Host "  $WorkflowId  active=$wasActive  nodes=$($wf.nodes.Count)  $($wf.name)"

if (-not $SnapshotDir) { $SnapshotDir = Join-Path $env:TEMP "finmentor-ai-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null
Save-WorkflowSnapshot -Workflow $wf -Directory $SnapshotDir -Label 'lead-intake-before' | Out-Null
Write-Host "  rollback snapshot: $SnapshotDir"

$target = @($wf.nodes | Where-Object { $_.name -eq $NodeName })
if ($target.Count -ne 1) { Fail "expected exactly one node '$NodeName'; found $($target.Count)" }
if ($target[0].type -ne 'n8n-nodes-base.code') { Fail "node '$NodeName' is $($target[0].type), expected a Code node" }

$before = $target[0].parameters.jsCode
if ($before -notmatch 'JSON\.stringify\(raw\)') {
    Fail 'the current node does not contain the expected raw-payload interpolation; refusing to patch an unexpected version'
}

$otherNames = @($wf.nodes | Where-Object { $_.name -ne $NodeName } | ForEach-Object { $_.name } | Sort-Object)
$otherHash = ($wf.nodes | Where-Object { $_.name -ne $NodeName } | Sort-Object name | ConvertTo-Json -Depth 100)

$target[0].parameters.jsCode = $jsCode

Write-Host "  prompt node rewritten: $($before.Length) -> $($jsCode.Length) chars"
Write-Host '  preflight: PASS'

if (-not $Apply) {
    Write-Host 'DRY-RUN COMPLETE. No workflow was changed.'
    return
}

$body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
$null = Invoke-N8n -Method Put -Path "/workflows/$WorkflowId" -Body $body -Write
Start-Sleep -Milliseconds 1000

$verify = Get-N8nWorkflow -Id $WorkflowId
if ([bool]$verify.active -ne $wasActive)          { Fail "active state changed ($wasActive -> $($verify.active))" }
if ($verify.nodes.Count -ne $wf.nodes.Count)      { Fail 'node count changed' }

$deployed = ($verify.nodes | Where-Object { $_.name -eq $NodeName }).parameters.jsCode
$norm = { param($s) ($s -replace "`r`n", "`n").TrimEnd() }
if ((& $norm $deployed) -ne (& $norm $jsCode))    { Fail 'read-after-write: deployed code does not match the assembled source' }

# Nothing outside the single target node may have moved.
$verifyOtherNames = @($verify.nodes | Where-Object { $_.name -ne $NodeName } | ForEach-Object { $_.name } | Sort-Object)
if (Compare-Object $otherNames $verifyOtherNames) { Fail 'read-after-write: the set of other nodes changed' }
$verifyOtherHash = ($verify.nodes | Where-Object { $_.name -ne $NodeName } | Sort-Object name | ConvertTo-Json -Depth 100)
if ($verifyOtherHash -ne $otherHash)              { Fail 'read-after-write: a node other than the target was modified' }

Save-WorkflowSnapshot -Workflow $verify -Directory $SnapshotDir -Label 'lead-intake-after' | Out-Null

Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host '  only the target node changed: PASS'
Write-Host "  active unchanged: $($verify.active)"
Write-Host "  hash before: $($hashBefore.Substring(0,16))"
Write-Host "  hash after : $((Get-WorkflowStructuralHash -Workflow $verify).Substring(0,16))"
