# Technik-Übersicht der Schulungsplattform (angelegt 01.11.2026, Claude Code, auf Edmunds Wunsch: "jeder Agent soll verstehen, wie wir das gebaut haben")

Diese Datei enthält KEINE Schlüssel oder Passwörter. Sie beschreibt, womit die Plattform gebaut ist, wo was liegt und wie man sicher damit arbeitet. Zielgruppe: jedes Modell und jeder Mensch, der neu einsteigt. Zuerst lesen, dann `docs/UEBERGABE-schulungsplattform.md` (Ziel, Regeln), `PROTOKOLL.md` (was zuletzt lief) und im Notizen-Repo `stripe-lernwerkstatt-notizen/SITZUNGS-INDEX.md` und den neuesten Abschnitt WIEDEREINSTIEG in `SITZUNG-GESPEICHERT-01-11-2026.md`.

## 1. Was die Plattform ist
Eine eigene Schulungsplattform für Gabriella (VALORE Business Club): Kundinnen kaufen Online-Kurse (Text, Video, PDF, Audio), einmalig oder als Abo, und sehen sie nur mit Zugang. Oberfläche auf Ungarisch. Gabriella verwaltet alles im Admin. Aktuell nur Stripe-TESTMODUS, nichts Live.

## 2. Womit gebaut (verifizierte Angaben)
| Baustein | Was | Hinweis |
|---|---|---|
| Sprache | JavaScript (ES-Module, Dateien `.mjs`), KEIN Python, KEIN TypeScript | |
| Laufzeit | Node.js 24 (`.node-version`) | Version 24 ist nötig wegen `node:sqlite` |
| Web-Framework | Express 5.1.0 | exakte Version in `package.json` |
| Datenbank | SQLite, eingebaut in Node (`node:sqlite`, `DatabaseSync`), eine Datei | auf Render unter `/var/data` |
| Zahlung | Stripe (Bibliothek `stripe` 18.1.0, API-Version `2025-07-30.basil`) | Checkout-Sitzungen, Abos, Webhooks, Erstattungen |
| E-Mail | Resend (per HTTP-Aufruf in `mail.mjs`) | Plan Free, 100 Mails/Tag; Pro geplant |
| Oberfläche | normales JavaScript, HTML und CSS, KEIN Framework | `public/kunde.js`, `public/admin/admin.js`, eigene `h()`-Funktion, kein `innerHTML` |
| PDF-Anzeige | pdf.js (`public/vendor/pdfjs`) | |
| Texte | alle Oberflächen- und Fehlertexte in `texte/hu.json`, im Code `t('schluessel')` bzw. `fehler(res,status,'code')` | |
| Hosting | Render (Web Service `valore-tanfolyamok`, Plan Starter, Frankfurt, Datenträger 1 GB) | Details `docs/RENDER.md` |
| Videos (seit 02.11.2026) | Bunny Stream, Video-Bibliothek 797658 „VALORE Előadások" (Speicher, Umwandlung, Player, CDN) | Plan und Protokoll `docs/BUNNY-STREAM-PLAN.md`; nur AN, wenn alle drei `BUNNY_STREAM_*`-Variablen gesetzt sind; alte lokale Videos auf der Render-Festplatte laufen weiter |
| Code-Verwaltung | Git, GitHub `Edmund00/schulungsplattform`, Arbeitszweig `arbeit` (nicht `main`) | Render deployt NUR von Hand |
| Abhängigkeiten | nur `express` und `stripe` (plus pdf.js als Datei) | bewusst klein |

## 3. Wie wir gearbeitet haben (Rollen)
- ChatGPT schrieb den Code in "Scheiben" (kleine Pakete 1 bis 31) über GitHub, OHNE ihn ausführen zu können (kein PowerShell). Seine "Fertig"-Meldung ist nie verlässlich.
- Claude Code (Edmunds Laptop) nimmt jede Scheibe ab: Code lesen, alle Tests ausführen, Fehler beheben, Sicherung, Deploy, Livetest, Protokoll.
- Prüf-Agenten (Claude-Unteragenten, nur lesend) suchen Fehler; jeder Fund wird von Claude Code selbst im Code geprüft, bevor er übernommen wird.
- Browser-Prüfung mit Playwright (Chrome-Fernsteuerung), nur als Text/Messung; zwei getrennte Zugänge (Edmund, Gabriella).
- Edmund entscheidet über Bau und Live; Gabriella über ihr Geschäft (Preise, Texte, Recht).

