// Automatischer Selbsttest für Scheibe 2: Admin-Skript, Registrierung ohne Admin, ungarische Texte, /admin-Seite, Preis-Umrechnung
// und der Ablauf "Admin legt Kurs an, veröffentlicht, Kunde sieht ihn" nur über die API (kein Browser).
// Eigene Test-Datenbank, Port 4403, keine Stripe-Schlüssel nötig. Aufruf: tools\Selbsttest-Admin.ps1
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PORT = 4403;
const BASE = `http://localhost:${PORT}`;
mkdirSync('daten', { recursive: true });
const lauf = Date.now();
const DB = `daten/selbsttest-admin-${lauf}.db`;
const HU = JSON.parse(readFileSync('texte/hu.json', 'utf8'));
const pw = 'Geheim-Passwort-123';
const mailAdmin = `Admin.${lauf}@Example.com`;
const mailWannabe = `wannabe.${lauf}@example.com`;

let ok = 0, schlecht = 0;
const pruefe = (name, bedingung, detail = '') => { bedingung ? ok++ : schlecht++; console.log(`${bedingung ? 'OK     ' : 'FEHLER '} ${name}${!bedingung && detail ? '  -> ' + detail : ''}`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const aufraeumen = () => { for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch (e) { if (!['EPERM', 'EBUSY'].includes(e.code)) throw e; } } }; // Windows: Datei kann noch gesperrt sein
const db = () => new DatabaseSync(DB);

function skript(args, env = {}) {
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', ...args], {
    env: { ...process.env, DB_DATEI: DB, ADMIN_PASSWORT: '', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const ausgabe = (r) => (r.stdout || '') + (r.stderr || '');

function client() {
  let cookie = '';
  return {
    async anfrage(methode, pfad, body, kopf = {}) {
      const r = await fetch(BASE + pfad, { method: methode, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...kopf }, body: body !== undefined ? JSON.stringify(body) : undefined });
      const sc = r.headers.get('set-cookie');
      if (sc) { const roh = sc.split(';')[0]; cookie = roh.endsWith('=') ? '' : roh; }
      let d = {}; try { d = await r.json(); } catch (e) {}
      return { s: r.status, d };
    },
  };
}
const rohAnfrage = (pfad) => new Promise((erfuellt, fehlschlag) => {
  const r = request({ host: '127.0.0.1', port: PORT, path: pfad, method: 'GET' }, (a) => { let t = ''; a.on('data', (x) => { t += x; }); a.on('end', () => erfuellt({ s: a.statusCode, kopf: a.headers, text: t })); });
  r.on('error', fehlschlag); r.end();
});

let server;
try {
  // =================================================================================================
  console.log('--- Admin-Skript (tools/admin-anlegen.mjs)');
  const r1 = skript([mailAdmin], { ADMIN_PASSWORT: pw });
  pruefe('Neuer Admin: Ausgabe ist genau "Admin angelegt"', r1.status === 0 && r1.stdout.trim() === 'Admin angelegt' && !(r1.stderr || '').trim(), ausgabe(r1));
  pruefe('Passwort kommt in der Ausgabe nie vor', !ausgabe(r1).includes(pw));
  let d = db();
  const admin1 = d.prepare('SELECT email, rolle, passwort_hash FROM benutzer WHERE email = ?').get(mailAdmin.toLowerCase());
  d.close();
  pruefe('Datenbank: Benutzer hat Rolle "admin", E-Mail klein geschrieben', admin1?.rolle === 'admin', JSON.stringify(admin1));
  pruefe('Passwort ist als scrypt-Hash gespeichert, nicht im Klartext', admin1?.passwort_hash.startsWith('scrypt$') && !admin1.passwort_hash.includes(pw));

  const r2 = skript([mailAdmin]); // ohne Passwort, ohne Terminal: kein Anlegen nötig, da vorhanden -> nur Hochstufen
  pruefe('Vorhandener Admin nochmal: "Admin hochgestuft", Passwort wird nicht gebraucht', r2.status === 0 && r2.stdout.trim() === 'Admin hochgestuft', ausgabe(r2));

  // M1: Vorab-Registrierung der Admin-Adresse durch Fremde darf keine Übernahme ermöglichen.
  const vorab = `vorab.${lauf}@example.com`;
  d = db();
  d.prepare("INSERT INTO benutzer (email, passwort_hash, rolle, erstellt, email_bestaetigt) VALUES (?, 'scrypt$angreifer', 'kunde', ?, ?)").run(vorab, new Date().toISOString(), Date.now());
  const vorabId = d.prepare('SELECT id FROM benutzer WHERE email = ?').get(vorab).id;
  d.prepare('INSERT INTO sitzungen (token_hash, benutzer_id, laeuft_ab) VALUES (?, ?, ?)').run('angreifer-sitzung-' + lauf, vorabId, Date.now() + 3600000);
  d.prepare('INSERT INTO passwort_token (benutzer_id, token_hash, erstellt, laeuft_ab) VALUES (?, ?, ?, ?)').run(vorabId, 'angreifer-reset-' + lauf, Date.now(), Date.now() + 3600000);
  d.close();
  const m1a = skript([vorab]); // ohne Passwort: darf NICHT hochstufen
  d = db();
  const nachA = d.prepare('SELECT rolle, passwort_hash FROM benutzer WHERE id = ?').get(vorabId); d.close();
  pruefe('M1: Hochstufen eines bestehenden Kundenkontos ohne neues Passwort bricht ab, Rolle und Hash unverändert', m1a.status !== 0 && nachA.rolle === 'kunde' && nachA.passwort_hash === 'scrypt$angreifer', ausgabe(m1a));
  const m1b = skript([vorab], { ADMIN_PASSWORT: pw });
  d = db();
  const nachB = d.prepare('SELECT rolle, passwort_hash FROM benutzer WHERE id = ?').get(vorabId);
  const reste = d.prepare('SELECT (SELECT COUNT(*) FROM sitzungen WHERE benutzer_id = ?) + (SELECT COUNT(*) FROM passwort_token WHERE benutzer_id = ?) AS n').get(vorabId, vorabId).n; d.close();
  pruefe('M1: Mit Passwort wird hochgestuft, der alte Hash ersetzt, Sitzungen und Reset-Links des Kontos gelöscht',
    m1b.status === 0 && m1b.stdout.trim() === 'Admin hochgestuft' && nachB.rolle === 'admin' && nachB.passwort_hash.startsWith('scrypt$') && nachB.passwort_hash !== 'scrypt$angreifer' && reste === 0 && !ausgabe(m1b).includes(pw), ausgabe(m1b) + ' reste=' + reste);

  d = db(); d.prepare('DELETE FROM benutzer WHERE id = ?').run(vorabId); d.close();

  const r3 = skript([`neu.${lauf}@example.com`]); // neuer Benutzer, aber kein Passwort und kein Terminal
  pruefe('Neuer Benutzer ohne Passwort (kein Terminal): Abbruch, nichts angelegt', r3.status !== 0 && !(r3.stdout || '').trim(), ausgabe(r3));
  d = db(); pruefe('... und der Benutzer existiert nicht', !d.prepare('SELECT 1 FROM benutzer WHERE email = ?').get(`neu.${lauf}@example.com`)); d.close();

  const r4 = skript([`kurz.${lauf}@example.com`], { ADMIN_PASSWORT: 'Ab1!' });
  d = db();
  pruefe('Zu kurzes Passwort: Abbruch, nichts angelegt, Passwort nicht ausgegeben', r4.status !== 0 && !ausgabe(r4).includes('Ab1!') && !(r4.stdout || '').trim()
    && !d.prepare('SELECT 1 FROM benutzer WHERE email = ?').get(`kurz.${lauf}@example.com`), ausgabe(r4));
  d.close();

  const r5 = skript([`argv.${lauf}@example.com`, pw]);
  d = db();
  pruefe('Passwort auf der Kommandozeile wird NICHT angenommen (Abbruch, nichts angelegt, nicht ausgegeben)', r5.status !== 0 && !ausgabe(r5).includes(pw) && !d.prepare('SELECT 1 FROM benutzer WHERE email = ?').get(`argv.${lauf}@example.com`), ausgabe(r5));
  d.close();
  const r6 = skript(['keine-mail'], { ADMIN_PASSWORT: pw });
  pruefe('Ungültige E-Mail: Abbruch', r6.status !== 0 && !(r6.stdout || '').trim(), ausgabe(r6));
  const r7 = skript([], { ADMIN_PASSWORT: pw });
  pruefe('Ohne E-Mail: Abbruch mit Hinweis, Passwort nicht ausgegeben', r7.status !== 0 && !ausgabe(r7).includes(pw));

  // =================================================================================================
  console.log('--- Server starten (ADMIN_EMAIL und ADMIN_PASSWORT sind gesetzt, dürfen aber nichts bewirken)');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/testserver-kurse.mjs'], {
    env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_DATEI: DB, ADMIN_EMAIL: mailWannabe, ADMIN_PASSWORT: pw }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (x) => { serverLog += x; });
  server.stderr.on('data', (x) => { serverLog += x; });
  for (let i = 0; i < 40 && !/Kurs-Testserver läuft/.test(serverLog); i++) await warte(250);
  if (!/Kurs-Testserver läuft/.test(serverLog)) { console.log('Server nicht gestartet:\n' + serverLog); throw new Error('Server nicht gestartet'); }

  // =================================================================================================
  console.log('--- Registrierung vergibt nie Admin');
  const wannabe = client();
  pruefe('ADMIN_EMAIL registriert sich: 201', (await wannabe.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailWannabe, passwort: pw })).s === 201);
  pruefe('... ist trotzdem "kunde" (API)', (await wannabe.anfrage('GET', '/api/ich')).d.rolle === 'kunde');
  pruefe('... und kein Admin-Zugriff: 403', (await wannabe.anfrage('GET', '/api/admin/kurse')).s === 403);
  const extra = client();
  const mailExtra = `extra.${lauf}@example.com`;
  await extra.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailExtra, passwort: pw, rolle: 'admin', role: 'admin', istAdmin: true, admin: true });
  pruefe('Mitgeschickte Felder "rolle", "role", "admin" ändern nichts', (await extra.anfrage('GET', '/api/ich')).d.rolle === 'kunde');
  // Der Admin (per Skript angelegt, mit anderer Schreibweise der E-Mail) kann sich nicht erneut registrieren
  pruefe('Der Admin-E-Mail-Adresse kann man sich nicht erneut registrieren: 409', (await client().anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailAdmin, passwort: 'ganz-anderes-pw-1' })).s === 409);
  d = db();
  const admins = d.prepare("SELECT email FROM benutzer WHERE rolle = 'admin'").all().map((x) => x.email);
  d.close();
  pruefe('Datenbank: nur der Skript-Admin ist Admin', admins.length === 1 && admins[0] === mailAdmin.toLowerCase(), JSON.stringify(admins));

  console.log('--- Vorhandenen Benutzer hochstufen');
  const r8 = skript([mailExtra], { ADMIN_PASSWORT: pw }); // seit M1 braucht das Hochstufen ein (neues) Passwort
  pruefe('Hochstufen: genau "Admin hochgestuft"', r8.status === 0 && r8.stdout.trim() === 'Admin hochgestuft', ausgabe(r8));
  d = db(); const nachHoch = d.prepare('SELECT rolle, passwort_hash FROM benutzer WHERE email = ?').get(mailExtra); d.close();
  pruefe('Rolle ist jetzt "admin"', nachHoch.rolle === 'admin');
  const extra2 = client();
  pruefe('Anmeldung mit dem beim Hochstufen gesetzten Passwort klappt', (await extra2.anfrage('POST', '/api/anmelden', { email: mailExtra, passwort: pw })).s === 200 && (await extra2.anfrage('GET', '/api/admin/kurse')).s === 200);

  // =================================================================================================
  console.log('--- Ungarische Fehlertexte (Code plus Text) in den Anmelde-Routen');
  const g = client();
  const fall = [
    ['Ungültige E-Mail', 'POST', '/api/registrieren', { zustimmung: true, email: 'keine-mail', passwort: pw }, 400, 'email_ungueltig'],
    ['Zu kurzes Passwort', 'POST', '/api/registrieren', { zustimmung: true, email: `a.${lauf}@example.com`, passwort: 'kurz' }, 400, 'passwort_zu_kurz'],
    ['Zu langes Passwort', 'POST', '/api/registrieren', { zustimmung: true, email: `a.${lauf}@example.com`, passwort: 'x'.repeat(201) }, 400, 'passwort_zu_lang'],
    ['E-Mail schon vergeben', 'POST', '/api/registrieren', { zustimmung: true, email: mailExtra, passwort: pw }, 409, 'email_vergeben'],
    ['Falsches Passwort', 'POST', '/api/anmelden', { email: mailExtra, passwort: 'falsch-falsch-1' }, 401, 'anmeldung_falsch'],
    ['Unbekannte E-Mail', 'POST', '/api/anmelden', { email: `gibtsnicht.${lauf}@example.com`, passwort: 'irgendwas-123' }, 401, 'anmeldung_falsch'],
    ['Anmeldung ohne Passwort', 'POST', '/api/anmelden', { email: mailExtra }, 400, 'anmeldung_falsch'],
    ['Fremde Herkunft', 'POST', '/api/abmelden', {}, 403, 'herkunft_fremd', { Origin: 'http://boese-seite.example' }],
  ];
  for (const [name, m, p, b, status, code, kopf] of fall) {
    const r = await g.anfrage(m, p, b, kopf);
    pruefe(`${name}: ${status} ${code} mit ungarischem Text`, r.s === status && r.d.fehler === code && r.d.text === HU[code] && /[áéíóöőúüű]/i.test(r.d.text), JSON.stringify(r));
  }
  const sperr = client(); const mailSperre = `sperre.${lauf}@example.com`;
  await sperr.anfrage('POST', '/api/registrieren', { zustimmung: true, email: mailSperre, passwort: pw });
  const sperr2 = client();
  for (let i = 0; i < 5; i++) await sperr2.anfrage('POST', '/api/anmelden', { email: mailSperre, passwort: 'falsch-falsch-1' });
  const gesperrt = await sperr2.anfrage('POST', '/api/anmelden', { email: mailSperre, passwort: pw });
  pruefe('Nach 5 Fehlversuchen: 429 zu_viele_versuche mit ungarischem Text', gesperrt.s === 429 && gesperrt.d.fehler === 'zu_viele_versuche' && gesperrt.d.text === HU.zu_viele_versuche, JSON.stringify(gesperrt));

  // Jeder im Quellcode verwendete Fehlercode hat einen ungarischen Text
  const quellen = ['server.mjs', 'app.mjs', 'zahlung.mjs', 'routes-auth.mjs', 'routes-kurse.mjs', 'auth.mjs'].map((f) => readFileSync(f, 'utf8')).join('\n');
  const codes = new Set([...quellen.matchAll(/fehler\(res, \d+, '([a-z_]+)'\)/g)].map((m) => m[1]));
  for (const c of ['passwort_zu_kurz', 'passwort_zu_lang']) if (quellen.includes(`'${c}'`)) codes.add(c);
  for (const c of PRUEFER_CODES(quellen)) codes.add(c);
  const fehlen = [...codes].filter((c) => typeof HU[c] !== 'string' || !HU[c].trim());
  pruefe(`Alle ${codes.size} im Code verwendeten Fehlercodes haben einen ungarischen Text`, codes.size > 20 && fehlen.length === 0, 'fehlt: ' + fehlen.join(', '));
  const deutschImCode = [...quellen.matchAll(/json\(\{ fehler: '([^']+)'/g)].map((m) => m[1]);
  pruefe('Keine festen (deutschen) Fehlertexte mehr in den Routen', deutschImCode.length === 0, deutschImCode.join(' | '));

  // =================================================================================================
  console.log('--- GET /api/texte');
  const tx = await fetch(BASE + '/api/texte');
  const txd = await tx.json();
  pruefe('/api/texte: 200, JSON, ohne Anmeldung erreichbar', tx.status === 200 && /application\/json/.test(tx.headers.get('content-type') || ''));
  pruefe('Enthält die Texte aus hu.json (Fehlercodes und Oberfläche)', Object.keys(HU).every((k) => txd[k] === String(HU[k]).split('{plattform}').join('Musterakademie')) &&   /* {plattform} = Standardname (Produktreife Block 2) */ Object.keys(txd).filter((k) => !k.startsWith('_')).length === Object.keys(HU).length && typeof txd.a_kesz === 'string' && typeof txd.nicht_angemeldet === 'string');
  pruefe('Jeder Text ist eine nicht leere Zeichenkette', Object.entries(txd).every(([k, v]) => k === '_banner' ? v === null || (typeof v === 'string' && v.trim() !== '') : k === '_hero' ? v === null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(f => ['titel', 'untertitel'].includes(f)) && typeof v.titel === 'string' && typeof v.untertitel === 'string') : typeof v === 'string' && v.trim() !== ''));

  // =================================================================================================
  console.log('--- /admin liefert HTML mit Sicherheits-Kopfzeilen');
  const adm = await fetch(BASE + '/admin/');
  const html = await adm.text();
  const ct = adm.headers.get('content-security-policy') || '';
  pruefe('/admin/: 200 und HTML', adm.status === 200 && /text\/html/.test(adm.headers.get('content-type') || '') && html.includes('<html lang="hu">'));
  pruefe('/admin ohne Schrägstrich kommt auch an (Weiterleitung oder direkt)', (await fetch(BASE + '/admin')).status === 200);
  pruefe("Content-Security-Policy mit default-src 'self'", ct.includes("default-src 'self'") && ct.includes("script-src 'self'") && ct.includes("frame-ancestors 'none'") && !/unsafe-inline|unsafe-eval|https?:\/\//.test(ct), ct);
  pruefe('X-Content-Type-Options: nosniff', adm.headers.get('x-content-type-options') === 'nosniff');
  pruefe('X-Frame-Options: DENY und Referrer-Policy', adm.headers.get('x-frame-options') === 'DENY' && adm.headers.get('referrer-policy') === 'no-referrer');
  for (const [datei, typ] of [['/admin/admin.js', /javascript/], ['/preis.js', /javascript/], ['/admin/admin.css', /text\/css/]]) {
    const a = await fetch(`${BASE}${datei}`);
    pruefe(`${datei}: 200, richtiger Typ, Kopfzeilen`, a.status === 200 && typ.test(a.headers.get('content-type') || '') && a.headers.get('x-content-type-options') === 'nosniff' && (a.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  }
  const raus = await rohAnfrage('/admin/%2e%2e/server.mjs');
  pruefe('Pfad nach oben aus /admin heraus liefert keinen Quellcode', raus.s !== 200 && !raus.text.includes("import express"), String(raus.s));
  pruefe('Bestehende Routen bleiben erreichbar (/api/kurse)', (await fetch(BASE + '/api/kurse')).status === 200);
  const api404 = await fetch(BASE + '/admin/gibtes-nicht.js');
  pruefe('Unbekannte Datei in /admin: 404', api404.status === 404);

  console.log('--- Admin-Dateien: keine festen Sätze, keine HTML-Einsetzung');
  const text = html.replace(/<title>[^<]*<\/title>/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]*>/g, '').trim();
  pruefe('index.html enthält als sichtbaren Text nur den festen ungarischen Notfalltext (Titel ungarisch, alles andere aus hu.json)', text === 'Az oldal most nem tölthető be. Kérlek, frissítsd az oldalt néhány perc múlva.A használathoz kapcsold be a JavaScriptet.' && /<title>[^<]+<\/title>/.test(html), text);
  pruefe('index.html: keine Inline-Skripte, keine Inline-Stile, keine Ereignis-Attribute', !/<script(?![^>]*\ssrc=)/i.test(html) && !/\sstyle=/i.test(html) && !/\son[a-z]+=/i.test(html));
  pruefe('Admin lädt lokale VALORE-Schriften und Favicon vor CSS',
    html.includes('href="/fonts/fonts.css"') && html.includes('href="admin.css"') &&
    html.indexOf('/fonts/fonts.css') < html.indexOf('admin.css') &&
    html.includes('href="/favicon.svg"') && html.includes('content="#000000"'));
  const adminCss = readFileSync('public/admin/admin.css', 'utf8');
  pruefe('Admin nutzt lokale VALORE-Kunden-Tokens, rote Ghost-Löschknöpfe und mobile Regeln',
    adminCss.includes("@import url('/kunde.css')") &&
    adminCss.includes('.knopf.rot') && adminCss.includes('prefers-reduced-motion') &&
    !/fonts\\.googleapis|fonts\\.gstatic/i.test(adminCss));
  const adminJs = readFileSync('public/admin/admin.js', 'utf8');
  pruefe('Admin-Kopf zeigt Muster-Logo und alle Entscheidungen bleiben per HU beschriftet',
    adminJs.includes('muster-logo.svg') && adminJs.includes("t('a_logo_alt')") &&
    adminJs.includes("class: 'knopf klein rot'") &&
    !adminJs.includes('setAttribute("style"') && !adminJs.includes("setAttribute('style'"));
  const preisJs = readFileSync('public/preis.js', 'utf8');
  const ohneKommentar = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const jsCode = ohneKommentar(adminJs) + '\n' + ohneKommentar(preisJs);
  pruefe('JS ohne Buchstaben mit Akzent oder Umlaut (also keine festen deutschen/ungarischen Wörter)', !/[À-ɏ]/.test(jsCode), (jsCode.match(/.{0,20}[À-ɏ].{0,20}/) || [''])[0]);
  const woerter = /\b(der|die|das|und|ist|nicht|bitte|für|mit|ein|eine|noch|kein|keine|fehler|hinzufügen|speichern|a|az|és|hogy|nem|egy|vagy|kérlek|mentés|hiba)\b/i;
  const literale = [...jsCode.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]).filter((x) => /[A-Za-z]{2,}/.test(x) && /\s/.test(x.trim()));
  const verdaechtig = literale.filter((x) => woerter.test(x));
  pruefe('Keine Zeichenkette im JS enthält deutsche oder ungarische Sätze', verdaechtig.length === 0, verdaechtig.join(' | '));
  pruefe('Kein innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setTimeout\s*\(\s*['"`]/.test(jsCode));
  const benutzt = new Set([...adminJs.matchAll(/\bt\('([a-z_0-9]+)'[,)]/g)].map((m) => m[1]));
  // Schlüssel, die als Zeichenkette an Hilfsfunktionen (bestaetigen, Tabellen) gehen, zählen ebenfalls als benutzt
  for (const m of adminJs.matchAll(/'(a_[a-z_0-9]+)'/g)) benutzt.add(m[1]);
  for (const a of ['text', 'video', 'pdf', 'audio', 'datei']) benutzt.add('art_' + a);
  for (const a of ['aktiv','zahlung_offen','gekuendigt','beendet']) benutzt.add('a_abo_status_' + a);
  benutzt.add('a_quelle_abo');
  const fehlenA = [...benutzt].filter((k) => typeof HU[k] !== 'string');
  pruefe(`Alle ${benutzt.size} im JS verwendeten Textschlüssel stehen in hu.json`, benutzt.size > 30 && fehlenA.length === 0, 'fehlt: ' + fehlenA.join(', '));
  const ungenutzt = Object.keys(HU).filter((k) => /^(a_|art_(text|video|pdf|audio|datei)$)/.test(k) && !benutzt.has(k));
  pruefe('Alle Oberflächentexte (a_..., art_...) werden auch benutzt', ungenutzt.length === 0, 'ungenutzt: ' + ungenutzt.join(', '));
  pruefe('Die Admin-Dateien laden nichts von außen (keine http-Adressen)', !/https?:\/\//.test(html + adminJs + preisJs + readFileSync('public/admin/admin.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
  pruefe('Nur erwartete Dateien in public/admin', readdirSync('public/admin').sort().join(',') === 'admin.css,admin.js,index.html');

  // =================================================================================================
  console.log('--- Preis: Forint <-> preis_cent');
  const { forintZuCent, centZuForint, formatForint, MAX_CENT } = await import(pathToFileURL(resolve('public/preis.js')).href);
  pruefe('39900 Forint -> 3990000', forintZuCent('39900') === 3990000);
  pruefe('"39 900" und mit geschütztem Leerzeichen -> 3990000', forintZuCent('39 900') === 3990000 && forintZuCent('39 900') === 3990000 && forintZuCent('  39900 ') === 3990000);
  pruefe('0 Forint -> 0', forintZuCent('0') === 0);
  pruefe('Ungültig -> null (leer, Text, negativ, Komma, Punkt, Hochkomma)', ['', '  ', 'abc', '-5', '12,5', '1.5', '1e5', '39900 Ft', '3\'000'].every((x) => forintZuCent(x) === null));
  pruefe('Zu groß -> null; Grenze 10 000 000 Forint ist erlaubt', forintZuCent('10000000') === MAX_CENT && forintZuCent('10000001') === null && forintZuCent('99999999999999999999') === null);
  pruefe('3990000 -> 39900', centZuForint(3990000) === 39900 && centZuForint(0) === 0 && centZuForint(-1) === null && centZuForint(1.5) === null);
  pruefe('Anzeige: 3990000 -> "39 900", 0 -> "0", 1000000000 -> "10 000 000"', formatForint(3990000) === '39 900' && formatForint(0) === '0' && formatForint(MAX_CENT) === '10 000 000');
  pruefe('Ganze Zahlen werden nicht verändert, auch bei krummem Wert gibt es keinen Absturz (4990 -> "49,90")', formatForint(4990) === '49,90' && formatForint(null) === '');
  const hin = [1, 500, 25000, 39900, 123456, 10000000];
  pruefe('Hin und zurück ergibt dieselbe Zahl', hin.every((f) => centZuForint(forintZuCent(String(f))) === f && forintZuCent(formatForint(f * 100)) === f * 100));

  // =================================================================================================
  console.log('--- Ablauf über die API (wie die Seite es tut): Admin legt Kurs an, Kunde sieht ihn');
  const gabi = client(), kunde = client(), gast = client();
  pruefe('Admin meldet sich an', (await gabi.anfrage('POST', '/api/anmelden', { email: mailAdmin, passwort: pw })).s === 200);
  pruefe('/api/ich zeigt Rolle "admin" (die Seite entscheidet daran)', (await gabi.anfrage('GET', '/api/ich')).d.rolle === 'admin');
  pruefe('Admin-Übersicht am Anfang leer', (await gabi.anfrage('GET', '/api/admin/kurse')).d.length === 0);
  const titelXss = '<img src=x onerror=alert(1)> Szín- és stílus';
  const neu = await gabi.anfrage('POST', '/api/admin/kurse', { titel: titelXss, beschreibung: 'Rövid leírás', preis_cent: forintZuCent('39 900'), waehrung: 'huf' });
  pruefe('Kurs mit 39 900 Forint angelegt: preis_cent 3990000, Währung huf, Entwurf', neu.s === 201 && neu.d.preis_cent === 3990000 && neu.d.waehrung === 'huf' && neu.d.status === 'entwurf', JSON.stringify(neu));
  pruefe('Titel kommt unverändert als Text zurück (wird von der Seite nur als Text eingesetzt)', neu.d.titel === titelXss);
  const kursId = neu.d.id;
  const ue1 = await gabi.anfrage('GET', '/api/admin/kurse');
  pruefe('Übersicht zeigt den Entwurf mit 0 Lektionen', ue1.d.length === 1 && ue1.d[0].id === kursId && ue1.d[0].status === 'entwurf' && ue1.d[0].lektionen === 0, JSON.stringify(ue1.d));
  const a = await gabi.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Első', abschnitt: '1. rész', art: 'text', inhalt: 'Titkos első szöveg' });
  const b = await gabi.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Második', abschnitt: '1. rész', art: 'video', inhalt: 'Titkos második' });
  const c = await gabi.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Harmadik', abschnitt: '2. rész', art: 'pdf', inhalt: 'Titkos harmadik' });
  pruefe('Drei Lektionen angelegt, Reihenfolge 1, 2, 3', [a, b, c].every((x) => x.s === 201) && [a, b, c].map((x) => x.d.reihenfolge).join() === '1,2,3', JSON.stringify([a.d, b.d, c.d]));
  // "Hoch/Runter": Seite nummeriert neu von 1 an. Hier: dritte Lektion nach oben (Reihenfolge Első, Harmadik, Második)
  for (const [lekt, nr] of [[a.d, 1], [c.d, 2], [b.d, 3]]) await gabi.anfrage('PATCH', `/api/admin/lektionen/${lekt.id}`, { reihenfolge: nr });
  const hide = await gabi.anfrage('PATCH', `/api/admin/lektionen/${b.d.id}`, { status: 'entwurf' });
  pruefe('Lektion ausblenden: 200, Status "entwurf"', hide.s === 200 && hide.d.status === 'entwurf');
  const adminKurs = await gabi.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Admin sieht neue Reihenfolge (Első, Harmadik, Második) mit Status, auch die ausgeblendete', adminKurs.d.lektionen.map((l) => l.titel).join('|') === 'Első|Harmadik|Második' && adminKurs.d.lektionen[2].status === 'entwurf', JSON.stringify(adminKurs.d.lektionen));
  pruefe('Übersicht zeigt jetzt 3 Lektionen', (await gabi.anfrage('GET', '/api/admin/kurse')).d[0].lektionen === 3);
  pruefe('Vor dem Veröffentlichen: Gast sieht den Kurs nicht', (await gast.anfrage('GET', '/api/kurse')).d.length === 0 && (await gast.anfrage('GET', `/api/kurse/${kursId}`)).s === 404);
  const pub = await gabi.anfrage('POST', `/api/admin/kurse/${kursId}/veroeffentlichen`, {});
  pruefe('"Kész": veröffentlichen klappt', pub.s === 200 && pub.d.status === 'veroeffentlicht');
  // Abnahme 01.11.2026 (Pruefrunde Fund 5): Loeschen prueft den Status der LEKTION, nicht den des Kurses
  const dLekt = await gabi.anfrage('POST', `/api/admin/kurse/${kursId}/lektionen`, { titel: 'Törlendő', abschnitt: '3. rész', art: 'text', inhalt: 'x' });
  await gabi.anfrage('PATCH', `/api/admin/lektionen/${dLekt.d.id}`, { status: 'entwurf' });
  const delPub = await gabi.anfrage('DELETE', `/api/admin/lektionen/${a.d.id}`);
  pruefe('Veroeffentlichte Lektion in veroeffentlichtem Kurs: Loeschen abgelehnt (409), verstecken statt loeschen', delPub.s === 409 && delPub.d.fehler === 'lektion_verstecken_statt_loeschen', JSON.stringify(delPub));
  const delEntwurf = await gabi.anfrage('DELETE', `/api/admin/lektionen/${dLekt.d.id}`);
  pruefe('Oberflaeche: Loeschknopf erscheint auch bei versteckter Lektion im veroeffentlichten Kurs', readFileSync('public/admin/admin.js', 'utf8').includes("(k.status === 'entwurf' || l.status !== 'veroeffentlicht') ? h('button'"));
  pruefe('Entwurfs-Lektion in veroeffentlichtem Kurs: Loeschen klappt (200)', delEntwurf.s === 200 && delEntwurf.d.geloescht === true, JSON.stringify(delEntwurf));
  await kunde.anfrage('POST', '/api/registrieren', { zustimmung: true, email: `kunde.${lauf}@example.com`, passwort: pw });
  const liste = await kunde.anfrage('GET', '/api/kurse');
  pruefe('Kunde sieht den Kurs in der Liste, mit Preis 3990000 huf', liste.d.length === 1 && liste.d[0].preis_cent === 3990000 && liste.d[0].waehrung === 'huf', JSON.stringify(liste.d));
  const kDetail = await kunde.anfrage('GET', `/api/kurse/${kursId}`);
  pruefe('Kunde sieht nur die 2 sichtbaren Lektionen als Titelliste (Első, Harmadik), ohne Inhalt', kDetail.d.lektionen.map((l) => l.titel).join('|') === 'Első|Harmadik' && !JSON.stringify(kDetail.d).includes('Titkos') && kDetail.d.zugang === false, JSON.stringify(kDetail.d));
  pruefe('Kunde sieht keine Admin-Felder (Status der Lektionen, Zeitstempel)', !('status' in kDetail.d) && kDetail.d.lektionen.every((l) => !('status' in l)));
  pruefe('Kunde darf nicht in die Admin-Übersicht: 403', (await kunde.anfrage('GET', '/api/admin/kurse')).s === 403);
  d = db();
  const kundeId = d.prepare('SELECT id FROM benutzer WHERE email = ?').get(`kunde.${lauf}@example.com`).id;
  d.prepare("INSERT INTO zugaenge (benutzer_id, kurs_id, quelle, erstellt) VALUES (?, ?, 'einladung', ?)").run(kundeId, kursId, new Date().toISOString());
  d.close();
  const kMit = await kunde.anfrage('GET', `/api/kurse/${kursId}`);
  // Gesamtpruefung F-04: der Text einer Lektion kommt nur ueber die Lektionsanfrage (?lektion=), die Kursseite selbst liefert keinen Text.
  const kMitTexte = (await Promise.all(kMit.d.lektionen.map(l => kunde.anfrage('GET', `/api/kurse/${kursId}?lektion=${l.id}`)))).map(r => JSON.stringify(r.d)).join(' ');
  pruefe('Mit Zugang sieht der Kunde die Inhalte der sichtbaren Lektionen (je Lektion), nicht der ausgeblendeten', kMit.d.zugang === true && !JSON.stringify(kMit.d).includes('Titkos') && kMitTexte.includes('Titkos első') && kMitTexte.includes('Titkos harmadik') && !kMitTexte.includes('Titkos második'));
  pruefe('Preis an der Obergrenze: 10 000 000 Forint wird angenommen, eine Cent-Einheit mehr nicht', (await gabi.anfrage('POST', '/api/admin/kurse', { titel: 'Max', preis_cent: forintZuCent('10000000'), waehrung: 'huf' })).s === 201
    && (await gabi.anfrage('POST', '/api/admin/kurse', { titel: 'Zu teuer', preis_cent: MAX_CENT + 100 })).d.fehler === 'preis_ungueltig');
  pruefe('Abmelden beendet die Sitzung: danach 401 in der Admin-Übersicht', (await gabi.anfrage('POST', '/api/abmelden', {})).s === 200 && (await gabi.anfrage('GET', '/api/admin/kurse')).s === 401);
} catch (e) {
  schlecht++; console.log('FEHLER  Unerwarteter Abbruch: ' + e.stack);
} finally {
  if (server) server.kill();
  await warte(500);
  aufraeumen();
  console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`);
  process.exit(schlecht === 0 ? 0 : 1);
}

// Codes, die die Prüfer in routes-kurse.mjs zurückgeben (nein('code')) und die Passwortregeln in auth.mjs
function PRUEFER_CODES(quelltext) {
  return [...quelltext.matchAll(/nein\('([a-z_]+)'\)/g)].map((m) => m[1]);
}
