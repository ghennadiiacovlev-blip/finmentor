# FINMENTOR — isolated live QA against the production Lead Intake webhook.
#
# Exercises, with synthetic data only, the paths repaired in this remediation:
#   - Phase 4  the HTTP success contract (2xx + JSON + ok:true)
#   - Phase 2  the repaired Activities / Pipeline sheet locators, by observing the
#              actual append nodes succeed in the retained execution
#   - Phase 3  the trust boundary: a forged lead_id must not select an existing row
#   - Phase 3  retry/duplicate handling for a repeated submission
#
# QA SAFETY
#   * every identity is synthetic and marked QA-REMEDIATION-<stamp>
#   * the email domain uses the RFC 2606 reserved `.invalid` TLD, which can never resolve
#     or receive mail, so no real person is contacted
#   * no real client row is read, written or mutated; assertions look only at the rows this
#     script itself created
#   * evidence rows are deliberately LEFT IN PLACE and QA-marked, per the remediation policy

param(
    [string]$WebhookUrl = 'https://ghennadi.app.n8n.cloud/webhook/finmentor-lead-intake',
    [string]$Stamp,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

if (-not $Stamp) { $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss' }
$QA = "QA-REMEDIATION-$Stamp"

function New-QaPayload {
    param([string]$RequestId, [string]$Suffix = '', [string]$ForgedLeadId = '')
    $p = [ordered]@{
        tool    = 'contact'
        lead    = [ordered]@{
            name     = "$QA$Suffix"
            contact  = "qa-$Stamp$Suffix@finmentor-qa.invalid"
            company  = "$QA$Suffix"
            email    = "qa-$Stamp$Suffix@finmentor-qa.invalid"
            telegram = ''
        }
        answers = [ordered]@{
            business = "$QA synthetic remediation test"
            message  = "Automated remediation QA. Synthetic data only. Not a real client. $QA"
        }
        signals = [ordered]@{ model = ''; urgency = ''; score_zone = ''; first_step = 'contact' }
        meta    = [ordered]@{
            page_url          = 'https://www.finmentor.md/index.html?utm_source=qa_remediation'
            referrer          = ''
            timestamp         = (Get-Date).ToUniversalTime().ToString('o')
            consent           = $true
            site_language     = 'ru'
            analytics_consent = $false
            request_id        = $RequestId
            utm_source        = 'qa_remediation'
            utm_medium        = 'internal_qa'
            utm_campaign      = $QA
        }
    }
    if ($ForgedLeadId) { $p['lead_id'] = $ForgedLeadId }
    $p
}

function Invoke-Intake {
    param([hashtable]$Payload, [string]$RequestId)
    $json = $Payload | ConvertTo-Json -Depth 20
    $headers = @{ 'X-FINMENTOR-Request-Id' = $RequestId }
    $r = Invoke-WebRequest -Method Post -Uri $WebhookUrl -Body $json -ContentType 'application/json' `
         -Headers $headers -SkipHttpErrorCheck -TimeoutSec 40
    $body = $null
    try { $body = $r.Content | ConvertFrom-Json } catch {}
    [pscustomobject]@{ Status = $r.StatusCode; Raw = $r.Content; Body = $body }
}

Write-Host "FINMENTOR isolated Lead Intake QA   identity=$QA"
Write-Host "  target: $WebhookUrl"
if (-not $Run) {
    Write-Host '  DRY-RUN: no request sent. Re-run with -Run to execute.'
    Write-Host '  payload preview:'
    (New-QaPayload -RequestId "fmr_qa_${Stamp}_a" | ConvertTo-Json -Depth 20)
    return
}

$results = [ordered]@{}

# ---- 1. baseline submission --------------------------------------------------------------
$reqA = "fmr_qa_${Stamp}_a"
Write-Host "`n[1] baseline submission  request_id=$reqA"
$a = Invoke-Intake -Payload (New-QaPayload -RequestId $reqA) -RequestId $reqA
Write-Host "    HTTP $($a.Status)  ok=$($a.Body.ok)  lead_id=$($a.Body.lead_id)  mode=$($a.Body.mode)"
$results.baseline = $a

Start-Sleep -Seconds 6

# ---- 2. immediate repeat, same request id and same contact -------------------------------
Write-Host "`n[2] repeat submission (same request_id, same contact)"
$b = Invoke-Intake -Payload (New-QaPayload -RequestId $reqA) -RequestId $reqA
Write-Host "    HTTP $($b.Status)  ok=$($b.Body.ok)  lead_id=$($b.Body.lead_id)  mode=$($b.Body.mode)"
$results.repeat = $b

Start-Sleep -Seconds 6

# ---- 3. trust boundary: forged lead_id naming the row created in step 1 -------------------
# A DIFFERENT synthetic contact claims the first QA row's lead_id. Under the old code this
# selected that row and merged into it. It must now be ignored.
$reqC = "fmr_qa_${Stamp}_c"
$victimLeadId = [string]$a.Body.lead_id
Write-Host "`n[3] forged lead_id from a different contact  (claims '$victimLeadId')"
$c = Invoke-Intake -Payload (New-QaPayload -RequestId $reqC -Suffix '-ATTACKER' -ForgedLeadId $victimLeadId) -RequestId $reqC
Write-Host "    HTTP $($c.Status)  ok=$($c.Body.ok)  lead_id=$($c.Body.lead_id)  mode=$($c.Body.mode)"
$results.forged = $c

$stateFile = Join-Path $env:TEMP "finmentor-qa-$Stamp.json"
[pscustomobject]@{
    stamp = $Stamp; qaIdentity = $QA
    baselineLeadId = [string]$a.Body.lead_id
    repeatLeadId   = [string]$b.Body.lead_id
    forgedLeadId   = [string]$c.Body.lead_id
    claimedLeadId  = $victimLeadId
    requestIds     = @($reqA, $reqC)
} | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 $stateFile

Write-Host "`n  QA state written: $stateFile"
Write-Host '  Run scripts/qa-lead-intake-verify.ps1 to assert the outcome against retained executions.'
