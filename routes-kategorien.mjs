// K1: Kategorien; Origin läuft zentral; schreibende Adminzugriffe verlangen zusätzlich Step-up.
import express from 'express';
import { db, transaktion } from './db.mjs';
import { stepupGueltig } from './auth.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { fehler, sprache } from './texte.mjs';

export const kategorienRouter = express.Router();
const idAus = v => typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const liste = () => db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM kurse k WHERE k.kategorie_id=c.id AND k.status='veroeffentlicht' AND k.beispiel_key IS NULL) AS anzahl, (SELECT COUNT(*) FROM kurse k WHERE k.kategorie_id=c.id AND k.beispiel_key IS NULL) AS anzahl_gesamt
 FROM kategorien c ORDER BY c.reihenfolge, c.id`).all();
kategorienRouter.get('/api/kategorien', (_req,res) => res.json(liste().filter(c => c.anzahl > 0).map(c => ({id:c.id, name:c['name_'+sprache()] || c.name_de, anzahl:c.anzahl}))));
kategorienRouter.get('/api/admin/kategorien', nurAdmin, (_req,res) => res.json(liste()));
const schreibSchutz = (req,res,next) => stepupGueltig(req) ? next() : fehler(res,401,'stepup_noetig');
function pruefen(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {code:'body_ungueltig'};
  if (Object.keys(body).some(k => !['name_de','name_en','name_hu','reihenfolge'].includes(k))) return {code:'unbekanntes_feld'};
  const wert = {};
  for (const k of ['name_de','name_en','name_hu']) {
    if (typeof body[k] !== 'string' || /[\p{Cc}\p{Cf}]/u.test(body[k])) return {code:'kategorie_name_ungueltig'};
    const v = body[k].normalize('NFC').trim();
    if ([...v].length < 1 || [...v].length > 80) return {code:'kategorie_name_ungueltig'};
    wert[k] = v;
  }
  if (body.reihenfolge !== undefined && !Number.isSafeInteger(body.reihenfolge)) return {code:'reihenfolge_ungueltig'};
  wert.reihenfolge = body.reihenfolge ?? 0;
  return {wert};
}
kategorienRouter.post('/api/admin/kategorien', nurAdmin, schreibSchutz, (req,res) => {
  const p = pruefen(req.body);
  if (p.code) return fehler(res,400,p.code);
  const k = p.wert, zeit = new Date().toISOString();
  const r = db.prepare('INSERT INTO kategorien(name_de,name_en,name_hu,reihenfolge,erstellt,geaendert) VALUES(?,?,?,?,?,?)').run(k.name_de,k.name_en,k.name_hu,k.reihenfolge,zeit,zeit);
  res.status(201).json(db.prepare('SELECT * FROM kategorien WHERE id=?').get(Number(r.lastInsertRowid)));
});
kategorienRouter.put('/api/admin/kategorien/:id', nurAdmin, schreibSchutz, (req,res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res,400,'ungueltige_id');
  if (!db.prepare('SELECT 1 FROM kategorien WHERE id=?').get(id)) return fehler(res,404,'nicht_gefunden');
  const p = pruefen(req.body);
  if (p.code) return fehler(res,400,p.code);
  const k = p.wert;
  db.prepare('UPDATE kategorien SET name_de=?,name_en=?,name_hu=?,reihenfolge=?,geaendert=? WHERE id=?').run(k.name_de,k.name_en,k.name_hu,k.reihenfolge,new Date().toISOString(),id);
  res.json(db.prepare('SELECT * FROM kategorien WHERE id=?').get(id));
});
kategorienRouter.delete('/api/admin/kategorien/:id', nurAdmin, schreibSchutz, (req,res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res,400,'ungueltige_id');
  if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return fehler(res,400,'body_ungueltig');
  const changes = transaktion(() => {
    // Auch bei einer Verbindung ohne aktive Foreign Keys bleiben die Kurse erhalten.
    if (!db.prepare('PRAGMA foreign_keys').get().foreign_keys) db.prepare('UPDATE kurse SET kategorie_id=NULL WHERE kategorie_id=?').run(id);
    return db.prepare('DELETE FROM kategorien WHERE id=?').run(id).changes;
  });
  if (!changes) return fehler(res,404,'nicht_gefunden');
  res.json({geloescht:true});
});
