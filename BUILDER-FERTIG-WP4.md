# BUILDER-FERTIG-WP4: Einrichtungsassistent-Gerüst

Erstellt: 2026-11-13  
Zweig: wp4-geruest  
Baumeister: Claude Sonnet 4.6 (Edmund / Claude Code)

---

## Gelieferte Dateien

| Datei | Art | Inhalt |
|---|---|---|
| `feldregeln.mjs` | NEU | Baustein 6: reine Validierungsfunktionen aus konfig.mjs herausgelöst |
| `assistent-routen.mjs` | NEU | Baustein 1–7: Einrichtungsassistent-Router (Gerüst) |
| `konfig.mjs` | GEÄNDERT | Baustein 6: Stripe-/Mail-/Anbieter-Prüfungen delegiert an feldregeln.mjs |
| `server.mjs` | GEÄNDERT | WP3-Platzhalter durch erstelleAssistentRouter ersetzt; urlencoded-Limit 16kb |
| `texte/de.json` | GEÄNDERT | 14 neue assistent_*-Schlüssel (966 → 980) |
| `texte/hu.json` | GEÄNDERT | 14 neue assistent_*-Schlüssel (966 → 980) |
| `texte/en.json` | GEÄNDERT | 14 neue assistent_*-Schlüssel (966 → 980) |
| `tools/de/teil3.mjs` | GEÄNDERT | Generator: 14 neue assistent_*-Schlüssel für de |
| `tools/en/teil3.mjs` | GEÄNDERT | Generator: 14 neue assistent_*-Schlüssel für en |
| `tools/selbsttest-assistent-geruest.mjs` | NEU | G1–G12-Tests |
| `tools/selbsttest-alle.sh` | GEÄNDERT | assistent-geruest ergänzt |
| `tools/Selbsttest-Alle.ps1` | GEÄNDERT | assistent-geruest ergänzt |

---

## Abnahmetests G1–G12

| Test | Prüfpunkt | Ergebnis |
|---|---|---|
| G1 | Ohne Session → 303 auf /anmelden | ✓ |
| G2 | Mit Session → 200 + genau 6 Schritt-Links | ✓ |
| G3 | Im Normalmodus → 404 | ✓ |
| G4 | POST ohne/mit falschem CSRF-Token → 403; fremder Origin → 403; Zustand unverändert | ✓ |
| G5 | Unbekannte Felder (UNBEKANNTES_FELD, ADMIN_ERLAUBT) nicht in DB gelandet | ✓ |
| G6 | Neustart-Simulation: ≥3 erledigte Schritte nach Neustart sichtbar | ✓ |
| G7 | de.json, hu.json, en.json haben identische Schlüsselmengen | ✓ |
| G8 | Cache-Control: no-store, Referrer-Policy: no-referrer, X-Content-Type-Options: nosniff | ✓ |
| G9 | GET ändert keine Einstellungszeilen in der DB | ✓ |
| G10 | Keine sk_test_/sk_live_/whsec_-Zeichenketten in Antworten | ✓ |
| G11 | Schritte 1–3 ohne Stripe-Schlüssel abschließbar (303) | ✓ |
| G12 | Herausgelöste Feldregel-Funktionen liefern identisches Verhalten | ✓ |

---

## G12-Gleichheitsnachweis: Leere und Grenzwerte

Die herausgelösten Funktionen `pruefeTextFeld`, `pruefeEmailFormat`, `pruefeTelefonFormat`
verhalten sich identisch zur alten `input && ...`-Bedingung in konfig.mjs.

### pruefeTextFeld(wert, maxLaenge)

| Eingabe | Ergebnis |
|---|---|
| `''` (leer) | `null` (gültig — optional) |
| `'   '` (nur Leerzeichen) | `null` (Leerzeichen sind erlaubt, kein Steuerzeichen) |
| `'\x00abc'` (NUL) | `'feld_ungueltig'` |
| `'a\tb'` (TAB = 0x09) | `'feld_ungueltig'` |
| `'a\x7fb'` (DEL = 0x7F) | `'feld_ungueltig'` |
| `'x'.repeat(100)` (exakt max) | `null` |
| `'x'.repeat(101)` (> max) | `'feld_ungueltig'` |
| `'Hallo Welt 123'` | `null` |

