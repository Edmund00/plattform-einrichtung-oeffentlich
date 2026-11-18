# Startet die MUSTER-Plattform lokal (nur Testmodus, Sandbox "Stripe-Muster-Plattform").
# Aufruf: powershell -File tools\Muster-Start.ps1
# Schluessel kommen aus dem Windows-DPAPI-Speicher und werden nie ausgegeben. Mails: nur Resend-Testabsender an das Test-Postfach.
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
. (Join-Path $PSScriptRoot 'Stripe-Umgebung.ps1')
$dir = Join-Path $env:USERPROFILE '.claude\secrets'
$ss = (Get-Content (Join-Path $dir 'resend-kiduo-send.dpapi') -Raw).Trim() | ConvertTo-SecureString
$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
try { $env:RESEND_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
$env:MAIL_FROM = 'Musterakademie <onboarding@resend.dev>'
$env:BASE_URL = $(if ($env:MUSTER_BASE) { $env:MUSTER_BASE } else { 'http://localhost:4400' })
if ($env:MUSTER_HOST) { $env:HOST = $env:MUSTER_HOST }
$env:PORT = '4400'
$env:DB_DATEI = (Join-Path $app 'daten\muster.db')
$env:DATEI_ORDNER = (Join-Path $app 'daten\muster-dateien')
$env:ANBIETER_NAME = 'Musterfirma (Demo)'
$env:ANBIETER_ANSCHRIFT = 'Beispielstrasse 1, 12345 Musterstadt'
$env:ANBIETER_TELEFON = '+49 30 0000000'
$env:ANBIETER_EMAIL = 'edmundautomat@gmail.com'
$env:VERKAUFSMELDUNG_MAIL = 'edmundautomat@gmail.com'
$env:SUPPORT_MAIL = 'edmundautomat@gmail.com'
Write-Host "Muster-Plattform startet auf $env:BASE_URL (Testmodus)"
node --disable-warning=ExperimentalWarning server.mjs

