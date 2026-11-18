# BUILDER-FERTIG-WP7.md

**Auftrag:** WP7 E-Mail (Schritt 3) — Resend-Integration im Einrichtungsassistenten  
**Zweig:** `wp7-mail`  
**Datum:** 2026-11-14  
**Einzeltest:** 45/45 ✅ (3×)  
**Gesamtlauf:** alle WP7-eigenen Tests grün ✅

---

## Checkliste

| Nr. | Anforderung | Prüfung | Ergebnis |
|---|---|---|---|
| 1 | Schritt 3 zeigt E-Mail-Einrichtungsseite | M1-1…M1-9 | ✅ |
| 2 | POST ohne Schlüssel → 400 | M2-1 | ✅ |
| 3 | POST mit Schlüssel → speichert Key verschlüsselt, MAIL_FROM unverschlüsselt | M3-1…M3-9 | ✅ |
| 4 | MAIL_FROM Format: `Name <email@domain>` Pflicht | M4-1…M4-2 | ✅ |
| 5 | `aktion=ohne_mail` → weiter zu Schritt 4, kein Key | M5-1…M5-3 | ✅ |
| 6 | `aktion=key_loeschen` → Key weg, Schritt entmarkiert | M6-1…M6-4 | ✅ |
| 7 | `/mail-test` sendet genau 1 POST, 10s Timeout | M7-1…M7-16 | ✅ |
| 8 | Idempotency-Key im Request enthalten | M7-4 | ✅ |
| 9 | 401/403/429/Timeout/Netzwerkfehler korrekt gemappt | M7-6…M7-16 | ✅ |
| 10 | Klartext-Schlüssel nie in HTTP-Antwort | M7-12 | ✅ |
| 11 | CSRF-Schutz auf `/mail-test` | M7-9 | ✅ |
| 12 | PE_RESEND_URL aus konfig (nicht `process.env` in mail.mjs/assistent-routen.mjs) | selbsttest-konfig: `process.env`-Regel | ✅ |
| 13 | generator-sync: `assistent_mail_from_fehler` stimmt in de.json ↔ tools/de/teil3.mjs | selbsttest-generator-sync | ✅ |
| 14 | G11 (assistent-geruest): Schritt 3 mit `aktion=ohne_mail` abschließbar | selbsttest-assistent-geruest | ✅ |
| 15 | assistent-mail in Selbsttest-Alle.sh und Selbsttest-Alle.ps1 eingetragen | Vollständigkeitsprüfung | ✅ |

---

## Einzeltest-Lauf (3×)

```
WP7 Mail: alle 45 Pruefungen bestanden.  (Lauf 1)
WP7 Mail: alle 45 Pruefungen bestanden.  (Lauf 2)
WP7 Mail: alle 45 Pruefungen bestanden.  (Lauf 3)
```

---

## Gesamtlauf-Ergebnis

```
2 Test(s) mit Fehlern: konfig handbuch-barrierefrei
```

Beide Fehler sind **nicht durch WP7 verursacht** und waren vor WP7 vorhanden:

- **konfig** (1 Fehler): Netzwerk-Erreichbarkeitstest von 100.103.191.x  
  (Tailscale-Windows-Knoten, von WSL nicht erreichbar — umgebungsspezifisch)

- **handbuch-barrierefrei** (10 Fehler): Gegenprobe-Tests suchen alte PDFs im Git-Verlauf,  
  die in diesem Zweig nicht vorhanden sind — umgebungsspezifisch

---

## Geänderte Dateien

| Datei | Was |
|---|---|
| `assistent-routen.mjs` | Schritt 3: Key-Speicherung/-Lesen mit `env: {}`, `/mail-test`-Route, `resendUrl: konfig.resendUrl` |
| `mail.mjs` | `RESEND_URL` konstant (kein `process.env`), `resendUrl`-Parameter in `mailTesten` |
| `konfig.mjs` | `resendUrl` in beiden Rückgaben von `ladeKonfig` |
| `feldregeln.mjs` | `pruefeMailFromFormat` |
| `recht-vorlagen.mjs` | (keine Änderung nötig) |
| `texte/de.json` | WP7-Schlüssel + Korrektur `assistent_mail_from_fehler` (U+201C) |
| `texte/en.json` | WP7-Schlüssel |
| `texte/hu.json` | WP7-Schlüssel + Korrektur `assistent_mail_from_fehler` |
| `tools/selbsttest-assistent-mail.mjs` | Neuer Selbsttest WP7 (45 Prüfungen) |
| `tools/selbsttest-assistent-geruest.mjs` | G11: `aktion=ohne_mail` für Schritt 3 |
| `tools/selbsttest-alle.sh` | `assistent-mail` eingetragen |
| `tools/Selbsttest-Alle.ps1` | `assistent-mail` eingetragen |
| `tools/de/teil3.mjs` | WP7-Schlüssel |
| `tools/en/teil3.mjs` | WP7-Schlüssel |

