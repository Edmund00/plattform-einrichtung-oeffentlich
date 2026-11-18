# BUILDER-FERTIG-WP2: Verschluesselter Einstellungsspeicher

## Ausgangs-Commit
`ed876d0` (main) Merge WP1: Setup- und Einrichtungsmodus.
Zweig: `wp2-einstellungen` von `main`.

## Umgebung
- Node: v24.22.3, npm: 11.19.1
- OS: Linux (WSL2, Ubuntu, OMEN - WSL-Platte auf USB-SSD J:)
- Keine neuen npm-Pakete (unveraendert: `express` 5.1.0, `stripe` 18.1.0). Alles aus `node:crypto`, `node:sqlite`, `node:fs`.

## Entscheidung Lazy-Opening (Chef-Review 2026-11-13)
Der Einstellungsspeicher wird in `server.mjs` NUR geoeffnet, wenn in der Tabelle `einstellungen` mindestens eine Zeile ausser `instanz_zustand` existiert (`hatGespeicherteEinstellungen(dbDatei)` per Read-only-Zugriff, OHNE `db.mjs` zu laden). Ohne gespeicherte Einstellungen bleibt der Server bit-gleich wie vor WP2 (Bestandsinstanzen Render/Demo/Gabriella); es wird kein `daten/.hauptschluessel` angelegt. `holeHauptschluessel` legt beim Lesen NIE eine neue Datei an; das uebernimmt in WP3+ die explizite Funktion `erzeugeHauptschluesselDatei` beim ersten Schreiben eines Geheimnisses.

## Was gebaut
1. `einstellungen.mjs` (NEU):
   - `GEHEIMNISFELDER`: Liste der verschluesselt zu speichernden Schluessel.
   - `holeHauptschluessel({ env, dateiPfad, verschluesselteWerteVorhanden })`: liefert Buffer(32) oder wirft `KonfigFehler`. Bei leerem env, fehlender Datei UND keinen verschluesselten Werten -> `null` (kein Fehler, keine Seiteneffekte).
   - `erzeugeHauptschluesselDatei(dateiPfad)`: legt EINMALIG 32 Zufallsbytes in die Datei (0600). Wirft, wenn die Datei bereits existiert.
   - `verschluesseleGeheimnis(wert, hs)` / `entschluesseleGeheimnis({chiffre,iv,tag}, hs)`: AES-256-GCM, IV 12 Byte zufaellig, Tag 16 Byte.
   - `maskiereGeheimnis(wert)`: `sk_test_••••abcd` (Praefix + 4 Bullets + letzte 4 Zeichen).
   - `hatGespeicherteEinstellungen(dbDatei)`: Read-only-Pruefung ob Zeilen ausser `instanz_zustand` existieren.
   - `verschluesselteWerteVorhanden(db)`: Pruefung auf `verschluesselt=1`-Zeilen.
   - `oeffneEinstellungsSpeicher(db, {hauptschluessel})`: liefert `{ lese, schreibe, lade, anzeige }` mit Cache.
2. `konfig.mjs`:
   - `ladeKonfig(env, optionen)` nimmt zusaetzlich `optionen.speicher`.
   - Neue `wert(name)`-Logik: `env[name] != leer` > `speicher.lese(name)` != leer > `''`. Alle Formatpruefungen unveraendert.
3. `server.mjs`: Lazy-Oeffnen des Speichers. `db.mjs` wird nur dann frueh geladen, wenn tatsaechlich Einstellungen vorhanden sind. Fehlt der Hauptschluessel bei vorhandenen Einstellungen: `KonfigFehler` + Exit 1.
4. `tools/selbsttest-einstellungen.mjs` (NEU, 38 Pruefungen): B1 bis B9 nach Spez + B10 (Chef-Nachbesserung Bit-Gleichheit) + Integritaetscheck (einstellungen.mjs liest `process.env` nicht).
5. `tools/selbsttest-alle.sh` und `tools/Selbsttest-Alle.ps1`: `einstellungen` in beide Listen eingetragen.
6. `docs/UMGEBUNG.md`: `EINSTELLUNGEN_SCHLUESSEL` als optionale Variable dokumentiert.
7. `docs/WP2-EINSTELLUNGEN.md` (NEU): Entscheidungen, Bedrohungsmodell, Wiederherstellung, B8-Empfehlung.

