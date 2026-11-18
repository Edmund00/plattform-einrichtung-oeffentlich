# Render-Deploy der Musterakademie (DEMO-Instanz), Vorbereitung 11.11.2026
Diese Datei enthaelt NUR Namen und Schritte, nie Werte. Alles ist lokal vorbereitet; nichts wurde angelegt. Die Hauptsitzung legt die Dienste nach Edmunds Ja an.
Grundsatz: Die Musterakademie ist Edmunds EIGENES Produkt. Sie bekommt NEUE Dienste (Render, Bunny, Stripe-Endpunkt, Resend-Absender). Gabriellas Dienst `valore-tanfolyamok`, ihre Bunny-Bibliothek 797658 und ihre Konten werden NICHT angefasst, nicht wiederverwendet und nicht verknuepft.

## 1. Dateien
- `render.yaml` im Repo-Stamm (Blueprint): Web-Service `musterakademie-demo`, Node (Version 24 aus `plattform/.node-version`), `rootDir: plattform`, Build `npm ci`, Start `npm start` (`node server.mjs`), Region Frankfurt, Plan **free** (Ist-Zustand, Render-API 12.11.2026; Edmund 12.11.2026: Render bleibt kostenlos), Auto-Deploy aus.
- KEIN Datentraeger (Free): `DB_DATEI=/tmp/muster.db` (SQLite), `DATEI_ORDNER=/tmp/dateien`. Beides ist fluechtig: bei jedem Neustart, Deploy oder Aufwachen nach dem Einschlafen (ca. 15 min ohne Aufruf) ist die Demo zurueckgesetzt, der Demo-Seed entsteht neu. Keine Sicherung, keine Persistenz (bewusst, nur Demo-Daten).
- Kostenpflichtige Alternative (nur nach Edmunds Ja): Plan Starter mit Datentraeger `daten`, 1 GB, unter `/data` (`DB_DATEI=/data/muster.db`, `DATEI_ORDNER=/data/dateien`); steht auskommentiert in `render.yaml`.
- Health-Check: `/api/kurse` (oeffentlich, ohne Anmeldung). `/api/gesundheit` meldet im Betrieb 503, solange keine Sicherung konfiguriert ist; fuer die Demo darum nicht als Render-Pruefpfad verwenden.

## 2. Variablen (nur Namen; Werte traegt die Hauptsitzung bzw. Edmund im Render-Dashboard ein, nie im Chat oder Repo)
Fest in `render.yaml`: `NODE_ENV=production`, `DEMO_MODUS=1`, `DB_DATEI`, `DATEI_ORDNER`, `MAX_UPLOAD_MB`, `TRUST_PROXY=1`, `WIEDERGABE_GEHEIMNIS` (Render erzeugt es zufaellig).
Im Dashboard einzutragen (`sync: false`):
- `BASE_URL` (https-Adresse des Dienstes, ohne Schraegstrich am Ende)
- `STRIPE_SECRET_KEY` (NUR `sk_test_`; mit `DEMO_MODUS=1` bricht der Start bei jedem anderen Schluessel ab), `STRIPE_WEBHOOK_SECRET` (`whsec_`, Abschnitt 4)
- `RESEND_API_KEY`, `MAIL_FROM` (eigener Absender der Musterakademie, eigene Domain/Adresse, nicht Gabriellas)
- `ANBIETER_NAME`, `ANBIETER_ANSCHRIFT`, `ANBIETER_EMAIL`, `ANBIETER_TELEFON`, `VERKAUFSMELDUNG_MAIL`, `SUPPORT_MAIL` (Edmunds Angaben; solange es keine Firmen-Adresse gibt, Test-Postfach und Hinweis "Demo")
- `ADMIN_ERLAUBT` (Edmunds Adresse, fuer das ECHTE Admin-Konto; das Demo-Konto braucht sie nicht)
- Optional spaeter, nur alle drei zusammen: `BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY` (Abschnitt 6); `BUNNY_STREAM_MAX_MB` (Standard hier 500)
- `SICHERUNG_SCHLUESSEL` optional (dann laeuft die verschluesselte Sicherung); fuer eine reine Demo nicht noetig.
`DEMO_*`: es gibt nur `DEMO_MODUS` (0/1). Die Praesentation kennt zusaetzlich `DEMO_URL` (nur beim Bauen, Abschnitt 7).

## 3. Dienst anlegen (Hauptsitzung, nach Edmunds Ja)
1. Neues GitHub-Repo-Verbindung: das Repo `stripe-muster` (privat) mit dem Render-Konto verbinden. Blueprint aus `render.yaml` anlegen (oder Web-Service von Hand mit denselben Werten).
2. Variablen aus Abschnitt 2 eintragen. Erst dann deployen.
3. Pruefen: `https://<adresse>/api/kurse` liefert 3 Beispielkurse (Demo-Seed beim ersten Start einer leeren Datenbank, nur mit `DEMO_MODUS=1`).
4. Demo-Admin und Demo-Kaeufer entstehen automatisch; es gibt kein Passwort (Zugang nur ueber die Knoepfe "Demo ausprobieren").
5. Echtes Admin-Konto fuer Edmund: Render-Shell `ADMIN_PASSWORT=<Passwort> node tools/admin-anlegen.mjs <Edmunds-Adresse>` (muss in `ADMIN_ERLAUBT` stehen). Passwort nur dort tippen.

