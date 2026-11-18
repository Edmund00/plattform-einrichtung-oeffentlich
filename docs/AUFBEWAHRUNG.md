# Aufbewahrung und Löschung von Daten (A6-02, A6-03, Stand 12.11.2026)

**Keine Rechtsberatung.** Diese Datei beschreibt, was der Code heute tatsächlich tut, und macht einen **Vorschlag** für Fristen. Welche Fristen gelten (ungarisches Recht, DSGVO, Buchhaltung, Steuer), legt ein Anwalt bzw. eine Steuerberaterin fest. Bis dahin ist alles unter „Vorschlag“ **offen**.

## 1. Sicherungen (Backups)
Quelle: `sicherung.mjs` (Funktion `aufraeumen`).
- Lokale Sicherungen (verschlüsselt, AES-256-GCM) werden so ausgedünnt: die 3 neuesten, alle der letzten 48 Stunden, je Tag eine für 30 Tage, je Monat eine für **12 Monate**. Danach werden sie gelöscht.
- **Externe Kopien bei Bunny** (nur wenn der Bunny-Speicher für Sicherungen eingerichtet ist): Die App lädt sie hoch, **löscht sie aber nie**. Dort gilt also keine Frist, bis jemand sie von Hand löscht. Offen: Aufräumen dort einrichten (Code oder Bunny-Regel).
- Folge für gelöschte Konten: Ein gelöschtes Konto steckt bis zu 12 Monate (lokal) bzw. unbegrenzt (Bunny) noch in älteren Sicherungen, verschlüsselt.
- **Nach einer Wiederherstellung** (Restore) aus einer älteren Sicherung sind Konten, die seither gelöscht wurden, **wieder da** – mit E-Mail, Rechnungsdaten und Bestellungen im Klartext. Die App wendet Löschungen nach einem Restore **nicht** von selbst erneut an.
  - Bis das automatisch geht: **vor** dem Restore aus der noch laufenden Datenbank die Benutzer-IDs der gelöschten Konten notieren (`SELECT id FROM benutzer WHERE geloescht IS NOT NULL`; ein gelöschtes Konto bleibt als leerer Datensatz mit Löschzeit stehen) und **nach** dem Restore für diese IDs die Löschung erneut ausführen (Edmunds Claude Code, mit Test auf einer Kopie). Ist die laufende Datenbank selbst verloren, gibt es heute keine andere Liste: Die App schreibt bei der Löschung kein eigenes Ereignis und keine Betreibermail. Offen: ein Löschprotokoll nur mit Benutzer-IDs außerhalb der Datenbank bzw. in jeder Sicherung, das nach dem Restore automatisch erneut angewendet wird.
- Render-Momentaufnahmen und die Demo (Datenbank in `/tmp`, ohne Sicherung) sind hier nicht erfasst.

## 2. Was bei der Kontolöschung passiert
Quelle: `routes-konto.mjs`, Route `POST /api/konto/loeschen`.

**Gelöscht bzw. geleert:** Sitzungen, Passwort-/E-Mail-Token, wartende Mails (Bestätigung, Kauf, Gratis, Betreibermeldungen zu diesem Konto), Zugänge, E-Mail-Verlauf. Im Benutzerdatensatz werden E-Mail (ersetzt durch `geloescht-<id>@invalid.invalid`), Passwort, Stripe-Kunden-ID, Anzeigename, alle Rechnungsfelder und die Einwilligung geleert. In der Ereignisliste wird die E-Mail entfernt. Der Stripe-Kunde wird bei Stripe gelöscht (mit Wiederholung, nur die `cus_`-ID wird dafür kurz vorgemerkt).

