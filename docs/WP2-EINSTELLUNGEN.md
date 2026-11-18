# WP2 Verschluesselter Einstellungsspeicher

Stand: 2026-11-13, Bau-Sitzung Omen. Baut auf `docs/SPEZ-WP1-3-SICHERHEITSBLOCK.md` auf.

## Was WP2 tut (kurz)
- Neues Modul `einstellungen.mjs`: AES-256-GCM-verschluesselter Schluessel-Wert-Speicher auf der Tabelle `einstellungen` (WP1-Schema, keine Spaltenaenderung).
- Hauptschluessel = 32 Zufallsbytes. Quellen in dieser Reihenfolge: Umgebungsvariable `EINSTELLUNGEN_SCHLUESSEL` (Base64 von 32 Byte) > Datei `daten/.hauptschluessel` (Dateirechte 0600, in `.gitignore` via `daten/`).
- **Lazy**: Der Speicher wird in `server.mjs` nur geoeffnet, wenn in `einstellungen` mindestens eine Zeile ausser `instanz_zustand` existiert. Ohne gespeicherte Einstellungen bleibt der Server BIT-GLEICH wie vor WP2 (Bestandsinstanzen Render/Demo/Gabriella). Es wird keine Hauptschluessel-Datei beim Start erzeugt.
- **Hauptschluessel-Erzeugung nur beim ersten Schreiben**: `holeHauptschluessel` legt NIEMALS beim Lesen eine Datei an. Nur `erzeugeHauptschluesselDatei(pfad)` legt eine neue Datei an, und auch nur wenn sie nicht existiert. In WP3+ wird das beim ersten Schreiben eines Geheimnisses aufgerufen.
- **Vorrang beim Lesen**: `ladeKonfig` (WP1) wurde um `optionen.speicher` erweitert. Logik in `wert(name)`: env (nicht leer) > Speicher > Standard. Alle Format-/Typpruefungen bleiben unveraendert.
- **Maskierte Ausgabe**: `anzeige(name)` liefert `{ gesetzt: boolean, maskiert?: 'sk_test_••••abcd', wert?: 'klartext fuer nicht-geheime' }`. Klartextzugriff nur intern per `lese(name)`.
- **Integritaet**: Manipulierter Chiffretext oder Tag -> `KonfigFehler` mit neutraler Meldung ohne Wert.

## Geheimnisfelder (verschluesselt gespeichert)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY`, `SICHERUNG_BUNNY_SCHLUESSEL`, `SICHERUNG_SCHLUESSEL`, `WIEDERGABE_GEHEIMNIS`, `PLATTFORM_WEBHOOK_KEY`.
Nicht geheim (Klartext erlaubt): Plattformname, Anbieterdaten, Impressum-/Datenschutz-/Teilnahmebedingungen-URL etc.

## Bedrohungsmodell (kurz)
- Entwendete DB ohne Schluesseldatei -> Werte unlesbar (AES-256-GCM). Entwendet man DB UND Schluesseldatei vom selben Host, geht der Schutz verloren. Daher Empfehlung: `EINSTELLUNGEN_SCHLUESSEL` im Hoster-Secret-Store setzen, nicht in derselben Platte wie die DB.
- IV (12 Byte, zufaellig pro Wert) und Tag (16 Byte, GCM) duerfen in der DB stehen.
- Masking schuetzt nicht gegen Shoulder-Surfing der Quelle, sondern gegen versehentliches Durchrutschen in Logs/API-Antworten.
- `sk_live_` bleibt in jedem Modus abgelehnt.

## Wiederherstellung (Abriss)
- **Backup einer Instanz**: DB-Datei PLUS `daten/.hauptschluessel`. Beides getrennt aufbewahren; Stichprobe durch Rueckspielen auf frische Instanz testen (B9).
- **Verlust der Schluesseldatei**: Verschluesselte Werte sind nicht mehr lesbar. `holeHauptschluessel` bricht mit "Hauptschluessel fehlt (Datei oder EINSTELLUNGEN_SCHLUESSEL), aber verschluesselte Werte sind vorhanden. Wiederherstellung siehe docs/WP2-EINSTELLUNGEN.md." ab. Keine stille Neuerzeugung (das wuerde die alten Werte zerstoeren).
- **Verlust NUR der DB**: Neue DB anlegen, Admin neu erstellen, Werte neu setzen (Schluesseldatei bleibt gueltig, aber die neue DB enthaelt noch keine Werte).

## Empfehlung zu B8 (Sicherung)
Die automatische Sicherung (`sicherung`-Module, WP vor dem Sicherheitsblock) verschluesselt ihre Backups mit dem **separaten** `SICHERUNG_SCHLUESSEL`. **`.hauptschluessel` wird nicht in diese Sicherung aufgenommen**, denn sonst waere ein entwendetes Backup ohne Zusatzinformation lesbar.

Empfehlung des Bauers (Entscheidung beim Chef):
- Der Hauptschluessel wird GETRENNT aufbewahrt: a) auf der Produktiv-Instanz liegt die Datei `daten/.hauptschluessel`; b) eine Kopie liegt in einem Passwortmanager oder im Hosting-Secret-Store (`EINSTELLUNGEN_SCHLUESSEL`).
- Die Sicherungs-Automatik sichert NUR die DB. `.hauptschluessel` wird manuell (einmalig + bei Wechsel) und separat gesichert.
- Alternative "Beides in der Sicherung": schlechter, weil ein entwendetes Backup dann vollstaendig lesbar ist.

## Sicherheitsabgleich (Dinge, die WP2 nicht loest)
- Zweit-Prozess-Zugriff auf eine laufende WAL-DB: in WP1 nur im selben Prozess getestet. Fuer `oeffneEinstellungsSpeicher` gilt dieselbe Einschraenkung; im Normalbetrieb oeffnet nur server.mjs die DB.
- Rotierung des Hauptschluessels (alten Schluessel entfernen, neuen Schluessel verwenden): noch nicht implementiert. Vor der Rotierung muessen alle Werte entschluesselt und mit neuem Schluessel wieder geschrieben werden; das fehlt und ist spaeteres WP.
- Rechte der Hauptschluessel-Datei auf Windows: nicht per Mode-Bits erzwungen; Spez erlaubt das als "nicht geprueft".
