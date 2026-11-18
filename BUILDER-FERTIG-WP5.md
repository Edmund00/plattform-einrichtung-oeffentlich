# BUILDER-FERTIG-WP5: Name und Logo (Schritt 1 Einrichtungsassistent)

Zweig: `wp5-logo` | Commits: `cec8bcf` → `bc03c43`

---

## Was geliefert wurde

**Neue Dateien:**
- `logo-png.mjs` — PNG-Validierung, atomares Speichern, öffentliche Route
- `tools/selbsttest-assistent-logo.mjs` — Selbsttest L1–L10, 90 Prüfungen

**Geänderte Dateien:**
- `assistent-routen.mjs` — Schritt-1-Oberfläche + Logo-Upload-Route
- `server.mjs` — öffentliche Logo-Route registriert
- `marke.mjs` — pruefePlattformName, STANDARD_PLATTFORM_NAME
- `texte/hu.json`, `texte/de.json`, `texte/en.json` — 11 neue Schlüssel Schritt 1
- `tools/de/teil3.mjs`, `tools/en/teil3.mjs` — Spiegel (siehe unten)
- `tools/selbsttest-alle.sh`, `tools/Selbsttest-Alle.ps1` — assistent-logo eingetragen

---

## Hinweise 1–4 (aus vorheriger Session)

**H1 — Eindeutiger Zwischenname + finally-Löschung:**
`speichereLogo` erzeugt den Zwischennamen aus `crypto.randomBytes(16).toString('hex')` (128 Bit
Entropie) statt `Math.random`. Die Datei wird mit Flag `wx` (exklusiv anlegen) geschrieben —
schlägt fehl, wenn sie wider Erwarten bereits existiert. Der `finally`-Block löscht die
Zwischendatei genau dann, wenn `writeFileSync` erfolgreich war, aber `renameSync` fehlschlug.
Test: L10 — zwei parallele Uploads (einer gültig, einer SVG); danach genau eine 200-Antwort,
keine `.tmp.`-Reste im marke-Ordner, Logo abrufbar.

**H2 — Größengrenze: 512 KiB = 524 288 Byte (bewusste Auslegung):**
`LOGO_MAX_BYTES = 512 * 1024 = 524 288`. Das ist die binäre Auslegung von „512 KB". Dezimal
wären es 512 000 Byte — diese Zahl würde ebenfalls angenommen (sie liegt unter 524 288).
Tests: `pruefePng(grossesPng(524288))` liefert `null` (angenommen);
`pruefePng(Buffer.alloc(524289))` liefert `png_zu_gross` (abgelehnt).
Die bewusste Wahl: Web-Standards und Betriebssysteme arbeiten mit KiB-Grenzen; für ein
Logo-Upload-Limit ist die binäre Grenze der natürlichere Wert.

**H3 — tools/de/teil3.mjs und tools/en/teil3.mjs:**
`selbsttest-generator-sync.mjs` prüft eine **bidirektionale** Spiegelung zwischen
`texte/*.json` und `tools/*/teil*.mjs`. Jeder neue Schlüssel in `texte/de.json` muss in
`tools/de/teil3.mjs` erscheinen und umgekehrt — sonst schlägt generator-sync mit FEHLER fehl.
WP5 fügt 11 neue Schlüssel hinzu (`assistent_name_bezeichnung` bis `assistent_logo_gespeichert`).
Die Änderung an den teil3-Dateien ist deshalb **zwingend erforderlich**, um den bereits
bestehenden Selbsttest generator-sync grün zu halten. Sie dient nicht der
Sprachprüfung der WP5-Oberfläche selbst.

**H4 — Tests für Sicherheits-Randfälle:**
- Anonymer Upload mit 5-MB-Body → 303 (nicht 413): beweist, dass die Session-Prüfung
  (`router.use(sessionCheck)`) VOR `express.raw` im Express-Router registriert ist und
  deshalb greift, bevor der Body gelesen wird. Test: L8.
- Fremder Origin → 403: L6.
- CSRF fehlt oder falsch → 403: L6.
- Origin fehlt → erlaubt (wie WP4): L6.

---

## Code-Review Nachbesserungen (diese Session)

**PNG-Validierung erweitert (pruefePng):**

