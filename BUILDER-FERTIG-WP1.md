# BUILDER-FERTIG-WP1: Setup-Modus statt Abbruch (Konfig-Entkopplung)

## Ausgangs-Commit
`6a3de26` (main) Spezifikation WP1-3 Sicherheitsblock (ChatGPT Runde 100 eingearbeitet).
Zweig: `wp1-setup-modus` von `main`.

## Umgebung
- Node: v24.22.3, npm: 11.19.1
- OS: Linux (WSL2, Ubuntu, OMEN - WSL-Platte auf USB-SSD J:)
- Keine neuen npm-Pakete (unveraendert: nur `express` 5.1.0 und `stripe` 18.1.0)

## Entscheidung R1 = Variante D (Chef, 2026-11-13)
Der UNINITIALISIERT-Setup-Modus startet NUR, wenn die Umgebungsvariable `EINRICHTUNGSMODUS=1` gesetzt ist UND beide Stripe-Variablen fehlen UND kein Admin in der Datenbank steht. Ohne den Schalter bleibt das Verhalten bei fehlenden Variablen EXAKT wie bisher (Exit 1). Der Einrichtungsmodus (`ADMIN_ERSTELLT`) laeuft ohne den Schalter weiter, sonst waere eine Instanz, die ihre Stripe-Konfiguration verloren hat, eine Sackgasse. In `KONFIGURIERT`/`AKTIV` bleibt der Abbruch wie bisher, auch mit dem Schalter (Schutz gegen Uebernahme einer fertigen Instanz).

## Was gebaut (nach Variante D)
1. `db.mjs`: additive Tabelle `einstellungen` (`schluessel` TEXT PRIMARY KEY, `wert`, `verschluesselt` INTEGER DEFAULT 0, `iv`, `tag`, `aktualisiert_am`). Schon im WP2-konformen Schema. **WP2 baut darauf auf**: dort werden Geheimnis-Werte mit AES-256-GCM verschluesselt, iv/tag werden gesetzt, `verschluesselt=1`.
2. `konfig.mjs`:
   - Neue Export-Funktion `leseStartZustand(dbDatei)`: liest `einstellungen.instanz_zustand` im `readOnly`-Modus; Fallback ueber `benutzer.rolle='admin'`; fail-safe `UNINITIALISIERT` bei fehlender/kaputter DB.
   - `ladeKonfig(env, optionen)`: neue Option `optionen.startZustand`. Fehlt sie, bleibt alles wie bisher (Rueckwaertskompatibilitaet).
   - Modusentscheidung (Variante D):
     - `beideStripeFehlen` + `ADMIN_ERSTELLT` -> Modus `einrichtung` (ohne Schalter).
     - `beideStripeFehlen` + `UNINITIALISIERT` + `EINRICHTUNGSMODUS=1` -> Modus `setup`.
     - Sonst (inkl. `UNINITIALISIERT` ohne Schalter): Pfad wie bisher, Fehler werden geworfen.
   - `sk_live_` oder halb gesetzte Variablen fuehren weiter zum Abbruch, in jedem Modus.
   - Rueckgabe im Setup-/Einrichtungsmodus: nur netzrelevante Felder (`modus`, `nodeEnv`, `produktion`, `port`, `host`, `baseUrl`, `secureCookies`, `dbDatei`, `trustProxy`, `warnungen`). Rueckgabe im Normalmodus enthaelt zusaetzlich `modus:'normal'`.
3. `server.mjs`: vor `ladeKonfig` wird `leseStartZustand(dbDatei)` aufgerufen. Bei `konfig.modus === 'setup' || 'einrichtung'` startet ein **minimaler Express-Server**:
   - `GET /health` -> `200 {"modus":"setup"|"einrichtung"}`, `Cache-Control: no-store`.
   - Alles andere -> `404 text/plain nicht_gefunden` (kein Pfadname, keine Version, kein Stacktrace, keine Produktbezeichnung).
   - Kein Stripe-Client, kein Shop, kein Webhook, kein Mail/Bunny/Plattform-Meldung-Timer. Weder `app.mjs` noch `db.mjs` werden geladen; keine DB-Datei wird angelegt.
   - `app.disable('x-powered-by')`, `trust proxy` nur bei `konfig.trustProxy>0`, gleiche SIGTERM/`unhandledRejection`-Handler wie der normale Pfad.
