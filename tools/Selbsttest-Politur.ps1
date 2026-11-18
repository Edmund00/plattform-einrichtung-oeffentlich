# Scheibe 30: Offline-Politur, keine Netzverbindung und keine Stripe-Schluessel.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-politur.mjs
exit $LASTEXITCODE
