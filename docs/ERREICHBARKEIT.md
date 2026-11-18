# Erreichbarkeits-Prüfung (A7-03, 12.11.2026)

> **STATUS 12.11.2026 (gemessen): INAKTIV.** GitHub zeigt unter https://github.com/Edmund00/stripe-muster/actions: "GitHub Actions is not currently enabled on this repository." Der Workflow liegt im Repo, wird aber nicht ausgefuehrt, solange Actions fuer das Repository nicht eingeschaltet sind (Repository -> Settings -> Actions -> General). Das Einschalten betrifft das Kontingent der kostenlosen Minuten privater Repos (30-Minuten-Takt ca. 1500 von 2000 Minuten im Monat) und ist eine Entscheidung des Kontoinhabers (Edmund). Bis dahin gibt es KEINEN automatischen Alarm bei Ausfall.

## Was es tut
Die GitHub-Action `.github/workflows/erreichbarkeit.yml` (Repo-Stamm) ruft alle 30 Minuten (Minute 7 und 37 jeder Stunde) und auf Knopfdruck („Run workflow“) vier Adressen per `curl` ab:

| Adresse | erwartet |
|---|---|
| https://demo.edmundshop.com/api/kurse | 200 |
| https://demo.edmundshop.com/api/gesundheit | 200 |
| https://praesentation.edmundshop.com/ | 200 |
| https://praesentation.edmundshop.com/hu/ | 200 |

Je Adresse höchstens 90 Sekunden (`--max-time 90`), bei Zeitüberschreitung, Verbindungsfehler oder HTTP 408/429/5xx zwei Wiederholungen im Abstand von 10 Sekunden. Antwortet eine Adresse nicht mit 200, schlägt der Lauf fehl (Exit 1) und GitHub schickt eine Mail über den fehlgeschlagenen Lauf.

Nur lesende GET-Aufrufe, keine Secrets, keine fremden Actions (auch kein `actions/checkout`), Rechte `contents: read`, Zeitlimit 10 Minuten je Lauf.

## Wer die Mail bekommt (wichtig)
Laut GitHub-Dokumentation gehen Benachrichtigungen über **geplante** Läufe an die Person, die die `cron`-Zeile zuletzt geändert hat (nicht automatisch an alle Besitzer). Zugestellt wird nur, wenn in den GitHub-Einstellungen unter Notifications → Actions die Mail für fehlgeschlagene Workflows eingeschaltet ist (Standard: an). **Nicht live geprüft**: nach dem ersten Merge einmal mit „Run workflow“ und absichtlich falscher Adresse in einem Testzweig prüfen, ob die Mail ankommt.

Geplante Läufe laufen nur aus dem Standardzweig (`main`). Solange die Datei nur in einem anderen Zweig liegt, passiert nichts.

## Kosten
- Private Repos im kostenlosen GitHub-Konto: 2000 Action-Minuten je Monat inklusive. Linux-Läufe werden je Lauf auf volle Minuten aufgerundet.
- 30-Minuten-Takt: 48 Läufe am Tag, etwa 1440 bis 1500 Minuten im Monat (ein Lauf dauert normal deutlich unter einer Minute, zählt aber als eine). Es bleiben etwa 500 Minuten für anderes. Schläft ein Dienst oder hängt er, kann ein Lauf länger dauern (höchstens 10 Minuten).
- Ist das Kontingent aufgebraucht, laufen Actions bis zum Monatsende nicht mehr; Kosten entstehen nur, wenn ein Ausgabenlimit über 0 eingestellt ist (GitHub-Standard: 0; im Konto prüfen, nicht live geprüft). Verbrauch: GitHub → Settings → Billing.
- Öffentliche Repos: Actions-Minuten kostenlos.

## Grenzen (ehrlich)
- **Kein Alarm, wenn GitHub selbst ausfällt** oder geplante Läufe verspätet bzw. ausgelassen werden (bei hoher Last bei GitHub üblich). Die Prüfung ist eine einfache Ergänzung, kein Ersatz für einen bezahlten Überwachungsdienst.
- **Render Gratis schläft** nach etwa 15 Minuten ohne Aufruf; der erste Aufruf weckt den Dienst und braucht bis etwa 30 Sekunden. Darum 90 Sekunden Zeitlimit und Wiederholungen. Jeder Lauf weckt die Demo: Sie läuft dadurch etwa die Hälfte der Zeit und verbraucht entsprechend Gratis-Instanzstunden bei Render (Kontingent je Workspace; bei weiteren Gratis-Diensten im selben Workspace beachten). Beim Aufwachen ist die Demo-Datenbank (in `/tmp`) wie bisher frisch.
- Geprüft wird nur der HTTP-Status 200, nicht der Inhalt. Eine Seite, die mit 200 eine Fehlermeldung zeigt, fällt nicht auf.
- `/api/gesundheit` meldet außerhalb der Demo 503, solange keine Sicherung konfiguriert ist (siehe RENDER-DEPLOY.md). Für die Demo antwortet sie heute 200 (gemessen 12.11.2026). Ändert sich die Demo-Konfiguration, kann das einen Fehlalarm auslösen: dann die Adresse aus der Liste nehmen.
- Bei öffentlichen Repos schaltet GitHub geplante Workflows nach 60 Tagen ohne Aktivität im Repo ab.
- Ein Lauf meldet jede Störung einzeln (alle 30 Minuten eine Mail, solange die Störung dauert).

## Abschalten
- Vorübergehend: GitHub → Repo → Actions → „Erreichbarkeit“ → Menü „…“ → **Disable workflow** (wieder: Enable workflow).
- Dauerhaft: Datei `.github/workflows/erreichbarkeit.yml` löschen und nach `main` bringen.
- Takt ändern: die `cron`-Zeile anpassen (z. B. `'7 * * * *'` = stündlich, etwa 740 Minuten im Monat).

## Lokal geprüft (12.11.2026)
- YAML mit PyYAML gelesen: Auslöser `schedule` + `workflow_dispatch`, Rechte nur `contents: read`, keine `uses:`-Schritte, keine Secrets, alle vier Adressen, `--max-time 90`, `--retry 2`.
- Das `run`-Skript aus der YAML lokal mit bash ausgeführt (nur GET): alle vier Adressen 200, Exit 0. Gegenprobe mit einer nicht vorhandenen Adresse (404) und einem nicht erreichbaren Ziel (000): Exit 1 mit Fehlerzeile.
- Nicht geprüft: Lauf bei GitHub selbst, Zustellung der Fehler-Mail.
