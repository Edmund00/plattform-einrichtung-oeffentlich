#!/usr/bin/env bash
# lib-pe-ram.sh – PE_TEST_RAM Hilfsfunktionen fuer selbsttest-alle.sh.
# Einbinden per: . tools/lib-pe-ram.sh
# Aufruf: pe_ram_start (gibt 1 zurueck wenn Vorbedingung fehlt); trap pe_ram_stop EXIT.
# PE_RAM_BASIS: Basis-Verzeichnis (Standard: /dev/shm), nur fuer Tests ueberschreiben.

_PE_RAM_DATEN_DIR=""
_PE_RAM_TMP_DIR=""
_PE_RAM_GESICHERT=0

pe_ram_stop() {
  # Symlink nur entfernen wenn er auf UNSER Verzeichnis zeigt
  if [ -L daten ] && [ -n "${_PE_RAM_DATEN_DIR}" ]; then
    if [ "$(readlink daten)" = "${_PE_RAM_DATEN_DIR}" ]; then
      rm -f daten
    fi
  fi
  # daten.pe-sicherung nur zurueckverschieben wenn DIESER Lauf sie angelegt hat
  if [ "${_PE_RAM_GESICHERT}" = "1" ] && [ -d daten.pe-sicherung ]; then
    mv daten.pe-sicherung daten
    _PE_RAM_GESICHERT=0
  fi
  # Verzeichnisse loeschen die DIESER Lauf angelegt hat
  [ -n "${_PE_RAM_DATEN_DIR}" ] && rm -rf "${_PE_RAM_DATEN_DIR}"
  [ -n "${_PE_RAM_TMP_DIR}" ]   && rm -rf "${_PE_RAM_TMP_DIR}"
  _PE_RAM_DATEN_DIR=""
  _PE_RAM_TMP_DIR=""
}

pe_ram_start() {
  _pe_basis="${PE_RAM_BASIS:-/dev/shm}"

  # --- Vorbedingungen (noch VOR jeder Zustandsaenderung) ---

  if [ ! -d "${_pe_basis}" ] || [ ! -w "${_pe_basis}" ]; then
    echo "ABBRUCH PE_TEST_RAM: ${_pe_basis} fehlt oder nicht beschreibbar." >&2
    return 1
  fi

  if [ -L daten ]; then
    _pe_ziel=$(readlink daten)
    case "${_pe_ziel}" in
      "${_pe_basis}"/pe-*)
        if [ ! -e daten ]; then
          echo "PE_TEST_RAM: verwaister Symlink daten -> ${_pe_ziel} entfernt." >&2
          rm -f daten
        else
          echo "ABBRUCH PE_TEST_RAM: daten/ ist bereits ein Symlink -> ${_pe_ziel}." >&2
          echo "  Laueft ein anderer PE_TEST_RAM-Prozess?" >&2
          return 1
        fi
        ;;
      *)
        echo "ABBRUCH PE_TEST_RAM: daten/ ist ein fremder Symlink -> ${_pe_ziel}." >&2
        return 1
        ;;
    esac
  fi

  if [ -e daten.pe-sicherung ]; then
    echo "ABBRUCH PE_TEST_RAM: daten.pe-sicherung/ existiert (abgebrochener Vorlauf?)." >&2
    echo "  Bitte manuell pruefen: ls -la daten.pe-sicherung" >&2
    return 1
  fi

  if ! git check-ignore -q daten/ > /dev/null 2>&1; then
    echo "ABBRUCH PE_TEST_RAM: daten/ ist nicht in .gitignore." >&2
    return 1
  fi

  # --- Setup: jeder Schritt explizit abgesichert (set -e gilt nicht in || Kontext) ---

  _PE_RAM_DATEN_DIR=$(mktemp -d "${_pe_basis}/pe-XXXXXX") \
    || { echo "ABBRUCH PE_TEST_RAM: mktemp daten-Verzeichnis fehlgeschlagen." >&2; pe_ram_stop; return 1; }

  _PE_RAM_TMP_DIR=$(mktemp -d "${_pe_basis}/pe-XXXXXX") \
    || { echo "ABBRUCH PE_TEST_RAM: mktemp tmp-Verzeichnis fehlgeschlagen." >&2; pe_ram_stop; return 1; }

  export TMPDIR="${_PE_RAM_TMP_DIR}"

  trap pe_ram_stop EXIT

  if [ -d daten ] && [ ! -L daten ]; then
    mv daten daten.pe-sicherung \
      || { echo "ABBRUCH PE_TEST_RAM: mv daten daten.pe-sicherung fehlgeschlagen." >&2; pe_ram_stop; return 1; }
    _PE_RAM_GESICHERT=1
  fi

  ln -s "${_PE_RAM_DATEN_DIR}" daten \
    || { echo "ABBRUCH PE_TEST_RAM: ln -s fehlgeschlagen." >&2; pe_ram_stop; return 1; }

  echo "PE_TEST_RAM=1: TMPDIR=${_PE_RAM_TMP_DIR}, daten/ -> ${_PE_RAM_DATEN_DIR}"
}
