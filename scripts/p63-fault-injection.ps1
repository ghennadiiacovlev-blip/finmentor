# FINMENTOR - P6.3 fault injection: make the three F11 terminals ACTUALLY FIRE on the platform.
#
#   pwsh scripts/p63-fault-injection.ps1 -Node 'Read Settings' -CasePath <case.json> -Create
#   pwsh scripts/p63-fault-injection.ps1 -EnableParentMcp
#   pwsh scripts/p63-fault-injection.ps1 -Show
#   pwsh scripts/p63-fault-injection.ps1 -Teardown
#
# WHY THIS EXISTS -- and it exists because a claim I made was too strong.
#
# The P6.3 live batch ran six negative cases and all six returned a structured envelope at the
# caller. That was recorded as "F11 CLOSED LIVE". It is not. Every one of those six terminated
# at `Internal Result (Fault)` after FOUR nodes, through `IF Internal Fault` -- a gate fed
# normally, which F11 never affected.
#
# F11 was about three gates fed from ERROR OUTPUTS:
#
#   Read Settings / Read Pipeline (Dedup)  --error-->  IF Internal (Infra)
#   Save to Pipeline                       --error-->  IF Internal (PipelineFailed)
#   Update Pipeline (Merge)                --error-->  IF Internal (MergeFailed)
#
# An n8n error item does not carry the failing node's input json, so the old `$json.__internal`
# form read `undefined`, took the PUBLIC branch, and threw at the internal caller. The fix reads
# the flag by node reference instead. Nothing in the live batch exercised any of that, because
# no node failed. The terminals were unreachable before the fix and remain UNOBSERVED after it.
#
# The only way to observe them is to make a node fail on purpose. This deploys a disposable COPY
# of the audited artifact with exactly one Google Sheets node pointed at a document id that does
# not exist. That node then fails for real, its error output fires for real, and the gate either
# routes to the internal terminal or it does not.
#
# WHY THIS IS SAFE. The injected node is chosen so that nothing downstream of the failure can
# write:
#
#   * `Read Settings` is the FIRST credentialed node on the route. Failing it means no read and
#     no write of any kind happens afterwards -- zero residue.
#   * `Save to Pipeline` fails AT the write, so the CRM row is never created. It does leave the
#     receipt in CLAIMED, which is data-table residue and is removed by p63-residue-sweep.ps1.
#
# GUARDS.
#   1. Only the four error-output-fed Sheets nodes may be injected. Nothing else is targetable.
#   2. Exactly ONE node may differ from the tracked artifact, and only in its documentId. The
#      diff is computed and asserted after the substitution, not trusted.
#   3. The copy is deployed under a [TEMP] name that is NOT the canary name, so it can never be
#      confused with the validated canary or trip the deploy script's duplicate guard.
#   4. It is created inactive and never MCP-exposed; only the credential-free driver is.

