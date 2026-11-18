// E5: Quelltext und echter Darstellungshelfer, ohne Server oder Zugangsdaten.
import assert from 'node:assert/strict';
import { readFileSync as read } from 'node:fs';
import vm from 'node:vm';
const source = read('assistent-routen.mjs', 'utf8');
const helper = source.slice(source.indexOf('function einrAnleitung('), source.indexOf('function einrText('));
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const expected = {
 mail: ['https://resend.com/api-keys', 'https://resend.com/domains', 'https://resend.com/docs/dashboard/api-keys/introduction'],
 stripe: ['https://dashboard.stripe.com/apikeys', 'https://docs.stripe.com/stripe-cli', 'https://docs.stripe.com/keys', 'https://docs.stripe.com/webhooks']
};
let reference;
for (const lang of ['de', 'en', 'hu']) {
 const HU = JSON.parse(read(`texte/${lang}.json`, 'utf8'));
 const keys = Object.keys(HU).filter(k => /^assistent_anleitung_(mail|stripe)_/.test(k)).sort();
 assert.equal(keys.length, 21);
 if (reference) assert.deepEqual(keys, reference); else reference = keys;
 const all = keys.map(k => HU[k]).join(' ');
 assert.doesNotMatch(all, /You can view and manage your API keys|Create a new API key with a name|You cannot view or edit an API key value|You must add and verify at least one domain|Resend sends emails using a domain you own/);
 assert.doesNotMatch(all, /sk_test_[a-zA-Z0-9]{8,}|<img|<script|style=|Sending access|előadás/);
 if (lang !== 'en') assert.doesNotMatch(all, /Where do I|How do I know|Open the|Copy the|signing secret|Official .* guide/);
 if (lang === 'en') assert.doesNotMatch(all, /Schlüssel|Woran|Öffnen|Honnan|Nyissa/);
 if (lang === 'de') assert.match(all, /Prüfen|prüfen/);
 if (lang === 'hu') assert.match(all, /Ön/);
 const context = vm.createContext({ HU, escHtml: escape });
 vm.runInContext(helper, context);
 for (const art of ['mail', 'stripe']) {
  const html = context.einrAnleitung(art);
  assert.equal((html.match(/<details class="einr-anleitung">/g) || []).length, 1);
  assert.match(html, /<summary>[^<]+<\/summary><ol>/);
  assert.equal((html.match(/<li>/g) || []).length, 5);
  assert.match(html, /<\/ol>/);
  const links = [...html.matchAll(/<a\b([^>]+)>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(m => m[1].match(/href="([^"]+)"/)[1]).sort(), [...expected[art]].sort());
  for (const [, attrs, label] of links) {
   assert.match(attrs, /target="_blank"/);
   assert.match(attrs, /rel="noopener noreferrer"/);
   assert.ok(label.trim());
  }
  for (const suffix of ['erfolg', 'sicherheit', ...(art === 'stripe' ? ['lokal'] : [])]) assert.ok(html.includes(escape(HU[`assistent_anleitung_${art}_${suffix}`])));
  assert.doesNotMatch(html, /style=|<img|<script|#[\da-f]{3,8}\b|sk_test_[a-zA-Z0-9]{8,}/i);
  assert.equal((source.match(new RegExp(`einrAnleitung\\('${art}'\\)`, 'g')) || []).length, 1);
  assert.ok(source.includes(`escHtml(HU.assistent_${art}_erklaerung ?? '')}</p>\x60 +\n        einrAnleitung('${art}')`));
 }
 HU.assistent_anleitung_mail_titel = '<img src=x>';
 assert.doesNotMatch(context.einrAnleitung('mail'), /<img/);
}
assert.doesNotMatch(helper, /localStorage|sessionStorage|console\.|fetch\(|style=/);
// Feld/Feldhilfe-Vertrag der E4a-Tests in beiden Speicherzuständen.
for (const field of ['RESEND_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
 assert.equal([...source.matchAll(new RegExp('<input[^>]*name="' + field + '"[^>]*></label>` \\+\\n\\s*`<p class="feldhilfe"[^>]*>', 'g'))].length, 2);
}
const css = read('public/admin/admin.css', 'utf8').split('/* E5:')[1];
assert.ok(css);
assert.match(css, /min-height:48px/);
assert.match(css, /focus-visible/);
assert.match(css, /overflow-wrap:anywhere/);
assert.match(css, /line-height:1\.6/);
assert.doesNotMatch(css, /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i);
assert.ok(read('public/admin/admin.css', 'utf8').split('/* E5:')[1].replaceAll('\r\n', '').indexOf('\n') === -1);
for (const file of ['tools/selbsttest-alle.sh', 'tools/Selbsttest-Alle.ps1']) assert.ok(read(file, 'utf8').includes('e5-anleitungen'));
console.log('E5: drei Sprachen, isolierte Anleitungen, Pflichtlinks, Sicherheit, Escaping, Feldhilfen und CSS bestanden.');
