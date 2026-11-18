# BUILDER-FERTIG-GATE0C: WP0c – Runner robust machen

## Ausgangs-Commit
`98aaf99` (gate0b-schnell) WP0b-Fix: git check-ignore mit Schraegstrich

## Umgebung
- Node: v24.22.3
- npm: 11.19.1
- OS: Linux (WSL2, Ubuntu, OMEN – WSL-Platte auf USB-SSD J:)

---

## Was wurde geändert

### Neue Datei: `tools/lib-pe-ram.sh`

Enthält zwei exportierbare Funktionen:

**`pe_ram_start`** – prüft Vorbedingungen (noch VOR jeder Zustandsänderung), richtet
dann die /dev/shm-Verzeichnisse ein und registriert den Cleanup-Trap:

1. `/dev/shm` muss existieren und beschreibbar sein.
2. `daten` darf kein Symlink sein:
   - Zeigt `daten` auf einen verwaisten `/dev/shm/pe-*`-Pfad (Ziel weg) → selbst heilen:
     Symlink entfernen, Meldung auf stderr, dann normal weiter.
   - Zeigt `daten` auf einen aktiven `/dev/shm/pe-*`-Pfad → ABBRUCH (anderer Lauf aktiv?).
   - Zeigt `daten` auf irgendetwas anderes → ABBRUCH (fremder Symlink).
3. `daten.pe-sicherung` darf nicht existieren (Überbleibsel eines früheren Laufs).
4. `daten/` muss in `.gitignore` stehen.
5. Erst nach bestandenen Checks: `mktemp -d /dev/shm/pe-XXXXXX` für beide Verzeichnisse
   (einmalig, nie feste Pfade) → `trap pe_ram_stop EXIT` → Symlink anlegen.
6. Markervariable `_PE_RAM_GESICHERT=1` nur gesetzt wenn DIESER Lauf `daten/` verschoben hat.

**`pe_ram_stop`** – sicherer Cleanup (auch als Trap registriert):
- Entfernt den Symlink NUR wenn er auf UNSER `_PE_RAM_DATEN_DIR` zeigt.
- Verschiebt `daten.pe-sicherung` zurück NUR wenn `_PE_RAM_GESICHERT=1`.
- Löscht die per `mktemp` angelegten Verzeichnisse anhand der gespeicherten Pfade.
- Löscht am Ende die Markervariablen → zweiter Aufruf ist harmlos (kein Doppeleffekt).

### Geänderte Datei: `tools/selbsttest-alle.sh`

- Inline-PE_TEST_RAM-Block entfernt.
- `. tools/lib-pe-ram.sh` eingebunden (nach dem `cd`).
- Vollständigkeitsprüfung eingefügt (vor dem ersten `pe_ram_start`-Aufruf):
  Jede `tools/selbsttest-*.mjs`-Datei (außer `stripe-sandbox`) muss in der `tests=()` Liste
  stehen. Fehlt eine → `exit 1` mit Fehlermeldung.
- PE_TEST_RAM=1 Aufruf: `pe_ram_start || exit 1`.

---

## Behobene Bugs

| # | Alter Fehler | Fix |
|---|---|---|
| a | Feste Pfade `/dev/shm/pe-daten`, `/dev/shm/pe-tmp` → Konflikt bei Parallelläufen | `mktemp -d /dev/shm/pe-XXXXXX` für jedes Verzeichnis |
| b | Cleanup entfernte jeden `daten`-Symlink unabhängig davon, wer ihn angelegt hat | Symlink und Sicherung nur anfassen wenn Markervariablen auf DIESEN Lauf zeigen |
| c | `trap` wurde registriert bevor alle Vorbedingungen geprüft waren | `trap` erst nach erfolgreichem `mktemp` setzen |
| d | Verwaister Symlink `daten → /dev/shm/pe-nichtmehr` wurde nicht erkannt | Vorbedingung: Symlink-Ziel prüfen; bei veraistem /dev/shm-Pfad selbst heilen |
| e | Neue `.mjs`-Datei die nicht in `tests=()` steht blieb unbemerkt | Vollständigkeitsprüfung am Skript-Start |

---

## Gegenproben (alle in `/tmp`)

### G1: Vollständigkeitsprüfung – unbekannte .mjs → exit 1

```bash
touch /tmp/wp0c-g/tools/selbsttest-neu-test.mjs
bash /tmp/wp0c-g/tools/selbsttest-alle.sh
```

```
ABBRUCH: Diese .mjs-Dateien fehlen in der tests-Liste: neu-test
Exit-Code G1: 1
```

### G2: `daten.pe-sicherung` existiert → abort

```bash
mkdir /tmp/wp0c-g/daten.pe-sicherung
PE_TEST_RAM=1 bash /tmp/wp0c-g/tools/selbsttest-alle.sh
```

