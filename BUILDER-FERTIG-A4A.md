# BUILDER-FERTIG-A4A

Zweig: meine-marke-a4a
Commit-Hash: (siehe unten — wird nach Commit gesetzt)
Start: 2026-11-15 (vorherige Session)
Ende: 2026-11-16 13:09 UTC

## Geänderte Dateien

Neu angelegt:
- recht-text.mjs (Speicher- und Validierungslogik, setzeRechtDb-Injektion, rendereKlartext, leseEinwilligungVersion)
- routes-recht-admin.mjs (Admin-API: GET Übersicht, GET Version, POST Text, POST Wiederherstellen)
- tools/selbsttest-a4a-recht.mjs (Testdatei, 95 OK, 0 FEHLER)

Geändert:
- app.mjs (Einbindung rechtAdminRouter, 100-kb-JSON-Limit für Recht-Pfade, 413-Fehlerbehandlung)
- db.mjs (Tabellen recht_text und recht_aktiv angelegt)
- recht-vorlagen.mjs (URL-Redirect und Klartext-Auslieferung aus DB)
- routes-auth.mjs (leseEinwilligungVersion() statt Festwert)
- texte/de.json, texte/hu.json, texte/en.json (4 neue Fehlercodes)
- tools/de/teil3.mjs, tools/en/teil3.mjs (4 neue Fehlercodes)

## Testergebnisse A4a

a4a-recht: 95 OK, 0 FEHLER

## Nachbartests

| Test             | Ergebnis                                  |
|------------------|-------------------------------------------|
| seiten           | 0/1 — Server nicht gestartet (OMEN-Last, bekannt, kein A4a-Thema) |
| mailrecht        | 23/0                                      |
| assistent-recht  | 82/0                                      |
| a3-anbieter      | 132/0                                     |
| konto            | 49/0                                      |
| passwort         | 62/0                                      |
| admin            | 90/0                                      |
| generator-sync   | 22/0                                      |
| setupmodus       | 85/0                                      |
| kaufmail         | 42/0                                      |
| konfig           | F-161: "production: lauscht auf 0.0.0.0" — bekannt, nur nennen |
| sprachen         | 14/1 — Server nicht gestartet (OMEN-Last, bekannt, kein A4a-Thema) |

## Was NICHT geprüft wurde

- D10: Widerruf (nicht in A4a — offen für spätere Scheibe)
- D11: Admin-UI (nicht in A4a — offen für spätere Scheibe)
