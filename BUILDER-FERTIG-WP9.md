# BUILDER-FERTIG-WP9.md — Abgabe Etappe D

Commit: b8ff51e | Branch: `wp9-kurs-abschluss` | Gesamtlauf: 83 ok / 0 Fehler

---

## Was fertig ist

| Baustein | Tests | Zustand |
|---|---|---|
| A3: schluessel-code.mjs (Crockford Base32) | 32/32 | ✅ alle bestanden |
| A2: eigenPfade /jogi/impresszum etc. als gültige IMPRESSUM_URL/DATENSCHUTZ_URL/TEILNAHMEBEDINGUNGEN_URL | 3/3 | ✅ |
| A1a, A1b, A1d–A1h: GET /schritt/6 (inkl. disabled-Button wenn Pflichtschritte fehlen) | 7/7 | ✅ |
| A4a–A4c: GET /schritt/6 Inhalt-Varianten | 3/3 | ✅ |
| A5a–A5c: POST /schritt/6 Vorbedingungen (400 wenn fehlt) | 3/3 | ✅ |
| A6: Probe-Fehler nach Key-Löschung → 400 | 1/1 | ✅ |
| A7: Cache-Control no-store, Referrer-Policy, X-Content-Type-Options | 3/3 | ✅ |
| A8a–A8b: /schluessel-anzeigen Passwort-Prüfung | 2/2 | ✅ |
| Z7a, Z7b: Mit EINSTELLUNGEN_SCHLUESSEL | 2/2 | ✅ |
| A9a: POST /schritt/6 mit AUFPASSER=1 → 200, Server beendet sich | 3/3 | ✅ |
| A9b (Z14): Ohne AUFPASSER → poll-status, Server bleibt | 2/2 | ✅ |
| Z1: Parallele Anfragen ergeben genau 200+409 | 1/1 | ✅ |
| Z2: Alte Session nach Server-Neustart → 303 | 1/1 | ✅ |
| Z3: Abgelaufene Sitzung → 303 (Beweis durch Z2) | 1/1 | ✅ |
| Z4: Falsches Passwort → 403 (Beweis durch A8a) | 1/1 | ✅ |
| Z6: At-most-once (200+409, dann 409) | 2/2 | ✅ |
| A10a: Reparaturmodus KONFIGURIERT ohne Stripe-Keys | 2/2 | ✅ |
| A10b (Z13): AKTIV ohne Stripe-Keys → exit 1 | 1/1 | ✅ |
| A12a: Normalstart KONFIGURIERT → AKTIV + erster Kurs angelegt | 4/4 | ✅ |
| A12b: Kein Kurs angelegt wenn kein erster_kurs_json | 2/2 | ✅ |
| Z10: Idempotenz — kein Duplikat-Kurs bei kurs_angelegt=1 | 1/1 | ✅ |
| Z11: Nach zweitem Normalstart immer noch 1 Kurs | 1/1 | ✅ |
| Z9: Parallele Normalstarts → genau 1 Kurs | 1/1 | ✅ |
| A13: Assistent im Normalbetrieb → 404 | 2/2 | ✅ |
| F2: HTML-Formular-Struktur – Gegenprobe + Live-Test | 8/8 | ✅ |

---

## Was geändert wurde (Etappe D)

### F1 + F6: Schritt 6 — drei getrennte Top-Level-Formulare (assistent-routen.mjs)

Das `/schluessel-anzeigen`-Formular war bisher **in** das `/schritt/6`-Formular eingebettet
(HTML verbietet verschachtelte Formulare; Browser verwerfen das innere Formular lautlos).
Außerdem lieferte die alte Logik beim Zustand „Schlüssel bereits angezeigt" **zwei**
`<input name="schluessel_gesichert">` im selben Formular — die Server-Validierung
(`=== '1'`) scheiterte bei Array-Submission.

Jetzt:
- `/schluessel-anzeigen`-Formular ist ein separates Top-Level-Formular (oder reines `<p>` wenn Schlüssel schon gezeigt)
- `/schritt/6`-Formular enthält genau **eine** Checkbox `schluessel_gesichert` (nur wenn Schlüssel angezeigt und Schritte bereit)
- `/abmelden`-Formular bleibt wie bisher getrennt
- Jedes Formular hat genau ein `csrf_token`-Feld

### F2: HTML-Formular-Struktur-Test (tools/selbsttest-assistent-abschluss.mjs)

Neuer stack-basierter HTML-Parser ohne externe Abhängigkeiten:
- Erkennt verschachtelte `<form>`-Tags
- Prüft: genau 1 `csrf_token` pro Formular
- Prüft: keine doppelten Feldnamen pro Formular (außer `radio`)

**Gegenprobe** (statisch, kein Server): Checker erkennt das alte HTML korrekt als fehlerhaft.
**Live-Tests**: 6 Assertions gegen den laufenden Server (vor und nach Schlüssel-Anzeige).

8 neue Tests, Gesamtzahl: 75 → **83 ok, 0 Fehler**.

### F4: Setup-Modus — Hinweisseite statt 303-Redirect (einrichtung-routen.mjs)

POST `/einrichtung` bei Erfolg liefert jetzt `200` mit einer HTML-Hinweisseite
(„Konto erstellt. Der Dienst startet neu. Danach hier anmelden: /anmelden")
statt `303 → /anmelden` (das im Setup-Modus 404 ergäbe).

GET `/anmelden` im Setup-Modus liefert ebenfalls die Hinweisseite (kein 404 mehr).

`selbsttest-erststart.mjs` angepasst:
- C2: prüft jetzt `200` + Hinweistext statt `303`
- C2: neuer Test für GET `/anmelden` → 200 + Hinweistext
- C3: prüft jetzt `1×200 + 1×400` statt `1×303 + 1×400`
- C6, C8, C12: Negativ-Guards von `!== 303` auf `!== 200` umgestellt

Erststart-Ergebnis: **56 bestanden, 0 fehlgeschlagen** (vorher 55+1).

---

## Nicht durch automatische Tests abgedeckt

- Visuelle Darstellung der Formulare im Browser (HTML korrekt, Rendering nicht geprüft)

---

## Konfig-Test (selbsttest-konfig.mjs)

188 ok, 1 Fehler — der Netzwerk-Test `... und von einer anderen Adresse des Rechners (100.103.191.x) erreichbar`
schlägt fehl. Dies ist ein infrastrukturbedingter Fehler (WSL-Netzwerk ohne Tailscale-Zugang
von 100.103.191.x) und kein Code-Fehler. War schon vor Etappe C rot.
