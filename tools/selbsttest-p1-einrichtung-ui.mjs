// P1: Quelltext und originale Darstellungsfunktionen, ohne Server.
import assert from 'node:assert/strict';
import { readFileSync as read } from 'node:fs';
import vm from 'node:vm';
const source = read('assistent-routen.mjs', 'utf8');
const cut = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const escape = cut('const ESC_HTML', 'const escJs');
const helpers = cut('function einrText(', 'function einrFortschritt(');
const actions = cut('      const stripeAktionen =', '\n      inhalt =');
const six = cut('      const schrittListe = [];', '    } else {\n      inhalt =');
assert.doesNotMatch(six, /disabled|style=/);
assert.match(six, /const berichtHtml6 = einrPruefliste\(berichtItems6\)/);
assert.match(six, /<ul>\$\{schrittListe.join\(''\)\}<\/ul>/);
assert.match(source, /stripeAktionen \+\n\s*`<p id="stripe-verbindung-meldung"/);
const logout = [...source.matchAll(/<button class="([^"]+)" type="submit">\$\{HU.assistent_abmelden/g)];
assert.equal(logout.length, 2);
assert.ok(logout.every(m => m[1] === 'einr-textlink'));
const keys = ['assistent_stripe_test_hinweis', ...['pflicht','optional','alle_erledigt','fehlen','erledigt','fehlt'].map(k => 'assistent_pruefliste_'+k)];
let reference;
for (const lang of ['de', 'en', 'hu']) {
 const HU = JSON.parse(read(`texte/${lang}.json`, 'utf8'));
 const placeholders = keys.map(k => { assert.ok(HU[k]); return HU[k].match(/\{\w+\}/g) || []; });
 if (reference) assert.deepEqual(placeholders, reference); else reference = placeholders;
 assert.deepEqual(placeholders[4], ['{n}']);
 const ctx = vm.createContext({HU});
 vm.runInContext(escape + helpers, ctx);
 for (const keysGesetzt of [false, true]) {
  ctx.keysGesetzt = keysGesetzt;
  const html = vm.runInContext(`(()=>{${actions};return stripeAktionen;})()`, ctx);
  assert.equal((html.match(/class="knopf"/g)||[]).length, 1);
  assert.match(html, /class="knopf-sekundaer" type="button" id="stripe-verbindung-btn"/);
  assert.ok(html.indexOf('class="knopf"') < html.indexOf('id="stripe-verbindung-btn"'));
  // Hinweis 'zuerst speichern' nur, solange noch keine Schluessel gespeichert sind (sonst widerspricht er der Statuszeile)
  assert.equal(html.includes(HU.assistent_stripe_test_hinweis), !keysGesetzt);
  assert.equal(html.includes('id="stripe-teststatus"'), keysGesetzt);
  if (keysGesetzt) assert.ok(html.includes(`<p role="status" id="stripe-teststatus"><strong>${HU.assistent_stripe_gespeichert_ungetestet}</strong></p>`));
  // Originalen Klickhandler ohne Server ausführen: Erfolg, Ablehnung, Netzfehler.
  const stripeSource = cut("      const stripeAktionen =", "    } else if (n === 5)");
  const expression = stripeSource.slice(stripeSource.indexOf("        `var csrf="), stripeSource.indexOf("        `function zeigeStepupDialog")).trim().replace(/\+$/, '');
  const script = vm.runInNewContext(expression, { HU, csrf: 'test', escJs: value => String(value).replaceAll("'", "\\'") });
  assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage/);
  for (const outcome of ['ok', 'error', 'network']) {
   const status = { textContent: HU.assistent_stripe_gespeichert_ungetestet };
   const message = { textContent: '' };
   let click, requests = 0;
   const button = { addEventListener: (event, handler) => { click = handler; } };
   const browser = vm.createContext({
    document: { getElementById: id => id === 'stripe-verbindung-btn' ? button : id === 'stripe-teststatus' ? (keysGesetzt ? status : null) : message },
    fetch: async () => {
     requests++;
     if (outcome === 'network') throw Error('network');
     return { ok: outcome === 'ok', json: async () => ({ ok: outcome === 'ok', fehler: 'stripe_fehler' }) };
    }
   });
   vm.runInContext(script, browser);
   click();
   await new Promise(resolve => setImmediate(resolve));
   assert.equal(requests, 1);
   assert.equal(status.textContent, keysGesetzt && outcome === 'ok' ? HU.assistent_stripe_verbindung_ok : HU.assistent_stripe_gespeichert_ungetestet);
   assert.ok(status.textContent);
  }
  assert.doesNotMatch(html, /style=|#[\da-f]{3,8}\b/);
 }
 for (const n of [0, 1, 3]) {
  const items = Array.from({length:3}, (_,i) => ({pflicht:true,status:i<n?'rot':'ok',id:'pflicht'+i,grund:'g1a_mail',korrekturLink:'/admin/einrichtung/schritt/3'}));
  items.push({pflicht:false,status:'rot',grund:'g1a_logo',korrekturLink:'/admin/einrichtung/schritt/1'});
  ctx.items = items;
  const html = vm.runInContext('einrPruefliste(items)',ctx);
  assert.equal((html.match(/<section/g)||[]).length, 2);
  for (const k of ['pflicht','optional']) assert.ok(html.includes(`<h2>${HU['assistent_pruefliste_'+k]}</h2>`));
  assert.ok(html.includes(n ? HU.assistent_pruefliste_fehlen.replace('{n}',n) : HU.assistent_pruefliste_alle_erledigt));
  assert.equal((html.match(/class="bericht-rot"/g)||[]).length,n);
  const required = html.split('</section>')[0];
  assert.equal((required.match(/<a href=/g)||[]).length,n);
  assert.ok(required.includes(n ? '✗ '+HU.assistent_pruefliste_fehlt : '✓ '+HU.assistent_pruefliste_erledigt));
  if (n) assert.ok(required.includes(HU.g1a_korrigieren));
  const optional = html.split('</section>')[1];
  assert.match(optional,/→/);
  assert.doesNotMatch(optional,/bericht-rot|warn|disabled|style=/);
  assert.doesNotMatch(html,/disabled|style=|#[\da-f]{3,8}\b/);
 }
 ctx.items = [{pflicht:true,status:'rot',id:'schluessel',grund:'g1a_schluessel',korrekturLink:'/admin/einrichtung/schritt/6'}];
 // Bestehender G1-Vertrag: kein Selbstlink zur Schlüsselsicherung auf Schritt 6.
 assert.doesNotMatch(vm.runInContext('einrPruefliste(items)',ctx), /<a href=/);
 ctx.items = [{pflicht:true,status:'rot',id:'mail',grund:'g1a_mail',korrekturLink:'/admin/einrichtung/schritt/3'}];
 HU.g1a_mail = '<img src=x>';
 assert.doesNotMatch(vm.runInContext('einrPruefliste(items)',ctx), /<img/);
}
const css = read('public/admin/admin.css','utf8').split('/* P1:')[1];
assert.ok(css);
assert.doesNotMatch(css,/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
for (const part of ['min-height:48px','focus-visible','max-width:100%','overflow-wrap:anywhere','font-size:1rem','display:list-item','border-left:3px solid var(']) assert.ok(css.includes(part));
assert.equal(css.replaceAll('\r\n','').includes('\n'),false);
assert.doesNotMatch(helpers+actions,/style=|<script|fetch\(/);
for (const file of ['tools/selbsttest-alle.sh','tools/Selbsttest-Alle.ps1']) assert.ok(read(file,'utf8').includes('p1-einrichtung-ui'));
console.log('P1: drei Sprachen, Hauptaktion in beiden Schlüsselzuständen, Pflichtzählung 0/1/3, Gruppen, Links, Escaping und CSS OK.');
