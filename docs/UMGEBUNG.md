# Umgebungsvariablen der Schulungsplattform

Alle Einstellungen kommen aus Umgebungsvariablen. Es gibt keine `.env`-Datei im Repo und kein dotenv-Paket. `konfig.mjs` liest und
prüft **alle** Variablen **einmal** beim Start. Ist etwas falsch, endet der Start mit Exitcode 1 und einer deutschen Meldung. Die
Meldung nennt nur den NAMEN der Variable, nie ihren Wert. Die Beispiele unten sind Platzhalter, keine echten Werte.

| Variable | Pflicht? | Zweck | Beispiel (Platzhalter) |
|---|---|---|---|
| `VERKAUF_PAUSIERT` | Optional (Standard `0`) | Erzwingt Not-Aus für neue Käufe bei `1`; bestehende Zahlungen, Abos, Webhooks und Kundenfunktionen bleiben aktiv. | `0` oder `1` |
| `EINRICHTUNGSMODUS` | optional (Standard aus) | WP1 Sicherheitsblock. `1` schaltet den geschuetzten Setup-Modus frei: fehlen BEIDE Stripe-Variablen UND ist kein Admin in der Datenbank, startet der Server im Setup-Modus (nur `GET /health` mit `{"modus":"setup"}`, alles andere 404; kein Stripe-Client, kein Shop, kein Webhook). Ohne diesen Schalter bleibt das Verhalten bei fehlenden Stripe-Variablen exakt wie bisher (Abbruch Exit 1). Der Schalter wird vom spaeteren Installer (WP10) und von der Hosting-Vorlage automatisch gesetzt. In KONFIGURIERT/AKTIV wirkt der Schalter nicht (Schutz gegen Uebernahme einer fertigen Instanz). | `1` |
| `EINSTELLUNGEN_SCHLUESSEL` | optional | WP2 Sicherheitsblock. Base64 von genau 32 Zufallsbytes. Ueberschreibt die Datei `daten/.hauptschluessel` fuer die AES-256-GCM-Verschluesselung des Einstellungsspeichers. Bevorzugt im Hosting (Render/etc.) setzen, damit der Hauptschluessel nicht auf derselben Platte wie die Datenbank liegt. Wird der Schluessel verloren, sind alle verschluesselten Einstellungen (Stripe-Schluessel, Webhook-Secret, Mail-Schluessel, Bunny-Keys, Wiedergabe-Geheimnis, Plattform-Webhook-Key) nicht mehr lesbar. Nie in einem Repository oder Chat ablegen. | `B64vonExakt32Bytes==` |

