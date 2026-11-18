# Plan: Plattform-Daten vollautomatisch in Gabrielas Dashboard (angelegt 03.11.2026, Edmund-Auftrag)

Ziel: Gabrielas Büro. Sie sieht an EINER Stelle: wer hat welchen Kurs gekauft oder abonniert, wer hat bezahlt, wer nicht, was kam netto an, was wurde ausgezahlt, was ist schiefgelaufen. Kein Springen zwischen Stripe und Plattform. Ziel 90 bis 95 Prozent automatisch, ohne KI-Nutzung. Gilt auch im Testmodus (Spalte Test/Live, getrennt von der normalen Buchhaltung bis zum Livegang). Frist: 14 Tage (bis 17.11.2026).

## Entscheidungen (Edmund, 03.11.2026)
- Name und E-Mail der Kunden stehen im Plattform-Sheet (Gabriella ist Verantwortliche, Sheet gehört ihr). Dafür vor Livegang: Datenschutzhinweis und Verarbeitungsverzeichnis ergänzen (Google Sheets als Speicherort), Sheet nur für Gabriella und Edmund freigeben.
- Vollautomatisch, kein Handeintrag. Von Hand bleiben nur Gabriellas Entscheidungen (zum Beispiel Erstattung gewähren).

## Datenquellen (alles bereits in der Plattform oder bei Stripe)
| Was | Quelle |
|---|---|
| Kunde (E-Mail, Anzeigename, Rechnungsname) | Tabelle `benutzer` (`anzeigename`, `rechnung_name`) |
| Kauf, Betrag, Status bezahlt/pruefen/erstattet | `bestellungen` |
| Abo, Status, gültig bis, endet zum Periodenende | `abos` |
| Gebühr, Netto, Beleg-Link, Auszahlung | Stripe: Balance Transaction der Zahlung (`fee`, `net`), Charge `receipt_url`, Payout |
| Fehlgeschlagene Zahlung, Streitfall | Stripe-Ereignisse `invoice.payment_failed`, `charge.dispute.created` (Webhook muss abonniert sein) |
| Auszahlung | Stripe-Ereignisse `payout.paid`, `payout.failed` |

## Zielbild im Plattform-Sheet (neue Reiter, jeder mit Spalte Test/Live)
- **Kunden-Abos:** Kunde (Name, E-Mail), Kurs, Art (Kauf/Abo), Status (aktiv, gekündigt zum Datum, überfällig, erstattet), Betrag, Währung, seit, bezahlt bis/nächste Abbuchung.
- **Zahlungen:** Datum, Kunde, Kurs, Brutto, Gebühr, Netto, Währung, Status, Stripe-Beleg-Link.
- **Auszahlungen:** Datum, Betrag, Währung, Status (bezahlt/fehlgeschlagen), enthaltene Zahlungen.
- **Probleme:** fehlgeschlagene Zahlung, Streitfall, Erstattung, mit Datum, Kunde, Grund.
- Bestehend: Ereignisse (Verlauf), Zusammenfassung (Zahlen), Kosten, Links.

## Technik
1. Das Script bekommt eine zweite Nachrichtenart „Zeile setzen" (Blatt, Schlüssel, Werte): gleicher Schlüssel überschreibt dieselbe Zeile (Status ändert sich), neuer Schlüssel hängt an. Gleicher geheimer Schlüssel, gleiche Ablehnregeln, nur erlaubte Blätter und Spalten.
2. Die Plattform vermerkt Änderungen bei Bestellung, Abo, Erstattung, Zahlungsfehler, Streitfall, Auszahlung in `plattform_ausgang` (bestehende Warteschlange, Wiederholung, nie aufgeben) und sendet „Zeile setzen".
3. Täglicher Abgleich als Selbstheilung: Die Plattform sendet den vollständigen Bestand aller Abos und Bestellungen (idempotent) und prüft gegen Stripe, damit verpasste Ereignisse ausgeglichen werden.
4. Die Dashboard-Seite „Schulungsplattform – TESTMODUS" liest die Reiter beim Öffnen (mcp, get_values), kein Lauf.
5. Nichts davon landet in expenses, payments, tickets, state, links der normalen Buchhaltung. Beim Livegang werden Summen bewusst von Hand übernommen.

## Schritte (je Schritt: Test mit Gegenprobe, Pruef-Agent, Protokoll, Rueckweg)
1. Plan und Gabriellas Claude abstimmen (Spalten, Anzeige). 
2. Script erweitern, mit Testdaten pruefen.
3. Plattform: Bestellungen/Abos/Kunden senden (Test), Livetest mit Stripe-Testkauf und Abo.
4. Stripe-Gebühr, Netto, Beleg-Link, Auszahlungen, Zahlungsfehler, Streitfälle (Webhook-Ereignisse im Testkonto abonnieren).
5. Täglicher Abgleich.
6. Dashboard-Seite erweitern, Fehlerfälle zeigen Meldung statt 0.
7. Ungarische Anleitung für Gabriella, Checkliste, Protokoll. Livegang-Übernahme beschreiben.

## Offen
- Stripe-Konto beim Livegang: dasselbe Live-Konto wie die normale Buchhaltung? Dann Plattform-Zahlungen markieren (Metadaten), damit der Stripe-Abgleich der Buchhaltung sie nicht doppelt zählt.
- Rechnung/Quittung nach ungarischem Recht je Verkauf (szamlazz.hu o. ä.): getrennt klären (Zahlungssystem Z-Liste).
- Datenschutzhinweis für die Kundendaten im Sheet.
