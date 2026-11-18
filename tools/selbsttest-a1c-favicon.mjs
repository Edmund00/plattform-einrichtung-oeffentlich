// A1c: Favicon aus Marken-Logo — seiteMitSprache, /favicon.svg-Route, markeNeuLaden DOM-Update.
import './test-sprache.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ordner = mkdtempSync(join(tmpdir(), 'pe-a1c-'));
const DB_PFAD = join(ordner, 'test.db');
process.env.DB_DATEI = DB_PFAD;

const LOGO_PFAD = join(ordner, 'marke', 'logo.png');
const warte = ms => new Promise(r => setTimeout(r, ms));
let ok = 0, schlecht = 0;
const pruefe = (name, wert, detail = '') => {
  wert ? ok++ : schlecht++;
  console.log((wert ? 'OK     ' : 'FEHLER ') + name + (!wert && detail ? '  -> ' + String(detail).slice(0, 220) : ''));
};
const lies = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

function minPng() {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000400000004008000000008f022e020000002449444154edd08100000000c3a0f953dfe004855061c0800103060c183060c0800103060c18f80303097e9ae90000000049454e44ae426082', 'hex');
}
function altPng() {
  return Buffer.from('89504e470d0a1a0a0000000d4948445200000080000000800800000000e6553e170000005949444154789cedce21010000000220a73bdd191658407a160101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101817760bc0401e15dd421b70000000049454e44ae426082', 'hex');
}

const attrappe = {
  webhooks: { constructEventAsync: async () => { throw new Error('nie'); } },
  customers: { create: async () => ({ id: 'cus_x' }) },
  checkout: { sessions: { create: async () => ({ id: 'cs_x', url: 'https://example.com/', status: 'open' }), list: async () => ({ data: [] }) } },
};

const { erstelleServer } = await import('../app.mjs');
const { passwortHashen } = await import('../auth.mjs');
const { setzePlattform, setzeLogoPfad } = await import('../marke.mjs');
const { db } = await import('../db.mjs');

const ph = await passwortHashen('Pass12345');
db.prepare("INSERT INTO benutzer(email,passwort_hash,rolle,erstellt) VALUES(?,?,?,?)").run('fav@example.com', ph, 'admin', new Date().toISOString());

