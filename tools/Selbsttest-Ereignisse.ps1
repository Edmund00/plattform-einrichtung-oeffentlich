# Scheibe 15: Geschäftsereignisse, Offline-Stripe und Mail-Attrappe.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-ereignisse.mjs
exit $LASTEXITCODE
