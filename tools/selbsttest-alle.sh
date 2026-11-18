#!/usr/bin/env bash
# Startet ALLE Offline-Selbsttests (entspricht Selbsttest-Alle.ps1).
# Braucht KEINE Stripe-Schluessel. 'stripe-sandbox' wird uebersprungen.
# Ausgabe: Schlusszeile je Test + FEHLER-Zeilen; am Ende Gesamtergebnis.
# Exit-Code 1 wenn mindestens ein Test fehlschlaegt.
# PE_TEST_RAM=1: TMPDIR und daten/ in /dev/shm (Arbeitsspeicher), deutlich schneller.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=tools/lib-pe-ram.sh
. tools/lib-pe-ram.sh

tests=(
  kurse admin kauf konfig seiten dateien verwaltung schutz abo sprache
  passwort vorschau bestaetigung ereignisse kaufmail konto beleg
  abo-kuendigung abo-beenden migration-ereignisse ellallas mailrecht
  agent sicherung abgleich adminzugang notaus aboerstattung politur
  kurspaket bunny-db bunny bunny-admin bunny-wiedergabe bunny-oberflaeche
  plattform apps-script plattform-zeilen sprachen ratelimit-parallel
  demo kennzahlen mailsprache geldrecht handbuch handbuch-admin
  handbuch-kaeufer-sprachen aboschutz lektionszugriff restore
  demo-sicherheit registrierung-limit mailbackoff loginsperre
  produktreife marke kontrast farben download download-admin handbuch-admin-sprachen
  produktreife4 widerruf-erledigt handbuch-barrierefrei betragformat
  refund-failed generator-sync f245-anzeigen setupmodus einstellungen erststart
  emailaender-bereinigung sitzungsablauf stepup-frontend
  assistent-geruest assistent-logo assistent-recht assistent-mail
  assistent-stripe assistent-abschluss f92-umsatz f93-widerruf-betrag f98-zustimmung sicherheit-1b codex10-1b f129-loeschlauf
  f131-anmelden
  a1a-anzeige
  f142-logo-lesefehler
  a1b-marke-server
  a1b-marke-ui
  a1c-favicon
  a2-1-tokens
  a2-2b-farben-server
  a2-3-farben-ui
  a3-anbieter
  a3-anbieter-ui
  a3c-rechnung
  a4a-recht
  a4b-recht-ui
  a5a-mails
  a6-vorschau
  a5b-sicherung-logo
  g1a-abschluss
  g1b-testkauf
  e2e3-einrichtung
  s1-banner-server
  s1-banner-ui
  s2-beispiele-server
  e7-naechste-schritte-ui
  s2-beispiele-ui
  e4-einrichtung-ui e5-anleitungen e4b-fehlerseiten e6-abschluss p1-einrichtung-ui
  k1-katalog-server
  l1-listen-ui
  k3-kategorienavigation-ui
  k1-katalog-ui
)

# --- Vollstaendigkeitspruefung -------------------------------------------
_fehlende=()
for _f in tools/selbsttest-*.mjs; do
  _name="${_f#tools/selbsttest-}"
  _name="${_name%.mjs}"
  [ "${_name}" = "stripe-sandbox" ] && continue
  _gefunden=0
  for _t in "${tests[@]}"; do
    [ "${_t}" = "${_name}" ] && _gefunden=1 && break
  done
  [ "${_gefunden}" = "0" ] && _fehlende+=("${_name}")
done
if [ ${#_fehlende[@]} -gt 0 ]; then
  echo "ABBRUCH: Diese .mjs-Dateien fehlen in der tests-Liste: ${_fehlende[*]}" >&2
  exit 1
fi
# -------------------------------------------------------------------------

if [ "${PE_TEST_RAM:-}" = "1" ]; then
  pe_ram_start || exit 1
fi

fehler=0
rote=()

for t in "${tests[@]}"; do
  echo "=== selbsttest-$t"
  set +e; ausgabe=$(node --disable-warning=ExperimentalWarning "tools/selbsttest-$t.mjs" 2>&1); code=$?; set -e
  echo "$ausgabe" | grep -i 'FEHLER' || true
  schluss=$(echo "$ausgabe" | tail -1)
  echo "$schluss"
  if [ $code -ne 0 ]; then
    fehler=$((fehler + 1))
    rote+=("$t")
  fi
done

echo ""
if [ $fehler -gt 0 ]; then
  echo "$fehler Test(s) mit Fehlern: ${rote[*]}"
  exit 1
else
  echo "Alle Offline-Tests bestanden"
  exit 0
fi