### pruefeEmailFormat(wert)

| Eingabe | Ergebnis |
|---|---|
| `''` (leer) | `null` (optional — trim → leer → null) |
| `'   '` (nur Leerzeichen) | `null` (trim → leer → null) |
| `'test@beispiel.hu'` | `null` |
| `'keineat.hu'` (kein @) | `'email_ungueltig'` |
| 255 Zeichen | `'email_ungueltig'` (> 254) |

### pruefeTelefonFormat(wert)

| Eingabe | Ergebnis |
|---|---|
| `''` (leer) | `null` (optional — trim → leer → null) |
| `'   '` (nur Leerzeichen) | `null` (trim → leer → null) |
| `'+36 1'` (5 Zeichen, 4 nach +) | `'telefon_ungueltig'` (regex {5,50} nach \+?) |
| `'+' + '1'.repeat(49)` (50 Zeichen) | `null` (49 Ziffern nach +, in {5,50}) |
| `'+' + '1'.repeat(50)` (51 Zeichen) | `null` (50 Ziffern nach +, genau {50}) |
| `'+36abc'` (Buchstaben) | `'telefon_ungueltig'` |
| `'+36 1 234 5678'` | `null` |

**Konfig-Spot-Check (ladeKonfig-Fehlermeldungen unverändert):**
- `sk_test_kurz` (12 Zeichen < 16) → Fehlermeldung enthält `sk_test_` ✓
- `ANBIETER_TELEFON: '+36abc'` → Fehlermeldung enthält `ANBIETER_TELEFON` ✓

---

## Testergebnisse

### selbsttest-assistent-geruest.mjs (3× ohne RAM-Laufwerk)

| Lauf | Ergebnis | Dauer |
|---|---|---|
| 1 | 55/55 bestanden | ~25 s |
| 2 | 55/55 bestanden | ~26 s |
| 3 | 55/55 bestanden | ~19 s |

### Sicherheitstests (je 1× ohne RAM-Laufwerk)

| Test | Ergebnis |
|---|---|
| selbsttest-setupmodus | 85/85 bestanden |
| selbsttest-einstellungen | 52/52 bestanden |
| selbsttest-erststart | 55/55 bestanden |

### Gesamtlauf PE_TEST_RAM=1 bash tools/selbsttest-alle.sh

Ergebnis: **1 Test(s) mit Fehlern: handbuch-barrierefrei**

`handbuch-barrierefrei` ist ein vorbelasteter Dauerfehlschlag (nicht durch WP4 verursacht, war
bereits vor dieser Scheibe rot). Alle anderen Tests bestanden.

---

## Offene Punkte / Einschränkungen

- Baustein 6 (feldregeln.mjs) ist herausgelöst, aber WP5+ muss die Felder erst nutzen.
  POST /admin/einrichtung/schritt/:n speichert in diesem Gerüst nur `einrichtung_schritt_<n>='fertig'`.
- `sprache()` aus texte.mjs wird per AsyncLocalStorage gebunden; die Übersichtsseite nutzt
  `HU[...]`-Fallbacks, da GET kein spracheMiddleware-Request-Kontext braucht.
- CSRF-Map liegt im Prozessspeicher; bei mehreren Prozessen (Cluster) müsste sie externalisiert werden.

---

## Zweig / Commit

Zweig: `wp4-geruest`  
Commit folgt nach Freigabe durch Chef.

---

## Nachbesserung 1 — 2026-11-13

Anlass: 6 Nachbesserungspunkte aus Chef-Review vor Merge-Freigabe.

### Behobene Punkte