| `DEMO_MODUS` | optional (Standard `0`) | `1` schaltet die DEMO-Instanz ein (B9): Beispielkurse und Demo-Konten beim ersten Start einer leeren Datenbank, Knoepfe "Demo ausprobieren", Demo-Admin nur Ansicht, Mails an Demo-Adressen werden nie versendet. Nur mit `sk_test_`-Schluessel erlaubt (sonst bricht der Start ab). Nie auf der Instanz mit echten Kundendaten setzen. Siehe `docs/RENDER-DEPLOY.md`. | `1` |
| `DEMO_MAX_KAEUFER_TAG` | optional (Standard `150`) | Nur mit `DEMO_MODUS=1`: Obergrenze neu angelegter Demo-Kaeufer in 24 Stunden (Missbrauchsbremse, jeder Demo-Kauf mailt dem Betreiber). Ganze Zahl 1 bis 5000, alles andere ergibt 150. | `150` |
| `DEMO_BUNNY_VIDEO_ID` | optional | Nur mit `DEMO_MODUS=1`: GUID eines Test-Videos in der Demo-Bibliothek bei Bunny Stream. Beim ersten Start einer leeren Datenbank wird es als Videolektion im ersten Beispielkurs angelegt, aber nur wenn auch `BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY` und `BUNNY_STREAM_TOKEN_KEY` gesetzt sind. Ohne gueltige GUID keine Videolektion. | `c1977b35-5c32-4c1e-b601-aca55810c52b` |
| `STRIPE_SECRET_KEY` | **Pflicht** | Geheimschlüssel des Stripe-Kontos. Nur `sk_test_...` (Testmodus), bis Edmund und Gabriella Live ausdrücklich freigeben. Alles andere bricht den Start ab. | `sk_test_xxxxxxxxxxxx` |
| `STRIPE_WEBHOOK_SECRET` | **Pflicht** | Signatur-Geheimnis des Webhooks (`whsec_...`). Lokal liefert es `stripe listen`, online das Ereignisziel im Stripe-Dashboard. | `whsec_xxxxxxxxxxxx` |
| `BASE_URL` | **Pflicht im Betrieb**, sonst optional | Öffentliche Adresse der App, mit `https://`, **ohne Schrägstrich am Ende**, ohne Pfad. Sie bestimmt den Herkunftsschutz (CSRF) und die Rückkehr-Adressen von Stripe. Beginnt sie mit `https://`, bekommen Cookies automatisch `Secure`. Lokal Standard: `http://localhost:PORT`. | `https://kurse.beispiel.hu` |
| `PORT` | optional | Port, auf dem die App lauscht. Render setzt ihn selbst. Standard 4400. | `10000` |
| `ADMIN_ERLAUBT` | optional in der Testphase, **Pflicht im Livebetrieb** (ohne sie startet die App in Produktion mit einer Warnung) | Kommagetrennte Erlaubnisliste mit höchstens DREI eindeutigen E-Mail-Adressen (Gabriella zwei, Edmund eine): nur sie dürfen die Rolle admin haben und sich im Admin anmelden. Ein Tippfehler (kein bestätigter Admin passt) schaltet die Liste für diesen Lauf ab, mit Warnung und Alarm-Mail. Adressen stehen in keiner Fehlermeldung. | `a@example.hu,b@example.hu,c@example.hu` |
| `NOTFALL_ENTSPERREN` | optional | `1` leert beim Start alle Anmelde-Sperren und beendet alle Admin-Sitzungen (Notfallweg bei Aussperrung). Schaltet sich NICHT selbst aus: nach dem Zugriff wieder entfernen, sonst Alarm-Mail bei jedem Start. `0` oder leer = aus. | `1` |
| `SICHERUNG_ORDNER` | optional | Ordner für die verschlüsselten Datenbank-Sicherungen (Scheibe 25). Standard: Unterordner `sicherung` neben `DB_DATEI`. Darf nicht öffentlich sein und nicht im Medienordner liegen. | `/var/data/sicherung` |
| `SICHERUNG_SCHLUESSEL` | optional zum Start, **Pflicht für aktive Sicherung** (in Produktion sonst `/api/gesundheit` 503) | Base64 von genau 32 zufälligen Bytes (AES-256-GCM). Nur im geheimen Variablenspeicher und zusätzlich offline bei Edmund; ohne ihn sind die Sicherungen unlesbar. Niemals in Repo, Chat oder Log. | `<44 Zeichen Base64>` |
| `ALARM_MAILS` | optional | Kommagetrennte Liste einzelner E-Mail-Adressen (höchstens 5, ohne Duplikate) für Alarm- und Entwarnungs-Mails (Sicherung; seit 12.11.2026 auch: eine Mail, wenn eine automatische Mail nach 5 Versuchen endgültig nicht zugestellt wurde, höchstens eine je 6 Stunden). Adressen erscheinen in keiner Fehlermeldung. | `edmund@example.hu,gabriella@example.hu` |
| `SICHERUNG_BUNNY_ZONE` | optional (nur zusammen mit `SICHERUNG_BUNNY_SCHLUESSEL`) | Name der Bunny-Storage-Zone für die Außenkopie der Sicherung. | `vsic-zone` |
| `SICHERUNG_BUNNY_SCHLUESSEL` | optional (nur zusammen mit der Zone) | AccessKey der Bunny-Storage-Zone. Geheim, nur im Variablenspeicher. | `<AccessKey>` |
| `SICHERUNG_BUNNY_HOST` | optional | Host der Bunny-Storage-API. Standard `storage.bunnycdn.com`. | `storage.bunnycdn.com` |
| `SICHERUNG_BUNNY_PFAD` | optional | Unterordner in der Zone, mit Schrägstrich am Ende. Standard `vsic/`. | `vsic/` |
| `BUNNY_STREAM_BIBLIOTHEK_ID` | optional (nur zusammen mit den beiden folgenden) | Nummer der Bunny-Stream-Video-Bibliothek (Videos liegen bei Bunny, nicht auf der Render-Festplatte). Ohne alle drei Werte ist Bunny Stream AUS und alles läuft wie bisher. Siehe `docs/BUNNY-STREAM-PLAN.md`. | `12345` |
| `BUNNY_STREAM_API_KEY` | optional (nur zusammen) | API-Schlüssel der Video-Bibliothek (nicht des Bunny-Kontos). Geheim, nur im Variablenspeicher. Wird nie an den Browser gegeben. | `<ApiKey>` |
| `BUNNY_STREAM_TOKEN_KEY` | optional (nur zusammen) | Token-Schlüssel der Bibliothek (Security, "Token authentication key") für geschützte Einbett-Links. Geheim, nur im Variablenspeicher. | `<TokenKey>` |
| `BUNNY_STREAM_MAX_MB` | optional | Obergrenze für EIN Video, das der Admin zu Bunny hochlädt, in MB (Kostenbremse; Bunny selbst begrenzt nichts). Ganze Zahl 1 bis 50000, Standard 4000 (4 GB). Gilt im Browser vor dem Anlegen und auf dem Server (`bunny-upload`). Seit Schritt 8 (03.11.2026). | `4000` |
| `PLATTFORM_WEBHOOK_URL` | optional (nur gemeinsam mit dem Schlüssel) | Adresse des Apps-Script-Webhooks im PLATTFORM-Sheet von Gabriella (getrennt von der Buchhaltung). Muss genau die Form `https://script.google.com/macros/s/<ID>/exec` haben, sonst bricht der Start ab. Fehlt sie (zusammen mit dem Schlüssel), ist die Plattform-Meldung aus. Gemeldet werden nur Zeit, Typ, Kurs-ID, Betrag, Währung, Modus und Quell-ID, nie eine E-Mail. Der Modus ist Test, solange der Stripe-Schlüssel mit sk_test_ beginnt. Seit 03.11.2026. | `https://script.google.com/macros/s/AKfy…/exec` |
| `PLATTFORM_WEBHOOK_KEY` | optional (nur gemeinsam mit der Adresse) | Geheimer Schlüssel für den Webhook, 24 bis 128 Zeichen aus A-Z, a-z, 0-9, _ und -. Steht im Body der Anfrage (nicht in der Adresse) und in den Script-Eigenschaften des Sheets. Nie in Dateien oder im Chat; im Konto der Plattform nur als Render-Variable, lokal nur verschlüsselt (DPAPI). Drehen: neuen Wert in Script und Render setzen. Seit 03.11.2026. | (geheim) |
| `HOST` | optional | Adresse, auf der die App lauscht. Standard lokal `127.0.0.1` (nur dieser Rechner), bei `NODE_ENV=production` `0.0.0.0` (nötig, damit die App in der Cloud von außen erreichbar ist). Ein gesetzter Wert hat immer Vorrang. | `0.0.0.0` |
| `DB_DATEI` | optional (im Betrieb dringend empfohlen) | Pfad der SQLite-Datei, der Ordner wird angelegt. Standard `daten/lern-app.db`. **In der Cloud braucht sie dauerhaften Speicher** (bei Render eine "Disk", sonst ist die Datenbank nach jedem Neustart leer). Später ersetzt `DATABASE_URL` für PostgreSQL diese Variable (noch nicht eingebaut). | `/var/data/schulung.db` |
| `DATEI_ORDNER` | optional (im Betrieb dringend empfohlen) | Ordner, in dem die hochgeladenen Kursdateien (Videos, PDFs, Hörbücher) liegen, unter Zufallsnamen. Standard `daten/dateien`, der Ordner wird angelegt. Er darf nicht im Ordner `public` liegen (der wird öffentlich ausgeliefert), das prüft der Start. Die Dateien werden nie über eine öffentliche Adresse geliefert, nur über die geprüfte Route. **In der Cloud braucht er einen dauerhaften Datenträger** (bei Render eine "Disk"; sonst sind alle Dateien nach jedem Neustart weg) **oder später Bunny-Speicher** (noch nicht eingebaut). | `/var/data/dateien` |
| `MAX_UPLOAD_MB` | optional | Harte Obergrenze für EINE hochgeladene Datei in Megabyte, ganze Zahl von 1 bis 5000. Standard 500. Größeres wird abgewiesen, eine Teildatei wird gelöscht. Die Datenträger-Größe muss zu den Dateien passen, die Gabriella hochlädt. | `500` |
| `WIEDERGABE_GEHEIMNIS` | **Pflicht in production**, lokal optional | Geheimer HMAC-Schlüssel für sechsstündige Wiedergabe-Tickets, mindestens 32 Zeichen. Lokal ohne Angabe zufällig pro Start. Nie in Dateien oder im Chat speichern oder anzeigen. | (im sicheren Umgebungsvariablen-Speicher) |
| `MAX_SITZUNGEN` | optional | Gleichzeitig aktive Sitzungen pro Kunde (Admin ausgenommen), ganze Zahl 1 bis 20, Standard 3. Älteste Sitzung wird beim nächsten Login beendet. | `3` |
| `NODE_ENV` | optional | `production` schaltet die strengen Einstellungen ein: `BASE_URL` Pflicht und nur `https://`, `HOST` Standard `0.0.0.0`, `TRUST_PROXY` Standard 2. Erlaubt: `production`, `development`, `test`. | `production` |
| `TRUST_PROXY` | optional | Anzahl der Vermittler (Proxys) vor der App, 0 bis 10. Standard 2 bei `production`, sonst 0. Hinter Render nötig, damit die echte Adresse des Besuchers (für die Sperre nach Fehlversuchen) und https erkannt werden -- auf der echten Instanz gemessen (F-314, 18.11.2026): Cloudflare UND Render setzen je einen Zwischenschritt (zwei Eintraege in X-Forwarded-For), Standard 1 lieferte deshalb nie die echte Adresse. | `2` |
| `ADMIN_PASSWORT` | nur für das Skript | Wird NUR von `tools/admin-anlegen.mjs` gelesen (nicht vom Server), um das Passwort eines neuen Admins nicht auf der Kommandozeile zu zeigen. Nie dauerhaft setzen. | (Wegwerf-Passwort) |

