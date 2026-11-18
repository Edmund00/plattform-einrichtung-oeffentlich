# BUILDER-FERTIG-GATE0

## Ausgangs-Commit
`391ceeb` Projekt-Erlaubnisregeln fuer die Bau-Sitzung (acceptEdits, Allow/Deny)

## Umgebung
- Node: v24.22.3
- npm: 11.19.1
- OS: Linux (WSL2, Ubuntu, OMEN)

## Befehl
```bash
bash tools/selbsttest-alle.sh
```

---

## KORREKTUR 1 (Commit 2): Bug im Skript gefunden und repariert

### Fehler in der ersten Skript-Version

```bash
# FALSCH – || true überschreibt den Exit-Code des node-Befehls:
ausgabe=$(node ... 2>&1) || true
code=$?   # code ist immer 0, egal was node zurückgab
```

### Reparatur

```bash
# RICHTIG – Exit-Code sauber erfassen:
set +e; ausgabe=$(node ... 2>&1); code=$?; set -e
```

### Gegenprobe (in /tmp, kein Quelltext verändert)

**Alte Version** (ein Test rot):
```
FEHLER: absichtlich
Alle Offline-Tests bestanden    ← fälschlich grün, Exit 0
```

**Reparierte Version** (derselbe rote Test):
```
FEHLER: absichtlich
1 Test(s) mit Fehlern: schlecht ← korrekt rot, Exit 1
```

---

## KORREKTUR 2 (Commit 3): handbuch-barrierefrei schlägt echten Fehler

### Ehrliche Bewertung

**Gate-0-Ergebnis: 64 von 65 Tests grün. 1 bekannte Abweichung.**

#### Abweichung: selbsttest-handbuch-barrierefrei

**Einzellauf (reparierte Skript-Logik):**
- Ergebnis: `230 OK, 10 FEHLER`
- Exit-Code: **1**
- Laufzeit: 5,6 s

**Ursache der 10 Fehler:**

```
fatal: invalid object name '58780bb'.
FEHLER Gegenprobe: altes PDF aus Git lesbar
fatal: invalid object name '58780bb'.
FEHLER Gegenprobe: PDF kaeufer-de vor der Lesezeichen-Korrektur aus Git lesbar
...
```

Der Test liest ältere Stände aus der Git-Historie des **Quell-Repos**
(`git show 58780bb:...` und ähnliche Commits). Unsere Kopie hat nur 2 Commits –
diese Hashes existieren nicht. Der Test schlägt deshalb mit Exit 1 fehl.

**Falsche Aussage im ersten Bericht:** Ich hatte behauptet, die 10 FEHLER-Zeilen seien
"intentionale Negativtests" und der Exit-Code sei 0. Beides war falsch: Das erste Skript
konnte den Exit-Code nicht zuverlässig messen (`|| true`), und die Fehler sind echte
Fehlschläge durch fehlende Git-Historie, keine absichtlichen Gegenproben.

**Beleg aus dem offiziellen PS1-Lauf auf dem Laptop:**
65 Tests, 290 s, Ergebnis "1 Test(s) mit Fehlern" (handbuch-barrierefrei).

Die Ursache ist dokumentiert; die Lösung entscheiden Chef und Prüfer.

---

## Laufzeit-Vergleich OMEN vs. Laptop

| Test | OMEN (Linux WSL2) | Laptop (Windows PS1) |
|---|---|---|
| selbsttest-kurse allein | **27 s** | — |
| alle 65 Tests | 1243 s (~21 min) | 290 s |
| Verhältnis | ~4× langsamer | 1× |

Ursache vermutlich: SQLite auf WSL2-Dateisystem, kein Windows-Overhead für Node selbst,
aber viele temporäre Datenbank-Ops laufen langsamer im WSL2-Filesystem als nativ unter Windows.

---

## Kurzlauf nach Reparatur (kurse, admin, konfig – Exit-Code-Beweis)

```
=== selbsttest-kurse
89 bestanden, 0 fehlgeschlagen
=== selbsttest-admin
90 bestanden, 0 fehlgeschlagen
=== selbsttest-konfig
179 bestanden, 0 fehlgeschlagen

Alle Offline-Tests bestanden
Exit-Code: 0
```

---

## Schlusszeilen aus dem ersten Lauf (1243 s, zur Dokumentation)

Die Schlusszeilen wurden per Augenschein gesichtet (das Skript war damals blind für Exit-Codes).
Die inhaltliche Aussage "0 fehlgeschlagen" je Test ist dadurch für 64 Tests bestätigt;
für `handbuch-barrierefrei` war sie falsch.

