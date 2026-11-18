# SPEZ WP1 bis WP3: Sicherheitsblock (Setup-Modus, verschlüsselte Einstellungen, geschützter Erststart)

Stand: 13.11.2026 14:10 Budapest / 13:10 UTC, Chef (Hauptsitzung). Baseline: Zweig `main` dieses Repos (Stand beim Start des WP, mit `git rev-parse` im Bericht nennen).
Ziel des Blocks: Ein Käufer ohne PC-Kenntnisse startet die Plattform zum ersten Mal OHNE Umgebungsvariablen und richtet sie über eine geschützte Seite ein. Nichts darf dabei unbefugt erreichbar sein. WP1 bis WP3 gehören zusammen: kein WP darf ohne die anderen live gehen.

## Zustände der Instanz (Pflicht, ChatGPT-Prüfung Runde 100, vom Chef übernommen)
Die Instanz hat genau einen dieser Zustände, gespeichert in der Datenbank (Tabelle `einstellungen`, Schlüssel `instanz_zustand`):
1. UNINITIALISIERT: kein Admin-Konto. Nur `/health` und `/einrichtung` erreichbar (Setup-Modus).
2. ADMIN_ERSTELLT: Admin-Konto angelegt, aber Pflichtwerte (Stripe, Mail) noch nicht gesetzt. Der Server startet im EINRICHTUNGSMODUS: kein Shop, kein Stripe-Client, kein Webhook; erreichbar sind `/health`, die Anmeldung und ein authentifizierter Bereich `/admin/einrichtung` (für WP4 bis WP8). Der Käufer sitzt also nie fest. Es gibt in diesem Zustand KEINEN neuen Token.
3. KONFIGURIERT: Pflichtwerte vorhanden (Variablen oder Einstellungsspeicher) und geprüft.
4. AKTIV: Normalbetrieb wie bisher.
Rückfall in einen früheren Zustand gibt es nicht. Fehlen in KONFIGURIERT/AKTIV die Pflichtwerte: Abbruch wie bisher (NIE zurück in Setup-Modus oder Einrichtungsmodus ohne Anmeldung).
Zustandsmatrix für die Stripe-Variablen (WP1 testet ALLE Kombinationen): beide fehlen = Setup-/Einrichtungsmodus je nach Zustand; nur EINE gesetzt = Abbruch mit klarer Meldung (ohne Werte), nie Setup-Modus; beide gesetzt und gültig = normal; beide gesetzt, eine ungültig oder `sk_live_` = Abbruch wie bisher.
Bedrohungsmodell (in docs aufschreiben, kurz): Die Verschlüsselung schützt Werte, wenn nur die Datenbankdatei oder ein Backup ohne Schlüsseldatei abfließt. Sie schützt NICHT, wenn ein Angreifer den ganzen Datenträger samt Schlüsseldatei bekommt. Für Betrieb mit höherem Schutz ist `EINSTELLUNGEN_SCHLUESSEL` aus der Umgebung des Hosters vorzuziehen.