---

## Nachbesserung 1 — 2026-11-14

Basis-Commit: `514dced`. Fünf Punkte laut Chef-Messung.

---

### PUNKT 1 (HOCH): Hauptschlüssel-Übergabe (assistent-routen.mjs + server.mjs)

**Problem:** `erstelleAssistentRouter` rief `holeHauptschluessel({ env: {} })` auf, ignorierte `EINSTELLUNGEN_SCHLUESSEL` aus der Umgebung und legte immer eine neue `.hauptschluessel`-Datei an.

**Fix:**
- `server.mjs`: bestimmt `assistentHauptschluessel` aus `process.env` (via `holeHauptschluessel`) und übergibt ihn als dritten Parameter an `erstelleAssistentRouter`.
- `assistent-routen.mjs`: Signatur `erstelleAssistentRouter(db, konfig, hauptschluesselVorgabe = null)`, neues Closure-Feld `let cachedHs = hauptschluesselVorgabe`. `schreibeResendKey` erzeugt die Datei nur, wenn kein Env-Schlüssel gesetzt und keine Datei vorhanden ist.

**Quelle:** `server.mjs` Z. 86–97, `assistent-routen.mjs` Z. 114–183  
**Tests:** M8-1…M8-5 (frischer Server mit `EINSTELLUNGEN_SCHLUESSEL=…`, kein `.hauptschluessel` angelegt, Key nach Neustart lesbar)

---

### PUNKT 2 (MITTEL): `testEmpfaenger`-Validierung + Abklingzeit

**Problem:** `testEmpfaenger` wurde nur auf Länge > 0 geprüft; mehrere Adressen, Zeilenumbrüche oder ungültige Formate waren nicht abgefangen. Kein Rate-Limit.

**Fix (assistent-routen.mjs):**
- `pruefeEmailFormat(to)` prüft exakt eine gültige Adresse ohne Steuerzeichen.
- Abklingzeit: `mailTestAbklingzeit = { letzte, stundeBeginn, zaehler }` im Closure. Weniger als 10 s Abstand → 429 `limit`. Mehr als 10 Anfragen pro Stunde → 429 `limit`.
- Position: Abklingzeit-Check liegt **nach** `kein_schluessel`- und `kein_absender`-Check (der Limiter schützt nur den echten Versand, nicht Fehlerpfade ohne Netzwerk).
- Neue Texte in allen drei Sprachen: `assistent_mail_test_limit`.

**Quelle:** `assistent-routen.mjs` Z. 625–655, `texte/de.json`, `texte/en.json`, `texte/hu.json`, `tools/de/teil3.mjs`, `tools/en/teil3.mjs`  
**Tests:** M9-1 (ungültige Adresse → 400), M9-2 (zwei Adressen → 400), M9-3 (erste → 200), M9-4 (sofortige zweite → 429 `limit`)

---

### PUNKT 3 (MITTEL): `aktion=ohne_mail` löscht auch MAIL_FROM

**Problem:** `ohne_mail` löschte `RESEND_API_KEY`, ließ aber gespeichertes `MAIL_FROM` stehen.

**Fix (assistent-routen.mjs):** `ohne_mail`-Zweig führt jetzt `loescheResendKey()` **und** `db.prepare("DELETE FROM einstellungen WHERE schluessel='MAIL_FROM'").run()` aus, bevor `markiereAlsFertig(3)` und Redirect.

**Quelle:** `assistent-routen.mjs` Z. 523–527  
**Tests:** M10-1 (Vorbedingung: Key + MAIL_FROM gespeichert), M10-2 (ohne_mail → 303 /schritt/4), M10-3 (Gegenprobe: RESEND_API_KEY gelöscht), M10-4 (MAIL_FROM gelöscht)

---

### PUNKT 4 (MITTEL): `PE_RESEND_URL`-Validierung in konfig.mjs

**Problem:** `PE_RESEND_URL` wurde in `konfig.mjs` nicht validiert; externe URLs wären im Betrieb akzeptiert worden.

**Fix (konfig.mjs):**
- Produktion (`NODE_ENV=production`): gesetzt → `KonfigFehler`.
- Außerhalb Produktion: nur `http://127.0.0.1` oder `http://localhost` erlaubt; alles andere → `KonfigFehler`.
- Default bleibt `https://api.resend.com/emails`.

