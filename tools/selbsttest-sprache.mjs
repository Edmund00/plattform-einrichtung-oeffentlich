// Scheibe 9: Kein deutscher sichtbarer UI-Text in hu.json.
// Absichtlich nur eigenständige Wörter; ungarische Wortteile sind keine Treffer.
import './test-sprache.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const HU = JSON.parse(readFileSync(resolve('texte', 'hu.json'), 'utf8'));
const verboten = /\b(nicht|und|der|die|das|bitte|fehler|kurs|zahlung|datei|benutzer|passwort|speichern|loeschen|löschen)\b/giu;
let ok = 0, schlecht = 0;
const pruefe = (name, passt, detail = '') => {
  if (passt) ok++; else schlecht++;
  console.log((passt ? 'OK     ' : 'FEHLER ') + name + (!passt ? ' ' + detail : ''));
};
const texte = Object.entries(HU);
const funde = texte.flatMap(([name, wert]) =>
  typeof wert === 'string'
    ? [...wert.matchAll(verboten)].map(m => name + ': ' + m[0])
    : [name + ': kein Text']);
pruefe('Alle ungarischen Texte sind Zeichenketten', texte.every(([,wert]) => typeof wert === 'string'));
pruefe('Keine deutschen Wörter in ' + texte.length + ' Oberflächen- und Fehlertexten', funde.length === 0, funde.join(', '));
// Fehlercodes in API-Routen dürfen nicht unübersetzt an Kunden gehen.
const routen = ['routes-kurse.mjs', 'routes-bestellungen.mjs', 'dateien.mjs', 'zahlung.mjs', 'routes-auth.mjs'];
const verwendet = new Set();
for (const datei of routen) {
  const s = readFileSync(resolve(datei), 'utf8');
  for (const m of s.matchAll(/\bfehler\s*\([^,\n]+,\s*\d{3},\s*['"]([a-z_]+)['"]/g)) verwendet.add(m[1]);
}
const fehlen = [...verwendet].filter(k => typeof HU[k] !== 'string');
pruefe('Alle ' + verwendet.size + ' statischen API-Fehlercodes haben HU-Texte', fehlen.length === 0, fehlen.join(', '));
// Prüfrunde 4 (J17/J18): einheitlicher Begriff, keine deutschen Buchstaben, alle Fehlercodes aller Server-Dateien übersetzt.
// Gabriella (02.11.2026): überall "előadás/előadások"; "kurzus" und "tanfolyam" erscheinen nirgends mehr im sichtbaren Text (Platzhalter {tanfolyam} ausgenommen).
const altBegriffFunde = texte.filter(([, w]) => /kurzus|tanfolyam/i.test(String(w).replaceAll('{tanfolyam}', ''))).map(([n]) => n);
pruefe('Einheitlich "előadás", nirgends "kurzus" oder "tanfolyam" im Text (Platzhalter ausgenommen)', altBegriffFunde.length === 0, altBegriffFunde.join(', '));
const eloadasFunde = texte.filter(([, w]) => /előadás/i.test(String(w)));
pruefe('Der Begriff "előadás" kommt in den Texten vor (Plausibilität)', eloadasFunde.length > 40, String(eloadasFunde.length));
{
  // Gabriella/Edmund (02.11.2026): das alte Wort (Kurzus + ok) darf NIRGENDS im Repo stehen (ausser dem historischen PROTOKOLL.md). Das Muster wird zusammengesetzt, damit
  // diese Datei selbst nicht trifft.
  const altesWort = new RegExp('kurzu' + 'sok', 'i'), funde = [];
  const durchsuche = (ordner) => {
    for (const e of readdirSync(ordner, { withFileTypes: true })) {
      if (['node_modules', '.git', 'daten', 'dateien', 'sicherung', 'sicherungen'].includes(e.name) || e.name === 'PROTOKOLL.md') continue;
      const voll = resolve(ordner, e.name);
      if (e.isDirectory()) { durchsuche(voll); continue; }
      if (!/\.(mjs|js|json|html|css|md|yaml|yml|txt|ps1)$/i.test(e.name)) continue;
      try { if (altesWort.test(readFileSync(voll, 'utf8'))) funde.push(voll.replace(resolve('.') + '\\', '')); } catch { /* nicht lesbar: ignorieren */ }
    }
  };
  durchsuche(resolve('.'));
  pruefe('Das alte Wort steht nirgends im Repo (Code, Texte, Tests, Doku)', funde.length === 0, funde.join(', '));
}
{
  // Adressen in der Adresszeile und in Mail-Links: neu "eloadasaim"/"eloadas/ID"; die alten Adressen (schon verschickte Links) laufen als Alias weiter.
  const kjs = readFileSync(resolve('public/kunde.js'), 'utf8'), mjs = readFileSync(resolve('mail.mjs'), 'utf8');
  pruefe('Sichtbare Links nutzen eloadasaim/eloadas (nicht kurzusaim/tanfolyam)', !/href: '#\/kurzusaim'|href:'#\/tanfolyam|gehe\('tanfolyam|'#\/tanfolyam\/'|belepesre\('kurzusaim'\)|belepesre\('tanfolyam/.test(kjs) && !mjs.includes('/#/kurzusaim') && mjs.includes('/#/eloadasaim'));
  pruefe('Alte Adressen kurzusaim und tanfolyam/ID laufen als Alias weiter (auch als Rücksprungziel nach der Anmeldung)', kjs.includes("case 'eloadasaim': case 'kurzusaim':") && kjs.includes("case 'eloadas': case 'tanfolyam':") && kjs.includes('(?:eloadas|tanfolyam)') && kjs.includes('eloadasaim|kurzusaim'));
}
{
  // Sichtbare Seitentitel und Export-Spaltenköpfe ebenfalls ohne altes Wort.
  const titel = ['public/index.html', 'public/admin/index.html'].map(d => (readFileSync(resolve(d), 'utf8').match(/<title>([^<]+)<\/title>/) || [])[1] || '');
  pruefe('Seitentitel ohne "kurzus"/"tanfolyam", mit "Előadás"', titel.every(t => /Előadás/.test(t) && !/kurzus|tanfolyam/i.test(t)), titel.join(' | '));
}
const buchstaben = texte.filter(([, w]) => /[äßÄ]/.test(String(w))).map(([n]) => n);
pruefe('Keine Buchstaben ä/ß/Ä (kommen im Ungarischen nicht vor)', buchstaben.length === 0, buchstaben.join(', '));
const alleCodes = new Set();
for (const datei of readdirSync('.').filter(d => d.endsWith('.mjs'))) {
  const s = readFileSync(resolve(datei), 'utf8');
  for (const m of s.matchAll(/\bfehler(?:Seite)?\s*\(\s*(?:req\s*,\s*)?[^,\n]+,\s*\d{3},\s*['"]([a-z_0-9]+)['"]/g)) alleCodes.add(m[1]);
}
const ohneText = [...alleCodes].filter(k => typeof HU[k] !== 'string');
pruefe('Alle ' + alleCodes.size + ' statischen Fehlercodes in ALLEN Server-Dateien haben HU-Texte', ohneText.length === 0, ohneText.join(', '));
// J12: Fallen die Texte aus, darf nie ein roher Schlüssel oder eine leere Seite erscheinen: fester ungarischer Hinweis in beiden Seiten.
for (const [datei, js, schluessel] of [['public/index.html', 'public/kunde.js', 'k_oldal_cim'], ['public/admin/index.html', 'public/admin/admin.js', 'a_titel']]) {
  const html = readFileSync(resolve(datei), 'utf8'), skript = readFileSync(resolve(js), 'utf8');
  pruefe(datei + ': fester ungarischer Notfalltext und Titel', /<title>[^<]+<\/title>/.test(html) && html.includes('id="notfall"') && html.includes('Az oldal most nem tölthető be') && html.includes('<noscript>'));
  pruefe(js + ': ohne geladene Texte Abbruch statt roher Schlüssel', skript.includes('if (!T.' + schluessel + ') throw') && skript.includes('if (!r.ok) throw'));
}
// L2: Warnung beim Veröffentlichen eines Kurses ohne sichtbare Lektion.
{
  const adminJs = readFileSync(resolve('public/admin/admin.js'), 'utf8');
  pruefe('L2: Veröffentlichen-Dialog warnt bei 0 sichtbaren Lektionen (Text vorhanden und im Admin verwendet)',
    typeof HU.a_nincs_lathato_lecke === 'string' && adminJs.includes("t('a_nincs_lathato_lecke')") && adminJs.includes("lecken.some(l => l.status === 'veroeffentlicht')"));
}
pruefe('Regulärer Ausdruck erkennt ein deutsches Wort', /\b(nicht|und)\b/i.test('Bitte nicht speichern'));
pruefe('Ungarische Teilwörter lösen keinen Alarm aus', !verboten.test('A magyar tanfolyam elkészült.'));
console.log('Sprachprüfung: ' + ok + ' bestanden, ' + schlecht + ' fehlgeschlagen');
process.exitCode = schlecht ? 1 : 0;