4. `tools/selbsttest-setupmodus.mjs` (NEU, 73 Pruefungen): Matrix nach Variante D, A1-A4, A6, A7 plus `leseStartZustand`-Rundlauf, HTTP-Verhalten im Setup- und Einrichtungsmodus, Gegenprobe "ohne Schalter -> Abbruch", Geheimnis-Leck-Probe mit `WIEDERGABE_GEHEIMNIS`.
5. `tools/selbsttest-alle.sh` und `tools/Selbsttest-Alle.ps1`: `setupmodus` in beide Listen eingetragen (die eingebauten Vollstaendigkeitspruefungen fordern das).
6. `docs/UMGEBUNG.md`: `EINRICHTUNGSMODUS` als optionale Variable dokumentiert (vor `DEMO_MODUS`, damit die Doku-Vollstaendigkeitspruefung in `selbsttest-konfig.mjs` sie findet).
7. `docs/WP1-SETUP-MODUS.md` (NEU): Entscheidungen, Bedrohungsmodell (kurz) und Hinweis auf Variante D.

## Geaenderte Dateien
- `konfig.mjs` (erweitert)
- `server.mjs` (verzweigt bei Setup/Einrichtungsmodus; Normalpfad unveraendert)
- `db.mjs` (additive Tabelle `einstellungen`)
- `docs/UMGEBUNG.md` (neue Variable `EINRICHTUNGSMODUS`)
- `tools/selbsttest-alle.sh` (Testliste: `+ setupmodus`)
- `tools/Selbsttest-Alle.ps1` (Testliste: `+ setupmodus`)
- NEU: `tools/selbsttest-setupmodus.mjs`
- NEU: `docs/WP1-SETUP-MODUS.md`
- NEU: `BUILDER-FERTIG-WP1.md` (dieser Bericht)

## Tests mit Befehl und Ausgabe

### Neuer Selbsttest einzeln
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
...
73 bestanden, 0 fehlgeschlagen
```

### Konfig-Test (weiter unveraendert gruen, der kritische Fall "Ohne jede Variable: Exitcode 1" bleibt gruen, weil der Schalter dort nicht gesetzt wird)
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-konfig.mjs
...
180 bestanden, 0 fehlgeschlagen
```

