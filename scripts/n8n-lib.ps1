# FINMENTOR n8n API helper library.
# Read-only helpers plus guarded write helpers. No secret values are ever printed.

$ErrorActionPreference = 'Stop'

# Two distinct API keys exist for this tenant:
#   N8N_API_KEY     - read-only scope (every write returns 403)
#   N8N_FIX_API_KEY - read/write scope, used only for authorised remediation writes
# Reads default to the read-only key so an accidental verb cannot mutate production.
#
# CREDENTIAL STATUS - read before using any script in this directory.
#
# Both keys are scheduled for REVOCATION as an owner action once the 2026-08-25 remediation
# phase is accepted; see docs/FINMENTOR_AUDIT_REMEDIATION_REPORT_2026-08-25.md, OWNER ACTIONS
# REQUIRED item 6. Every script here therefore assumes credentials that may already be dead.
#
# This library does not detect revocation and cannot: a revoked key fails as an ordinary HTTP
# 401, which is indistinguishable here from a key that was never set correctly. If a script
# starts returning 401, assume revocation first rather than debugging the script.
#
# Any FUTURE live work - the B.2.1-C canaries above all - needs FRESH credentials issued at
# that time, scoped as narrowly as the task allows, and revoked again afterwards. Do not
# reinstate an old key to make a script run. No key value is stored in this repository, and
# none may ever be: keys come from the environment only.
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

# Canonical spreadsheet tab ids. These are configuration, not identity, and must survive
# redaction so the exports remain useful for drift detection. They are the reason the
# identity rule below cannot simply redact every 9-10 digit number: gids are the same shape
# as Telegram chat ids.
$script:CANONICAL_GIDS = @(
    '1871239368', '409890193', '936189533', '1883973304', '962064347', '623316892',
    '1810362432', '1651979710', '532676168', '1289462207', '1584265787', '1612014214',
    '1997367085'
)

# Redaction for anything committed to git. Bot tokens, API keys and Telegram identities
# never reach the repository.
function ConvertTo-Redacted {
    param([Parameter(Mandatory)][string]$Json)
    $out = $Json
    $out = [regex]::Replace($out, '\b\d{8,10}:[A-Za-z0-9_-]{30,}\b', '<REDACTED_BOT_TOKEN>')
    $out = [regex]::Replace($out, '\bsk-[A-Za-z0-9_-]{20,}\b', '<REDACTED_API_KEY>')
    $out = [regex]::Replace($out, '\bAIza[A-Za-z0-9_-]{30,}\b', '<REDACTED_API_KEY>')

    # Structured chat-id fields.
    #
    # CORRECTED IN P7.5R. The previous form of the first rule was:
    #
    #     (?<="(?:chat_?[Ii]d|...)"\s*:\s*")[^"]*   ->  <REDACTED_CHAT_ID>
    #
    # which redacted by FIELD NAME and therefore replaced the value whatever it was. An n8n
    # EXPRESSION such as `={{ $json.chat_id }}` contains no identity -- it is code that computes
    # one at runtime -- and it became <REDACTED_CHAT_ID> in every tracked export. P7.5 deployed
    # an artifact generated from such an export; the live bot could not have replied to anyone
    # because every reply was addressed to a literal string.
    #
    # The rule now matches only a CONCRETE value: a run of 6-12 digits, optionally in a
    # delimited list. A value starting with '=' or containing '{{' is left byte-for-byte alone.
    # The canonical redactor is n8n/src/deploy-guard/redactor.js, which works on the parsed
    # object and is the implementation the deployment materializer uses; this one is kept in
    # step for the snapshots that are committed from PowerShell.
    $out = [regex]::Replace($out, '(?<="(?:chat_?[Ii]d|chatId|owner_chat_id|manager_chat_id|allowed_chat_ids)"\s*:\s*")(\d{6,12}(?:\s*[,;]\s*\d{6,12})*)(?=")', '<REDACTED_CHAT_ID>')
    $out = [regex]::Replace($out, '(?<="(?:chat_?[Ii]d|chatId)"\s*:\s*)\d{6,}', '"<REDACTED_CHAT_ID>"')

    # Telegram ids also appear as bare quoted literals inside node jsCode, most often as a
    # hardcoded owner fallback. Those are invisible to the key-based rules above, so quoted
    # 6-12 digit literals are redacted unless they are a known sheet gid.
    $out = [regex]::Replace($out, "(?<=\\?['`"])(\d{6,12})(?=\\?['`"])", {
        param($m)
        if ($script:CANONICAL_GIDS -contains $m.Groups[1].Value) { $m.Groups[1].Value } else { '<REDACTED_CHAT_ID>' }
    })

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
