# FINMENTOR — P6.2 guarded deployment of the B.2.1-C internal receipt canary.
#
#   pwsh scripts/deploy-b21c-canary.ps1 -DryRun     # preflight only, no write
#   pwsh scripts/deploy-b21c-canary.ps1 -Deploy     # preflight, POST, verify, report
#
# WHAT THIS DOES. Posts n8n/candidate/lead-intake-internal-receipt-API-IMPORT.json to
# POST /api/v1/workflows, VERBATIM from disk, and then reads the created workflow back and
# proves it is inert. This is the P6 candidate-deployment step that the MCP surface cannot
# perform without re-typing 98,890 characters of production Code bodies.
#
# THE FILE IS POSTED AS RAW BYTES. It is deliberately NOT parsed and re-serialised through
# ConvertTo-Json: a round-trip through PowerShell's object model can reorder keys, coerce
# numbers and mangle deep structures, and the entire reason this path was chosen over hand
# transcription is that the graph must reach n8n unaltered. Read bytes, send bytes.
#
# CREDENTIALS. Write scope, from the environment only, never printed, never stored. Per the
# header of scripts/n8n-lib.ps1, B.2.1-C live work requires a FRESHLY ISSUED key scoped as
# narrowly as the task allows and revoked afterwards. Do not reinstate an old key to make
# this run.
#
# WHAT THIS SCRIPT WILL NOT DO: it never activates the workflow, never enables MCP exposure,
# never touches the production Lead Intake workflow, and never posts the canonical audited
# candidate — that artifact still carries the production identity and the live public
# endpoint, and is an audit anchor, not a deployment artifact.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here
. (Join-Path $Here 'n8n-lib.ps1')

$ArtifactPath = Join-Path $Root 'n8n/candidate/lead-intake-internal-receipt-API-IMPORT.json'