## Gemeinsame Regeln (gelten für alle drei WP)
- Reihenfolge strikt: WP1, dann WP2, dann WP3. Je WP ein eigener Zweig, der auf dem vorigen aufbaut: `wp1-setup-modus`, `wp2-einstellungen`, `wp3-erststart`. Je WP ein Bericht `BUILDER-FERTIG-WP<N>.md` im Format aus EINRICHTUNG-PROJEKT.md (Abschnitte: Was gebaut, Dateien, Tests mit Befehl und Ausgabe, Gegenproben, was NICHT geprüft ist). Nach jedem WP anhalten und dem Chef melden; erst nach seiner Prüfung das nächste WP.
- Nur Push auf `wp*`-Zweige, nie auf `main`. Keine neuen npm-Pakete (nur `node:crypto`, `node:sqlite`, vorhandene). Keine Geheimnisse in Dateien, Logs, Fehlermeldungen oder Testausgaben.
- Alle 65 vorhandenen Tests bleiben unverändert und laufen wie bisher (`PE_TEST_RAM=1 bash tools/selbsttest-alle.sh`: genau 1 roter, `handbuch-barrierefrei`, bekannte Ausnahme). Kein bestehender Test darf abgeschwächt, gelöscht oder übersprungen werden. Neue Tests als `tools/selbsttest-<name>.mjs` UND in die Liste in `tools/selbsttest-alle.sh` UND in `tools/Selbsttest-Alle.ps1` eintragen (die Vollständigkeitsprüfung des Runners erzwingt es).
- Stripe bleibt `sk_test_`-only. Zahlungslogik, Webhook, Abo, Erstattung: nicht anfassen.
- Bestehendes Verhalten mit gesetzten Umgebungsvariablen bleibt BIT-GLEICH (Render-Betrieb der Muster-Plattform darf nicht brechen). Neue Funktionen sind nur aktiv, wenn die Umgebungsvariablen fehlen oder wenn der Einstellungsspeicher benutzt wird.
- Erlaubte Dateien: `konfig.mjs`, `server.mjs`, `app.mjs` (nur kleine Einhängestellen), `db.mjs` (nur additive Tabellen/Migration, nie bestehende Spalten ändern), `auth.mjs` (nur wiederverwenden, nicht ändern), NEU: `einstellungen.mjs`, `erststart.mjs`, `einrichtung-routen.mjs`, `tools/selbsttest-*.mjs`, `tools/lib-*.sh` (nur wenn nötig), `docs/*.md`. Alles andere: vorher beim Chef anfragen.
- Genehmigungsdialoge der Sitzung beantwortet der Chef. Keine AskUserQuestion.

## WP1: Setup-Modus statt Abbruch (Konfig-Entkopplung)
Heute: `konfig.mjs` bricht ohne `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` den Start ab (`server.mjs`: Exit 1).
Neu:
1. Neuer Zustand "Setup-Modus": wird gewählt, wenn die beiden Stripe-Variablen fehlen UND noch kein Admin-Konto und kein abgeschlossenes Setup in der Datenbank existiert (Prüfung über die DB, nicht über eine Datei).
2. Im Setup-Modus startet der Server OHNE Stripe-Client und OHNE Shop-, Kauf-, Konto-, Admin- oder Webhook-Routen. Erreichbar sind nur `GET /health` (liefert `{"modus":"setup"}`, nichts anderes) und die Routen unter `/einrichtung` (WP3). Alle anderen Pfade: 404 mit neutraler Meldung, ohne Hinweis auf Aufbau oder Version.
3. Sind die Variablen vorhanden: Verhalten exakt wie bisher (auch alle bisherigen Fehlermeldungen und Exitcodes bei ungültiger Konfiguration, z. B. `sk_live_` wird weiter abgelehnt).
4. Ist ein Admin-Konto vorhanden (Zustand ADMIN_ERSTELLT oder höher): NIE Setup-Modus. In ADMIN_ERSTELLT startet der Einrichtungsmodus (siehe Zustände); in KONFIGURIERT/AKTIV bei fehlenden Pflichtwerten Abbruch wie bisher (Schutz gegen Übernahme einer fertigen Instanz).
KORREKTUR 13.11.2026 14:50 Budapest / 13:50 UTC (Chef, nach Rückfrage von Bau-Omen-2; Widerspruch zwischen A1 und A5 war ein Fehler der Spezifikation): Der Setup-Modus UNINITIALISIERT startet NUR bei gesetztem `EINRICHTUNGSMODUS=1` (zusätzlich: beide Stripe-Variablen fehlen, kein Admin in der DB). Ohne den Schalter verhält sich der Server bei fehlenden Variablen EXAKT wie bisher (Abbruch, alle bestehenden Tests unverändert grün). Der Einrichtungsmodus im Zustand ADMIN_ERSTELLT braucht den Schalter NICHT (sonst Sackgasse). Der Schalter wird vom späteren Installer (WP10) und von der Hosting-Vorlage gesetzt. Die Tests A1, A3, A6 gelten mit dieser Bedingung.
Abnahmetests (Datei `tools/selbsttest-setupmodus.mjs`):
- A1 Ohne Variablen, leere DB: Konfiguration liefert Modus `setup`; mit Variablen Modus `normal`.
- A2 Im Setup-Modus: `/health` 200 mit genau `{"modus":"setup"}`; `/`, `/kurse`, `/admin`, `/webhook`, `/api/*` je 404 und der Antworttext enthält keine Pfadnamen, Versionsnummern oder Stacktraces.
- A3 Mit vorhandenem Admin-Konto in der DB und fehlenden Variablen: `ladeKonfig` wirft den bisherigen Fehler (kein Setup-Modus).
- A4 `sk_live_...` wird in jedem Modus abgelehnt.
- A5 Alle bisherigen Konfig-Tests unverändert grün.
- A6 Zustandsmatrix: alle Kombinationen (beide fehlen, nur eine gesetzt, beide gültig, eine ungültig, sk_live_) je mit erwartetem Modus/Abbruch.
- A7 ADMIN_ERSTELLT ohne Stripe-Schlüssel: Neustart ergibt Einrichtungsmodus (kein Abbruch, kein neuer Token, kein Shop, Admin kann sich anmelden).

