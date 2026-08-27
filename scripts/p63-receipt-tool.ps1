# FINMENTOR - P6.3 Submission_Receipts operator tool.
#
#   pwsh scripts/p63-receipt-tool.ps1 -List
#   pwsh scripts/p63-receipt-tool.ps1 -Issue  -Key sub_<32 hex>       # what the GATEWAY does
#   pwsh scripts/p63-receipt-tool.ps1 -Delete -Key sub_<32 hex>       # cleanup
#
# WHY THIS EXISTS. The internal route refuses to invent a receipt: `Receipt Read Verdict`
# treats a missing row as a BROKEN INVARIANT, not as permission to proceed. A receipt must
# therefore be PREALLOCATED as `commit_state: READY` before the internal call -- that is the
# gateway's half of the contract, and this tool performs it synthetically so the canary's half
# can be exercised without standing the gateway up.
#
# GUARDS. Keys must match the same /^sub_[0-9a-f]{32}$/ the graph enforces, so this cannot
# seed a row the route would reject for a different reason and confuse the diagnosis. -Issue
# refuses to overwrite an existing key: silently re-seeding a key mid-run would fabricate a
# state transition that never happened.

[CmdletBinding()]
param(
    [switch]$List,
    [switch]$Issue,
    [switch]$Delete,
    [string]$Key
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

$TableId = 'fV23lsh9uq8uFHox'   # Submission_Receipts
$Base    = $env:N8N_BASE_URL.TrimEnd('/')
$KeyRe   = '^sub_[0-9a-f]{32}$'

function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

$modes = @(@($List, $Issue, $Delete) | Where-Object { $_ })
if ($modes.Count -ne 1) { Fail 'specify exactly one of -List, -Issue, -Delete.' }

$readH  = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY }
$writeH = @{ 'X-N8N-API-KEY' = $env:N8N_FIX_API_KEY }
$rowsUri = "$Base/api/v1/data-tables/$TableId/rows"

function Get-Rows { (Invoke-RestMethod -Method Get -Uri "$rowsUri`?limit=200" -Headers $readH).data }

function Show-Rows {
    param($rows)
    if (-not $rows -or @($rows).Count -eq 0) { Write-Host '  (no rows)'; return }
    foreach ($r in @($rows)) {
        Write-Host ("  id={0,-4} {1}  state={2,-10} mode={3,-6} lead={4} corr={5}" -f `
            $r.id, $r.submission_key, $r.commit_state, $r.lead_mode, $r.canonical_lead_id, $r.correlation_id)
    }
}

if ($List) {
    $rows = Get-Rows
    Write-Host ''
    Write-Host "== Submission_Receipts ($(@($rows).Count) rows) =="
    Show-Rows $rows
    exit 0
}

if (-not $Key)              { Fail '-Key is required.' }
if ($Key -notmatch $KeyRe)  { Fail "key '$Key' does not match $KeyRe -- the graph would reject it." }

$existing = @(Get-Rows | Where-Object { $_.submission_key -eq $Key })

if ($Issue) {
    if ($existing.Count -gt 0) {
        Write-Host ''
        Write-Host 'ALREADY PRESENT - refusing to re-seed. Current state:'
        Show-Rows $existing
        Fail 'a receipt for this key already exists.'
    }
    $body = @{ data = @(@{
        submission_key    = $Key
        commit_state      = 'READY'
        created_at        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        canonical_lead_id = ''
        lead_mode         = ''
        lead_priority     = ''
        financial_zone    = ''
        claimed_at        = ''
        settled_at        = ''
        abort_reason      = ''
        correlation_id    = ''
    }) } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method Post -Uri $rowsUri -Headers $writeH -ContentType 'application/json' -Body $body | Out-Null

    # Readback - the POST returning 200 is not the proof.
    $after = @(Get-Rows | Where-Object { $_.submission_key -eq $Key })
    if ($after.Count -ne 1)                 { Fail "after issue there are $($after.Count) rows for this key, expected 1." }
    if ($after[0].commit_state -ne 'READY') { Fail "issued row has commit_state '$($after[0].commit_state)', expected READY." }
    Write-Host ''
    Write-Host '== ISSUED (READY) =='
    Show-Rows $after
    exit 0
}

if ($Delete) {
    if ($existing.Count -eq 0) { Write-Host ''; Write-Host 'nothing to delete for this key.'; exit 0 }
    Write-Host ''
    Write-Host '== deleting =='
    Show-Rows $existing
    $filter = @{ type = 'and'; filters = @(@{ columnName = 'submission_key'; condition = 'eq'; value = $Key }) } | ConvertTo-Json -Depth 10 -Compress
    $enc = [uri]::EscapeDataString($filter)
    Invoke-RestMethod -Method Delete -Uri "$rowsUri`?filter=$enc" -Headers $writeH | Out-Null
    $after = @(Get-Rows | Where-Object { $_.submission_key -eq $Key })
    if ($after.Count -ne 0) { Fail "after delete there are still $($after.Count) rows for this key." }
    Write-Host '  deleted, verified absent'
    exit 0
}
