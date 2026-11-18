# BUILDER-FERTIG-A2-3B

**Commit:** ae3e2f4  
**Branch:** meine-marke-a2-3b  
**Start:** 2026-11-16 08:28 CET  
**Ende:** 2026-11-16 08:38 CET  

## Aufgaben

### F-170: Standardwerte wenn keine Farben gespeichert (admin.js)
Konstante `FARBEN_STANDARD = { haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' }` eingefügt (Quelle: farben.mjs Standardpalette). Farbfelder belegen Picker und Hex-Textfeld mit `d.farben?.[name] || FARBEN_STANDARD[name]`. Gespeicherte Werte haben Vorrang.

### Opus Punkt 4: Race-Condition + 401/403-Meldung (admin.js)
- Sequenzzähler `seq` in `autoVorschau`: jede Anfrage inkrementiert `seq`, nach dem Await wird nur gezeichnet wenn `meineSeq === seq` (ältere Antworten werden verworfen)
- Bei 401/403 der Vorschau: `meldung(fehlerText(rr), 'rot')` statt leerem Container
- Demo-Modus (HTTP 403 via `demo.mjs:123`): gleiche Behandlung über `rr.status === 403` abgedeckt; keine eigenen Texte nötig, `fehlerText()` liefert vorhandene Fehlertexte

### Opus Punkt 2: CSS-Tokenisierung (kunde.css)
- Zeile 32 `::selection`: `color:var(--black)` → `color:var(--knopf-text)` (Standardwert identisch, kein sichtbarer Unterschied bei #000000)
- Zeile 134 `.pdf-werkzeuge .knopf:hover`: `color:var(--white)` → `color:var(--text-on-dark)` (Standardwert #ffffff = white, kein sichtbarer Unterschied)

**Nicht geändert:** gold-glow, gold-border, gold-overlay, Rechtsseiten

## Testergebnis

| Test | Ergebnis |
|---|---|
| `selbsttest-a2-3-farben-ui` | **172 OK, 0 FEHLER** |
| `selbsttest-a2-1-tokens` | **19 OK, 0 FEHLER** |
| `a1b-marke-ui` | 65 OK, 0 FEHLER |
| `a1b-marke-server` | 58 OK, 0 FEHLER |
| `a1c-favicon` | 37 OK, 0 FEHLER |
| `a2-2b-farben-server` | alle grün |
| `farben` | 94 OK, 0 FEHLER |
| `admin` | 90 OK, 0 FEHLER |
| `generator-sync` | 22 OK, 0 FEHLER |
| `seiten` | 76 OK, 0 FEHLER |
| `kaufmail` | 42 OK, 0 FEHLER |
| `setupmodus` | 85 OK, 0 FEHLER |
| `konfig` | 1 Fehler (bekannt, F-161) |

## Was NICHT geprüft wurde

- **Race-Condition live**: Sequenzzähler-Logik nur statisch geprüft (Codepfad korrekt), kein paralleler HTTP-Test mit künstlicher Verzögerung
- **Demo-Modus-Meldung**: nur via Code-Analyse (403 → `fehlerText`) verifiziert, kein Live-Demo-Modus-Test
- **Visuelle Darstellung**: kein Browser-Test
- **Ungarische Textqualität**: unverändert von A2-3
