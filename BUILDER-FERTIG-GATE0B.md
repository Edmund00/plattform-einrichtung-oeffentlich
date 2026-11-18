# BUILDER-FERTIG-GATE0B: WP0b – Tests auf dem Omen schnell machen

## Ausgangs-Commit
`f0c1d08` (gate0-tests) Gate 0 Fertigbericht korrigiert: handbuch-barrierefrei Exit 1

## Umgebung
- Node: v24.22.3  
- npm: 11.19.1  
- OS: Linux (WSL2, Ubuntu, OMEN – WSL-Platte auf USB-SSD J:)

---

## Was wurde geändert

Einzige geänderte Datei: `tools/selbsttest-alle.sh`

Neue Funktion: Opt-in-Umgebungsvariable `PE_TEST_RAM=1`.

Wenn gesetzt:
- Prüft zuerst `git check-ignore daten`; Abbruch mit Fehlermeldung wenn `daten/` nicht ignoriert ist.
- Registriert `trap _pe_aufraumen EXIT` (läuft auch bei rotem Test / Abbruch).
- Legt `/dev/shm/pe-daten` und `/dev/shm/pe-tmp` an.
- Setzt `TMPDIR=/dev/shm/pe-tmp`.
- Verschiebt `daten/` → `daten.pe-sicherung/`, legt Symlink `daten → /dev/shm/pe-daten` an.
- Cleanup `_pe_aufraumen`: entfernt Symlink, verschiebt `daten.pe-sicherung/` zurück, löscht `/dev/shm`-Verzeichnisse.

Ohne `PE_TEST_RAM=1`: Skript verhält sich unverändert.

---

## Gegenprobe (1): Timing mit und ohne PE_TEST_RAM

Drei Tests: kurse, mailbackoff, konfig

| Variante | Dauer |
|---|---|
| ohne PE_TEST_RAM | 205 s |
| mit PE_TEST_RAM=1 | 5,4 s |
| Faktor | ~38× |

Einzelmessungen:
```
# ohne:
real    3m25.947s   user 0m4.879s   sys 0m1.305s

# mit:
real    0m5.422s    user 0m4.228s   sys 0m0.960s
```
Die Rechenzeit (user) ist nahezu identisch (~5 s beide Male) – der Unterschied liegt rein im I/O.

---

## Gegenprobe (2): Wiederherstellung nach rotem Test

Skript in /tmp, ein absichtlich roter Test, `PE_TEST_RAM=1`:

```
VOR dem roten Test:
  daten ist Symlink: JA
  TMPDIR=/dev/shm/pe-tmp
FEHLER: absichtlich
  Roter Test Exit-Code: 1

NACH dem Skript:
  daten ist Verzeichnis: JA        ← wiederhergestellt
  daten ist Symlink: NEIN          ← Symlink entfernt
  /dev/shm/pe-daten existiert: NEIN  ← bereinigt
  /dev/shm/pe-tmp existiert: NEIN    ← bereinigt
```

## Gegenprobe (3): Exit-Code bei rotem Test

Exit-Code des Skripts: **1** (wie erwartet).

---

## Gesamtlauf PE_TEST_RAM=1

```
PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
```

**Ergebnis: 1 Test(s) mit Fehlern: handbuch-barrierefrei**  
**Dauer: 78 s** (real 1m18s – vs. ~1243 s ohne PE_TEST_RAM, Faktor ~16×)

Hinweis: Der Gesamtlauf wurde über eine Pipeline zu `grep` ausgegeben, daher
zeigte `$?` den grep-Exit-Code (0). Die Ausgabe "1 Test(s) mit Fehlern" und die
Gegenprobe (3) belegen, dass das Skript korrekt Exit 1 zurückgibt.

Nachzustand nach dem Gesamtlauf:
```
daten ist Verzeichnis: JA        ← wiederhergestellt
daten ist Symlink: NEIN
/dev/shm/pe-daten: bereinigt
/dev/shm/pe-tmp: bereinigt
```

Schlusszeilen je Test (soweit in der grep-gefilterten Ausgabe enthalten):
- 64 Tests: keine Fehlerzeile → grün
- handbuch-barrierefrei: `FEHLER Gegenprobe: ...` × 10, Exit 1

---

---

## KORREKTUR (Commit 2): git check-ignore braucht Schrägstrich

### Fehler

```bash
# FALSCH: git check-ignore -q daten  (kein Schrägstrich)
```

Ohne Schrägstrich liefert `git check-ignore` Exit 1 wenn `daten/` noch nicht
als Verzeichnis existiert (frischer Klon). Das Skript hätte fälschlich abgebrochen.

### Gegenprobe im frischen Klon (/tmp/pe-klon, kein daten/-Ordner)

```
git check-ignore -q daten   → Exit 1  ← alter Code: Abbruch
git check-ignore -q daten/  → Exit 0  ← neuer Code: korrekt
```

### Fix

```bash
# RICHTIG:
if ! git check-ignore -q daten/ > /dev/null 2>&1; then
```

---

## Geänderte Dateien
- `tools/selbsttest-alle.sh` (PE_TEST_RAM=1 Opt-in; Commit 2: git check-ignore Fix)
- `BUILDER-FERTIG-GATE0B.md` (dieser Bericht)
