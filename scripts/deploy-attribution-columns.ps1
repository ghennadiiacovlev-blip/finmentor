# FINMENTOR — wire structured attribution and the idempotency key into Lead Intake.
#
# Closes INDP2-05 and the detectable half of INDP2-02, but ONLY after the owner has added
# the eight columns listed in docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md to the Pipeline
# tab. Save to Pipeline maps columns explicitly, so writing a field the sheet lacks fails
# the append and would lose the lead. The precondition below therefore refuses to run at all
# until every column is present.
#
# The live Pipeline header is read WITHOUT direct Sheets access, by inspecting the column
# names in the most recent Read Pipeline (Dedup) output of a retained Lead Intake execution.
# That is the same header the append node writes against.

param(
    [string]$WorkflowId = 'QmIyEW2ZEqKregmN',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'n8n-lib.ps1')

function Fail([string]$m) { throw "ATTRIBUTION DEPLOY ABORTED: $m" }

$REQUIRED = @(
    'request_id', 'analytics_consent', 'ga_client_id', 'ga_session_id',
    'utm_source_first', 'utm_medium_first', 'utm_campaign_first', 'first_touch_at'
)

Write-Host "FINMENTOR attribution columns deploy  [$(if ($Apply) { 'APPLY' } else { 'DRY-RUN' })]"

# ---- precondition: read the live Pipeline header ----------------------------------------
$header = $null
$r = Invoke-N8n -Method Get -Path "/executions?workflowId=$WorkflowId&limit=20&includeData=true"
foreach ($e in $r.data) {
    $p = $e.data.resultData.runData.PSObject.Properties | Where-Object { $_.Name -eq 'Read Pipeline (Dedup)' }
    if (-not $p) { continue }
    $rows = $p.Value[0].data.main[0]
    if (-not $rows -or $rows.Count -eq 0) { continue }
    $header = @($rows[0].json.PSObject.Properties.Name | Where-Object { $_ -ne 'row_number' })
    break
}
if (-not $header) { Fail 'could not read the live Pipeline header from any retained execution; submit one lead and retry' }

Write-Host "  live Pipeline header: $($header.Count) columns"
$missing = @($REQUIRED | Where-Object { $header -notcontains $_ })
if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Host '  PRECONDITION NOT MET. Missing columns in the Pipeline tab:'
    $missing | ForEach-Object { Write-Host "    - $_" }
    Write-Host ''
    Write-Host '  Add them to the END of the header row, in the order given in'
    Write-Host '  docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md section 2.1, then re-run.'
    Write-Host '  Nothing was changed.'
    exit 2
}
Write-Host '  precondition: all eight columns present'

# ---- patch ------------------------------------------------------------------------------
$wf = Get-N8nWorkflow -Id $WorkflowId
$wasActive = [bool]$wf.active
$snapshotDir = Join-Path $env:TEMP "finmentor-attr-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null
Save-WorkflowSnapshot -Workflow $wf -Directory $snapshotDir -Label 'before' | Out-Null
Write-Host "  rollback snapshot: $snapshotDir"

function Get-Node([string]$name) {
    $m = @($wf.nodes | Where-Object { $_.name -eq $name })
    if ($m.Count -ne 1) { Fail "expected exactly one node '$name'; found $($m.Count)" }
    $m[0]
}

# 1. Build Pipeline Row emits the new fields.
$buildRow = Get-Node 'Build Pipeline Row'
if ($buildRow.parameters.jsCode -match 'utm_source_first') { Fail 'Build Pipeline Row already emits attribution fields; refusing to double-patch' }

$inject = @'

// --- structured attribution and idempotency key (see docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md)
// utm_source / utm_medium / utm_campaign remain LAST touch. First touch is a separate
// dimension so a merge can advance last touch without destroying how the lead arrived.
const __meta = (function () { try { return JSON.parse(item.raw_json || '{}').meta || {}; } catch (e) { return {}; } })();
const __first = (__meta.attribution_first_touch && typeof __meta.attribution_first_touch === 'object') ? __meta.attribution_first_touch : {};
row.request_id = String(item.request_id || '');
row.analytics_consent = (__meta.analytics_consent === true) ? 'TRUE' : 'FALSE';
// GA identifiers are written only when consent was accepted at submit time.
row.ga_client_id = (__meta.analytics_consent === true) ? String(__meta.ga_client_id || '') : '';
row.ga_session_id = (__meta.analytics_consent === true) ? String(__meta.ga_session_id || '') : '';
row.utm_source_first = String(__first.utm_source || '');
row.utm_medium_first = String(__first.utm_medium || '');
row.utm_campaign_first = String(__first.utm_campaign || '');
row.first_touch_at = String(__first.captured_at || '');
'@