## Dateien (Videos, PDFs, Hörbücher)
Eine Datei je Lektion, ein neuer Upload ersetzt die alte. Erlaubt sind je Lektionstyp: Video mp4 oder webm; PDF pdf; Hanganyag mp3, m4a oder ogg;
Dateityp Fájl: keine neuen Uploads, bestehende Dateien nur für Admin (zuerst in PDF umwandeln). Der Server prüft Typ UND die ersten Bytes der Datei. Ausgeliefert wird nur an angemeldete Käufer (und Admin) mit gültigem sechsstündigem Wiedergabe-Ticket,
mit Teilabrufen (Range), damit Video und Audio springen können. Der Speicherplatz auf dem Datenträger ist der Engpass: Er muss alle Dateien
fassen. Bei sehr großen Videos später ein Dienst wie Bunny (nicht Teil von Scheibe 5).

## Cookies
Die Sitzung läuft über ein Cookie mit `HttpOnly` und `SameSite=Lax`. `Secure` kommt **automatisch** dazu, sobald `BASE_URL` mit `https://`
beginnt. Lokal über `http://localhost` bleibt `Secure` weg, sonst würde die Anmeldung im Browser nicht funktionieren.

## Beispiele
Lokal (Edmunds Laptop, Testmodus), in PowerShell: zuerst `. .\tools\Stripe-Umgebung.ps1` (lädt die zwei Stripe-Werte aus dem
verschlüsselten Windows-Speicher), dann `node server.mjs`. Alles Übrige hat Standardwerte.

