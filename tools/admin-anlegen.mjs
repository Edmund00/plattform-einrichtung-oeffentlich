// Legt einen Admin-Benutzer an oder stuft einen vorhandenen Benutzer auf "admin" hoch.
// Aufruf:  node --disable-warning=ExperimentalWarning tools/admin-anlegen.mjs <email>
// Das Passwort kommt NIE auf die Kommandozeile: entweder aus der Umgebungsvariable ADMIN_PASSWORT
// oder per verdeckter Eingabe (nur im Terminal). Es wird nirgends ausgegeben.
// Ausgabe: nur "Admin angelegt" oder "Admin hochgestuft". Datenbank: DB_DATEI (Standard daten/lern-app.db).
import { db } from '../db.mjs';
import { passwortHashen, emailPruefen, passwortRegelnPruefen } from '../auth.mjs';

const HINWEISE = {
  passwort_zu_kurz: 'Das Passwort braucht mindestens 8 Zeichen.',
  passwort_zu_lang: 'Das Passwort ist zu lang (höchstens 200 Zeichen).',
};

function abbruch(text) { console.error(text); process.exit(1); }

// Verdeckte Eingabe: nichts wird angezeigt, kein Echo.
function passwortAbfragen() {
  return new Promise((ok, nein) => {
    if (!process.stdin.isTTY) return nein(new Error('Kein Terminal: bitte ADMIN_PASSWORT setzen.'));
    process.stderr.write('Passwort (wird nicht angezeigt): ');
    let eingabe = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const ende = (fn, wert) => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', daten); process.stderr.write('\n'); fn(wert); };
    const daten = (zeichen) => {
      for (const z of zeichen) {
        if (z === '\r' || z === '\n') return ende(ok, eingabe);
        if (z === '\u0003') return ende(nein, new Error('Abgebrochen.'));       // Strg+C
        if (z === '\u007f' || z === '\b') eingabe = eingabe.slice(0, -1);       // Rücktaste
        else eingabe += z;
      }
    };
    process.stdin.on('data', daten);
  });
}

const args = process.argv.slice(2);
if (args.length !== 1) abbruch('Aufruf: node tools/admin-anlegen.mjs <email>   (Passwort über ADMIN_PASSWORT oder verdeckte Eingabe)');
const email = emailPruefen(args[0]);
if (!email) abbruch('Die E-Mail-Adresse ist ungültig.');

if(process.env.NODE_ENV==='production'){
  const erlaubt=(process.env.ADMIN_ERLAUBT||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  if(!erlaubt.length||!erlaubt.includes(email))abbruch('Admin-Anlage nicht erlaubt: ADMIN_ERLAUBT prüfen.');
}
const vorhanden = db.prepare('SELECT id, rolle FROM benutzer WHERE email = ?').get(email);
async function neuesPasswort() {
  let passwort = process.env.ADMIN_PASSWORT;
  if (passwort === undefined || passwort === '') {
    try { passwort = await passwortAbfragen(); } catch (e) { abbruch(e.message); }
  }
  const regel = passwortRegelnPruefen(passwort);
  if (regel) abbruch(HINWEISE[regel] || 'Das Passwort ist nicht erlaubt.');
  return passwortHashen(passwort);
}
if (vorhanden && vorhanden.rolle === 'admin') {
  // Schon Admin: nichts zu tun (Passwort und Sitzungen bleiben unberührt).
  console.log('Admin hochgestuft');
} else if (vorhanden) {
  // Sicherheit (Prüfrunde 4, M1): Ein Konto, das vor dem Admin mit dieser Adresse registriert wurde, kennt womöglich ein Fremder.
  // Deshalb beim Hochstufen IMMER ein neues Passwort setzen und alle Sitzungen und offenen Links (Passwort, E-Mail) des Kontos löschen.
  const hash = await neuesPasswort();
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE benutzer SET rolle='admin',passwort_hash=?,email_bestaetigt=COALESCE(email_bestaetigt,?) WHERE id=?").run(hash, Date.now(), vorhanden.id);
    for (const tabelle of ['sitzungen', 'passwort_token', 'email_token', 'email_aender_token']) {
      db.prepare('DELETE FROM ' + tabelle + ' WHERE benutzer_id=?').run(vorhanden.id);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log('Admin hochgestuft');
} else {
  const hash = await neuesPasswort();
  db.prepare("INSERT INTO benutzer (email, passwort_hash, rolle, erstellt,email_bestaetigt) VALUES (?, ?, 'admin', ?,?)").run(email, hash, new Date().toISOString(),Date.now());
  console.log('Admin angelegt');
}
