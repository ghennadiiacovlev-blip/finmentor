param(
    [string]$BaseUrl = $env:N8N_BASE_URL,
    [string]$ApiKey = $env:N8N_FIX_API_KEY,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { throw 'N8N_BASE_URL is not set.' }
if ([string]::IsNullOrWhiteSpace($ApiKey)) { throw 'N8N_FIX_API_KEY is not set.' }

$sourcePath = Join-Path $PSScriptRoot 'patch_command_center_secure_candidate.ps1'
$source = Get-Content $sourcePath -Raw

# Current n8n Telegram Trigger supports versions 1, 1.1, 1.2 and 1.3.
# Keep the main patch immutable and execute a corrected temporary copy.
$source = $source.Replace('typeVersion = 1.5', 'typeVersion = 1.3')

$tempPath = Join-Path $env:TEMP ('finmentor-command-center-patch-' + [guid]::NewGuid().ToString() + '.ps1')
Set-Content -Path $tempPath -Value $source -Encoding UTF8

try {
    if ($Apply) {
        & $tempPath -BaseUrl $BaseUrl -ApiKey $ApiKey -Apply
    } else {
        & $tempPath -BaseUrl $BaseUrl -ApiKey $ApiKey
    }
} finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
}
