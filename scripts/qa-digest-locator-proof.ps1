# FINMENTOR — isolated proof that the repaired Daily Digest Activities locator writes.
#
# The Digest failed on every retained run with "Sheet with ID Activities not found" because
# Save Activity located the tab by NAME where n8n expects a numeric gid. The locator is
# repaired to gid 623316892; this proves it by execution rather than by inspection.
#
# ISOLATION
#   * runs a temporary CLONE, never the production workflow
#   * the Telegram node is DISABLED in the clone, so the owner receives no duplicate digest.
#     Build Digest Activity reads from Build Daily Digest, not from the Telegram node, so the
#     chain still reaches Save Activity.
#   * the Activity row written is marked QA-REMEDIATION so it is identifiable as evidence
#   * the clone is deactivated and deleted at the end, in a finally block
#
# The production Digest is not touched by this script.

param(
    [string]$SourceId = 'imeJIDeNyaWDyXzh',
    [int]$TimeoutSeconds = 180,
    [switch]$Run
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "DIGEST QA ABORTED: $m" }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$QA = "QA-REMEDIATION-$stamp"
$cloneName = "ZZ QA REMEDIATION Digest locator proof $stamp"

$src = Get-N8nWorkflow -Id $SourceId
Write-Host "FINMENTOR Digest locator proof"
Write-Host "  source: $SourceId  active=$($src.active)  $($src.name)"

$saveActivity = @($src.nodes | Where-Object { $_.name -eq 'Save Activity' })
if ($saveActivity.Count -ne 1) { Fail 'expected exactly one Save Activity node' }
$gid = $saveActivity[0].parameters.sheetName.value
if ("$gid" -ne '623316892') { Fail "Save Activity does not use the canonical Activities gid (found '$gid')" }
Write-Host "  Save Activity gid: $gid  (canonical)"

if (-not $Run) { Write-Host '  DRY-RUN: clone not created. Re-run with -Run.'; return }

# ---- build the clone -------------------------------------------------------------------
$nodes = $src.nodes | ConvertTo-Json -Depth 100 | ConvertFrom-Json   # deep copy

