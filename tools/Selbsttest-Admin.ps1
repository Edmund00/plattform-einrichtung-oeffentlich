# Startet die automatischen Selbsttests fuer die Kurs-API (Scheibe 1) und die Admin-Seite (Scheibe 2).
# Braucht KEINE Stripe-Schluessel. Eigene Test-Datenbanken unter daten\, Ports 4402 und 4403, raeumt selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-kurse.mjs
$a = $LASTEXITCODE
& node --disable-warning=ExperimentalWarning tools\selbsttest-admin.mjs
$b = $LASTEXITCODE
if ($a -ne 0 -or $b -ne 0) { exit 1 } else { exit 0 }