| Prüfung | Verhalten |
|---|---|
| PLTE-Chunk | Pflicht bei Farbtyp 3; verboten bei 0 und 4; optional bei 2 und 6; nur einmal; vor erstem IDAT; Länge: Vielfaches von 3, 3–768 Byte |
| IHDR-Länge | Muss genau 13 Byte sein (nicht ≥ 13) |
| IHDR-Felder | Kompressionsmethode = 0; Filtermethode = 0; Interlace = 0 oder 1 |
| Chunk-Typ | Genau vier ASCII-Buchstaben; drittes Zeichen muss großgeschrieben sein (Reserved-Bit = 0 nach PNG-Spezifikation) |
| IDAT-Folge | Alle IDAT-Chunks müssen lückenlos aufeinanderfolgen; ein Ancillary-Chunk zwischen zwei IDAT-Chunks → `png_idat_unterbrochen` |
| Bekannte kritische Chunks | Nur IHDR, PLTE, IDAT, IEND; jeder andere Chunk mit großgeschriebenem ersten Buchstaben → abgelehnt |

Nicht umgesetzt (wie beauftragt): Dekompression der Bilddaten.

**speichereLogo als zusätzlicher Schutz:**
Ruft `pruefePng` selbst auf und wirft bei Fehler, bevor etwas geschrieben wird.
Schützt auch dann, wenn jemand `speichereLogo` direkt aufruft (nicht über die Route).

**Logo-Pfad aus DB-Verzeichnis:**
`machLogoPfad(dbDatei)` = `path.resolve(dirname(dbDatei), 'marke', 'logo.png')`.
In Produktion (DATEI_ORDNER nicht gesetzt): `daten/marke/logo.png` — gleich wie bisher.
In Tests: je Testlauf ein eigener Temp-Ordner, kein Shared-State zwischen Tests.
`logoRouteHandler(logoPfad)` ist jetzt eine Fabrik; `assistent-routen.mjs` und `server.mjs`
berechnen `logoPfad` einmal beim Start und übergeben ihn an alle Funktionen.

---

## Messungen

| Lauf | Wo | Ergebnis |
|---|---|---|
| assistent-logo allein | OMEN | 90/90 ✅ |
| assistent-logo allein | OMEN (PE_TEST_RAM=1) | 90/90 ✅ |
| Gesamtlauf (PE_TEST_RAM=1) | OMEN | 2 rot: **konfig** (OMEN-Umgebung), **handbuch-barrierefrei** (war schon vor WP5 rot) |
| konfig allein | Chef-Laptop | 180/0 ✅ |
| Gesamtlauf | Chef-Laptop (Stand ~07:44) | 70 Gruppen, genau 1 rot (handbuch-barrierefrei) |

**konfig-Fehler auf OMEN (Ursache Umgebung, kein Code-Bug):**
1. `... und von einer anderen Adresse des Rechners (100.103.191.x) erreichbar` —
   100.103.191.x ist die Windows-Tailscale-IP (`hp`), von WSL nicht routbar.
2. `Ausdrücklich gesetzter HOST hat Vorrang vor dem production-Standard` —
   Timing- oder Netzwerkproblem der OMEN-WSL-Umgebung.
Env-Prüfung: nur PATH und PWD gesetzt, keine STRIPE/BASE_URL/etc. Shell ist sauber.

---

---

## Nachbesserung 3 (diese Session)

### FUND 1 — logoRouteHandler als Fabrik registriert (Blocker)

**Befund:** `marke.mjs` Zeile 93 hatte `markeRouter.get('/marke/logo.png', logoRouteHandler)`.
`logoRouteHandler` ist seit Nachbesserung 2 eine Fabrik `(logoPfad) => (req, res) => ...`.
Express rief sie mit `(req, res, next)` auf; die Anfrage erhielt nie eine Antwort und hing.

**Behebung:**
- `marke.mjs`: Import und Route entfernt.
- `app.mjs`: `import { logoRouteHandler, machLogoPfad } from './logo-png.mjs'` hinzugefügt;
  `dbDatei = 'daten/lern-app.db'` als Parameter in `erstelleServer`; nach `app.use(markeRouter)`:
  `app.get('/marke/logo.png', logoRouteHandler(machLogoPfad(dbDatei)))`.
- `server.mjs`: `dbDatei: konfig.dbDatei` in `erstelleServer({...})` ergänzt.

