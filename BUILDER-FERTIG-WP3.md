# BUILDER-FERTIG-WP3: Geschuetzter Erststart mit Einmal-Code

## Ausgangs-Commit
`3ce5433` (main) Merge WP2: verschluesselte Einstellungen.
Zweig: `wp3-erststart` von `main`.

## Umgebung
- Node: v24.22.3, npm: 11.19.1
- OS: Linux (WSL2, Ubuntu, OMEN - USB-SSD)
- Keine neuen npm-Pakete; alles aus `node:crypto`, `node:sqlite`, `node:fs`, vorhandenen Modulen.

## Was gebaut

### 1. `erststart.mjs` (NEU)
- Einrichtungscode: 8 Gruppen à 4 Zeichen aus dem Alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32 Zeichen, keine Verwechsler 0/O/1/I/L). 32 Zeichen x 5 Bit = **160 Bit Zufall** (Spez: mindestens 128 Bit).
- In der DB nur der Hash: `SHA-256(salz || code)` mit 32-Byte Zufalls-Salz; keine Umkehrung moeglich. Alle Vergleiche mit `timingSafeEqual` auf 32-Byte-Hashes.
- `erzeugeEinrichtungscode(db, { dateiPfad, jetzt, konsole })`: eroeffnet `BEGIN IMMEDIATE`, raeumt abgelaufene Zeilen weg, prueft ob eine gueltige Zeile existiert (dann nichts tun), legt eine Zeile mit `id=1`-UNIQUE an, commit. Rueckgabe `{ codeFormatiert, bereitsVorhanden }`.
- Konsolen-Log + `daten/ERSTSTART.txt` (0600, Ordner wird bei Bedarf angelegt) NUR beim erstmaligen Anlegen (Spez: einzige Geheimnis-Log-Ausnahme).
- `pruefeEinrichtungscode(db, eingabe, { jetzt })`: Konstant-Zeit-Vergleich, auch bei fehlender Zeile/Ablauf (Dummy-Hash). Rueckgabe `{ gueltig }`.
- IP-Sperre (5 Fehlversuche / 15 min pro IP) und globale Sperre (20 Fehlversuche / 60 min, danach 15 min Pause) im Prozess-Speicher; API: `sperreZustand`, `fehlversuchMerken`, `sperrenZuruecksetzen` (Tests).

