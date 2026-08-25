param(
    [string]$BaseUrl = $env:N8N_BASE_URL,
    [string]$ApiKey = $env:N8N_FIX_API_KEY,
    [string]$OriginalWorkflowId = 'Ukn1cprWiXzBHojl',
    [string]$CandidateWorkflowId = 'qF9tonIHHIxc8MDd',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    throw "FINMENTOR PATCH ABORTED: $Message"
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { Fail 'N8N_BASE_URL is not set.' }
if ([string]::IsNullOrWhiteSpace($ApiKey)) { Fail 'N8N_FIX_API_KEY is not set.' }

$BaseUrl = $BaseUrl.TrimEnd('/')
$headers = @{ 'X-N8N-API-KEY' = $ApiKey }

function Invoke-N8nGet([string]$Path) {
    Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/v1$Path" -Headers $headers
}

function Invoke-N8nPut([string]$Path, $Body) {
    $json = $Body | ConvertTo-Json -Depth 100
    Invoke-RestMethod -Method Put -Uri "$BaseUrl/api/v1$Path" -Headers $headers -ContentType 'application/json' -Body $json
}

function Remove-Property($Object, [string]$Name) {
    if ($null -ne $Object.PSObject.Properties[$Name]) {
        $Object.PSObject.Properties.Remove($Name)
    }
}

Write-Host 'FINMENTOR Command Center secure candidate patch'
Write-Host 'Mode:' $(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })

$original = Invoke-N8nGet "/workflows/$OriginalWorkflowId?excludePinnedData=true"
$candidate = Invoke-N8nGet "/workflows/$CandidateWorkflowId?excludePinnedData=true"