## Geaenderte Dateien
- NEU: `einstellungen.mjs`
- NEU: `tools/selbsttest-einstellungen.mjs`
- NEU: `docs/WP2-EINSTELLUNGEN.md`
- NEU: `BUILDER-FERTIG-WP2.md` (dieser Bericht)
- Geaendert: `konfig.mjs`, `server.mjs`, `docs/UMGEBUNG.md`, `tools/selbsttest-alle.sh`, `tools/Selbsttest-Alle.ps1`

## Tests mit Befehl und Ausgabe

### Einstellungen-Test einzeln
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-einstellungen.mjs
...
38 bestanden, 0 fehlgeschlagen
```

Abdeckung:
- **B1** Rundlauf: schreiben/lesen gleich; DB-Datei enthaelt KEIN Klartext-Geheimnis und auch nicht die Teil-MARKE; Hauptschluessel-Datei enthaelt die MARKE nicht.
- **B2** Zwei Schreibvorgaenge desselben Wertes -> unterschiedliche IV und Chiffre (bewiesen in der DB).
- **B3** Manipulierter Chiffretext ODER manipulierter Tag -> `KonfigFehler`; Fehlermeldung enthaelt weder MARKE noch Klartext.
- **B4** Fehlender Hauptschluessel bei verschluesselten Werten -> `KonfigFehler` mit "Hauptschluessel fehlt", KEINE neue Datei angelegt.
- **B5** Linux: Rechte der frisch erzeugten Hauptschluessel-Datei sind `600`. Auf Windows wird der Test uebersprungen und ausdruecklich als "nicht geprueft" vermerkt.
- **B6** Vorrang: env schlaegt Speicher; ohne env liefert Speicher; ohne beides bleibt `KonfigFehler` wie vor WP2.
- **B7** Maskierung: `maskiereGeheimnis` liefert hoechstens die letzten 4 Zeichen + bekanntes Praefix; `anzeige(name)` liefert `{gesetzt, maskiert}` fuer Geheimnisse und `{gesetzt, wert}` fuer Klartextfelder; Log-Faenger sieht das Geheimnis nicht.
- **B9** Wiederherstellung: Backup (DB + Schluesseldatei) auf frische Instanz einspielen -> Wert lesbar; nur DB ohne Schluesseldatei -> klarer Fehler, keine stille Neuerzeugung.
- **B10** (Chef-Nachbesserung) Bestandsinstanz mit Umgebungsvariablen und ohne gespeicherte Einstellungen bleibt bit-gleich: `hatGespeicherteEinstellungen=false`, Server startet im Normalbetrieb, `.hauptschluessel` wird NICHT angelegt, keine verschluesselten Werte in der DB.
- Integritaetscheck: `einstellungen.mjs` beruehrt `process.env` nicht (konsistent mit dem Konfig-Test "Nur konfig.mjs, db.mjs, server.mjs und texte.mjs ...").

### WP1-Tests bleiben unveraendert gruen
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-konfig.mjs
...
180 bestanden, 0 fehlgeschlagen
$ node --disable-warning=ExperimentalWarning tools/selbsttest-kauf.mjs
...
156 bestanden, 0 fehlgeschlagen
$ TMPDIR=/dev/shm node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
...
87 bestanden, 0 fehlgeschlagen
```

### Gesamtlauf
```
$ time PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
...
1 Test(s) mit Fehlern: handbuch-barrierefrei
```
(Schlusszeile wird nach dem Hintergrundlauf unten erfasst.)

## Gegenproben
- **Gegenprobe zu B1 Klartext-in-DB**: Falls Verschluesselung fehlerhaft waere (z.B. Klartext in `wert` statt Base64-Chiffre), wuerde `readFileSync(dbDatei).includes(Buffer.from(GEHEIM, 'utf8'))` true liefern. Der Test findet das; grossbuchstabige MARKE wuerde ebenfalls durchrutschen.
- **Gegenprobe zu B2 IV-Varianz**: Zwei identische Schreibvorgaenge mit festem IV wuerden identische Chiffre liefern; der Test wird rot.
- **Gegenprobe zu B4 keine stille Neuerzeugung**: Haette `holeHauptschluessel` beim Lesen eine Datei angelegt, wuerde `existsSync(schlPfad)` nach dem Aufruf true liefern -> rot. (Genau das war ein Chef-Review-Punkt und ist jetzt gefixt.)
- **Gegenprobe zu B6 Vorrang**: Haette `ladeKonfig` den Speicher trotz gesetzter env bevorzugt, lieferte `k.stripeSecretKey` den Speicher-Wert statt des env-Wertes.
- **Gegenprobe zu B10 Bit-Gleichheit**: Bei nicht-lazy Oeffnung (frueherer Stand) wurde `daten/.hauptschluessel` schon beim Server-Start angelegt; der Test findet das.

