# BUILDER-FERTIG: F-142 Kurzer Lesefehler nicht dauerhaft cachen

**Start:** 2026-11-15 19:21 UTC  
**Ende:** 2026-11-15 19:29 UTC  
**Branch:** meine-marke-f142

---

## Was geliefert wurde

### marke.mjs — `logoPfade()` Cache-Unterscheidung (einziger Commit)

Neu: `leseFehlerBis`-Feld im Cache-Objekt und `setzeLogoLesefehlerAblaufMs(ms)` (Standard 5000 ms).

**Vorher:** `leseLogo()` = null → `gueltig: false` dauerhaft gecacht unter mtimeMs+size → SVG bis Neustart.  
**Jetzt:** `leseLogo()` = null → kurz cachen mit `leseFehlerBis = now + 5000ms`; nach Ablauf erneut lesen.  
Dauerhaft ungültige Datei (pruefePng-Fehler): bleibt wie bisher gecacht, kein Re-Read.

### tools/selbsttest-f142-logo-lesefehler.mjs (neu)

- **I1**: `chmod 0o000` → `logoPfade()` liefert SVG-Pfad (Lesefehler erkannt)
- **I2**: Ablauf 50 ms warten, `chmod 0o644` (mtime/size UNVERÄNDERT) → `logoPfade()` liefert wieder `/marke/logo.png?v=…`
- **J1**: Dauerhaft ungültige Datei → bleibt SVG
- **J2**: 50 Aufrufe bei dauerhaft ungültig → `logoPruefungen()` +1 (kein Re-Read)
- Unter Windows (platform=win32): I1/I2 werden übersprungen und im Bericht genannt

### selbsttest-alle.sh: f142-logo-lesefehler eingetragen

---

## Regressionsstatus
- `selbsttest-a1a-anzeige.mjs`: 26/26 ✅
- `selbsttest-f142-logo-lesefehler.mjs`: 4/4 ✅