$CanaryName        = 'FINMENTOR Lead Intake INTERNAL B21C RECEIPT CANARY'
$InertWebhookPath  = '__disabled_b21c_internal_candidate'
$ProductionPath    = 'finmentor-lead-intake'
$ProductionId      = 'QmIyEW2ZEqKregmN'
$ExpectedNodeCount = 100

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Bad  { param([string]$m) Write-Host "  FAIL  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

if (-not $DryRun -and -not $Deploy) {
    Fail 'specify -DryRun (preflight only) or -Deploy (preflight then write).'
}

# ============================================================ preflight

Say ''
Say '== PREFLIGHT =============================================='

# --- 1. the artifact exists and passes its own offline gate -------------------
if (-not (Test-Path $ArtifactPath)) { Fail "artifact not found: $ArtifactPath" }

$gate = & node (Join-Path $Root 'qa/api-import.test.mjs') 2>&1
if ($LASTEXITCODE -ne 0) {
    $gate | ForEach-Object { Write-Host $_ }
    Fail 'the offline API-import gate FAILED. Refusing to deploy an unverified artifact.'
}
Ok 'offline gate qa/api-import.test.mjs passed'

# --- 2. read the bytes, and sanity-check them independently of the gate -------
$rawBytes = [System.IO.File]::ReadAllBytes($ArtifactPath)
$rawText  = [System.Text.Encoding]::UTF8.GetString($rawBytes)

if ($rawText.Contains($ProductionId))   { Fail "the artifact contains the production workflow id $ProductionId" }
if ($rawText.Contains($ProductionPath)) { Fail "the artifact contains the production webhook path $ProductionPath" }
Ok 'artifact carries neither the production id nor the production webhook path'

$doc = $rawText | ConvertFrom-Json
$fields = ($doc.PSObject.Properties.Name | Sort-Object) -join ','
if ($fields -ne 'connections,name,nodes,settings') {
    Fail "artifact top-level fields are [$fields], expected [connections,name,nodes,settings]"
}
Ok 'artifact carries exactly the four API-accepted fields'

if ($doc.name -ne $CanaryName)                { Fail "artifact name is '$($doc.name)'" }
if ($doc.nodes.Count -ne $ExpectedNodeCount)  { Fail "artifact has $($doc.nodes.Count) nodes, expected $ExpectedNodeCount" }
if ($doc.settings.availableInMCP -ne $false)  { Fail 'artifact settings.availableInMCP is not false' }
Ok "artifact: $ExpectedNodeCount nodes, availableInMCP false, name '$CanaryName'"

# --- 3. credentials present (never printed) -----------------------------------
try { $ctx = Get-N8nContext -Write } catch { Fail "$($_.Exception.Message)  (a FRESH write-scoped key is required)" }
Ok "write credentials present for $($ctx.Base)"

# --- 4. no canary already exists — refuse to create a duplicate ---------------
# ARCHIVED workflows do not count as duplicates. They cannot run, cannot serve, and cannot be
# confused for the live canary; refusing on their account would mean the only way to redeploy
# a corrected candidate is to permanently delete the superseded one, which is strictly worse
# than keeping it archived for the record.
$sameName = @(Get-N8nWorkflowList | Where-Object { $_.name -eq $CanaryName })
$archived = @($sameName | Where-Object { $_.isArchived -eq $true })
$existing = @($sameName | Where-Object { $_.isArchived -ne $true })
if ($existing.Count -gt 0) {
    $existing | ForEach-Object { Bad "already exists (not archived): $($_.id)  active=$($_.active)" }
    Fail 'a live canary with this name already exists. Archive or rename it first — this script will not create a second.'
}
if ($archived.Count -gt 0) {
    $archived | ForEach-Object { Say "  note: superseded archived canary retained: $($_.id)" }
}
Ok 'no LIVE workflow with the canary name exists yet'

# --- 5. record the production workflow fingerprint, to prove we did not touch it
$prodBefore = Get-N8nWorkflow -Id $ProductionId
# The library predates this script's Set-StrictMode and reads node properties (.disabled)
# that are absent on many production nodes. Strict mode is relaxed for the CALL ONLY --
# narrowing it here rather than editing shared library code that other scripts rely on.
$prodHashBefore = & { Set-StrictMode -Off; Get-WorkflowStructuralHash -Workflow $prodBefore }
Ok "production Lead Intake fingerprint recorded: $($prodHashBefore.Substring(0,16))… (active=$($prodBefore.active))"

if ($DryRun) {
    Say ''
    Say 'DRY RUN — preflight passed, nothing was written.'
    Say 'Re-run with -Deploy to create the canary.'
    exit 0
}

# ============================================================ the write

Say ''
Say '== CREATE ================================================='

$uri = "$($ctx.Base)/api/v1/workflows"
try {
    $created = Invoke-RestMethod -Method Post -Uri $uri -Headers $ctx.Headers `
        -ContentType 'application/json; charset=utf-8' -Body $rawBytes
} catch {
    $status = $null
    try { $status = $_.Exception.Response.StatusCode.value__ } catch { }
    Say ''
    Say "POST failed$(if ($status) { " with HTTP $status" })."
    Say $_.Exception.Message
    if ($status -eq 400) {
        Say ''
        Say 'HTTP 400 means the endpoint rejected a field. The likely cause is a `settings` key'
        Say 'this n8n version does not accept (binaryMode / availableInMCP / errorWorkflow).'
        Say 'Do NOT strip settings keys to force this through: availableInMCP:false is a safety'
        Say 'property and errorWorkflow is preserved deliberately. Report the exact message.'
    }
    Fail 'no workflow was created.'
}

if (-not $created.id) { Fail 'the API returned no workflow id; state is unknown — check the UI before retrying.' }
$newId = $created.id
Say "  created: $newId"

# ============================================================ post-deploy proof

Say ''
Say '== VERIFY (against the live object, not the file) =========='

$live = Get-N8nWorkflow -Id $newId
$problems = @()

# Strict-safe property read for SERVER RESPONSE objects.
#
# Two failure modes have to be avoided at once here, and they pull in opposite directions.
# With Set-StrictMode on, a property the server simply omitted throws and the run dies in the
# middle of verification. With strict mode off, `$live.active -eq $true` on an ABSENT property
# yields $null -eq $true -> false, which falls into the else branch and prints
# "active === false" -- a FALSE PASS on the single most important assertion in this script.
#
# So absence is treated as its own outcome: Get-LiveProp reports whether the property was
# there, and a missing property is recorded as a PROBLEM rather than silently satisfying a
# negative comparison.
function Get-LiveProp {
    param($Object, [Parameter(Mandatory)][string]$Path)
    $cur = $Object
    foreach ($seg in $Path.Split('.')) {
        if ($null -eq $cur) { return [pscustomobject]@{ Found = $false; Value = $null } }
        $prop = $cur.PSObject.Properties[$seg]
        if ($null -eq $prop) { return [pscustomobject]@{ Found = $false; Value = $null } }
        $cur = $prop.Value
    }
    [pscustomobject]@{ Found = $true; Value = $cur }
}

# THE assertion. `active: false` could not be carried by the artifact, because the endpoint
# rejects the field — so inactivity was, until this moment, only the server's default. This is
# the first and only place it can actually be established.
$activeProp = Get-LiveProp $live 'active'
if (-not $activeProp.Found) {
    Bad 'active: PROPERTY ABSENT — inactivity could NOT be confirmed'
    $problems += 'the API response carries no `active` property, so inactivity is unconfirmed'
} elseif ($activeProp.Value -eq $true) {
    Bad 'the created workflow is ACTIVE'
    Say '  -> deactivating immediately'
    try {
        Invoke-RestMethod -Method Post -Uri "$($ctx.Base)/api/v1/workflows/$newId/deactivate" `
            -Headers $ctx.Headers -ContentType 'application/json' | Out-Null
        $live = Get-N8nWorkflow -Id $newId
        if ((Get-LiveProp $live 'active').Value -eq $true) { Fail "workflow $newId is ACTIVE and could not be deactivated. DEACTIVATE IT BY HAND NOW." }
        Say '  -> deactivated'
    } catch {
        Fail "workflow $newId is ACTIVE and deactivation failed. DEACTIVATE IT BY HAND NOW: $($_.Exception.Message)"
    }
    $problems += 'created ACTIVE (server default is not inactive) — deactivated, but the artifact cannot guarantee this'
} else {
    Ok 'active === false'
}

