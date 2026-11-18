// Codex Lauf 10 (15.11.2026): Rehash nur wenn Hash unveraendert, Hash-Parameter nur aus fester Liste, begrenzte Parallelitaet,
// gleiche Pruefkosten fuer unbekannte Konten, Hauptschluesseldatei bei halb geschriebener Datei.
import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { passwortHashen, passwortPruefen, DUMMY_HASH } from '../auth.mjs';
import { erzeugeHauptschluesselDatei } from '../einstellungen.mjs';
const scrypt = promisify(scryptCb);
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0, fehler = 0;
const pruefe = (name, bed, info = '') => { if (bed) ok++; else { fehler++; console.log('FEHLER', name, info); } };
const zeit = async (f) => { const t = process.hrtime.bigint(); const r = await f(); return [r, Number(process.hrtime.bigint() - t) / 1e6]; };

// 1. Fremde/uebergrosse Parameter werden sofort abgelehnt (kein 1-GiB-scrypt)
const boese = 'scrypt$1048576$8$1$' + '11'.repeat(16) + '$' + '22'.repeat(64);
const [rb, tb] = await zeit(() => passwortPruefen('irgendwas', boese));
pruefe('Uebergrosses N wird abgelehnt', rb === false);
pruefe('Uebergrosses N wird schnell abgelehnt (<300 ms, nicht gerechnet)', tb < 300, Math.round(tb) + ' ms');
pruefe('r=64 wird abgelehnt', (await passwortPruefen('x', 'scrypt$131072$64$1$' + '11'.repeat(16) + '$' + '22'.repeat(64))) === false);
pruefe('Nicht-Hex im Hash wird abgelehnt', (await passwortPruefen('x', 'scrypt$131072$8$1$zz$yy')) === false);

// 2. Altes Format (16384) und neues Format funktionieren weiter
const salz = randomBytes(16);
const alt = 'scrypt$' + salz.toString('hex') + '$' + (await scrypt('Altes-Passwort-1!', salz, 64)).toString('hex');
pruefe('Altes Format (3 Teile) richtig -> true', (await passwortPruefen('Altes-Passwort-1!', alt)) === true);
pruefe('Altes Format falsch -> false', (await passwortPruefen('falsch', alt)) === false);
const neu = await passwortHashen('Neues-Passwort-2!');
pruefe('Neues Format hat N=131072,r=8,p=1', neu.startsWith('scrypt$131072$8$1$'));
pruefe('Neues Format richtig -> true', (await passwortPruefen('Neues-Passwort-2!', neu)) === true);
pruefe('Neues Format falsch -> false', (await passwortPruefen('nein', neu)) === false);

// 3. Gleichzeitige Pruefungen (Warteschlange, hoechstens 2 parallel) liefern alle das richtige Ergebnis
const parallel = await Promise.all([1, 2, 3, 4, 5].map(() => passwortPruefen('Neues-Passwort-2!', neu)));
pruefe('5 parallele Pruefungen alle true', parallel.every(x => x === true));

// 4. Unbekannte Konten kosten ungefaehr so viel wie bekannte (gleiche Parameter)
const [, tReal] = await zeit(() => passwortPruefen('falsch', neu));
const [, tDummy] = await zeit(() => passwortPruefen('falsch', DUMMY_HASH));
pruefe('Dummy-Pruefung dauert wie echte Pruefung (Faktor < 2.5)', tDummy > tReal / 2.5 && tDummy < tReal * 2.5, Math.round(tReal) + ' vs ' + Math.round(tDummy) + ' ms');
pruefe('DUMMY_HASH nutzt N=131072', DUMMY_HASH.startsWith('scrypt$131072$8$1$'));

// 5. Rehash-Update nur wenn der Hash noch unveraendert ist (kein Ueberschreiben eines geaenderten Passworts)
const quelle = readFileSync(join(WURZEL, 'routes-auth.mjs'), 'utf8');
pruefe('routes-auth.mjs: Rehash-UPDATE mit AND passwort_hash=?', /UPDATE benutzer SET passwort_hash=\? WHERE id=\? AND passwort_hash=\?/.test(quelle));
const d = new DatabaseSync(':memory:');
d.exec('CREATE TABLE benutzer (id INTEGER PRIMARY KEY, passwort_hash TEXT)');
d.prepare('INSERT INTO benutzer VALUES (1, ?)').run('ALT');
d.prepare('UPDATE benutzer SET passwort_hash=? WHERE id=1').run('PASSWORT-NEU-GESETZT');
const r = d.prepare('UPDATE benutzer SET passwort_hash=? WHERE id=? AND passwort_hash=?').run('REHASH', 1, 'ALT');
pruefe('Rehash ueberschreibt ein inzwischen geaendertes Passwort NICHT', Number(r.changes) === 0 && d.prepare('SELECT passwort_hash h FROM benutzer WHERE id=1').get().h === 'PASSWORT-NEU-GESETZT');

// 6. Hauptschluesseldatei: andere Seite schreibt noch -> kurz warten, nie leere Datei zurueckgeben
const tmp = mkdtempSync(join(tmpdir(), 'hs-'));
const pfad = join(tmp, 'schluessel.bin');
writeFileSync(pfad, Buffer.alloc(0));
const kind = spawn(process.execPath, ['-e', `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(pfad)}, Buffer.alloc(32, 7)), 200)`], { stdio: 'ignore' });
const erg = erzeugeHauptschluesselDatei(pfad);
pruefe('Halb geschriebene Schluesseldatei: Ergebnis hat 32 Bytes', erg.length === 32, 'laenge ' + erg.length);
pruefe('Halb geschriebene Schluesseldatei: Inhalt ist der vom anderen Prozess', erg.equals(Buffer.alloc(32, 7)));
kind.kill(); rmSync(tmp, { recursive: true, force: true });

// 7. Ueberlast: Warteschlange ist begrenzt (2 laufen + 16 warten); weitere werden sofort abgelehnt, die angenommenen liefern das richtige Ergebnis
const viele = await Promise.allSettled(Array.from({ length: 22 }, () => passwortPruefen('Neues-Passwort-2!', neu)));
const abgelehnt = viele.filter(x => x.status === 'rejected' && x.reason?.message === 'scrypt_ueberlastet').length;
const richtig = viele.filter(x => x.status === 'fulfilled' && x.value === true).length;
pruefe('22 gleichzeitige Pruefungen: genau 4 werden wegen Ueberlast abgelehnt (22-2-16)', abgelehnt === 4, 'abgelehnt ' + abgelehnt);
pruefe('Die 18 angenommenen Pruefungen liefern alle true', richtig === 18, 'richtig ' + richtig);
pruefe('Nach der Ueberlast funktioniert eine neue Pruefung wieder', (await passwortPruefen('Neues-Passwort-2!', neu)) === true);
const quelleLogin = readFileSync(join(WURZEL, 'routes-auth.mjs'), 'utf8');
pruefe('Login faengt scrypt_ueberlastet und antwortet 429 zu_viele_versuche', /scrypt_ueberlastet/.test(quelleLogin) && /429, 'zu_viele_versuche'/.test(quelleLogin));

console.log(`ERGEBNIS selbsttest-codex10-1b: ${ok} OK, ${fehler} FEHLER`);
process.exit(fehler ? 1 : 0);
