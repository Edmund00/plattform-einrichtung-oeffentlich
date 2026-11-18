# A5b – Sicherung und Wiederherstellung mit Logo

Stand: 16.11.2026, Zweig `meine-marke-a5b`. Keine Server gestartet, nichts committet.

## Geaenderte Dateien

- `sicherung.mjs`: Logo erst nach VACUUM und Zeilenzahlpruefung in die Zwischenkopie eingebettet. Transporttabelle wird dort neu angelegt; Live-DB bleibt davon unberuehrt. Injizierbarer `logoPfad`, standardmaessig aus dem tatsaechlichen DB-Pfad abgeleitet. Fehlendes, nicht lesbares oder zu grosses Logo wird ausgelassen und in `kurze_meldung` vermerkt. Limit aus `logo-png.mjs`.
- `tools/sicherung-entschluesseln.mjs`: Restore-Anleitung im Kopf, optional `--logo-ausgabe=<Pfad>`, Logo exklusiv mit `wx` schreiben, Transporttabelle entfernen und VACUUM. Alte Sicherungen ohne Tabelle bleiben kompatibel. Logo-Fehler liefern eine Warnung bei erfolgreichem DB-Restore.
- `tools/selbsttest-a5b-sicherung-logo.mjs` (neu): Offline-Integrationstest fuer Marke/Recht/Logo, erneute Sicherung, fehlendes/zu grosses/nicht lesbares Logo, alte Sicherung, alternativen Pfad, vorhandenes Logo und vorhandene Ausgabe-DB. Keine Server; isolierte DB-Prozesse mit expliziter Umgebung, kein neuer `process.env`-Zugriff.
- `tools/selbsttest-alle.sh`: neuen Test in `tests` eingetragen.
- `CODEX-FERTIG-A5B.md` (neu): dieser Bericht.

Vorhandene CRLF in den beiden geaenderten MJS-Produktionsdateien erhalten; Shellskript weiterhin LF, neue Dateien LF. Vorhandener unversionierter `node_modules`-Symlink unveraendert.

## Ausgefuehrte Pruefungen

- Neuer Test zuerst vor Implementierung gestartet: hier nicht funktional ausfuehrbar, weil `spawnSync /usr/bin/node` mit `EPERM` blockiert wird. Nach Ergaenzung einer expliziten Pruefung von `r.error` erneut gestartet: gleicher Umgebungsblocker, Exit 1. Kein erfolgreicher vollstaendiger ROT/GRUEN-Durchlauf behauptet.
- Stattdessen echte Offline-Integration in einzeln ueber die Shell gestarteten Node-Prozessen unter `/tmp/a5b-pruefung` ausgefuehrt: Sicherung von Instanz A mit drei Marke-Zeilen (Name, Farben, Anbieter), Rechtstext und aktivem Versionszeiger; Restore in neuen Ordner B. Alle Zeilen unveraendert, Logo bytegleich, Transporttabelle weder in A noch in B vorhanden: bestanden.
- Zweite Sicherung aus B: bestanden, Live-DB weiterhin ohne Transporttabelle.
- Logo fehlt / groesser als 512 KiB / Verzeichnis statt lesbarer Datei: jeweils Sicherung erfolgreich; Protokoll meldet `logo_fehlt`, `logo_zu_gross` bzw. `logo_nicht_lesbar`. Alle drei Restores erfolgreich mit `kein Logo in der Sicherung`: bestanden.
- Alte Sicherung ohne Transporttabelle: Restore erfolgreich mit `kein Logo in der Sicherung`.
- Vorhandenes Logo-Ziel: Warnung, erfolgreicher DB-Restore, Zieldatei unveraendert, Transporttabelle trotzdem entfernt: bestanden.
- Expliziter alternativer Logo-Pfad: Restore erfolgreich und Logo bytegleich.
- Vorhandene Ausgabe-DB: erwarteter Fehler/Exit 1, exklusiver Schreibschutz greift.
- Zeilenvergleich und Abwesenheit der Transporttabelle auch in den sechs zusaetzlichen Restore-DBs geprueft: bestanden.
- `node --check` fuer alle drei neuen/geaenderten MJS-Dateien, `bash -n tools/selbsttest-alle.sh`: bestanden.
- `git -c core.whitespace=cr-at-eol diff --check`: bestanden. Zeilenenden zusaetzlich auf Byte-Ebene geprueft.

## NICHT geprueft / offen fuer Chef

- Vollstaendiger neuer Selbsttest auf einer Umgebung, die Node-Unterprozesse erlaubt; funktionaler ROT-Durchlauf vor Implementierung war durch EPERM blockiert.
- Bestehender `tools/selbsttest-sicherung.mjs` nicht ausgefuehrt: er startet explizit mehrere HTTP-Server und widerspricht damit dem Serververbot. Gruenstatus deshalb nicht bestaetigt.
- Gesamtsuite, Browser/App-Neustart, echte externe Sicherungsziele und echte Dateiberechtigungsfehler (EACCES) nicht getestet. Nichtlesbarkeit wurde durch ein Verzeichnis am Logo-Pfad geprueft.
- Keine A5a-Mailaenderungen integriert oder getestet.
