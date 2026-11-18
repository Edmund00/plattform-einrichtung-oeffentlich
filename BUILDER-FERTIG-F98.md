# BUILDER-FERTIG F-98 (Zweig sicherheit-1b-f98, Basis origin/main 02bb233)

## Befund (vor dem Fix gemessen)
- Server: routes-auth.mjs:43 erzwingt die Einwilligung BEREITS (`req.body?.zustimmung !== true` -> 400 `zustimmung_noetig`), seit dem Ausgangsstand 0fb4200; HU/DE/EN-Texte vorhanden; bestehende Tests KW-4 in tools/selbsttest-passwort.mjs. Die Server-Haelfte von F-98 war also schon behoben (Annahme im Auftrag nicht zutreffend).
- Echte Luecke: public/kunde.js sendete fest `zustimmung: true`; nur das HTML-Attribut `required` am Haken verhinderte das Senden.

## Aenderung
- public/kunde.js (Registrierung): `zustimmung: hozzajarul.checked === true` und `hozzajarul.reportValidity()` vor dem Senden.
- tools/selbsttest-f98-zustimmung.mjs (neu, Port 19698): API-Faelle ohne Feld, false, "true", 1, null, Objekt, [true] -> 400 ohne Konto; true -> 201; Texte hu/de/en; Quelltextpruefung des Formulars.
- tools/selbsttest-alle.sh: Test eingetragen.
- tools/selbsttest-seiten.mjs: Erwartung von festem `zustimmung: true` auf den echten Haken umgestellt.

## Tests
- Alter Stand: f98 13 OK / 3 FEHLER (Teil C rot). Neuer Stand: 16 OK / 0 FEHLER.
- Gruen: passwort 62, registrierung-limit 21, kauf 157, konto 49, sprache 18 (Fehlercode-HU-Pruefung), seiten 76, schutz 38, admin 90, kurse 89, bestaetigung 44, ereignisse 63, verwaltung 79, vorschau 52, abo 77, abo-beenden 104, demo-sicherheit 239, emailaender-bereinigung 12, sitzungsablauf 29, stepup-frontend 25, sprachen 45, plus 13 weitere Tests, die kunde.js lesen.
- Nicht gelaufen: Browser-E2E (e2e-*.mjs), kein echter Klicktest des Formulars; selbsttest-alle.sh nicht komplett.
