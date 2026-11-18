// Serverlos: echte Seitenfunktion und Polling mit isolierten Attrappen ausführen.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const quelltext = readFileSync('assistent-routen.mjs', 'utf8');
const funktion = quelltext.slice(quelltext.indexOf('function abschlussSeite('), quelltext.indexOf('function einrText('));
const escaping = quelltext.slice(quelltext.indexOf('const ESC_HTML'), quelltext.indexOf('function sicherheitsheader'));
const route = quelltext.slice(quelltext.indexOf('// WP9: Schritt 6 — Abschluss'), quelltext.indexOf('    markiereAlsFertig(n);', quelltext.indexOf('// WP9: Schritt 6 — Abschluss')));
assert.match(route, /const lang = sprache\(\)/);
assert.match(route, /abschlussSeite\(lang, true, hinweise\)/);
assert.match(route, /abschlussSeite\(lang, false, hinweise\)/);
assert.doesNotMatch(route, /'hu'/);
assert.ok(route.indexOf("db.exec('COMMIT')") < route.indexOf('hinweise = abschlussPruefungen'));
assert.match(route, /try \{\s*hinweise = abschlussPruefungen/);
assert.doesNotMatch(funktion, /\/health/);
let count = 0;
for (const lang of ['de', 'en', 'hu']) {
  const HU = JSON.parse(readFileSync(`texte/${lang}.json`, 'utf8').replace(/^\uFEFF/, ''));
  for (const k of ['erfolg_titel','erfolg_text','shop','kurs','marke','offen']) assert.ok(HU['assistent_abschluss_'+k]);
  for (const automatisch of [true, false]) for (const mitHinweis of [true, false]) {
    const context = vm.createContext({ HU, kopf: (titel, l) => `<html lang="${l}"><title>${titel}</title>`, fuss: () => '</html>' });
    vm.runInContext(escaping + funktion, context);
    const items = [{pflicht: true, status: 'hinweis', grund: 'g1a_mail'}, {pflicht: false, status: 'ok', grund: 'g1a_zahlung'}];
    if (mitHinweis) items.push({pflicht: false, status: 'hinweis', grund: 'g1a_logo', korrekturLink: '/admin/einrichtung/schritt/1'});
    context.items = items;
    const html = vm.runInContext(`abschlussSeite('${lang}', ${automatisch}, items)`, context);
    assert.ok(html.includes(`<h1>${HU.assistent_abschluss_erfolg_titel}</h1>`));
    assert.ok(html.includes(`href="/">${HU.assistent_abschluss_shop}</a>`));
    assert.equal((html.match(/href="\/admin\/"/g) || []).length, 2);
    assert.equal(html.includes('<h2>'), mitHinweis);
    if (mitHinweis) assert.ok(html.includes(HU.assistent_abschluss_offen));
    assert.match(html, /id="abschluss-aktionen"[^>]* hidden/);
    const statusId = automatisch ? 'neustart-status' : 'poll-status';
    assert.match(html, new RegExp(`id="${statusId}"`));
    if (automatisch) assert.doesNotMatch(html, /id="poll-status"/);
    assert.match(html, /id="neustart-anleitung"/);
    assert.doesNotMatch(html, /\/admin\/einrichtung\/schritt\//);
    const nodes = {[statusId]: {textContent: ''}, 'neustart-anleitung': {hidden:false}, 'abschluss-aktionen': {hidden:true}};
    let pending, timeouts = 0;
    let antwort = {ok: false, typ: 'text/html'};
    const urls = [];
    context.document = {getElementById: id => nodes[id]};
    context.setTimeout = f => {pending = f; timeouts++;};
    context.fetch = async (url) => {urls.push(url); return {ok: antwort.ok, headers: {get: () => antwort.typ}};};
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    // 404 im alten Einrichtungsprozess: nicht bereit
    pending(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['abschluss-aktionen'].hidden, true);
    // 200 aber HTML (Auffangseite des alten Prozesses): nicht bereit (F-286)
    antwort = {ok: true, typ: 'text/html; charset=utf-8'}; pending(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['abschluss-aktionen'].hidden, true);
    // 200 JSON aus dem Normalbetrieb: bereit
    antwort = {ok: true, typ: 'application/json; charset=utf-8'}; pending(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(nodes['abschluss-aktionen'].hidden, false);
    assert.equal(nodes['neustart-anleitung'].hidden, true);
    assert.equal(nodes[statusId].textContent, HU.assistent_abschluss_neustart_fertig);
    assert.ok(urls.every(u => u === '/api/kurse'), 'nur /api/kurse, nie /health');
    // begrenzte Versuche: nach 150 Aufrufen keine weitere Planung
    const ctx2 = vm.createContext({ HU, kopf: (t, l) => '', fuss: () => '' }); vm.runInContext(escaping + funktion, ctx2);
    const h2 = vm.runInContext(`abschlussSeite('${lang}', ${automatisch}, [])`, ctx2);
    let geplant = 0, p2; ctx2.document = {getElementById: id => nodes[id]}; ctx2.setTimeout = f => {p2 = f; geplant++;}; ctx2.fetch = async () => ({ok: false, headers: {get: () => ''}});
    vm.runInContext(h2.match(/<script>([\s\S]*?)<\/script>/)[1], ctx2);
    for (let i = 0; i < 200 && p2; i++) { const f = p2; p2 = null; f(); await new Promise(resolve => setImmediate(resolve)); }
    assert.ok(geplant <= 152, 'Polling endet nach begrenzten Versuchen: ' + geplant);
    HU.g1a_logo = '<img src=x onerror="alert(1)">';
    HU.assistent_abschluss_neustart_fertig = "</script><script>alert('x')</script>";
    const escaped = vm.runInContext(`abschlussSeite('${lang}', true, [{pflicht:false,status:'hinweis',grund:'g1a_logo'}])`, context);
    assert.ok(escaped.includes('&lt;img'));
    assert.equal((escaped.match(/<script>/g)||[]).length, 1);
    assert.doesNotMatch(escaped, /innerHTML/);
    count++;
  }
}
console.log(`OK E6: ${count} Seitenvarianten, Sitzungssprache, Hinweise, Escaping und Polling.`);
