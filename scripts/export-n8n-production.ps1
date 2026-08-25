# FINMENTOR — export production workflows in redacted form and build a drift manifest.
#
# Makes GitHub <-> n8n drift measurable (INDP3-04). Exports every active workflow plus the
# tracked Command Center pair into n8n/production/, with a manifest recording id, name,
# active state, updatedAt, structural hash, node types and credential reference NAMES only.
#
# No credential secret is ever exported: the n8n API returns credential id + name only, and
# every export is additionally run through ConvertTo-Redacted, which strips bot tokens,
# API keys and Telegram chat ids. The script refuses to write a file that still matches a
# secret pattern.

param(
    [string]$OutDir,
    [switch]$IncludeInactiveTracked
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "N8N EXPORT ABORTED: $m" }

if (-not $OutDir) { $OutDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'n8n/production' }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

# Workflows that are inactive but deliberately tracked, with the reason recorded.
$TRACKED_INACTIVE = @{
    'Ukn1cprWiXzBHojl' = 'unsafe original Command Center - retained OFF as the P0 rollback point'
    'qF9tonlHHIxc8MDd' = 'secure Command Center candidate - awaiting owner publish'
    'imeJIDeNyaWDyXzh' = 'Daily Lead Digest - locator repaired, awaiting owner re-activation'
}

Write-Host 'FINMENTOR production workflow export'

$all = Get-N8nWorkflowList
$selected = @($all | Where-Object { $_.active -or $TRACKED_INACTIVE.ContainsKey($_.id) })
if ($selected.Count -eq 0) { Fail 'no workflows selected for export' }

$manifest = @()
foreach ($stub in ($selected | Sort-Object name)) {
    $wf = Get-N8nWorkflow -Id $stub.id

    $json = $wf | ConvertTo-Json -Depth 100
    $redacted = ConvertTo-Redacted -Json $json

    # Refuse to persist anything that still looks like a secret.
    if ($redacted -match '\b\d{8,10}:[A-Za-z0-9_-]{30,}\b') { Fail "$($wf.id): a bot-token pattern survived redaction" }
    if ($redacted -match '\bsk-[A-Za-z0-9_-]{20,}\b')        { Fail "$($wf.id): an API-key pattern survived redaction" }

    $safeName = ($wf.name -replace '[^A-Za-z0-9]+', '-').Trim('-').ToLower()
    $path = Join-Path $OutDir "$($wf.id).$safeName.json"
    $redacted | Set-Content -Encoding UTF8 $path

    $creds = @()
    foreach ($n in $wf.nodes) {
        if ($n.credentials) {
            foreach ($p in $n.credentials.PSObject.Properties) { $creds += $p.Value.name }
        }
    }

    $manifest += [ordered]@{
        id              = $wf.id
        name            = $wf.name
        active          = [bool]$wf.active
        archived        = [bool]$wf.isArchived
        updatedAt       = [string]$wf.updatedAt
        nodeCount       = $wf.nodes.Count
        structuralHash  = Get-WorkflowStructuralHash -Workflow $wf
        nodeTypes       = @($wf.nodes | ForEach-Object { $_.type } | Sort-Object -Unique)
        credentialNames = @($creds | Sort-Object -Unique)
        export          = (Split-Path $path -Leaf)
        trackedReason   = if ($TRACKED_INACTIVE.ContainsKey($wf.id)) { $TRACKED_INACTIVE[$wf.id] } else { '' }
    }

    "  {0}  active={1,-5} nodes={2,-3} {3}" -f $wf.id, $wf.active, $wf.nodes.Count, $wf.name | Write-Host
}

$manifestObj = [ordered]@{
    generatedAt     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    tenantHost      = ([uri](Get-N8nContext).Base).Host
    spreadsheetId   = '1CyZJPhCAvhnJjQOOoAF4COqU2wAFNqKu2Gw7ngjpN5A'
    totalWorkflows  = $all.Count
    activeWorkflows = @($all | Where-Object { $_.active }).Count
    exported        = $manifest.Count
    workflows       = $manifest
}
$manifestPath = Join-Path $OutDir 'manifest.json'
$manifestObj | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $manifestPath

Write-Host ''
Write-Host "  exported : $($manifest.Count)"
Write-Host "  manifest : $manifestPath"
Write-Host "  tenant   : $($manifestObj.tenantHost)  (total=$($all.Count), active=$($manifestObj.activeWorkflows))"
