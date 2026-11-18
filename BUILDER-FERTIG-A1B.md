# BUILDER-FERTIG: A1b Meine Marke

**Branch:** meine-marke-a1b (von origin/meine-marke-f142)

---

## Teil 1 — Server-API

**Start:** 2026-11-15 ~19:30 UTC (Vorsitzung, weitergeführt nach Komprimierung)
**Ende:** 2026-11-15 ~20:30 UTC

### Was geliefert wurde

**routes-marke.mjs** (neu)

Factory-Funktion `markeAdminRouter(logoPfad)`:
- `GET /api/admin/marke` — aktueller Zustand (name, standard, hat_logo, logo), kein Stepup
- `PUT /api/admin/marke/name` — Plattformname ändern, Stepup nötig, bleibt in `einstellungen`-Tabelle
- `PUT /api/admin/marke/logo` — PNG hochladen (binär, bis 512 KB), Stepup nötig; 413 bei Überschreitung
- `DELETE /api/admin/marke/logo` — Logo entfernen, idempotent, Stepup nötig

Name wird beim Start aus der DB gelesen und überschreibt den Parameter-Default (Scheibe F1: überlebt Neustart).

**app.mjs** (geändert)

`markeAdminRouter` importiert und vor dem Plattform-GET eingehängt.

**tools/selbsttest-a1b-marke-server.mjs** (neu)

32 Testpunkte (A–F):
- A: GET ohne/mit Anmeldung, 401/403
- B: PUT Name — Validierung, Stepup, Persistenz, /api/texte-Propagierung
- C: PUT Logo — Validierung, 413, CRC, v-Parameter-Wechsel
- D: DELETE Logo — idempotent, SVG-Fallback danach
- E: Fremde Origin → 403
- F: Namensspeicherung überlebt Neustart (gleiche DB)

**tools/selbsttest-alle.sh** — `a1b-marke-server` eingetragen

### Regressionsstatus

- `selbsttest-a1a-anzeige.mjs`: 26/26 ✅
- `selbsttest-a1b-marke-server.mjs`: 32/32 ✅

---

## Teil 2 — Oberfläche

**Start:** 2026-11-15 ~20:35 UTC
**Ende:** 2026-11-15 ~21:00 UTC

### Was geliefert wurde

**public/admin/admin.js** (geändert)

`markeBereich()` async-Funktion:
- Lädt `GET /api/admin/marke` beim Aufruf
- Name-Formular: Texteingabe + Speichern-Button, stepup via `apiMitStepup`
- Logo-Vorschau: `<img>` nur wenn `d.hat_logo === true`
- Logo-Hochladen: `<input type="file" accept="image/png">`, stepup via `stepupAnfordern()`, XHR PUT als `application/octet-stream`
- Logo-Löschen: Knopf nur wenn `d.hat_logo`, Bestätigungsdialog, stepup via `apiMitStepup`
- Zurück-Knopf zu `uebersicht()`

`markeKnopf` in `werkzeugReihe` der Übersicht eingetragen.

**texte/de.json, texte/hu.json, texte/en.json** (je 11 neue Schlüssel)

`marke_titel`, `marke_name_bezeichnung`, `marke_name_ok`, `marke_logo_bezeichnung`,
`marke_logo_hilfe`, `marke_logo_hochladen`, `marke_logo_loeschen`, `marke_logo_loeschen_frage`,
`marke_logo_ok`, `marke_logo_entfernt`, `marke_logo_vorschau_alt`

**tools/selbsttest-a1b-marke-ui.mjs** (neu)

61 Testpunkte:
- A: alle 11 marke_*-Schlüssel in de/hu/en vorhanden und nicht leer
- B: statische Code-Prüfungen auf admin.js (Funktion, Knopf, Patterns)
- C: alle marke_*-Schlüssel kommen via /api/texte durch

**tools/selbsttest-alle.sh** — `a1b-marke-ui` eingetragen

### Regressionsstatus

- `selbsttest-a1a-anzeige.mjs`: 26/26 ✅
- `selbsttest-a1b-marke-server.mjs`: 32/32 ✅
- `selbsttest-a1b-marke-ui.mjs`: 61/61 ✅
