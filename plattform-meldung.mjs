// Plattform-Meldung (Dashboard-Anbindung, 03.11.2026): meldet jedes Geschaeftsereignis (Tabelle ereignisse) ohne personenbezogene Daten an ein
// Apps-Script-Webhook im PLATTFORM-Sheet von Gabriella (getrennt von der normalen Buchhaltung). Aus, solange PLATTFORM_WEBHOOK_URL/KEY fehlen.
// Gesendet wird NIE die Kaeufer-E-Mail, nie ein Name. Dauerhaft wiederholbar (Tabelle plattform_ausgang), jedes Ereignis hoechstens einmal im Sheet
// (Idempotenz ueber quelle_id im Script). Die Tabelle hat bewusst KEINEN Fremdschluessel auf ereignisse (die Migration baut ereignisse neu auf).
import { createHmac } from 'node:crypto';
import { db } from './db.mjs';
import { triggerSetzen, zeileBauen, alleVormerken, stripeAnreichern, stripeAbgleichen } from './plattform-zeilen.mjs';

export const WEBHOOK_MUSTER = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
export const SCHLUESSEL_MUSTER = /^[A-Za-z0-9_-]{24,128}$/;
const SENDBARE_TYPEN = new Set(['registriert', 'bestaetigt', 'gekauft', 'erstattet', 'abo_gestartet', 'abo_beendet', 'abo_gekuendigt']); // 'geloescht' nie
const MAX_PRO_LAUF = 20;
const AUFRAEUMEN_MS = 30 * 24 * 60 * 60 * 1000;

db.exec(`
CREATE TABLE IF NOT EXISTS plattform_ausgang (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ereignis_id INTEGER NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','gesendet','verworfen')),
 versuche INTEGER NOT NULL DEFAULT 0,
 erstellt INTEGER NOT NULL DEFAULT 0,
 geaendert INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plattform_ausgang_offen ON plattform_ausgang(status,id);
`);

const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
// Wartezeit bis zum naechsten Versuch: 30 s * 2^versuche, hoechstens 6 Stunden. Nie aufgeben (sonst fehlen Ereignisse im Sheet).
const WARTE_MAX_MS = 6 * 3600 * 1000;
export const wartezeit = (versuche) => Math.min(WARTE_MAX_MS, 30000 * 2 ** Math.min(versuche, 12));
// Antworten des Scripts, bei denen ein neuer Versuch nichts aendert (Daten falsch): Ereignis wird verworfen. Alles andere (Schluessel, Blatt, Netz, HTML) wird wiederholt.
const DAUERHAFT_ABGELEHNT = /^(format|feld_[a-z_]+|typ|modus|zeit|kurs|waehrung|quelle_id|betrag|unbekanntes_feld|blatt_unbekannt|zeilenschluessel|werte|zu_viele_felder)$/;

