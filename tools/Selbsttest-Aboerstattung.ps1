# Scheibe 29: Offline-Test ohne Stripe-Schluessel.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen (keine Installation)'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-aboerstattung.mjs
exit $LASTEXITCODE
