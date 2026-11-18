# BUILDER-FERTIG-A3H

Commit: 7af89b2  
Branch: meine-marke-a3  
Datum: 2026-11-16

## Was geändert wurde

Nur Testdatei: `tools/selbsttest-a3-anbieter.mjs` (+91 Zeilen, kein Produktivcode).

### F-198 — ENV-Stufe per HTTP testen (hoch)

Neuer Abschnitt in `selbsttest-a3-anbieter.mjs`:
- `erstelleServer({ anbieter: {ANBIETER_NAME:'Env GmbH', ...} })` auf dynamischem Port
- `GET /api/anbieter` ohne marke → Env GmbH
- Admin-Anmeldung + `GET /api/admin/marke` → quelle=umgebung
- Step-up + `PUT /api/admin/marke/anbieter` → Admin-Firma GmbH, quelle=marke
- `DELETE` → zurück Env GmbH, quelle=umgebung
- `/jogi/impresszum` zeigt jeweils den passenden Namen

Mutations-Prüfung: Test geht ROT, wenn `setzeAnbieterBasis(anbieter)` in `app.mjs` entfernt
wird (dann bleibt anbieterBasis leer → GET /api/anbieter gibt nicht 'Env GmbH').

### F-193 — Testlücken geschlossen (niedrig)

**(a)** `leseAnbieter()` mit nur-Leerzeichen-ANBIETER_NAME in einstellungen + leerer ENV:
- quelle='standard', name=''
- Test geht ROT wenn `if (name?.trim())` zu `if (name)` wird

**(b)** `pruefeAnbieter`-Zweige mit felder-Angabe:
- anschrift 501 → felder:['anschrift']
- adoszam 501 → felder:['adoszam']
- steuerHinweis 501 → felder:['steuerHinweis']
- Array / null / Zahl → fehler:'anbieter_ungueltig', felder:[]

## Test-Ergebnisse

| Test | Ergebnis |
|---|---|
| `selbsttest-a3-anbieter.mjs` | 132 OK, 0 FEHLER |
| `selbsttest-a3-anbieter-ui.mjs` | 140 OK, 0 FEHLER |
| `selbsttest-a3c-rechnung.mjs` | 53 OK, 0 FEHLER |

## Was NICHT in A3h geprüft wurde

- F-190, F-194, F-195, F-196, F-197 — vertagt in A4/A5
- assistent-recht, beleg, mailrecht, admin, generator-sync, seiten, kaufmail, setupmodus,
  konfig, sprachen — keine Produktivdateien geändert, kein Nachbartest nötig