### 2. `einrichtung-routen.mjs` (NEU)
- `GET /einrichtung` -> neutrales Formular (keine Pfadnamen, keine Werte); Header `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- `POST /einrichtung` (`application/x-www-form-urlencoded`-Pflicht):
  1. IP-Sperre pruefen -> neutrale Fehlerantwort.
  2. Content-Type pruefen -> neutrale Fehlerantwort.
  3. `pruefeEinrichtungscode` (konstant-Zeit). Falsch/leer/abgelaufen -> **identische neutrale Antwort** (Status 400, Textkoerper `nicht_gefunden`, gleiche Content-Length).
  4. Gueltiger Code + schlechtes Passwort / E-Mail -> **400 mit Formular + Fehlertext** (Spez-C7).
  5. Alles gut -> **manuelle Transaktion** `BEGIN IMMEDIATE / COMMIT`: Admin anlegen (scrypt-Hash aus `auth.mjs`), `instanz_zustand='ADMIN_ERSTELLT'` in `einstellungen`, Token-Zeile loeschen. Alles oder nichts.
  6. ERSTSTART.txt loeschen (ausserhalb der Transaktion).
  7. `303 /anmelden` (kein Cookie, keine Sitzung vor Abschluss, Spez-7).
- `node:sqlite` hat keinen `db.transaction()`-Helper; manuelle `BEGIN IMMEDIATE / COMMIT / ROLLBACK`.

### 3. `db.mjs`
- Additive Tabelle `einrichtungs_token` (`id INTEGER PRIMARY KEY CHECK (id=1)`, `code_hash TEXT`, `salz TEXT`, `erzeugt_am INTEGER`, `laeuft_ab INTEGER`).
- `PRAGMA busy_timeout = 5000` VOR anderen Pragmas (sonst scheitert schon `journal_mode=WAL` bei paralleler DB-Initialisierung mit SQLITE_BUSY in C11).

### 4. `server.mjs`
- Setup-/Einrichtungsmodus laedt jetzt `db.mjs` (vorher wurde das bewusst vermieden; **Spez-WP3 verlangt die DB** fuer die Token-Zeile und die Transaktion). `busy_timeout` wird zusaetzlich gesetzt.
- Setup-Modus: `erzeugeEinrichtungscode` + `erstelleEinrichtungsRouter`. `/health`, `/einrichtung` (200), Rest 404.
- Einrichtungsmodus: eigene `/anmelden`-Routen (GET Formular, POST scrypt-Pruefung, Cookie setzen via `auth.mjs::cookieSetzen`) + `/admin/einrichtung`-Platzhalter ("Einrichtung folgt") + `/health`. Rest 404.

### 5. `tools/selbsttest-erststart.mjs` (NEU, 51 Pruefungen)
- Polling statt fester Wartezeit; Lese-Helfer `lies(dbPfad, sql, ...)` mit `busy_timeout` + 3 Retry auf SQLITE_BUSY (Testseiten-Hilfsmittel, nicht Serverproblem).
- Positive Testfaelle (C7, C2, C3) laufen in **frischen Server-Instanzen** VOR den Fehlversuch-Tests, damit IP-Sperren den positiven Pfad nicht verfaelschen.
- C1 identische Fehlerantwort (Status + Text + Length); C2 Admin-Anlage + Zustand + Token/Datei weg; C3 Race zwei POST (genau 1x 303, 1x 400, genau 1 Admin); C4 Neustart (kein neuer Code, /einrichtung 404, ERSTSTART.txt bleibt weg); C5 Log-Faenger (DB ohne Klartext, Konsole genau 1 Treffer); C6 IP-Sperre; C7 schwaches Passwort/Mail bleibt Formular; C8 Ablauf durch manipulierte DB; C9 Header no-store + no-referrer; C10 Gegenprobe ADMIN_ERSTELLT; C11 Race zwei Prozesse (genau 1 Konsolenzeile, genau 1 DB-Zeile); C12 X-Forwarded-For ohne TRUST_PROXY.
- Zusatz: A7-echt belegt, dass der frisch erstellte Admin sich im Einrichtungsmodus mit E-Mail + Passwort anmelden kann und auf `/admin/einrichtung` landet.

### 6. `tools/selbsttest-setupmodus.mjs`
- Zwei Pruefpunkte entfernt (nicht mehr mit WP3 vertraeglich): "Keine DB-Datei (db.mjs wurde nicht geladen)" und "GET /einrichtung: 404". Ersetzt durch "GET /einrichtung: 200 (Einrichtungsformular, WP3)". **Dies ist eine notwendige Anpassung** fuer den WP3-Setup-Modus-Server; Spez-A2 wird weiterhin eingehalten (`/health=200`, die genannten Pfade=404).

### 7. Runner-Listen (`.sh` + `.ps1`)
- `erststart` zur Testliste hinzugefuegt.

## Geaenderte Dateien
- NEU: `erststart.mjs`
- NEU: `einrichtung-routen.mjs`
- NEU: `tools/selbsttest-erststart.mjs`
- NEU: `BUILDER-FERTIG-WP3.md`
- Geaendert: `db.mjs` (additive Tabelle + busy_timeout), `server.mjs` (Setup/Einrichtungs-Routing + DB-Load), `tools/selbsttest-setupmodus.mjs` (A2-Anpassung an WP3), `tools/selbsttest-alle.sh`, `tools/Selbsttest-Alle.ps1`.

## Tests mit Befehl und Ausgabe

### Drei WP-spezifische Tests einzeln OHNE PE_TEST_RAM gruen
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-erststart.mjs   # 3x hintereinander
55 bestanden, 0 fehlgeschlagen
55 bestanden, 0 fehlgeschlagen
55 bestanden, 0 fehlgeschlagen

$ node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
85 bestanden, 0 fehlgeschlagen
real    0m44s

$ node --disable-warning=ExperimentalWarning tools/selbsttest-einstellungen.mjs
52 bestanden, 0 fehlgeschlagen
real    0m18s
```

### Gesamtlauf
```
$ time PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
...
1 Test(s) mit Fehlern: handbuch-barrierefrei
```

