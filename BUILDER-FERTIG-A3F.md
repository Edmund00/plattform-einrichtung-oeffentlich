# BUILDER-FERTIG-A3F

Zweig: meine-marke-a3  
Commit: 329854e  
Datum: 2026-11-16

## Behobene Findings (F-180 bis F-185)

### F-180 (hoch) — /api/anbieter liefert dynamische Daten
`app.mjs`: Handler ruft `leseAnbieter()` bei jedem Request, statt den eingefrorenen ENV-Snapshot
aus dem Serverstart zurückzugeben. Admin-Speicherungen sind sofort sichtbar.

### F-181 (mittel) — Stripe-Rechnung: Footer statt custom_fields
`zahlung.mjs`: `rechnungsErweiterung()` erzeugt nur noch `invoice_data.footer`.
Reihenfolge: Name | Steuer-/Reg.-Nr. | Hinweis | Anschrift | E-Mail | Telefon.
Maximale Länge 500 Zeichen (Stripe-Limit), Kürzung am Ende.
C1-Steuerzeichen und Zeilenumbrüche werden im Footer bereinigt.

### F-182 (mittel) — mail.mjs fällt nicht mehr auf eingefrorenes ENV zurück
`app.mjs`: `erstelleServer()` ruft `setzeAnbieterBasis(anbieter)` nach `setzePlattform()`.
`anbieter.mjs`: neue Funktion `setzeAnbieterBasis()` und Prioritätsebene 'umgebung' in
`leseAnbieter()` (zwischen 'marke' und 'einstellungen').
Der alte `return anbieter`-Pfad in mail.mjs ist damit totes Code (wird nie mehr erreicht,
wenn ENV gesetzt ist), bleibt aber für direkte Test-Aufrufe ohne erstelleServer erhalten.

### F-183 (niedrig) — Admin zeigt echte quelle
`routes-marke.mjs`: gibt `quelle` im Anbieter-Objekt zurück.
`admin.js`: liest `d.anbieter?.quelle` aus der API-Antwort.
Neuer Textschlüssel `anbieter_quelle_umgebung` in de/hu/en (texte/*.json und tools/*/teil3.mjs).

### F-184 (niedrig) — API meldet ungültiges Feld
`anbieter.mjs`: `pruefeAnbieter()` gibt bei `anbieter_ungueltig` jetzt `felder: [feldname]`
zurück. `admin.js`: wertet `rr.d?.felder?.[0]` als Fallback aus, wenn
`ANBIETER_FEHLER_ZU_FELD[code]` keinen Treffer liefert.

### F-185 (niedrig) — C1-Steuerzeichen und E-Mail-Länge
`anbieter.mjs`: Regex in `pruefeAnbieter()` erfasst jetzt auch U+0080–U+009F (C1-Block)
zusätzlich zu C0 und DEL. E-Mail-Prüfung lehnt Adressen über 254 Zeichen ab.

## Testergebnisse

| Test | Bestanden | Fehlgeschlagen | Status |
|---|---|---|---|
| a3-anbieter | 105 | 0 | ✅ |
| a3-anbieter-ui | 137 | 0 | ✅ |
| a3c-rechnung | 38 | 0 | ✅ |
| admin | 90 | 0 | ✅ |
| mailrecht | 23 | 0 | ✅ |
| assistent-recht | 75 | 0 | ✅ |
| beleg | 26 | 0 | ✅ |
| generator-sync | 22 | 0 | ✅ |
| kaufmail | 42 | 0 | ✅ |
| setupmodus | 85 | 0 | ✅ |
| konfig | 187 | 2 | ⚠️ vorbestehend (DATEI_ORDNER/DB_DATEI Cloud-Hinweise) |
| seiten | 0 | 1 | ⚠️ vorbestehend (Mailversand nicht konfiguriert) |
| sprachen | — | — | Timing-Flackern, bekannt |
