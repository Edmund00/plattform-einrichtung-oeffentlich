# Legt einen Admin an oder stuft einen vorhandenen Benutzer auf "admin" hoch.
#
# Aufruf (im Ordner der App):
#   .\tools\Admin-anlegen.ps1 -Email gabriella@example.com
#
# Das Passwort wird verdeckt abgefragt (nichts erscheint auf dem Bildschirm) und nie ausgegeben.
# Bei einem schon vorhandenen Benutzer wird nur die Rolle auf "admin" gesetzt, das Passwort bleibt.
# Die Datenbank ist daten\lern-app.db, ausser DB_DATEI ist gesetzt.
param([Parameter(Mandatory = $true)][string]$Email)
$ErrorActionPreference = 'Stop'
$app = Split-Path $PSScriptRoot -Parent
Set-Location $app
& node --disable-warning=ExperimentalWarning tools\admin-anlegen.mjs $Email
exit $LASTEXITCODE
