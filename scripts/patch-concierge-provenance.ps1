# FINMENTOR — let the Telegram Concierge prove provenance to Lead Intake (INDP1-02).
#
# Lead Intake now honours a caller-supplied lead_id only when the request presents the
# shared key held in Settings under `internal_intake_key`. The Concierge is the one
# legitimate caller that needs that, because it updates the lead row it already owns.
#
# This adds the header, sourced from Settings. While `internal_intake_key` is unset the
# header is empty and Lead Intake trusts nobody, which is the safe default: Concierge leads
# still de-duplicate through their Telegram identity, they simply do not get the strong tier.

param(
    [string]$WorkflowId = 'mppzthlkSJFr6Kle',
    [string]$NodeName   = 'Send Lead to Intake',
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "CONCIERGE PROVENANCE PATCH ABORTED: $m" }

$HEADER_NAME = 'x-finmentor-internal-key'
$HEADER_EXPR = "={{ \$('Settings to Object').first().json.settings.internal_intake_key || '' }}"

Write-Host "FINMENTOR Concierge provenance patch  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

$wf = Get-N8nWorkflow -Id $WorkflowId
$wasActive = [bool]$wf.active
Write-Host "  $WorkflowId  active=$wasActive  nodes=$($wf.nodes.Count)  $($wf.name)"

if (-not $SnapshotDir) { $SnapshotDir = Join-Path $env:TEMP "finmentor-concierge-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null
Save-WorkflowSnapshot -Workflow $wf -Directory $SnapshotDir -Label 'before' | Out-Null
Write-Host "  rollback snapshot: $SnapshotDir"

$target = @($wf.nodes | Where-Object { $_.name -eq $NodeName })
if ($target.Count -ne 1) { Fail "expected exactly one node '$NodeName'; found $($target.Count)" }
$node = $target[0]
if ($node.type -ne 'n8n-nodes-base.httpRequest') { Fail "node '$NodeName' is $($node.type), expected httpRequest" }

$othersBefore = ($wf.nodes | Where-Object { $_.name -ne $NodeName } | Sort-Object name | ConvertTo-Json -Depth 100)

$existing = $node.parameters.headerParameters
if ($existing -and (($existing | ConvertTo-Json -Depth 20) -match [regex]::Escape($HEADER_NAME))) {
    Fail 'the provenance header is already configured; refusing to double-patch'
}

$node.parameters | Add-Member -NotePropertyName sendHeaders -NotePropertyValue $true -Force
$node.parameters | Add-Member -NotePropertyName headerParameters -NotePropertyValue ([pscustomobject]@{
    parameters = @(
        [pscustomobject]@{ name = $HEADER_NAME; value = $HEADER_EXPR }
    )
}) -Force

Write-Host "  header added: $HEADER_NAME (value read from Settings)"
Write-Host '  preflight: PASS'
if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. No workflow was changed.'; return }

$body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
$null = Invoke-N8n -Method Put -Path "/workflows/$WorkflowId" -Body $body -Write
Start-Sleep -Milliseconds 1000

$verify = Get-N8nWorkflow -Id $WorkflowId
if ([bool]$verify.active -ne $wasActive)     { Fail "active state changed ($wasActive -> $($verify.active))" }
if ($verify.nodes.Count -ne $wf.nodes.Count) { Fail 'node count changed' }

$vNode = ($verify.nodes | Where-Object { $_.name -eq $NodeName })
if ($vNode.parameters.sendHeaders -ne $true) { Fail 'read-after-write: sendHeaders not persisted' }
$vHeaders = $vNode.parameters.headerParameters | ConvertTo-Json -Depth 20
if ($vHeaders -notmatch [regex]::Escape($HEADER_NAME))     { Fail 'read-after-write: header name not persisted' }
if ($vHeaders -notmatch 'internal_intake_key')             { Fail 'read-after-write: header value not sourced from Settings' }
# The key itself must never be hardcoded into the graph.
if ($vHeaders -match '"value"\s*:\s*"[A-Za-z0-9_-]{16,}"')  { Fail 'read-after-write: a literal key appears to be hardcoded' }

$othersAfter = ($verify.nodes | Where-Object { $_.name -ne $NodeName } | Sort-Object name | ConvertTo-Json -Depth 100)
if ($othersAfter -ne $othersBefore) { Fail 'read-after-write: a node outside the target was modified' }

Save-WorkflowSnapshot -Workflow $verify -Directory $SnapshotDir -Label 'after' | Out-Null

Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host '  only the target node changed: PASS'
Write-Host "  active unchanged: $($verify.active)"
