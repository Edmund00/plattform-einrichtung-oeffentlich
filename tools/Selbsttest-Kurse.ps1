# Startet den automatischen Selbsttest der Kurs-API (Scheibe 1). Braucht KEINE Stripe-Schluessel.
# Test-Datenbank unter daten\, Port 4402. Raeumt hinterher selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-kurse.mjs
exit $LASTEXITCODE
