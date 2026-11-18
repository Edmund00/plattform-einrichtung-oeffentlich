# BUILDER-FERTIG-WP6.md

Erstellt: 2026-11-14

## Status

WP6 Impressum, Datenschutz, Teilnahmebedingungen ist fertig und getestet.

## Gesamtlauf nach Nachbesserung 2 (PE_TEST_RAM=1)

- **75 WP6-Tests: alle bestanden** (vorher 60, +15 durch R8-R10)
- 2 rot im Gesamtlauf (unverändert):
  - `handbuch-barrierefrei` — erwartet (bekannte Lücke, kein WP6-Bezug)
  - `konfig` — Umgebung: externer-IP-Test (Tailscale/WSL auf OMEN), war schon vor WP6 rot; Chef misst konfig auf dem Laptop

## Was WP6 liefert

**Schritt 2 des Einrichtungsassistenten** (`/admin/einrichtung/schritt/2`):

Pro Seite (Impressum, Datenschutz, Teilnahmebedingungen) wählt der Betreiber einen von zwei Modi:

| Modus | Was passiert |
|---|---|
| `erstellt` | Plattform generiert die Seite aus ANBIETER-Angaben |
| `eigene_url` | Externe https://-URL (oder eigener Plattform-Pfad) |

**Generierte Seiten** unter `/jogi/impresszum`, `/jogi/adatvedelem`, `/jogi/reszveteli-feltetelek`:
- Dreisprachig (DE/EN/HU) auf einer Seite
- Musterhinweis in allen drei Sprachen (R1)
- Alle Werte HTML-escaped (R2)
- Öffentlich ohne Anmeldung erreichbar (R5)
- Cache-Control: no-store

**Pflichtfelder** (nur wenn mindestens eine Seite auf `erstellt`):
- ANBIETER_NAME, ANBIETER_ANSCHRIFT, ANBIETER_EMAIL

**Optionale Felder:** ANBIETER_TELEFON, ANBIETER_ADOSZAM, STEUER_HINWEIS

**URL-Validation** (R4): akzeptiert externe https://-Adressen und die drei eigenen Pfade; lehnt javascript:, http://, Pfad-Traversal, Backslash, Schema-relativ ab.

## Schritt-2-POST: alle drei Modusfelder Pflicht (ab Nachbesserung 2)

Ein POST an `/admin/einrichtung/schritt/2` **muss alle drei Modusfelder** (`modus_impressum`, `modus_datenschutz`, `modus_teilnahmebedingungen`) enthalten, jeweils mit Wert `erstellt` oder `eigene_url`. Fehlt ein Feld oder hat es einen anderen Wert, antwortet der Server mit **400** und speichert nichts.

**G11** (selbsttest-assistent-geruest) wurde aktualisiert: Schritt 2 sendet jetzt gültige Modusfelder + Anbieter-Daten, damit der Test weiterhin grün bleibt.

**Absicherung:** Ein POST MIT gültigen Modusfeldern, aber fehlenden Pflichtfeldern (kein Name, keine Anschrift, keine E-Mail wenn mindestens eine Seite auf `erstellt`) wird ebenfalls mit 400 abgelehnt (R3-1 bis R3-5 bestanden).

## Geänderte und neue Dateien

| Datei | Art | Was |
|---|---|---|
| `recht-vorlagen.mjs` | neu | `erstelleRechtRouter()` — generierte Rechtsseiten |
| `assistent-routen.mjs` | geändert | Schritt-2-GET/POST, validiereRechtUrl, Einstellungs-Helfer |
| `server.mjs` | geändert | `erstelleRechtRouter` im Einrichtungsmodus (R5) |
| `app.mjs` | geändert | `erstelleRechtRouter` vor `betreiberRechtRouter` |
| `texte/de.json` | geändert | 18 neue Schlüssel |
| `texte/en.json` | geändert | 18 neue Schlüssel |
| `texte/hu.json` | geändert | 18 neue Schlüssel |
| `tools/de/teil3.mjs` | geändert | 18 neue Schlüssel |
| `tools/en/teil3.mjs` | geändert | 18 neue Schlüssel |
| `tools/selbsttest-assistent-recht.mjs` | neu | R1–R7, 60 Tests (Nachbesserung 1: R6 auf 6 echte Tests erweitert) |
| `tools/selbsttest-alle.sh` | geändert | assistent-recht eingetragen |
| `tools/Selbsttest-Alle.ps1` | geändert | assistent-recht eingetragen |

---

## Nachbesserung 1 (2026-11-14)

### Punkt 1 — R6: echter Normalbetrieb-Test (Lehre F-16)

R6 startet jetzt `erstelleServer` aus `app.mjs` als Subprocess mit eigenem DB_DATEI und Mock-Stripe.
Alte 3 Tests (Funktionsexistenz-Check) ersetzt durch 6 echte HTTP-Tests:

| Test | Was geprüft | Ergebnis |
|---|---|---|
| R6-1 | Impressum 200 (erstelleServer + db-Singleton) | grün |
| R6-2 | Betreibername in Antwort (db-Singleton geteilt zwischen recht-vorlagen.mjs und app.mjs) | grün |
| R6-3 | Datenschutz 200 + Betreibername | grün |
| R6-4 | Teilnahme 200 + Betreibername | grün |
| R6-5 | Ohne recht_*=erstellt: betreiberRechtRouter greift (kein Betreibername) | grün |
| R6-6 | Gegenprobe: DB-Daten da, aber ohne erstelleRechtRouter (app.use-Zeile) kein Betreibername | grün |

Gegenprobe-Mechanismus: Subprocess startet Mini-Express mit betreiberRechtRouter, aber OHNE erstelleRechtRouter. Obwohl recht_impressum='erstellt' und ANBIETER_NAME='R6-Firma GmbH' in der DB liegen, enthält die Antwort keinen Betreibernamen → beweist: ohne die `app.use(erstelleRechtRouter())`-Zeile in app.mjs würde R6-2 bis R6-4 rot.

### Punkt 2 — Musterhinweis auf Spezifikations-Wortlaut gekürzt

`recht-vorlagen.mjs` Zeilen 12–14:

| Sprache | Alt (länger) | Neu (Spezifikation) |
|---|---|---|
| DE | 'Dies ist ein Mustertext, keine Rechtsberatung; bitte prüfen Sie den Text vor der Verwendung.' | `'Muster, ersetzt keine Rechtsberatung, vor echtem Betrieb prüfen lassen'` |
| EN | 'This is a sample, not legal advice. Please have the text checked...' | `'Sample only, not legal advice, have checked before going live'` |
| HU | 'Ez egy mintatöveg, nem jogi tanácsadás; kérjük, ellenőriztesse...' | `'Csak minta, nem jogi tanácsadás, éles üzem előtt ellenőriztesse'` |

Tests R1-7, R1-8, R1-9, R1-14, R1-17 auf neue Teilstrings angepasst.

### Punkt 3 — Datenschutz- und Teilnahmetexte codekonform, Belegtabelle

#### Datenschutz: Protokolldaten → Zugriffsschutz

**Entfernt:** `'Unser Server erfasst IP-Adressen und Zeitstempel in Zugriffsprotokollen.'`
Grund: Kein allgemeines Zugriffsprotokoll im Code. Express hat kein Logger-Middleware; `req.ip` wird nur für Sicherheit verwendet.

**Ersetzt durch:** `'Zur Absicherung gegen missbräuchliche Anmeldeversuche wird die IP-Adresse für eine sitzungsinterne Sperrung verwendet. Admin-Zugriffsversuche werden mit gekürzter IP-Adresse in unserer Datenbank protokolliert.'`

#### Teilnahme: Widerruf-Abschnitt entfernt

**Entfernt (DE/EN/HU):** `<h3>Widerruf</h3>` + 14-Tage-Satz.
Grund: Kein 14-Tage-Fenster im Code implementiert; `zahlung.mjs` hat `zustimmung`-Mechanismus (ellallas), aber keine zeitgesteuerte Widerrufsverwaltung.

#### Belegtabelle — jeder verbleibende Satz mit Datei:Zeile

**Datenschutz:**

| Satz / Absatz | Beleg (Datei:Zeile) |
|---|---|
| Kundenkonto: E-Mail und Passwort-Hash | `db.mjs:34` (Tabelle benutzer: email, passwort_hash); `erststart.mjs` (Admin-Anlage) |
| Käufe: Stripe, Kaufbelege (Betrag, Datum, Kurs) | `zahlung.mjs` (stripe.checkout.sessions.create); `db.mjs:50+` (Tabellen bestellungen, abonnements) |
| E-Mail: Resend wenn aktiviert | `mail.mjs` (Resend-Dienst, nur wenn RESEND_API_KEY gesetzt) |
| Videos: Bunny CDN wenn aktiviert | `bunny.mjs` (Bunny CDN, nur wenn BUNNY_* konfiguriert) |
| Zugriffsschutz: IP für Login-Sperre + Admin-Protokoll | `routes-auth.mjs:69` (sitzungsinterne Sperre: `${req.ip}\|${email}`); `admin-zugang.mjs:35` (admin_login_protokoll, maskierte IP) |
| Sitzungscookies: Cookie ohne Passwort | `auth.mjs` (sitzungErzeugen, cookieSetzen) |

**Teilnahme:**

| Satz / Absatz | Beleg (Datei:Zeile) |
|---|---|
| Vertragsschluss: Kauf = Vertrag | `zahlung.mjs` (Stripe Checkout Session erstellt, Kaufbeleg in DB gespeichert) |
| Zugang für Dauer des Abonnements | `abo.mjs:70` (gueltig_bis gesetzt); `abo.mjs:81` (zugangSetzen) |
| Zahlung über Stripe, Stripe-Bedingungen | `zahlung.mjs` (stripe.checkout.sessions.create) |

### Punkt 4 — Steuerzeichen in Testdatei ersetzt

`tools/selbsttest-assistent-recht.mjs`:
- Byte 19219 (`\x00`) → `u0000` (in Kommentar Zeile 368)
- Byte 19221 (`\x1f`) → `u001f` (in Kommentar Zeile 368)
- Byte 19319 (`\x01`) → `u0001` (in Teststring Zeile 369)