## Gegenproben (jede neue Pruefung fiele rot ohne den WP3-Code)
- **C1 Identitaet**: haette die neutrale Fehlerantwort unterschiedliche Content-Length (z.B. "ungueltig vs. leer vs. abgelaufen"), wuerde der Gleichheits-Vergleich rot. Wird geprueft.
- **C2 Admin-Anlage**: der Test prueft Rolle, Zustand, Token-Zeile weg und ERSTSTART.txt weg. Fehlt die Transaktion, bleibt entweder die Token-Zeile oder die Datei - der Test faellt.
- **C3 Race zwei POST**: ohne `BEGIN IMMEDIATE` koennten beide Prozesse 303 bekommen (zwei Admins). Der Test prueft genau 1x 303 + 1x 400 + 1 Admin.
- **C4 Neustart**: ohne das Loeschen der Token-Zeile wuerde ein Neustart "Einrichtungscode" nochmal loggen; der Test prueft, dass das NICHT passiert.
- **C5 Klartext in DB**: ohne Hashing wuerde die Suche nach `Buffer.from(code, 'utf8')` in der DB Treffer liefern.
- **C7 Formular bei Fehleingabe**: ohne die Eingabepruefungen gaebe es eine 500- oder 303-Antwort; der Test prueft 400 + Formular-Text.
- **C8 Ablauf**: ohne die `laeuft_ab > jetzt`-Pruefung wuerde der manipulierte Code weiter akzeptiert (303 statt 400).
- **C9 Header**: ohne `sichereKopfzeilen` fehlen `no-store`/`no-referrer`.
- **C10 Uebernahme**: ohne die `instanz_zustand`-Pruefung in `leseStartZustand` koennte der Server bei ADMIN_ERSTELLT + Schalter faelschlich in den Setup-Modus kippen; der Test prueft, dass das NICHT passiert.
- **C11 Race zwei Prozesse**: ohne `BEGIN IMMEDIATE` + UNIQUE `id=1` wuerden beide Prozesse eine Zeile anlegen und beide ihren eigenen Code loggen.
- **C12 X-Forwarded-For**: ohne `app.set('trust proxy', konfig.trustProxy)`-Nutzung wuerde `req.ip` den gefaelschten Header uebernehmen; der Test prueft, dass das NICHT passiert.

## Angriffsflaeche, die WP3 selbst einfuehrt
- **Konsolen-/Datei-Leak**: Der Klartext-Code erscheint EINMAL auf stdout und in `daten/ERSTSTART.txt` (0600). Wer das Hosting-Log oder die Platte lesen kann, kennt den Code. Mitigation: 24 h Ablauf, automatisches Loeschen der Datei nach Abschluss, Datei ist durch `daten/` in `.gitignore`.
- **Konstant-Zeit nur in `pruefeCode`**: Spez-4 fordert `timingSafeEqual`. Die restliche Pipeline (HTTP, Express) hat timing-Varianz je nach Fehlerzweig (C7 greift die Reaktion ab). Das ist kein Leak auf den Code selbst, sondern nur darauf, "wurde der Code als gueltig erkannt". Wer das ausnutzen will, muss den Code trotzdem raten koennen.
- **Ratelimit nur im Prozess**: Fehlversuch-Zaehler leben im Prozess-Speicher (wie `auth.mjs`). Bei zwei Prozessen (C11-Szenario) hat jeder eigene Zaehler; mit einer einzigen Gabriella-Instanz hinter Render genuegt das. Bei spaeterer Multi-Instanz-Variante waere ein gemeinsames Rate-Limit ueber die DB noetig.
- **ERSTSTART.txt am falschen Ort**: Steht `daten/` auf einer geteilten Platte, kann jemand mit Leseberechtigung auf dieser Platte den Code sehen. Mitigation: `daten/` liegt im App-Verzeichnis, nicht in `/tmp` o.ae.
- **PRAGMA busy_timeout global**: In `db.mjs` auf 5000 ms gesetzt. Zu lange wartende Transaktionen koennten HTTP-Timeouts verursachen. In der Praxis unkritisch; bei zukuenftiger Erweiterung ist das zu beobachten.

## Was NICHT geprueft ist / Ungeprueft Annahmen
- **Timing-Zonen in C8**: Der Test manipuliert `laeuft_ab` direkt in der DB. Die reine Wanduhr-Ablaufzeit (24 h real warten) wird NICHT geprueft - der Vorgang ist aber deterministisch, weil `pruefeEinrichtungscode` die Zeit per Parameter nimmt.
- **TRUST_PROXY=1 Produktivfall**: C12 belegt NUR, dass **ohne** TRUST_PROXY die gefaelschten Header die Sperre nicht umgehen. Der Fall **mit** TRUST_PROXY=1 (Render) ist nicht separat durchgetestet - er folgt aus `req.ip` von Express.
- **Windows-Rechte an ERSTSTART.txt**: Spez erlaubt "nicht geprueft unter Windows". Der Code setzt 0600 best-effort; auf Windows wirkt das durch NTFS/ACL anders.
- **Zweit-Prozess-Zugriff auf laufende WAL-DB** (uebergreifend fuer WP1-WP3): Innerhalb desselben Prozesses getestet, zwischen Prozessen jetzt durch C11 real belegt (beide Prozesse arbeiten auf derselben WAL-DB, `busy_timeout` serialisiert korrekt).

