# FINMENTOR — remove MCP tool exposure from production workflows.
#
# Every production workflow except the secure Command Center carried
# settings.availableInMCP = true. These are internal CRM workflows: they append to the
# Pipeline, Leads and Activities sheets and send owner Telegram messages. Exposing them as
# callable MCP tools widens the trigger surface beyond their intended entry points, which is
# the same class of problem as the Command Center's generic public webhook.
#
# Only settings.availableInMCP is changed. Nodes and connections are asserted byte-identical
# across the write, so the contained Command Center remains a faithful rollback point for
# everything that determines its behaviour.

param(
    [string[]]$WorkflowIds = @(
        'QmIyEW2ZEqKregmN',  # Lead Intake
        'mppzthlkSJFr6Kle',  # Telegram Client Concierge
        'ShcmmJeLSE8LYVBk',  # Telegram Client Transport
        'LZ2mvKXbBikmeVTn',  # SLA Lead Watch
        'zeLOCuf0K1bkaKl2',  # Followup Sequence
        'imeJIDeNyaWDyXzh',  # Daily Lead Digest
        'Ukn1cprWiXzBHojl'   # contained unsafe Command Center
    ),
    [string]$SnapshotDir,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "MCP HARDENING ABORTED: $m" }

if (-not $SnapshotDir) { $SnapshotDir = Join-Path $env:TEMP "finmentor-mcp-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
New-Item -ItemType Directory -Path $SnapshotDir -Force | Out-Null

Write-Host "FINMENTOR MCP exposure hardening  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"
Write-Host "  snapshot: $SnapshotDir"

foreach ($id in $WorkflowIds) {
    $wf = Get-N8nWorkflow -Id $id
    $wasActive = [bool]$wf.active
    $current = $wf.settings.availableInMCP

    if ($current -eq $false) {
        Write-Host ("  {0}  already false  {1}" -f $id, $wf.name)
        continue
    }
    Write-Host ("  {0}  active={1,-5} availableInMCP {2} -> false   {3}" -f $id, $wasActive, $current, $wf.name)

    Save-WorkflowSnapshot -Workflow $wf -Directory $SnapshotDir -Label "$id-before" | Out-Null
    $nodesBefore = $wf.nodes | ConvertTo-Json -Depth 100
    $connsBefore = $wf.connections | ConvertTo-Json -Depth 100

    if (-not $Apply) { continue }

    $wf.settings | Add-Member -NotePropertyName availableInMCP -NotePropertyValue $false -Force
    $body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
    $null = Invoke-N8n -Method Put -Path "/workflows/$id" -Body $body -Write
    Start-Sleep -Milliseconds 700

    $v = Get-N8nWorkflow -Id $id
    if ($v.settings.availableInMCP -ne $false)                     { Fail "$id`: read-after-write shows availableInMCP is still $($v.settings.availableInMCP)" }
    if ([bool]$v.active -ne $wasActive)                            { Fail "$id`: active state changed ($wasActive -> $($v.active))" }
    if (($v.nodes | ConvertTo-Json -Depth 100) -ne $nodesBefore)   { Fail "$id`: nodes changed - only settings may change" }
    if (($v.connections | ConvertTo-Json -Depth 100) -ne $connsBefore) { Fail "$id`: connections changed - only settings may change" }

    Save-WorkflowSnapshot -Workflow $v -Directory $SnapshotDir -Label "$id-after" | Out-Null
    Write-Host '      read-after-write: PASS  (nodes and connections byte-identical, active unchanged)'
}

if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. No workflow was changed.' }
