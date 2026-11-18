# Scheibe 6: Verwaltung ausschließlich offline mit Stripe-Attrappe testen.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-verwaltung.mjs
exit $LASTEXITCODE