**Test L11:** Normalmodus-App via `--normalmodus-server`-Zweig in `selbsttest-assistent-logo.mjs`;
kein Logo → 404 mit Zeitlimit 3 s (Gegenprobe: hängende Anfrage → TIMEOUT → Test rot);
Logo vorhanden → 200 image/png mit allen Sicherheitsheadern.

### FUND 2 — L3-Pfadprüfungen plattformfest

**Befund:** `testPfad.startsWith('/')` und `testPfad.endsWith('/marke/logo.png')` schlugen auf
Windows fehl (Backslash-Pfade, Laufwerksbuchstabe).

**Behebung:** `isAbsolute(testPfad)` (aus `node:path`) und
`testPfad.replace(/\\/g, '/').endsWith('/marke/logo.png')`. Import aktualisiert.

### FUND 3 — pruefePng: PLTE-Farbenanzahl und tRNS

**3a — PLTE Farbenanzahl bei Farbtyp 3:**
Farbanzahl `laenge / 3` muss ≤ `2^bittiefe` sein, sonst `png_plte_laenge_ungueltig`.
`bittiefe` wird jetzt im äußeren Scope geführt (nicht mehr nur in IHDR-Block lokal).
`plteNFarben` merkt die Anzahl für tRNS-Prüfung.

**3b — tRNS:**
Bekannter Ancillary-Chunk; höchstens einmal, vor dem ersten IDAT.
Farbtyp 4 und 6: verboten.
Farbtyp 3: nur nach PLTE; Einträge ≤ Palettenfarben.
Farbtyp 0: genau 2 Byte.
Farbtyp 2: genau 6 Byte.
Fehlercode: `png_trns_ungueltig`.
Bestehender Test `Farbtyp 3 mit PLTE und tRNS angenommen` (1 Farbe, 1 tRNS-Eintrag) bleibt grün.

### Messungen

| Lauf | Wo | Ergebnis |
|---|---|---|
| assistent-logo allein | OMEN | 113/113 ✅ |
| Gesamtlauf (PE_TEST_RAM=1) | OMEN | 2 rot: **konfig** (OMEN-Umgebung), **handbuch-barrierefrei** (war schon vor WP5 rot) |

**konfig-Fehler auf OMEN:** Gleiche Ursache wie bei Nachbesserung 1 — `100.103.191.x`
(Windows-Tailscale-IP `hp`) ist von WSL nicht routbar. Kein Code-Bug.

---

## Nachbesserung 4 (diese Session)

### FUND 3c — PLTE nach tRNS fälschlich angenommen

**Befund:** Im PLTE-Zweig von `pruefePng` fehlte die Prüfung, ob bereits ein tRNS-Chunk
vorkam. Die Reihenfolge IHDR → tRNS → PLTE → IDAT → IEND (z.B. Farbtyp 2, RGB)
wurde angenommen, obwohl tRNS laut PNG-Spezifikation nach PLTE stehen muss.

**Behebung:** In `logo-png.mjs` PLTE-Zweig, vor `plteNFarben = laenge / 3`:
```js
if (hatTrns) return 'png_plte_nach_trns';
```

**Neue Tests in `tools/selbsttest-assistent-logo.mjs`:**
- `pruefePng FUND3c: tRNS vor PLTE abgelehnt (png_plte_nach_trns)` — RGB-PNG mit tRNS vor PLTE → `png_plte_nach_trns`
- `pruefePng FUND3c: Gegenprobe PLTE vor tRNS (Farbtyp 3) angenommen` — Farbtyp 3 mit PLTE vor tRNS → `null`

Gegenprobe ohne Fix: `pruefePng(trnsVorPlte)` liefert `null` → Assertion `=== 'png_plte_nach_trns'` schlägt fehl → Test rot.

### Messungen

| Lauf | Wo | Ergebnis |
|---|---|---|
| assistent-logo allein | OMEN | 115/115 ✅ |
| Gesamtlauf (PE_TEST_RAM=1) | OMEN | 2 rot: **konfig** (OMEN-Umgebung), **handbuch-barrierefrei** (war schon vor WP5 rot) |

**konfig-Fehler auf OMEN:** Gleiche Ursache wie bei Nachbesserungen 1–3 — `100.103.191.x`
(Windows-Tailscale-IP `hp`) ist von WSL nicht routbar. Kein Code-Bug.

---

*WP5 abgeschlossen. Kein WP6 ohne neue Freigabe.*
