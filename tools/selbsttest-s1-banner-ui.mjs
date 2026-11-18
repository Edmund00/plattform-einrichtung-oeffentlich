// S1: Quelltext und isolierte Funktionen, ohne Server oder Browser.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const read = p => readFileSync(p, 'utf8');
const shop = read('public/kunde.js');
const hero = shop.slice(shop.indexOf('function hero('), shop.indexOf('function emailLeiste('));
const admin = read('public/admin/admin.js');
const marke = admin.slice(admin.indexOf('async function markeBereich()'), admin.indexOf('// ---- Testkauf-Nachweis'));
const s1 = marke.slice(marke.indexOf('// S1: ungespeicherte'), marke.indexOf('  const musterNamen'));
assert.match(hero, /document\.createElement/);
assert.match(hero, /textContent = cim/);
assert.match(hero, /textContent = leiras/);
assert.doesNotMatch(hero + marke, /innerHTML|background-image|createObjectURL|children\[\d+\]/);
assert.match(shop, /hero\(t\('k_oldal_cim'\), t\('k_hero_alkim'\), true, false, true\)/);
for (const pattern of [/type: 'file'.*image\/png,image\/jpeg/, /FileReader/, /readAsDataURL/, /stepupAnfordern/, /s1_upload/, /s1_entfernen/, /s1_reset/, /s1_frage/, /s1Api\('PUT', '\/api\/admin\/marke\/hero'/, /s1Api\('DELETE', '\/api\/admin\/marke\/hero'/, /Array\.from\(s1Normalisiere\(eingabe.value\)\)/, /\[f, s1Normalisiere\(el.value\)\]/, /role: 'status'/, /setAttribute\('role', 'alert'\)/, /catch \{ fehler\('s1_lokal_fehler'\)/]) assert.match(s1, pattern);
const langs = ['de', 'en', 'hu'].map(l => JSON.parse(read('texte/' + l + '.json')));
const routes = read('routes-marke.mjs');
const routeS1 = routes.slice(routes.indexOf('  // S1:'));
// Literal-Codes und Statusargumente aus sämtlichen s1Fehler-Aufrufen lesen.
const calls = [...routeS1.matchAll(/s1Fehler\(res,\s*([^,]+),\s*([^)]+)\)/g)];
assert.ok(calls.length >= 6);
const codes = new Set();
for (const [, status, argument] of calls) {
  assert.match(status, /\b(?:400|401|413|500)\b/);
  if (/^'[^']+'$/.test(argument)) codes.add(argument.slice(1, -1));
  else {
    assert.equal(argument, 'b');
    assert.match(status, /banner_zu_gross.*413.*400/);
    // b stammt aus pruefeBanner, einschließlich seiner PNG-Prüfung.
    for (const m of read('banner-bild.mjs').matchAll(/'(banner_[a-z_]+)'/g)) codes.add(m[1]);
    assert.match(read('banner-bild.mjs'), /'banner_' \+ e\.slice\(4\)/);
    for (const m of read('banner-bild.mjs').matchAll(/return '(png_[a-z_]+)'/g)) codes.add('banner_' + m[1].slice(4));
  }
}
for (const m of routeS1.matchAll(/fehler\(res,\s*\d+,\s*'([^']+)'/g)) codes.add(m[1]);
// Gemeinsame Auth-Fehler gehören auch zu allen vier S1-Aktionen.
const auth = read('routes-kurse.mjs').match(/export function nurAdmin\([\s\S]*?\n\}/)[0];
for (const m of auth.matchAll(/fehler\(res,\s*\d+,\s*'([^']+)'/g)) codes.add(m[1]);
for (const key of Object.keys(langs[0]).filter(k => /^(s1_|banner_)/.test(k))) codes.add(key);
for (const key of codes) for (const l of langs) assert.ok(typeof l[key] === 'string' && l[key].trim(), key);
assert.doesNotMatch(s1, /startsWith\('banner_'\)/);
assert.match(s1, /T\[code\] \|\| rr.d\?\.text/);
const feedback = { setAttribute(k, v) { this[k] = v; }, textContent: '' };
const errorContext = vm.createContext({ T: langs[0], t: k => langs[0][k] || k, s1Meldung: feedback });
vm.runInContext(s1.slice(s1.indexOf('  const s1Abbruch'), s1.indexOf('  const s1Aktion')) + '\nglobalThis.showError = s1Fehler;', errorContext);
for (const code of codes) {
  errorContext.showError({ d: { fehler: code, text: 'Fallback' } });
  assert.equal(feedback.textContent, langs[0][code]);
}
errorContext.showError({ d: { fehler: 'unbekannt', text: 'Servertext' } });
assert.equal(feedback.textContent, 'Servertext');
errorContext.showError({ d: {} }); assert.equal(feedback.textContent, langs[0].s1_server_fehler);
errorContext.showError({}); assert.equal(feedback.textContent, langs[0].a_halozati_hiba);
errorContext.showError({ abgebrochen: true });
assert.equal(feedback.role, 'status'); assert.equal(feedback.textContent, langs[0].s1_abgebrochen);
errorContext.api = async () => ({ status: 401, d: { fehler: 'stepup_noetig' } });
errorContext.stepupAnfordern = async () => false;
assert.equal((await vm.runInContext("s1Api('PUT', '/api/admin/marke/hero', {})", errorContext)).abgebrochen, true);
assert.match(s1, /if \(!\(await stepupAnfordern\(\)\)\) return s1Abbruch\(\)/);
// Exakte Client- und Serverfunktionen isoliert ausführen, keine DB-/Serverimporte.
const normSource = s1.match(/const s1Normalisiere = [^\r\n]+/)[0];
const normalize = vm.runInNewContext(normSource + '\ns1Normalisiere');
const serverSource = read('banner-bild.mjs').split('export function pruefeHero')[1];
const pruefeHero = vm.runInNewContext('(function pruefeHero' + serverSource.trim() + ')');
for (const text of ['', '   ', '\u0958'.repeat(40), '\u0958'.repeat(41), 'e\u0301'.repeat(80), 'a\u0000\u202e\u061c\u2064'.repeat(80), '😀'.repeat(80), '😀'.repeat(81), '\u0958'.repeat(100), '\u0958'.repeat(101), '😀'.repeat(200), '😀'.repeat(201)]) {
  for (const [key, max] of [['titel', 80], ['untertitel', 200]]) {
    const normalized = normalize(text);
    const value = { titel: '', untertitel: '', [key]: text };
    const actual = pruefeHero({ de: value });
    assert.equal(actual !== null, Array.from(normalized).length <= max, key + ': ' + text);
    if (actual) { assert.equal(actual.de[key], normalized); assert.equal(Array.from(actual.de[key]).length, Array.from(normalized).length); }
  }
}
assert.equal(normalize('\u0958').length, 2);
assert.equal(pruefeHero({ de: { titel: '   ', untertitel: ' \t ' } }).de.titel, '');
const node = (tag, props = {}, ...children) => ({ tag, props, children: children.flat().filter(Boolean), textContent: '' });
const find = (root, predicate) => predicate(root) ? root : (root.children || []).filter(x => typeof x === 'object').map(x => find(x, predicate)).find(Boolean);
const tag = (root, name) => find(root, x => x.tag === name);
const context = vm.createContext({ h: node, document: { createElement: name => node(name) }, T: {}, LOGO: { vertikal: () => '/logo' }, t: x => x });
vm.runInContext(hero, context);
for (const custom of [null, { titel: '   ', untertitel: ' \t ' }, { titel: ' Eigener Titel ', untertitel: ' Eigener Text ' }]) {
  for (const banner of [null, '/marke/banner?v=1']) {
    context.T = { _hero: custom, _banner: banner };
    const result = context.hero('Default', 'Default subtitle', true, false, true);
    assert.equal(tag(result, 'h1').textContent, custom?.titel.trim() || 'Default');
    assert.equal(tag(result, 'p').textContent, custom?.untertitel.trim() || 'Default subtitle');
    assert.equal(result.props.class.includes('hero-banner'), !!banner);
    if (banner) assert.equal(find(result, x => x.props?.class === 'hero-banner-bild').props.src, banner);
  }
}
for (const l of ['de', 'en', 'hu']) {
  context.T = { _hero: { titel: '<script>' + l, untertitel: 'Subtitle ' + l }, _banner: '/marke/banner?v=1' };
  const result = context.hero('Default', 'Default subtitle', true, false, true);
  assert.equal(tag(result, 'h1').textContent, '<script>' + l);
  assert.equal(tag(result, 'img').props.alt, '<script>' + l);
  assert.equal(tag(result, 'img').props.loading, 'eager');
}
const course = context.hero('Course', 'Course subtitle', false, true);
assert.equal(course.props.class, 'hero hero-kurs');
assert.ok(tag(course, 'h1').children.includes('Course'));
// Auch die echte Admin-Vorschaufunktion mit Leerraum/Normalisierung ausführen.
const previewSource = s1.slice(s1.indexOf('  function aktualisiereHero()'), s1.indexOf('  const bannerEingabe'));
const preview = { box: { classList: { toggle() {} } }, bild: { removeAttribute() {} }, kopf: {}, text: {} };
const fields = { de: { titel: { value: '  ' }, untertitel: { value: ' \u0000 ' } } };
assert.doesNotMatch(marke, /s1_standard_/);
for (const l of langs) assert.ok(!Object.keys(l).some(k => k.startsWith('s1_standard_')));
const loader = s1.slice(s1.indexOf('  const s1Standards'), s1.indexOf('  const heroFelder'));
const callsByLanguage = [];
const loaderContext = vm.createContext({
  T: { ...langs[0], _sprache: 'de' }, t: k => langs[0][k], markeBereich: {},
  api: async (method, path) => {
    assert.equal(method, 'GET'); callsByLanguage.push(path);
    const l = path.split('=')[1];
    return { ok: true, d: langs[['de', 'en', 'hu'].indexOf(l)] };
  }
});
const load = () => vm.runInContext('(async () => {' + loader + '\nreturn s1Standards; })()', loaderContext);
const standards = await load();
await load();
assert.deepEqual(callsByLanguage.sort(), ['/api/texte?lang=en', '/api/texte?lang=hu']);
loaderContext.T._sprache = 'en';
await load(); await load();
assert.equal(callsByLanguage.filter(p => p.endsWith('=de')).length, 1);
loaderContext.markeBereich = {};
loaderContext.api = async () => { throw new Error('offline'); };
const failedStandards = await load();
assert.equal(failedStandards.de, null);
const previewContext = vm.createContext({ s1Standards: standards, heroSprache: { value: 'de' }, heroFelder: fields, heroVorschauen: [preview], bannerUrl: '/banner', s1Normalisiere: normalize, t: k => langs[0][k] });
vm.runInContext(previewSource + '\naktualisiereHero();', previewContext);
assert.equal(preview.kopf.textContent, langs[0].k_oldal_cim);
assert.equal(preview.text.textContent, langs[0].k_hero_alkim);
fields.de.titel.value = ' e\u0301 ';
vm.runInContext('aktualisiereHero()', previewContext);
assert.equal(preview.kopf.textContent, 'é');
for (const [i, l] of ['de', 'en', 'hu'].entries()) {
  fields[l] = { titel: { value: '' }, untertitel: { value: '' } };
  previewContext.heroSprache.value = l;
  vm.runInContext('aktualisiereHero()', previewContext);
  assert.equal(preview.kopf.textContent, langs[i].k_oldal_cim);
  assert.equal(preview.text.textContent, langs[i].k_hero_alkim);
}
previewContext.s1Standards = failedStandards;
previewContext.heroSprache.value = 'de';
vm.runInContext('aktualisiereHero()', previewContext);
assert.equal(preview.kopf.textContent, langs[0].s1_leer_hinweis);
assert.match(read('public/kunde.css'), /--hero-overlay:rgba\(0,0,0,\.8\)/);
for (const file of ['public/kunde.css', 'public/admin/admin.css']) {
  const css = read(file);
  assert.match(css, /object-fit:cover/); assert.match(css, /background:var\(--hero-overlay\)/); assert.match(css, /overflow-wrap:anywhere/);
}
console.log('S1 Banner UI: Fehlercodes/Status, Step-up-Abbruch, Hero/Standard, Vorschau und NFC-Grenzen bestanden.');
