# Agent-Zugang für Gabriellas ChatGPT (Scheibe 24)

Die Action darf nur **Entwürfe** automatisch vorbereiten. Ein Admin entscheidet über Veröffentlichung und Änderungen an veröffentlichten Kursen. Dieser Schutz wird vom Server erzwungen, nicht durch die GPT-Anweisung.

## Einrichtung in sechs Schritten
1. Als Administrator auf der Schulungsplattform anmelden und **Agent** öffnen.
2. Einen neuen Schlüssel benennen und anlegen. Den angezeigten Schlüssel **nur jetzt** sicher kopieren; er ist später nicht erneut lesbar.
3. In ChatGPT den eigenen GPT für Gabriella erstellen und unter **Actions** die OpenAPI-Datei `https://<eigene-plattform-domain>/agent/openapi.json` importieren.
4. Für die Action Authentifizierung **API Key / Bearer** auswählen und den gerade kopierten `vat_...`-Schlüssel **nur in der geheimen Action-Konfiguration** eintragen, nicht in GPT-Text, Dateien oder Chats.
5. Einen Entwurf mit kurzer Lektion anlegen lassen. In der Plattform unter **Agent** die Änderungs- oder Veröffentlichungsanträge prüfen.
6. Nur nach Sichtprüfung im Admin **Freigeben** klicken. Für unsichere Anträge **Ablehnen** wählen.

## Grenzen und Sicherheit
- Höchstens fünf gleichzeitig aktive Schlüssel, 60 API-Anfragen pro Minute und Schlüssel.
- Bis zu 50 offene Entwürfe, Titel 160, Beschreibung 5000, Lektionstext 20000 Zeichen.
- Nur Titel, Beschreibungen, Preise, Reihenfolgen und Lektionstexte. Keine Dateien, Kundendaten, Stripe-, Zahlungs-, Mail- oder Exportfunktionen.
- Auf `/api/agent` werden nur Bearer-Schlüssel akzeptiert; normale Admin-Cookies nicht. Bearer-Schlüssel sind für `/api/admin` und andere APIs ungültig.
- Änderungen an veröffentlichten Kursen erfolgen zunächst nur als Vorschlag, mit Vorher/Nachher. Erst der menschliche Klick ändert die Daten.
- Alle Versuche werden ohne Schlüsseltext protokolliert. Letzte 200 Einträge sind im Admin einsehbar.
- Bei Verdacht auf Missbrauch den Schlüssel **sofort im Admin widerrufen**; er wirkt ab dem nächsten Aufruf nicht mehr. Anschließend ggf. einen neuen Schlüssel erzeugen.

Stufe 2 (später): Übergabe von Videos/PDFs aus Google Drive und Google-Sheets-Zusammenfassungen. **Noch nicht eingebaut.**