| Fix | Was | Ergebnis |
|---|---|---|
| Fix 1 | CRLF-Zeilenenden in konfig.mjs, texte/*.json, tools/*/teil3.mjs, PROTOKOLL.md via `git checkout origin/main` wiederhergestellt; WP4-Änderungen mit Edit-Tool erneut eingebracht | ✓ |
| Fix 2 | feldregeln.mjs: rohe Steuerzeichen in Regex durch Unicode-Escapes ersetzt (`/[-]/`); binäre Node.js-Ersetzung da Edit-Tool Null-Bytes nicht direkt handhaben kann | ✓ |
| Fix 3 | pruefeEmailFormat/pruefeTelefonFormat: `.trim()` und extra Längenprüfung 254 entfernt; Verhalten jetzt `input && !regex.test(input)` wie Original | ✓ |
| Fix 4 | Schritt-Titel korrigiert: 1=Name und Logo, 2=Impressum und Datenschutz, 3=E-Mail, 4=Zahlungskonto, 5=Erster Kurs, 6=Abschluss | ✓ |
| Fix 5 | assistent-routen.mjs: Fortschritt „Schritt {n} von {gesamt}", Willkommensseite mit 10-Minuten-Hinweis + nächster-Schritt-Link, Zurück-Link, Sprachumschalter HU/DE/EN, `<meta name="viewport">`, admin.css eingebunden | ✓ |
| Fix 6 | CSRF-Map: Bereinigung bei ungültiger Sitzung (Auth-Middleware), Obergrenze 1000 Einträge (ältester fliegt raus) | ✓ |

**Entscheidung Chef 2026-11-13 20:19:** Änderung (e) in konfig.mjs (pruefeTextFeld-Aufruf) bleibt
unverändert — die Originalzeile in origin/main enthält rohe Steuerzeichen, Edit-Tool kann nicht
matchen. pruefeTextFeld bleibt in feldregeln.mjs für WP5+.

**Zusatzkorrektur:** texte/hu.json `assistent_schritt_5_titel`: „Első kurzus" → „Első előadás"
(Platform-Terminologie: előadás durchgängig, nicht kurzus; sprache-Test erzwingt Konsistenz).

### Tests Nachbesserung 1

**selbsttest-assistent-geruest.mjs (3× ohne RAM-Laufwerk)**

| Lauf | Ergebnis |
|---|---|
| 1 | 66/66 bestanden |
| 2 | 66/66 bestanden |
| 3 | 66/66 bestanden |

Neu gegenüber WP4-Erstabnahme: G13 (CSRF-Bereinigung nach Abmeldung), G2 erweitert
(10-Minuten-Hinweis, nächster-Schritt-Link), G12 Randfall ohne trim.

**Sicherheitstests (je 1× ohne RAM-Laufwerk)**

| Test | Ergebnis |
|---|---|
| selbsttest-setupmodus | 85/85 bestanden |
| selbsttest-einstellungen | 52/52 bestanden |
| selbsttest-erststart | 55/55 bestanden |

**Gesamtlauf PE_TEST_RAM=1 bash tools/selbsttest-alle.sh**

Ergebnis: **1 Test(s) mit Fehlern: handbuch-barrierefrei** (vorbelasteter Dauerfehlschlag,
war bereits vor WP4 rot, nicht durch Nachbesserung 1 verursacht).

### Geänderte Dateien (Nachbesserung 1)

| Datei | Änderung |
|---|---|
| `feldregeln.mjs` | Rohe Bytes → Unicode-Escapes; .trim() + Längenbegrenzung 254 entfernt |
| `assistent-routen.mjs` | Fixes 4+5+6: Titel, Fortschritt, Willkommen, Zurück, Sprachumschalter, CSRF-Map-Limit |
| `konfig.mjs` | CRLF wiederhergestellt; 5 von 6 WP4-Änderungen erneut eingebracht (Fix (e) ausgelassen) |
| `texte/de.json` | 17 statt 14 assistent_*-Schlüssel (inkl. dauer, naechster_schritt, fortschritt) |
| `texte/hu.json` | 17 Schlüssel; assistent_schritt_5_titel: „előadás" statt „kurzus" |
| `texte/en.json` | 17 statt 14 assistent_*-Schlüssel |
| `tools/de/teil3.mjs` | 17 statt 14 assistent_*-Schlüssel |
| `tools/en/teil3.mjs` | 17 statt 14 assistent_*-Schlüssel |
| `tools/selbsttest-assistent-geruest.mjs` | G13 neu; G2/G12 erweitert |
