// Render Shell: ADMIN_ERLAUBT, ADMIN_PASSWORT und DB_DATEI nur in Umgebung.
import {db,transaktion} from '../db.mjs';
import {emailPruefen,passwortRegelnPruefen,passwortHashen,fehlversucheFuerEmailLoeschen} from '../auth.mjs';
import {adminEntsperrenEmail,protokoll} from '../admin-zugang.mjs';
const email=emailPruefen(process.argv[2]);
const allowed=(process.env.ADMIN_ERLAUBT||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
const secret=process.env.ADMIN_PASSWORT;
if(process.argv.length!==3||!email||!allowed.length||!allowed.includes(email)||passwortRegelnPruefen(secret)){
 console.error('Notfallwerkzeug: ungültige oder nicht erlaubte Eingabe; ADMIN_ERLAUBT und ADMIN_PASSWORT prüfen.');
 process.exit(1);
}
const user=db.prepare("SELECT id FROM benutzer WHERE email=? AND rolle='admin' AND geloescht IS NULL").get(email);
if(!user){console.error('Keine passende vorhandene Admin-Adresse in der Erlaubnisliste.');process.exit(1)}
const hash=await passwortHashen(secret);
transaktion(()=>{
 db.prepare("UPDATE benutzer SET passwort_hash=?,email_bestaetigt=COALESCE(email_bestaetigt,?) WHERE id=?").run(hash,Date.now(),user.id);
 db.prepare('DELETE FROM sitzungen WHERE benutzer_id=?').run(user.id);
 db.prepare('UPDATE passwort_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(Date.now(),user.id);
 adminEntsperrenEmail(email);
 protokoll('notfall',email,'','admin-notfall');
});
fehlversucheFuerEmailLoeschen(email);
console.log('Notfallzugang neu gesetzt; Sitzungen beendet und Sperren aufgehoben.');
