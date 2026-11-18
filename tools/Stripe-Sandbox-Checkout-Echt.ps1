# Echter Checkout-Weg in der Stripe-SANDBOX (nur Testmodus): bezahlt wird im Browser mit der Stripe-Testkarte.
# Aufruf: powershell -File tools\Stripe-Sandbox-Checkout-Echt.ps1 <Datei-fuer-die-Checkout-Adresse>
param([Parameter(Mandatory = $true)][string]$UrlDatei)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1')
try {
  & node --disable-warning=ExperimentalWarning tools\stripe-sandbox-checkout-echt.mjs $UrlDatei
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:STRIPE_SECRET_KEY, Env:STRIPE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
}
exit $code
