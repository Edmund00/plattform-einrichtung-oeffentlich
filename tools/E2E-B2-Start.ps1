# Etappe B2 (nur Testmodus): Dispute, Mailausfall, harter Neustart gegen ECHTES Stripe. Das Node-Skript startet Plattform und "stripe listen" selbst (damit es sie hart beenden kann).
# Aufruf: powershell -File tools\E2E-B2-Start.ps1 [dispute mailausfall neustart-kauf neustart-erstattung]
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent; Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1') | Out-Null
$lauf = Join-Path $app ('daten\e2e-b2-' + (Get-Date -Format 'yyyyMMdd-HHmmss')); New-Item -ItemType Directory -Force $lauf | Out-Null
$port = if ($env:B2_PORT) { $env:B2_PORT } else { '4471' }; $env:PORT=$port; $env:BASE_URL="http://localhost:$port"; $env:DB_DATEI=(Join-Path $lauf 'e2e.db'); $env:DATEI_ORDNER=(Join-Path $lauf 'dateien')
$env:MAIL_DUMP=(Join-Path $lauf 'mails.jsonl'); $env:MAIL_FAIL_DATEI=(Join-Path $lauf 'MAIL-AUS.flag'); $env:E2E_ORDNER=$lauf
$env:ANBIETER_NAME='Musterfirma (Demo)'; $env:ANBIETER_ANSCHRIFT='Beispielstrasse 1, 12345 Musterstadt'; $env:ANBIETER_TELEFON='+49 30 0000000'
$env:ANBIETER_EMAIL='edmundautomat@gmail.com'; $env:VERKAUFSMELDUNG_MAIL='edmundautomat@gmail.com'; $env:SUPPORT_MAIL='edmundautomat@gmail.com'
node tools\e2e-b2.mjs @args
Write-Host "Ordner: $lauf"
