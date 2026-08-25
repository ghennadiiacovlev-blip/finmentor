# FINMENTOR — wire structured attribution and the idempotency key into Lead Intake.
#
# Closes INDP2-05 and the detectable half of INDP2-02, but ONLY after the owner has added
# the eight columns listed in docs/FINMENTOR_ATTRIBUTION_AND_CRM_SCHEMA.md to the Pipeline
# tab. Save to Pipeline maps columns explicitly, so writing a field the sheet lacks fails
# the append and would lose the lead. The precondition below therefore refuses to run at all
# until every column is present.
#
# The live Pipeline header is 51 columns, A:AY, ending at days_in_stage. The eight new
# columns are therefore 52-59, AZ:BG. Appending at the end shifts nothing.
#
# request_id is NOT server-owned. It is minted in the browser by lead-transport.js, which
# also accepts a caller-supplied payload.meta.request_id. It is deployed here as a
# corroborated retry key only — never as a standalone row-selection tier. See section 2.4 of
# the schema document.
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

# 3. Dedup Guard and Build Merge Update are deployed from their versioned sources rather
# than string-spliced.
#
# Splicing is how the previous revision worked, and it is precisely why the merge path was
# missed: a patch that only edits the nodes it names cannot notice the node it forgot, and
# Build Merge Update — the one node on the path where merges actually happen — wrote no
# attribution at all. Deploying whole files is idempotent and keeps n8n in step with the
# repository (INDP3-04).
$SRC = Join-Path $PSScriptRoot '../n8n/src/lead-intake'
function Set-NodeFromSource([string]$nodeName, [string]$file) {
    $path = Join-Path $SRC $file
    if (-not (Test-Path $path)) { Fail "missing versioned source: $path" }
    $code = ((Get-Content $path -Raw) -replace "`r`n", "`n").TrimEnd()
    (Get-Node $nodeName).parameters.jsCode = $code
    $code
}
$dedupCode = Set-NodeFromSource 'Dedup Guard' 'dedup-guard.js'
$mergeCode = Set-NodeFromSource 'Build Merge Update' 'build-merge-update.js'

# The sources must carry the corrected contracts, not merely be present.
if ($dedupCode -notmatch 'requestIdCorroborated') { Fail 'dedup-guard.js has no corroborated request_id tier' }
if ($dedupCode -notmatch "lead\.email_norm && normEmail\(r\.email\) === lead\.email_norm") { Fail 'dedup-guard.js request_id tier is not corroborated by a server-derived identity' }
if ($dedupCode -notmatch "'request_id\+identity'") { Fail 'dedup-guard.js does not label the corroborated tier' }
if ($mergeCode -notmatch 'utm_source_first') { Fail 'build-merge-update.js has no first-touch policy' }
if ($mergeCode -notmatch 'gaAllowed') { Fail 'build-merge-update.js does not gate GA identifiers on consent' }
if ($mergeCode -notmatch 'const genuine = !item\.dedup_is_retry') { Fail 'build-merge-update.js does not exempt retries' }

# 4. The merge writer must stay auto-mapped, or the new keys silently never reach the sheet.
$mergeWrite = Get-Node 'Update Pipeline (Merge)'
if ($mergeWrite.parameters.columns.mappingMode -ne 'autoMapInputData') {
    Fail "Update Pipeline (Merge) is '$($mergeWrite.parameters.columns.mappingMode)', not autoMapInputData; its explicit map would need the eight columns adding by hand"
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
$vDedup = (($v.nodes | Where-Object { $_.name -eq 'Dedup Guard' }).parameters.jsCode -replace "`r`n", "`n").TrimEnd()
$vMerge = (($v.nodes | Where-Object { $_.name -eq 'Build Merge Update' }).parameters.jsCode -replace "`r`n", "`n").TrimEnd()
if ($vDedup -ne $dedupCode) { Fail 'read-after-write: Dedup Guard does not match dedup-guard.js byte for byte' }
if ($vMerge -ne $mergeCode) { Fail 'read-after-write: Build Merge Update does not match build-merge-update.js byte for byte' }

Save-WorkflowSnapshot -Workflow $v -Directory $snapshotDir -Label 'after' | Out-Null
Write-Host '  apply: PASS'
Write-Host '  read-after-write: PASS'
Write-Host "  active unchanged: $($v.active)"
Write-Host ''
Write-Host 'Submit one synthetic QA lead and confirm the eight columns populate before relying on this.'
