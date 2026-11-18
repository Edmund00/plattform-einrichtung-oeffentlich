> **Historisch (Scheibe 5):** Dies ist die Anleitung der ursprünglichen Lern-App. Die hier genannten Skripte `Start-Lern-App.ps1`, `Zahlungen-pruefen.ps1`, `pruefe-zahlungen.mjs` und `datenbank-ansehen.mjs` gibt es nicht mehr; sie passten nicht mehr zur Plattform. Gültig sind `docs/UMGEBUNG.md` und `CLAUDE.md`.

# Stripe-Lern-App ("Lern-Kaffee")

Kleine, selbst geschriebene Übungs-App (nur Testmodus): Registrieren und Anmelden, echte Datenbank (SQLite), Einmalzahlung, Abo mit Testphase, Webhook mit Signaturprüfung, Kundenportal. Jeder Benutzer sieht nur seine eigenen Bestellungen.

- Lektionen: `lektionen/LEKTIONEN.md` (acht Lektionen, Übungsaufgaben)
- Start: `tools\Start-Lern-App.ps1` (stellt den Testschlüssel nur im Prozess bereit, schreibt keine `.env`)
- Selbsttest: `tools\Selbsttest.ps1` (41 automatische Prüfungen, eigene Test-Datenbank, Port 4401)
- Technik: Node 24 (mit eingebautem `node:sqlite`), `express` 5.1, `stripe` 18.1, sonst nichts
- Ports: App 4400, Live-Fenster 4300
- Datenbank: `daten/lern-app.db` (nicht in Git, enthält Benutzer, Bestellungen)
- Schlüssel gehören nie in den Code oder ins Git (`.gitignore` ist vorbereitet)
- Zahlungen prüfen: `tools\Zahlungen-pruefen.ps1 -Email name@example.com` vergleicht die Zahlungen in Stripe mit der Datenbank (nur lesend)
- Datenbank ansehen: `node --disable-warning=ExperimentalWarning tools/datenbank-ansehen.mjs`
