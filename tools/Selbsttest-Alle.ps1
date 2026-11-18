# Startet ALLE Offline-Selbsttests nacheinander (Kurs, Admin, Kauf, Konfig, Seiten, Dateien). Braucht KEINE Stripe-Schluessel.
# Der Test gegen die echte Stripe-Sandbox ist getrennt: tools\Selbsttest-Stripe-Sandbox.ps1
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
if (-not (Test-Path 'node_modules')) { & npm install | Out-Host }
$fehler = 0
$tests = @('kurse', 'admin', 'kauf', 'konfig', 'seiten', 'dateien', 'verwaltung', 'schutz', 'abo', 'sprache', 'passwort', 'vorschau', 'bestaetigung', 'ereignisse', 'kaufmail', 'konto', 'beleg', 'abo-kuendigung', 'abo-beenden', 'migration-ereignisse', 'ellallas', 'mailrecht', 'agent', 'sicherung', 'abgleich', 'adminzugang', 'notaus', 'aboerstattung', 'politur', 'kurspaket', 'bunny-db', 'bunny', 'bunny-admin', 'bunny-wiedergabe', 'bunny-oberflaeche', 'plattform', 'apps-script', 'plattform-zeilen', 'sprachen', 'ratelimit-parallel', 'demo', 'kennzahlen', 'mailsprache', 'geldrecht', 'handbuch', 'handbuch-admin', 'handbuch-kaeufer-sprachen', 'aboschutz', 'lektionszugriff', 'restore', 'demo-sicherheit', 'registrierung-limit', 'mailbackoff', 'loginsperre', 'produktreife', 'marke', 'download', 'download-admin', 'handbuch-admin-sprachen', 'produktreife4', 'widerruf-erledigt', 'handbuch-barrierefrei', 'betragformat', 'refund-failed', 'generator-sync', 'setupmodus', 'einstellungen', 'erststart', 'assistent-geruest', 'assistent-logo', 'assistent-recht', 'assistent-mail', 'assistent-stripe', 'e2e3-einrichtung', 's1-banner-server', 's1-banner-ui', 'a1a-anzeige', 'a1b-marke-server', 'a1b-marke-ui', 'a1c-favicon', 'a2-1-tokens', 'a2-2b-farben-server', 'a2-3-farben-ui', 'a3-anbieter-ui', 'a3-anbieter', 'a3c-rechnung', 'a4a-recht', 'a4b-recht-ui', 'a5a-mails', 'a5b-sicherung-logo', 'a6-vorschau', 'assistent-abschluss', 'codex10-1b', 'emailaender-bereinigung', 'f129-loeschlauf', 'f131-anmelden', 'f142-logo-lesefehler', 'f245-anzeigen', 'f92-umsatz', 'f93-widerruf-betrag', 'f98-zustimmung', 'farben', 'g1a-abschluss', 'g1b-testkauf', 's2-beispiele-server', 'e7-naechste-schritte-ui', 's2-beispiele-ui', 'e4-einrichtung-ui', 'e5-anleitungen', 'e4b-fehlerseiten', 'e6-abschluss', 'p1-einrichtung-ui', 'k1-katalog-server', 'l1-listen-ui', 'k3-kategorienavigation-ui', 'k1-katalog-ui', 'kontrast', 'sicherheit-1b', 'sitzungsablauf', 'stepup-frontend')
# Vollstaendigkeit (A10-01, 12.11.2026): jede Datei tools\selbsttest-*.mjs muss in der Liste stehen (Ausnahme: der Sandbox-Test mit echtem Stripe, eigenes Skript).
$fehlend = Get-ChildItem 'tools\selbsttest-*.mjs' | ForEach-Object { $_.BaseName -replace '^selbsttest-', '' } | Where-Object { $_ -ne 'stripe-sandbox' -and $tests -notcontains $_ }
if ($fehlend) { Write-Host ('FEHLER: Selbsttests fehlen in Selbsttest-Alle.ps1: ' + ($fehlend -join ', ')); exit 1 }
foreach ($t in $tests) {
  Write-Host "=== selbsttest-$t"
  & node --disable-warning=ExperimentalWarning "tools\selbsttest-$t.mjs"
  if ($LASTEXITCODE -ne 0) { $fehler++ }
}
if ($fehler -gt 0) { Write-Host "$fehler Test(s) mit Fehlern"; exit 1 } else { Write-Host 'Alle Offline-Tests bestanden'; exit 0 }