```
ABBRUCH PE_TEST_RAM: daten.pe-sicherung/ existiert (abgebrochener Vorlauf?).
  Bitte manuell pruefen: ls -la daten.pe-sicherung
Exit-Code G2: 1
```

### G3: Fremder Symlink `daten → /tmp/irgendwo` → abort

```bash
ln -s /tmp/irgendwo /tmp/wp0c-g/daten
PE_TEST_RAM=1 bash /tmp/wp0c-g/tools/selbsttest-alle.sh
```

```
ABBRUCH PE_TEST_RAM: daten/ ist ein fremder Symlink -> /tmp/irgendwo.
Exit-Code G3: 1
```

### G4: Verwaister `/dev/shm/pe-*` Symlink → selbst heilen und fortfahren

```bash
ln -s /dev/shm/pe-nichtvorhanden /tmp/wp0c-g/daten
# Ziel existiert nicht
(cd /tmp/wp0c-g; . tools/lib-pe-ram.sh; pe_ram_start; echo "daten -> $(readlink daten)"; pe_ram_stop)
```

```
PE_TEST_RAM: verwaister Symlink daten -> /dev/shm/pe-nichtvorhanden entfernt.
PE_TEST_RAM=1: TMPDIR=/dev/shm/pe-3IjJ0Q, daten/ -> /dev/shm/pe-p0ar2j
Start erfolgreich, daten ist jetzt: /dev/shm/pe-p0ar2j
Verzeichnis existiert: JA
Nach stop: daten ist Symlink=NEIN
Exit-Code G4: 0
```

### G5: Rotes Ergebnis → Cleanup trotzdem korrekt

```bash
(cd /tmp/wp0c-g; mkdir daten; . tools/lib-pe-ram.sh; pe_ram_start; exit 1)
# Prüfe Nachzustand:
```

```
PE_TEST_RAM=1: TMPDIR=/dev/shm/pe-cqsUtk, daten/ -> /dev/shm/pe-QiNDfk
Exit-Code G5: 1
NACH cleanup: daten ist Verzeichnis=JA        ← wiederhergestellt
NACH cleanup: daten ist Symlink=NEIN          ← Symlink entfernt
daten.pe-sicherung=NEIN                       ← bereinigt
/dev/shm/pe-* bereinigt: OK
```

### G6: Zwei Parallelläufe nutzen verschiedene Verzeichnisse

Zwei Subshells gleichzeitig gestartet:

```
LAUF1: daten/ -> /dev/shm/pe-0YcyiF  TMPDIR=/dev/shm/pe-hmxhYB
LAUF2: daten/ -> /dev/shm/pe-JvLANo  TMPDIR=/dev/shm/pe-obiuQ0
```

Pfade sind vollständig verschieden ✅. Beide Läufe bereinigten ihre eigenen Verzeichnisse.

### G7: Setup-Fehler via `PE_RAM_BASIS` → Exit 1, `daten` unverändert

Nachbesserung: `set -e` gilt nicht in Funktionen die mit `||` aufgerufen werden. Die vier
Setup-Schritte (`mktemp` ×2, `mv`, `ln -s`) sind daher mit expliziten `||`-Guards abgesichert.
Testbar über `PE_RAM_BASIS` (Standard `/dev/shm`).

```bash
mkdir daten
mkdir /tmp/pe-basis-gesperrt && chmod 000 /tmp/pe-basis-gesperrt
PE_RAM_BASIS=/tmp/pe-basis-gesperrt PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
```

```
ABBRUCH PE_TEST_RAM: /tmp/pe-basis-gesperrt fehlt oder nicht beschreibbar.
Exit-Code G7a: 1
daten ist Verzeichnis: JA        ← unverändert, kein Schritt ausgeführt
daten ist Symlink: NEIN
/dev/shm/pe-* sauber: OK
```

G7b: Gesamtlauf unverändert – **1 rot** (`handbuch-barrierefrei`), 1m22s.

---

## Gesamtlauf PE_TEST_RAM=1 (Realrepo)

```
PE_TEST_RAM=1 bash tools/selbsttest-alle.sh
```

Dauer: **1m15s** (real 1m15.775s)  
Ergebnis: 1 Test(s) mit Fehlern: `handbuch-barrierefrei` (bekannte Abweichung, Git-Historie fehlt)

Nachzustand nach dem Lauf:
```
daten ist Verzeichnis: JA        ← wiederhergestellt
daten ist Symlink: NEIN
/dev/shm/pe-* bereinigt: OK
```

---

## Geänderte Dateien
- `tools/lib-pe-ram.sh` (neu: pe_ram_start, pe_ram_stop; Nachbesserung: PE_RAM_BASIS + 4× || Guard)
- `tools/selbsttest-alle.sh` (Vollständigkeitsprüfung + lib eingebunden, Inline-Block entfernt)
- `BUILDER-FERTIG-GATE0C.md` (dieser Bericht)
