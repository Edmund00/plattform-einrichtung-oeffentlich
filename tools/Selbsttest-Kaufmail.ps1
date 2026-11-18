# Scheibe 16: Kaufmail-/Wasserzeichen-Test mit Wegwerf-SQLite, ohne Resend und Stripe.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { Write-Host 'node_modules fehlen'; exit 1 }
& node --disable-warning=ExperimentalWarning tools\selbsttest-kaufmail.mjs
exit $LASTEXITCODE
