# Startet den automatischen Selbsttest fuer Kaufen und Freischalten (Scheibe 3). Laeuft OFFLINE, braucht KEINE Stripe-Schluessel
# (Stripe wird durch eine Attrappe ersetzt). Eigene Test-Datenbank unter daten\, Port 4404, raeumt selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-kauf.mjs
exit $LASTEXITCODE
