# FINMENTOR — build the SECURE Lead Command Center candidate.
#
# Replaces the generic public Webhook entry with an authenticated Telegram Trigger,
# inserts a fail-closed identity gate ahead of any Settings/Pipeline access, installs the
# reviewed authorisation sources from n8n/src/command-center/, and repairs the stale sheet
# locators. The candidate is never published by this script.
#
# Safety: dry-run by default. -Apply performs the PUT and then a mandatory read-after-write
# verification; any mismatch throws and the caller must roll back from the snapshot.

param(
    [string]$CandidateWorkflowId = 'qF9tonlHHIxc8MDd',
    [string]$OriginalWorkflowId  = 'Ukn1cprWiXzBHojl',
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "COMMAND CENTER PATCH ABORTED: $m" }

$DOC_ID   = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
$DOC_URL  = "https://docs.google.com/spreadsheets/d/$DOC_ID/edit"
$GID_PIPELINE   = 1883973304
$GID_STATUS_LOG = 1810362432
$GID_ACTIVITIES = 623316892

$srcDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'n8n/src/command-center'
function Read-Src([string]$n) {
    $p = Join-Path $srcDir $n
    if (-not (Test-Path $p)) { Fail "missing source file: $p" }
    Get-Content -Raw -Encoding UTF8 $p
}
$srcVerify   = Read-Src 'verify-telegram-identity.js'
$srcParse    = Read-Src 'parse-lead-command.js'
$srcSettings = Read-Src 'settings-to-object.js'

Write-Host "FINMENTOR Command Center secure patch  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

# ---- preconditions -------------------------------------------------------------------
$original  = Get-N8nWorkflow -Id $OriginalWorkflowId
$candidate = Get-N8nWorkflow -Id $CandidateWorkflowId

if ($original.active -eq $true)  { Fail 'the unsafe original Command Center is still published; contain it first' }
if ($candidate.active -eq $true) { Fail 'the candidate is published; it must stay unpublished while patching' }
if ($candidate.name -notmatch 'SECURE CANDIDATE') { Fail "unexpected candidate name: $($candidate.name)" }

# Exactly one active Telegram Trigger may exist per bot token. Verify no other active
# workflow already binds the internal Leads Bot credential to a trigger.
$telegramCreds = @()
foreach ($n in $candidate.nodes) {
    if ($n.type -eq 'n8n-nodes-base.telegram' -and $n.credentials -and $n.credentials.telegramApi) {
        $telegramCreds += $n.credentials.telegramApi
    }
}
$uniqueCreds = @($telegramCreds | Group-Object { "$($_.id)|$($_.name)" } | ForEach-Object { $_.Group[0] })
if ($uniqueCreds.Count -ne 1) { Fail "expected exactly one Telegram credential in the Command Center; found $($uniqueCreds.Count)" }
$leadsCred = $uniqueCreds[0]
if ($leadsCred.name -notmatch 'Leads Bot') { Fail "expected the internal Leads Bot credential; found '$($leadsCred.name)'" }

foreach ($w in (Get-N8nWorkflowList | Where-Object { $_.active -and $_.id -ne $CandidateWorkflowId })) {
    $full = Get-N8nWorkflow -Id $w.id
    foreach ($n in $full.nodes) {
        if ($n.type -eq 'n8n-nodes-base.telegramTrigger' -and $n.credentials.telegramApi.id -eq $leadsCred.id) {
            Fail "active workflow $($w.id) already has a Telegram Trigger on the same bot credential"
        }
    }
}