## 4. Stripe-Webhook (Stripe-TESTMODUS, eigenes Konto/Sandbox von Edmund, nicht Gabriellas)
- Endpunkt-Adresse: `https://<adresse>/webhook`
- Ereignisse (genau diese 13, sonst fehlen Funktionen): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `refund.failed`, `refund.updated`, `charge.refund.updated` (Liste im Code: `WEBHOOK_EREIGNISSE` in `zahlung.mjs`, ein Test haelt sie fest).
- Das Signatur-Geheimnis (`whsec_...`) des Endpunkts als `STRIPE_WEBHOOK_SECRET` eintragen, danach den Dienst neu starten.
- Test: Demo-Kaeufer starten, Kurs kaufen mit Testkarte `4242 4242 4242 4242`, Zugang erscheint, Ereignis im Demo-Admin sichtbar.

## 5. Demo-Verhalten (was die Instanz tut)
- Demo-Admin: sieht Kennzahlen, Ereignisse, Kurse, Bestellungen; JEDE aendernde Aktion (POST/PUT/PATCH/DELETE) wird mit 403 "Demo: nur Ansicht" abgelehnt; Exporte (`format=`), Sicherung, Agent, Login-Protokoll und Stripe-/Bunny-Abgleich sind gesperrt.
- Demo-Kaeufer: wird je Klick neu angelegt (Adresse `demo-<zufall>@example.com`), Mails an solche Adressen werden nie versendet; Passwort-, E-Mail- und Konto-Aenderungen gesperrt. Grenzen: 10 Starts je Adresse und Stunde, 300 neue Demo-Kaeufer je 24 Stunden.
- Besucher zahlen nur mit Testkarten; es fliesst kein Geld. Bestellungen der Besucher sind echte Stripe-TESTzahlungen und erscheinen im Demo-Admin.
- Aufraeumen: Demo-Konten bleiben in der Datenbank (klein). Auf Free reicht ein Neustart des Dienstes (Datenbank in `/tmp`); beim naechsten Start entsteht der Seed neu (vorher Stripe-Testdaten beachten).

## 6. Bunny Stream (Videos), NEUE Bibliothek der Musterakademie
Ablauf nach Edmunds Ja durch die Hauptsitzung (der Code ist fertig und mit Mock getestet; hier wird keine Bunny-API aufgerufen):
1. Im Bunny-Konto der Musterakademie eine NEUE Stream-Bibliothek anlegen (Name z. B. `Musterakademie`), NICHT Bibliothek 797658.
2. Schutz einstellen wie in `docs/BUNNY-STREAM-PLAN.md`: Embed-Token-Authentifizierung AN, CDN-Token AN, "Block direct URL" AN, erlaubte Domain nur die Demo-Adresse, MP4/Direct-Play AUS.
3. In Render eintragen (alle drei zusammen): `BUNNY_STREAM_BIBLIOTHEK_ID` (Nummer der Bibliothek), `BUNNY_STREAM_API_KEY` (API-Schluessel der BIBLIOTHEK), `BUNNY_STREAM_TOKEN_KEY` (Token-Schluessel der Bibliothek). Neu starten.
4. Regel VIDEO-9: Nur der Live-Dienst hat diese Schluessel. Testlaeufe, Wiederherstellung und lokale Entwicklung starten OHNE sie (dann ist Bunny aus und alles laeuft wie bisher; Tests nutzen Mock-Server).
5. Pruefen: Im Admin (echtes Admin-Konto) Lektion mit Video anlegen, Datei hochladen, Wiedergabe-Link pruefen; Demo-Admin kann nicht hochladen (nur Ansicht).
`BUNNY_PLAYER_*`: gibt es im Code nicht und es wird nicht gebraucht; der Player-Host ist fest `player.mediadelivery.net`, der Einbett-Link wird aus Bibliothek-ID und Token-Schluessel erzeugt.

## 7. Praesentation verbinden
`DEMO_URL=https://<adresse> node praesentation/bauen.js` (oder `DEMO_URL` oben in `praesentation/bauen.js`) baut die Knoepfe "Kaeuferseite ausprobieren" und "Admin ansehen (nur Ansicht)" ein. Ohne `DEMO_URL` zeigt die Seite "Demo startet bald".

## 8. Rueckweg
- Dienst im Render-Dashboard pausieren oder loeschen (es gibt keinen Datentraeger; es sind nur Demo-Daten).
- Stripe-Endpunkt im Dashboard deaktivieren. Bunny-Bibliothek der Musterakademie loeschen (nur diese).
- Vorheriger Code-Stand: Commit vor B9 (`6230a23`).
