# FINMENTOR - P6.3 guarded ARCHIVE of a superseded B.2.1-C internal receipt canary.
#
#   pwsh scripts/archive-b21c-canary.ps1 -Id <workflowId> -DryRun
#   pwsh scripts/archive-b21c-canary.ps1 -Id <workflowId> -Archive
#   pwsh scripts/archive-b21c-canary.ps1 -Id <workflowId> -Unarchive
#
# WHY THIS EXISTS. deploy-b21c-canary.ps1 refuses to create a second LIVE workflow carrying the
# canary name, and archived ones deliberately do not count. Superseding the canary therefore
# needs the incumbent archived FIRST. Archiving is reversible (-Unarchive restores it), the
# incumbent is already inert, and it is retained rather than deleted -- so the "keep the old
# canary until the new one passes fidelity" property is preserved, not traded away.
#
# GUARDS. This refuses to touch anything that is not a superseded canary:
#   - the production Lead Intake id is hard-refused
#   - the target's name must equal the canary name exactly
#   - the target must be inactive
# Credentials come from the environment only and are never printed.
#
# ENVIRONMENT NOTE. Variables the owner sets mid-session are not inherited by an
# already-running process, so User scope is hydrated here per invocation.

[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Id,
    [switch]$DryRun,
    [switch]$Archive,
    [switch]$Unarchive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

# Hydrate from User scope when the process did not inherit the variables.
$reg = Get-ItemProperty -Path 'HKCU:\Environment' -ErrorAction SilentlyContinue
foreach ($n in @('N8N_BASE_URL', 'N8N_API_KEY', 'N8N_FIX_API_KEY')) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($n)) -and $reg -and $reg.PSObject.Properties[$n]) {
        [Environment]::SetEnvironmentVariable($n, ([string]$reg.$n).Trim())
    }
}

. (Join-Path $Here 'n8n-lib.ps1')

$CanaryName   = 'FINMENTOR Lead Intake INTERNAL B21C RECEIPT CANARY'
$ProductionId = 'QmIyEW2ZEqKregmN'

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host "  PASS  $m" }
function Fail { param([string]$m) Write-Host ''; Write-Host "ABORTED: $m"; exit 1 }

$modes = @(@($DryRun, $Archive, $Unarchive) | Where-Object { $_ })
if ($modes.Count -ne 1) { Fail 'specify exactly one of -DryRun, -Archive, -Unarchive.' }

if ($Id -eq $ProductionId) { Fail "refusing to touch the production Lead Intake workflow ($ProductionId)." }

Say ''
Say "== TARGET $Id =============================="

$w = Get-N8nWorkflow -Id $Id
Say "  name       : $($w.name)"
Say "  active     : $($w.active)"
Say "  isArchived : $($w.isArchived)"

if ($w.name -ne $CanaryName) { Fail "target name is '$($w.name)', not the canary name. Refusing." }
Ok 'name matches the canary name exactly'

if ($w.active -eq $true) { Fail 'the target is ACTIVE. Refusing to archive a running workflow.' }
Ok 'target is inactive'

if ($DryRun) { Say ''; Say 'DRY RUN - guards passed, nothing was written.'; exit 0 }

if ($Archive) {
    if ($w.isArchived -eq $true) { Say ''; Say 'already archived - nothing to do.'; exit 0 }
    Invoke-N8n -Method Post -Path "/workflows/$Id/archive" -Write | Out-Null
    $verb = 'archived'; $want = $true
} else {
    if ($w.isArchived -ne $true) { Say ''; Say 'already unarchived - nothing to do.'; exit 0 }
    Invoke-N8n -Method Post -Path "/workflows/$Id/unarchive" -Write | Out-Null
    $verb = 'unarchived'; $want = $false
}

# Read back against the live object - the call returning 200 is not the proof.
$after = Get-N8nWorkflow -Id $Id
if ($after.isArchived -ne $want) { Fail "the call succeeded but isArchived is $($after.isArchived), expected $want." }
if ($after.active -eq $true)     { Fail 'the workflow is now ACTIVE. Deactivate it by hand NOW.' }

Say ''
Say "== RESULT: $($verb.ToUpper()) ================================"
Say "  isArchived : $($after.isArchived)"
Say "  active     : $($after.active)"