# ---- snapshot ------------------------------------------------------------------------
if (-not $SnapshotDir) {
    $SnapshotDir = Join-Path $env:TEMP "finmentor-cc-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null
Save-WorkflowSnapshot -Workflow $original  -Directory $SnapshotDir -Label 'original-before'  | Out-Null
Save-WorkflowSnapshot -Workflow $candidate -Directory $SnapshotDir -Label 'candidate-before' | Out-Null
Write-Host "  rollback snapshot: $SnapshotDir"

# ---- transform -----------------------------------------------------------------------
$ENTRY_OLD    = 'Telegram Command Webhook'
$TRIGGER_NAME = 'Telegram Command Trigger'
$GATE_NAME    = 'Verify Telegram Identity'

$entry = @($candidate.nodes | Where-Object { $_.name -eq $ENTRY_OLD })
if ($entry.Count -ne 1) { Fail "expected exactly one '$ENTRY_OLD'; found $($entry.Count)" }
if ($entry[0].type -ne 'n8n-nodes-base.webhook') { Fail "expected a generic Webhook entry; found $($entry[0].type)" }
$entryPos = @($entry[0].position)
$entryX = [int]$entryPos[0]
$entryY = [int]$entryPos[1]

function Get-Node([string]$name) {
    $m = @($candidate.nodes | Where-Object { $_.name -eq $name })
    if ($m.Count -ne 1) { Fail "expected exactly one node '$name'; found $($m.Count)" }
    $m[0]
}

# 1. Drop the public webhook entry entirely. There is no generic HTTP entry after this.
$candidate.nodes = @($candidate.nodes | Where-Object { $_.name -ne $ENTRY_OLD })

# 2. Authenticated Telegram Trigger. n8n registers this with Telegram using a secret_token
#    and validates X-Telegram-Bot-Api-Secret-Token before the update enters the workflow.
$candidate.nodes += [pscustomobject]@{
    parameters  = [pscustomobject]@{ updates = @('message', 'callback_query'); additionalFields = [pscustomobject]@{} }
    type        = 'n8n-nodes-base.telegramTrigger'
    typeVersion = 1.2
    position    = @(($entryX - 260), $entryY)
    id          = [guid]::NewGuid().ToString()
    name        = $TRIGGER_NAME
    webhookId   = [guid]::NewGuid().ToString()
    credentials = [pscustomobject]@{ telegramApi = [pscustomobject]@{ id = $leadsCred.id; name = $leadsCred.name } }
}

# 3. Fail-closed identity gate, ahead of Settings and every Pipeline node.
$candidate.nodes += [pscustomobject]@{
    parameters  = [pscustomobject]@{ jsCode = $srcVerify }
    type        = 'n8n-nodes-base.code'
    typeVersion = 2
    position    = @($entryX, $entryY)
    id          = [guid]::NewGuid().ToString()
    name        = $GATE_NAME
}

# 4. Reviewed authorisation + policy sources.
(Get-Node 'Parse Lead Command v2').parameters.jsCode = $srcParse
(Get-Node 'Settings to Object').parameters.jsCode    = $srcSettings

# 5. Repair stale sheet locators. The three write nodes pointed at a different spreadsheet
#    (16Eepil...) and the two append nodes passed sheet NAMES where n8n expects a gid.
function Set-SheetLocator($node, [int]$gid, [string]$name) {
    $node.parameters.sheetName = [pscustomobject]@{
        __rl              = $true
        value             = $gid
        mode              = 'list'
        cachedResultName  = $name
        cachedResultUrl   = "$DOC_URL#gid=$gid"
    }
    if ($node.parameters.documentId.value -ne $DOC_ID) { Fail "node '$($node.name)' does not target the canonical spreadsheet" }
}
Set-SheetLocator (Get-Node 'Update Pipeline Row') $GID_PIPELINE   'Pipeline'
Set-SheetLocator (Get-Node 'Save Status_Log')     $GID_STATUS_LOG 'Status_Log'
Set-SheetLocator (Get-Node 'Save Activity')       $GID_ACTIVITIES 'Activities'

# 6. Retry on transient Google failures. Retained history shows a 503 on Read Settings with
#    no retry configured, which failed a whole scheduled run.
foreach ($n in @($candidate.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.googleSheets' })) {
    if ($null -eq $n.PSObject.Properties['retryOnFail']) { $n | Add-Member -NotePropertyName retryOnFail -NotePropertyValue $true }
    else { $n.retryOnFail = $true }
    if ($null -eq $n.PSObject.Properties['maxTries']) { $n | Add-Member -NotePropertyName maxTries -NotePropertyValue 3 }
    else { $n.maxTries = 3 }
    if ($null -eq $n.PSObject.Properties['waitBetweenTries']) { $n | Add-Member -NotePropertyName waitBetweenTries -NotePropertyValue 2000 }
    else { $n.waitBetweenTries = 2000 }
}

# 7. Rewire the entry: Trigger -> gate -> Read Settings. Everything downstream is unchanged.
$conns = $candidate.connections
if ($conns.PSObject.Properties[$ENTRY_OLD]) { $conns.PSObject.Properties.Remove($ENTRY_OLD) }
$conns | Add-Member -NotePropertyName $TRIGGER_NAME -NotePropertyValue ([pscustomobject]@{
    main = @(, @([pscustomobject]@{ node = $GATE_NAME; type = 'main'; index = 0 }))
}) -Force
$conns | Add-Member -NotePropertyName $GATE_NAME -NotePropertyValue ([pscustomobject]@{
    main = @(, @([pscustomobject]@{ node = 'Read Settings'; type = 'main'; index = 0 }))
}) -Force

# 8. Never expose the Command Center through MCP.
if ($null -eq $candidate.settings) { $candidate.settings = [pscustomobject]@{} }
$candidate.settings | Add-Member -NotePropertyName availableInMCP -NotePropertyValue $false -Force

# ---- structural preflight ------------------------------------------------------------
function Assert-Structure($wf, [string]$label) {
    $ser = $wf.nodes | ConvertTo-Json -Depth 100
    if (@($wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' }).Count -ne 0)        { Fail "$label`: a generic Webhook node is still present" }
    if (@($wf.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.telegramTrigger' }).Count -ne 1) { Fail "$label`: expected exactly one Telegram Trigger" }
    if (@($wf.nodes | Where-Object { $_.name -eq $GATE_NAME }).Count -ne 1)                       { Fail "$label`: identity gate missing" }
    if ($ser -match '1997367085')  { Fail "$label`: stale Pipeline GID still present" }
    if ($ser -match '16Eepil')     { Fail "$label`: stale spreadsheet reference still present" }
    if ($ser -match '"value":\s*"Activities"') { Fail "$label`: Activities still located by name" }
    if ($ser -match '"value":\s*"Status_Log"') { Fail "$label`: Status_Log still located by name" }
    # No literal Telegram identity may be baked into the policy node; Settings is the only
    # authorisation source. Matching on a generic long numeric literal avoids embedding the
    # real owner id in this repository.
    $settingsSrc = ($wf.nodes | Where-Object { $_.name -eq 'Settings to Object' }).parameters.jsCode
    if ($settingsSrc -match "'d{7,}'") { Fail "$label`: a hardcoded identity literal remains in Settings to Object" }
    foreach ($g in @($GID_PIPELINE, $GID_STATUS_LOG, $GID_ACTIVITIES)) {
        if ($ser -notmatch [string]$g) { Fail "$label`: canonical gid $g missing" }
    }
    # The gate must sit strictly before Settings and Pipeline.
    $t = $wf.connections.$TRIGGER_NAME.main[0][0].node
    if ($t -ne $GATE_NAME) { Fail "$label`: trigger does not feed the identity gate (feeds '$t')" }
    $g2 = $wf.connections.$GATE_NAME.main[0][0].node
    if ($g2 -ne 'Read Settings') { Fail "$label`: gate does not feed Read Settings (feeds '$g2')" }
}
Assert-Structure $candidate 'preflight'
Write-Host '  preflight: PASS'

$putBody = [ordered]@{
    name        = $candidate.name
    nodes       = $candidate.nodes
    connections = $candidate.connections
    settings    = $candidate.settings
}
$putBody | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 (Join-Path $SnapshotDir 'candidate-proposed.json')

if (-not $Apply) {
    Write-Host 'DRY-RUN COMPLETE. No workflow was changed.'
    return
}

# ---- apply + mandatory read-after-write ----------------------------------------------
$null = Invoke-N8n -Method Put -Path "/workflows/$CandidateWorkflowId" -Body $putBody -Write
Start-Sleep -Milliseconds 1000
$verify = Get-N8nWorkflow -Id $CandidateWorkflowId

if ($verify.active -eq $true) { Fail 'candidate became published unexpectedly' }
Assert-Structure $verify 'read-after-write'

# The deployed sources must byte-match the reviewed files that the QA gate exercises.
$deployedParse  = ($verify.nodes | Where-Object { $_.name -eq 'Parse Lead Command v2' }).parameters.jsCode
$deployedVerify = ($verify.nodes | Where-Object { $_.name -eq $GATE_NAME }).parameters.jsCode
$norm = { param($s) ($s -replace "`r`n", "`n").TrimEnd() }
if ((& $norm $deployedParse)  -ne (& $norm $srcParse))  { Fail 'read-after-write: parser source does not match the reviewed file' }
if ((& $norm $deployedVerify) -ne (& $norm $srcVerify)) { Fail 'read-after-write: identity gate source does not match the reviewed file' }
$deployedSettings = ($verify.nodes | Where-Object { $_.name -eq 'Settings to Object' }).parameters.jsCode
if ((& $norm $deployedSettings) -ne (& $norm $srcSettings)) { Fail 'read-after-write: settings source does not match the reviewed file' }

Save-WorkflowSnapshot -Workflow $verify -Directory $SnapshotDir -Label 'candidate-after' | Out-Null

Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host '  deployed source == reviewed source: PASS'
Write-Host "  publish: NOT PERFORMED (candidate remains unpublished)"
Write-Host "  structural hash: $(Get-WorkflowStructuralHash -Workflow $verify)"
Write-Host "  rollback snapshot: $SnapshotDir"