In der Cloud (Render): alle Werte als Umgebungsvariablen im Dienst eintragen, nie in eine Datei. Mindestens
`NODE_ENV=production`, `BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `WIEDERGABE_GEHEIMNIS` und `DB_DATEI` auf dem dauerhaften Speicher.
`PORT` setzt Render selbst, `HOST` und `TRUST_PROXY` folgen aus `NODE_ENV=production`.

## Was bei einem Fehler passiert
Beispiel einer Meldung (der Wert steht nie darin):
```
Abbruch: Die Konfiguration ist fehlerhaft (Werte werden nie ausgegeben, siehe docs/UMGEBUNG.md):
  - BASE_URL darf nicht mit einem Schrägstrich enden.
```

## Abonnements (Scheibe 8)

Jeder Kurs kann zusätzlich zum Einmalpreis ein Abo mit `abo_preis_cent` und `abo_intervall` (`month` oder `year`) anbieten. Beide Felder werden ausschließlich serverseitig geprüft und müssen zusammen gesetzt oder beide leer sein. Bei HUF sind nur ganze Forint erlaubt. Einmalkauf und Einladungen bleiben zeitlich unbegrenzt. Abo-Zugang besteht nur bis zum Ende des bezahlten Zeitraums; nach fehlgeschlagener Rechnung gilt eine Kulanzfrist von drei Tagen. Kündigung stoppt die nächste Abbuchung; bezahlte Tage bleiben zugänglich. Jeder Zugriff und jede Medien-Range-Anfrage prüft die Laufzeit erneut.

**Einrichtung im Stripe-Dashboard, nur Testmodus:** Unter **Billing → Customer portal** das Kundenportal konfigurieren und Abos kündigen sowie Zahlungsarten aktualisieren erlauben. Ohne Einrichtung antwortet die Kundenportal-Route mit einem ungarischen Fehlertext; der Server stürzt nicht ab. Die Plattform richtet das Portal nicht automatisch ein. Es werden keine neuen Umgebungsvariablen für Abos benötigt. Der bereits vorhandene Stripe-Testschlüssel und das vorhandene Webhook-Signaturgeheimnis bleiben Pflicht. Das Stripe-Ereignisziel muss zusätzlich `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` und `customer.subscription.deleted` empfangen, neben `checkout.session.completed`. Die Stripe-Signatur wird weiterhin mit dem Rohtext geprüft. Auch bei neuen Testabos wird kein echtes Geld eingesetzt.

**Wichtig für die Prüfung:** Ein neues Testabo wird erst nach einer bestätigten bezahlten Stripe-Rechnung freigeschaltet. Stripe-Ereignisse dürfen in unterschiedlicher Reihenfolge kommen; gleiche Ereignis-IDs werden nur einmal verarbeitet. Bestehende Datenbanken müssen vorab gesichert werden; die Datenbankmigration ist idempotent. Für alte Abos mit abweichender Währung oder Betrag gibt es eine Bestellung mit Status `pruefen` ohne neue Freischaltung. Solche Abo-Bestellungen dürfen nicht über den Knopf für Einmalkauf-Bestellungen unbegrenzt freigeschaltet werden.


## E-Mail-Versand und Passwort-Rücksetzung (Scheibe 11)

| Variable | Pflicht? | Bedeutung |
|---|---|---|
| `RESEND_API_KEY` | Optional | Resend-API-Schlüssel. Fehlt er, startet der Server trotzdem; Versand ist deaktiviert, Passwort-vergessen antwortet weiterhin neutral. Ausschließlich als geheime Umgebungsvariable setzen. |
| `MAIL_FROM` | **Pflicht, wenn RESEND_API_KEY gesetzt ist** | Absender im Format `VALORE Előadások <eloadasok@valorebusinessclub.com>` (seit 02.11.2026 so auf Render gesetzt). Nur verifizierte Domain `valorebusinessclub.com` erlaubt. |

Vor echtem Versand muss die Absenderdomain in Resend nachgewiesen und eingerichtet werden. In den Resend-Domain-Einstellungen Open-/Click-Tracking deaktivieren; die App selbst fügt weder Tracking-Pixel noch externe Bilder hinzu. **Kein Schlüssel im Repo, Chat oder Testcode.** Die E-Mail-Vorlagen sind ausschließlich ungarisch, aus `texte/hu.json`. Der Versand wartet höchstens 8 Sekunden auf Resend; eine fehlgeschlagene Kauf-Mail unterbricht den Stripe-Webhook nicht. Offene Kaufbestätigungen werden beim Serverstart und alle 10 Minuten erneut versucht, maximal fünfmal. Eine Bestellung erhält dank `UNIQUE(typ,bestellung_id)` höchstens einen Ausgangseintrag. Kaufbestätigungen verwenden zusätzlich einen stabilen Resend-Idempotency-Key je Plattform und Mail-Ausgangseintrag; so werden doppelte Provider-Anfragen innerhalb des Resend-Idempotenzzeitfensters unterdrückt. Bei sehr langen Ausfällen außerhalb dieses Zeitfensters ist ein erneuter Versand dennoch möglich.

## Admin-Erklärvideo (Scheibe 12)

Das Erklärvideo wird öffentlich und statisch aus den **bereits vorhandenen** Dateien `public/video/erklaervideo-hu.mp4` und `public/video/erklaervideo-hu.jpg` geladen. Der Admin zeigt es vor dem Anmeldeformular und über **Videó újra** erneut an. Die Videofläche wird nur eingeblendet, wenn der MP4-HEAD-Abruf erfolgreich ist; bei fehlender Datei bleibt die Anmeldung nutzbar. Der Server unterstützt Byte-Range-Abrufe (HTTP 206), liefert MP4 als `video/mp4` und verwendet einen einstündigen Cache. Die vorhandene CSP erlaubt bereits `media-src 'self'`. **Keine neuen Umgebungsvariablen und kein neues npm-Paket.** Das Erklärvideo ist öffentlich, anders als geschützte Kursvideos.

## E-Mail-Bestätigung bei der Registrierung (Scheibe 14)

**Benannte Regel:** Nur wenn `RESEND_API_KEY` gesetzt und der Maildienst aktiv ist, ist `email_bestaetigt` für `POST /api/kurse/:id/kaufen` Pflicht (Einmalkauf, Abo und kostenlose Kurse). Ohne Resend-Schlüssel wird die Pflicht für lokale Tests deaktiviert; bestehende Registrierungs-, Login-, Zugangs- und Webhookregeln bleiben bestehen. **Keine neuen Umgebungsvariablen.** Die Einrichtung der bestätigten Resend-Absenderdomain bleibt unverändert.

Die Bestätigungsmail wird nach der erfolgreichen Registrierung in einer SQLite-Ausgangsliste vorgemerkt und nach dem Commit versendet. Pro Benutzer höchstens ein offener Auftrag, maximal fünf Zustellversuche; nach einem Fehler wird beim nächsten Start oder spätestens nach zehn Minuten erneut versucht. Für jeden Versuch entsteht ein frischer 32-Byte-Token, ausschließlich als SHA-256 in SQLite gespeichert; nie Token im Klartext persistieren oder loggen. Der Bestätigungslink liegt im URL-Fragment `/#/megerosites/<token>` und gilt 24 Stunden. Bei deaktivierter Mail-Funktion wird kein Kunde ausgesperrt.