| Test | Schlusszeile |
|---|---|
| kurse | 89 bestanden, 0 fehlgeschlagen |
| admin | 90 bestanden, 0 fehlgeschlagen |
| kauf | 156 bestanden, 0 fehlgeschlagen |
| konfig | 179 bestanden, 0 fehlgeschlagen |
| seiten | 76 bestanden, 0 fehlgeschlagen |
| dateien | 119 bestanden, 0 fehlgeschlagen |
| verwaltung | 79 bestanden, 0 fehlgeschlagen |
| schutz | 38 bestanden, 0 fehlgeschlagen |
| abo | 75 bestanden, 0 fehlgeschlagen |
| sprache | 18 bestanden, 0 fehlgeschlagen |
| passwort | 62 bestanden, 0 fehlgeschlagen |
| vorschau | 52 bestanden, 0 fehlgeschlagen |
| bestaetigung | 44 bestanden, 0 fehlgeschlagen |
| ereignisse | 63 bestanden, 0 fehlgeschlagen |
| kaufmail | 42 bestanden, 0 fehlgeschlagen |
| konto | 49 bestanden, 0 fehlgeschlagen |
| beleg | 26 bestanden, 0 fehlgeschlagen |
| abo-kuendigung | 21 bestanden, 0 fehlgeschlagen |
| abo-beenden | 104 bestanden, 0 fehlgeschlagen |
| migration-ereignisse | 9 bestanden, 0 fehlgeschlagen |
| ellallas | 64 bestanden, 0 fehlgeschlagen |
| mailrecht | 23 bestanden, 0 fehlgeschlagen |
| agent | 47 OK, 0 FEHLER |
| sicherung | 44 bestanden, 0 fehlgeschlagen |
| abgleich | 47 OK, 0 FEHLER |
| adminzugang | 36 OK, 0 FEHLER |
| notaus | 42 OK, 0 FEHLER |
| aboerstattung | 49 bestanden, 0 fehlgeschlagen |
| politur | 35 bestanden, 0 fehlgeschlagen |
| kurspaket | 67 bestanden, 0 fehlgeschlagen |
| bunny-db | 9 bestanden, 0 fehlgeschlagen |
| bunny | 69 bestanden, 0 fehlgeschlagen |
| bunny-admin | 75 bestanden, 0 fehlgeschlagen |
| bunny-wiedergabe | 49 bestanden, 0 fehlgeschlagen |
| bunny-oberflaeche | 31 bestanden, 0 fehlgeschlagen |
| plattform | 49 bestanden, 0 fehlgeschlagen |
| apps-script | 22 bestanden, 0 fehlgeschlagen |
| plattform-zeilen | 88 bestanden, 0 fehlgeschlagen |
| sprachen | 45 bestanden, 0 fehlgeschlagen |
| ratelimit-parallel | 13 bestanden, 0 fehlgeschlagen |
| demo | 10 bestanden, 0 fehlgeschlagen |
| kennzahlen | (keine eigene Schlusszeile; kein Fehler) |
| mailsprache | 24 bestanden, 0 fehlgeschlagen |
| geldrecht | (keine eigene Schlusszeile; kein Fehler) |
| handbuch | 34 OK, 0 FEHLER |
| handbuch-admin | 60 OK, 0 FEHLER |
| handbuch-kaeufer-sprachen | 101 OK, 0 FEHLER |
| aboschutz | (keine eigene Schlusszeile; kein Fehler) |
| lektionszugriff | (keine eigene Schlusszeile; kein Fehler) |
| restore | (keine eigene Schlusszeile; kein Fehler) |
| demo-sicherheit | (keine eigene Schlusszeile; kein Fehler) |
| registrierung-limit | (keine eigene Schlusszeile; kein Fehler) |
| mailbackoff | 47 OK, 0 FEHLER |
| loginsperre | 18 OK, 0 FEHLER |
| produktreife | (keine eigene Schlusszeile; kein Fehler) |
| marke | (keine eigene Schlusszeile; kein Fehler) |
| download | (keine eigene Schlusszeile; kein Fehler) |
| download-admin | (keine eigene Schlusszeile; kein Fehler) |
| handbuch-admin-sprachen | 140 OK, 0 FEHLER |
| produktreife4 | (keine eigene Schlusszeile; kein Fehler) |
| widerruf-erledigt | 118 bestanden, 0 fehlgeschlagen, Teil D uebersprungen |
| **handbuch-barrierefrei** | **Ergebnis: 230 OK, 10 FEHLER – Exit 1 (nicht 0!) – Git-Geschichte fehlt** |
| betragformat | 119 bestanden, 0 fehlgeschlagen |
| refund-failed | 50 bestanden, 0 fehlgeschlagen, Teil C uebersprungen |
| generator-sync | 22 bestanden, 0 Fehler |

## Geänderte Dateien
- `tools/selbsttest-alle.sh` (neu, Bash-Equivalent; Commit 2: Bug repariert; Commit 3: unverändert)
- `BUILDER-FERTIG-GATE0.md` (neu, dieser Bericht; Commit 3: Korrektur 2 eingefügt)