## Was NICHT geprueft ist / Ungeprueft Annahmen
- **Zwei Prozesse auf derselben WAL-DB**: Wie in WP1 nur innerhalb eines Node-Prozesses getestet. In WP2 greift derselbe Umstand. Im Normalbetrieb oeffnet nur `server.mjs` die DB; der Setup-/Einrichtungsmodus-Minimalserver und das `leseStartZustand`/`hatGespeicherteEinstellungen`-Paar laufen sequenziell.
- **Rotation des Hauptschluessels**: Noch nicht implementiert. Wird spaeter zur Routine gehoeren (Werte entschluesseln, mit neuem Schluessel wieder schreiben, Datei austauschen).
- **Zugriffsrechte unter Windows**: B5 wird dort uebersprungen (Spez-konform).
- **Durchgehender `anzeige`-API-Endpunkt**: WP2 stellt die Funktion bereit (`speicher.anzeige(name)`), aber bindet sie noch nicht an eine Route. Die Route gehoert in WP3/WP4 (Einrichtungs-Assistent).

## Eigene Angriffsflaeche (was WP2 selbst einfuehrt)
- Die Datei `daten/.hauptschluessel` ist das ganze Geheimnis. Wer sie liest, kann alle verschluesselten Werte entschluesseln. Daher: Rechte 0600 beim Anlegen; Spez-Empfehlung ist zusaetzlich `EINSTELLUNGEN_SCHLUESSEL` im Hoster-Secret-Store (getrennt von der Platte).
- Die `einstellungen`-Tabelle enthaelt die Chiffre und das Tag. Ohne Hauptschluessel liefern diese keine Klartexte, aber sie verraten Laenge und Anzahl der Geheimnisse (Metadaten-Leak, unvermeidlich).
- Beim ersten Setup-Schritt in WP3/WP4 wird die Hauptschluessel-Datei einmalig erzeugt. Sie darf NIE per Backup zusammen mit der DB in die gleiche Cloud-Bucket wandern (siehe B8-Empfehlung).

## Entscheidung zu B8 (Sicherung)
**Empfehlung des Bauers**: `.hauptschluessel` wird NICHT in die automatische Sicherung aufgenommen. Die Sicherung nutzt `SICHERUNG_SCHLUESSEL` und verschluesselt nur die DB. Der Hauptschluessel wird manuell + separat aufbewahrt (Passwortmanager oder Hoster-Secret-Store). Begruendung:
- Wird das Backup entwendet und enthaelt beides, ist der ganze Schutz hinfaellig (einzige notwendige Information lesbar).
- Trennung Schluessel/DB = Standardpraxis fuer verschluesselte Datenspeicher.
- Falls der Hauptschluessel verloren geht, sind die verschluesselten Werte zwar nicht wiederherstellbar - das ist die konservative Variante (Chef entscheidet). Alternative: Hauptschluessel per separatem Pfad mitsichern (z.B. zusaetzliches Backup in einem anderen Hoster), aber diese Entscheidung sollte der Chef treffen.

## Noch zu tun (fuer spaetere WPs)
- WP3 nutzt `erzeugeHauptschluesselDatei` beim ersten Setup-Abschluss (zusammen mit dem ersten Admin-Konto und dem ersten Geheimnis-Schreibvorgang).
- WP4+ (Einrichtungs-Assistent) nutzt `speicher.schreibe()` fuer Stripe-/Mail-/Bunny-Werte und `speicher.anzeige()` fuer die externe Darstellung.

---

## Nachbesserung 1 (Chef-Review 2026-11-13): Polling statt fester Wartezeit

**Problem**: B10 lief gruen mit `TMPDIR=/dev/shm`, aber rot auf der USB-Platte (feste `warte(100)*60` reichte nicht fuer die DB-Migration/WAL-Sync-Phase).
**Fix**:
- `tools/selbsttest-einstellungen.mjs` B10: Polling (bis 30 s, 200 ms Takt) auf `/läuft:/`-Zeile im Log ODER `GET /health` erreichbar ODER Prozess beendet. Danach SIGTERM mit weichem Exit-Wait.
- `tools/selbsttest-setupmodus.mjs` `starteServer`: gleiches Polling, inkl. `/health`-Probe.
- Drei Abbruch-Pruefungen (A8 beide Varianten, A9) nutzen weiterhin das Exit-Warten, aber mit 30 s statt 8 s (reserve fuer langsame Platten).

