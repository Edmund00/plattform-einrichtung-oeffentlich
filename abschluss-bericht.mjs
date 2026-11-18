// abschluss-bericht.mjs – G1a: Abschlussbericht-Pruefungen fuer Einrichtungsassistent Schritt 6.
// Funktion abschlussPruefungen() wird von GET/POST /schritt/6 und dem Normalstart (server.mjs) verwendet.
// DB per Injektion (setzeBerichtDb), kein db-Import am Modulkopf.
import { existsSync } from 'node:fs';
import { STANDARD_PLATTFORM_NAME } from './marke.mjs';
import { leseAnbieter, setzeAnbieterDb, pruefeAnbieter } from './anbieter.mjs';

let berichtDb = null;
let berichtLogoPfad = null;

export function setzeBerichtDb(db) {
  berichtDb = db;
  setzeAnbieterDb(db);
}

export function setzeBerichtLogoPfad(pfad) {
  berichtLogoPfad = pfad;
}

// Gibt ein Array von Pruefergebnissen zurueck:
// { id, status: 'ok'|'rot'|'hinweis', pflicht: boolean, grund: <Textschluessel>, korrekturLink }
//
// schluesselGesichert: ob der Nutzer die Checkbox angekreuzt hat (POST) oder den Key angezeigt bekam (GET-Anzeige).
// schluesselAusEnv: ob der Hauptschluessel aus der Umgebung stammt (kein Sicherungsschritt noetig).
// Beide null (Default) = Normalstart -> Schluesselsicherung wird nicht geprueft.
export function abschlussPruefungen({ schluesselGesichert = null, schluesselAusEnv = null } = {}) {
  const lese = (k) => berichtDb?.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(k)?.wert ?? null;
  const ergebnisse = [];

  // (a) Mail: Schritt 3 fertig
  const mailOk = lese('einrichtung_schritt_3') === 'fertig';
  ergebnisse.push({ id: 'mail', status: mailOk ? 'ok' : 'rot', pflicht: true, grund: 'g1a_mail', korrekturLink: '/admin/einrichtung/schritt/3' });

  // (b) Zahlung: Schritt 4 fertig
  const zahlungOk = lese('einrichtung_schritt_4') === 'fertig';
  ergebnisse.push({ id: 'zahlung', status: zahlungOk ? 'ok' : 'rot', pflicht: true, grund: 'g1a_zahlung', korrekturLink: '/admin/einrichtung/schritt/4' });

  // (c) Rechtstexte: alle drei Seiten haben einen gespeicherten Modus (nicht null/leer = nicht_gesetzt)
  const rechtSchluessel = ['impressum', 'datenschutz', 'teilnahmebedingungen'];
  const rechtWerte = rechtSchluessel.map(s => lese(`recht_${s}`));
  const rechtAlle = rechtWerte.every(v => v && v.length > 0);
  ergebnisse.push({ id: 'recht', status: rechtAlle ? 'ok' : 'rot', pflicht: true, grund: 'g1a_recht', korrekturLink: '/admin/einrichtung/schritt/2' });

  // (d) Anbieterdaten: nur Pflicht wenn mind. eine Rechtsseite Modus 'erstellt' hat
  const brauchtAnbieter = rechtWerte.some(v => v === 'erstellt');
  if (brauchtAnbieter) {
    const a = leseAnbieter();
    const daten = { name: a.name, anschrift: a.anschrift, telefon: a.telefon, email: a.email, adoszam: a.adoszam, steuerHinweis: a.steuerHinweis };
    const fehler = pruefeAnbieter(daten);
    ergebnisse.push({ id: 'anbieter', status: fehler ? 'rot' : 'ok', pflicht: true, grund: 'g1a_anbieter', korrekturLink: '/admin/einrichtung/schritt/2' });
  }

  // (e) Schluesselsicherung: nur pruefen wenn Params explizit uebergeben werden (nicht Normalstart)
  if (schluesselAusEnv !== null || schluesselGesichert !== null) {
    const schluesselOk = !!schluesselAusEnv || (lese('schluessel_angezeigt') === '1' && !!schluesselGesichert);
    ergebnisse.push({ id: 'schluessel', status: schluesselOk ? 'ok' : 'rot', pflicht: true, grund: 'g1a_schluessel', korrekturLink: '/admin/einrichtung/schritt/6' });
  }

  // Hinweis: Plattformname noch Standard
  const nameGespeichert = lese('PLATTFORM_NAME');
  if (!nameGespeichert || nameGespeichert === STANDARD_PLATTFORM_NAME) {
    ergebnisse.push({ id: 'name_standard', status: 'hinweis', pflicht: false, grund: 'g1a_name_standard', korrekturLink: '/admin/einrichtung/schritt/1' });
  }

  // Hinweis: Logo fehlt
  if (!berichtLogoPfad || !existsSync(berichtLogoPfad)) {
    ergebnisse.push({ id: 'logo', status: 'hinweis', pflicht: false, grund: 'g1a_logo', korrekturLink: '/admin/einrichtung/schritt/1' });
  }

  // Hinweis: Erster Kurs wird beim Abschluss als Entwurf angelegt (immer anzeigen)
  ergebnisse.push({ id: 'erster_kurs', status: 'hinweis', pflicht: false, grund: 'g1a_erster_kurs', korrekturLink: null });

  return ergebnisse;
}

// F-221: nur fuer KONFIGURIERT aufrufen; Ausnahmen behandelt der Start fail-closed.
// Keine Schluesselparameter: die Sicherung wurde bereits beim Abschluss bestaetigt.
export function startPruefungKonfiguriert(db) {
  setzeBerichtDb(db);
  const rot = abschlussPruefungen().filter(it => it.pflicht && it.status === 'rot').map(it => it.id);
  return { ok: rot.length === 0, rot };
}
