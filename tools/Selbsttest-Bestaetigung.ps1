# Scheibe 14: Offline-Pruefung mit Wegwerf-SQLite und Mail-Attrappe.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-bestaetigung.mjs
exit $LASTEXITCODE