foreach ($n in $nodes) {
    if ($n.name -eq 'Telegram Daily Digest') {
        $n | Add-Member -NotePropertyName disabled -NotePropertyValue $true -Force
    }
    if ($n.type -eq 'n8n-nodes-base.scheduleTrigger') {
        # Fire promptly and repeatedly; the clone lives for at most a couple of minutes.
        $n.parameters = [pscustomobject]@{
            rule = [pscustomobject]@{ interval = @([pscustomobject]@{ field = 'minutes'; minutesInterval = 1 }) }
        }
    }
    if ($n.name -eq 'Build Digest Activity') {
        $n.parameters.jsCode = @"
// QA clone. Writes a clearly marked evidence row to Activities so the repaired gid locator
// is proven by an actual append rather than by configuration inspection.
const s = (function(){ try { return `$('Build Daily Digest').first().json.stats || {}; } catch(e){ return {}; } })();
return [{ json: {
  activity_id: '$QA-digest-' + Date.now(),
  ts: new Date().toISOString(),
  lead_id: '$QA',
  actor: 'system:qa-remediation',
  channel: 'internal',
  action: 'qa_digest_locator_proof',
  detail: '$QA synthetic locator proof. Telegram delivery disabled. active=' + (s.active||0)
}}];
"@
    }
}

$body = [ordered]@{
    name        = $cloneName
    nodes       = $nodes
    connections = $src.connections
    settings    = [pscustomobject]@{ executionOrder = 'v1'; binaryMode = 'separate'; availableInMCP = $false }
}

$clone = $null
try {
    $clone = Invoke-N8n -Method Post -Path '/workflows' -Body $body -Write
    Write-Host "  clone created: $($clone.id)  active=$($clone.active)"
    if ($clone.active -eq $true) { Fail 'clone was created already active' }

    $verifyClone = Get-N8nWorkflow -Id $clone.id
    $tg = @($verifyClone.nodes | Where-Object { $_.name -eq 'Telegram Daily Digest' })
    if ($tg[0].disabled -ne $true) { Fail 'read-after-write: Telegram node is not disabled in the clone' }
    Write-Host '  read-after-write: Telegram node disabled = True'

    $null = Invoke-N8n -Method Post -Path "/workflows/$($clone.id)/activate" -Write
    Start-Sleep -Seconds 3
    $act = Get-N8nWorkflow -Id $clone.id
    if ($act.active -ne $true) { Fail 'clone did not activate' }
    Write-Host '  clone activated; waiting for a scheduled execution...'

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $exec = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 10
        $r = Invoke-N8n -Method Get -Path "/executions?workflowId=$($clone.id)&limit=5&includeData=true"
        if ($r.data -and $r.data.Count -gt 0) { $exec = $r.data[0]; break }
        Write-Host '    ...still waiting'
    }
    if (-not $exec) { Fail "no execution observed within $TimeoutSeconds seconds" }

    $nodesRun = @($exec.data.resultData.runData.PSObject.Properties.Name)
    $err = $exec.data.resultData.error

    Write-Host ''
    Write-Host "  execution $($exec.id)  status=$($exec.status)"
    Write-Host "    nodes: $($nodesRun -join ', ')"
    if ($err) { Write-Host "    error: $($err.message) @ $($err.node.name)" }

    $pass = $true
    function Assert-Qa([bool]$c, [string]$name) {
        if ($c) { Write-Host "  PASS  $name" } else { Write-Host "  FAIL  $name"; $script:pass = $false }
    }
    Assert-Qa ($exec.status -eq 'success')             'execution completed successfully'
    Assert-Qa ($nodesRun -contains 'Save Activity')    'Save Activity executed'
    Assert-Qa ($null -eq $err)                         'no node reported an error'

    # A disabled n8n node still appears in runData, as a PASS-THROUGH: it forwards its input
    # unchanged instead of performing its operation. So presence in runData proves nothing.
    # A real Telegram send returns the Bot API response, which always carries message_id and
    # a chat object. Absence of those is what proves nothing was delivered.
    $tgRun = $exec.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Telegram Daily Digest' }
    if ($tgRun) {
        $tgOut = $tgRun.Value[0].data.main[0][0].json
        $sent = ($null -ne $tgOut.message_id) -or ($null -ne $tgOut.chat)
        Write-Host "    telegram node output keys: $(($tgOut.PSObject.Properties.Name) -join ', ')"
        Assert-Qa (-not $sent) 'Telegram delivery did NOT occur (no duplicate owner digest)'
    } else {
        Assert-Qa $true 'Telegram node did not run at all (no duplicate owner digest)'
    }

    $saveRun = $exec.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Save Activity' }
    if ($saveRun) {
        $hadError = @($saveRun.Value | Where-Object { $_.error })
        Assert-Qa ($hadError.Count -eq 0) 'Save Activity appended without error'
    }

    # Persist evidence before the clone (and with it, its executions) is removed.
    $evidence = Join-Path $env:TEMP "finmentor-digest-proof-$stamp.json"
    [pscustomobject]@{
        stamp = $stamp; cloneId = $clone.id; executionId = $exec.id; status = $exec.status
        nodesRun = $nodesRun; saveActivityGid = "$gid"
        telegramOutputKeys = if ($tgRun) { @($tgRun.Value[0].data.main[0][0].json.PSObject.Properties.Name) } else { @() }
    } | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $evidence
    Write-Host "    evidence: $evidence"

    if (-not $script:pass) { Fail 'digest locator proof did not pass' }
    Write-Host ''
    Write-Host 'DIGEST LOCATOR PROOF: PASS'
}
finally {
    if ($clone) {
        try { $null = Invoke-N8n -Method Post -Path "/workflows/$($clone.id)/deactivate" -Write } catch {}
        try {
            $null = Invoke-N8n -Method Delete -Path "/workflows/$($clone.id)" -Write
            Write-Host "  clone $($clone.id) deactivated and deleted"
        } catch {
            Write-Host "  WARNING: clone $($clone.id) could not be deleted - remove it manually"
        }
    }
}
