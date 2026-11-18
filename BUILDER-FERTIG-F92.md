# BUILDER-FERTIG F-92 / F-93 (15.11.2026)

Branch `sicherheit-1b-f92` (Basis origin/main 02bb233), Worktree `C:\Users\diaco\Projekte\pe-f92`. Kein Push, kein Merge.

## F-92 (Commit e0bf204): Umsatz ohne Teilerstattungen
- Befund im Code: Teilerstattungen wurden nur als `grund='teilerstattung'` vermerkt (zahlung.mjs erstattungVerarbeiten); der Betrag stand nirgends an der Bestellung (abo_erstattung_eintrag nur Refund-IDs, Ereignisliste nicht kumulativ verlaesslich).
- db.mjs: neue Spalte `bestellungen.erstattet_betrag INTEGER NOT NULL DEFAULT 0` (idempotente Migration).
- zahlung.mjs (minimal, 3 Zeilen): kumulativer Stand `max(charge.amount_refunded, Summe erfolgreicher refunds)`, gespeichert per `MAX(erstattet_betrag, ?)` (doppelte/verspaetete Ereignisse ziehen nie doppelt ab).
- routes-bestellungen.mjs: `umsatz = SUM(betrag - MIN(erstattet_betrag, betrag))` je Waehrung, ganze Cent.
- Test `tools/selbsttest-f92-umsatz.mjs` (Port 19692, signierte Webhooks): vorher 6 von 12 rot, jetzt 12/12.

## F-93 (Commit 93c5a26): Widerrufs-Mail nennt erstatteten Betrag
- erstattung-stripe.mjs: `vollErstatten` liefert zusaetzlich `erstattet_betrag` (refund.amount, sonst angeforderter Restbetrag; `bereits_erstattet` -> null).
- db.mjs: Spalte `ellallas.erstattet_betrag` (NULL erlaubt); routes-ellallas.mjs setzt sie im Haupt- und Wiederaufnahmeweg.
- mail.mjs: bei `ergebnis='erstattung'` neue Zeile `ellallas_erstattet_betrag` (texte hu/de/en) in Kunden- und Inhabermail; Bestellbetrag-Zeile bleibt.
- Test `tools/selbsttest-f93-widerruf-betrag.mjs` (Port 19693): vorher 4 von 8 rot, jetzt 8/8.

## Bestehende Tests (alle gruen)
kennzahlen 10, kauf 157, aboerstattung 51, ellallas 64, refund-failed 65, widerruf-erledigt 169, ereignisse 63, migration-ereignisse 9, restore 24, abgleich 47, sprachen 45, mailsprache 24, mailrecht 23, geldrecht 66. Beide neuen Tests in tools/selbsttest-alle.sh eingetragen (Selbsttest-Alle.ps1 nicht geaendert). Gesamtlauf nicht gemacht.

## Offene Punkte
- Bestehende Teilerstattungen aus der Zeit vor der Migration haben erstattet_betrag 0: Umsatz bleibt fuer sie zu hoch, bis ein neues charge.refunded kommt (Nachbuchung ueber Abgleich/Stripe nicht gebaut).
- Widerruf nach frueherer VOLLER Erstattung (`bereits_erstattet`): keine Zeile "erstatteter Betrag" (NULL), Absicht.
- Abo-Teilerstattungen nutzen denselben Weg (erstattungVerarbeiten), eigener Abo-Test dafuer nicht geschrieben.
- Handbuch/Hilfetext unveraendert (Text "ohne Erstattungen" stimmt jetzt).
