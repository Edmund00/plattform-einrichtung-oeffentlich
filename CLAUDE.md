# CLAUDE.md: Schulungsplattform (wird bei jeder Sitzung in diesem Repo gelesen)

## Zuerst lesen (nicht fragen, wo wir stehen)
1. `docs/UEBERGABE-schulungsplattform.md`: Ziel, endgültige Entscheidungen, Bausteine, Scheiben 1 bis 6, Regeln, offene Punkte.
2. `PROTOKOLL.md`: was zuletzt gemacht wurde (neueste Zeilen unten).
Dann in 3 bis 5 Sätzen berichten: Stand, was zuletzt lief, nächster Schritt.

## Worum es geht
Eigene Schulungsplattform für Gabriella (VALORE Business Club), die ihr Material (Videos, PDFs, Hörbücher) verkauft. Oberfläche von Anfang an Ungarisch. Gabriella ist die Nutzerin und bedient nur eine einfache Seite. Edmund und die Claude-Modelle sind die Bauer. Eigenbau auf Basis der Lern-App (Node 24, Express 5, SQLite, später PostgreSQL), Zahlung über Stripe Checkout. Diese Entscheidungen sind endgültig und werden nicht neu diskutiert.

## Zusammenarbeit
- Mehrere Modelle arbeiten hier: Edmunds Claude Code (Laptop) und Gabrielas Claude (claude.ai). Das Repo ist die einzige Wahrheit für den Code.
- Arbeitszweig: `arbeit`. Der Zweig `main` ist der freigegebene Stand. Nach `main` wird nur gemerged, wenn Edmund es ausdrücklich sagt. Später deployt Render aus `main`.
- Jede Scheibe bekommt einen automatischen Selbsttest (Vorbilder: `tools/selbsttest-kauf.mjs` und `tools/selbsttest-kurse.mjs`; der alte Lern-App-Test ist ersetzt). Nichts als fertig melden, was nicht getestet ist. Genau sagen, was geprüft und was nicht geprüft ist.
- Jede Änderung wird in `PROTOKOLL.md` mit Datum und Uhrzeit ANGEHÄNGT. Nie Zeilen ändern oder löschen. Fehler mit neuer Zeile `KORREKTUR` richtigstellen.

## Geheimnisse und Betrieb
- Keine Schlüssel, Tokens, Passwörter oder `.env` im Repo, im Chat oder in Doku. Nur Stripe-Testmodus (`sk_test_`). Bei Fund eines Geheimnisses sofort melden, nicht committen.
- Schlüssel liegen bei Edmund (Windows-Speicher auf seinem Laptop, später als Umgebungsvariablen im Render-Konto). Kein Modell braucht sie, um Code zu liefern.
- Render soll den Code später selbst aus `main` holen. Dienste und Datenbank werden dann in `render.yaml` im Repo beschrieben. Wer Code ins Repo bringt, kann so die App aktualisieren, ohne einen Render-Schlüssel zu haben.
- Edmunds Claude Code hat zusätzlich einen Render-API-Schlüssel (nur sein Laptop, nur für Prüfungen). Nichts Kostenpflichtiges anlegen, nichts löschen, nichts Live schalten ohne ausdrückliches Ja von Edmund und Gabriella.

## Umgebungsvariablen
Alle Variablen mit Zweck und Pflicht/Optional: `docs/UMGEBUNG.md`. `konfig.mjs` prüft sie einmal beim Start und nennt in Fehlern nie einen Wert. Keine `.env`, kein dotenv.

## Stil
Antworten kurz und einfach auf Deutsch. Erst erklären, dann Vorschläge, immer nur ein nächster Schritt. Nur Gabriella entscheidet über ihr Geschäft (Preise, Inhalte, Rechnungen, Steuern).

## Stripe: immer das EIGENE Konto des Kunden (Entscheidung 31.10.2026, Edmund)
- Edmunds Sandbox `ZenFlow-Connect-v2` war nur zum Lernen und für die Lern-App-Tests. Die Schulungsplattform für Gabriella nutzt GABRIELLAS EIGENES Stripe-Konto: zuerst eine Sandbox in ihrem Konto (Testmodus), später ihr Live-Konto. Jeder weitere Kunde bekommt ebenso sein eigenes Konto. Kein Mischen von Kunden in einem Stripe-Konto.
- Die App braucht pro Kunde nur zwei Werte als Umgebungsvariablen: STRIPE_SECRET_KEY (`sk_test_` bis zum Livegang) und STRIPE_WEBHOOK_SECRET. Produkte und Preise legt die App nicht vorab in Stripe an: Der Server bestimmt den Preis aus der Datenbank und erzeugt die Checkout-Sitzung mit diesem Betrag.
- Die Schlüssel holt Gabriella oder Edmund mit ihrem Einverständnis im Stripe-Dashboard ihres Kontos (Sandbox). Nie im Chat, nie in Dateien oder im Repo. Edmund trägt sie lokal per Startskript und später in Render als Umgebungsvariablen ein.
- Webhook: lokal mit `stripe listen` gegen Gabriellas Sandbox, online mit der Adresse der App. Dazu braucht es die Adresse erst bei Scheibe 6.

## Stripe-Testzugang laden (nur Edmunds Laptop, nur Testmodus)
`. .\tools\Stripe-Umgebung.ps1` lädt STRIPE_SECRET_KEY (sk_test_, Sandbox "Schulungsplattform" im Stripe-Konto von Gabriella) und STRIPE_WEBHOOK_SECRET (für `stripe listen` lokal) aus dem verschlüsselten Windows-Speicher in die laufende Sitzung. Die Werte werden nie angezeigt. Modelle in der Cloud (z. B. Gabrielas Claude) haben diesen Zugang NICHT und brauchen ihn nicht, um Code zu liefern: Stripe-Tests führt Edmunds Claude Code auf dem Laptop aus.

## AKTUELL (angehaengt 01.11.2026 21:23 Budapest / 20:23 UTC, Claude Code): ZUERST docs/TECHNIK-UEBERSICHT.md lesen
- Dort steht der Stand der Technik (JavaScript/Node 24, Express 5.1, SQLite, Stripe, Resend, Render), die Dateilandkarte, die Abläufe und der Pflichtablauf für Änderungen. WICHTIG: Render deployt NICHT automatisch von 'main', sondern von Hand aus dem Zweig 'arbeit' (siehe docs/RENDER.md); die Zeilen oben zu 'main' und 'render.yaml' sind überholt. Stand, Wecker und offene Punkte: Notizen-Repo Edmund00/projektzentrale, Ordner stripe-lernwerkstatt-notizen, WIEDEREINSTIEG NR. 5 in SITZUNG-GESPEICHERT-01-11-2026.md.