## Geschäftsereignisse und Meldungen an Gabriella (Scheibe 15)

| Variable | Pflicht? | Zweck | Beispiel (Platzhalter) |
|---|---|---|---|
| `VERKAUFSMELDUNG_MAIL` | optional | Empfänger für Geschäftsbenachrichtigungen. Ohne diese Adresse werden weiterhin Ereignisse gespeichert, aber keine Inhaber-Mails gesendet. Es ist genau eine gültige E-Mail-Adresse erlaubt. | `gabi@example.com` |
| `REGISTRIERUNG_MELDUNG` | optional | `ein` (Standard) oder `aus`: Registrierungsmails an die Inhaberin schalten, ohne die Willkommensmail an Kunden zu beeinflussen. | `ein` |
| `EREIGNIS_AUFBEWAHRUNG_TAGE` | optional | Aufbewahrungsdauer der Geschäftsereignisse, ganze Zahl 30 bis 3650, Standard 730 Tage. Aufräumen bei Start und täglich. Gabriella muss die passende Dauer festlegen. | `730` |

Mails verwenden den vorhandenen Resend-Mailer und dessen Absender; für den tatsächlichen Versand müssen **RESEND_API_KEY** und **MAIL_FROM** gültig eingerichtet sein. Keine weiteren Pakete und keine Daten in öffentlichen Logausgaben. Die Registrierung und Käufe sind unabhängig vom Erfolg einer Benachrichtigung. `mail_ausgang` aus Scheibe 11 ist fest an Käufer-Bestellungen gebunden; `email_ausgang` aus Scheibe 14 ist auf eine Verifikationsmail je Benutzer begrenzt. Deshalb nutzen Geschäftsbenachrichtigungen die eigene persistente Tabelle `meldung_ausgang`, aber denselben Resend-Mail-Dienst, Wiederholungen (maximal fünf) und Idempotency-Keys.

## Scheibe 16: Kaufbestätigungen und Support

| Variable | Pflicht? | Zweck | Beispiel (Platzhalter) |
|---|---|---|---|
| `SUPPORT_MAIL` | optional | Kontaktadresse im Kaufbestätigungstext. Gültige einzelne E-Mail-Adresse, die `konfig.mjs` ohne Wertausgabe prüft. Fehlt sie, gibt es keinen Support-Satz in der Bestätigungsmail. | `hilfe@example.com` |

