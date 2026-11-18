# Startet den automatischen Selbsttest fuer Datei-Upload und -Auslieferung (Scheibe 5). Laeuft OFFLINE, braucht KEINE Stripe-Schluessel.
# Legt einen eigenen Test-Ordner im Temp-Verzeichnis an (Port 4413), raeumt selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-dateien.mjs
exit $LASTEXITCODE