**Bleibt bestehen** (über die Benutzer-ID verknüpft, ohne E-Mail und ohne Rechnungsdaten):
| Daten | Tabelle | Warum |
|---|---|---|
| Bestellungen (Kurs, Betrag, Währung, Status, Zeit, Stripe-Sitzungs- und Zahlungs-ID) | `bestellungen` | Buchhaltung, Erstattungen, Abgleich mit Stripe |
| Zustimmung zum vorzeitigen Beginn (Textversion, Zeit) | `kauf_zustimmung` | Nachweis, dass das Widerrufsrecht erlischt |
| Erster Zugriff auf den Kurs | `erster_zugriff` | Nachweis bei Widerruf |
| Downloads von Download-Produkten (Kurs, Lektion, Sprache, Zeit; keine IP, keine Sitzung, kein Pfad) | `download_protokoll` | Nachweis der Bereitstellung bei Widerruf (Block 3, 12.11.2026; gleiche Behandlung wie `erster_zugriff`) |
| Widerrufe und ihr Ergebnis | `ellallas` | Nachweis, Erstattung |
| Ereignisse ohne E-Mail | `ereignisse` | Statistik; werden nach `EREIGNIS_AUFBEWAHRUNG_TAGE` (Standard 730 Tage) gelöscht |
| Admin-Anmeldeprotokoll (E-Mail und Adresse maskiert) | `admin_login_protokoll` | Sicherheit, nur anhängen |

Der Text im Konto sagt dazu nur „Bestelldaten, die gesetzlich aufbewahrt werden müssen, bleiben erhalten“ – **ohne Frist**. Für Bestellungen, Zustimmungen, erste Zugriffe und Widerrufe gibt es heute **keine automatische Löschung**. Bei Stripe bleiben Zahlungen (Charges, Erstattungen) nach Stripes eigenen Regeln gespeichert, auch wenn der Kunde gelöscht ist. Nicht belegt: ob sich Personen über die Stripe-Sitzungs-ID wieder zuordnen lassen (Stripe-Dashboard enthält Zahlungsdaten).

## 3. Vorschlag für Fristen (OFFEN – vom Anwalt festzulegen)
| Daten | Vorschlag | Begründung des Vorschlags | Status |
|---|---|---|---|
| Bestellungen (pseudonym) | Ende des Jahres der Bestellung + 8 Jahre | Häufige Aufbewahrungsfrist für Buchungsbelege in Ungarn (Számviteli törvény, 8 Jahre) – vom Anwalt bzw. der Steuerberaterin zu bestätigen | offen |
| Zustimmung, erster Zugriff, Download-Protokoll, Widerruf | wie die zugehörige Bestellung | gehören zum selben Vorgang | offen |
| Ereignisse (ohne E-Mail) | 730 Tage (heute schon so) | reine Statistik | umgesetzt, Frist zu bestätigen |
| Sicherungen lokal | 12 Monate (heute so) oder kürzer, z. B. 3 Monate | kürzer = gelöschte Konten verschwinden schneller aus Sicherungen | offen |
| Sicherungen bei Bunny | dieselbe Frist wie lokal | heute unbegrenzt | offen (Umsetzung fehlt) |
| Admin-Anmeldeprotokoll | 12 Monate | Sicherheitsnachweis, maskiert | offen |

Nach der Entscheidung: Fristen in die Datenschutzerklärung und in den Konto-Hinweis schreiben, eine automatische Bereinigung bauen (mit Test) und den Restore-Ablauf (Abschnitt 1) um das erneute Anwenden der Löschungen ergänzen.

## Block 3: Download-Protokoll (12.11.2026)
- Tabelle `download_protokoll` (benutzer_id, kurs_id, lektion_id, sprache, zeit) entsteht bei jedem vollständig gesendeten Download eines Download-Produkts (nicht für Admins).
- Datenauskunft: erscheint unter `letoltesek` (Felder `eloadas_azonosito`, `lecke_azonosito`, `nyelv`, `idopont`) in `GET /api/konto/auskunft`.
- Kontolöschung: wie `erster_zugriff` bleibt der Eintrag über die (dann anonymisierte) Benutzer-ID erhalten; er enthält selbst keine E-Mail, keinen Namen, keine IP und keine Sitzung. Frist: wie die zugehörige Bestellung (offen, Anwalt).