# The node must expose its row object under a predictable name for the injection to attach to.
if ($buildRow.parameters.jsCode -notmatch '(?m)^\s*(const|let|var)\s+row\s*=') {
    Fail 'Build Pipeline Row does not declare a `row` object; inspect it before patching'
}
$idx = $buildRow.parameters.jsCode.LastIndexOf('return')
if ($idx -lt 0) { Fail 'Build Pipeline Row has no return statement' }
$buildRow.parameters.jsCode = $buildRow.parameters.jsCode.Insert($idx, $inject + "`n")

# 2. Save to Pipeline gains the columns in its explicit map.
$save = Get-Node 'Save to Pipeline'
if ($save.parameters.columns.mappingMode -ne 'defineBelow') { Fail "Save to Pipeline mapping mode changed to $($save.parameters.columns.mappingMode)" }
foreach ($col in $REQUIRED) {
    if ($save.parameters.columns.value.PSObject.Properties[$col]) { continue }
    $save.parameters.columns.value | Add-Member -NotePropertyName $col -NotePropertyValue "={{ `$json.$col }}"
}

# 3. Dedup Guard gains a strong tier on the server-owned request id.
$dedup = Get-Node 'Dedup Guard'
if ($dedup.parameters.jsCode -notmatch 'lead\.provenance_trusted && lead\.lead_id') { Fail 'Dedup Guard is not at the expected revision' }
if ($dedup.parameters.jsCode -notmatch 'request_id exact match') {
    $anchor = "if (lead.provenance_trusted && lead.lead_id)"
    $tier = @'
// Strong tier: the server-owned request id. Unlike a caller lead_id this is not a
// selection capability - it is a random per-submission key the caller cannot use to name
// somebody else's row without already knowing that submission's id.
if (lead.request_id) consider(rows.filter(r => String(r.request_id || '').trim() === String(lead.request_id).trim() && String(r.request_id || '').trim() !== ''), 'request_id exact match', 'strong');
'@
    $dedup.parameters.jsCode = $dedup.parameters.jsCode.Replace($anchor, $tier + $anchor)
}

Write-Host '  preflight: PASS'
if (-not $Apply) { Write-Host 'DRY-RUN COMPLETE. No workflow was changed.'; return }

$body = [ordered]@{ name = $wf.name; nodes = $wf.nodes; connections = $wf.connections; settings = $wf.settings }
$null = Invoke-N8n -Method Put -Path "/workflows/$WorkflowId" -Body $body -Write
Start-Sleep -Milliseconds 1000

$v = Get-N8nWorkflow -Id $WorkflowId
if ([bool]$v.active -ne $wasActive) { Fail "active state changed ($wasActive -> $($v.active))" }
$vSave = ($v.nodes | Where-Object { $_.name -eq 'Save to Pipeline' })
foreach ($col in $REQUIRED) {
    if (-not $vSave.parameters.columns.value.PSObject.Properties[$col]) { Fail "read-after-write: column '$col' not persisted in Save to Pipeline" }
}
if (($v.nodes | Where-Object { $_.name -eq 'Build Pipeline Row' }).parameters.jsCode -notmatch 'utm_source_first') { Fail 'read-after-write: Build Pipeline Row not persisted' }
if (($v.nodes | Where-Object { $_.name -eq 'Dedup Guard' }).parameters.jsCode -notmatch 'request_id exact match') { Fail 'read-after-write: Dedup Guard not persisted' }

Save-WorkflowSnapshot -Workflow $v -Directory $snapshotDir -Label 'after' | Out-Null
Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host "  active unchanged: $($v.active)"
Write-Host ''
Write-Host 'Submit one synthetic QA lead and confirm the eight columns populate before relying on this.'
