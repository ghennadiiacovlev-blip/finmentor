# FINMENTOR — assert the outcome of the isolated Lead Intake QA against retained executions.
#
# Reads only the executions produced by scripts/qa-lead-intake-live.ps1, identified by the
# QA request ids. No real client execution is inspected and no CRM row is read directly.
#
# Asserts, from live evidence rather than from code review:
#   Phase 4  every response was 2xx AND ok:true, and canonical Pipeline commit preceded it
#   Phase 2  the repaired Activities / Pipeline / Dashboard locators actually append
#   Phase 3  a forged lead_id does not select an existing row
#   Phase 3  a repeated submission is a retry, not a second Pipeline row

param(
    [Parameter(Mandatory)][string]$Stamp,
    [string]$WorkflowId = 'QmIyEW2ZEqKregmN'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

$statePath = Join-Path $env:TEMP "finmentor-qa-$Stamp.json"
if (-not (Test-Path $statePath)) { throw "QA state not found: $statePath" }
$state = Get-Content -Raw $statePath | ConvertFrom-Json

$script:pass = 0
$script:fails = @()
function Check([string]$name, [scriptblock]$body) {
    try { & $body; $script:pass++; Write-Host "  PASS  $name" }
    catch { $script:fails += "$name : $($_.Exception.Message)"; Write-Host "  FAIL  $name -> $($_.Exception.Message)" }
}
function Assert([bool]$cond, [string]$msg) { if (-not $cond) { throw $msg } }

Write-Host "`nFINMENTOR isolated Lead Intake QA verification   stamp=$Stamp`n"

$raw = Invoke-N8n -Method Get -Path "/executions?workflowId=$WorkflowId&limit=30&includeData=true"

# Select only this run's executions, by QA request id.
$qaExecs = @()
foreach ($e in $raw.data) {
    $p = $e.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Normalize + Score Lead' }
    if (-not $p) { continue }
    $j = $p.Value[0].data.main[0][0].json
    if ($state.requestIds -contains [string]$j.request_id) {
        $ded = $e.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Dedup Guard' }
        $qaExecs += [pscustomobject]@{
            Id        = $e.id
            Status    = $e.status
            StartedAt = $e.startedAt
            Nodes     = @($e.data.resultData.runData.PSObject.Properties.Name)
            Norm      = $j
            Dedup     = if ($ded) { $ded.Value[0].data.main[0][0].json } else { $null }
        }
    }
}
$qaExecs = @($qaExecs | Sort-Object StartedAt)
Write-Host "  QA executions found: $($qaExecs.Count)"
foreach ($x in $qaExecs) {
    Write-Host ("    exec {0} {1,-8} lead_id={2} mode={3} match_by={4}" -f $x.Id, $x.Status, $x.Norm.lead_id, $x.Dedup.dedup_mode, $x.Dedup.dedup_match_by)
}
Write-Host ''

Check 'exactly three QA executions were retained' {
    Assert ($qaExecs.Count -eq 3) "expected 3, found $($qaExecs.Count)"
}
Check 'every QA execution completed successfully' {
    $bad = @($qaExecs | Where-Object { $_.Status -ne 'success' })
    Assert ($bad.Count -eq 0) "$($bad.Count) execution(s) not successful"
}

$new = $qaExecs[0]; $repeat = $qaExecs[1]; $forged = $qaExecs[2]

Write-Host 'PHASE 2 - repaired sheet locators actually write'
Check 'the new lead appended to Pipeline' {
    Assert ($new.Nodes -contains 'Save to Pipeline') 'Save to Pipeline did not execute'
}
Check 'the new lead appended to Activities (repaired gid 623316892)' {
    Assert ($new.Nodes -contains 'Save Activity') 'Save Activity did not execute'
}
Check 'the new lead appended to Lead_Answers' {
    Assert ($new.Nodes -contains 'Save Answers to Lead_Answers') 'Lead_Answers append did not execute'
}
Check 'the new lead appended to Leads archive' {
    Assert ($new.Nodes -contains 'Save Lead to CRM') 'Leads append did not execute'
}
Check 'the new lead appended to Dashboard_Feed' {
    Assert ($new.Nodes -contains 'Append Dashboard_Feed') 'Dashboard append did not execute'
}
Check 'no node in any QA execution reported an error' {
    foreach ($x in $qaExecs) {
        Assert ($null -eq $x.Norm.error) "execution $($x.Id) carried an error"
    }
}

Write-Host "`nPHASE 3 - trust boundary"
Check 'the baseline submission created a new row' {
    Assert ($new.Dedup.dedup_mode -eq 'new') "expected new, got $($new.Dedup.dedup_mode)"
}
Check 'the baseline lead_id is server-minted' {
    Assert ($new.Norm.lead_id -match '^FIN-\d+-\d+$') "not server-minted: $($new.Norm.lead_id)"
    Assert ([string]$new.Norm.submission_lead_id -eq '') 'baseline unexpectedly carried a caller lead_id'
}
Check 'the forged request quarantined the caller lead_id' {
    Assert ([string]$forged.Norm.submission_lead_id -eq [string]$state.claimedLeadId) 'caller lead_id not retained for correlation'
    Assert ($forged.Norm.provenance_trusted -eq $false) 'untrusted caller was marked trusted'
}
Check 'the forged lead_id did NOT become the canonical identity' {
    Assert ($forged.Norm.lead_id -ne $state.claimedLeadId) 'forged lead_id was adopted as canonical identity'
}
Check 'the forged request did NOT select the claimed row' {
    Assert ($forged.Dedup.existing_lead_id -ne $state.claimedLeadId) 'forged request selected the claimed row'
    Assert ($forged.Dedup.dedup_mode -eq 'new') "expected new, got $($forged.Dedup.dedup_mode)"
}
Check 'the forged request did not escalate anything' {
    Assert ($forged.Dedup.dedup_escalated -eq $false) 'forged request escalated canonical state'
}

Write-Host "`nPHASE 3 - retry semantics"
Check 'the repeated submission was treated as a retry' {
    Assert ($repeat.Dedup.dedup_is_retry -eq $true) 'repeat was not recognised as a retry'
    Assert ($repeat.Dedup.existing_lead_id -eq $new.Norm.lead_id) 'retry matched the wrong row'
}
Check 'the retry did NOT append a second Pipeline row' {
    Assert (-not ($repeat.Nodes -contains 'Save to Pipeline')) 'retry appended a duplicate Pipeline row'
}
Check 'the retry carried the same request id as the baseline' {
    Assert ($repeat.Norm.request_id -eq $new.Norm.request_id) 'request id not stable across the retry'
}

Write-Host "`n$($script:pass) passed, $($script:fails.Count) failed"
if ($script:fails.Count) {
    Write-Host 'LEAD INTAKE LIVE QA: FAIL'
    $script:fails | ForEach-Object { Write-Host "  - $_" }
    exit 1
}
Write-Host 'LEAD INTAKE LIVE QA: PASS'
