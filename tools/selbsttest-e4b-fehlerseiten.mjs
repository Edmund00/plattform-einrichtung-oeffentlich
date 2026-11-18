// Serverlos: echte Modulhelfer isoliert auswerten, keine Router-/Serverimporte.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync('assistent-routen.mjs', 'utf8');
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const code = block('const ESC_HTML', 'const escJs') +
  block('function sicherheitsheader', 'function einrUebersicht') +
  block('function istBrowserFormular', 'export function erstelleAssistentRouter');
const keys = ['assistent_fehlerseite_titel', 'assistent_fehlerseite_hilfe', 'assistent_fehlerseite_zurueck', 'assistent_abschluss_gesperrt_hinweis'];
let checks = 0;
for (const lang of ['de', 'en', 'hu']) {
  const HU = JSON.parse(readFileSync(`texte/${lang}.json`, 'utf8'));
  for (const key of keys) assert.ok(HU[key]);
  assert.deepEqual(HU.assistent_fehlerseite_zurueck.match(/\{\w+\}/g), ['{n}']);
  const { fehler, istBrowserFormular } = runInNewContext(code + '\n({fehler, istBrowserFormular})', {
    HU, SCHRITTE: 6, sprache: () => lang, farbenLink: () => '',
  });
  const request = (headers, method = 'POST') => ({ method, headers });
  const respond = (req, status, n) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(v) { this.code = v; return this; }, type(v) { this.mime = v; return this; },
      send(v) { this.body = v; return this; } };
    return fehler(req, res, status, '<script>&"Fehler', n);
  };
  for (const status of [400, 401, 403, 404, 409, 429, 500]) {
    for (const n of [1, 2, 3, 4, 5, 6, undefined, 99]) {
      const res = respond(request({ accept: 'text/html,application/xhtml+xml', 'content-type': 'application/x-www-form-urlencoded' }), status, n);
      assert.equal(res.code, status);
      assert.equal(res.mime, 'html');
      assert.equal(res.headers['Cache-Control'], 'no-store');
      assert.ok(res.body.includes(`<title>${HU.assistent_fehlerseite_titel}</title>`));
      assert.ok(res.body.includes('role="alert">&lt;script&gt;&amp;&quot;Fehler'));
      assert.ok(!res.body.includes('<script>'));
      assert.ok(!/style=|<script/i.test(res.body));
      assert.ok(res.body.includes(HU.assistent_zur_uebersicht));
      assert.ok(res.body.includes('href="/admin/einrichtung/"'));
      if (n >= 1 && n <= 6) {
        assert.ok(res.body.includes(`href="/admin/einrichtung/schritt/${n}"`));
        assert.ok(res.body.includes(HU.assistent_fehlerseite_zurueck.replace('{n}', n)));
        const navigation = res.body.slice(res.body.indexOf('role="alert"'));
        assert.ok(navigation.indexOf(`/schritt/${n}`) < navigation.indexOf('href="/admin/einrichtung/"'));
      }
      checks++;
    }
    for (const req of [request({ accept: '*/*' }), request({ accept: 'application/json' }),
      request({ accept: 'text/html', 'x-requested-with': 'XMLHttpRequest' }),
      request({ accept: 'text/html', 'content-type': 'application/problem+json' }),
      request({}), request({ accept: 'text/html' }, 'GET')]) {
      assert.equal(istBrowserFormular(req), false);
      const res = respond(req, status, 3);
      assert.equal(res.code, status);
      assert.equal(res.mime, 'text/plain');
      assert.equal(res.body, '<script>&"Fehler');
      checks++;
    }
  }
}
// Keine rohen Textantworten ausserhalb des gemeinsamen Helfers.
// Skript-Endpunkte mail-test/stripe-verbindung verwenden weiterhin ihre JSON-Antworten.
const raw = source.split('\n').filter(line => line.includes(".type('text/plain')"));
// Ausnahme: 401 stepup_noetig ist ein Protokoll-Signal fuer den Step-up-Dialog (F-289)
assert.equal(raw.length, 2);
assert.ok(raw.some(line => line.includes('if (!istBrowserFormular(req))')));
assert.ok(raw.some(line => line.includes("401") && line.includes("'stepup_noetig'")));
for (const [name, id] of [['RESEND_API_KEY', 'einr-mail-key-hilfe'], ['STRIPE_SECRET_KEY', 'einr-stripe-key-hilfe'], ['STRIPE_WEBHOOK_SECRET', 'einr-webhook-hilfe']]) {
  // Je ein Paar fuer Neuanlage und Ersetzen; Zweige schliessen sich aus.
  assert.equal(source.split(`<input aria-describedby="${id}" name="${name}"`).length - 1, 2);
  assert.equal(source.split(`<p class="feldhilfe" id="${id}">`).length - 1, 2);
}
assert.equal(source.split('<p class="hinweis">${escHtml(HU.assistent_abschluss_gesperrt_hinweis)}</p>').length - 1, 2);
console.log(`E4b: ${checks} Antwortvarianten, Sprachen, Escaping und Feldhilfe-Paare OK`);

// F-284: keine lokale Variable darf die Hilfsfunktion fehler() ueberdecken (ausser im JSON-Logo-Upload)
import { readFileSync as lesF } from 'node:fs';
const routenQuelle = lesF(new URL('../assistent-routen.mjs', import.meta.url), 'utf8');
const ohneLogo = routenQuelle.slice(0, routenQuelle.indexOf("router.post('/logo-upload'"));
assert.doesNotMatch(ohneLogo, /const fehler\s*=/);
console.log('E4b-Schattenvariable: ok');