**Abnahme (beide Tests EINZELN ohne RAM-Option)**:
```
$ node --disable-warning=ExperimentalWarning tools/selbsttest-einstellungen.mjs
52 bestanden, 0 fehlgeschlagen
real    0m20.180s

$ node --disable-warning=ExperimentalWarning tools/selbsttest-setupmodus.mjs
87 bestanden, 0 fehlgeschlagen
real    0m10.040s
```

## Nachbesserung 2 (Chef-Review): Downgrade-Schutz beim Lesen

**Problem**: Ein Angreifer koennte die DB direkt modifizieren und ein Geheimnisfeld mit `verschluesselt=0` einschleusen (Klartext). `lade()` haette es stillschweigend angenommen.
**Fix**: In `einstellungen.mjs::lade()`: fuer jede Zeile, deren `schluessel` in `GEHEIMNISFELDER` steht, MUSS `verschluesselt===1` sein, sonst `KonfigFehler('"<name>": Geheimnis nicht verschluesselt gespeichert.')`.
**Test**: B11 — Geheimnisfeld mit `verschluesselt=0` direkt eingeschleust -> Fehler; Meldung nennt den eingeschleusten Klartext nicht.

## Nachbesserung 3 (Chef-Review): Defekte Chiffre-Zeile ist Fehler, nicht Still-Ueberspringung

**Problem**: `lade()` hatte `if (!r.wert || !r.iv || !r.tag) continue;` -> ein manipulierter Eintrag (z.B. `tag` geloescht) blieb unentdeckt.
**Fix**: In `lade()` wird fuer `verschluesselt=1` ohne iv/tag/wert jetzt `KonfigFehler('"<name>" ist defekt (fehlende iv/tag/wert bei verschluesselt=1).')` geworfen.
**Test**: B12 — Zeile mit `verschluesselt=1, iv=NULL, tag=NULL, wert=''` -> Fehler.

## Nachbesserung 4 (Chef-Review): AAD = Feldname

**Problem**: AES-GCM ohne AAD erlaubt, einen Chiffretext zwischen zwei Feldern zu vertauschen (die Kryptographie wuerde nicht widersprechen). `lade()` ohne AAD haette den vertauschten Chiffretext als "lesbar" durchgewinkt.
**Fix**: `verschluesseleGeheimnis(wert, hs, aadName)` und `entschluesseleGeheimnis({...}, hs, aadName)` verlangen jetzt den Feldnamen und rufen `c.setAAD(Buffer.from(name))`. In `oeffneEinstellungsSpeicher.schreibe()/lade()` wird `r.schluessel` als AAD uebergeben.
**Test**: B13 — Chiffre von `STRIPE_WEBHOOK_SECRET` in die `RESEND_API_KEY`-Zeile kopiert (gleicher Schluessel, aber falscher AAD) -> `lade()` wirft `KonfigFehler`; Klartext taucht nicht in der Meldung auf.

**Hinweis**: Dies ist die erste Version mit AAD. Spaetere Werte, die ohne AAD entstanden sind (vor dieser Nachbesserung), waeren nicht mehr lesbar. In WP2 gibt es noch keine produktiven Werte -> keine Migration noetig. Vor einem Live-Rollout muesste geprueft werden, ob irgendwo bereits ohne AAD geschrieben wurde.

## Nachbesserung 5 (Chef-Review): Kurze Werte komplett maskieren

**Problem**: `maskiereGeheimnis('sk_test_1')` haette `sk_test_••••st_1` oder aehnlich geliefert und so Zeichen des Wertes geleakt.
**Fix**: Wenn `wert.length < 12` -> liefere `'••••'` ohne Endung. Sonst wie bisher (bekanntes Praefix + 4 Bullets + letzte 4 Zeichen).
**Test**: B14 — kurze Werte (7, 9, 11 Zeichen) -> `'••••'`; 12 Zeichen -> `••••` + letzte 4; `sk_test_WERT_abcd` -> `sk_test_••••abcd`; leerer Wert -> `''`.

## Aktualisierter Testzaehler
- `tools/selbsttest-einstellungen.mjs`: **52** Pruefungen (zuvor 38). B1-B14 + Integritaetscheck.
- `tools/selbsttest-setupmodus.mjs`: **87** Pruefungen (unveraendert, nur Polling statt fester Wartezeit).
- Gesamtlauf `PE_TEST_RAM=1 bash tools/selbsttest-alle.sh`: 1 rot (`handbuch-barrierefrei`).