export function plattformMeldung({ url = '', schluessel = '', modus = 'Test', fetchFn = globalThis.fetch, jetzt = () => Date.now(), timeoutMs = 15000, stripe = null } = {}) {
  const an = WEBHOOK_MUSTER.test(url) && SCHLUESSEL_MUSTER.test(schluessel) && (modus === 'Test' || modus === 'Live');
  const laeuft = new Set();
  let sperre = false;
  triggerSetzen(an);   // Datenbank-Trigger fuer Kunden-Abos/Zahlungen nur, solange die Meldung an ist

  function vormerken(ereignisId, typ) {
    if (!an || !SENDBARE_TYPEN.has(typ) || !Number.isSafeInteger(ereignisId)) return false;
    try {
      return db.prepare("INSERT OR IGNORE INTO plattform_ausgang(ereignis_id,status,versuche,erstellt,geaendert) VALUES(?,'offen',0,?,?)").run(ereignisId, jetzt(), jetzt()).changes === 1;
    } catch { console.warn('Plattform-Meldung: Vormerken fehlgeschlagen'); return false; }
  }

  const typ_ = (e) => String(e.typ);
  function nutzlast(e) {
    // Nur diese Felder gehen hinaus. Fremde oder unerwartete Werte (zum Beispiel ein @) werden nie gesendet.
    const betrag = e.betrag == null ? '' : Number(e.betrag);
    const waehrung = e.waehrung ? String(e.waehrung).toUpperCase() : '';
    const kurs = e.kurs_id == null ? '' : String(e.kurs_id);
    const quelleRoh = String(e.quelle_id);
    const wert = { zeit_utc: utc(e.zeit), typ: e.typ, kurs, betrag, waehrung, modus, quelle_id: createHmac('sha256', schluessel).update(typ_(e) + '|' + quelleRoh).digest('hex').slice(0, 32) };
    for (const [k, v] of Object.entries(wert)) if (typeof v === 'string' && (v.includes('@') || /[\u0000-\u001f]/.test(v))) return { fehler: k };
    if (betrag !== '' && !Number.isFinite(betrag)) return { fehler: 'betrag' };
    if (waehrung && !/^[A-Z]{3}$/.test(waehrung)) return { fehler: 'waehrung' };
    if (quelleRoh.length > 200 || /[\u0000-\u001f]/.test(quelleRoh)) return { fehler: 'quelle_id' };
    return { wert };
  }

  async function einsenden(wert) {
    let antwort;
    try {
      antwort = await fetchFn(url, {
        method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ schluessel, ...wert }), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { return { ok: false, dauerhaft: false }; }
    try {
      const text = await antwort.text();
      const j = JSON.parse(text);
      if (j?.ok === true) return { ok: true };   // 'duplicate' kommt ebenfalls mit ok:true
      return { ok: false, dauerhaft: typeof j?.fehler === 'string' && DAUERHAFT_ABGELEHNT.test(j.fehler) };
    } catch { return { ok: false, dauerhaft: false }; }
  }

  async function senden() {
    if (!an || sperre) return { gesendet: 0, offen: 0 };
    sperre = true;
    let gesendet = 0;
    try {
      let jobs;
      try {
        // Verwaiste Zeilen (Ereignis durch die Aufbewahrungsregel geloescht) werden verworfen, sie koennen nie gesendet werden.
        db.prepare("UPDATE plattform_ausgang SET status='verworfen',geaendert=? WHERE status='offen' AND NOT EXISTS (SELECT 1 FROM ereignisse e WHERE e.id=plattform_ausgang.ereignis_id)").run(jetzt());
        // Nur faellige Zeilen laden (gleiche Wartezeit-Formel wie wartezeit()), damit lange wartende Zeilen neuere nicht blockieren.
        jobs = db.prepare("SELECT p.id,p.versuche,p.geaendert,e.zeit,e.typ,e.kurs_id,e.betrag,e.waehrung,e.quelle_id FROM plattform_ausgang p JOIN ereignisse e ON e.id=p.ereignis_id WHERE p.status='offen' AND (p.versuche=0 OR p.geaendert+MIN(?,30000*(1<<MIN(p.versuche,12)))<=?) ORDER BY p.id LIMIT ?").all(WARTE_MAX_MS, jetzt(), MAX_PRO_LAUF * 4);
      } catch { console.warn('Plattform-Meldung: Liste nicht lesbar'); return { gesendet: 0, offen: 0 }; }
      let versucht = 0;
      for (const j of jobs) {
        if (versucht >= MAX_PRO_LAUF) break;
        if (laeuft.has(j.id)) continue;
        if (j.versuche > 0 && jetzt() - j.geaendert < wartezeit(j.versuche)) continue;
        laeuft.add(j.id); versucht++;
        try {
          const n = nutzlast(j);
          if (n.fehler) {
            db.prepare("UPDATE plattform_ausgang SET status='verworfen',geaendert=? WHERE id=?").run(jetzt(), j.id);
            console.warn('Plattform-Meldung: Ereignis verworfen (Feld ' + n.fehler + ' ungueltig)');
            continue;
          }
          db.prepare('UPDATE plattform_ausgang SET versuche=versuche+1,geaendert=? WHERE id=?').run(jetzt(), j.id);
          const r = await einsenden(n.wert);
          if (r.ok) { db.prepare("UPDATE plattform_ausgang SET status='gesendet',geaendert=? WHERE id=?").run(jetzt(), j.id); gesendet++; }
          else if (r.dauerhaft) { db.prepare("UPDATE plattform_ausgang SET status='verworfen',geaendert=? WHERE id=?").run(jetzt(), j.id); console.warn('Plattform-Meldung: vom Script dauerhaft abgelehnt, verworfen'); }
          else console.warn('Plattform-Meldung: Versand fehlgeschlagen, neuer Versuch spaeter');
        } catch { console.warn('Plattform-Meldung: Fehler bei der Verarbeitung'); }
        finally { laeuft.delete(j.id); }
      }
      gesendet += await zeilenSenden();
    } finally { sperre = false; }
    return { gesendet, offen: lage().offen };
  }

  // Zeilen (Kunden-Abos, Zahlungen): frisch aus der Datenbank gebaut, gleicher Zeilenschluessel ueberschreibt im Sheet.
  async function zeilenSenden() {
    let gesendet = 0, jobs;
    try {
      jobs = db.prepare("SELECT id,blatt,schluessel,version FROM plattform_zeilen WHERE status='offen' AND (versuche=0 OR geaendert+MIN(?,30000*(1<<MIN(versuche,12)))<=?) ORDER BY id LIMIT ?").all(WARTE_MAX_MS, jetzt(), MAX_PRO_LAUF * 4);
    } catch { console.warn('Plattform-Zeilen: Liste nicht lesbar'); return 0; }
    let versucht = 0;
    for (const j of jobs) {
      if (versucht >= MAX_PRO_LAUF) break;
      const kennung = 'z' + j.id;
      if (laeuft.has(kennung)) continue;
      laeuft.add(kennung); versucht++;
      try {
        if (j.blatt === 'Zahlungen') await stripeAnreichern(stripe, j.schluessel, jetzt);   // gibt es Gebuehr/Netto/Beleg noch nicht: einmal bei Stripe holen
        const werte = zeileBauen(j.blatt, j.schluessel, modus);
        if (!werte) { db.prepare("UPDATE plattform_zeilen SET status='verworfen',geaendert=? WHERE id=?").run(jetzt(), j.id); continue; }
        db.prepare('UPDATE plattform_zeilen SET versuche=versuche+1,geaendert=? WHERE id=?').run(jetzt(), j.id);
        const r = await einsenden({ typ: 'zeile', blatt: j.blatt, zeilenschluessel: j.schluessel, werte });
        if (r.ok) {
          // Nur auf gesendet setzen, wenn sich die Zeile waehrend des Sendens nicht erneut geaendert hat (sonst bleibt sie offen).
          // Version unveraendert: gesendet. Sonst hat sich die Zeile waehrend des Sendens erneut geaendert: bleibt offen und ist sofort wieder faellig (versuche=0).
          db.prepare("UPDATE plattform_zeilen SET versuche=0,geaendert=?,status=CASE WHEN version=? THEN 'gesendet' ELSE 'offen' END WHERE id=? AND status!='verworfen'").run(jetzt(), j.version, j.id);
          gesendet++;
        } else if (r.dauerhaft) { db.prepare("UPDATE plattform_zeilen SET status='verworfen',geaendert=? WHERE id=?").run(jetzt(), j.id); console.warn('Plattform-Zeilen: vom Script dauerhaft abgelehnt, verworfen'); }
        else console.warn('Plattform-Zeilen: Versand fehlgeschlagen, neuer Versuch spaeter');
      } catch { console.warn('Plattform-Zeilen: Fehler bei der Verarbeitung'); }
      finally { laeuft.delete(kennung); }
    }
    return gesendet;
  }

  function lage() {
    try {
      const z = (s) => db.prepare("SELECT COUNT(*) AS n FROM plattform_ausgang WHERE status=?").get(s).n;
      const aelteste = db.prepare("SELECT MIN(erstellt) AS t FROM plattform_ausgang WHERE status='offen'").get().t;
      const zl = (s) => db.prepare('SELECT COUNT(*) AS n FROM plattform_zeilen WHERE status=?').get(s).n;
      return { an, modus: an ? modus : null, zeilen_offen: zl('offen'), zeilen_gesendet: zl('gesendet'), zeilen_verworfen: zl('verworfen'), offen: z('offen'), gesendet: z('gesendet'), verworfen: z('verworfen'), aelteste_offen_utc: aelteste ? utc(aelteste) : null };
    } catch { return { an, modus: an ? modus : null, offen: 0, gesendet: 0, verworfen: 0, aelteste_offen_utc: null }; }
  }

  function aufraeumen() {
    try { return db.prepare("DELETE FROM plattform_ausgang WHERE status IN ('gesendet','verworfen') AND geaendert<?").run(jetzt() - AUFRAEUMEN_MS).changes; } catch { return 0; }
  }

  return { an, vormerken, senden, lage, aufraeumen, abgleich: (voll = true) => (an ? alleVormerken(voll) : 0), stripeAbgleich: () => (an ? stripeAbgleichen(stripe, jetzt) : Promise.resolve(0)), nachCommit: () => { if (an) queueMicrotask(() => { void senden().catch(() => {}); }); } };
}
