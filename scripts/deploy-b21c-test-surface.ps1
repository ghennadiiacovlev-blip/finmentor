# FINMENTOR — guarded deployment of the B.2.1-C owner-only Gateway test surface.
#
#   pwsh scripts/deploy-b21c-test-surface.ps1 -DryRun    # preflight only, no write
#   pwsh scripts/deploy-b21c-test-surface.ps1 -Deploy    # preflight, POST both, read back, verify
#
# WHAT THIS DEPLOYS. Two disposable workflows, both inactive on create:
#
#   FINMENTOR B.2.1-C Gateway Test Page     GET  /webhook/b21c/gateway-test  -> static HTML
#   FINMENTOR B.2.1-C Test Button Sender    sub-workflow -> ONE owner-only Telegram button
#
# WHAT THIS WILL NOT DO. It never writes to the Mini App Gateway, the Client Concierge, Lead
# Intake or the retired B.2.1-A canary workflows; it refuses to run if the Gateway is not the
# live 13-node graph it expects, and it refuses if the retired canary page has been reactivated.
# Both artifacts are posted as RAW BYTES from disk — never parsed and re-serialised through
# PowerShell's object model, which reorders keys and coerces numbers.
#
# CREDENTIALS. Write scope, from the environment only, never printed, never stored.

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Here

# A variable the owner sets mid-session is invisible to an already-running process.
$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$PageArtifact   = Join-Path $Root 'n8n/candidate/b21c-test-page-candidate.json'
$SenderArtifact = Join-Path $Root 'n8n/candidate/b21c-test-button-sender-candidate.json'

$PageName    = 'FINMENTOR B.2.1-C Gateway Test Page'
$SenderName  = 'FINMENTOR B.2.1-C Test Button Sender'
$PagePath    = 'b21c/gateway-test'
$RetiredPath = 'canary/b21a'

$GatewayId       = 'nTZHLbv2KFggdhh5'
$GatewayNodes    = 13
$RetiredPageId   = 'hGQAfPWBK75xeWco'
$RetiredLaunchId = '1Yw9LF6EJNCAYkQx'

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

# Get-WorkflowStructuralHash reads $_.disabled on every node, and n8n omits that property
# entirely on nodes that were never disabled. Under StrictMode Latest that absence throws
# rather than reading as $false, so the audited hash function runs with strict mode off and
# this script keeps it everywhere else.
function Get-StructuralHash {
    param([Parameter(Mandatory)]$Workflow)
    Set-StrictMode -Off
    Get-WorkflowStructuralHash -Workflow $Workflow
}

if (-not $DryRun -and -not $Deploy) { Fail 'specify -DryRun (preflight only) or -Deploy (preflight then write).' }

Say ''
Say '== PREFLIGHT =============================================='

# --- 1. the artifacts exist and match their builder ---------------------------
foreach ($p in @($PageArtifact, $SenderArtifact)) { if (-not (Test-Path $p)) { Fail "artifact not found: $p" } }
$before = @((Get-FileHash $PageArtifact).Hash, (Get-FileHash $SenderArtifact).Hash)
& node (Join-Path $Root 'scripts/build-b21c-test-surface.mjs') | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'the builder self-gate FAILED. Refusing to deploy an unverified artifact.' }
$after = @((Get-FileHash $PageArtifact).Hash, (Get-FileHash $SenderArtifact).Hash)
if ($before[0] -ne $after[0] -or $before[1] -ne $after[1]) { Fail 'the artifacts on disk were STALE; they have been regenerated. Re-run.' }
Ok 'both artifacts are current and pass the builder self-gate'

# --- 2. the tenant answers, and the key has the scope this needs --------------
try { $all = Get-N8nWorkflowList } catch { Fail "n8n read failed ($($_.Exception.Message)). 401 means assume revocation." }
Ok "tenant reachable, $($all.Count) workflows visible"

# --- 3. the Gateway is the live graph we are proving, and we do not touch it --
$gw = Get-N8nWorkflow -Id $GatewayId
if ($gw.name -ne 'FINMENTOR Mini App Gateway') { Fail "workflow $GatewayId is not the Gateway." }
if (-not $gw.active) { Fail 'the Gateway is INACTIVE. A test button pointing at a dead endpoint proves nothing.' }
if ($gw.nodes.Count -ne $GatewayNodes) { Fail "the Gateway has $($gw.nodes.Count) nodes, expected $GatewayNodes." }
$GatewayHashBefore = Get-StructuralHash -Workflow $gw
Ok "Gateway $GatewayId active, $GatewayNodes nodes, structural hash captured"