Kaufmails verwenden die bestehende Resend-Konfiguration (`RESEND_API_KEY`, `MAIL_FROM`), `mail_ausgang` mit `UNIQUE(typ,bestellung_id)` und denselben Idempotency-Key pro Bestellung. Beträge, Bestellnummer und Budapest-Zeit kommen aus der **gespeicherten Bestellung**. Beim ersten bezahlten Abo-Zeitraum gibt es die Abo-Variante. Kostenlose Freischaltungen haben keine Stripe-Bestellung; für sie speichert die App stattdessen den idempotenten Auftrag `gratis_mail_ausgang` (UNIQUE Benutzer/Kurs) samt Wiederholungen. Die in der Gratis-Mail angezeigte Nummer ist die laufende Nummer des Gratis-Mailauftrags, keine Stripe- oder kostenpflichtige Bestellnummer. E-Mail-Zustellung: beim ersten Versand und höchstens 5 Versuche im bestehenden 10-Minuten-Rhythmus. Ein Mailfehler ändert die Zahlung oder den Zugang nicht.

## Scheibe 18 – Konto

Für `Fiókom` entstehen **keine neuen Umgebungsvariablen**. Vorhandene Mailer-Konfiguration und Stripe-Testzugang werden verwendet. Ohne konfigurierten Maildienst ist die E-Mail-Änderung gesperrt; die bisherigen Kurs- und Zahlungsmodule bleiben unverändert. Nur Testmodus vor schriftlicher Freigabe.

## Scheibe 19 – Stripe-Beleg

Keine neuen Umgebungsvariablen. Die bestehende Stripe-18.1.0-Bibliothek verwendet weiterhin nur den konfigurierten Testmodus. Der Beleg wird nicht gespeichert. Kundendaten werden vor Checkout nur dann aktualisiert, wenn optional Rechnungsdaten gepflegt wurden; Steuernummern werden nicht gesendet. Die Belegprüfung erfordert einen echten bezahlten Stripe-Sandbox-Test für Einmalkauf und Abo.

## Scheibe 20 – Direktkündigung

Keine neuen Umgebungsvariablen oder Pakete. Vorhandene Stripe-Testkonfiguration und gegebenenfalls Resend-Konfiguration werden genutzt. Im Stripe-Kundenportal muss der Kündigungsflow verfügbar sein. Ohne Mailkonfiguration bleibt die Webhook-Kündigung möglich, aber die Kundenbestätigung kann nicht versendet werden.

## Scheibe 21 – Widerruf

Keine neuen Umgebungsvariablen. Stripe-Testschlüssel und bestehende Mailkonfiguration verwenden. Für echte Sandbox-Erstattungen müssen Stripe-Testzahlungen vorhanden sein. Keine Live-Erstattungen und kein produktiver Versand ohne gesonderte Freigabe.

## Scheibe 22 – öffentliche Anbieterangaben (alle optional)

- `ANBIETER_NAME`: öffentlicher vollständiger Anbietername, maximal 160 Zeichen
- `ANBIETER_ANSCHRIFT`: öffentliche einzeilige Postanschrift, maximal 240 Zeichen
- `ANBIETER_TELEFON`: öffentliches Telefon, Zeichen-Whitelist, maximal 50 Zeichen
- `ANBIETER_EMAIL`: öffentliche einzelne Kontaktadresse, maximal 254 Zeichen
- `ANBIETER_ADOSZAM`: öffentliche Steuernummer, maximal 60 Zeichen
- `STEUER_HINWEIS`: frei formulierter öffentlicher Steuerhinweis, maximal 200 Zeichen

Fehlende Werte sind erlaubt. Alle Werte müssen einzeilig und frei von Steuerzeichen sein; Verstöße führen zu einem Abbruch ohne Ausgabe des Werts. Diese Daten werden Kunden ausdrücklich angezeigt – niemals dort Zugangsdaten eintragen. Neue Konfiguration erst nach juristischer Prüfung vor Livebetrieb befüllen.

## Scheibe 24 – Agent-Schlüssel

Keine zusätzlichen Umgebungsvariablen, npm-Pakete oder Konfigurationsschlüssel. Die Agent-Schlüssel werden nur im Admin erstellt und als Hash in der bestehenden SQLite-DB gespeichert. In GPT Actions API-Key/Bearer nutzen; öffentliche OpenAPI-Adresse `<BASE_URL>/agent/openapi.json` mit dynamisch übernommener BASE_URL. Agent-Bearer niemals in `.env`, Dateien, Chats oder den öffentlichen OpenAPI-Inhalt schreiben. Zum Widerruf im Admin den betreffenden Schlüssel widerrufen und bei Verdacht neu ausstellen. Siehe `docs/AGENT.md`.

## Scheibe 25 – SQLite-Sicherung

- `SICHERUNG_ORDNER`: optional; Standard `<DB_DATEI-Verzeichnis>/sicherung`, darf nicht öffentlich sein
- `SICHERUNG_SCHLUESSEL`: optional zum Start, **Pflicht für aktive Sicherung und produktive Gesundheit**; exakt 32 zufällige Bytes als Base64 in sicherer Umgebungsvariablenverwaltung, niemals ins Repo/Chat/Log
- `ALARM_MAILS`: optional, kommagetrennt höchstens fünf einzelne E-Mail-Adressen, werden nicht ausgegeben
- `SICHERUNG_BUNNY_ZONE`: optional; Bunny Storage Zone (gemeinsam mit Zugangsschlüssel setzen)
- `SICHERUNG_BUNNY_SCHLUESSEL`: optional; geheimer AccessKey, nur im geheimen Umgebungsvariablen-Speicher
- `SICHERUNG_BUNNY_HOST`: optional; Standard `storage.bunnycdn.com`
- `SICHERUNG_BUNNY_PFAD`: optional; Standard `vsic/`

