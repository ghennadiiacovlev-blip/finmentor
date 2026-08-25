# FINMENTOR — create the central Error Monitor and wire production workflows to it.
#
# Closes INDP2-04. The tenant had zero Error Trigger nodes and zero settings.errorWorkflow,
# so a failure in any scheduled or management workflow was silent. That gap was not
# theoretical: the Daily Digest failed on every retained run for a week with nobody alerted.
#
# Chain: Error Trigger -> Read Settings -> Settings to Object -> Build Error Alert -> Telegram
#
# The alert carries workflow id/name, node, error class, timestamp and the execution id as a
# correlation reference. It never carries the failing item's payload.

param(
    [string]$TemplateId = 'imeJIDeNyaWDyXzh',   # donor for the Settings nodes and credentials
    [string]$MonitorName = 'FINMENTOR Error Monitor PREMIUM',
    [string[]]$WireWorkflowIds = @(
        'QmIyEW2ZEqKregmN', 'mppzthlkSJFr6Kle', 'ShcmmJeLSE8LYVBk',
        'LZ2mvKXbBikmeVTn', 'zeLOCuf0K1bkaKl2', 'imeJIDeNyaWDyXzh', 'qF9tonlHHIxc8MDd'
    ),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "ERROR MONITOR SETUP ABORTED: $m" }

$src = Join-Path (Split-Path $PSScriptRoot -Parent) 'n8n/src/error-monitor/build-error-alert.js'
if (-not (Test-Path $src)) { Fail "missing source: $src" }
$alertCode = Get-Content -Raw -Encoding UTF8 $src

Write-Host "FINMENTOR Error Monitor setup  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