## WP2: Verschlüsselte Einstellungen
Neu `einstellungen.mjs` und eine additive Tabelle `einstellungen` (`schluessel` TEXT PRIMARY KEY, `wert` BLOB/TEXT, `verschluesselt` INTEGER, `iv`, `tag`, `aktualisiert_am`).
1. Geheimnis-Felder (mindestens: Stripe-Schlüssel, Stripe-Webhook-Secret, Resend- oder SMTP-Passwort, Bunny-Schlüssel, Sicherungsschlüssel, `WIEDERGABE_GEHEIMNIS`) werden mit AES-256-GCM (`node:crypto`, zufälliger 12-Byte-IV pro Wert, Tag gespeichert) verschlüsselt abgelegt. Nicht geheime Felder (Plattformname, Anbieterdaten, Impressum-/Datenschutz-Texte oder -URLs) dürfen im Klartext liegen.
2. Hauptschlüssel: 32 Zufallsbytes, beim ersten Gebrauch erzeugt und als Datei `daten/.hauptschluessel` (Rechte 0600, nicht in Git, in `.gitignore` prüfen) abgelegt. Optional überschreibt die Umgebungsvariable `EINSTELLUNGEN_SCHLUESSEL` die Datei. Der Hauptschlüssel steht NIE in der Datenbank, NIE in einem Log, NIE in einer API-Antwort. Fehlt die Datei bei vorhandenen verschlüsselten Werten: klarer Abbruch ohne Werte ("Hauptschlüssel fehlt, Wiederherstellung siehe docs"), NIEMALS stillschweigend einen neuen Schlüssel erzeugen (das würde die alten Werte unlesbar machen).
3. Vorrang beim Lesen: Umgebungsvariable vor Einstellungsspeicher vor Standardwert. Die Konfiguration (`ladeKonfig`) bekommt die Werte aus dieser Quelle; die Typ- und Formatprüfungen bleiben dieselben.
4. Lese-Schnittstelle nach außen (für den späteren Assistenten): Geheimnisse nie im Klartext, nur maskiert (`sk_test_••••abcd`, höchstens die letzten 4 Zeichen) und als `gesetzt: true/false`. Klartextzugriff nur intern über eine Funktion, die nirgends als Route erscheint.
5. Integrität: Manipulierter Wert (falscher Tag) wird erkannt und führt zu einem Fehler ohne Wertausgabe.
Abnahmetests (`tools/selbsttest-einstellungen.mjs`):
- B1 Rundlauf: schreiben, lesen, Wert gleich; in der DB steht für ein Geheimnis KEIN Klartext (Suche nach dem Wert in der DB-Datei und in `.hauptschluessel`-freien Dumps: nicht gefunden).
- B2 Zwei Schreibvorgänge desselben Wertes haben unterschiedliche IVs und Chiffretexte.
- B3 Manipulierter Chiffretext/Tag: Fehler, Meldung enthält den Wert nicht.
- B4 Fehlender Hauptschlüssel bei vorhandenen verschlüsselten Werten: Abbruch, es wird KEINE neue Datei angelegt.
- B5 Rechte der Schlüsseldatei 0600 (auf Linux prüfen; unter Windows überspringen mit ausdrücklichem "nicht geprüft").
- B6 Vorrang: Umgebungsvariable gewinnt gegen Einstellungsspeicher.
- B7 Maskierte Ausgabe zeigt höchstens 4 Zeichen und nie den ganzen Wert; ein Log-Fänger sieht beim gesamten Ablauf den Geheimniswert nicht.
- B9 Wiederherstellung: Backup (DB plus Schlüssel) auf frischer leerer Instanz einspielen, Geheimnisse wieder lesbar; Backup ohne Schlüsseldatei: klare Fehlermeldung, keine stille Neuerzeugung.
- B8 Backup/Sicherung (`sicherung`-Tests) bleiben grün; im Bericht klären: wird `.hauptschluessel` mitgesichert? Empfehlung des Bauers, Entscheidung beim Chef.

