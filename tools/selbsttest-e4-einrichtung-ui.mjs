// E4a: echte UI-Helfer isoliert ausführen; kein Server, keine Datenbank.
import { readFileSync as read } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source = read('assistent-routen.mjs', 'utf8');
const helper = source.slice(source.indexOf('function einrText('), source.indexOf('export function erstelleAssistentRouter'));
const langs = ['de', 'en', 'hu'].map(l => JSON.parse(read(`texte/${l}.json`, 'utf8')));
const titles = [
 ['Name und Logo', 'Anbieter und Rechtliches', 'Automatische Nachrichten', 'Zahlungen einrichten', 'Ersten Kurs vorbereiten', 'Alles überprüfen'],
 ['Name and logo', 'Business and legal details', 'Automated emails', 'Set up payments', 'Prepare your first course', 'Review your setup'],
 ['Név és logó', 'Szolgáltatói és jogi adatok', 'Automatikus e-mailek', 'Fizetések beállítása', 'Az első előadás előkészítése', 'A beállítások ellenőrzése']
];
const overviewTitles = ['Ihre Einrichtung', 'Your setup', 'Az Ön beállításai'];
const steps = ['Schritt {n} von {gesamt}', 'Step {n} of {gesamt}', '{n}. lépés a {gesamt}-ból'];
const statuses = [['Erledigt', 'Offen', 'Optional'], ['Completed', 'Not started', 'Optional'], ['Kész', 'Még nincs kész', 'Nem kötelező']];
const labels = [
 ['Zugangsschlüssel für den E-Mail-Dienst', 'Testschlüssel des Zahlungsdienstes', 'Sicherheitsschlüssel für Zahlungsbenachrichtigungen'],
 ['Access key for the email service', 'Test key of the payment service', 'Security key for payment notifications'],
 ['Az e-mail szolgáltatás hozzáférési kulcsa', 'A fizetési szolgáltatás tesztkulcsa', 'A fizetési értesítések biztonsági kulcsa']
];
const ph = v => (v.match(/\{\w+\}/g) || []).sort();
for (const [i, HU] of langs.entries()) {
 assert.equal(HU.assistent_uebersicht_titel, overviewTitles[i]);
 assert.equal(HU.assistent_schritt_x_von, steps[i]);
 ['fertig', 'offen', 'optional'].forEach((s, j) => assert.equal(HU[`assistent_status_${s}`], statuses[i][j]));
 for (const k of ['assistent_schritt_x_von', 'assistent_uebersicht_fortschritt', 'assistent_weiter_mit_schritt', 'assistent_status_fertig', 'assistent_status_offen', 'assistent_status_optional']) assert.deepEqual(ph(HU[k]), ph(langs[2][k]), k);
 ['mail_key', 'stripe_key', 'stripe_webhook'].forEach((k, j) => {
  assert.equal(HU[`assistent_${k}_bezeichnung`], labels[i][j]);
  assert.doesNotMatch(HU[`assistent_${k}_bezeichnung`], /API|Webhook|sk_test_/);
  assert.match(HU[`assistent_${k}_hilfe`], /Resend|Stripe/);
 });
 const c = vm.createContext({ HU, SCHRITTE: 6, escHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
 vm.runInContext(helper, c);
 for (let mask = 0; mask < 64; mask++) {
  const done = n => !!(mask & (1 << (n - 1)));
  let calls = [];
  const next = Array.from({length: 6}, (_, j) => j + 1).find(n => !done(n)) || 1;
  const html = c.einrUebersicht(n => { calls.push(n); return done(n); }, () => next);
  assert.deepEqual(calls, [1, 2, 3, 4, 5, 6]);
  const count = calls.filter(done).length;
  assert.equal((html.match(/<li>.*?admin\/einrichtung\/schritt\//g) || []).length, 6);
  assert.equal((html.match(/✓/g) || []).length, count);
  assert.match(html, new RegExp(`<progress[^>]*value="${count}" max="6"`));
  const items = [...html.matchAll(/<li>(.*?)<\/li>/g)];
  items.forEach((m, j) => assert.ok(m[1].includes(HU[done(j + 1) ? 'assistent_status_fertig' : j === 4 ? 'assistent_status_optional' : 'assistent_status_offen'])));
  assert.ok(html.includes(count === 6 ? HU.assistent_zur_abschlusspruefung : HU.assistent_weiter_mit_schritt.replace('{n}', String(next))));
  assert.match(html, new RegExp(`class="knopf" href="/admin/einrichtung/schritt/${count === 6 ? 6 : next}"`));
  assert.match(html, /10 Minute|10 perc|10 minutes/);
 }
 for (let n = 1; n <= 6; n++) {
  assert.equal(HU[`assistent_schritt_${n}_titel`], titles[i][n - 1]);
  const html = c.einrSchrittkopf(n, titles[i][n - 1]);
  assert.ok(html.includes(steps[i].replace('{n}', String(n)).replace('{gesamt}', '6')));
  assert.match(html, new RegExp(`<progress[^>]*value="${n}" max="6" aria-label="[^"<>]+"`));
  assert.ok(html.includes(HU[`assistent_schritt_${n}_zweck`]));
  const nav = c.einrNavigation(n);
  assert.ok(nav.includes(n === 1 ? 'href="/admin/einrichtung/"' : `href="/admin/einrichtung/schritt/${n - 1}"`));
  assert.ok(nav.includes(HU.assistent_zur_uebersicht));
 }
 assert.doesNotMatch(c.einrSchrittkopf(1, '<img>'), /<h1><img>/);
}
const get = source.slice(source.indexOf("router.get('/schritt/:n'"), source.indexOf('// POST /admin/einrichtung/schritt/:n'));
const six = get.slice(get.indexOf('const schrittListe = []'), get.indexOf('    } else {\n      inhalt ='));
assert.doesNotMatch(six, /disabled|style=/);
assert.match(six, /if \(!bereit\)/);
assert.match(six, /einrSchrittkopf\(n, titel\)/);
assert.equal((get.match(/einrSchrittkopf\(n, titel\)/g) || []).length, 2);
assert.equal((get.match(/einrNavigation\(n\)/g) || []).length, 2);
assert.match(get, /kopf\(escHtml\(fortschritt \+ ' – ' \+ titel\), lang\)/);
assert.doesNotMatch(get + helper, /style=|localStorage|sessionStorage/);
for (const field of ['RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
 const inputs = [...get.matchAll(new RegExp('<input[^>]*name="' + field + '"[^>]*></label>` \\+\\n\\s*`<p class="feldhilfe"[^>]*>', 'g'))];
 assert.equal(inputs.length, 2, `${field}: sichtbare Feldhilfe in beiden Zuständen`);
}
assert.match(source, /get\(`einrichtung_schritt_\$\{n\}`\)\?\.wert === 'fertig'/);
const css = read('public/admin/admin.css', 'utf8').split('/* E4a: Einrichtungsassistent */')[1];
assert.ok(css);
assert.doesNotMatch(css.replace(/:root\s*\{[^}]*\}/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
assert.match(css, /focus-visible/);
assert.match(css, /flex-wrap:wrap/);
for (const p of ['tools/selbsttest-alle.sh', 'tools/Selbsttest-Alle.ps1']) assert.ok(read(p, 'utf8').includes('e4-einrichtung-ui'));
console.log('E4 Einrichtung UI: drei Sprachen, 192 Statuskombinationen, Schrittköpfe, Feldhilfen und Quelltextprüfungen bestanden.');