Datei wird von git/grep nun als Textdatei behandelt.

---

## Nachbesserung 2 (2026-11-14)

### Zusatz — `validiereRechtUrl`: https:// vor `new URL()` prüfen

`assistent-routen.mjs`: In `validiereRechtUrl` wurde vor dem `new URL(v)`-Aufruf eine explizite
`startsWith('https://')`-Prüfung ergänzt. Ohne sie konnte ein Wert wie `javascript:alert(1)` oder
eine schema-relative URL den URL-Konstruktor passieren und erst bei der `protocol`-Prüfung scheitern —
bei exotischen Eingaben ein unsicheres Fenster. Die neue Zeile schließt das ab.

### Punkt 1 (HOCH) — Alle drei Modusfelder Pflicht; Whitelist

`assistent-routen.mjs`: POST auf Schritt 2 prüft jetzt, dass alle drei Felder (`modus_impressum`,
`modus_datenschutz`, `modus_teilnahmebedingungen`) vorhanden sind und jeweils den Wert `erstellt`
oder `eigene_url` haben. Fehlt ein Feld oder hat es einen anderen Wert → 400, nichts gespeichert.

`tools/selbsttest-assistent-geruest.mjs` (G11): Schritt-2-POST sendet jetzt gültige Modusfelder
(`erstellt` dreifach) + Anbieter-Pflichtfelder, damit G11 weiterhin grün ist.

### Punkt 2 (HOCH) — URL-Felder bei Moduswechsel synchron halten

`assistent-routen.mjs`: Bei `modus_xxx=erstellt` wird `recht_xxx` auf `'erstellt'` gesetzt **und**
`IMPRESSUM_URL` / `DATENSCHUTZ_URL` / `TEILNAHMEBEDINGUNGEN_URL` auf den eigenen Plattform-Pfad
(`/jogi/impresszum` usw.). Bei `modus_xxx=eigene_url` werden beide Felder auf die externe URL gesetzt.
Damit bleibt kein veralteter Fremd-URL stehen, wenn der Betreiber auf `erstellt` wechselt.

### Punkt 3 (MITTEL) — Whitelist für Modusfelder (kein stilles Coercing)

Teil von Punkt 1: `ERLAUBTE_MODI = new Set(['erstellt', 'eigene_url'])`. Jeder andere Wert
(z. B. `hacker`, `Erstellt`, leerer String) → 400 vor jeder weiteren Verarbeitung.

### Punkt 4 (MITTEL) — Schritt-2-Schreibvorgänge in einer SQLite-Transaktion

`assistent-routen.mjs`: Alle `schreibeEinstellung`-Aufrufe für Schritt 2 und
`markiereAlsFertig(2)` sind jetzt in `db.exec('BEGIN')` / `db.exec('COMMIT')` eingebettet.
Bei jedem Fehler wird `db.exec('ROLLBACK')` aufgerufen, bevor 500 geantwortet wird.
Ergebnis: bei einem Schreibfehler bleibt der vorherige Zustand erhalten — kein Halbzustand.

### Neue Tests R8-R10 (15 Tests)

| Test | Was geprüft |
|---|---|
| R8-1 | fehlendes `modus_datenschutz` → 400 |
| R8-2 | alle Modusfelder fehlen → 400 |
| R8-3 | `modus_impressum=hacker` → 400 |
| R8-4 | `modus_impressum=` (leer) → 400 |
| R8-5 | `modus_impressum=Erstellt` (Grossbuchstabe) → 400 |
| R8-6 | nach 400: Impressum noch nicht generiert |
| R8-7 | alle drei Modusfelder korrekt → 303 |
| R9-1 | `eigene_url` → `IMPRESSUM_URL` = externe Adresse |
| R9-2 | Wechsel `erstellt` → `IMPRESSUM_URL` = `/jogi/impresszum` |
| R9-3 | Wechsel `erstellt` → `DATENSCHUTZ_URL` = `/jogi/adatvedelem` |
| R9-4 | Wechsel `eigene_url` → `IMPRESSUM_URL` = neue externe Adresse |
| R10-1 | simulierter Schreibfehler (SQLite-Trigger) → 500 |
| R10-2 | nach 500: alter Name in DB (Rollback korrekt) |
| R10-3 | Gegenprobe ohne Transaktion → 500 |
| R10-4 | Gegenprobe: `ANBIETER_NAME` trotz Fehler geschrieben (Teilzustand bleibt) |

### Geänderte Dateien

| Datei | Was |
|---|---|
| `assistent-routen.mjs` | Zusatz + Punkte 1-4: https://-Prüfung, Modusfelder-Pflicht, URL-Sync, Transaktion |
| `tools/selbsttest-assistent-recht.mjs` | +15 Tests (R8, R9, R10 mit DatabaseSync-Import und --r10-notx-server-Subprocess) |
| `tools/selbsttest-assistent-geruest.mjs` | G11: Schritt 2 sendet jetzt gültige Modus- und Anbieterfelder |
