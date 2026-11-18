# Bunny Stream einrichten (für Videos)

Diese drei Werte brauchst du, BEVOR du den "Deploy to Render"-Knopf drückst (siehe README-VERKAUF.md).
Trage sie dort ein, wenn Render danach fragt.

## Schritt 0: Konto anlegen
1. Gehe zu https://dash.bunny.net/auth/register und lege ein Konto an.
2. Im Dashboard: **Delivery → Stream** → **"Create Your first Video Library"**. Gib ihr einen Namen.
   **Achtung:** einmal gewählte Replizierungs-Regionen lassen sich später nicht mehr entfernen — bei
   Unsicherheit lieber zunächst nur eine Region wählen.

## Schritt 1: Die Bibliotheks-ID kopieren
Auf der Übersichtsseite deiner Bibliothek steht die ID in der Adresszeile des Browsers, z. B.
`https://dash.bunny.net/stream/123456/...` → die Zahl `123456` ist deine Bibliotheks-ID. Sie steht
zusätzlich auf der Seite **API** deiner Bibliothek im Feld "Video library ID".
→ das ist dein Wert für `BUNNY_STREAM_BIBLIOTHEK_ID`.

## Schritt 2: Den Stream-API-Schlüssel kopieren
Öffne deine Bibliothek, Reiter **API**. Dort steht ein Feld "API key" — das ist dein Wert für
`BUNNY_STREAM_API_KEY`.

## Schritt 3: Den Token-Schlüssel kopieren — WICHTIGE VERWECHSLUNGSGEFAHR
Öffne deine Bibliothek, Reiter **Security**. Dort gibt es eine Karte "Token authentication key" — **auch
dieses Feld heißt dort verwirrenderweise "API key"**, obwohl es ein ANDERER Wert ist als in Schritt 2!
Verwechsle die beiden Felder nicht: Schritt 2 ist der Reiter **API**, Schritt 3 ist der Reiter **Security**.
→ das ist dein Wert für `BUNNY_STREAM_TOKEN_KEY`.

## Kosten
- Wiedergabe, Umwandlung und alle Sicherheitsfunktionen sind kostenlos — bezahlt wird nur für den
  tatsächlichen Datenverkehr.
- Die ersten 14 Tage sind eine kostenlose Testphase. Danach gilt Pay-as-you-go, mit **mindestens 1 USD
  Nutzung pro Monat**, sobald das Konto aktiv ist (auch bei wenig echter Nutzung).
- Zahlung per PayPal, Kreditkarte oder Bitcoin.
- Ob für das reine ANLEGEN einer Bibliothek schon eine Zahlungsmethode hinterlegt sein muss, ist aus der
  Dokumentation nicht eindeutig — wahrscheinlich nicht nötig, aber nicht zu 100 % bestätigt.

Quelle: bunny.net/docs/stream/quickstart, /docs/stream/authentication, /docs/stream/token-authentication,
/docs/stream/pricing (gelesen 18.11.2026). Bibliotheks-ID-Anzeigeort live an einer echten Bibliothek
bestätigt (18.11.2026).
