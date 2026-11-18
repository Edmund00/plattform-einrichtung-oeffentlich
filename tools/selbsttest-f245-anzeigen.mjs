import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { formatBetrag } from '../public/preis.js';
const read = p => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const admin = read('public/admin/admin.js');
const route = read('assistent-routen.mjs');
let fehler = 0;
function test(name, fn) { try { fn(); console.log('OK:', name); } catch(e) { fehler++; console.log('FEHLER:', name, e.message); } }
for (const l of ['de','en','hu']) test('Texte '+l, () => {
 const t = JSON.parse(read('texte/'+l+'.json'));
 for (const k of ['assistent_mail_test_kein_schluessel','abgleich_noch_nie','a_kurs_veroeffentlichen']) assert.ok(t[k]?.trim(), k);
});
test('F-245 Mail-Fehlerzuordnung', () => {
 const mail = route.slice(route.indexOf('var msgs='), route.indexOf('var msgs=')+4000);
 assert.match(mail, /kein_schluessel:.*HU.assistent_mail_test_kein_schluessel/);
 assert.ok(mail.includes('r.d.meldung||msgs[r.d.fehler]'));
});
test('F-246 getrennte Leerstaende', () => {
 assert.match(admin, /const alter=info.letzte.*t\('sicherung_soha'\)/);
 assert.match(admin, /last\?budapestZeit\(last.ende\).*t\('abgleich_noch_nie'\)/);
});
test('F-247 Fertig blendet Anleitung aus', () => {
 assert.match(route, /<p id="neustart-anleitung">/);
 const poll = route.match(/var versuche=0;function poll\(\)\{versuche\+\+;[\s\S]*?setTimeout\(poll,3000\);/)[0];
 const anleitung = { hidden: false }, msg = {};
 vm.runInNewContext(poll.slice(0,poll.indexOf('.catch('))+';} poll();', {
  fetch: () => ({ then: fn => { fn({ok:true, headers:{get:()=>'application/json'}}); return {}; } }),
  document: { getElementById: (id) => id === 'neustart-anleitung' ? anleitung : {} }, msg, fertig:'Gestartet', setTimeout() {}
 });
 assert.equal(msg.textContent, 'Gestartet'); assert.equal(anleitung.hidden, true);
});
test('F-248 Entwurfsbeschriftung', () => assert.ok(admin.includes("t(k.status === 'entwurf' ? 'a_kurs_veroeffentlichen' : 'a_kesz')")));
test('F-250 vorhandene Formatierung', () => {
 assert.ok(admin.includes('budapestZeit(eintrag.erstellt)'));
 assert.ok(admin.includes('formatBetrag(eintrag.betrag, eintrag.waehrung)'));
 assert.equal(formatBetrag(2000,'eur'), '20,00 EUR');
 const fn = admin.slice(admin.indexOf('function budapestZeit('), admin.indexOf('const MONATE_EN'));
 const zeit = vm.runInNewContext(fn+"budapestZeit('2026-11-16T19:37:12.070Z')", {LOC:'de-DE', Intl, Date});
 assert.equal(zeit, '16.11.2026 20:37:12');
});

test('N1 alle Mail-Routenfehler haben msgs, Stripe nur Bericht', () => {
 for (const [pfad, index] of [['mail-test',0],['stripe-verbindung',1]]) {
  const start=route.indexOf("router.post('/"+pfad+"'");
  const ende=route.indexOf('router.post(',start+20);
  const code=route.slice(start,ende<0?undefined:ende);
  const msgs=[...route.matchAll(/var msgs=\{([^\n]+)/g)][index][1];
  const fehlt=[...new Set([...code.matchAll(/fehler: '([^']+)'/g)].map(m=>m[1]))].filter(k=>!msgs.includes(k+':'));
  if(index===0) assert.deepEqual(fehlt,[]);
  else { assert.deepEqual(fehlt,['csrf_fehler']); console.log('Stripe: msgs fehlt csrf_fehler (unveraendert)'); }
 }
 assert.match(route,/if\(!to\)\{meld.textContent=msgs.empfaenger_fehler/);
 assert.ok(route.includes('msgs[r.d.fehler]||msgs.allgemein'));
 for(const l of ['de','en','hu']) {
  const t=JSON.parse(read('texte/'+l+'.json'));
  for(const k of ['empfaenger_fehler','kein_absender','allgemein']) assert.ok(t['assistent_mail_test_'+k]?.trim());
 }
});
const { baueAbsender, mitVorschauName } = await import('../kaufmail-vorlage.mjs');
const { plattformName } = await import('../marke.mjs');
test('N2 Absender, Override, Bereinigung und Vorschau', () => {
 assert.equal(baueAbsender('Tour Akademie <a@x.de>','Aurora Akademie'),'"Aurora Akademie" <a@x.de>');
 assert.equal(baueAbsender('a@x.de','Aurora Akademie'),'"Aurora Akademie" <a@x.de>');
 assert.equal(baueAbsender('a@x.de','Aurora','Mueller, Kft.'),'"Mueller, Kft." <a@x.de>');
 assert.equal(baueAbsender('a@x.de','Aurora','  '),'"Aurora" <a@x.de>');
 const inj=baueAbsender('a@x.de','X\r\nBcc: v@x.de <>"\\');
 assert.equal(inj,'"XBcc: v@x.de" <a@x.de>');
 assert.equal((inj.match(/</g)||[]).length,1); assert.ok(!/[\r\n]/.test(inj));
 assert.equal(baueAbsender('a@x.de','<>"\\\r\n'),'a@x.de');
 assert.equal(baueAbsender('a@x.de','X'.repeat(70)),'"'+'X'.repeat(60)+'" <a@x.de>');
 for(const roh of ['kaputt','X <a@x.de> <b@x.de>','X\r\nBcc: b@x.de <a@x.de>']) assert.equal(baueAbsender(roh,'A'),'');
 const vorher=plattformName();
 assert.equal(mitVorschauName('Vorschau',()=>baueAbsender('a@x.de',plattformName())),'"Vorschau" <a@x.de>');
 assert.equal(plattformName(),vorher);
 const mail=read('mail.mjs'); assert.equal((mail.match(/baueAbsender\(from,/g)||[]).length,2);
 assert.ok(route.includes("ueberschreibName: leseEinstellung('MAIL_ABSENDER_NAME')"));
});
const { ladeKonfig } = await import('../konfig.mjs');
const { setzeAnbieterBasis, leseAnbieter } = await import('../anbieter.mjs');
test('N3 Herkunft DB, Umgebung, gemischt', () => {
 const daten={ANBIETER_NAME:'Assistent',ANBIETER_ANSCHRIFT:'Strasse 1',ANBIETER_EMAIL:'a@x.de'};
 const basis={STRIPE_SECRET_KEY:'sk_test_platzhalter',STRIPE_WEBHOOK_SECRET:'whsec_platzhalter'};
 for(const [env,quelle] of [[{},'einstellungen'],[daten,'umgebung'],[{ANBIETER_EMAIL:'b@x.de'},'umgebung']]) {
  const k=ladeKonfig({...basis,...env},{speicher:{lese:k=>daten[k]??null}});
  setzeAnbieterBasis(k.anbieter,k.anbieterQuelle);
  assert.equal(leseAnbieter().quelle,quelle);
  assert.equal(leseAnbieter().name,'Assistent');
 }
 setzeAnbieterBasis(null);
});


test('N2 Versand liest Namen und Override bei jeder Mail', () => {
 const src=read('mail.mjs');
 const funktion=src.slice(src.indexOf('export function resendMailer'),src.indexOf('export async function mailTesten')).replace('export function','function');
 let name='Aurora',override='',body;
 const kontext={baueAbsender,plattformName:()=>name,db:{prepare:()=>({get:()=>({wert:override})})},fetch:()=>{},RESEND_URL:'https://example.test',AbortSignal,console};
 const factory=vm.runInNewContext(funktion+';resendMailer',kontext);
 const senden=factory({apiKey:'test',from:'Tour <a@x.de>',fetchFn:async(u,o)=>{body=JSON.parse(o.body);return{ok:true};}});
 // Der Header wird synchron vor dem ersten await gebaut.
 senden({to:'b@x.de'}); assert.equal(body.from,'"Aurora" <a@x.de>');
 name='Neue Marke'; senden({to:'b@x.de'}); assert.equal(body.from,'"Neue Marke" <a@x.de>');
 override='Eigen, Kft.'; senden({to:'b@x.de'}); assert.equal(body.from,'"Eigen, Kft." <a@x.de>');
});

{ // F-249 Nachpruefung (Opus): Bidi/Zeilentrenner entfernt, Kuerzung nach Zeichen
  const { baueAbsender: ba } = await import('../kaufmail-vorlage.mjs');
  const bidi = ba('a@x.de', 'A' + String.fromCharCode(0x202e) + 'B' + String.fromCharCode(0x2028) + 'C' + String.fromCharCode(0x200b));
  assert.equal(bidi, '"ABC" <a@x.de>');
  const emoji = ba('a@x.de', String.fromCodePoint(0x1F600).repeat(70));
  assert.equal(Array.from(emoji.split('"')[1]).length, 60);
  assert.ok(!Array.from(emoji).some(c => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff), 'kein zerschnittenes Surrogatpaar');
  console.log('OK: F-249 Bidi und Surrogate');
}
{ // F-251 Nachpruefung (Opus): Herkunft wird bis in erstelleServer durchgereicht (sonst ueberschreibt app.mjs sie mit 'umgebung')
  const app = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
  const srv = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.ok(app.includes('setzeAnbieterBasis(anbieter, anbieterQuelle)'), 'app.mjs reicht die Herkunft weiter');
  assert.ok(srv.includes('erstelleServer({ anbieterQuelle: konfig.anbieterQuelle'), 'server.mjs uebergibt konfig.anbieterQuelle');
  console.log('OK: F-251 Herkunft bis erstelleServer');
}
console.log(fehler ? `${fehler} FEHLER` : 'F245-Anzeigen: alle Offline-Tests bestanden');
process.exitCode = fehler ? 1 : 0;
