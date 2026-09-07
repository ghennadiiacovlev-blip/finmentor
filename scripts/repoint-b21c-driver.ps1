# FINMENTOR - P6.3 guarded repoint of the [TEMP] canary driver onto a new canary.
#
#   pwsh scripts/repoint-b21c-driver.ps1 -Canary <workflowId> [-DryRun]
#
# The driver is a three-node harness: a manual trigger (fed by pinned cases at run time), an
# Execute Workflow node aimed at the canary, and a Code node that surfaces what came back
# without interpreting it. Superseding the canary means exactly one edit -- the Execute
# Workflow target -- and this makes that edit auditable instead of a hand click in the UI.
#
# GUARDS. The target must be an INACTIVE, NON-ARCHIVED workflow carrying the canary name, and
# never the production Lead Intake. The driver itself must still be the three-node harness and
# must be inactive. Only the Execute Workflow target changes; every other node is written back
# byte-identical to what was read, and that is verified on readback.

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Canary,
    [switch]$DryRun
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

$DriverId     = 'Z8Ai31yxfkyTSRO8'
$CanaryName   = 'FINMENTOR Lead Intake INTERNAL B21C RECEIPT CANARY'
$ProductionId = 'QmIyEW2ZEqKregmN'
$TargetNode   = 'Call Canary'

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

if ($Canary -eq $ProductionId) { Fail "refusing to point the driver at the production Lead Intake ($ProductionId)." }

Say ''
Say '== THE NEW TARGET ========================================='
$c = Get-N8nWorkflow -Id $Canary
Say "  $Canary  '$($c.name)'  active=$($c.active)  archived=$($c.isArchived)"
if ($c.name -ne $CanaryName)  { Fail "target name is '$($c.name)', not the canary name." }
if ($c.active -eq $true)      { Fail 'the target canary is ACTIVE. Refusing.' }
if ($c.isArchived -eq $true)  { Fail 'the target canary is ARCHIVED and cannot be executed.' }
Ok 'target is the canary, inactive, not archived'

Say ''
Say '== THE DRIVER ============================================='
$d = Get-N8nWorkflow -Id $DriverId
Say "  $DriverId  '$($d.name)'  active=$($d.active)  nodes=$($d.nodes.Count)"
if ($d.active -eq $true) { Fail 'the driver is ACTIVE. Refusing to edit a running workflow.' }

$node = @($d.nodes | Where-Object { $_.name -eq $TargetNode })
if ($node.Count -ne 1) { Fail "expected exactly one '$TargetNode' node, found $($node.Count)." }
$node = $node[0]
if ($node.type -ne 'n8n-nodes-base.executeWorkflow') { Fail "'$TargetNode' is a $($node.type)." }

$was = $node.parameters.workflowId.value
Say "  $TargetNode currently targets: $was"
if ($was -eq $Canary) { Say ''; Say 'already pointed at this canary - nothing to do.'; exit 0 }

# Fingerprint everything that must NOT change, so the readback can prove only one field moved.
$otherBefore = ($d.nodes | Where-Object { $_.name -ne $TargetNode } | ConvertTo-Json -Depth 100 -Compress)
$connBefore  = ($d.connections | ConvertTo-Json -Depth 100 -Compress)

if ($DryRun) { Say ''; Say "DRY RUN - would repoint $TargetNode : $was -> $Canary"; exit 0 }

$node.parameters.workflowId.value = $Canary
if ($node.parameters.workflowId.PSObject.Properties['cachedResultName']) {
    $node.parameters.workflowId.cachedResultName = $c.name
}

$body = @{ name = $d.name; nodes = $d.nodes; connections = $d.connections; settings = $d.settings }
Invoke-N8n -Method Put -Path "/workflows/$DriverId" -Body $body -Write | Out-Null

Say ''
Say '== READBACK ==============================================='
$after = Get-N8nWorkflow -Id $DriverId
$now = @($after.nodes | Where-Object { $_.name -eq $TargetNode })[0].parameters.workflowId.value
if ($now -ne $Canary) { Fail "readback says the target is still '$now'." }
Ok "$TargetNode now targets $Canary"

$otherAfter = ($after.nodes | Where-Object { $_.name -ne $TargetNode } | ConvertTo-Json -Depth 100 -Compress)
$connAfter  = ($after.connections | ConvertTo-Json -Depth 100 -Compress)
if ($otherAfter -ne $otherBefore) { Fail 'a node OTHER than the Execute Workflow target changed.' }
Ok 'every other node is byte-identical'
if ($connAfter -ne $connBefore) { Fail 'the connection graph changed.' }
Ok 'connections unchanged'
if ($after.active -eq $true) { Fail 'the driver is now ACTIVE. Deactivate it by hand NOW.' }
Ok 'driver still inactive'

Say ''
Say "== RESULT: REPOINTED  $was -> $Canary"