if ($original.active -eq $true) { Fail 'Original unsafe Command Center is still published. Unpublish it first.' }
if ($candidate.active -eq $true) { Fail 'Secure candidate is published. Candidate must stay unpublished while patching.' }
if ($candidate.name -notmatch 'SECURE CANDIDATE') { Fail "Unexpected candidate workflow name: $($candidate.name)" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $env:TEMP "finmentor-command-center-$stamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
$original | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 (Join-Path $backupDir 'original-before.json')
$candidate | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 (Join-Path $backupDir 'candidate-before.json')
Write-Host "Local rollback snapshot: $backupDir"

$entry = @($candidate.nodes | Where-Object { $_.name -eq 'Telegram Command Webhook' })
if ($entry.Count -ne 1) { Fail "Expected exactly one node named 'Telegram Command Webhook'; found $($entry.Count)." }
$entryNode = $entry[0]
if ($entryNode.type -ne 'n8n-nodes-base.webhook') { Fail "Expected generic Webhook entry; found $($entryNode.type)." }

$readSettings = @($candidate.nodes | Where-Object { $_.name -eq 'Read Settings' })
if ($readSettings.Count -ne 1) { Fail "Expected exactly one 'Read Settings' node; found $($readSettings.Count)." }

$updatePipeline = @($candidate.nodes | Where-Object { $_.name -eq 'Update Pipeline Row' })
if ($updatePipeline.Count -ne 1) { Fail "Expected exactly one 'Update Pipeline Row' node; found $($updatePipeline.Count)." }

$telegramCredCandidates = @()
foreach ($n in $candidate.nodes) {
    if ($n.type -eq 'n8n-nodes-base.telegram' -and $null -ne $n.credentials -and $null -ne $n.credentials.telegramApi) {
        $telegramCredCandidates += $n.credentials.telegramApi
    }
}
$uniqueCreds = @($telegramCredCandidates | Group-Object { "$($_.id)|$($_.name)" } | ForEach-Object { $_.Group[0] })
if ($uniqueCreds.Count -ne 1) { Fail "Expected exactly one Telegram credential reference in Command Center; found $($uniqueCreds.Count)." }
$telegramCred = $uniqueCreds[0]

# Convert the old public Webhook node into a compatibility/security wrapper while preserving
# its name. Downstream code that references 'Telegram Command Webhook'.json.body continues to work.
$wrapperCode = @'
const u = $input.first().json;
const isCallback = Boolean(u?.callback_query);
const msg = isCallback ? u?.callback_query?.message : u?.message;
const from = isCallback ? u?.callback_query?.from : u?.message?.from;
const chatId = msg?.chat?.id;
const fromId = from?.id;
const chatType = msg?.chat?.type;

// Fail closed before Settings/CRM access. Command Center is private-owner-chat only.
if (chatId === undefined || chatId === null || fromId === undefined || fromId === null) return [];
if (String(chatId) !== String(fromId)) return [];
if (chatType && chatType !== 'private') return [];

return [{
  json: {
    body: u,
    headers: {},
    query: {},
    params: {},
    telegram_verified_transport: true,
    verified_chat_id: String(chatId),
    verified_from_id: String(fromId)
  }
}];
'@

$entryNode.type = 'n8n-nodes-base.code'
$entryNode.typeVersion = 2
$entryNode.parameters = [pscustomobject]@{ jsCode = $wrapperCode }
Remove-Property $entryNode 'webhookId'
Remove-Property $entryNode 'credentials'

# Add an n8n Telegram Trigger. In current n8n versions (>1), this registers Telegram setWebhook
# with secret_token and validates X-Telegram-Bot-Api-Secret-Token using timingSafeEqual before data
# enters the workflow.
$triggerName = 'Telegram Command Trigger VERIFIED'
if (@($candidate.nodes | Where-Object { $_.name -eq $triggerName }).Count -gt 0) {
    Fail "Node '$triggerName' already exists. Refusing to double-patch."
}

$triggerX = [int]$entryNode.position[0] - 260
$triggerY = [int]$entryNode.position[1]
$triggerNode = [pscustomobject]@{
    parameters = [pscustomobject]@{
        updates = @('message','callback_query')
        additionalFields = [pscustomobject]@{}
    }
    type = 'n8n-nodes-base.telegramTrigger'
    typeVersion = 1.5
    position = @($triggerX, $triggerY)
    id = [guid]::NewGuid().ToString()
    name = $triggerName
    webhookId = [guid]::NewGuid().ToString()
    credentials = [pscustomobject]@{
        telegramApi = [pscustomobject]@{
            id = $telegramCred.id
            name = $telegramCred.name
        }
    }
}
$candidate.nodes += $triggerNode

# Existing wrapper -> Read Settings connection remains unchanged. Add only Trigger -> wrapper.
$candidate.connections | Add-Member -NotePropertyName $triggerName -NotePropertyValue ([pscustomobject]@{
    main = @(
        @(
            [pscustomobject]@{ node = 'Telegram Command Webhook'; type = 'main'; index = 0 }
        )
    )
})

# Resolve stale Pipeline write locator in the isolated candidate only.
$updateParamsJson = $updatePipeline[0].parameters | ConvertTo-Json -Depth 100
if ($updateParamsJson -notmatch '1997367085') {
    Fail "Update Pipeline Row does not contain expected stale GID 1997367085. Refusing blind replacement."
}
$updateParamsJson = $updateParamsJson -replace '1997367085','1883973304'
$updatePipeline[0].parameters = $updateParamsJson | ConvertFrom-Json

# Hardening: Command Center must not be exposed through MCP.
if ($null -eq $candidate.settings) { $candidate.settings = [pscustomobject]@{} }
if ($null -ne $candidate.settings.PSObject.Properties['availableInMCP']) {
    $candidate.settings.availableInMCP = $false
} else {
    $candidate.settings | Add-Member -NotePropertyName 'availableInMCP' -NotePropertyValue $false
}

# Structural preflight.
$serializedNodes = $candidate.nodes | ConvertTo-Json -Depth 100
if ($serializedNodes -match '1997367085') { Fail 'Stale Pipeline GID remains after patch.' }
if ($serializedNodes -notmatch '1883973304') { Fail 'Canonical Pipeline GID 1883973304 not present after patch.' }
if (@($candidate.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.webhook' }).Count -ne 0) { Fail 'Generic Webhook node still present in secure candidate.' }
if (@($candidate.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.telegramTrigger' }).Count -ne 1) { Fail 'Secure candidate must contain exactly one Telegram Trigger.' }

$putBody = [ordered]@{
    name = $candidate.name
    nodes = $candidate.nodes
    connections = $candidate.connections
    settings = $candidate.settings
}
if ($null -ne $candidate.staticData) { $putBody.staticData = $candidate.staticData }
if ($null -ne $candidate.pinData) { $putBody.pinData = $candidate.pinData }
if ($null -ne $candidate.description -and -not [string]::IsNullOrWhiteSpace([string]$candidate.description)) { $putBody.description = $candidate.description }
if ($null -ne $candidate.nodeGroups) { $putBody.nodeGroups = $candidate.nodeGroups }

$putBody | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 (Join-Path $backupDir 'candidate-proposed.json')

Write-Host 'Preflight: PASS'
Write-Host '  unsafe original active: false'
Write-Host '  secure candidate active: false'
Write-Host '  generic Webhook after patch: 0'
Write-Host '  Telegram Trigger after patch: 1'
Write-Host '  Pipeline write GID: 1883973304'
Write-Host '  candidate remains unpublished'

if (-not $Apply) {
    Write-Host 'DRY-RUN COMPLETE. No n8n workflow was changed.'
    Write-Host 'Re-run with -Apply only after reviewing the preflight.'
    exit 0
}

$updated = Invoke-N8nPut "/workflows/$CandidateWorkflowId?publishIfActive=false" $putBody

# Mandatory read-after-write verification. Current n8n API versions have had regressions where PUT
# returns 200 but workflow content is not actually changed.
Start-Sleep -Milliseconds 500
$verify = Invoke-N8nGet "/workflows/$CandidateWorkflowId?excludePinnedData=true"

if ($verify.active -eq $true) { Fail 'Candidate became published unexpectedly. Unpublish immediately.' }
$verifyTrigger = @($verify.nodes | Where-Object { $_.name -eq $triggerName -and $_.type -eq 'n8n-nodes-base.telegramTrigger' })
if ($verifyTrigger.Count -ne 1) { Fail 'Read-after-write: Telegram Trigger patch not persisted.' }
$verifyWrapper = @($verify.nodes | Where-Object { $_.name -eq 'Telegram Command Webhook' -and $_.type -eq 'n8n-nodes-base.code' })
if ($verifyWrapper.Count -ne 1) { Fail 'Read-after-write: security wrapper patch not persisted.' }
$verifySerialized = $verify.nodes | ConvertTo-Json -Depth 100
if ($verifySerialized -match '1997367085') { Fail 'Read-after-write: stale Pipeline GID still present.' }
if ($verifySerialized -notmatch '1883973304') { Fail 'Read-after-write: canonical Pipeline GID missing.' }

$verify | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 (Join-Path $backupDir 'candidate-after.json')

Write-Host 'APPLY: PASS'
Write-Host 'READ-AFTER-WRITE: PASS'
Write-Host 'PUBLISH: NOT PERFORMED'
Write-Host 'EXECUTE/TEST: NOT PERFORMED'
Write-Host "Rollback snapshot: $backupDir"
