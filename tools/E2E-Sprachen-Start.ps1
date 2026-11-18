# E2E je Sprache (nur Testmodus). Startet Test-Plattform (Port 4461, eigene DB, Mails in Datei statt Versand), stripe listen, fuehrt tools\e2e-sprachen.mjs aus.
# Aufruf: powershell -File tools\E2E-Sprachen-Start.ps1 [de en hu]
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent; Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1') | Out-Null
$lauf = Join-Path $app ('daten\e2e-' + (Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Force $lauf | Out-Null
$env:PORT='4461'; $env:BASE_URL='http://localhost:4461'; $env:DB_DATEI=(Join-Path $lauf 'e2e.db'); $env:DATEI_ORDNER=(Join-Path $lauf 'dateien')
$env:MAIL_DUMP=(Join-Path $lauf 'mails.jsonl'); $env:E2E_ORDNER=$lauf
$env:ANBIETER_NAME='Musterfirma (Demo)'; $env:ANBIETER_ANSCHRIFT='Beispielstrasse 1, 12345 Musterstadt'; $env:ANBIETER_TELEFON='+49 30 0000000'
$env:ANBIETER_EMAIL='edmundautomat@gmail.com'; $env:VERKAUFSMELDUNG_MAIL='edmundautomat@gmail.com'; $env:SUPPORT_MAIL='edmundautomat@gmail.com'
$listen = Start-Process stripe -ArgumentList @('listen','--api-key',$env:STRIPE_SECRET_KEY,'--events','checkout.session.completed,checkout.session.expired,invoice.paid,invoice.payment_failed,charge.refunded,refund.updated,refund.created,charge.dispute.created,customer.subscription.updated,customer.subscription.deleted','--forward-to','http://localhost:4461/webhook') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $lauf 'listen.log') -RedirectStandardError (Join-Path $lauf 'listen.err')
$srv = Start-Process node -ArgumentList @('--disable-warning=ExperimentalWarning','tools\e2e-server.mjs') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $lauf 'server.log') -RedirectStandardError (Join-Path $lauf 'server.err')
try { Start-Sleep 6; node tools\e2e-sprachen.mjs @args } finally { Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue; Stop-Process -Id $listen.Id -Force -ErrorAction SilentlyContinue }
Write-Host "Ordner: $lauf"