## 4. Dateilandkarte (Repo-Wurzel, alles `.mjs`)
- **Start und Gerüst:** `server.mjs` (Start, Zeitgeber, Prozess-Handler), `app.mjs` (Middleware-Reihenfolge, Schutzschichten, Router einbinden), `konfig.mjs` (liest/prüft Umgebungsvariablen), `db.mjs` (Schema UND Migrationen beim Start), `texte.mjs`.
- **Kunden und Anmeldung:** `auth.mjs`, `routes-auth.mjs`, `routes-passwort.mjs`, `routes-bestaetigung.mjs`, `routes-konto.mjs` (Daten ändern, Auskunft, Löschung).
- **Kurse und Inhalte:** `routes-kurse.mjs`, `routes-kurspaket.mjs` (Import/Export), `dateien.mjs` (Video/PDF/Audio mit Wiedergabe-Ticket; bei Bunny-Videos stattdessen signierter Einbett-Link), `vorschau.mjs` (Titelbild/Trailer), `zugang.mjs`.
- **Bunny Stream (Videos):** `bunny.mjs` (API-Aufrufe: Video anlegen/löschen/Status, Upload-Signatur, Einbett-Link mit SHA-256-Token), `routes-bunny.mjs` (Admin: `/api/admin/bunny`, `bunny-upload`, `bunny-status` mit Übernahme in die Lektion erst bei „fertig"), `bunny-loeschen.mjs` (Auftragsbuch `bunny_loeschauftraege`, Nachholen alle 10 min, Übernahme-Haken), Tabellen/Trigger in `db.mjs` (`bunny_ausstehend`, Spalten `quelle`, `bunny_video_id`, `bunny_status`), Browser-Upload direkt zu Bunny per TUS (`public/vendor/tus/`, `public/admin/admin.js`), Player-Rahmen in `public/kunde.js` (`bunnyAnsicht`), CSP-Erweiterung nur mit Bunny an (`routes-admin-seite.mjs`).
- **Geld:** `zahlung.mjs` (Kaufen, Webhook), `abo.mjs`, `routes-bestellungen.mjs`, `erstattung-regeln.mjs`, `erstattung-stripe.mjs`, `routes-ellallas.mjs` (Widerruf), `betrag.mjs`, `abgleich.mjs` und `routes-abgleich.mjs` (täglicher Abgleich mit Stripe).
- **Mails und Belege:** `mail.mjs` (Warteschlangen), `mail-recht.mjs` (Pflichtangaben), `beleg.mjs`, `ereignis-liste.mjs`, `routes-ereignisse.mjs`, `erster-zugriff.mjs`.
- **Betrieb und Schutz:** `sicherung.mjs`, `sicherung-format.mjs`, `sicherung-alarm.mjs`, `routes-sicherung.mjs` (verschlüsselte Sicherungen alle 6 h), `routes-verkauf.mjs` (Not-Aus), `admin-zugang.mjs`, `admin-start.mjs`, `routes-admin-login.mjs`, `routes-admin-seite.mjs`, `routes-agent.mjs` und `agent-openapi.mjs` (Agent-Zugang für KI-Assistenten, begrenzt).
- **Oberfläche:** `public/` (`index.html`, `kunde.js`, `kunde.css`, `preis.js`, `admin/`, `fonts/`, `img/`, `vendor/pdfjs`).
- **Tests und Werkzeuge:** `tools/selbsttest-*.mjs` (30 Testgruppen) und `tools/Selbsttest-*.ps1`; `tools/Selbsttest-Alle.ps1` startet alle; `tools/Selbsttest-Stripe-Sandbox.ps1` testet gegen die ECHTE Stripe-Sandbox (braucht Schlüssel aus dem Windows-Speicher). Weitere Werkzeuge: `admin-anlegen.mjs`, `admin-notfall.mjs`, `sicherung-pruefen.mjs`, `sicherung-entschluesseln.mjs`.
- **Doku:** `docs/` (`UEBERGABE-schulungsplattform.md`, `SCHUTZ.md`, `UMGEBUNG.md` mit allen Umgebungsvariablen, `RENDER.md`, `WIEDERHERSTELLUNG.md`, `PRUEFABLAUF.md`, `AGENT.md`, `KURSPAKET-FORMAT.md`).

## 5. Wichtige Abläufe (Kurzfassung)
- **Kaufen:** Browser ruft `POST /api/kurse/:id/kaufen` -> Server bestimmt Preis/Währung aus der Datenbank (nie aus der Anfrage) -> Stripe Checkout (offene Sitzung wird wiederverwendet, Sperre gegen Doppelklick) -> Kundin zahlt bei Stripe.
- **Zugang entsteht NUR im Webhook:** Stripe sendet `checkout.session.completed`/`invoice.paid` an `/webhook` (Signatur wird geprüft) -> Bestellung `bezahlt`, Zugang. Bei abweichendem Betrag: Bestellung `pruefen`, kein Zugang, Admin entscheidet.
- **Abo:** `abo.mjs` verfolgt Rechnungen, Kulanz 3 Tage bei Zahlungsfehler, Kündigung zum Periodenende.
- **Widerruf (Elállás):** 14 Tage, automatische Vollerstattung, Ablehnung nach erstem Zugriff mit Zustimmung (`erstattung-regeln.mjs`).
- **Dateien/Videos:** Zugang wird bei JEDEM Abruf geprüft; Wiedergabe-Ticket 6 h; Download-Schutz nur Abschreckung (technisch nicht verhinderbar).
- **Bunny-Videos (Upload):** Admin wählt im Lektionsblock eine Videodatei -> `POST /api/admin/lektionen/:id/bunny-upload` legt bei Bunny ein Video an, merkt es als „ausstehend" und gibt eine 6 h gültige Upload-Signatur zurück (der API-Schlüssel bleibt auf dem Server) -> der Browser lädt die Datei per TUS direkt zu `video.bunnycdn.com` (Fortsetzen nach Netzabbruch) -> der Browser fragt `bunny-status`; erst wenn Bunny „fertig" meldet, wird das Video in die Lektion übernommen und ein altes Video/eine alte Datei ersetzt (altes Bunny-Video wird gelöscht). Offene Übernahmen erledigt auch der Server im Hintergrund.
- **Bunny-Videos (Wiedergabe):** `POST /api/lektionen/:id/wiedergabe` prüft den Zugang und liefert einen 2 h gültigen Einbett-Link (`player.mediadelivery.net/embed/797658/<video>?token=SHA256(tokenKey+videoId+expires)&expires=...&autoplay=false`); `kunde.js` zeigt ihn im iframe ohne Vollbild, mit Wasserzeichen darüber. Bunny-Bibliothek: Embed-Token AN, CDN-Token AN (der Player signiert die Segmente selbst), Direktzugriff ohne Referer gesperrt, nur unsere Domain erlaubt, kein MP4-Download. Restrisiko: während der Gültigkeit kann ein versierter Nutzer die Segmente laden; nur DRM schließt das.
- **Bunny-Videos (Schritt 8, 03.11.2026, Kostenbremse und Sichtbarkeit):** Der Browser meldet Größe und Typ vor dem Anlegen (`bunny-upload` Body `{groesse, mime}`); über `BUNNY_STREAM_MAX_MB` (Standard 4000) lehnt der Server mit 413 `bunny_zu_gross` ab, Nicht-Video-Typen mit 400, und bei Bunny entsteht dann kein Video. Ein zweiter Upload in dieselbe Lektion fragt vorher nach. Auf der Admin-Übersicht zeigt der Doboz „Videótárhely (Bunny)" offene und mehrfach gescheiterte Löschaufträge (`GET /api/admin/bunny` → `loeschauftraege`) und bietet den nur lesenden Abgleich `GET /api/admin/bunny/abgleich` (verwaiste Videos bei Bunny, fehlende Videos in der Datenbank; es wird nie etwas gelöscht). Scheitert ein Löschauftrag zum 5. Mal, geht ein Alarm an `ALARM_MAILS` (gedrosselt wie der Sicherungsalarm). Ein fertiges Video wird durch Zwischenstatus von Bunny nie zurückgestuft (nur `fehler`/`upload_fehler`).
- **Bunny-Videos (Löschen):** Löschen/Ersetzen trägt das Video per Datenbank-Trigger ins Auftragsbuch ein; `nachholen()` löscht es bei Bunny (sofort, sonst alle 10 min; bis zu 3 Runden je Lauf, weitere Runden nur, wenn währenddessen neue Aufträge eintreffen). Übernahme bei geschlossener Admin-Seite: Hintergrundlauf prüft ausstehende Videos, die älter als 2 min sind, also bis ca. 10 min nach „fertig". Bunny hat keinen Papierkorb.
- **Zeitgeber im Prozess:** Sicherung beim Start und alle 6 h, Abgleich mit Stripe höchstens alle 24 h (erster Lauf 5 min nach Start), Mail-Ausgänge alle 10 min, hängende Widerrufe stündlich. Jeder Neustart/Deploy setzt die Zeitgeber zurück.
- **Plattform-Meldung (Dashboard-Anbindung, 03.11.2026):** Jedes Geschäftsereignis (Tabelle `ereignisse`: registriert, bestaetigt, gekauft, erstattet, abo_gestartet, abo_beendet, abo_gekuendigt; nie `geloescht`) wird zusätzlich in `plattform_ausgang` vorgemerkt und von `plattform-meldung.mjs` per POST an einen Apps-Script-Webhook im PLATTFORM-Sheet von Gabriella gemeldet (getrennt von der Buchhaltung, Script `tools/apps-script/plattform-webhook.gs`). Nutzlast: Zeit UTC, Typ, Kurs-ID, Betrag, Währung, Modus (Test, solange der Stripe-Schlüssel `sk_test_` ist), Quell-ID als HMAC-Hash (nie die Klartext-ID, nie eine E-Mail), geheimer Schlüssel im Body. Aus, solange `PLATTFORM_WEBHOOK_URL` und `PLATTFORM_WEBHOOK_KEY` fehlen. Wiederholung mit wachsender Wartezeit (30 s bis höchstens 6 h), Timer alle 5 Minuten, Idempotenz im Script über die Quell-ID, nie aufgeben; vom Script dauerhaft abgelehnte Daten und verwaiste Zeilen werden verworfen. Lage: `GET /api/admin/plattform`. Plattform-Zahlen dürfen nie in die normale Buchhaltung (expenses, payments, tickets, state, links); Übernahme beim Livegang von Hand. **Zeilen (Kunden-Abos, Zahlungen):** `plattform-zeilen.mjs` legt SQLite-Trigger auf `abos`, `bestellungen` und `benutzer` an (nur solange die Meldung an ist; `db.mjs` entfernt sie bei jedem Start VOR allen Umbauten) und merkt Änderungen in `plattform_zeilen` vor. `zeilenSenden` baut die Zeile frisch aus der Datenbank und sendet sie als `zeile` an das Script (Zeilenschlüssel `abo:ID`, `kauf:ID`, `zahlung:ID`; gleicher Schlüssel überschreibt). Namen werden vorher entschärft (Steuerzeichen, führendes = + - @). Beim Start und täglich werden alle Zeilen neu vorgemerkt (Selbstheilung). Neue Spalten für Gebühr, Netto, Beleg-Link, Auszahlungen und Probleme folgen aus Stripe-Daten (Plan: `docs/PLAN-DASHBOARD-ANBINDUNG.md`).

## 6. Daten und Geheimnisse (nur Orte, keine Werte)
- Datenbank und Dateien: auf Render unter `/var/data` (`DB_DATEI`, `DATEI_ORDNER`). Sicherungen: verschlüsselt (AES-256-GCM, Schlüssel `SICHERUNG_SCHLUESSEL`) im Sicherungsordner auf demselben Datenträger; eine lokale Kopie liegt auf Edmunds Laptop in `C:\Users\diaco\Projekte\sicherung-plattform\`. Externe Sicherung (Bunny) fehlt noch.
- Geheimnisse: nur im Windows-DPAPI-Speicher auf Edmunds Laptop (`%USERPROFILE%\.claude\secrets`, Laden mit `. C:\Users\diaco\Projekte\load-secrets.ps1` und `Get-SecretPlain 'datei.dpapi'`) und als Umgebungsvariablen im Render-Konto. NIE in Dateien, Git oder Chat. Vor jedem lokalen App-Start `RESEND_API_KEY` leeren, sonst können echte Mails abgehen.
- Notizen/Logbuch: Repo `Edmund00/projektzentrale`, Ordner `stripe-lernwerkstatt-notizen/` (`SITZUNGS-INDEX.md`, `STAND-AKTUELL.md`, `SITZUNG-GESPEICHERT-01-11-2026.md` mit WIEDEREINSTIEG, `CHECKLISTE-SAUBER.md` (Übersicht) und `CHECKLISTE-ENTWICKLUNG.md` (Logbuch), `PRUEFRUNDE-01-11-2026.md` (alle Prüfrunden)). Gedächtnis von Claude Code: `C:\Users\diaco\.claude\projects\C--Users-diaco-Projekte-projektzentrale\memory\`.

## 7. Wie man sicher arbeitet (Pflichtablauf)
1. `git pull origin arbeit`, `PROTOKOLL.md` und Wiedereinstieg lesen.
2. Änderung klein halten, im Code lesen, Abhängigkeiten (Aufrufer) ansehen.
3. Test schreiben, der OHNE die Änderung rot und MIT grün ist; `powershell -File tools\Selbsttest-Alle.ps1` (Ausgabe "Alle Offline-Tests bestanden") und `tools\Selbsttest-Stripe-Sandbox.ps1` (25 bestanden).
4. Jede gelöschte Zeile gegen den Vorher-Stand begründen (ChatGPT hat einmal versehentlich eine Funktion gelöscht).
5. Sicherung `vordeploy` per Admin-API (`POST /api/admin/sicherung/jetzt` mit `{"art":"vordeploy"}`), dann Deploy per `powershell -File C:\Users\diaco\Projekte\projektzentrale\werkzeuge\render\render.ps1 POST /services/srv-dbj498ks728c738q01h0/deploys -Ja`, warten bis `live`, `/api/gesundheit` prüfen. Deploy nur nach Test und mit Protokoll.
6. Livetest (Testmodus), Ergebnis mit Zeitstempel (Budapest und UTC) in `STAND-AKTUELL.md`, `PROTOKOLL.md` und Checkliste ANHÄNGEN (nie alte Zeilen ändern).
7. Rückweg: Render-Deploy eines früheren Commits (Marke `live-stand-9579674`, Commit `875ca9e`; Stand vor Bunny: Marke `live-stand-edd6afa-20261102`, Commit `edd6afa`) und Daten aus der Sicherung (`docs/WIEDERHERSTELLUNG.md`, für Bunny-Videos Abschnitt E).
- Nie live schalten, nie löschen, nichts Kostenpflichtiges ohne Edmunds ausdrückliches Ja. Keine Schlüssel im Chat. Das Remote-Control-Fenster von Edmunds Claude Code nie anfassen.

## 8. Bekannte Grenzen (Stand 02.11.2026)
SQLite mit einer Instanz (kein Failover), Admin ohne zweiten Faktor, kein Schutz vor Chargebacks, Not-Aus sperrt bereits ausgegebene Checkout-Links nicht, Resend Free (100 Mails/Tag), keine externe Sicherung. Bunny-Videos: liegen nur bei Bunny (nicht in der Datenbanksicherung), Löschen endgültig, ein Einbett-Link ist 2 h teilbar (an Schlüssel, Video und Ablauf gebunden, nicht an die Person), Upload nach Neuladen der Seite nicht fortsetzbar, Vollbild gesperrt (Entscheidung VIDEO-4 offen), Probezeit bei Bunny endet ca. 16.11.2026. Vollständige offene Liste: `stripe-lernwerkstatt-notizen/CHECKLISTE-SAUBER.md` (Abschnitte 8 bis 14).

## 9. Pflege
Diese Datei bei jeder größeren technischen Änderung ergänzen (Stack, Zeitgeber, Abläufe). Alte Fassungen liegen in Git.
