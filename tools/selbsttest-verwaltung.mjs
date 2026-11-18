// Scheibe 6: Offline-Selbsttest der Verwaltung. Keine Stripe-Schlüssel oder neuen Pakete.
import './test-sprache.mjs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const BASIS = mkdtempSync(join(tmpdir(), 'schulung-verwaltung-'));
const DATEI = join(BASIS, 'verwaltung.db');
const ORDNER = join(BASIS, 'dateien');
const PORT = 4416;
const BASE = 'http://127.0.0.1:' + PORT;
const PW = randomBytes(24).toString('base64url');
const MAIL = 'verwaltung.admin@example.com';
process.env.DB_DATEI = DATEI;
let ok = 0, schlecht = 0, server;
function test(name, wahr, detail) {
  if (wahr) ok++; else schlecht++;
  console.log((wahr ? 'OK     ' : 'FEHLER ') + name + (!wahr && detail ? ' -> ' + JSON.stringify(detail).slice(0,300) : ''));
}
function dbAbfrage(sql, ...args) {
  const d = new DatabaseSync(DATEI);
  try { return d.prepare(sql).all(...args); } finally { d.close(); }
}
const wert = (sql, ...args) => Object.values(dbAbfrage(sql, ...args)[0] || {})[0];
function client() {
  let cookie = '';
  return async (m, pfad, body) => {
    const r = await fetch(BASE + pfad, {
      method: m, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    let d = {};
    try { d = await r.json(); } catch {}
    return { s: r.status, d };
  };
}
async function loesche(url, rolle) { return rolle('DELETE', url); }
const pause = () => new Promise(r => setTimeout(r, 150));
try {
  const { erstelleServer } = await import(pathToFileURL(resolve('app.mjs')).href);
  const fakeStripe = {
    webhooks: { constructEvent: (raw) => JSON.parse(raw.toString()) },
    customers: { create: async () => ({ id: 'cus_fake' }) },
    checkout: { sessions: { create: async () => ({ url: 'https://checkout.stripe.com/test' }) } },
  };
  server = erstelleServer({ stripe: fakeStripe, webhookSecret: 'test-value', base: BASE, dateiOrdner: ORDNER }).listen(PORT, '127.0.0.1');
  await pause();
  const admin = client(), kunde = client(), zweiter = client(), gast = client();
  const rAdmin = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning','tools/admin-anlegen.mjs', MAIL], {
    env: { ...process.env, ADMIN_PASSWORT: PW }, encoding: 'utf8'
  });
  test('Admin angelegt', rAdmin.status === 0, rAdmin.stderr);
  test('Admin angemeldet', (await admin('POST','/api/anmelden',{email:MAIL,passwort:PW})).s === 200);
  test('Kunde angelegt', (await kunde('POST','/api/registrieren',{ zustimmung: true, email:'verwaltung.kunde@example.com',passwort:PW})).s === 201);
  test('Zweiter Kunde angelegt', (await zweiter('POST','/api/registrieren',{ zustimmung: true, email:'verwaltung.zweiter@example.com',passwort:PW})).s === 201);
  // Neue Routen prüfen immer Anmeldung und Adminrolle, auch bei ungültiger ID.
  for (const [m,p,b] of [
    ['POST','/api/admin/kurse/1/archivieren',{}],
    ['DELETE','/api/admin/kurse/1',undefined],
    ['DELETE','/api/admin/lektionen/1',undefined],
    ['DELETE','/api/admin/lektionen/1/datei',undefined],
    ['GET','/api/admin/kurse/1/zugaenge',undefined],
    ['POST','/api/admin/kurse/1/zugaenge',{email:'test@example.com'}],
    ['DELETE','/api/admin/kurse/1/zugaenge/1',undefined],
    ['POST','/api/admin/bestellungen/1/freigeben',{}],
    ['POST','/api/admin/bestellungen/1/ablehnen',{}],
  ]) {
    test('Gast 401: ' + m + ' ' + p, (await gast(m,p,b)).s === 401);
    test('Kunde 403: ' + m + ' ' + p, (await kunde(m,p,b)).s === 403);
  }
  const kId = wert("SELECT id FROM benutzer WHERE email = ?", 'verwaltung.kunde@example.com');
  const zId = wert("SELECT id FROM benutzer WHERE email = ?", 'verwaltung.zweiter@example.com');
  const erstelle = async name => (await admin('POST','/api/admin/kurse',{titel:name,preis_cent:10000})).d.id;
  const kurs = await erstelle('Archivieren');
  const pfad = '/api/admin/kurse/' + kurs;
  const lecke = (await admin('POST',pfad+'/lektionen',{titel:'Lecke',art:'pdf'})).d.id;
  await admin('POST',pfad+'/veroeffentlichen',{});
  const freigabe = await admin('POST',pfad+'/zugaenge',{email:'verwaltung.kunde@example.com'});
  test('Zugang manuell vergeben', freigabe.s === 201);
  test('Zugangsliste: E-Mail und Quelle', (await admin('GET',pfad+'/zugaenge')).d.some(z => z.email === 'verwaltung.kunde@example.com' && z.quelle === 'einladung'));
  test('Nicht-Admin kann keinen Zugang geben', (await kunde('POST',pfad+'/zugaenge',{email:'verwaltung.zweiter@example.com'})).s === 403);
  test('Gast kann Zugang nicht lesen', (await gast('GET',pfad+'/zugaenge')).s === 401);
  test('Doppelte Vergabe abgelehnt', (await admin('POST',pfad+'/zugaenge',{email:'verwaltung.kunde@example.com'})).s === 409);
  test('Fremdes Feld abgelehnt', (await admin('POST',pfad+'/zugaenge',{email:'verwaltung.zweiter@example.com',rolle:'admin'})).s === 400);
  test('Kurs vor Archiv in Shop', (await gast('GET','/api/kurse')).d.some(x => x.id === kurs));
  test('Kurs archiviert', (await admin('POST',pfad+'/archivieren',{})).d.status === 'archiviert');
  test('Archivierter Kurs nicht im Shop', !(await gast('GET','/api/kurse')).d.some(x => x.id === kurs));
  test('Archiv nicht kaufbar', (await zweiter('POST','/api/kurse/'+kurs+'/kaufen')).s === 404);
  test('Archiv nicht sichtbar für Nichtkäufer', (await zweiter('GET','/api/kurse/'+kurs)).s === 404);
  test('Archiv sichtbar für Käufer mit Lektionen', (await kunde('GET','/api/kurse/'+kurs)).d.lektionen?.some(l=>l.id===lecke));
  test('Archivierter Entwurf lässt sich nicht löschen', (await loesche(pfad,admin)).s === 409);
  test('Archiv erneut veröffentlicht', (await admin('POST',pfad+'/veroeffentlichen',{})).d.status === 'veroeffentlicht');
  const zurueck = await loesche(pfad+'/zugaenge/'+kId,admin);
  test('Zugang entzogen', zurueck.s === 200 && !(await kunde('GET','/api/kurse/'+kurs)).d.zugang);
  test('Entzug protokolliert', wert("SELECT COUNT(*) FROM verwaltung_log WHERE aktion='zugang_entziehen'") === 1);
  test('Manuelle Vergabe protokolliert', wert("SELECT COUNT(*) FROM verwaltung_log WHERE aktion='zugang_geben'") === 1);
  test('Nur Admin darf entziehen: Kunde 403', (await loesche(pfad+'/zugaenge/'+zId,kunde)).s===403);
  test('Nur Admin darf entziehen: Gast 401', (await loesche(pfad+'/zugaenge/'+zId,gast)).s===401);
  test('Kurs darf nicht gelöscht werden', (await loesche(pfad,admin)).s === 409);
  const entwurf = await erstelle('Entwurf löschen');
  const leckeEntwurf = (await admin('POST','/api/admin/kurse/'+entwurf+'/lektionen',{titel:'Ändern',art:'text'})).d.id;
  test('Lektion bearbeiten', (await admin('PATCH','/api/admin/lektionen/'+leckeEntwurf,{titel:'Geändert',abschnitt:'Teil',inhalt:'Inhalt'})).d.titel==='Geändert');
  test('Lektion mit Kursentwurf löschen', (await loesche('/api/admin/lektionen/'+leckeEntwurf,admin)).s===200);
  test('Lektion entfernt', wert('SELECT COUNT(*) FROM lektionen WHERE id = ?',leckeEntwurf)===0);
  test('Entwurf löschen', (await loesche('/api/admin/kurse/'+entwurf,admin)).s===200);
  test('Entwurf entfernt', wert('SELECT COUNT(*) FROM kurse WHERE id = ?',entwurf)===0);

  // Dateizeilen und physische Dateien gemeinsam löschen; im Fehlerfall bleibt alles erhalten.
  const dateiKurs = await erstelle('Dateien löschen');
  const bild = (await admin('POST','/api/admin/kurse/'+dateiKurs+'/lektionen',{titel:'PDF',art:'pdf'})).d.id;
  mkdirSync(ORDNER,{recursive:true});
  const pfadName = '11111111-1111-4111-8111-111111111111';
  writeFileSync(join(ORDNER,pfadName),'%PDF-1.4\n');
  let dDatei = new DatabaseSync(DATEI);
  try {
    dDatei.prepare("INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)")
      .run(bild,'datei.pdf','pdf',pfadName,9,'application/pdf',new Date().toISOString());
  } finally { dDatei.close(); }
  test('Datei auf Datenträger vorhanden', existsSync(join(ORDNER,pfadName)));
  test('Einzeldatei gelöscht', (await loesche('/api/admin/lektionen/'+bild+'/datei',admin)).s===200);
  test('Datei physisch entfernt', !existsSync(join(ORDNER,pfadName)));
  test('Dateizeile entfernt', wert('SELECT COUNT(*) FROM dateien WHERE lektion_id=?',bild)===0);
  const pfadName2 = '22222222-2222-4222-8222-222222222222';
  writeFileSync(join(ORDNER,pfadName2),'%PDF-1.4\n');
  dDatei = new DatabaseSync(DATEI);
  try {
    dDatei.prepare("INSERT INTO dateien (lektion_id,name,art,pfad,groesse,mime,erstellt) VALUES (?,?,?,?,?,?,?)")
      .run(bild,'zwei.pdf','pdf',pfadName2,9,'application/pdf',new Date().toISOString());
    dDatei.exec("CREATE TRIGGER test_rollback BEFORE DELETE ON kurse BEGIN SELECT RAISE(FAIL,'rollback-test'); END");
  } finally { dDatei.close(); }
  test('Löschfehler ergibt 500', (await loesche('/api/admin/kurse/'+dateiKurs,admin)).s===500);
  test('Rollback behält Kurs und Dateizeile', wert('SELECT COUNT(*) FROM kurse WHERE id=?',dateiKurs)===1 && wert('SELECT COUNT(*) FROM dateien WHERE lektion_id=?',bild)===1);
  test('Rollback behält Datei', existsSync(join(ORDNER,pfadName2)));
  dDatei = new DatabaseSync(DATEI);
  try { dDatei.exec('DROP TRIGGER test_rollback'); } finally { dDatei.close(); }
  test('Löschen nach Rollback', (await loesche('/api/admin/kurse/'+dateiKurs,admin)).s===200);
  test('Kurslöschung entfernt physische Datei', !existsSync(join(ORDNER,pfadName2)));

  // Webhook für VOR der Archivierung gestartete Zahlung, danach archivierter Kurs.
  const checkoutKurs = await erstelle('Checkout vor Archiv');
  await admin('POST','/api/admin/kurse/'+checkoutKurs+'/veroeffentlichen',{});
  dDatei = new DatabaseSync(DATEI);
  try { dDatei.prepare('UPDATE benutzer SET stripe_kunde=? WHERE id=?').run('cus_scheibe6',zId); }
  finally { dDatei.close(); }
  await admin('POST','/api/admin/kurse/'+checkoutKurs+'/archivieren',{});
  const ereignis = { id:'evt_verwaltung_archiv', type:'checkout.session.completed', livemode:false,
    data:{ object:{ id:'cs_verwaltung_archiv', mode:'payment', payment_status:'paid',
      metadata:{kurs_id:String(checkoutKurs),benutzer_id:String(zId)},
      customer:'cus_scheibe6', currency:'huf', amount_total:10000, payment_intent:'pi_verwaltung_archiv' } } };
  const w = await fetch(BASE+'/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'simuliert'},body:JSON.stringify(ereignis)});
  test('Webhook archivierter Kurs angenommen (Attrappe)', w.status===200);
  test('Webhook vergibt Zugang trotz Archiv', wert('SELECT COUNT(*) FROM zugaenge WHERE kurs_id=? AND benutzer_id=?',checkoutKurs,zId)===1);
  test('Neue Käufe archivierter Kurs gesperrt', (await kunde('POST','/api/kurse/'+checkoutKurs+'/kaufen')).s===404);

  const geschützt = await erstelle('Entwurf mit Bestellung');
  const d = new DatabaseSync(DATEI);
  try {
    const zeit = new Date().toISOString();
    d.prepare("INSERT INTO bestellungen (stripe_sitzung, benutzer_id, kurs_id, betrag, waehrung, status, grund, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, 'pruefen', ?, ?, ?)")
      .run('cs_test_pruefen_1',kId,geschützt,10000,'huf','betrag_waehrung',zeit,zeit);
    d.prepare("INSERT INTO bestellungen (stripe_sitzung, benutzer_id, kurs_id, betrag, waehrung, status, grund, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, 'pruefen', ?, ?, ?)")
      .run('cs_test_pruefen_2',zId,geschützt,10000,'huf','betrag_waehrung',zeit,zeit);
  } finally { d.close(); }
  test('Entwurf mit Bestellung geschützt', (await loesche('/api/admin/kurse/'+geschützt,admin)).s===409);
  const best = dbAbfrage("SELECT id FROM bestellungen WHERE status = 'pruefen' ORDER BY id").map(x=>x.id);
  test('Gast kann nicht freigeben', (await gast('POST','/api/admin/bestellungen/'+best[0]+'/freigeben',{})).s===401);
  test('Kunde kann nicht freigeben', (await kunde('POST','/api/admin/bestellungen/'+best[0]+'/freigeben',{})).s===403);
  test('Admin gibt Prüfzahlung frei', (await admin('POST','/api/admin/bestellungen/'+best[0]+'/freigeben',{})).d.status==='bezahlt');
  test('L4: Freigabe einer Prüfzahlung merkt die Kaufmail vor (genau eine, Typ kauf)',
    wert("SELECT COUNT(*) FROM mail_ausgang WHERE bestellung_id=? AND typ='kauf'", best[0]) === 1);
  test('Zugang aus freigegebener Zahlung', wert('SELECT COUNT(*) FROM zugaenge WHERE kurs_id=? AND benutzer_id=?',geschützt,kId)===1);
  test('Prüfgrund bleibt', wert('SELECT grund FROM bestellungen WHERE id=?',best[0])==='betrag_waehrung');
  test('Freigabe nicht wiederholbar', (await admin('POST','/api/admin/bestellungen/'+best[0]+'/freigeben',{})).s===409);
  // Pruefrunde 3 (Agent I): Kunde hat einen befristeten Abo-Zugang und kauft einmalig; die Bestellung steht auf pruefen
  {
    const aboKurs = await erstelle('Kurs mit Abo-Zugang');
    const d2 = new DatabaseSync(DATEI);
    try {
      const z2 = new Date().toISOString();
      d2.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, gueltig_bis, erstellt) VALUES (?, ?, 'abo', ?, ?)").run(kId, aboKurs, Date.now() + 86400000, z2);
      d2.prepare("INSERT INTO bestellungen (stripe_sitzung, benutzer_id, kurs_id, betrag, waehrung, status, grund, erstellt, geaendert) VALUES (?, ?, ?, ?, ?, 'pruefen', ?, ?, ?)").run('cs_test_pruefen_abo', kId, aboKurs, 10000, 'huf', 'betrag_waehrung', z2, z2);
    } finally { d2.close(); }
    const aboBest = dbAbfrage("SELECT id FROM bestellungen WHERE stripe_sitzung='cs_test_pruefen_abo'")[0].id;
    test('Admin gibt Einmalzahlung frei, obwohl ein befristeter Abo-Zugang besteht', (await admin('POST','/api/admin/bestellungen/'+aboBest+'/freigeben',{})).d.status==='bezahlt');
    test('Abo-Zugang wird dauerhaft (Quelle zahlung, ohne Ende)', wert("SELECT COUNT(*) FROM zugaenge WHERE kurs_id=? AND benutzer_id=? AND quelle='zahlung' AND gueltig_bis IS NULL",aboKurs,kId)===1);
  }
  test('Admin lehnt Prüfzahlung ab', (await admin('POST','/api/admin/bestellungen/'+best[1]+'/ablehnen',{})).d.status==='abgelehnt');
  test('Ablehnung erteilt keinen Zugang', wert('SELECT COUNT(*) FROM zugaenge WHERE kurs_id=? AND benutzer_id=?',geschützt,zId)===0);
  test('Freigabe und Ablehnung protokolliert (2 Freigaben, 1 Ablehnung)', wert("SELECT COUNT(*) FROM verwaltung_log WHERE aktion IN ('freigeben','ablehnen')")===3);
  test('Lektion eines veröffentlichten Kurses nicht löschbar', (await loesche('/api/admin/lektionen/'+lecke,admin)).s===409);
  test('Gast darf nicht archivieren', (await gast('POST',pfad+'/archivieren',{})).s===401);
  test('Kunde darf nicht archivieren', (await kunde('POST',pfad+'/archivieren',{})).s===403);
  test('Gast darf Entwurf nicht löschen', (await loesche('/api/admin/kurse/'+geschützt,gast)).s===401);
  test('Kunde darf Entwurf nicht löschen', (await loesche('/api/admin/kurse/'+geschützt,kunde)).s===403);
  test('Neue Datenbankstatus erlaubt archiviert', dbAbfrage("SELECT sql FROM sqlite_master WHERE name='kurse'")[0].sql.includes('archiviert'));
  test('Neue Datenbankstatus erlaubt abgelehnt', dbAbfrage("SELECT sql FROM sqlite_master WHERE name='bestellungen'")[0].sql.includes('abgelehnt'));
} catch (e) {
  schlecht++;
  console.error('FEHLER im Testablauf:', e);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  try { rmSync(BASIS,{recursive:true,force:true}); }
  catch (e) { if (!['EPERM','EBUSY'].includes(e.code)) throw e; }
}
console.log('Verwaltung: ' + ok + ' bestanden, ' + schlecht + ' fehlgeschlagen');
process.exitCode = schlecht ? 1 : 0;
