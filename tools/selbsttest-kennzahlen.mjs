// Selbsttest GET /api/admin/kennzahlen: nur Admin, richtige Zahlen, keine personenbezogenen Daten. Eigene DB, Port 4405, keine Stripe-Schluessel.
import './test-sprache.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const PORT = 4405, BASE = `http://localhost:${PORT}`, lauf = Date.now(), DB = `daten/selbsttest-kennzahlen-${lauf}.db`, pw = 'Geheim-Passwort-123', admin = `kz.${lauf}@example.com`;
let ok = 0, schlecht = 0;
const pruefe = (n, b, d = '') => { b ? ok++ : schlecht++; console.log(`${b ? 'OK     ' : 'FEHLER '} ${n}${!b && d ? '  -> ' + d : ''}`); };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let server;
try {
  const a = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/admin-anlegen.mjs', admin], { env: { ...process.env, DB_DATEI: DB, ADMIN_PASSWORT: pw }, encoding: 'utf8' });
  pruefe('Admin angelegt', a.stdout.trim() === 'Admin angelegt', a.stdout + a.stderr);
  const d = new DatabaseSync(DB); const z = new Date().toISOString();
  d.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('K1','b',10000,'eur','veroeffentlicht',?,?)").run(z, z);
  d.prepare("INSERT INTO kurse (titel,beschreibung,preis_cent,waehrung,status,erstellt,geaendert) VALUES ('K2','b',5000,'eur','entwurf',?,?)").run(z, z);
  const kunde = (m) => { d.prepare("INSERT INTO benutzer (email,passwort_hash,rolle,erstellt,email_bestaetigt) VALUES (?, 'x','kunde',?,?)").run(m, z, Date.now()); return d.prepare('SELECT id FROM benutzer WHERE email=?').get(m).id; };
  const u1 = kunde(`geheim1.${lauf}@example.com`), u2 = kunde(`geheim2.${lauf}@example.com`);
  const best = (u, s, c, st, b) => d.prepare("INSERT INTO bestellungen (stripe_sitzung,benutzer_id,kurs_id,betrag,waehrung,art,status,erstellt,geaendert) VALUES (?,?,?,?,'eur','einmal',?,?,?)").run(s, u, 1, b, st, z, z);
  best(u1, 'cs_a' + lauf, 1, 'bezahlt', 10000); best(u2, 'cs_b' + lauf, 1, 'bezahlt', 2500); best(u2, 'cs_c' + lauf, 1, 'erstattet', 7000); best(u1, 'cs_d' + lauf, 1, 'pruefen', 100);
  d.prepare("INSERT INTO zugaenge (benutzer_id,kurs_id,quelle,erstellt) VALUES (?,1,'zahlung',?)").run(u1, Date.now());
  d.close();
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'tools/testserver-kurse.mjs'], { env: { ...process.env, PORT: String(PORT), BASE_URL: BASE, DB_DATEI: DB }, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/anbieter'); break; } catch { await warte(250); } }
  const anon = await fetch(BASE + '/api/admin/kennzahlen'); pruefe('Ohne Anmeldung: 401/403', anon.status === 401 || anon.status === 403, 'Status ' + anon.status);
  const li = await fetch(BASE + '/api/anmelden', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ email: admin, passwort: pw }) });
  const cookie = (li.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch(BASE + '/api/admin/kennzahlen', { headers: { Cookie: cookie } }); const t = await r.text(); let k = {}; try { k = JSON.parse(t); } catch { /* */ }
  pruefe('Als Admin: 200', r.status === 200, t.slice(0, 120));
  pruefe('Umsatz nur bezahlte (10000+2500 cent EUR)', k.umsatz?.length === 1 && k.umsatz[0].waehrung === 'eur' && k.umsatz[0].cent === 12500, JSON.stringify(k.umsatz));
  pruefe('Bestellungen = 2 bezahlte', k.bestellungen === 2, String(k.bestellungen));
  pruefe('Aktive Teilnehmer = 1', k.teilnehmer === 1, String(k.teilnehmer));
  pruefe('Erstattungen = 1', k.erstattungen === 1, String(k.erstattungen));
  pruefe('Offene Pruefungen = 1', k.offen === 1, String(k.offen));
  pruefe('Veroeffentlichte Kurse = 1 (Entwurf zaehlt nicht)', k.kurse === 1, String(k.kurse));
  pruefe('Keine personenbezogenen Daten (keine E-Mail, keine Namen)', !/@|geheim/i.test(t), t.slice(0, 160));
} finally {
  if (server) server.kill(); await warte(500);
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB + s, { force: true }); } catch { /* Windows */ } }
}
console.log(`\n${ok} bestanden, ${schlecht} fehlgeschlagen`); process.exit(schlecht ? 1 : 0);
