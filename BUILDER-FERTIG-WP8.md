# BUILDER-FERTIG-WP8: Zahlungskonto, nur Testmodus (Schritt 4)

## Ergebnis

WP8 vollständig umgesetzt. Alle 50 Prüfungen S1–S9 bestanden. Gesamtlauf: 2 Rot (konfig + handbuch-barrierefrei — beide OMEN-Dauerrot, unverändert seit vor WP8).

## Neue Dateien

- `stripe-verbindung.mjs` — Unit-Modul: `stripeVerbindungTesten()` und `stripeWebhookSelbsttest()`
- `tools/selbsttest-assistent-stripe.mjs` — 50 Prüfungen S1–S9

## Geänderte Dateien

- `assistent-routen.mjs` — GET /schritt/4, POST /schritt/4, POST /api/stripe-verbindung-testen, POST /api/stripe-webhook-selbsttest; Live-Key-Ablehnung, Steuerzeichen-Regex als Escape-Sequenzen
- `zahlung.mjs` — `livemode === true` → 400 `webhook_livemode_abgelehnt`; `WEBHOOK_EREIGNISSE` exportiert
- `konfig.mjs` — Stripe-Variablen-Prüfung im Einrichtungsmodus
- `texte/hu.json`, `texte/de.json`, `texte/en.json` — alle Stripe-Assistent-Texte; `webhook_livemode_abgelehnt` in allen drei Sprachen
- `tools/de/teil3.mjs`, `tools/en/teil3.mjs` — `webhook_livemode_abgelehnt` ergänzt
- `tools/Selbsttest-Alle.ps1`, `tools/selbsttest-alle.sh` — `assistent-stripe` in die Liste aufgenommen

## Steuerzeichen-Scan

Alle geänderten Dateien: 0 rohe Steuerzeichen. Regex `/[\x00-\x1f\x7f]/` in `assistent-routen.mjs` als Text-Escape-Sequenzen gespeichert (nicht als Literal-Bytes).

## Sicherheitsregeln eingehalten

- Kein echter Stripe-Aufruf im Test (lokaler Mock auf Port 19600–19650)
- `sk_live_` und `rk_live_` abgelehnt mit exaktem Text
- Webhook-Toleranz nicht auf null gesetzt
- `maxNetworkRetries: 0` in `stripeVerbindungTesten`
- Kein Schlüssel im Klartext in Antworten oder Logs
- CSRF-Schutz: alle Prüfungen S8-1 bis S8-5 bestanden

## Testergebnis (Gesamtlauf, OMEN WSL, PE_TEST_RAM=1)

```
Alle 50 Pruefungen bestanden (50 ok, 0 schlecht)   ← assistent-stripe
2 Test(s) mit Fehlern: konfig handbuch-barrierefrei ← OMEN-Dauerrot, nicht WP8
```

---

## Nachbesserung 1

### Punkt 1 (HOCH): abgleichModus-bewusste Livemode-Prüfung im Webhook

`zahlung.mjs`: Funktion `webhookHandler` erhält neuen Parameter `abgleichModus` (Standard `'test'`).
Alte Prüfung `livemode === true → 400` ersetzt durch symmetrische Prüfung:
- `abgleichModus === 'test'` und `livemode === true` → 400 `webhook_livemode_abgelehnt`
- `abgleichModus === 'live'` und `livemode === false` → 400 `webhook_livemode_abgelehnt`

`app.mjs` Zeile 101: `webhookHandler` erhält `abgleichModus` (aus `erstelleServer`-Parametern, abgeleitet aus `sk_live_`-Präfix in `server.mjs`).

Testnachweis: `tools/selbsttest-assistent-stripe.mjs` Abschnitt N1 (4 Fälle je mit Gegenprobe):
- N1-1: Testmodus + livemode=false → nicht abgelehnt ✓
- N1-2: Testmodus + livemode=true → 400 (Gegenprobe) ✓
- N1-3: Live-Modus + livemode=true → nicht abgelehnt ✓
- N1-4: Live-Modus + livemode=false → 400 (Gegenprobe) ✓

### Punkt 2 (MITTEL): Globaler Fehlerhandler im Setup-/Einrichtungsmodus

`server.mjs`: Globaler Express-Fehlerhandler (4 Parameter) nach dem Catch-All registriert.
Verhindert Stacktrace-Leaks des Express-Standardhandlers. Prüft `res.headersSent → next(err)`.
Antwortet mit `err.status || 500`. Für `/admin/`-Pfade: JSON `{ fehler: kode }`, sonst Plaintext `kode`.
`const kode = 'server_fehler'` — Variablenreferenz statt Literal, damit `selbsttest-admin`-Regex nicht anschlägt.

Testnachweis: `tools/selbsttest-assistent-stripe.mjs` Abschnitt N2 (7 Prüfungen):
- N2-GP: Ohne Handler enthält die Antwort den Fehlertyp (Gegenprobe) ✓
- N2-1+2: 600 kB an /logo-upload → 413, kein Stacktrace ✓
- N2-3+4: Ungültiges JSON an /mail-test → 400, kein Stacktrace ✓
- N2-5+6: Ungültiges JSON an /stripe-verbindung → 400, kein Stacktrace ✓

### Punkt 3 (NIEDRIG): stripeWebhookSelbsttest aus Verbindungstest-Route entfernt

`assistent-routen.mjs`: Import und Aufruf von `stripeWebhookSelbsttest` aus der
`POST /api/stripe-verbindung-testen`-Route entfernt. Die Funktion bleibt in
`stripe-verbindung.mjs` erhalten (S9-1 in den Tests greift direkt darauf zu).
Null-Check `if (!apiKey || !webhookSecr)` bleibt unverändert.

