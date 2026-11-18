#!/bin/sh
# Vollsuite mit gewaehlter Sprache: sh tools/suite.sh hu|de   (Ausgabe: nur FEHLER und Schlusszeile)
export TEXT_SPRACHE=$1
bad=0
for t in kurse admin kauf konfig seiten dateien verwaltung schutz abo sprache passwort vorschau bestaetigung ereignisse kaufmail konto beleg abo-kuendigung abo-beenden migration-ereignisse ellallas mailrecht agent sicherung abgleich adminzugang notaus aboerstattung politur kurspaket bunny-db bunny bunny-admin bunny-wiedergabe bunny-oberflaeche plattform apps-script plattform-zeilen sprachen kennzahlen; do
  out=$(node --disable-warning=ExperimentalWarning tools/selbsttest-$t.mjs 2>&1); rc=$?
  n=$(echo "$out" | grep -c '^FEHLER')
  if [ $rc -ne 0 ]; then bad=$((bad+1)); echo "## $t rc=$rc fehler=$n"; echo "$out" | grep '^FEHLER' | head -6 | cut -c1-200; fi
done
echo "SUITE $1: $bad von 41 mit Fehlern"
