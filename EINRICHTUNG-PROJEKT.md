# EINRICHTUNG-PROJEKT: Regeln für die Bau-Sitzung (zuerst lesen)

**Projekt:** Die fertige Plattform (Musterakademie) wird so erweitert, dass ein Kunde ohne PC-Kenntnisse sie allein einrichten kann: Einrichtungsassistent im Adminbereich (Logo, Name, Impressum, Datenschutz, Zahlung, Mail), danach arbeitet die normale Käuferseite mit seinen Angaben. Ziel: 100.000 bis 1.000.000 Kunden. Plan: Fassung 1.1 (Drive-Dokument 16 "Projektplan Einrichtung", Kopie im Repo Edmund00/projektzentrale unter PROJEKTE/DOKU-PAKET-DRIVE-HTML/16-projektplan-einrichtung-2026-11-13.html, Zweig medion-remote-control-2026-10-24).

**Herkunft dieser Kopie:** siehe SOURCE-VERSION.md (eingefrorener Stand von Edmund00/stripe-muster, Commit 390d2b6). Das Produktiv-Repo stripe-muster, die Demo und Gabriellas Plattform werden NIE verändert.

## Rollen
- **Edmund** entscheidet an den Gates; er sitzt oft nicht am PC und kann nichts bestätigen. Stelle ihm keine Rückfragen per AskUserQuestion.
- **Hauptsitzung "Projektzentrale"** (HP-Laptop) ist der Chef: gibt Aufträge, prüft jeden Stand (Diff, alle Tests), lässt ChatGPT als zweiten Prüfer gegenlesen und merged erst danach.
- **Bau-Sitzung (du)**: baust genau ein Arbeitspaket (WP) pro Auftrag in einem eigenen Zweig.

## Harte Regeln
1. Keine Geheimnisse lesen, anzeigen, committen oder in Logs schreiben (Stripe-Schlüssel, SMTP-Passwörter, Tokens). Nur Testmodus (sk_test_), nie Live.
2. Kein Push auf `main`. Jedes WP: Zweig `wp<N>-<kurzname>`. Kein Deploy. Nichts außerhalb dieses Ordners ändern.
3. Vor jedem WP: Baseline festhalten (Ausgangs-Commit, alle bestehenden Tests ausführen und Ergebnis notieren). Nach jedem WP laufen ALLE Tests (`powershell -NoProfile -File tools/Selbsttest-Alle.ps1` bzw. die gleichwertigen node-Aufrufe) und die neuen Tests.
4. Jeder neue Test braucht eine Gegenprobe (ohne die Änderung muss er rot sein).
5. Nur Dateien ändern, die der Auftrag erlaubt. Alles andere ist ein Fehler und wird gemeldet.
6. Node 24 ist Pflicht (node:sqlite). Abhängigkeiten nicht ohne Auftrag hinzufügen (heute nur express 5.1.0 und stripe 18.1.0).
7. Wenn etwas blockiert (Genehmigung, fehlende Anmeldung, unklarer Auftrag): sofort "BLOCKIERT: <Grund>" melden statt zu warten.

## Fertigmeldung je WP
Datei `BUILDER-FERTIG-WP<N>.md` (erst NACH dem Commit): Commit-SHA, Ausgangs-Commit, Testbefehle und tatsächliche Ausgaben (Schlusszeilen), Liste der geänderten Dateien, offene Fehler. Dazu im Chat eine Zeile "FERTIG: WP<N> <SHA>".

## Sprache und Stil
Dokumentation und Meldungen auf Deutsch, kurz und ehrlich; Quelltext-Kommentare wie im bestehenden Code (Deutsch). Texte für Käufer in DE/EN/HU.
