# FINMENTOR — prove the central Error Monitor fires and scrubs.
#
# Creates a throwaway workflow whose only job is to fail, with settings.errorWorkflow
# pointing at the monitor. The thrown message deliberately embeds SYNTHETIC contact data so
# the alert scrubber is proven end to end rather than by reading the regex.
#
# ISOLATION
#   * the failing workflow is temporary, clearly QA-named, and deleted in a finally block
#   * no production workflow is touched
#   * the synthetic identity uses the RFC 2606 reserved .invalid TLD
#   * the owner does receive one Telegram alert. That is the point of the test, and it is
#     clearly marked as QA.

param(
    [string]$MonitorName = 'FINMENTOR Error Monitor PREMIUM',
    [int]$TimeoutSeconds = 180,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "ERROR MONITOR QA ABORTED: $m" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$QA = "QA-REMEDIATION-$stamp"

# Synthetic values that must NOT survive into the alert.
$fakeEmail = "qa-$stamp@finmentor-qa.invalid"
$fakePhone = '+373 60 999 888'
$fakeUrl = 'https://docs.google.com/spreadsheets/d/QAFAKE/edit'

$monitor = @(Get-N8nWorkflowList | Where-Object { $_.name -eq $MonitorName })
if ($monitor.Count -ne 1) { Fail "expected exactly one workflow named '$MonitorName'; found $($monitor.Count)" }
$monitorId = $monitor[0].id
Write-Host "FINMENTOR Error Monitor proof"
Write-Host "  monitor: $monitorId  active=$($monitor[0].active)"

if (-not $Run) { Write-Host '  DRY-RUN: nothing created. Re-run with -Run.'; return }

$before = Invoke-N8n -Method Get -Path "/executions?workflowId=$monitorId&limit=1"
$beforeTop = if ($before.data -and $before.data.Count) { [int]$before.data[0].id } else { 0 }

$throwCode = @"
// QA REMEDIATION: deliberate failure carrying synthetic contact data, to prove the alert
// scrubber removes it. Nothing here touches any production system.
throw new Error('$QA synthetic failure. Contact $fakeEmail or $fakePhone. Sheet $fakeUrl');
"@

$body = [ordered]@{
    name  = "ZZ QA REMEDIATION Error Monitor proof $stamp"
    nodes = @(
        [pscustomobject]@{
            parameters  = [pscustomobject]@{ rule = [pscustomobject]@{ interval = @([pscustomobject]@{ field = 'minutes'; minutesInterval = 1 }) } }
            type        = 'n8n-nodes-base.scheduleTrigger'; typeVersion = 1.2
            position    = @(0, 0); id = [guid]::NewGuid().ToString(); name = 'QA Schedule'
        },
        [pscustomobject]@{
            parameters  = [pscustomobject]@{ jsCode = $throwCode }
            type        = 'n8n-nodes-base.code'; typeVersion = 2
            position    = @(220, 0); id = [guid]::NewGuid().ToString(); name = 'QA Deliberate Failure'
        }
    )
    connections = [pscustomobject]@{
        'QA Schedule' = [pscustomobject]@{ main = @(, @([pscustomobject]@{ node = 'QA Deliberate Failure'; type = 'main'; index = 0 })) }
    }
    settings = [pscustomobject]@{ executionOrder = 'v1'; availableInMCP = $false; errorWorkflow = $monitorId }
}

$clone = $null
try {
    $clone = Invoke-N8n -Method Post -Path '/workflows' -Body $body -Write
    Write-Host "  QA failing workflow created: $($clone.id)"
    $v = Get-N8nWorkflow -Id $clone.id
    if ($v.settings.errorWorkflow -ne $monitorId) { Fail 'errorWorkflow not persisted on the QA workflow' }

    $null = Invoke-N8n -Method Post -Path "/workflows/$($clone.id)/activate" -Write
    Write-Host '  activated; waiting for the failure and the monitor run...'

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $alert = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $r = Invoke-N8n -Method Get -Path "/executions?workflowId=$monitorId&limit=3&includeData=true"
        $fresh = @($r.data | Where-Object { [int]$_.id -gt $beforeTop })
        if ($fresh.Count -gt 0) { $alert = $fresh[0]; break }
        Write-Host '    ...still waiting'
    }
    if (-not $alert) { Fail "the monitor did not run within $TimeoutSeconds seconds" }

    $nodesRun = @($alert.data.resultData.runData.PSObject.Properties.Name)
    Write-Host ''
    Write-Host "  monitor execution $($alert.id)  status=$($alert.status)"
    Write-Host "    nodes: $($nodesRun -join ', ')"

    $script:pass = $true
    function Assert-Qa([bool]$c, [string]$name) {
        if ($c) { Write-Host "  PASS  $name" } else { Write-Host "  FAIL  $name"; $script:pass = $false }
    }

    Assert-Qa ($alert.status -eq 'success')                      'monitor execution succeeded'
    Assert-Qa ($nodesRun -contains 'Build Error Alert')          'alert builder executed'
    Assert-Qa ($nodesRun -contains 'Telegram Error Alert')       'owner Telegram alert sent'

    $ab = $alert.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Build Error Alert' }
    if (-not $ab) { Fail 'alert builder produced no run data' }
    $out = $ab.Value[0].data.main[0][0].json
    $text = [string]$out.alert_text

    Write-Host ''
    Write-Host '    --- alert content (synthetic) ---'
    $text -split "`n" | ForEach-Object { Write-Host "    | $_" }
    Write-Host ''

    Assert-Qa ($out.workflow_id -eq $clone.id)                   'alert identifies the failing workflow id'
    Assert-Qa ([string]$out.node_name -match 'QA Deliberate')    'alert identifies the failing node'
    Assert-Qa ([string]$out.correlation_id -ne '')               'alert carries a correlation id'
    Assert-Qa ([string]$out.ts -ne '')                           'alert carries a timestamp'
    Assert-Qa ([string]$out.error_class -ne '')                  'alert carries an error class'

    Assert-Qa (-not $text.Contains($fakeEmail))                  'synthetic email was scrubbed from the alert'
    Assert-Qa (-not $text.Contains('373 60 999 888'))            'synthetic phone was scrubbed from the alert'
    Assert-Qa (-not $text.Contains('docs.google.com'))           'synthetic url was scrubbed from the alert'
    Assert-Qa ($text.Contains('[contact removed]'))              'scrub markers are present'

    if (-not $script:pass) { Fail 'error monitor proof did not pass' }
    Write-Host 'ERROR MONITOR PROOF: PASS'
}
finally {
    if ($clone) {
        try { $null = Invoke-N8n -Method Post -Path "/workflows/$($clone.id)/deactivate" -Write } catch {}
        try {
            $null = Invoke-N8n -Method Delete -Path "/workflows/$($clone.id)" -Write
            Write-Host "  QA workflow $($clone.id) deactivated and deleted"
        } catch {
            Write-Host "  WARNING: QA workflow $($clone.id) could not be deleted - remove it manually"
        }
    }
}
