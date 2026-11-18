# BUILDER-FERTIG A2-1: CSS-Tokenisierung

**Commit:** f9b0230
**Zweig:** meine-marke-a2-1
**Start:** 2026-11-16 ~06:30 UTC (Fortsetzung nach Kontextgrenze)
**Ende:** 2026-11-16 07:30 UTC

## Was geliefert

**public/kunde.css** — 4 neue Variablen in `:root`, 7 Verwendungsstellen tokenisiert:
- `--watermark-fg: rgba(255,255,255,.12)` → `.wasserzeichen` color + text-shadow
- `--watermark-dark: rgba(0,0,0,.14)` → `.wasserzeichen` text-shadow
- `--check-gold: #9a7b2f` → `.kaufbox-liste li::before` border
- `--demo-text: #7a5b00` → `.kaufbox-demo` color
- `.pdf-seite` box-shadow → `var(--shadow)` (vorhandene Variable wiederverwendet)
- `var(--gold-d,#b8902f)` → `var(--gold-d)` (Fallback entfernt, Variable bereits definiert)
- `var(--ivory,#faf6ea)` → `var(--ivory)` (Fallback entfernt, Variable bereits definiert)

**public/admin/admin.css** — 8 neue Variablen in `:root`, 15 Verwendungsstellen tokenisiert:
- `--kpi-border: #eadfc4` → `.kpi` border
- `--kpi-val: #1a1405` → `.kpi-wert` color
- `--kpi-label: #6b5a2b` → `.kpi-titel` (erste Definition)
- `--warn-border: #d98c1f` → `.kpi-warn`, `.demo-banner` border
- `--warn-bg: #fff6e5` → `.kpi-warn`, `.demo-banner` background
- `--label-muted: #4a4f57` → `.ereignis-tabelle td::before`, mobile td[1], td[5]
- `--kpi-title: #4a3d14` → `.kpi-titel` (zweite Definition), `.demo-banner` color
- `--kpi-help: #5b5230` → `.kpi-hilfe` color
- `.kpi` background `#fff` → `var(--white)` (vorhandene Variable wiederverwendet)

**tools/selbsttest-a2-1-tokens.mjs** — neuer Test (8 Prüfungen, alle grün):
- Liest alle `public/**/*.css` (außer `jogi/recht.css`)
- Liest alle `public/**/*.html` auf `<style>`-Blöcke
- Entfernt `:root{...}`-Blöcke, sucht verbleibende `#hex`, `rgb/rgba/hsl` Werte
- Muss ROT sein vor Änderungen (war 2 FEHLER / 6 OK), GRÜN danach (8 OK / 0 FEHLER)

**tools/selbsttest-alle.sh** — `a2-1-tokens` eingetragen

## Nachbartests (je einmal gelaufen)

| Test | Ergebnis |
|---|---|
| a2-1-tokens | 8/0 ✅ |
| a1a-anzeige | 28/0 ✅ |
| a1b-marke-ui | 65/0 ✅ |
| a1c-favicon | 37/0 ✅ |
| admin | 90/0 ✅ |
| generator-sync | 22/0 ✅ |
| konfig | Flackern (vorbelastet) |

## Konfig-Befund

`selbsttest-konfig` zeigt auf diesem Branch weiterhin gelegentliche Fehler (Timing-Problem
bei Netzwerk-Erreichbarkeits-Tests, Port 4411). Kein Zusammenhang mit CSS-Änderungen
(A2-1 ändert ausschließlich CSS-Dateien, keine JS/Server-Logik). Chef-Messung auf main:
6/6 grün auf dem Laptop. Flackern ist ein vorbelasteter EIGENER FUND, unverändert seit A1c.

## Was NICHT geprüft wurde

- Browser-Ansicht (visuelle Kontrolle der Farbdefinitionen)
- Kontrast-Prüfung der neuen Variablen-Werte (Werte entsprechen den vorherigen Hardcode-Werten)
- Verwendung in neuen Scheiben nach A2-1