**Quelle:** `konfig.mjs` Z. 56–67 (beide `ladeKonfig`-Rückgaben)  
**Tests (selbsttest-konfig.mjs):** 5 neue Prüfungen: `http://127.0.0.1` erlaubt, `http://localhost` erlaubt, externe URL → Fehler, Prod + gesetzt → Fehler, ohne Variable → Standard

---

### PUNKT 5 (NIEDRIG): HTTP 400/422 → `eingabe_fehler`, 403-Text aktualisiert

**Problem:** `mailTesten` gab für 400 und 422 `netzwerk_fehler` zurück; der 403-Text erwähnte nicht, dass der Schlüssel noch nicht aktiviert sein kann.

**Fix:**
- `mail.mjs`: vor der 429-Prüfung: `if (r.status === 400 || r.status === 422) return { fehler: 'eingabe_fehler' };`
- Alle drei Sprachen + Generator-Quellen: neuer Schlüssel `assistent_mail_test_eingabe_fehler`; `assistent_mail_test_absender_abgelehnt` ergänzt um "oder Schlüssel nicht aktiviert".

**Resend-Fehlertabelle nach Nachbesserung 1:**

| HTTP-Status | `fehler`-Wert | Auslöser |
|---|---|---|
| 200 | — (`ok: true`) | Versand erfolgreich |
| 400, 422 | `eingabe_fehler` | Absender/Empfänger ungültig laut Resend |
| 401 | `schluessel_abgelehnt` | API-Schlüssel fehlt oder ungültig |
| 403 | `absender_abgelehnt` | Domain nicht verifiziert oder Schlüssel nicht aktiviert |
| 429 | `limit_erreicht` | Resend-Rate-Limit |
| Timeout (AbortError) | `timeout` | Keine Antwort nach 10 s |
| Netzwerkfehler | `netzwerk_fehler` | ECONNREFUSED o. Ä. |
| Rate-Limit (intern) | `limit` | < 10 s Abstand oder > 10/h (PUNKT 2) |

**Quelle:** `mail.mjs` Z. 29–31, `texte/de.json`, `texte/en.json`, `texte/hu.json`, `tools/de/teil3.mjs`, `tools/en/teil3.mjs`  
**Tests:** M7-17 (HTTP 400 → `eingabe_fehler`), M7-18 (HTTP 422 → `eingabe_fehler`)

---

### Einzeltest Nachbesserung 1 (3×)

```
WP7 Mail (Nachbesserung 1): alle 60 Pruefungen bestanden.  (Lauf 1)
WP7 Mail (Nachbesserung 1): alle 60 Pruefungen bestanden.  (Lauf 2)
WP7 Mail (Nachbesserung 1): alle 60 Pruefungen bestanden.  (Lauf 3)
```

### Gesamtlauf Nachbesserung 1

```
2 Test(s) mit Fehlern: konfig handbuch-barrierefrei
```

Beide Fehler **nicht durch Nachbesserung 1 verursacht** (konfig: Tailscale-Netzwerktest OMEN-Umgebung; handbuch-barrierefrei: sucht Git-Vorgeschichte, seit WP4 bekannt).

### Geänderte Dateien (Nachbesserung 1)

| Datei | Was |
|---|---|
| `PROTOKOLL.md` | Rohe Steuerzeichen entfernt (Z. 183: 0x00, 0x1f, 0x7f → 4-stellige Escape-Sequenzen) |
| `server.mjs` | `assistentHauptschluessel` aus `process.env`, Übergabe an `erstelleAssistentRouter` |
| `assistent-routen.mjs` | PUNKT 1 (`cachedHs`-Closure), PUNKT 2 (E-Mail-Validierung + Abklingzeit nach kein_schluessel/kein_absender), PUNKT 3 (`ohne_mail` löscht MAIL_FROM), PUNKT 5 (`eingabe_fehler` in fehlertexte) |
| `konfig.mjs` | PUNKT 4: `PE_RESEND_URL`-Validierung, `resendUrl`-Variable in beiden Rückgaben |
| `mail.mjs` | PUNKT 5: HTTP 400/422 → `eingabe_fehler` |
| `texte/de.json` | `assistent_mail_test_limit`, `assistent_mail_test_eingabe_fehler`, `assistent_mail_test_absender_abgelehnt` aktualisiert |
| `texte/en.json` | dto. |
| `texte/hu.json` | dto. |
| `tools/de/teil3.mjs` | dto. (Generator-Sync) |
| `tools/en/teil3.mjs` | dto. (Generator-Sync) |
| `tools/selbsttest-assistent-mail.mjs` | M7-17/18, M8, M9, M10 neu; M7-6/7/8 als frische Server; M7-12 in M7-1 gemergt; M7-14 fix |
| `tools/selbsttest-konfig.mjs` | 5 neue PE_RESEND_URL-Prüfungen |
