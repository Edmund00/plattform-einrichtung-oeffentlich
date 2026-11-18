# Prueft die Kauf-Route gegen die ECHTE Stripe-Sandbox "Schulungsplattform" (Gabriellas Konto, nur Testmodus). Keine Zahlung.
# Laedt zuerst den Testzugang (nur Edmunds Laptop). Ohne Zugang gibt der Test "uebersprungen" aus.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1')
try {
  & node --disable-warning=ExperimentalWarning tools\selbsttest-stripe-sandbox.mjs
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:STRIPE_SECRET_KEY, Env:STRIPE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
}
exit $code
