# BUILDER-FERTIG: A1a Nachbesserung N1

**Start:** 2026-11-15 ~19:00 UTC (Wiederaufnahme nach Kontextwechsel)  
**Ende:** 2026-11-15 19:21 UTC  
**Branch:** meine-marke-a1a  
**Tests:** 25/25 grün (`selbsttest-a1a-anzeige.mjs`)

---

## Was geliefert wurde (je ein Commit)

### F-138 — `logoPfade()` Cache (Commit 7630eb0)
`logoPfade()` liest und prüft das PNG nur noch bei geänderter `mtimeMs` oder `size`.
Jeder andere Aufruf (z. B. bei `/api/texte`) liefert aus dem Cache.
Neues Export: `logoPruefungen()` zählt echte Lese+Prüf-Läufe. Tests: H1–H6.

### F-137 — `_titel_praefix` in `/api/texte` + `document.title` im Frontend (Commit 4aee9f4)
`/api/texte` liefert `_titel_praefix`: leer beim Standardnamen, `'<Name> - '` bei eigenem Namen.
`kunde.js` und `admin.js` setzen `document.title` mit diesem Präfix.
Server-seitiges `<title>`-Tag in `texte.mjs` ebenfalls angepasst. Tests: A3, E3, E4.

### F-139 — CSS: breite PNGs brechen Layout nicht (Commit 17ab299)
`.marka img` → `max-width: min(100%, 240px)`, `object-fit: contain`.
`.admin-marke` → `min-width: 0`, `.admin-marke img` → `max-width: min(100%, 240px)`.
Auch `.hero-logo` und `.fuss-logo` abgesichert. Browser-Test obliegt dem Chef.

### F-140 — Testqualität `selbsttest-a1a-anzeige.mjs` (Commit 74f9fd1)
- Dynamischer Port via `listen(0, '127.0.0.1')` + `s.address().port` (kein Konflikt mehr)
- B4: `Buffer.compare(serviert, readFileSync(logoPfad)) === 0` (voller Byte-Vergleich)
- C: `/<title>([^<]*)<\/title>/` Regex, Titeltext extrahiert
- D: `altPng()` (128×128) + `utimesSync +5 s` im **laufenden** Server geprüft (kein Neustart)
- E3: exakter Vergleich mit `d.k_oldal_cim` aus `/api/texte` desselben Servers
- G3: `setzePlattform('<b>x</b>')` → fällt auf `STANDARD_PLATTFORM_NAME` zurück
- `alleServer[]` sammelt alle gestarteten Server; `finally` schließt alle

---

## Hinweis für Chef
- **F-139 CSS** wurde nicht im Browser getestet — Browser-Test obliegt dem Chef (wie vereinbart).
- `kunde.js:187` (Kurstitel überschreibt document.title bei Kursseite) bleibt unverändert — per Spezifikation so gewollt.
- Alle vier Punkte sind eigene Commits auf `meine-marke-a1a`, bereit zum Merge wenn Chef freigibt.