Ohne Sicherungsschlüssel startet die Plattform im Entwicklungs-/Testmodus weiter; `/api/gesundheit` meldet `sicherung: aus`. Im Produktivbetrieb liefert die Route dann HTTP 503. SQLite-Backups enthalten **keine** Mediendateien. Übertragung zu externem Bunny-Speicher nur nach ausdrücklicher Kosten-/Speicher-Freigabe.

**Speicherwarnung:** Der Render-Datenträger hat derzeit laut Projektvorgabe 1 GB. Bei jeder Sicherung können gleichzeitig die Original-DB, eine vollständige temporäre SQLite-Kopie und die verschlüsselte Datei Platz benötigen. Die 48h/30-Tage/12-Monats-Aufbewahrung benötigt zusätzlichen Platz. Vor produktiver Nutzung Kapazität und Kosten mit Edmund/Gabriella prüfen; keine automatische Speichererweiterung oder Buchung.

## Scheibe 26 – Stripe-Abgleich

Keine neuen Umgebungsvariablen oder Pakete. Verwendet den vorhandenen Stripe-Client und vorhandene `ALARM_MAILS` aus Scheibe 25 sowie `BASE_URL` für den Mail-Link. Läuft täglich mit einem Startabstand von fünf Minuten, plus manueller Admin-Aufruf. Stripe ist als Zahlungsquelle maßgeblich; der Abgleich verändert keine Zahlung und keinen Zugang. Die produktive Gesundheitsroute beachtet Abgleich-Alter und kritische fehlende Bestellungen.

## Scheibe 27 – Adminschutz

- `ADMIN_ERLAUBT` (optional in Tests, **für Live erforderlich**): bis zu drei unterschiedliche vollständige E-Mail-Adressen mit Komma getrennt. Ungültige Werte verhindern den Start, ohne die Adressen in Fehlermeldungen auszugeben. Bei mindestens einem in der Datenbank vorhandenen, bestätigten, passenden Admin wird die Liste aktiviert. Wenn kein bestätigter Admin passt, wird sie nur für den aktuellen Lauf deaktiviert und mit Warnung + Alarm gemeldet. Im Livebetrieb die tatsächlichen drei E-Mail-Adressen ausschließlich in Render-Umgebungsvariablen pflegen.
- `NOTFALL_ENTSPERREN` (optional, Standard aus): ausschließlich `0` oder `1`. Bei `1` werden beim Start zeitliche Login-Sperren sowie alle Admin-Sitzungen aufgehoben; Alarm bei jedem Start. Nach erfolgreicher Entsperrung **wieder entfernen**.
- `ADMIN_PASSWORT` bleibt ausschließlich eine temporäre Eingabe in der Umgebung für die CLI-Werkzeuge; Passwort nie als Kommandozeilenargument/Log/Chat weitergeben. `ALARM_MAILS` und die vorhandene verifizierte Mail-Konfiguration werden für Admin-Alarme wiederverwendet. Keine neuen Pakete.

## Scheibe 31 – Kurspaket-Import

| Umgebungsvariable | Pflicht/Optional | Änderung |
|---|---|---|
| Keine neue Variable | – | Import und Export verwenden die vorhandene Admin-Sitzung, `ADMIN_ERLAUBT` und den bestehenden SQLite-Datenbankpfad. Keine Konfigurationsänderung nötig. |

## Produktreife Block 1 (12.11.2026) – Demo-Texte nur im Demo-Modus, Rechtsseiten des Betreibers

