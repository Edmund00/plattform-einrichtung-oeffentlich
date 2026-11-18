# Wiederherstellung der Schulungsplattform – Scheibe 25

**Vor Livebetrieb einen vollständigen Test mit Edmunds Claude Code durchführen.** Nur Stripe-Testmodus, keine Live-Zahlungen oder Datenlöschung ohne ausdrückliches Ja.

## Was gesichert wird
SQLite-Datenbank aus `DB_DATEI` über ein konsistentes SQLite-`VACUUM INTO`-Abbild. AES-256-GCM verschlüsselt, Prüfsummen und Audit in der Datenbank. Die Medien-Dateien (Videos, PDFs, Hörbücher) sind **nicht** in der Datenbanksicherung enthalten und bleiben zusätzlich als Originale bei Gabriella. Render-Momentaufnahmen ersetzen diese Sicherung nicht.

**Bunny-Videos (seit 02.11.2026):** Videos, die über den Admin zu Bunny Stream hochgeladen wurden (Lektion mit `quelle = 'bunny'`), liegen NUR bei Bunny (Bibliothek 797658 „VALORE Előadások"). In der Datenbanksicherung stehen nur die Metadaten (Lektion, Video-ID, Status). Die Videodateien selbst werden von dieser Sicherung NICHT erfasst; Gabriella behält die Originale. Siehe Abschnitt E.

## A) Dienst ausgefallen
1. Render-Dienst und Gesundheitsroute `/api/gesundheit` prüfen; Fehlermeldungen ohne Geheimnisse erfassen.
2. Letzte erfolgreiche verschlüsselte lokale oder externe Sicherung herunterladen (nur Admin).
3. Stand der Sicherung mit `SICHERUNG_SCHLUESSEL` und `node tools/sicherung-pruefen.mjs <datei.db.enc>` auf einem isolierten Rechner testen.
4. Keine Wiederherstellung starten, bevor Ursache und mögliche neuere Bestellungen/Webhooks geprüft sind.

## B) SQLite beschädigt
1. Server anhalten, weitere Schreibvorgänge/Stripe-Webhooks unterbrechen. Defekte Datenbank **nicht überschreiben**.
2. Aktuellen Datenträger separat sichern, einschließlich WAL/SHM-Dateien und Logdaten; kein Löschen.
3. Sicherung entschlüsseln: `node tools/sicherung-entschluesseln.mjs <datei.db.enc> <neue-datei.db>`. Die Ausgabe muss neu sein.
4. Die neue Datei mit `node tools/sicherung-pruefen.mjs <datei.db.enc>` auf Integrität, Fremdschlüssel und Tabellen prüfen.
5. Mit separater `DB_DATEI` und Stripe-Testmodus die App starten, Kurse/Bestellungen und Zugänge prüfen; noch nicht produktiv schalten. **PFLICHT: diesen Teststart OHNE die Variablen `BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY` machen.** Mit den Variablen arbeitet die Test-Instanz gegen die ECHTE Bunny-Bibliothek: der Startlauf (`nachholen`) und jedes Löschen/Ersetzen löschen dort sofort und endgültig Videos (kein Papierkorb). Siehe E.0.
6. Erst nach Edmunds Freigabe kontrolliert auf einen neuen DB-Pfad umstellen.

## C) Render ganz weg
1. Neuen Dienst/Datenträger erst nach schriftlicher Freigabe anlegen; Kosten klären.
2. Konfiguration aus `docs/UMGEBUNG.md` im geheimen Variablenspeicher einrichten; neuen persistenten Ordner verwenden.
3. Verschlüsselte Kopie von außerhalb zurückholen, Schlüssel separat bereitstellen, auf **neuen** Pfad entschlüsseln.
4. Integrität und Fremdschlüssel prüfen, Teststart der Plattform durchführen.
5. Stripe-Webhook-Endpunkt/Signatur im **Testmodus** prüfen; offene Bestellungen und idempotente Ereignisse gegen Stripe-Sandbox abgleichen.
6. Original-Mediendateien separat wieder anbinden; Wiedergabe testen. Erst danach DNS/Live-Freigabe.

## D) Falsche Änderung
1. Aktuelle Datenbank und Audit sichern; Fehler und Zeitpunkt dokumentieren.
2. Passende historische Kopie nach Zeitpunkt auswählen; Wiederherstellungsprüfung getrennt durchführen.
3. Geschäftsvorfälle seit dem Sicherungszeitpunkt abgleichen (Bestellungen, Zahlung, Erstattung, Freigaben).
4. Keine pauschale Rücksetzung ohne diese Prüfung; Edmund entscheidet über gezielte Reparatur.
5. Jede Prüf- oder Test-Instanz mit einer Kopie der Datenbank läuft OHNE `BUNNY_STREAM_*` (siehe B.5 und E.0), sonst löscht sie echte Videos bei Bunny.

## E) Bunny-Videos (Bunny Stream, Bibliothek 797658) – Rückweg und Grenzen (angelegt 02.11.2026 nach Schritt 7 und Prüfrunde)
Was gilt, seit die Bunny-Anbindung live ist (Commit `59396db`, Deploy 02.11.2026 23:29 Budapest; Sicherung davor: `vsic-20261102-222807Z-vordeploy`):
0. **REGEL (Gesamtprüfung 03.11.2026, Schwere hoch): Nur EINE Instanz darf die Bunny-Variablen haben, nämlich der Live-Dienst auf Render.** Jede andere Instanz (lokaler Test, Wiederherstellungsprobe mit eingespielter Datenbank, zweiter Render-Dienst) startet OHNE `BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY` und `BUNNY_STREAM_TOKEN_KEY`. Grund: Die Datenbank enthält Löschaufträge und Trigger; mit den Variablen löscht die Instanz beim Start (`app.mjs`, `nachholen`) und bei jedem Löschen/Ersetzen sofort und endgültig Videos in der echten Bibliothek 797658. Bunny hat keinen Papierkorb. Ohne die Variablen ist Bunny in der Instanz AUS und nichts geht nach außen.
1. **Code zurück auf den Stand ohne Bunny** (Commit `edd6afa`, Marke `live-stand-edd6afa-20261102`): Render-Deploy dieses Commits. Der alte Code kennt die Tabellen/Spalten nicht, startet aber (zusätzliche Spalten und Tabellen stören ihn nicht). Folgen: Lektionen mit Bunny-Video erscheinen als Datei; das Wiedergabe-Ticket kommt noch mit 200, erst der Dateiabruf liefert 404 `datei_fehlt` (Platzhalter-Pfad `bunny` ist kein gültiger Dateiname); beim Löschen solcher Lektionen wird das Video bei Bunny NICHT mitgelöscht (die Datenbank-Trigger tragen es nur ins Auftragsbuch `bunny_loeschauftraege` ein, das erst der neue Code abarbeitet). Also nach einem Rückweg die Bunny-Bibliothek von Hand prüfen (Dashboard oder `GET https://video.bunnycdn.com/library/797658/videos`).
2. **Render-Variablen beim Rückweg:** `BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY` können stehen bleiben (der alte Code ignoriert sie). Sollen sie weg, alle DREI entfernen; der neue Code lehnt es ab, wenn nur ein Teil gesetzt ist (Start bricht mit Fehlermeldung ab). Ohne die drei Werte ist Bunny AUS: Upload zu Bunny ist dann im Admin nicht mehr sichtbar, vorhandene Bunny-Lektionen liefern 503 `bunny_aus`.
3. **Ältere Datenbanksicherung einspielen:** Videos, die NACH dem Sicherungszeitpunkt hochgeladen wurden, bleiben bei Bunny als verwaiste Videos liegen (sie kosten Speicher, werden aber nie mehr angezeigt). Vor dem Einspielen die Video-IDs der aktuellen Datenbank notieren (`SELECT lektion_id, bunny_video_id FROM dateien WHERE quelle = 'bunny'` plus `bunny_ausstehend`) und nach dem Einspielen mit der Bibliothek vergleichen; überzählige Videos erst nach Edmunds Ja im Bunny-Dashboard löschen. Umgekehrt: Lektionen, deren Video bei Bunny fehlt, bleiben in der Datenbank auf „fertig"; Kunden bekommen noch einen Einbett-Link und sehen dann den Fehler des Bunny-Players, die Admin-Statusroute (`bunny-status`) liefert 404 `bunny_kein_video`. Das Video muss neu hochgeladen werden.
4. **Löschen und Ersetzen sind endgültig:** Löscht Gabriella eine Lektion, einen Kurs oder ersetzt sie ein Video, wird das alte Video bei Bunny gelöscht (sofort im Hintergrund, Nachholen alle 10 Minuten bei Störung). Bunny hat keinen Papierkorb. Einziger Rückweg ist die Originaldatei bei Gabriella.
5. **Schlüssel verloren oder erneuert:** Token-Schlüssel und API-Schlüssel der Bibliothek liegen DPAPI-verschlüsselt auf Edmunds Laptop (`%USERPROFILE%\.claude\secrets\bunny-stream-*.dpapi`) und als Render-Variablen. Wird der Token-Schlüssel bei Bunny zurückgesetzt (Dashboard, Bibliothek > Security), sofort `BUNNY_STREAM_TOKEN_KEY` auf Render nachziehen und neu deployen, sonst liefern alle Einbett-Links 403.
6. **Bunny selbst weg oder Guthaben leer:** Videos sind dann nicht abspielbar (Kunden sehen die Fehlermeldung der Wiedergabe). Guthaben im Bunny-Dashboard aufladen; Probezeit endet ca. 16.11.2026. Kein automatischer Ersatz: die Render-Festplatte hält keine Kopie der Bunny-Videos.
7. **Prüfung nach jedem Rückweg:** Admin öffnet eine Bunny-Lektion (Status „kész"), Kundensicht mit Testkunde, und `GET /api/admin/bunny` muss `{"an":true}` liefern, wenn Bunny gewollt ist.

- [x] Rollback-Test durchgeführt am 03.11.2026 06:48-06:50: edd6afa live (Gesundheit 200, Bunny-Route 404, Kurslisten vollständig), zurück auf 59396db, Bunny an; je Deploy ca. 2,5 min, keine Sicherung nötig
- [x] Löschweg bei Bunny live geprüft am 03.11.2026 06:46: Lektion verstecken, löschen, Video bei Bunny nach 9 s 404, Bibliothek leer

## Wiederherstellungsübung (Zeitbedarf)
Für einen kleinen Datenbestand mindestens 30–90 Minuten für Download, Prüfung, isolierten Test und Nachkontrolle einplanen; bei großer DB, Netzwerkausfall oder Stripe-Abgleich erheblich länger. Keine garantierte Wiederherstellungszeit.

- [ ] Verschlüsselte Sicherung von extern heruntergeladen
- [ ] Falscher Schlüssel und manipulierte Datei sicher abgewiesen
- [ ] Richtiger Schlüssel ohne Veröffentlichung verwendet
- [ ] `integrity_check` = ok und `foreign_key_check` leer
- [ ] Benutzer-, Kurs-, Lektions-, Bestell-, Zugangs- und Abo-Zahlen stimmen
- [ ] Mit neuer DB startet die App ohne Datenverlust
- [ ] Kurse und Bestellungen im Test sichtbar
- [ ] Stripe-Testwebhook und idempotente Verarbeitung geprüft
- [ ] Medien separat geprüft
- [ ] Audit/Alarm nach Wiederanlauf geprüft
- [ ] Edmunds ausdrückliche Freigabe zur produktiven Wiederaufnahme dokumentiert

### Automatischer Restore-Nachweis (A7-02, angelegt 12.11.2026 09:05 Budapest / 08:05 UTC)
Befehl: `node --disable-warning=ExperimentalWarning tools/selbsttest-restore.mjs` (läuft auch in `tools/Selbsttest-Alle.ps1`). Braucht keinen echten Schlüssel und keine Render-Disk: Temp-Datenbank, zufälliger Testschlüssel.
Ablauf: Temp-DB mit Kunde, Admin, zwei Kursen, Lektion, Bestellung, Zahlungs- und Abo-Zugang, Abo -> echte Sicherung mit `sicherungDienst()` (VACUUM INTO, AES-256-GCM, Protokoll) -> Entschlüsseln mit `tools/sicherung-entschluesseln.mjs` in einen LEEREN neuen Ordner -> `tools/sicherung-pruefen.mjs` -> Vergleich ALLER Tabellen (Zeilenzahl und SHA-256 über den Inhalt), zentrale Felder (E-Mail, Stripe-Kunde, Kurstitel mit Sonderzeichen, Betrag, Status, Zugang, Abo-Ablauf), Start von `db.mjs` auf der wiederhergestellten Datei. Negativfälle: falscher Schlüssel, ein gekipptes Bit, gekürzte Datei, kein Schlüssel und vorhandene Zieldatei scheitern ohne neue oder überschriebene Datei. Gegenprobe im Test: eine geänderte Zelle fällt im Vergleich auf.
Ergebnis 12.11.2026 09:05 Budapest: 21 bestanden, 0 fehlgeschlagen (Gegenprobe von Hand: `sicherung-entschluesseln.mjs` mit Flag `w` statt `wx` -> Test rot).
Nachtrag 12.11.2026 (Angreifer-Prüfung): zusätzlich Schemavergleich ALLER sqlite_master-Einträge (48 Tabellen, 52 Indizes, 21 Trigger; Name + normalisiertes SQL) mit Gegenprobe (gelöschter Trigger und Index werden erkannt) und Pflicht, dass benutzer, kurse, bestellungen, zugaenge, abos je mindestens eine Zeile haben: 24 bestanden, 0 fehlgeschlagen.
Damit sind LOKAL belegt: falscher Schlüssel/manipulierte Datei abgewiesen, `integrity_check`/`foreign_key_check`, Zeilenzahlen und Inhalt, Start des App-Codes auf der neuen DB. NICHT belegt (Kästchen oben bleiben leer, bis die Übung mit echter externer Sicherung gemacht ist): Download von extern/Render-Disk, echter `SICHERUNG_SCHLUESSEL`, Stripe-Testwebhook, Medien, Audit/Alarm nach Wiederanlauf, Edmunds Freigabe.

## Manueller Stripe-Abgleich nach einem Datenverlust

Nach Entschlüsseln und Einspielen einer geprüften SQLite-Sicherung zunächst den Dienst im Stripe-Testmodus starten und im Admin **Stripe-egyeztetés** / „Jetzt abgleichen“ ausführen. Abweichungen mit Stripe-ID, Bestell-ID, Betrag, Währung und Zeit einzeln prüfen und dokumentieren. Insbesondere „Stripe bezahlt, Plattform kennt es nicht“ sofort untersuchen; nur nach Edmunds ausdrücklicher Freigabe und unabhängig kontrolliert eine Wiederherstellung planen. Dieser Abgleich baut keine Bestellungen nach, vergibt keine Zugänge und erstattet kein Geld. Danach Gesamtbeträge, Erstattungen, Abo-Status und Stripe-Webhooks abgleichen, erst dann Dienst wieder freigeben.

## Ausgesperrt – drei Wege zurück und Totalausfall

1. **Passwort vergessen:** Die Login-Maske für jede der erlaubten bestätigten Admin-E-Mail-Adressen nutzen; auch Gabriellas zweite E-Mail bleibt unabhängiger Zugang. Link per Mail öffnen und neues Passwort setzen. Der erfolgreiche Reset hebt Sperren dieses Kontos auf und beendet alte Sitzungen.
2. **Render-Notfallflag:** Nur Edmund öffnet Render über seinen unabhängigen Plattformbetreiber-Zugang, setzt temporär `NOTFALL_ENTSPERREN=1` und startet den Dienst neu. Dadurch werden alle Admin-Sitzungen und Sperren gelöscht; Protokoll + Alarm. Danach Notfallflag entfernen und normal einloggen.
3. **Notfall-Shellwerkzeug:** Nur in Render-Shell oder auf einer isolierten Datenbankkopie `ADMIN_ERLAUBT`, `DB_DATEI` und vorübergehend `ADMIN_PASSWORT` sicher setzen. `node tools/admin-notfall.mjs <erlaubte-admin-email>` ausführen. Das Passwort steht ausschließlich in der Umgebungsvariable (nicht im Argument), das Werkzeug setzt und bestätigt ein vorhandenes erlaubtes Konto, beendet dessen Sitzungen und hebt die Sperre auf. Danach die temporäre Passwortvariable entfernen.
4. **Vollständiger Ausfall:** Unabhängiger Render-Zugang für Datenträger/Shell nutzen. Wenn Render nicht erreichbar ist: die verschlüsselte externe Kopie aus Scheibe 25 von einem anderen Speicherort herunterladen, mit separat aufbewahrtem Schlüssel gemäß diesem Runbook auf eine neue Test-Datenbank entschlüsseln und prüfen. Stripe-Dashboard bleibt unabhängig das Hauptbuch für Zahlungen; nach Wiederanlauf den manuellen Abgleich aus Scheibe 26 durchführen. Keine echte Zahlung oder Produktivwiederherstellung ohne Freigabe.

**Vor Live dreimal durchführen und abhaken:**
- [ ] Passwort-Reset mit Admin-E-Mail und Zugangstest
- [ ] NOTFALL_ENTSPERREN=1 mit Sitzungsende und anschließendem Entfernen der Variable
- [ ] admin-notfall.mjs nur mit erlaubter Adresse, neues Passwort geprüft
- [ ] Zweite unabhängige Admin-Adresse erreichbar
- [ ] Externe verschlüsselte Sicherung auf isoliertem Rechner geprüft
- [ ] Render-Zugang und Stripe-Dashboard separat erreichbar

## Notfall: Verkauf stoppen

**Weg 1, Admin erreichbar:** Als erlaubter Admin anmelden, oben **Értékesítés** öffnen, **Értékesítés szüneteltetése** wählen, Pflichtgrund eingeben und bestätigen. Prüfen, dass `GET /api/verkauf-status` nur `{"pausiert":true}` liefert und kein neuer Stripe-Checkout mehr entsteht. Bereits laufende Zahlungen und Webhooks weiter überwachen.

**Weg 2, Admin nicht erreichbar:** Edmund setzt im Render-Dashboard die Umgebungsvariable `VERKAUF_PAUSIERT=1` und lässt den Dienst neu starten. Der ENV-Weg wirkt zusätzlich zum Datenbankschalter; den DB-Zustand hebt dies nicht auf. Keine Änderungen an Stripe-Abos, Webhooks oder gekauften Zugängen.

**Wiederaufnahme:** Ursache der Pause sicher klären; Admin-Schalter wieder auf Fortsetzen setzen und gegebenenfalls im Render-Dashboard `VERKAUF_PAUSIERT=0` setzen/entfernen und Dienst neu starten. Erst danach kontrollierten Stripe-Testkauf prüfen. Alte Checkout-Sitzungen können während der Pause noch bezahlt werden.

- [ ] Admin-Pause mit Pflichtgrund und 503 auf beide Checkout-Modelle getestet
- [ ] Render-Variable `VERKAUF_PAUSIERT=1` unabhängig getestet
- [ ] Webhook und Erstattungen während Pause getestet
- [ ] Ungarischer Hinweis und Kaufbutton-Ausblendung geprüft
- [ ] Alarm an die vorgesehenen Empfänger bestätigt
- [ ] Wiederaufnahme über beide Schalter erfolgreich geprüft

## Abo-Erstattung nachbuchen (Scheibe 29)

Im Admin-Reiter `Stripe-egyeztetés` werden Abweichungen des Typs `erstattung_nicht_verarbeitet` mit einer Bestätigungs-Schaltfläche für eine manuelle Nachbuchung angezeigt. Nur für eine zuvor im Stripe-Abgleich gefundene `re_`-Erstattung; serverseitiger Admin- und Herkunftsschutz erforderlich. Der Server liest die Erstattung und Zahlung bei Stripe, ordnet eine bestehende Bestellung zu und verwendet dieselbe Erstattungsbuchung wie der Webhook. Es wird keine neue Bestellung angelegt und bei Stripe keine Erstattung ausgelöst. Jeder Nachbuchungsversuch wird in `abgleich_nachbuchung` protokolliert, Änderungen/Löschen per Trigger verboten. Danach Stripe-Abgleich erneut ausführen. Die Abo-Kündigung bleibt ein separater menschlicher Schritt.

Vor produktiver Nutzung müssen die aktuellen Selbsttests und Stripe-Sandbox-Testfälle durch Claude Code bestätigt werden.