### Kauf-Test (weiter unveraendert gruen, aus demselben Grund)
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-kauf.mjs
...
156 bestanden, 0 fehlgeschlagen
```

### Gesamtlauf (Chef-Vorgabe: genau 1 rot)
```
$ time PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
...
1 Test(s) mit Fehlern: handbuch-barrierefrei
```
Siehe unten "Gesamtlauf-Protokoll".

## Gegenproben (ohne A1-A7-Bauer waere der Test rot)
- `tools/selbsttest-setupmodus.mjs` enthaelt eine eigene Gegenprobe: "Ohne EINRICHTUNGSMODUS=1 und ohne Stripe: Server bricht ab (bisheriges Verhalten)". Diese Pruefung schlaegt fehl, wenn jemand den Schalter in `konfig.mjs` versehentlich weglaesst oder den Modus ohne Schalter zulaesst. Sie laeuft gruen.
- `ladeKonfig({}, { startZustand: 'UNINITIALISIERT' })` wirft `KonfigFehler` (bewiesen in A6 Zeile 1). Ohne den WP1-Code gab `ladeKonfig({})` genau diesen Fehler; mein Code reproduziert ihn fuer den Fall ohne Schalter 1:1.
- Die Konfig-Teststelle `tools/selbsttest-konfig.mjs:201` "Ohne jede Variable: Exitcode 1, Meldung ohne Werte" bleibt gruen; diese Zeile ist die direkte Gegenprobe zu meinem Schalter-Verhalten (ohne Schalter: Abbruch wie bisher).

## Zu R2 (Einrichtungsmodus, A7 strukturell)
A7 ist in WP1 **strukturell** belegt: der Server startet mit `ADMIN_ERSTELLT`-DB ohne Stripe-Variablen im Einrichtungsmodus, `/health` liefert `{"modus":"einrichtung"}`, `/kurse` ist 404, `/api/anmelden` ist 404 (der echte Login-Endpoint kommt in WP3/WP4, siehe Spez WP3 Punkt 6 "Admin kann sich anmelden und landet im Einrichtungsmodus (leerer Platzhalter `/admin/einrichtung` fuer WP4 bis WP8)"). In WP1 wird die Login-Infrastruktur bewusst nicht in den minimalen Einrichtungsmodus-Server eingehaengt (so bleibt die Angriffsflaeche minimal). Der **echte Login-Test findet in WP3 statt**.

## Zu R3 (einstellungen-Tabelle in WP1)
Bleibt in WP1 mit dem WP2-konformen Schema. Jetzt genutzt: `instanz_zustand`-Schluessel (Klartext, `verschluesselt=0`). **WP2 baut darauf auf**: Verschluesselungsrahmenwerk (AES-256-GCM, iv/tag) und Hauptschluessel-Datei kommen dort dazu. WP2 muss die Tabelle nicht nachtraeglich erweitern.

## Was NICHT geprueft ist / Ungeprueft Annahmen
- **Admin-Login im Einrichtungsmodus**: Siehe R2. In WP1 strukturell, voller Test in WP3.
- **Windows-Verhalten der Rechte**: nicht relevant fuer WP1 (die Hauptschluessel-Datei kommt in WP2).
- **Verhalten unter Last / Reboot-Rennen**: nicht relevant fuer WP1 (Token/Concurrency-Tests kommen in WP3 C3/C11).
- **Angriffsflaeche**: Setup-Modus hat keinen Einmaltoken und keine `/einrichtung`-Routen (das ist WP3). In WP1 ist `/einrichtung` deshalb 404 ohne Hinweis. Das reduziert die Angriffsflaeche aktuell auf `/health`.

## Bedrohungsmodell (kurz)
- Der Schalter `EINRICHTUNGSMODUS=1` liegt in der Verantwortung des Installers/Hosters. Eine fertige Instanz mit `KONFIGURIERT`/`AKTIV` ignoriert ihn (keine Oeffnung durch zufaellig gesetzte Env-Variable).
- 404-Antworten des minimalen Servers nennen keine Pfadnamen, keine Version und keinen Stacktrace. `GET /health` ist der einzige 200-Pfad, mit genau einem Feld `modus`.
- Verschluesselte Werte und Hauptschluessel-Datei kommen in WP2.
- `sk_live_` wird in jedem Modus abgelehnt.

## Gesamtlauf-Protokoll
Der Gesamtlauf-Ergebnistext wird nach dem Lauf in den naechsten Commit-Nachrichten referenziert. Schlusszeilen je Test (Auszug): alle gruen bis auf `handbuch-barrierefrei` (10 Gegenproben rot wegen fehlender Git-Historie, bekannte Ausnahme).

---

## Nachbesserung 1 (Chef, 2026-11-13): Admin-Fallback geaendert zu `AKTIV`

**Problem (Chef-Code-Review):** Der frueher gewaehlte Fallback "Admin vorhanden, aber kein `instanz_zustand` -> `ADMIN_ERSTELLT`" haette Bestandsinstanzen (Gabriellas verkaufte Plattform, Demo, jede bisherige Installation) still in den Einrichtungsmodus kippen lassen, wenn ihnen die Stripe-Variablen fehlen. Das waere ein stiller Ausfall statt des bisherigen fehlgeschlagenen Deploys (Exit 1).

**Aenderung:**
- `konfig.mjs` -> `leseStartZustand`: Admin vorhanden, aber `einstellungen.instanz_zustand` fehlt -> jetzt `AKTIV`. `ADMIN_ERSTELLT` gibt es nur noch, wenn WP3 das ausdruecklich in die Tabelle schreibt.
- `tools/selbsttest-setupmodus.mjs`:
  - Test "DB mit Admin, KEIN instanz_zustand -> AKTIV" (ersetzt frueheren Fallback-Test auf ADMIN_ERSTELLT).
  - Neuer Test "DB mit instanz_zustand=ADMIN_ERSTELLT -> ADMIN_ERSTELLT" (bleibt nur bei explizitem Eintrag).
  - A7 setzt den Zustand jetzt explizit: `dbAnlegen(..., { mitAdmin: true, instanzZustand: 'ADMIN_ERSTELLT' })`.
  - **A8 neu**: DB mit Admin, ohne `instanz_zustand`, ohne Stripe-Variablen; mit UND ohne `EINRICHTUNGSMODUS=1`. Erwartet: Abbruch Exit 1 wie bisher, kein Setup-/Einrichtungsmodus. Belegt die Nachbesserung direkt.

## Nachbesserung 2 (Chef, 2026-11-13): fail-closed bei Lesefehler

**Problem (Chef-Code-Review):** Existiert die DB-Datei, aber das Lesen scheitert (kaputt, gesperrt, WAL nicht lesbar), hat mein frueherer Code "fail-safe" `UNINITIALISIERT` geliefert. Zusammen mit `EINRICHTUNGSMODUS=1` wuerde der Server dann den Setup-Modus oeffnen - obwohl die DB nicht lesbar ist. Richtige Entscheidung: fail-closed.

**Aenderung:**
- `konfig.mjs` -> `leseStartZustand`: beim Scheitern von `new DatabaseSync(dbDatei, { readOnly: true })` oder einer der `prepare`/`get`-Aufrufe wird jetzt `KonfigFehler(['Datenbank vorhanden, Zustand nicht lesbar (WP1 Sicherheitsblock, fail-closed).'])` geworfen. `UNINITIALISIERT` nur noch bei fehlender Datei oder lesbarer leerer DB.
- `server.mjs`: `leseStartZustand(dbDatei)` liegt jetzt im selben `try`-Block wie `ladeKonfig`. Der vorhandene `KonfigFehler`-Handler druckt die Meldung ohne Werte und beendet mit Exit 1.
- `tools/selbsttest-setupmodus.mjs`:
  - Frueherer Test "Nicht-SQLite-Datei -> UNINITIALISIERT (fail-safe)" ersetzt durch "Kaputte DB-Datei -> KonfigFehler (fail-closed, nicht UNINITIALISIERT)" + "Kaputt-Fehler enthaelt klare Meldung ohne Werte" (MARKE in der Datei; MARKE darf nicht in der Fehlermeldung landen).
  - **A9 neu**: Kaputte DB-Datei + `EINRICHTUNGSMODUS=1` -> Prozess bricht mit Exit 1 ab, Meldung "Datenbank vorhanden, Zustand nicht lesbar" steht im Log, kein "Setup-Modus" im Log, Datei-Inhalt (MARKE) nicht im Log.

## WAL-DB real geprueft (Chef-Vorgabe zu Nachbesserung 2)

Abschnitt "WAL-DB real pruefen" in `tools/selbsttest-setupmodus.mjs` legt eine DB mit `PRAGMA journal_mode=WAL` an, schreibt einen Admin-Eintrag und haelt die Verbindung **offen**. Die Dateien `*-wal` und `*-shm` sind real vorhanden; `leseStartZustand` oeffnet mit `new DatabaseSync(dbDatei, { readOnly: true })` und liest erfolgreich. Ergebnis: **readOnly-Zugriff auf eine WAL-DB funktioniert waehrend einer aktiven Live-Verbindung**. In unserem Fall sieht der readOnly-Leser den gleichen Stand wie die Live-Verbindung (kein "Zustand nicht lesbar"-Fehler). Zwei Pruefungen belegen das:
```
OK     WAL-Datei vorhanden (-wal existiert)
OK     Shared-Memory-Datei vorhanden (-shm existiert)
OK     readOnly-Zugriff auf WAL-DB waehrend live-Verbindung: liefert Zustand ohne Fehler
OK     WAL-DB mit Admin ohne instanz_zustand -> AKTIV
```

**Einschraenkung**: Diese Pruefung laeuft im selben Node-Prozess (gleicher SQLite-Prozess-Kontext). Zwei VERSCHIEDENE Prozesse auf derselben WAL-DB sind nicht geprueft; das betrifft den WP1-Setup-Modus aber nicht, weil im Setup-Modus `db.mjs` nicht geladen wird und keine zweite Verbindung existiert. In WP2/WP3 sollte ein reiner Zweit-Prozess-Test ergaenzt werden.

## Gesamtlauf nach Nachbesserungen
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
...
87 bestanden, 0 fehlgeschlagen
```
```
$ time PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
...
1 Test(s) mit Fehlern: handbuch-barrierefrei
```