| Umgebungsvariable | Pflicht/Optional | Zweck |
|---|---|---|
| `IMPRESSUM_URL` | optional, im Betrieb ohne Demo dringend empfohlen | Vollständige Adresse (https://, höchstens 500 Zeichen, ohne Zugangsdaten) des Impressums des Betreibers. `/jogi/impresszum/` leitet dorthin weiter (302). |
| `DATENSCHUTZ_URL` | optional, im Betrieb ohne Demo dringend empfohlen | Adresse der Datenschutzerklärung des Betreibers, Weiterleitung von `/jogi/adatvedelem/`. |
| `TEILNAHMEBEDINGUNGEN_URL` | optional, im Betrieb ohne Demo dringend empfohlen | Adresse der Teilnahmebedingungen (AGB) des Betreibers, Weiterleitung von `/jogi/reszveteli-feltetelek/`. |

- Nur mit `DEMO_MODUS=1` zeigt die Plattform Demo-, Test- und Muster-Hinweise: Kurskartenetikett „Demo-Kurs“, Kaufbox-Hinweis „Demo: Testzahlung…“, Demo-Satz im Kasten „Dein Anbieter“, Titel „Widerrufsbelehrung (Muster)“ (Fußzeile, Informationsseite, Kaufmail), Demo-Kasten und die eigenen Muster-Rechtsseiten unter `/jogi/`. Ohne Demo-Modus erscheint nichts davon. Der Client erfährt den Modus über das öffentliche Feld `demo` (true/false) von `/api/anbieter` (keine Geheimnisse).
- Ohne Demo-Modus und ohne hinterlegte Adresse zeigt `/jogi/<seite>/` eine neutrale Seite „Vom Betreiber noch nicht hinterlegt“ (DE/EN/HU). Fehlende `ANBIETER_NAME`/`ANBIETER_ANSCHRIFT`/`ANBIETER_EMAIL` erscheinen in Widerrufsbelehrung, Widerrufsformular und Kaufmail ebenfalls als „Vom Betreiber noch nicht hinterlegt“ statt „...“.
- Mit `NODE_ENV=production` und ohne Demo-Modus meldet der Start laut `WARNUNG RECHTSTEXTE: … fehlt` (kein Abbruch), wenn eine der drei Adressen fehlt; fehlende Anbieterangaben meldet die bestehende Anbieter-Warnung. Mit `http://` sind die Adressen nur außerhalb von production erlaubt.
- Die Plattform liefert KEINE Rechtstexte des Betreibers. Impressum, Datenschutzerklärung und Teilnahmebedingungen schreibt und verantwortet der Betreiber (juristisch geprüft). Die eingebaute Widerrufsbelehrung (Frist, Ausübung, Folgen, Formular) ist ein allgemeiner Standardtext und muss vom Betreiber vor dem Verkauf juristisch geprüft werden.

## Produktreife Block 2 (12.11.2026) – Marke einstellbar

| Umgebungsvariable | Pflicht/Optional | Zweck |
|---|---|---|
| `PLATTFORM_NAME` | optional, Standard `Musterakademie` | Name der Plattform/Marke. Erscheint in Logo (Alt-Text und Textlogo), Mail-Betreffen, Mailtexten und Signaturen („Das Team der …“), Alarm-Betreffen, Kontomails, OpenAPI-Titel der Agent-Schnittstelle und in Dateinamen von Downloads (`<name>-adataim.json`, `<name>-esemenyek.csv`). 1 bis 60 Zeichen, mindestens ein Buchstabe oder eine Ziffer, kein HTML: verboten sind spitze Klammern `<` `>`, `&`, Anführungszeichen (doppelt, einfach, Backtick), Backslash und geschweifte Klammern `{` `}`, Steuerzeichen/Zeilenumbrüche sowie doppelte Leerzeichen. Die Fehlermeldung nennt nie den Wert. |

- Ohne `PLATTFORM_NAME` (oder mit `Musterakademie`) bleibt alles wie bisher: gleiche Texte, gleiche Logo-Dateien `/img/muster-logo.svg` und `/img/muster-logo-vertikal.svg`. Die Demo ändert sich nicht.
- Mit eigenem Namen zeigt die Plattform kein Musterakademie-Bild mehr, sondern ein Textlogo aus dem Namen (gleiche Gestaltung, Anfangsbuchstabe im Quadrat), ausgeliefert vom Server unter `/img/marke-logo.svg` und `/img/marke-logo-vertikal.svg` (gleicher Ursprung, die Sicherheitsrichtlinie CSP bleibt unverändert). Ein eigenes Bild-Logo des Betreibers (z. B. `LOGO_URL`) gibt es bewusst noch nicht, weil fremde Bildadressen die CSP aufweichen würden.
- Der Client erfährt Name und Logo-Pfade über das öffentliche Feld von `/api/texte` (`_plattform`, `_plattform_slug`, `_logo`, `_logo_vertikal`; keine Geheimnisse). `/api/anbieter` bleibt unverändert (`anbieter`, `demo`).
- Texte: in `texte/de.json`, `en.json`, `hu.json` steht der Platzhalter `{plattform}`; der Server ersetzt ihn beim Lesen (auch für `/api/texte`). Grammatik: Ungarisch setzt vor dem Namen automatisch `a`/`az` (Anlaut), Deutsch behält „der <Name>“ nur bei weiblichen Namen (…akademie, …schule, …plattform, …ung, …ie usw.), sonst „von <Name>“ (z. B. „Das Team von Kurswerk“).
- Nicht betroffen: der Absendername der Mails steht in `MAIL_FROM` (Betreiber stellt ihn selbst ein), das Favicon (Buchstabe „M“-Monogramm, ohne Namen), die Muster-Rechtsseiten (nur im Demo-Modus) und die Präsentation.

## Block 3: Download-Produkte (12.11.2026)
- Keine neue Umgebungsvariable. Download-Dateien liegen im bestehenden `DATEI_ORDNER` (Zufallsnamen) und werden nur über `GET /api/kurse/:id/lektionen/:lid/download` ausgeliefert (Details `docs/SCHUTZ.md`, Abschnitt Block 3).
- Nur mit `DEMO_MODUS=1`: Das Demo-Produkt „Handbuch für Käuferinnen und Käufer“ entsteht beim ersten Start einer leeren Datenbank nur, wenn alle drei PDFs `handbuch/ausgabe/handbuch-kaeufer-{de,en,hu}.pdf` im Repo liegen. Eine bestehende Demo-Datenbank bekommt es nicht nachträglich (Seed nur bei leerer Datenbank).
- Ebenso das zweite Produkt „Handbuch für den Admin-Bereich“ (19 EUR, Kurs 5 einer leeren Demo) nur, wenn `handbuch/ausgabe/handbuch-admin-{de,en,hu}.pdf` vorliegen. Keine neue Umgebungsvariable. Eine laufende Demo mit bestehender Datenbank bekommt es erst nach einem Neustart mit leerer Datenbank.