# --- 4. the retired B.2.1-A surface stays retired ----------------------------
foreach ($id in @($RetiredPageId, $RetiredLaunchId)) {
    $r = Get-N8nWorkflow -Id $id
    if ($r.active) { Fail "retired B.2.1-A workflow $id ('$($r.name)') is ACTIVE. It must stay off." }
    Ok "retired '$($r.name)' is inactive"
}

# --- 5. nothing already owns the new path ------------------------------------
foreach ($w in $all) {
    if ($w.name -eq $PageName -or $w.name -eq $SenderName) {
        Fail "a workflow named '$($w.name)' already exists ($($w.id)). Archive it first rather than creating a duplicate."
    }
}
Ok 'neither B21C workflow name is already taken'

# --- 6. the retired route appears in neither artifact -------------------------
foreach ($p in @($PageArtifact, $SenderArtifact)) {
    if ((Get-Content -Raw -Path $p) -match [regex]::Escape($RetiredPath)) { Fail "$p references the retired canary route." }
}
Ok "the retired route '$RetiredPath' appears in neither artifact"

if ($DryRun) { Say ''; Say 'DRY RUN: preflight passed, nothing written.'; exit 0 }

Say ''
Say '== DEPLOY ================================================='

function New-WorkflowFromBytes {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    $ctx  = Get-N8nContext -Write
    $uri  = "$($ctx.Base)/api/v1/workflows"
    $body = [System.IO.File]::ReadAllBytes($Path)
    $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $ctx.Headers -ContentType 'application/json' -Body $body
    Say "  created $Label -> $($r.id)"
    $r.id
}

$PageId   = New-WorkflowFromBytes -Path $PageArtifact   -Label $PageName
$SenderId = New-WorkflowFromBytes -Path $SenderArtifact -Label $SenderName

Say ''
Say '== READBACK ==============================================='

$page = Get-N8nWorkflow -Id $PageId
if ($page.active) { Fail 'the page workflow was created ACTIVE. It must be created inactive.' }
$ep = $page.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' }
if ($ep.parameters.httpMethod -ne 'GET')  { Fail 'the deployed page endpoint is not a GET.' }
if ($ep.parameters.path -ne $PagePath)    { Fail "the deployed page path is '$($ep.parameters.path)'." }
$localHtml = (Get-Content -Raw -Path (Join-Path $Root 'gateway/n8n/b21c-gateway-test-page.html'))
$servedHtml = ($page.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.respondToWebhook' }).parameters.responseBody
if ($servedHtml -ne $localHtml) { Fail 'the deployed page body differs from the reviewed page on disk.' }
Ok 'page deployed inactive, GET, correct path, body identical to the reviewed source'

$sender = Get-N8nWorkflow -Id $SenderId
if ($sender.active) { Fail 'the sender workflow was created ACTIVE.' }
$tg = $sender.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.telegram' }
if ($null -eq $tg) { Fail 'the deployed sender has no Telegram node.' }
$url = $tg.parameters.inlineKeyboard.rows[0].row.buttons[0].additionalFields.web_app.url
if ($url -ne "https://ghennadi.app.n8n.cloud/webhook/$PagePath") { Fail "the deployed button points at '$url'." }
# n8n omits `credentials` entirely on nodes that carry none, and under StrictMode Latest a
# plain `$_.credentials` on such a node throws instead of reading as $null.
$credCount = @($sender.nodes | Where-Object { $null -ne $_.PSObject.Properties['credentials'] }).Count
if ($credCount -ne 1) { Fail "the deployed sender carries $credCount credential-bearing nodes, expected 1." }
Ok 'sender deployed inactive, one credential, button points at the B21C page'

# --- the Gateway must be byte-for-byte what it was before this script ran -----
$gwAfter = Get-N8nWorkflow -Id $GatewayId
if ((Get-StructuralHash -Workflow $gwAfter) -ne $GatewayHashBefore) { Fail 'THE GATEWAY CHANGED. Investigate immediately.' }
if (-not $gwAfter.active) { Fail 'the Gateway is no longer active.' }
Ok 'Gateway structurally unchanged and still active'

Say ''
Say '== RESULT ================================================='
Say "  page   : $PageId   https://ghennadi.app.n8n.cloud/webhook/$PagePath   (INACTIVE - activate to serve)"
Say "  sender : $SenderId  (sub-workflow; run it once to send the button)"
Say ''
