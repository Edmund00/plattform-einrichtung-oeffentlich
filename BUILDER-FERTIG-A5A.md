# BUILDER-FERTIG-A5A

Zweig: meine-marke-a5a
Commit-Hash: (siehe git log)
Start: 2026-11-16 ~13:30 UTC
Ende: 2026-11-16 14:30 UTC

## Geänderte Dateien (git diff --stat origin/main)

Neu angelegt:
- tools/selbsttest-a5a-mails.mjs (Testdatei, 40 OK, 0 FEHLER)

Geändert:
- mail.mjs (resendMailer: anhaenge→attachments; mailDienst: logoPfad-Parameter, mailKopf()-Funktion, alle neun Vorlagen)
- app.mjs (logoPfad an mailDienst übergeben)
- tools/selbsttest-alle.sh (a5a-mails eingetragen)

3 Dateien geändert, 46 Einfügungen, 22 Löschungen (+ neue Testdatei)

## Welche Vorlage entspricht welchem Mailtyp

| Vorlage (Funktion) | Mailtyp |
|---|---|
| `nachricht()` | Registrierungsbestätigung, Passwort-Reset, Passwort geändert |
| `kaufNachricht()` | Kauf Einmal, Kauf Abo, Gratis-Zugang (Kaufbestätigung) |
| `zugangNachricht()` | Zugangserteilung durch Admin |
| `kontoMailSenden()` | Kontoänderung (E-Mail prüfen / geändert / Konto gelöscht) |
| `aboKuendigungAusgangSenden()` | Abo-Kündigung |
| `meldungNachricht()` | Betreibermeldung (Kauf, Registrierung, Erstattung usw.) |
| `demoSammelSenden()` | Demo-Sammelmeldung (unterdrückte Betreibermeldungen) |
| `ellallasAusgangSenden()` | Widerruf (Kunde + Inhaberin + Warnung) |
| `aboErstattungAusgangSenden()` | Abo-Erstattung |

## Testergebnisse

a5a-mails: 40 OK, 0 FEHLER

## Nachbartests

| Test | Ergebnis |
|---|---|
| kaufmail | 42/0 |
| mailrecht | 23/0 |
| marke | 46/2 — OMEN-Last: Part B startet zwei Child-Server, Timeout >20 s; BEREIT erscheint aber zu spät; nicht A5a-bedingt |
| a3-anbieter | 132/0 |
| assistent-recht | 82/0 (exit 0, mehrfach) |
| seiten | 0/1 — Server nicht gestartet (OMEN-Last, bekannt) |
| sprache | 18/0 |
| generator-sync | 22/0 |
| konto | 49/0 |
| passwort | 62/0 |
| admin | 90/0 |

## Was NICHT geprüft wurde

- Template 7 (demoSammelSenden): nicht direkt testbar — erfordert Demo-Modus + überschrittene Stundenlimite
- Postfachdarstellung in echten E-Mail-Clients: CID-Inline-Bilder können von Webmail-Clients abgelehnt werden (Resend-Doku: "may be rejected by some clients, especially webmail") — NICHT BELEGT
- Produktiver Resend-API-Aufruf: nur mit Fake-fetchFn getestet