const alleServer = [];
function startServer(opts = {}) {
  const app = erstelleServer({ stripe: attrappe, webhookSecret: 'test', base: 'http://localhost', nodeEnv: 'test', dbDatei: DB_PFAD, ...opts });
  const s = app.listen(0, '127.0.0.1');
  alleServer.push(s);
  return new Promise((res, rej) => { s.once('listening', () => res(s)); s.once('error', rej); });
}
async function holen(port, pfad, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${pfad}`, { headers: opts.headers || {} });
  const ct = r.headers.get('content-type') || '';
  const isText = ct.includes('text') || ct.includes('svg') || ct.includes('json') || ct.includes('html');
  const text = isText ? await r.text() : null;
  const buf = isText ? null : Buffer.from(await r.arrayBuffer());
  return { status: r.status, ct, text, buf };
}
function ikonHref(html) {
  const m = /<link[^>]*rel="icon"[^>]*href="([^"]*)"/.exec(html) || /<link[^>]*href="([^"]*)"[^>]*rel="icon"/.exec(html);
  return m ? m[1] : null;
}
function ikonType(html) {
  const m = /<link[^>]*rel="icon"[^>]*type="([^"]*)"/.exec(html) || /<link[^>]*type="([^"]*)"[^>]*rel="icon"/.exec(html);
  return m ? m[1] : null;
}
function ikonAnzahl(html) {
  return (html.match(/<link[^>]*rel="icon"/g) || []).length;
}

try {
  // ======== A) Statische Code-Prüfung: texte.mjs, marke.mjs, admin.js =================
  const texteCode = lies('texte.mjs');
  const markeCode = lies('marke.mjs');
  const adminCode = lies('public/admin/admin.js');

  pruefe('texte.mjs: seiteMitSprache ersetzt <link rel="icon">', texteCode.includes('rel="icon"') || texteCode.includes("rel='icon'"));
  pruefe('texte.mjs: logoPfade() aufgerufen um Favicon zu bestimmen', texteCode.includes('logoPfade()'));
  pruefe('texte.mjs: PNG-Fall: type image/png, href /marke/logo.png', texteCode.includes('image/png') && texteCode.includes('/marke/logo.png'));
  pruefe('marke.mjs: /favicon.svg Route vorhanden', markeCode.includes('/favicon.svg'));
  pruefe('marke.mjs: /favicon.svg liefert SVG mit Initiale bei eigenem Namen', markeCode.includes('/favicon.svg') && markeCode.includes('textLogoSvg'));
  pruefe('admin.js: markeNeuLaden aktualisiert <link rel="icon"> im DOM', adminCode.includes('rel~="icon"') || adminCode.includes('link[rel') && adminCode.includes('icon'));

  // ======== B) Server: Standardname ohne Logo — Fallback bit-gleich =====================
  const s1 = await startServer();
  const port1 = s1.address().port;
  await warte(200);

  const r1index = await holen(port1, '/');
  const r1admin = await holen(port1, '/admin/');
  const href1i = ikonHref(r1index.text || '');
  const href1a = ikonHref(r1admin.text || '');
  pruefe('C: Standardname ohne PNG — GET / enthält <link rel="icon" ... href="/favicon.svg">', href1i === '/favicon.svg', `href: ${href1i}`);
  pruefe('C: Standardname ohne PNG — GET /admin/ enthält <link rel="icon" ... href="/favicon.svg">', href1a === '/favicon.svg', `href: ${href1a}`);
  pruefe('C: Standardname ohne PNG — type image/svg+xml', ikonType(r1index.text || '') === 'image/svg+xml', ikonType(r1index.text || ''));
  pruefe('C: Standardname ohne PNG — /favicon.svg = statische Bytes', (await holen(port1, '/favicon.svg')).status === 200, '');
  const favStatisch = await holen(port1, '/favicon.svg');
  const favDatei = readFileSync(new URL('../public/favicon.svg', import.meta.url));
  pruefe('C: Standardname — /favicon.svg liefert identische Bytes wie public/favicon.svg', favStatisch.text !== null && Buffer.from(favStatisch.text).equals(favDatei), `length: ${favStatisch.text?.length}`);

  // ======== C) Server: Eigener Name ohne Logo — /favicon.svg dynamisch ==================
  setzePlattform('Testplattform');
  const r2index = await holen(port1, '/');
  const href2 = ikonHref(r2index.text || '');
  pruefe('B: Eigener Name ohne PNG — /favicon.svg hat Query-String', href2 !== null && href2.startsWith('/favicon.svg?'), `href: ${href2}`);
  pruefe('B: Eigener Name ohne PNG — type image/svg+xml', ikonType(r2index.text || '') === 'image/svg+xml', ikonType(r2index.text || ''));
  pruefe('B: /favicon.svg liefert 200 image/svg+xml', (await holen(port1, '/favicon.svg')).status === 200, '');
  const fav2 = await holen(port1, '/favicon.svg');
  pruefe('B: /favicon.svg liefert SVG', fav2.ct.includes('svg'), fav2.ct);
  pruefe('B: /favicon.svg enthält Initiale des Namens', fav2.text !== null && fav2.text.includes('T'), `body: ${fav2.text?.slice(0, 100)}`);
  pruefe('B: /favicon.svg kein name_fix Leck (name= in URL)', !(href2 || '').includes('name='), href2);
  // B2 (Chef, Opus A1c): Umbenennung A -> B mit GLEICHER Laenge muss eine NEUE Favicon-Adresse ergeben (Browser-Favicon-Cache arbeitet pro Adresse)
  setzePlattform('Aaaa Akademie');
  const hrefA = ikonHref((await holen(port1, '/')).text || '');
  const svgA = (await holen(port1, '/favicon.svg')).text || '';
  setzePlattform('Bbbb Akademie');
  const hrefB = ikonHref((await holen(port1, '/')).text || '');
  const svgB = (await holen(port1, '/favicon.svg')).text || '';
  pruefe('B2: gleiche Namenslaenge, neuer Name -> andere Favicon-Adresse', hrefA !== null && hrefB !== null && hrefA !== hrefB, `A: ${hrefA} B: ${hrefB}`);
  pruefe('B2: Favicon-Adresse haengt nur vom Namen ab (gleicher Name -> gleiche Adresse)', (() => { setzePlattform('Aaaa Akademie'); return true; })() && ikonHref((await holen(port1, '/')).text || '') === hrefA, hrefA);
  pruefe('B2: SVG A zeigt Initiale A und Namen A, SVG B zeigt B', /aria-label="Aaaa Akademie"[^>]*>.*>A<\/text>/.test(svgA) && /aria-label="Bbbb Akademie"[^>]*>.*>B<\/text>/.test(svgB), `${svgA.slice(0, 120)} | ${svgB.slice(0, 120)}`);
  setzePlattform('Testplattform');

  // Name mit Ampersand wird von pruefePlattformName abgelehnt — korrekte Absicherung:
  const { pruefePlattformName } = await import('../marke.mjs');
  pruefe('B: Namen mit & werden von pruefePlattformName abgelehnt (kein XSS möglich)', pruefePlattformName('Test & Co') !== null);

  // ======== D) Server: Gültiges PNG-Logo — /favicon.svg → PNG-Favicon ===================
  mkdirSync(join(ordner, 'marke'), { recursive: true });
  writeFileSync(LOGO_PFAD, minPng());
  setzeLogoPfad(LOGO_PFAD);
  setzePlattform('Testplattform');

  // Gleiche Server-Instanz, aber logoPfade() sieht jetzt das Logo
  const r3index = await holen(port1, '/');
  const href3 = ikonHref(r3index.text || '');
  pruefe('A: PNG-Logo — href beginnt mit /marke/logo.png?v=', href3 !== null && href3.startsWith('/marke/logo.png?v='), `href: ${href3}`);
  pruefe('A: PNG-Logo — type image/png', ikonType(r3index.text || '') === 'image/png', ikonType(r3index.text || ''));
  pruefe('A: PNG-Logo — genau 1 <link rel="icon"> in GET /', ikonAnzahl(r3index.text || '') === 1, `anzahl: ${ikonAnzahl(r3index.text || '')}`);
  const r3admin = await holen(port1, '/admin/');
  pruefe('A: PNG-Logo — genau 1 <link rel="icon"> in GET /admin/', ikonAnzahl(r3admin.text || '') === 1, `anzahl: ${ikonAnzahl(r3admin.text || '')}`);
  pruefe('A: PNG-Logo — href auf / und /admin/ übereinstimmend', ikonHref(r3index.text || '') === ikonHref(r3admin.text || ''), `i:${href3} a:${ikonHref(r3admin.text || '')}`);
  // GET der icon-URL direkt
  const faviconPng = await holen(port1, href3 || '/marke/logo.png');
  pruefe('A: GET favicon-URL → 200 image/png', faviconPng.status === 200 && faviconPng.ct.includes('png'), `status:${faviconPng.status} ct:${faviconPng.ct}`);

  // ======== E) Logo wechseln → v= ändert sich ==========================================
  await warte(10);
  // Zweite PNG-Datei mit anderer Größe schreiben
  const jetzt = Date.now();
  writeFileSync(LOGO_PFAD, altPng());
  utimesSync(LOGO_PFAD, new Date(jetzt + 5000), new Date(jetzt + 5000));
  setzeLogoPfad(LOGO_PFAD); // Cache invalidieren
  const r4index = await holen(port1, '/');
  const href4 = ikonHref(r4index.text || '');
  pruefe('D: Logo-Wechsel → href v= ändert sich', href4 !== null && href4 !== href3, `alt:${href3} neu:${href4}`);

  // ======== F) Logo entfernen → Rückfall ================================================
  unlinkSync(LOGO_PFAD);
  setzeLogoPfad(LOGO_PFAD); // Cache invalidieren
  const r5index = await holen(port1, '/');
  const href5 = ikonHref(r5index.text || '');
  pruefe('E: Logo entfernt → kein /marke/logo.png mehr im href', href5 !== null && !href5.startsWith('/marke/logo.png'), `href: ${href5}`);
  pruefe('E: Logo entfernt → /favicon.svg (eigener Name)', href5 !== null && href5.startsWith('/favicon.svg'), `href: ${href5}`);
  pruefe('E: Logo entfernt → /favicon.svg → 200', (await holen(port1, '/favicon.svg')).status === 200, '');

  // ======== G) Zweiter Fetch ohne Cookie → gleiche Marke ================================
  setzePlattform('Nochmaltest');
  mkdirSync(join(ordner, 'marke'), { recursive: true });
  writeFileSync(LOGO_PFAD, minPng());
  setzeLogoPfad(LOGO_PFAD);
  const rG1 = await holen(port1, '/');
  const rG2 = await holen(port1, '/', { headers: { 'Cache-Control': 'no-cache' } });
  pruefe('G: Zweiter Fetch ohne Cookie/Cache — gleicher Favicon-href', ikonHref(rG1.text || '') === ikonHref(rG2.text || ''), `r1:${ikonHref(rG1.text||'')} r2:${ikonHref(rG2.text||'')}`);

  // ======== H) Neustart (neuer Server, gleiche DB + Datei) ==============================
  // Name in DB speichern
  db.prepare("INSERT OR REPLACE INTO marke(schluessel,wert,aktualisiert_am) VALUES('name',?,datetime('now'))").run('RestartTest');

  // Statt echtem Neustart: neuen Server mit gleicher DB starten
  const { setzePlattform: sp2 } = await import('../marke.mjs');
  sp2('Musterakademie'); // Reset auf Standard (wie beim Start)
  const s2 = await startServer();
  const port2 = s2.address().port;
  await warte(200);

  const r6index = await holen(port2, '/');
  const href6 = ikonHref(r6index.text || '');
  pruefe('F: Neustart — Name aus DB geladen → Titel enthält "RestartTest"', (r6index.text || '').includes('RestartTest'), `title: ${(/<title>([^<]*)<\/title>/.exec(r6index.text || '') || [])[1]}`);
  pruefe('F: Neustart — Logo noch vorhanden → Favicon href /marke/logo.png', href6 !== null && href6.startsWith('/marke/logo.png?v='), `href: ${href6}`);

  // ======== I) admin.js: markeNeuLaden setzt <link rel="icon"> =========================
  pruefe('I: admin.js markeNeuLaden — setzt link[rel~="icon"] href',
    adminCode.includes('link[rel') && adminCode.includes('icon') &&
    (adminCode.includes("querySelector('link[rel") || adminCode.includes('querySelector("link[rel')));
  pruefe('I: admin.js markeNeuLaden — unterscheidet PNG-Logo und SVG-Fallback',
    adminCode.includes('/marke/logo.png') && adminCode.includes('/favicon.svg'));
  pruefe('I: admin.js markeNeuLaden — kein innerHTML', !adminCode.slice(adminCode.indexOf('async function markeNeuLaden'), adminCode.indexOf('async function markeBereich')).includes('innerHTML'));

} finally {
  for (const s of alleServer) await new Promise(r => s.close(r));
  try { rmSync(ordner, { recursive: true, force: true }); } catch {}
  console.log(`\nErgebnis: ${ok} OK, ${schlecht} FEHLER`);
  if (schlecht > 0) process.exit(1);
}
