# Übergabe: Schulungsplattform für Gabriella (Stand 31.10.2026)

Diese Datei enthält KEINE Schlüssel, Passwörter oder Zugänge und darf nie welche enthalten. Sie ist für Gabrielas Claude (Projekt "Schulungsplattform") und jedes andere Modell, das hier weiterbaut.

## Worum es geht
Gabriella (VALORE Business Club) hat über 20 Jahre Schulungsmaterial: Videos, PDFs, Hörbücher und mehr. Sie spricht Ungarisch. Edmund und Claude bauen für sie eine eigene Plattform, auf der sie das Material verkaufen kann. Gabriella ist der erste Kunde. Später kann dieselbe Plattform als eigene Kopie an weitere Kunden gehen.

## Rollen und Regeln
- Edmund und Claude sind die Bauer. Gabriella ist die Nutzerin und bedient nur eine einfache Seite (ungarisch, großer Knopf "Kész").
- Nur Gabriella entscheidet über ihr Geschäft (Preise, was verkauft wird, Rechnungen, Steuern). Löschen, Senden, Teilen und alles Live nur mit ausdrücklichem Ja von Edmund oder Gabriella.
- Zuerst nur Stripe-Sandbox (Testmodus). Nichts Live, kein echtes Geld, bis Edmund und Gabriella es ausdrücklich freigeben.
- Keine Schlüssel, Tokens oder Passwörter in Dateien oder im Chat. Eingaben solcher Werte macht Edmund selbst.
- Antworten kurz und einfach auf Deutsch. Erst erklären, dann Vorschläge. Genau sagen, was geprüft und was nicht geprüft ist.
- Jede Änderung mit Datum und Uhrzeit in das Protokoll (nur anhängen, nie Zeilen ändern oder löschen).

## Entscheidung (endgültig, 31.10.2026)
- Eigenbau statt fertigem System. Gründe: in unserer Hand, von Anfang an Ungarisch, ein Agent kann alles über eine API bedienen, später an andere Kunden verkaufbar.
- Technik: Node 24 und Express 5 auf Basis der Lern-App ("Lern-Kaffee"). Zuerst SQLite, später PostgreSQL. Zahlung: Stripe Checkout Sessions (nicht die alte Charges API). Pro Kunde eine eigene Kopie mit eigener Datenbank und eigenem Stripe-Konto, daher ist Stripe Connect nicht nötig.
- Betrieb später (erst wenn ein Kunde bereit ist): Render in Frankfurt für App und PostgreSQL, Bunny für Videos, PDFs und Hörbücher (Frankfurt wählbar), Stripe für Zahlungen, Resend für E-Mails. Geschätzt 30 bis 55 Dollar im Monat plus Stripe-Gebühren (Schätzung aus den Preisseiten, nicht verbindlich).
- Gemietet wird erst, wenn Edmund und Gabriella Kosten und Aufteilung der Einnahmen schriftlich vereinbart haben.
- Nicht gewählt: fertige Systeme (CourseLit: Ungarisch unbestätigt; WordPress mit Tutor LMS: Ungarisch laut Doku von der Gemeinschaft übersetzt), Gabriellas bestehendes Hosting bei mediacenter.hu (nur PHP, kein Node, zu wenig Platz, wird nicht genutzt).

## Bausteine
1. Server (Haus): Express-App.
2. Datenbank: Benutzer, Sitzungen, Kurse, Lektionen (Typ Text, Video, PDF, Audio, Datei), Dateien, Zugänge (wer darf welchen Kurs), Bestellungen, verarbeitete Stripe-Ereignisse.
3. Dateispeicher: zuerst ein Ordner auf dem Laptop, später Bunny. Auslieferung nur an Zahlende, über Links, die nach kurzer Zeit ablaufen.
4. Kasse: Stripe Checkout (einmalig, Abo, später Raten) und Webhook. Die Zahlung schaltet den Zugang in der Datenbank frei. Das ist das Glied, das bisher fehlte.
5. Gabriellas Seite (ungarisch): Kurs anlegen, Dateien hochladen, Titel, Text und Preis eintragen, veröffentlichen.
6. Bereich der Teilnehmer (ungarisch): anmelden, "Meine Kurse", ansehen, anhören, herunterladen.
7. API mit eingeschränktem Schlüssel für Agenten. Autonom erlaubt: Entwürfe, Texte, Hochladen. Mit Bestätigung durch einen Menschen: Veröffentlichen, Freischalten, Löschen.
Alle Texte der Oberfläche in einer eigenen Sprachdatei (hu), damit Übersetzen leicht bleibt.

