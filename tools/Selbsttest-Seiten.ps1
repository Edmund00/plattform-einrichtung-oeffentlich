# Startet den automatischen Selbsttest "seiten" (Scheibe 4). Laeuft OFFLINE, braucht KEINE Stripe-Schluessel.
# Eigene Test-Datenbanken, Ports 4409, raeumt selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-seiten.mjs
exit $LASTEXITCODE
