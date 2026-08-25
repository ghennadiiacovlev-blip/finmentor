# FINMENTOR n8n API helper library.
# Read-only helpers plus guarded write helpers. No secret values are ever printed.

$ErrorActionPreference = 'Stop'

# Two distinct API keys exist for this tenant:
#   N8N_API_KEY     - read-only scope (every write returns 403)
#   N8N_FIX_API_KEY - read/write scope, used only for authorised remediation writes
# Reads default to the read-only key so an accidental verb cannot mutate production.
function Get-N8nContext {
    param([switch]$Write)
    $base = $env:N8N_BASE_URL
    $name = if ($Write) { 'N8N_FIX_API_KEY' } else { 'N8N_API_KEY' }
    $key  = if ($Write) { $env:N8N_FIX_API_KEY } else { $env:N8N_API_KEY }
    if ([string]::IsNullOrWhiteSpace($base)) { throw 'N8N_BASE_URL is not set.' }
    if ([string]::IsNullOrWhiteSpace($key))  { throw "$name is not set." }
    [pscustomobject]@{
        Base    = $base.TrimEnd('/')
        Headers = @{ 'X-N8N-API-KEY' = $key }
    }
}

function Invoke-N8n {
    param(
        [Parameter(Mandatory)][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        $Body,
        [switch]$Write
    )
    if ($Method -ne 'Get' -and -not $Write) {
        throw "Refusing $Method $Path without -Write. Mutating calls must be explicit."
    }
    $ctx = Get-N8nContext -Write:$Write
    $uri = "$($ctx.Base)/api/v1$Path"
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 100
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $ctx.Headers -ContentType 'application/json' -Body $json
    }
    # Bodyless POSTs (activate/deactivate) still need an explicit JSON content type;
    # PowerShell otherwise defaults to form-urlencoded and n8n rejects it.
    if ($Method -eq 'Get') {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $ctx.Headers
    }
    Invoke-RestMethod -Method $Method -Uri $uri -Headers $ctx.Headers -ContentType 'application/json'
}

function Get-N8nWorkflow {
    param([Parameter(Mandatory)][string]$Id)
    Invoke-N8n -Method Get -Path "/workflows/$Id`?excludePinnedData=true"
}

function Get-N8nWorkflowList {
    $all = @(); $cursor = $null
    do {
        $p = '/workflows?limit=100'
        if ($cursor) { $p += "&cursor=$cursor" }
        $r = Invoke-N8n -Method Get -Path $p
        $all += $r.data
        $cursor = $r.nextCursor
    } while ($cursor)
    $all
}

# Structural hash: stable fingerprint of the executable graph only.
# Excludes ids/positions/timestamps so cosmetic editor moves do not register as drift.
function Get-WorkflowStructuralHash {
    param([Parameter(Mandatory)]$Workflow)
    $nodes = @($Workflow.nodes | Sort-Object name | ForEach-Object {
        [ordered]@{
            name        = $_.name
            type        = $_.type
            typeVersion = $_.typeVersion
            disabled    = [bool]$_.disabled
            parameters  = $_.parameters
            credentials = if ($null -ne $_.credentials) { ($_.credentials | ConvertTo-Json -Depth 20 -Compress) } else { '' }
        }
    })
    $payload = [ordered]@{
        name        = $Workflow.name
        nodes       = $nodes
        connections = $Workflow.connections
        settings    = $Workflow.settings
    } | ConvertTo-Json -Depth 100 -Compress
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload))
    ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# Redaction for anything committed to git. Owner Telegram IDs, bot tokens and
# long opaque strings never reach the repository.
function ConvertTo-Redacted {
    param([Parameter(Mandatory)][string]$Json)
    $out = $Json
    $out = [regex]::Replace($out, '\b\d{8,10}:[A-Za-z0-9_-]{30,}\b', '<REDACTED_BOT_TOKEN>')
    $out = [regex]::Replace($out, '(?<="(?:chat_?[Ii]d|chatId|owner_chat_id|allowed_chat_ids)"\s*:\s*")[^"]*', '<REDACTED_CHAT_ID>')
    $out = [regex]::Replace($out, '(?<="(?:chat_?[Ii]d|chatId)"\s*:\s*)\d{6,}', '"<REDACTED_CHAT_ID>"')
    $out = [regex]::Replace($out, '\bsk-[A-Za-z0-9_-]{20,}\b', '<REDACTED_API_KEY>')
    $out = [regex]::Replace($out, '\bAIza[A-Za-z0-9_-]{30,}\b', '<REDACTED_API_KEY>')
    $out
}

function Save-WorkflowSnapshot {
    param(
        [Parameter(Mandatory)]$Workflow,
        [Parameter(Mandatory)][string]$Directory,
        [Parameter(Mandatory)][string]$Label
    )
    if (-not (Test-Path $Directory)) { New-Item -ItemType Directory -Path $Directory -Force | Out-Null }
    $path = Join-Path $Directory "$Label.json"
    $Workflow | ConvertTo-Json -Depth 100 | Set-Content -Encoding UTF8 $path
    $path
}