if ($live.name -ne $CanaryName) { $problems += "name is '$($live.name)'" } else { Ok "name === $CanaryName" }

if ($live.nodes.Count -ne $ExpectedNodeCount) {
    $problems += "node count is $($live.nodes.Count), expected $ExpectedNodeCount"
} else { Ok "nodes.length === $ExpectedNodeCount" }

$hook = @($live.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' })
if ($hook.Count -ne 1) {
    $problems += "webhook node count is $($hook.Count), expected 1"
} else {
    $disProp = Get-LiveProp $hook[0] 'disabled'
    if (-not $disProp.Found) {
        $problems += 'the webhook node has NO disabled property — it is not disabled'
    } elseif ($disProp.Value -ne $true) {
        $problems += 'the webhook node is NOT disabled'
    } else { Ok 'webhook disabled === true' }

    $pathProp = Get-LiveProp $hook[0] 'parameters.path'
    if (-not $pathProp.Found) {
        $problems += 'the webhook node has NO path parameter'
    } elseif ($pathProp.Value -ne $InertWebhookPath) {
        $problems += "webhook path is '$($pathProp.Value)', expected '$InertWebhookPath'"
    } else { Ok "webhook path === $InertWebhookPath" }
}

$liveJson = $live | ConvertTo-Json -Depth 100
if ($liveJson.Contains($ProductionPath)) {
    $problems += "the production path $ProductionPath is present in the deployed definition"
} else { Ok "production path $ProductionPath absent" }

$mcpProp = Get-LiveProp $live 'settings.availableInMCP'
if (-not $mcpProp.Found) {
    $problems += 'settings.availableInMCP is ABSENT from the response — MCP exposure state unconfirmed'
} elseif ($mcpProp.Value -ne $false) {
    $problems += "settings.availableInMCP is $($mcpProp.Value), expected false"
} else { Ok 'settings.availableInMCP === false' }

# --- production untouched -----------------------------------------------------
$prodAfter = Get-N8nWorkflow -Id $ProductionId
$prodHashAfter = & { Set-StrictMode -Off; Get-WorkflowStructuralHash -Workflow $prodAfter }
if ($prodHashAfter -ne $prodHashBefore) {
    $problems += 'THE PRODUCTION LEAD INTAKE WORKFLOW CHANGED DURING THIS RUN'
} else { Ok 'production Lead Intake structurally unchanged' }

# ============================================================ report

Say ''
if ($problems.Count -gt 0) {
    Say '== RESULT: DEPLOYED BUT NOT CLEAN ========================='
    $problems | ForEach-Object { Bad $_ }
    Say ''
    Say "Workflow id: $newId"
    Say 'Do NOT proceed to the P6 canaries. Resolve or delete the workflow first.'
    exit 1
}

Say '== RESULT: PASS ==========================================='
Say ''
Say "  workflow id : $newId"
Say "  name        : $CanaryName"
Say '  active      : false   (verified against the live object)'
Say "  nodes       : $ExpectedNodeCount"
Say '  webhook     : disabled, inert path'
Say ''
Say 'The canary is deployed and inert. It is NOT activated and must not be.'
Say "Give this id to Claude to resume P6 at step 4: $newId"
