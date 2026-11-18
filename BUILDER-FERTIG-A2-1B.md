# BUILDER-FERTIG A2-1b: Variablen wirklich benutzen

**Commit:** 34e8585
**Zweig:** meine-marke-a2-1
**Start:** 2026-11-16 ~09:00 UTC
**Ende:** 2026-11-16 ~09:20 UTC

## Was geliefert

### public/kunde.css — :root Standardwerte (alt → neu)

| Variable | Alt | Neu |
|---|---|---|
| `--black` | `#000` | `#070503` |
| `--gold-m` | — | `#8e702d` **(NEU)** |
| `--gold-d` | `#a87c2a` | `#8a6d2c` |
| `--gold-l` | `#e8c777` | `#e3c685` |
| `--ink` | `#211a0e` | `#1a1a1a` |
| `--line` | `#e7ddc9` | `#dcd8d1` |
| `--text-second` | `#4c4232` | `#52514f` |
| `--text-on-dark` | `#e9e2d2` | `#ffffff` |
| `--footer-text` | `#b8ad94` | `#cfcecd` |
| `--grad` | `linear-gradient(100deg,var(--gold),var(--gold-d))` | `linear-gradient(100deg,var(--gold),var(--gold-m))` |
| `--focus` | `#8a6420` | `#8a6d2c` |
| `--knopf-text` | — | `#000000` **(NEU)** |
| `--gold`, `--night`, `--ivory`, `--white` | unverändert | unverändert |

### public/kunde.css — Regeländerungen

| Selektor | Eigenschaft alt | Eigenschaft neu |
|---|---|---|
| `.hero` | `color:var(--white)` | `color:var(--text-on-dark)` |
| `.hero h1` | `color:var(--white)` | `color:var(--text-on-dark)` |
| `.knopf` | `color:var(--black)` | `color:var(--knopf-text)` |
| `.knopf:hover` | `color:var(--black)` | `color:var(--knopf-text)` |
| `.knopf.gruen` | `color:var(--black)` | `color:var(--knopf-text)` |
| `.lecke-nezet.media-tartalom h1,h2,h3` | `color:var(--white)` | `color:var(--text-on-dark)` |

`.hero .lead` und `.fuss` hatten bereits `var(--text-on-dark)` bzw. `var(--footer-text)` — keine Änderung nötig.  
`.abo-lemondas{background:var(--gold-d);color:var(--white)}` — bewusst unverändert (Ausnahme Aufgabe 4).

### public/admin/admin.css — :root

Zwei neue Variablen ergänzt (admin.css erbt Palette via `@import url('/kunde.css')`):
- `--gold-m:#8e702d`
- `--knopf-text:#000000`

### public/admin/admin.css — Regeländerungen

| Selektor | Eigenschaft alt | Eigenschaft neu |
|---|---|---|
| `#app .knopf.gruen` | `color:var(--black)` | `color:var(--knopf-text)` |

### tools/selbsttest-a2-1-tokens.mjs — 9 neue Prüfungen (Checks a–e)

| Prüfung | Was |
|---|---|
| (b) | `--grad` enthält `--gold-m` (kunde.css) |
| (c) | kunde.css `:root` Standardwerte exakt |
| (c) | admin.css `:root` enthält `--gold-m` und `--knopf-text` |
| (a) | kunde.css: alle `var(--grad)`-Regeln haben `color:var(--knopf-text)` |
| (d) | kunde.css: kein `color:var(--black)` auf `var(--grad)`-Regeln |
| (a) | admin.css: alle `var(--grad)`-Regeln haben `color:var(--knopf-text)` |
| (d) | admin.css: kein `color:var(--black)` auf `var(--grad)`-Regeln |
| (e) | kunde.css: Hero nutzt `--text-on-dark` statt `--white` |
| (e) | kunde.css: Media-Überschriften nutzen `--text-on-dark` |

War ROT (8 OK / 9 FEHLER) vor Änderungen — GRÜN danach (17 OK / 0 FEHLER).

## Kontrastwerte

### Neue / geänderte Paare (WCAG 1.4.3, 4,5:1 für Normaltext)

| Paar | Kontrast |
|---|---|
| `--knopf-text #000000` auf `--gold #d4a843` (Verlaufsstart) | ~9,9:1 ✓ |
| `--knopf-text #000000` auf `--gold-m #8e702d` (Verlaufsende, schlechtester Punkt) | ~4,9:1 ✓ |
| `--text-on-dark #ffffff` auf `--black #070503` | ~21:1 ✓ |
| `--text-second #52514f` auf `--ivory #faf6ee` | ~7,3:1 ✓ |
| `--footer-text #cfcecd` auf `--night #0d0a05` | ~14:1 ✓ |

### A2-1-Variablen (unverändert, Kontrast zur Kontrolle)

| Variable | Hintergrund | Kontrast |
|---|---|---|
| `--label-muted:#4a4f57` | `--white #fff` | ~8,0:1 ✓ |
| `--kpi-help:#5b5230` | `--white #fff` | ~7,5:1 ✓ |
| `--kpi-title:#4a3d14` | `--warn-bg #fff6e5` | ~10,1:1 ✓ |

## Nachbartests

| Test | Ergebnis |
|---|---|
| a2-1-tokens | 17/0 ✅ |
| a1a-anzeige | 28/0 ✅ |
| a1b-marke-ui | 65/0 ✅ |
| a1c-favicon | 37/0 ✅ |
| admin | 90/0 ✅ |
| generator-sync | 22/0 ✅ |
| konfig | 188/1 — bekanntes Timing-Problem Port 4411 (F-161, vorbelastet) |

## Was NICHT geprüft wurde

- Browser-Ansicht (computed styles, visuelle Kontrolle) — Chef misst danach
- `/marke.css` (nicht in diesem Auftrag)
- Admin-Oberfläche UI (A2-3)
- Mails
