# Echter Abo-Ablauf in der Stripe-SANDBOX (nur Testmodus, Testkarte): Kauf, volle Erstattung, Kuendigung, Abo-Ende.
# Laedt den Testzugang (nur Edmunds Laptop). Legt Objekte im Testkonto an und loescht den Test-Kunden am Ende wieder.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1')
try {
  & node --disable-warning=ExperimentalWarning tools\stripe-sandbox-abo-echt.mjs
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:STRIPE_SECRET_KEY, Env:STRIPE_WEBHOOK_SECRET -ErrorAction SilentlyContinue
}
exit $code
