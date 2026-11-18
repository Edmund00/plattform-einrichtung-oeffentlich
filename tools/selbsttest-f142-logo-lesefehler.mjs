// F-142: Kurzer Lesefehler (EBUSY/EACCES) darf nicht dauerhaft gecacht werden.
// Testet setzeLogoLesefehlerAblaufMs + das Ablauf-/Retry-Verhalten von logoPfade().
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';

const lauf = Date.now();
const tmpDir = mkdtempSync(join(tmpdir(), `pe-f142-${lauf}-`));

let ok = 0, schlecht = 0;
const pruefe = (name, bed, detail = '') => { bed ? ok++ : schlecht++; console.log(`${bed ? 'OK     ' : 'FEHLER '} ${name}${!bed && detail ? '  -> ' + String(detail).slice(0, 220) : ''}`); };
const abschnitt = (t) => console.log(`--- ${t}`);
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function minPng() {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000400000004008000000008f022e020000002449444154edd08100000000c3a0f953dfe004855061c0800103060c183060c0800103060c18f80303097e9ae90000000049454e44ae426082',
    'hex'
  );
}

const { logoPfade, logoPruefungen, setzeLogoPfad, setzeLogoLesefehlerAblaufMs } = await import('../marke.mjs');

const logoDir = join(tmpDir, 'marke');
mkdirSync(logoDir, { recursive: true });
const logoPfad = join(logoDir, 'logo.png');

try {
  // =====================================================================
  abschnitt('I: Kurzer Lesefehler wird nur kurz gecacht (F-142)');

  if (platform() === 'win32') {
    pruefe('I1 uebersprungen (Windows: chmod hat keine Wirkung)', true);
    pruefe('I2 uebersprungen (Windows: chmod hat keine Wirkung)', true);
  } else {
    writeFileSync(logoPfad, minPng());
    setzeLogoPfad(logoPfad);

    // Ablauf auf 50 ms setzen, dann chmod -> Lesefehler erzeugen
    setzeLogoLesefehlerAblaufMs(50);
    chmodSync(logoPfad, 0o000);
    try {
      const r1 = logoPfade();
      pruefe('I1 Lesefehler -> SVG-Rueckfall', r1.quer.endsWith('.svg'), `quer: ${r1.quer}`);

      // 100 ms warten (Ablauf 50 ms ist abgelaufen), Datei wieder lesbar machen
      await warte(100);
      chmodSync(logoPfad, 0o644);

      const r2 = logoPfade();
      pruefe('I2 Nach Ablauf + chmod 0644 -> wieder /marke/logo.png?v=', r2.quer.startsWith('/marke/logo.png?v='), `quer: ${r2.quer}`);
    } finally {
      chmodSync(logoPfad, 0o644); // Sicherheits-Fallback
      setzeLogoLesefehlerAblaufMs(5000); // Standard wiederherstellen
    }
  }

  // =====================================================================
  abschnitt('J: Dauerhaft ungueltiges PNG bleibt SVG, kein Re-Read bei jedem Aufruf');
  {
    writeFileSync(logoPfad, 'kein-png-inhalt');
    setzeLogoPfad(logoPfad);
    const p0 = logoPruefungen();
    for (let i = 0; i < 50; i++) logoPfade();
    pruefe('J1 Dauerhaft ungueltige Datei -> SVG', logoPfade().quer.endsWith('.svg'), `quer: ${logoPfade().quer}`);
    pruefe('J2 50 Aufrufe -> nur +1 Pruefung (kein Re-Read wegen leseFehlerBis=null)', logoPruefungen() === p0 + 1, `Delta: ${logoPruefungen() - p0}`);
  }

} finally {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('');
console.log(`Ergebnis: ${ok} OK, ${schlecht} FEHLER`);
if (schlecht > 0) process.exit(1);