# Reuse the donor's Settings nodes verbatim so document/tab locators and the Google
# credential reference stay consistent with the rest of the estate.
$tpl = Get-N8nWorkflow -Id $TemplateId
$readSettings = @($tpl.nodes | Where-Object { $_.name -eq 'Read Settings' })
$settingsToObj = @($tpl.nodes | Where-Object { $_.name -eq 'Settings to Object' })
$telegramDonor = @($tpl.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.telegram' })
if ($readSettings.Count -ne 1) { Fail 'donor has no unique Read Settings node' }
if ($settingsToObj.Count -ne 1) { Fail 'donor has no unique Settings to Object node' }
if ($telegramDonor.Count -lt 1) { Fail 'donor has no Telegram node to source the credential from' }

$leadsCred = $telegramDonor[0].credentials.telegramApi
if ($leadsCred.name -notmatch 'Leads Bot') { Fail "expected the internal Leads Bot credential; found '$($leadsCred.name)'" }
Write-Host "  telegram credential: $($leadsCred.name)"

# Does a monitor already exist?
$existing = @(Get-N8nWorkflowList | Where-Object { $_.name -eq $MonitorName })
if ($existing.Count -gt 1) { Fail "more than one workflow named '$MonitorName'" }

function New-Node($name, $type, $typeVersion, $pos, $params, $creds) {
    $n = [pscustomobject]@{
        parameters  = $params
        type        = $type
        typeVersion = $typeVersion
        position    = $pos
        id          = [guid]::NewGuid().ToString()
        name        = $name
    }
    if ($creds) { $n | Add-Member -NotePropertyName credentials -NotePropertyValue $creds }
    $n
}

$readNode = $readSettings[0] | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$readNode.name = 'Read Settings'
$readNode.position = @(-260, 0)
$readNode | Add-Member -NotePropertyName retryOnFail -NotePropertyValue $true -Force
$readNode | Add-Member -NotePropertyName maxTries -NotePropertyValue 3 -Force

$objNode = $settingsToObj[0] | ConvertTo-Json -Depth 100 | ConvertFrom-Json
$objNode.name = 'Settings to Object'
$objNode.position = @(-40, 0)

$nodes = @(
    (New-Node 'Error Monitor Trigger' 'n8n-nodes-base.errorTrigger' 1 @(-480, 0) ([pscustomobject]@{}) $null),
    $readNode,
    $objNode,
    (New-Node 'Build Error Alert' 'n8n-nodes-base.code' 2 @(180, 0) ([pscustomobject]@{ jsCode = $alertCode }) $null),
    (New-Node 'Telegram Error Alert' 'n8n-nodes-base.telegram' 1.2 @(400, 0) ([pscustomobject]@{
        chatId = '={{ $json.owner_chat_id }}'
        text   = '={{ $json.alert_text }}'
        additionalFields = [pscustomobject]@{ appendAttribution = $false }
    }) ([pscustomobject]@{ telegramApi = [pscustomobject]@{ id = $leadsCred.id; name = $leadsCred.name } }))
)

$connections = [pscustomobject]@{}
foreach ($pair in @(
    @('Error Monitor Trigger', 'Read Settings'),
    @('Read Settings', 'Settings to Object'),
    @('Settings to Object', 'Build Error Alert'),
    @('Build Error Alert', 'Telegram Error Alert')
)) {
    $connections | Add-Member -NotePropertyName $pair[0] -NotePropertyValue ([pscustomobject]@{
        main = @(, @([pscustomobject]@{ node = $pair[1]; type = 'main'; index = 0 }))
    }) -Force
}

$body = [ordered]@{
    name        = $MonitorName
    nodes       = $nodes
    connections = $connections
    settings    = [pscustomobject]@{ executionOrder = 'v1'; binaryMode = 'separate'; availableInMCP = $false }
}

Write-Host "  monitor graph: $($nodes.Count) nodes, $(($connections.PSObject.Properties).Count) edges"
if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. Nothing created or wired.'; return }

if ($existing.Count -eq 1) {
    $monitorId = $existing[0].id
    Write-Host "  updating existing monitor $monitorId"
    $null = Invoke-N8n -Method Put -Path "/workflows/$monitorId" -Body $body -Write
} else {
    $created = Invoke-N8n -Method Post -Path '/workflows' -Body $body -Write
    $monitorId = $created.id
    Write-Host "  created monitor $monitorId"
}

Start-Sleep -Milliseconds 800
$v = Get-N8nWorkflow -Id $monitorId
if (@($v.nodes | Where-Object { $_.type -eq 'n8n-nodes-base.errorTrigger' }).Count -ne 1) { Fail 'read-after-write: no Error Trigger in the monitor' }
$deployed = ($v.nodes | Where-Object { $_.name -eq 'Build Error Alert' }).parameters.jsCode
$norm = { param($s) ($s -replace "`r`n", "`n").TrimEnd() }
if ((& $norm $deployed) -ne (& $norm $alertCode)) { Fail 'read-after-write: alert builder does not match the reviewed source' }
Write-Host '  read-after-write: PASS'

if ($v.active -ne $true) {
    $null = Invoke-N8n -Method Post -Path "/workflows/$monitorId/activate" -Write
    Start-Sleep -Milliseconds 1000
    $v = Get-N8nWorkflow -Id $monitorId
}
if ($v.active -ne $true) { Fail 'monitor did not activate' }
Write-Host "  monitor active: $($v.active)"

# ---- wire every production workflow to it ------------------------------------------------
Write-Host ''
Write-Host '  wiring settings.errorWorkflow:'
foreach ($id in $WireWorkflowIds) {
    $wf = Get-N8nWorkflow -Id $id
    if ($wf.settings.errorWorkflow -eq $monitorId) { Write-Host "    $id  already wired"; continue }

    $wasActive = [bool]$wf.active
    $nodesBefore = $wf.nodes | ConvertTo-Json -Depth 100
    $wf.settings | Add-Member -NotePropertyName errorWorkflow -NotePropertyValue $monitorId -Force
    $b = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
    $null = Invoke-N8n -Method Put -Path "/workflows/$id" -Body $b -Write
    Start-Sleep -Milliseconds 600

    $vv = Get-N8nWorkflow -Id $id
    if ($vv.settings.errorWorkflow -ne $monitorId)              { Fail "$id`: errorWorkflow not persisted" }
    if ([bool]$vv.active -ne $wasActive)                        { Fail "$id`: active state changed" }
    if (($vv.nodes | ConvertTo-Json -Depth 100) -ne $nodesBefore) { Fail "$id`: nodes changed - only settings may change" }
    Write-Host "    $id  wired  (active=$($vv.active), nodes byte-identical)"
}

Write-Host ''
Write-Host "ERROR MONITOR: $monitorId  ACTIVE"
