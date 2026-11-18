// Rate-Limit der Registrierung (Gesamtpruefung 12.11.2026, F-03): ohne Grenze konnte jeder beliebig viele Konten anlegen und damit
// Bestaetigungsmails an fremde Adressen (ueber unseren Absender) und Meldungsmails an den Betreiber ausloesen.
// Gezaehlt wird je IP-Adresse (Stunde) und je Zieladresse (Tag). Gespeichert in SQLite (ueberlebt einen Neustart), nur als Hashwert
// (keine IP und keine E-Mail im Klartext). Pruefen und Eintragen geschehen in EINER synchronen Transaktion, darum kommen auch parallele
// Anfragen nicht ueber die Grenze. Die Tabelle hat eine feste Obergrenze (aelteste Eintraege fallen zuerst weg).
import { createHash } from 'node:crypto';
import { db, transaktion } from './db.mjs';

export const REG_MAX_JE_IP_STUNDE = 10;       // Registrierungsversuche je IP-Adresse in 60 Minuten
export const REG_MAX_JE_ADRESSE_TAG = 3;      // Registrierungsversuche je Zieladresse in 24 Stunden (auch 409 "vergeben" zaehlt)
export const REG_MAX_EINTRAEGE = 20000;       // feste Obergrenze der Zaehltabelle
const STUNDE = 3600 * 1000, TAG = 24 * STUNDE;

db.exec(`CREATE TABLE IF NOT EXISTS registrierung_versuche (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  art TEXT NOT NULL CHECK (art IN ('ip','adresse')),
  schluessel TEXT NOT NULL,
  zeit INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registrierung_versuche_suche ON registrierung_versuche(art, schluessel, zeit);`);

// Zieladresse fuer die Zaehlung vereinheitlichen: klein, '+tag' im lokalen Teil weg, bei Gmail/Googlemail auch die Punkte (dieselbe Mailbox).
export function adresseFuerZaehlung(email) {
  const s = String(email || '').toLowerCase().trim(), i = s.lastIndexOf('@');
  if (i < 1) return s;
  let lokal = s.slice(0, i).split('+')[0], domain = s.slice(i + 1);
  if (domain === 'gmail.com' || domain === 'googlemail.com') { lokal = lokal.replace(/\./g, ''); domain = 'gmail.com'; }
  return lokal + '@' + domain;
}
// Ausnahme fuer die eigene Maschine (127.x, ::1) nur ausserhalb der Produktion; app.mjs setzt das aus dem Server-Parameter nodeEnv.
let lokalAusnahme = true;
export const registrierungLimitKonfig = ({ lokalAusnahme: x } = {}) => { lokalAusnahme = x !== false; };
const kennung = (art, wert) => createHash('sha256').update('registrierung|' + art + '|' + String(wert).toLowerCase()).digest('hex');
// Die eigene Maschine (127.x, ::1) zaehlt NICHT gegen die IP-Grenze: lokale Selbsttests und E2E-Laeufe legen viele Konten von dort an.
// Von aussen ist das nicht erreichbar: hinter Render (TRUST_PROXY=1) ist req.ip die vom Proxy gemeldete Adresse des Besuchers.
// Die Grenze je Zieladresse gilt immer, auch lokal.
const istLokal = (ip) => /^(127\.|::1$|::ffff:127\.)/.test(String(ip || ''));

// true = Versuch erlaubt (und gezaehlt), false = Grenze erreicht (nichts gezaehlt).
export function registrierungErlaubt(ip, email, jetzt = Date.now()) {
  const lokal = lokalAusnahme && istLokal(ip), kIp = kennung('ip', ip), kAdr = kennung('adresse', adresseFuerZaehlung(email));
  return transaktion(() => {
    db.prepare('DELETE FROM registrierung_versuche WHERE zeit < ?').run(jetzt - TAG);
    const zaehle = (art, k, seit) => db.prepare('SELECT COUNT(*) n FROM registrierung_versuche WHERE art=? AND schluessel=? AND zeit>=?').get(art, k, seit).n;
    if ((!lokal && zaehle('ip', kIp, jetzt - STUNDE) >= REG_MAX_JE_IP_STUNDE) || zaehle('adresse', kAdr, jetzt - TAG) >= REG_MAX_JE_ADRESSE_TAG) return false;
    const neu = db.prepare('INSERT INTO registrierung_versuche (art, schluessel, zeit) VALUES (?, ?, ?)');
    if (!lokal) neu.run('ip', kIp, jetzt);
    neu.run('adresse', kAdr, jetzt);
    const n = db.prepare('SELECT COUNT(*) n FROM registrierung_versuche').get().n;
    if (n > REG_MAX_EINTRAEGE) db.prepare('DELETE FROM registrierung_versuche WHERE id IN (SELECT id FROM registrierung_versuche ORDER BY id LIMIT ?)').run(n - REG_MAX_EINTRAEGE);
    return true;
  });
}