[CmdletBinding()]
param(
    [ValidateSet('Read Settings', 'Read Pipeline (Dedup)', 'Save to Pipeline', 'Update Pipeline (Merge)')]
    [string]$Node,
    [string]$CasePath,
    [switch]$Create,
    [switch]$Show,
    [switch]$Teardown,
    [switch]$EnableParentMcp
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here

$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$ArtifactPath = Join-Path $Root 'n8n/candidate/lead-intake-internal-receipt-API-IMPORT.json'
$CanaryName   = 'FINMENTOR Lead Intake INTERNAL B21C RECEIPT CANARY'
$ProductionId = 'QmIyEW2ZEqKregmN'
$BadDocId     = '1P63FaultInjectionDocumentThatDoesNotExist0000'
$ParentName   = '[TEMP] P63 fault injection driver'

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

function Get-ChildName { param([string]$N) "[TEMP] P63 fault injection - $N" }

function Get-Existing {
    # LIVE FIRST: an archived namesake must never shadow the live one.
    $all = Get-N8nWorkflowList
    $pick = {
        param($name)
        $all | Where-Object { $_.name -eq $name } |
            Sort-Object -Property @{ Expression = { [bool]$_.isArchived } }, @{ Expression = { $_.createdAt }; Descending = $true } |
            Select-Object -First 1
    }
    $children = $all | Where-Object { $_.name -like '`[TEMP`] P63 fault injection - *' -and -not $_.isArchived }
    [pscustomobject]@{ Parent = & $pick $ParentName; Children = @($children) }
}

if (-not ($Create -or $Show -or $Teardown -or $EnableParentMcp)) {
    Fail 'choose one of -Create, -Show, -EnableParentMcp, -Teardown.'
}

Say ''
Say '== P6.3 FAULT INJECTION ==================================='
Say "  tenant : $($env:N8N_BASE_URL)"

$existing = Get-Existing

if ($Show) {
    Say ''
    Say ("  parent   : " + $(if ($existing.Parent) { "$($existing.Parent.id)  archived=$($existing.Parent.isArchived)" } else { 'absent' }))
    if ($existing.Children.Count -eq 0) { Say '  children : none live' }
    else { foreach ($c in $existing.Children) { Say "  child    : $($c.id)  '$($c.name)'" } }
    Say ''
    exit 0
}

if ($Teardown) {
    $all = Get-N8nWorkflowList
    $targets = $all | Where-Object { ($_.name -eq $ParentName -or $_.name -like '`[TEMP`] P63 fault injection - *') -and -not $_.isArchived }
    if (-not $targets) { Ok 'nothing live to tear down' }
    foreach ($w in $targets) {
        if ($w.id -eq $ProductionId) { Fail 'refusing to touch production.' }
        Invoke-N8n -Method POST -Path "/workflows/$($w.id)/archive" -Write | Out-Null
        Ok "archived $($w.name)  ($($w.id))"
    }
    Say ''
    Say 'Teardown complete. Archived, not deleted.'
    exit 0
}

if ($EnableParentMcp) {
    if ($null -eq $existing.Parent) { Fail "'$ParentName' does not exist. Run -Create first." }
    $p = Get-N8nWorkflow -Id $existing.Parent.id
    if ($p.active) { Fail 'the parent is ACTIVE. Refusing.' }
    if ($p.nodes.Count -ne 4) { Fail "the parent is not the four-node harness ($($p.nodes.Count) nodes)." }
    $settings = @{}
    foreach ($prop in $p.settings.PSObject.Properties) { $settings[$prop.Name] = $prop.Value }
    $settings['availableInMCP'] = $true
    Invoke-N8n -Method PUT -Path "/workflows/$($p.id)" -Write -Body @{ name = $p.name; nodes = $p.nodes; connections = $p.connections; settings = $settings } | Out-Null
    $back = Get-N8nWorkflow -Id $p.id
    if (-not $back.settings.availableInMCP) { Fail 'the setting did not stick.' }
    if ($back.active) { Fail "the parent came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($p.id)" }
    Ok "parent $($p.id) is MCP-available, still inactive"
    Say ''
    exit 0
}

# -- Create ---------------------------------------------------------------------------------
if (-not $Node)     { Fail '-Create needs -Node.' }
if (-not $CasePath) { Fail '-Create needs -CasePath (a JSON file holding the single input item).' }
if (-not (Test-Path $CasePath)) { Fail "case file not found: $CasePath" }

$ChildName = Get-ChildName $Node
$live = $existing.Children | Where-Object { $_.name -eq $ChildName }
if ($live) { Fail "a LIVE '$ChildName' already exists ($($live.id)). Tear it down first." }
if ($existing.Parent -and -not $existing.Parent.isArchived) { Fail "a LIVE '$ParentName' already exists ($($existing.Parent.id)). Tear it down first." }

$artifactRaw = Get-Content -Path $ArtifactPath -Raw -Encoding utf8
$wf = $artifactRaw | ConvertFrom-Json
if ($wf.nodes.Count -ne 100) { Fail "artifact is $($wf.nodes.Count) nodes, expected 100." }
if ($wf.name -ne $CanaryName) { Fail "artifact name is '$($wf.name)', expected the canary name." }

$target = $wf.nodes | Where-Object { $_.name -eq $Node }
if (-not $target) { Fail "node '$Node' not found in the artifact." }
if ($target.type -ne 'n8n-nodes-base.googleSheets') { Fail "'$Node' is a $($target.type), not a Google Sheets node." }
if ($target.onError -ne 'continueErrorOutput') { Fail "'$Node' has onError='$($target.onError)'; without an error output there is nothing to prove." }

$originalDoc = $target.parameters.documentId.value
$target.parameters.documentId.value = $BadDocId
$wf.name = $ChildName
$wf.settings.availableInMCP = $false

# GUARD 2 -- exactly one node differs, and only in its documentId. Computed, not trusted.
$before = ($artifactRaw | ConvertFrom-Json).nodes
$diff = @()
for ($i = 0; $i -lt $before.Count; $i++) {
    $a = $before[$i] | ConvertTo-Json -Depth 40 -Compress
    $b = $wf.nodes[$i] | ConvertTo-Json -Depth 40 -Compress
    if ($a -ne $b) { $diff += $wf.nodes[$i].name }
}
if ($diff.Count -ne 1)      { Fail "expected exactly 1 changed node, got $($diff.Count): $($diff -join ', ')" }
if ($diff[0] -ne $Node)     { Fail "the changed node is '$($diff[0])', not '$Node'." }
Ok "exactly one node changed: '$Node'  documentId $originalDoc -> $BadDocId"

$others = $wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.googleSheets' -and $_.name -ne $Node }
foreach ($o in $others) {
    if ($o.parameters.documentId.value -ne $originalDoc) { Fail "'$($o.name)' documentId drifted." }
}
Ok "all $($others.Count) other Sheets nodes still point at the real document"
if ($wf.name -eq $CanaryName) { Fail 'the copy still carries the canary name.' }

$body = @{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
$child = Invoke-N8n -Method POST -Path '/workflows' -Body $body -Write
Ok "child  created: $($child.id)  '$ChildName'"

$back = Get-N8nWorkflow -Id $child.id
if ($back.active) { Fail "it came back ACTIVE. DEACTIVATE IT BY HAND NOW: $($child.id)" }
if ($back.settings.availableInMCP) { Fail "it came back MCP-exposed: $($child.id)" }
if ($back.nodes.Count -ne 100) { Fail "it came back with $($back.nodes.Count) nodes." }
Ok 'inactive, not MCP-exposed, 100 nodes'

$caseJson = (Get-Content -Path $CasePath -Raw -Encoding utf8).Trim()
$null = $caseJson | ConvertFrom-Json   # parse-check before embedding
$caseCode = "// P6.3 fault-injection case, generated from $([System.IO.Path]::GetFileName($CasePath)).`nreturn [{ json: $caseJson }];"

$parentBody = @{
    name = $ParentName
    nodes = @(
        @{ id = 'p63f-start'; name = 'Start'; type = 'n8n-nodes-base.manualTrigger'; typeVersion = 1; position = @(0, 0); parameters = @{} },
        @{ id = 'p63f-case'; name = 'Case'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(220, 0); parameters = @{ jsCode = $caseCode } },
        @{ id = 'p63f-call'; name = 'Call Injected'; type = 'n8n-nodes-base.executeWorkflow'; typeVersion = 1.3; position = @(440, 0)
           parameters = @{ mode = 'each'; source = 'database'; workflowId = @{ __rl = $true; mode = 'id'; value = $child.id }; options = @{ waitForSubWorkflow = $true } } },
        @{ id = 'p63f-collect'; name = 'Collect'; type = 'n8n-nodes-base.code'; typeVersion = 2; position = @(660, 0)
           parameters = @{ jsCode = 'return $input.all().map((it) => ({ json: it.json }));' } }
    )
    connections = @{
        'Start'          = @{ main = @(, @(@{ node = 'Case'; type = 'main'; index = 0 })) }
        'Case'           = @{ main = @(, @(@{ node = 'Call Injected'; type = 'main'; index = 0 })) }
        'Call Injected'  = @{ main = @(, @(@{ node = 'Collect'; type = 'main'; index = 0 })) }
    }
    settings = @{ executionOrder = 'v1'; availableInMCP = $false }
}
$parent = Invoke-N8n -Method POST -Path '/workflows' -Body $parentBody -Write
Ok "parent created: $($parent.id)"

Say ''
Say "  next: -EnableParentMcp, then run $($parent.id) once."
Say '  expect the internal terminal for this node, NOT a throw and NOT a Respond* node.'
Say ''
