# BUILDER-FERTIG-A3E

Zweig: `meine-marke-a3`  
Commit: 41269ce  
Datum: 2026-11-16

## Was geliefert wurde

Testlücke Escaping + Unicode-Zeichen + Maximalwerte (Nachbesserung A3e).

## Neue und geänderte Dateien

| Datei | Änderung |
|---|---|
| `anbieter.mjs` | `VERBOTEN_UNICODE` Regex neu (ZWS/Bidi/BOM/SHY/LS/PS); Check in Steuerzeichen-Schleife; Längenprüfung auf `.normalize('NFC').length` umgestellt |
| `routes-marke.mjs` | Daten vor Speichern NFC-normalisieren (`.normalize('NFC')`) |
| `tools/selbsttest-a3-anbieter.mjs` | +29 Prüfungen (Abschnitt A3e) |

## Neue Validierungsregeln

**Verbotene Unicode-Kategorien** (alle Felder):  
`U+200B–U+200F` (ZWS/ZWJ/ZWNJ/LRM/RLM), `U+202A–U+202E` (Bidi-Einbettung/-Override), `U+2066–U+2069` (Bidi-Isolate), `U+FEFF` (BOM), `U+00AD` (weiches Trennzeichen), `U+2028–U+2029` (Zeilen-/Absatztrennzeichen) → `anbieter_ungueltig`

**Prüfreihenfolge** unverändert: Unbekannte Felder → Nicht-Strings → Steuerzeichen+Unicode → Pflicht → Länge → Format

**NFC-Normalisierung**: Kombinierte Zeichen (z. B. `u` + U+0308) werden vor dem Speichern zu NFC normalisiert (gespeichert als `ü`). Längengrenze gilt gegen die NFC-normalisierte Länge.

## Neue Testprüfungen (+29)

| Gruppe | Prüfungen |
|---|---|
| Step-up erneuern | 1 |
| XSS PUT-Payload → 200 | 1 |
| XSS Impressum / Datenschutz / Teilnahme (je 3) | 9 |
| Unicode-Einheit (10 Kategorien) | 10 |
| Unicode-Server PUT U+200B → 422 | 2 |
| NFC PUT kombiniert → 200 + GET ü | 2 |
| Maximalwert 160×ä, 161×ä, 500×x, 501×x | 4 |

## Nicht geprüft

- Mutations-Testing (macht der Chef)
- Browser-Verhalten der * / Pflichtfeld-Hinweis-Anzeige

## Testergebnisse

| Test | Ergebnis |
|---|---|
| a3-anbieter | 97 OK, 0 FEHLER ✅ |
| a3-anbieter-ui | 126 OK, 0 FEHLER ✅ |
| a3c-rechnung | 38 OK, 0 FEHLER ✅ |
| admin | 90 OK, 0 FEHLER ✅ |
| mailrecht | 23 OK, 0 FEHLER ✅ |
| assistent-recht | 75 OK, 0 FEHLER ✅ |
| generator-sync | 22 OK, 0 FEHLER ✅ |
| beleg | 26 OK, 0 FEHLER ✅ |
| sprachen | bekanntes OMEN-Timing-Flackern (im Chef-Lauf 45 OK ✅) |