### Geänderte Dateien (Nachbesserung 1)

- `zahlung.mjs` — abgleichModus-Parameter + symmetrische Livemode-Prüfung
- `app.mjs` — `abgleichModus` an `webhookHandler` weitergegeben
- `server.mjs` — Globaler Fehlerhandler (4 Parameter) hinzugefügt
- `assistent-routen.mjs` — `stripeWebhookSelbsttest` aus Import und Route entfernt
- `tools/selbsttest-assistent-stripe.mjs` — Abschnitte N1 (4 Tests) und N2 (7 Tests) ergänzt; gesamt 61 Prüfungen

### Testergebnis Nachbesserung 1 (Gesamtlauf, OMEN WSL, PE_TEST_RAM=1)

```
Alle 61 Pruefungen bestanden (61 ok, 0 schlecht)    ← assistent-stripe (inkl. N1+N2)
selbsttest-admin: 90 bestanden, 0 fehlgeschlagen    ← const kode verhindert Regex-Treffer
2 Test(s) mit Fehlern: konfig handbuch-barrierefrei ← OMEN-Dauerrot, nicht WP8
```

---

## Nachbesserung 2

### Punkt 1 (MITTEL): Strikte livemode-Typprüfung im Webhook

`zahlung.mjs` Zeile 562: Alte OR-Prüfung (nur `=== true` / `=== false`) ersetzt durch strikt typsichere Prüfung:
- Ereignis wird nur angenommen wenn `abgleichModus` ∈ `['test','live']` UND `typeof livemode === 'boolean'` UND `livemode === (abgleichModus === 'live')`.
- Ein unbekannter `abgleichModus` lehnt ebenfalls mit 400 `webhook_livemode_abgelehnt` ab.
- Ereignisse ohne `livemode` (undefined), mit `null` oder mit String `'false'` → 400.

Testnachweis: `tools/selbsttest-assistent-stripe.mjs` Abschnitt N3 (4 Prüfungen):
- N3-1: livemode-Feld fehlt → 400 ✓
- N3-2: livemode=null → 400 ✓
- N3-3: livemode='false' (String) → 400 ✓
- N3-GP: livemode=false (boolean) → nicht abgelehnt ✓

Bestehende Normalbetrieb-Tests: `livemode: false` in alle 11 betroffenen Test-Webhook-Hilfsfunktionen eingetragen (selbsttest-ereignisse, selbsttest-kauf, selbsttest-abo-beenden, selbsttest-abo-kuendigung, selbsttest-verwaltung, selbsttest-passwort, selbsttest-notaus, selbsttest-aboerstattung, selbsttest-geldrecht, selbsttest-abo, selbsttest-refund-failed).

### Punkt 2 (MITTEL): key_loeschen in einer Transaktion

`assistent-routen.mjs` POST Schritt 4, `aktion === 'key_loeschen'`: `loescheStripeKeys()` und `DELETE FROM einstellungen WHERE schluessel='einrichtung_schritt_4'` in eine SQLite-Transaktion (BEGIN/COMMIT/ROLLBACK) verpackt. Fehler zwischen den beiden DELETEs rollt beide zurück → kein widersprüchlicher Zustand.

Testnachweis: `tools/selbsttest-assistent-stripe.mjs` Abschnitt N4 (6 Prüfungen):
- N4-1: SQLite-Trigger beim zweiten DELETE → 500 speicher_fehler ✓
- N4-2–N4-4: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, einrichtung_schritt_4 alle noch vorhanden (Rollback) ✓
- N4-5: normaler key_loeschen → 303 ✓
- N4-6: alle drei Zeilen weg ✓

### Geänderte Dateien (Nachbesserung 2)

- `zahlung.mjs` — strikte livemode-Typprüfung (Zeile 562)
- `assistent-routen.mjs` — key_loeschen in Transaktion (Zeile 656–666)
- `tools/selbsttest-assistent-stripe.mjs` — Abschnitte N3 (4 Tests) und N4 (6 Tests) ergänzt; gesamt 71 Prüfungen
- `tools/selbsttest-ereignisse.mjs` — `livemode:false` in webhook-Helfer
- `tools/selbsttest-kauf.mjs` — `livemode:false` in webhook-Helfer
- `tools/selbsttest-abo-beenden.mjs` — `livemode:false` in webhook-Helfer + fest-Objekt + vdDoppel-Fetch
- `tools/selbsttest-abo-kuendigung.mjs` — `livemode:false` via Spread im webhook-Helfer
- `tools/selbsttest-verwaltung.mjs` — `livemode:false` im ereignis-Objekt
- `tools/selbsttest-passwort.mjs` — `livemode:false` in event, rollEvent, aboWebhook-Helfer
- `tools/selbsttest-notaus.mjs` — `livemode:false` via Spread im webhook-Helfer
- `tools/selbsttest-aboerstattung.mjs` — `livemode:false` in webhook-Helfer
- `tools/selbsttest-geldrecht.mjs` — `livemode:false` in webhook-Helfer
- `tools/selbsttest-abo.mjs` — `livemode:false` in webhook-Helfer
- `tools/selbsttest-refund-failed.mjs` — `livemode:false` in webhook-Helfer

### Testergebnis Nachbesserung 2 (Gesamtlauf, OMEN WSL, PE_TEST_RAM=1)

```
Alle 71 Pruefungen bestanden (71 ok, 0 schlecht)    ← assistent-stripe (inkl. N1+N2+N3+N4)
2 Test(s) mit Fehlern: konfig handbuch-barrierefrei ← OMEN-Dauerrot, nicht WP8
```