## Reihenfolge ("Scheiben"), jeweils mit automatischem Selbsttest
Stand 31.10.2026 (ersetzt die frühere Reihenfolge, Scheiben 1 bis 5 sind fertig und geprüft):
1. Datenbank und API für einen Kurs. (fertig)
2. Gabriellas Seite auf Ungarisch. (fertig)
3. Bezahlen und Freischalten (Sandbox). (fertig)
4. Umgebungsvariablen (konfig.mjs), Kundenseiten auf Ungarisch, Bestellungen und Erstattung. (fertig)
5. Dateien hochladen und nur an Käufer ausliefern. (fertig)
6. Kurse und Lektionen verwalten: Kurs archivieren (Käufer behalten den Zugang), Löschen nur für Entwürfe ohne Käufer, Lektion bearbeiten, Zugang entziehen, manuelle Freigabe von Zahlungen im Status "pruefen".
7. Der Agent bedient die API (eingeschränkter Schlüssel; Veröffentlichen, Freischalten, Löschen nur mit menschlicher Bestätigung).
8. Umzug in die gemietete Cloud (Render, Bunny), erst nach schriftlicher Absprache über Kosten.

## Regeln aus der Lern-App, die bleiben müssen
- Der Webhook steht VOR `express.json()`, weil die Signatur über den unveränderten Rohtext geht. Signatur immer prüfen, bei Fehler 400.
- Jede Stripe-Ereignis-ID kommt in eine Tabelle mit UNIQUE. Doppelte Ereignisse werden erkannt. Verarbeiten und Vormerken in EINER Transaktion; bei Fehler 500, damit Stripe es erneut sendet.
- Unbekannte Kunden oder Objekte (zum Beispiel von anderen Apps im selben Stripe-Konto) ignorieren, nie den Webhook abstürzen lassen.
- Stripe garantiert keine Reihenfolge der Ereignisse. Ein genauerer Status (zum Beispiel Testphase) darf nicht von einem späteren, weniger genauen Ereignis überschrieben werden.
- Nur Test-Schlüssel (`sk_test_`) akzeptieren, sonst Abbruch. Schlüssel nur per Startskript in den Prozess, keine `.env` im Repo.
- Jeder Benutzer sieht nur seine eigenen Bestellungen und Kurse. Der Server prüft bei jedem Aufruf, wer fragt.
- Beträge und Preise bestimmt der Server, nie der Client.
- Kartendaten werden nie gespeichert. Sie liegen bei Stripe.
- Selbsttest wie in der Lern-App (dort 41 Prüfungen, eigene Test-Datenbank), auch für Fehlfälle.

## Was schon da ist
- Auf Edmunds Laptop: Ordner `Projekte\schulungsplattform` mit einer Kopie des Codes der Lern-App (Server, Datenbank, Anmeldung, Selbsttest, Start-Skripte), noch ohne Änderungen und ohne installierte Pakete. Gabrielas Claude kann diesen Ordner nicht sehen. Code wird deshalb als Dateien im Chat geliefert, die Edmund einsetzt, oder später über ein privates GitHub-Repo.
- Notizen im Repo `Edmund00/projektzentrale` unter `stripe-lernwerkstatt-notizen/`: Bauplan, Doku-Notizen zu Stripe, Lesenotizen zu drei Stripe-Prüfungsprojekten, Zusammenfassung der Stripe Sessions 2026.
- Edmunds Claude Code hat einen Zugang zur Render-API (nur Edmunds Laptop). Infrastruktur-Aktionen macht Edmunds Claude Code, nicht dieses Projekt.

## Offene Punkte
- Plan "Hobby" bei Render für einen echten Kunden zulässig? (Nutzungsbedingungen nicht gelesen.)
- Bunny: Speicherung wirklich in der EU, Preise für Stream und Speicher bei Gabriellas Menge. Wie viel Material hat Gabriella (GB), in welchen Formaten, wo liegt es (Festplatte und Drive)?
- Rechte: Gehört alles Material Gabriella? Fremde Inhalte darf sie nicht verkaufen.
- Rechnungen, Steuern (Ungarn), Impressum, AGB, Datenschutz: liegt bei Gabriella als Betreiberin, bitte beraten lassen. Nicht geprüft.
- Eigene Domain und Unterseite für die Plattform (Domain von Edmund, noch nicht festgelegt).
- Muss Gabriella mit E-Mail und Passwort oder mit Anmeldelink arbeiten? Entscheidung offen.

## Erste Aufgabe für Gabrielas Claude
Nur lesen und bestätigen: Fasse in 10 Zeilen auf Deutsch zusammen, was gebaut werden soll, und nenne 3 Fragen, die du vor Scheibe 1 brauchst. Noch keinen Code schreiben.