## WP3: Geschützter Erststart mit Einmal-Token
Neu `erststart.mjs` und `einrichtung-routen.mjs`; Routen nur unter `/einrichtung`, nur im Setup-Modus aktiv.
1. Beim ersten Start im Setup-Modus wird ein zufälliger Einmal-Token (mindestens 32 Zufallsbytes, URL-sicher) erzeugt. In der Datenbank liegt NUR sein Hash (SHA-256 mit Salt oder HMAC mit Hauptschlüssel), Ablaufzeit 24 Stunden. Der Token (jetzt "Einrichtungscode", 8 Gruppen à 4 Zeichen aus einem eindeutigen Alphabet, mindestens 128 Bit Zufall) erscheint genau einmal in der Konsole/im Hosting-Log des Betreibers und in der Datei `daten/ERSTSTART.txt` (Rechte 0600, wird beim Abschluss gelöscht). AUSDRÜCKLICHE Ausnahme von der Regel "keine Geheimnisse in Logs": nur diese eine Zeile. Er steht NICHT in der URL, nie in einer HTTP-Antwort, nie in einem Mail-Text, nie in einem Fehlerfall. Die Erzeugung ist transaktional und eindeutig (genau eine Token-Zeile, `INSERT OR IGNORE`/Unique): zwei gleichzeitig startende Prozesse erzeugen nie zwei gültige Token.
2. Nach Ablauf oder nach einem Neustart ohne abgeschlossenes Setup wird ein NEUER Token erzeugt und der alte ungültig.
3. `GET /einrichtung` zeigt im Zustand UNINITIALISIERT eine neutrale Formularseite mit Feldern Einrichtungscode, Admin-E-Mail, Passwort (Regeln aus `auth.mjs`: `emailPruefen`, `passwortRegelnPruefen`). Der Code wird NUR per POST gesendet, nie in der URL. In jedem anderen Zustand: 404. Ein ungültiger, fehlender oder abgelaufener Code beim POST: immer dieselbe Antwort (neutrale Fehlerseite, gleiche Länge und Statuscode), kein Hinweis, ob ein Code existiert.
4. `POST /einrichtung`: prüft den Token in konstanter Zeit (`crypto.timingSafeEqual` auf gleich langen Hashes), legt das erste Admin-Konto mit dem vorhandenen Passwort-Hash an, setzt das Setup-Flag und löscht den Token-Hash in EINER Transaktion. Zwei gleichzeitige Einlösungen: genau eine gelingt, die andere bekommt 404.
5. Fehlversuche: nach 5 falschen Codes je IP eine Sperre UND ein GLOBALES Limit (z. B. 20 Fehlversuche pro Stunde über alle IPs, danach 15 Minuten Pause für alle). IP nur über die bestehende `TRUST_PROXY`-Logik; `X-Forwarded-For` wird ohne vertrauenswürdigen Proxy ignoriert. Antwort immer gleich.
6. Nach Abschluss: alle `/einrichtung`-Routen liefern 404, der Server startet beim nächsten Mal nur noch im Normalmodus (sofern die Pflichtwerte im Einstellungsspeicher stehen, sonst bleibt er im geschützten Zustand: Abbruch wie in WP1 Punkt 4, KEIN neuer Token). Nach dem Abschluss ist der Zustand ADMIN_ERSTELLT (siehe Zustände): der Admin kann sich anmelden und landet im Einrichtungsmodus (leerer Platzhalter `/admin/einrichtung` für WP4 bis WP8, jetzt nur "Einrichtung folgt"). Test: Neustart danach ohne Stripe-Schlüssel bleibt im Einrichtungsmodus.
7. Kein Cookie und keine Sitzung vor Abschluss; CSRF: `POST` nur mit dem Token aus dem Formular (verstecktes Feld) und `Content-Type`-Prüfung; Antworten mit `Cache-Control: no-store` und `Referrer-Policy: no-referrer` (der Token steht in der URL).
Abnahmetests (`tools/selbsttest-erststart.mjs`):
- C1 Falscher, leerer, abgelaufener oder verbrauchter Code beim POST: identische Antwort (Status, Text, Länge). GET im Zustand ADMIN_ERSTELLT oder höher: 404.
- C2 Gültiger Token legt genau ein Admin-Konto an; danach ist derselbe Token ungültig.
- C3 Parallel zwei POST mit gültigem Token: genau ein Konto, einmal 303, einmal die neutrale Fehlerantwort (400, identisch mit jeder anderen Fehlerantwort; so umgesetzt und vom Chef am 13.11.2026 akzeptiert).
- C4 Nach Abschluss sind `/einrichtung` GET und POST (auch mit dem alten Code) 404; ein Neustart erzeugt KEINEN neuen Code; `ERSTSTART.txt` ist gelöscht.
- C5 In der DB steht kein Klartext-Code; ein Log-Fänger sieht den Code nur in der einen vorgesehenen Konsolenzeile und in keiner HTTP-Antwort und keinem Access-/Anwendungslog.
- C6 5 falsche Tokens von derselben IP: Sperre; danach auch der richtige Token von dieser IP bis zum Ablauf der Sperre abgewiesen (404).
- C7 Schwaches Passwort oder ungültige E-Mail: Formular wieder mit Fehlertext, Token bleibt gültig, kein Konto.
- C8 Ablaufzeit: mit manipulierter Uhr/Parameter wird der Token nach 24 Stunden ungültig.
- C9 Header: `Cache-Control: no-store`, `Referrer-Policy: no-referrer` auf allen `/einrichtung`-Antworten.
- C11 Zwei gleichzeitig gestartete Server-Prozesse auf derselben Test-Datenbank erzeugen genau einen gültigen Code.
- C12 Gefälschtes `X-Forwarded-For` ohne TRUST_PROXY umgeht die IP-Sperre nicht; das globale Limit greift auch bei wechselnden IPs.
- C10 Gegenprobe Übernahme: Bei vorhandenem Admin-Konto und fehlenden Variablen gibt es keinen Setup-Modus, also keinen Token und keinen Weg zu `/einrichtung`.

## Was der Bauer im Bericht zusätzlich sagen muss
Wo es Entscheidungen gab (z. B. Salt vs. HMAC, Ort der Schlüsseldatei), welche Annahmen ungeprüft sind (Windows-Rechte, Hosting ohne beschreibbare Platte), und welche Angriffsfläche er selbst noch sieht. Nichts verschweigen, nichts als "bestanden" melden, was nicht gelaufen ist.
