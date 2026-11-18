# Startet den automatischen Selbsttest "konfig" (Scheibe 4). Laeuft OFFLINE, braucht KEINE Stripe-Schluessel.
# Eigene Test-Datenbanken, Ports 4407, 4408 und 4411, raeumt selbst auf.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
& node --disable-warning=ExperimentalWarning tools\selbsttest-konfig.mjs
exit $LASTEXITCODE
