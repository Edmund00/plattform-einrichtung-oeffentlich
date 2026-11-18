# BUILDER-FERTIG: Sicherheit Nachbesserung 1a

**Commit:** ead86f4
**Branch:** sicherheit-1a
**Datum:** 2026-11-15

## Umgesetzte Punkte

| Nr | Prio | Was | Status |
|----|------|-----|--------|
| F-108 | HOCH | Passwort-Dialog (Stepup) in admin.js (Widerruf erledigt) und assistent-routen.mjs Schritt 4 | OK |
| F-109 | MITTEL | Brute-Force-Schutz /api/admin/stepup (P3-Muster) | OK |
| F-110 | MITTEL | aktuellerBenutzer: Admin-Sitzung zuletzt_aktiv=NULL nutzt erstellt+ADMIN_ABSOLUT_MS | OK |
| F-111 | NIEDRIG | /api/admin/sitzung-info erneuert zuletzt_aktiv nicht mehr | OK |
| F-112 | — | Login-Schwelle 5 auf 6 (5. Versuch mit richtigem PW nie blockiert) | OK |

## Gesamtlauf (PE_TEST_RAM=1 bash tools/selbsttest-alle.sh)

Alle Tests bestanden ausser handbuch-barrierefrei (bekannter Dauerausreisser,
unabhaengig von diesen Aenderungen — war bei Stand 2f44ff6 ebenfalls rot).

Einzelergebnisse der betroffenen Tests:
- assistent-stripe: 71/71
- stepup-frontend (neu): 25/25
- loginsperre: 20/20
- sitzungsablauf: 29/29
- widerruf-erledigt: 118/118

## Nicht in main mergen

Gemaess Anweisung bleibt sicherheit-1a ungemergt.