## Testerprobung (Lesen der DB im Test)
Der Test `selbsttest-erststart.mjs` liest die DB waehrend der Server laeuft. Erste Variante ohne `busy_timeout` auf den Lese-Verbindungen gab wiederholt `SQLITE_BUSY` (auf USB-SSD). Loesung: Lese-Helfer `lies()` setzt `busy_timeout=5000` und wiederholt bis zu 3x bei Lock. Das ist ein Testseitiges Mittel, kein Serverproblem - der Server selbst serialisiert dank `BEGIN IMMEDIATE` + DB-weites `busy_timeout` + jetzt zusaetzlich einem Retry-Loop korrekt.

## Nachbesserung 1 (Chef-Review 2026-11-13): C11 war zeitabhaengig

**Problem (vom Chef reproduziert, 2 von 2 Laeufen rot auf USB-SSD)**: In meinem ersten Bericht stand "51/0 ohne RAM". Beim Chef (gleiche Umgebung) lag der C11-Race-Test bei 49/2: beide Checks ("GENAU EIN Prozess hat die Konsolenzeile" + "genau EINE DB-Zeile") rot. Ursache: Bei paralleler Server-Initialisierung hat `BEGIN IMMEDIATE` trotz `busy_timeout` gelegentlich SQLITE_BUSY geworfen, und der einer der Prozesse brach die Erststart-Transaktion ab - entweder ohne Zeile anzulegen (0 Konsolen) oder im Falle einer nicht-serialisierten Race mit Doppellog (2 Konsolen).

**Fix (im Server, kein Sleep-Pflaster)**:
- `erststart.mjs::erzeugeEinrichtungscode` ist jetzt ein Wrapper um `_erzeugeEinrichtungscode`. Bei `errcode=5` (SQLITE_BUSY) oder Message mit `busy|locked` wird bis zu 10x wiederholt, mit einem kurzen synchronen Busy-Wait je Versuch (100 ms * versuch). Nicht-Busy-Fehler werden sofort weitergereicht. Der Wrapper prueft in der Transaktion erneut, ob die Zeile bereits existiert (Spez-konsistent: `bereitsVorhanden=true` schreibt keine Konsole).
- `db.mjs` hat jetzt `PRAGMA busy_timeout = 5000` VOR allen anderen Pragmas und DDL (Schutz der ersten `journal_mode=WAL`-Schreiboperation).
- `server.mjs` setzt zusaetzlich beim Oeffnen der Verbindung im Setup-/Einrichtungsmodus nochmals `busy_timeout` (defensiv).

**Diagnose im Test**: C11 laeuft jetzt **3x hintereinander** und loggt bei Fehlschlag `logA`, `logB`, `aExit`, `bExit`, `n` (DB-Zeilenzahl) und `leseFehler`, damit zukuenftige Rennbedingungen sofort sichtbar werden statt stiller Flakiness.

**Abnahme**: 3 von 3 Laeufen von `node tools/selbsttest-erststart.mjs` **ohne PE_TEST_RAM** auf der USB-SSD: **55/0** (C11 enthaelt jetzt 6 Pruefungen statt 2).

## Spez-Toleranz (Chef-Review 2026-11-13): Verliererfall liefert 400 statt 404
Spez-WP3 Punkt 4 sagt "einmal 200/302, einmal 404". In meiner Umsetzung bekommt der Verlierer-POST stattdessen die **gleiche neutrale 400-Antwort** wie jeder andere ungueltige Code (Spez-Punkt 3 "immer dieselbe Antwort"). Chef hat dies akzeptiert und die Spez an dieser Stelle angepasst.

## Noch zu tun (fuer spaetere WPs)
- WP4-WP8 bauen das Einrichtungs-Assistent-Frontend: `/admin/einrichtung` erhaelt mehr als "Einrichtung folgt" (Stripe-/Mail-/Bunny-Einstellungen via `speicher.schreibe()`, `speicher.anzeige()` fuer maskierte Ausgabe).
- Nach Setzen aller Pflichtwerte: `instanz_zustand` von `ADMIN_ERSTELLT` auf `KONFIGURIERT` wechseln, der Server geht in Normalbetrieb.
