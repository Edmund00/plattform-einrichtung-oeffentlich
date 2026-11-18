import {createHash} from 'node:crypto';
import {db} from './db.mjs';
let erlaubnis=null,alarmSender=null,listeGesperrt=null;
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
function bestaetigteAdminMails(){
 return db.prepare("SELECT email FROM benutzer WHERE rolle='admin' AND email_bestaetigt IS NOT NULL AND geloescht IS NULL").all();
}
export function adminListeInitialisieren(liste=[],alarm=null){
 alarmSender=alarm;
 if(!liste.length){erlaubnis=null;listeGesperrt=null;schutzAktualisieren();return false}
 if(!bestaetigteAdminMails().some(x=>liste.includes(x.email.toLowerCase()))){
  // F-312: beim allerersten Start einer frischen Installation gibt es noch KEINEN bestaetigten Admin --
  // das sieht hier identisch aus wie ein Tippfehler in ADMIN_ERLAUBT oder eine echte Aussperrung. Fail-closed
  // bleibt deshalb wie bisher sofort aktiv; listeGesperrt merkt sich aber die urspruengliche Liste, damit
  // adminErlaubt() spaeter selbst erkennen kann, ob sich GENAU daran inzwischen etwas geaendert hat.
  erlaubnis=new Set();listeGesperrt=liste;schutzAktualisieren();console.warn('WARNUNG ADMIN_ERLAUBT: kein bestätigter Admin stimmt überein; alle Admin-Anmeldungen gesperrt (fail-closed).');
  protokoll('listenwarnung','','','fail-closed');
  void alarmVersenden('listenwarnung');
  return false;
 }
 erlaubnis=new Set(liste);listeGesperrt=null;schutzAktualisieren();return true;
}
function schutzAktualisieren(){
 db.prepare('DELETE FROM admin_schutz').run();
 for(const b of db.prepare("SELECT id,email FROM benutzer WHERE rolle='admin' AND geloescht IS NULL AND email_bestaetigt IS NOT NULL").all())
  if(adminErlaubt(b.email))db.prepare('INSERT INTO admin_schutz(benutzer_id) VALUES(?)').run(b.id);
}
export function adminErlaubt(email){
 // Lazy Self-Heal (F-312): im fail-closed-Zustand per Shell einen bestaetigten Admin aus GENAU der
 // urspruenglichen ADMIN_ERLAUBT-Liste anzulegen, half bisher nichts -- der Boot-Schnappschuss blieb
 // bis zu einem Neustart leer, selbst nach dem vom Code selbst empfohlenen Schritt. Deshalb hier bei JEDER
 // Pruefung im fail-closed-Zustand einmal frisch gegen die Datenbank nachsehen: taucht jetzt ein bestaetigter
 // Admin aus GENAU der gemerkten Liste auf, heilt sich der Zustand von selbst (einmalig protokolliert).
 // Ein echter Tippfehler in ADMIN_ERLAUBT kann das NIE ausloesen: tools/admin-anlegen.mjs prueft in
 // Produktion dieselbe Liste, BEVOR es einen Admin anlegt -- ohne Uebereinstimmung entsteht nie ein
 // passender bestaetigter Admin. Eine echte, spaeter beschlossene Aussperrung (Admin geloescht/entrollt,
 // ohne dass ein neuer aus der Liste bestaetigt wurde) bleibt aus demselben Grund weiterhin gesperrt.
 if(erlaubnis&&erlaubnis.size===0&&listeGesperrt&&bestaetigteAdminMails().some(x=>listeGesperrt.includes(x.email.toLowerCase()))){
  erlaubnis=new Set(listeGesperrt);
  protokoll('listenwarnung','','','selbst-geheilt: bestaetigter Admin aus ADMIN_ERLAUBT jetzt vorhanden');
  listeGesperrt=null;
 }
 return !erlaubnis||erlaubnis.has(String(email||'').toLowerCase());
}
export function adminListeAktiv(){return !!erlaubnis}
export function adminIstLetzter(id){
 const b=db.prepare("SELECT id,email,rolle FROM benutzer WHERE id=? AND geloescht IS NULL").get(id);
 if(!b||b.rolle!=='admin'||!adminErlaubt(b.email))return false;
 return !db.prepare("SELECT id,email FROM benutzer WHERE rolle='admin' AND geloescht IS NULL AND email_bestaetigt IS NOT NULL AND id<>?").all(id)
  .some(x=>adminErlaubt(x.email));
}
// Maske mit kurzem Hash-Anhang: Adressen mit gleichem Anfang (diaconescu.edmund@..., diaconescu.gabriella@...) bleiben unterscheidbar,
// ohne dass die Adresse lesbar ist. Der Pausen-Alarm ("Login nach mehr als 30 Tagen") vergleicht genau diese Maske.
export const maskEmail=e=>{const klein=String(e||'').toLowerCase(),[a,b]=klein.split('@');return a&&b?a.slice(0,2)+'***@'+b+'#'+hash(klein).slice(0,6):'***'};
const maskIp=ip=>{const s=String(ip||'');if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s))return s.split('.').slice(0,3).join('.')+'.***';return s.includes(':')?s.split(':').slice(0,3).join(':')+':***':'***'};
export function protokoll(ergebnis,email,ip,hinweis=''){
 db.prepare("INSERT INTO admin_login_protokoll(zeit,ergebnis,email_maskiert,adresse_maskiert,hinweis) VALUES(?,?,?,?,?)")
  .run(new Date().toISOString(),ergebnis,maskEmail(email),maskIp(ip),hinweis);
}
export async function alarmVersenden(grund){
 if(!alarmSender)return;
 const key=grund.startsWith('fehlversuche')?'fehlversuche':grund;
 const prev=db.prepare('SELECT letzter_versand FROM admin_login_alarm WHERE grund=?').get(key);
 if(key!=='notfall'&&prev&&Date.now()-Date.parse(prev.letzter_versand)<3600000)return;
 try{if(await alarmSender(key)===false)return;
 db.prepare('INSERT INTO admin_login_alarm(grund,letzter_versand) VALUES(?,?) ON CONFLICT(grund) DO UPDATE SET letzter_versand=excluded.letzter_versand').run(key,new Date().toISOString());
 }catch{console.warn('Admin-Alarmversand fehlgeschlagen')}
}
export const sperrKey=(ip,email)=>hash(String(ip||'')+'|'+String(email||'').toLowerCase());
export function adminGesperrt(ip,email){
 const s=db.prepare('SELECT bis FROM admin_login_sperre WHERE kennung=?').get(sperrKey(ip,email));
 return !!s&&s.bis>Date.now();
}
export function adminFehlversuch(ip,email){
 const key=sperrKey(ip,email),now=Date.now();
 const s=db.prepare('SELECT * FROM admin_login_sperre WHERE kennung=?').get(key);
 const fresh=!s||now-s.erster>=3600000;
 const count=fresh?1:s.anzahl+1;
 const stufe=fresh?0:s.stufe;
 const bis=count>=5?Math.min(now+15*60000*(stufe+1),(fresh?now:s.erster)+60*60000):0;
 db.prepare('INSERT INTO admin_login_sperre(kennung,email_hash,anzahl,erster,bis,stufe) VALUES(?,?,?,?,?,?) ON CONFLICT(kennung) DO UPDATE SET anzahl=excluded.anzahl,erster=excluded.erster,bis=excluded.bis,stufe=excluded.stufe')
  .run(key,hash(String(email).toLowerCase()),count,fresh?now:s.erster,bis,Math.min(3,stufe+(count===5?1:0)));
 protokoll('falsch',email,ip);
 if(adminErlaubt(email)){
  const alle=db.prepare('SELECT COALESCE(SUM(anzahl),0) n FROM admin_login_sperre WHERE email_hash=? AND erster>?').get(hash(String(email).toLowerCase()),now-3600000).n;
  if(alle>=10)void alarmVersenden('fehlversuche');
 }
}
export function adminSperrversuch(ip,email){
 const key=sperrKey(ip,email),now=Date.now();
 const s=db.prepare('SELECT * FROM admin_login_sperre WHERE kennung=?').get(key);
 if(!s||s.bis<=now)return;
 db.prepare('UPDATE admin_login_sperre SET anzahl=anzahl+1 WHERE kennung=?').run(key);
 protokoll('gesperrt',email,ip);
 if(adminErlaubt(email)){
  const alle=db.prepare('SELECT COALESCE(SUM(anzahl),0) n FROM admin_login_sperre WHERE email_hash=? AND erster>?').get(hash(String(email).toLowerCase()),now-3600000).n;
  if(alle>=10)void alarmVersenden('fehlversuche');
 }
}
export function adminEntsperrenEmail(email){
 // Gespeichert sind nur Hashes aus IP+E-Mail; deshalb benötigt die Löschung eine Liste separater E-Mail-Hashes.
 db.prepare('DELETE FROM admin_login_sperre WHERE email_hash=?').run(hash(String(email).toLowerCase()));
}
export function notfallStart(){
 db.prepare('DELETE FROM admin_login_sperre').run();
 db.prepare("DELETE FROM sitzungen WHERE benutzer_id IN (SELECT id FROM benutzer WHERE rolle='admin')").run();
 protokoll('notfall','','','NOTFALL_ENTSPERREN');
 console.warn('NOTFALL_ENTSPERREN aktiv: Admin-Sitzungen und Sperren gelöscht. Variable nach erfolgreichem Zugriff entfernen.');
 void alarmVersenden('notfall');
}
