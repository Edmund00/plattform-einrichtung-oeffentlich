# CODEX-FERTIG-A4B

Rechtstexte-Verwaltung unter „Meine Marke“, direkt unter Anbieterdaten, umgesetzt.

Geänderte / neue Dateien:

- `public/admin/admin.js`: drei Seitenkarten aus GET `/api/admin/recht`, Status und aktive Version, Klartexteditor mit Sprachwahl und maximal 20000 Zeichen, Laden des aktiven Inhalts, Speichern über vorhandenes `apiMitStepup`, Feldfehler und Konfliktmeldung mit Neuladen. Eingaben bleiben bei Fehlern erhalten. Verlauf mit maximal 50 Versionen, Textvorschau im `pre`, Wiederherstellen nach zweitem Bestätigungsklick. In anderen Modi nur Hinweis und lesender Verlauf. DOM ausschließlich über `h(...)`, Textknoten / `textContent`, Labels und höfliche Live-Meldungen.
- `texte/de.json`, `texte/en.json`, `texte/hu.json`: alle 23 geforderten `recht_admin_*`-Schlüssel am Ende ergänzt; Deutsch, Englisch und Ungarisch.
- `tools/de/teil3.mjs`, `tools/en/teil3.mjs`: dieselben Texte am Ende des Objekts ergänzt.
- `tools/selbsttest-a4b-recht-ui.mjs`: statische Prüfung sowie vorbereiteter Playwright-Integrationstest mit eigener temporärer DB, Admin, Cookie-Sitzungen und Step-up. Browserfälle: Speichern und öffentliche Ausgabe, sichtbarer Script-Klartext ohne Ausführung, zwei Versionen, Ansehen, Wiederherstellen als Version 3, Konflikt durch zweite Sitzung mit Erhalt lokaler Eingaben und anschließendem Neuladen, URL-Modus ohne Editor.
- `CODEX-FERTIG-A4B.md`: diese Fertigmeldung.

Geprüft ohne Serverstart:

- `node --check public/admin/admin.js`
- `node --check tools/selbsttest-a4b-recht-ui.mjs`
- `node --check tools/de/teil3.mjs` und `node --check tools/en/teil3.mjs`
- `node tools/selbsttest-a4b-recht-ui.mjs --statisch`: erfolgreich; DOM-Quelltextprüfung und alle Übersetzungen einschließlich Generatorgleichheit.
- CRLF der betroffenen Textdateien erhalten; Diff-Prüfung mit `git -c core.whitespace=cr-at-eol diff --check`.

NICHT geprüft:

- Kein Server gestartet, kein Browser- oder Integrationstest ausgeführt. A4a-Backend ist Voraussetzung für den Volltest; HTTP-Fehler, tatsächliche öffentliche Ausgabe, Step-up und Wiederherstellen sind deshalb noch nicht zur Laufzeit verifiziert.
- Visuelle Darstellung, Tastaturbedienung und Screenreader im echten Browser sind noch offen.

Nach Integration ausführen:

`node tools/selbsttest-a4b-recht-ui.mjs`

Optional abweichende Werkzeuge: `--playwright=/absoluter/pfad/index.mjs --chrome=/absoluter/pfad/chrome`. Standard sind die vorhandenen Windows-Pfade unter `browser-werkzeug` und Google Chrome. Fehlende Browserwerkzeuge führen beim Volltest zu einem Fehler, nicht zu einem stillen Überspringen.

Der Integrationstest setzt den bestehenden WP6-Einstellungsschlüssel `recht_impressum` auf `erstellt` bzw. eine externe URL. Der API-Seitenname bleibt vertragsgemäß `impresszum`. Der Auftrag nennt an einer Stelle `recht_impresszum`; im vorhandenen Einrichtungsassistenten und Vorlagenrouter heißt der DB-Schlüssel jedoch `recht_impressum`.

Keine Commits erstellt. Das bereits vor Arbeitsbeginn unversionierte `node_modules` wurde nicht verändert.
