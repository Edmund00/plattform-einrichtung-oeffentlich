# Scheibe 8: Abo ohne Stripe-Schlüssel mit Attrappe und Wegwerf-Datenbank testen.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen (keine Installation)'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-abo.mjs
exit $LASTEXITCODE
