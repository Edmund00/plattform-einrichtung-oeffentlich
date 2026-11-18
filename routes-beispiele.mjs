// S2: ausschließlich bewusst angelegte, getrennt angezeigte Beispielentwürfe.
import express from 'express';
import { db, transaktion } from './db.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { stepupGueltig } from './auth.mjs';
import { fehler, sprache } from './texte.mjs';
import { vormerken } from './bunny-loeschen.mjs';
import { BEISPIELE, tr } from './beispiel-inhalte.mjs';

export const beispieleRouter = express.Router();
const idAus = v => typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const jetzt = () => new Date().toISOString();
const angeboten = () => !!db.prepare("SELECT 1 FROM einstellungen WHERE schluessel='beispiele_angeboten'").get();
const anzahl = () => db.prepare('SELECT COUNT(*) n FROM kurse WHERE beispiel_key IS NOT NULL').get().n;
const echte = () => !!db.prepare("SELECT 1 FROM kurse WHERE status='veroeffentlicht' AND beispiel_key IS NULL LIMIT 1").get();
const schreibSchutz = (req,res,next) => stepupGueltig(req) ? next() : fehler(res,401,'stepup_noetig');
function anzeige(k, details = false) {
  if (!Object.hasOwn(BEISPIELE,k.beispiel_key)) return null;
  const t = tr(k.beispiel_key, sprache());
  return { id:k.id, key:k.beispiel_key, titel:t.titel, beschreibung:t.beschreibung,
    musterpreis_cent:k.preis_cent, waehrung:k.waehrung, gratis:BEISPIELE[k.beispiel_key].gratis,
    ...(details ? {lektionen:t.lektionen} : {}) };
}
beispieleRouter.use((req,res,next) => {
  if (req.path.startsWith('/api/beispiele') || req.path.startsWith('/api/admin/beispiele')) res.setHeader('Cache-Control','no-store');
  next();
});
beispieleRouter.get('/api/beispiele', (_req,res) => {
  const kurse = db.prepare('SELECT * FROM kurse WHERE beispiel_key IS NOT NULL ORDER BY id').all().map(k=>anzeige(k)).filter(Boolean);
  res.json({vorhanden:kurse.length>0,kurse});
});
beispieleRouter.get('/api/beispiele/:id', (req,res) => {
  const id = idAus(req.params.id);
  if (!id) return fehler(res,400,'ungueltige_id');
  const k = db.prepare('SELECT * FROM kurse WHERE id=? AND beispiel_key IS NOT NULL').get(id);
  if (!k || !Object.hasOwn(BEISPIELE,k.beispiel_key)) return fehler(res,404,'beispiel_nicht_gefunden');
  res.json(anzeige(k,true));
});
beispieleRouter.get('/api/admin/beispiele/status', nurAdmin, (_req,res) => {
  const n=anzahl(), a=angeboten();
  res.json({angeboten:a,vorhanden:n>0,anlegbar:!a&&!n&&!echte(),anzahl:n});
});
beispieleRouter.post('/api/admin/beispiele', nurAdmin, schreibSchutz, (_req,res) => {
  const code = transaktion(() => {
    if (angeboten() || anzahl()) return 'beispiele_bereits_angeboten';
    if (echte()) return 'beispiele_nur_ohne_kurse';
    const zeit=jetzt();
    const kategorie=Number(db.prepare("INSERT INTO kategorien(name_de,name_en,name_hu,erstellt,geaendert) VALUES('Beispiel','Example','Példa',?,?)").run(zeit,zeit).lastInsertRowid);
    db.prepare("INSERT OR REPLACE INTO einstellungen(schluessel,wert,verschluesselt,aktualisiert_am) VALUES('beispiel_kategorie_id',?,0,?)").run(String(kategorie),zeit);
    // Identisch zum ersten Einrichtungskurs: EUR nur explizit, sonst HUF.
    // HUF ebenfalls in Hundertsteln speichern, ausschließlich ganze Forint.
    const roh=db.prepare("SELECT wert FROM einstellungen WHERE schluessel='erster_kurs_json' AND verschluesselt=0").get()?.wert;
    let ersterKurs;
    try { ersterKurs=roh ? JSON.parse(roh) : null; } catch { ersterKurs=null; }
    const waehrung=ersterKurs?.waehrung==='eur' ? 'eur' : 'huf';
    for (const [key,b] of Object.entries(BEISPIELE)) {
      const t=b.de, preis=waehrung==='eur' ? b.preis_cent : ({planen:1990000,video:2990000,plattform:0})[key];
      const id=Number(db.prepare("INSERT INTO kurse(titel,beschreibung,preis_cent,waehrung,status,beispiel_key,kategorie_id,erstellt,geaendert) VALUES(?,?,?,?,'entwurf',?,?,?,?)").run(t.titel,t.beschreibung,preis,waehrung,key,kategorie,zeit,zeit).lastInsertRowid);
      for (const [i,l] of t.lektionen.entries()) db.prepare("INSERT INTO lektionen(kurs_id,titel,inhalt,art,status,reihenfolge,erstellt,geaendert) VALUES(?,?,?,'text','veroeffentlicht',?,?,?)").run(id,l.titel,l.text,i,zeit,zeit);
    }
    db.prepare("INSERT INTO einstellungen(schluessel,wert,verschluesselt,aktualisiert_am) VALUES('beispiele_angeboten','1',0,?)").run(zeit);
    return null;
  });
  if (code) return fehler(res,409,code);
  res.status(201).json({angelegt:3});
});
beispieleRouter.post('/api/admin/beispiele/:id/uebernehmen', nurAdmin, schreibSchutz, (req,res) => {
  const id=idAus(req.params.id);
  if (!id) return fehler(res,400,'ungueltige_id');
  const ok=transaktion(() => {
    const k=db.prepare('SELECT beispiel_key FROM kurse WHERE id=? AND beispiel_key IS NOT NULL').get(id);
    if (!k || !Object.hasOwn(BEISPIELE,k.beispiel_key)) return false;
    const t=tr(k.beispiel_key,sprache()), zeit=jetzt();
    db.prepare("UPDATE kurse SET beispiel_key=NULL,status='entwurf',kategorie_id=NULL,titel=?,beschreibung=?,geaendert=? WHERE id=?").run(t.titel,t.beschreibung,zeit,id);
    const lektionen=db.prepare('SELECT id FROM lektionen WHERE kurs_id=? ORDER BY reihenfolge,id').all(id);
    for (const [i,l] of t.lektionen.entries()) {
      if (lektionen[i]) db.prepare('UPDATE lektionen SET titel=?,inhalt=?,geaendert=? WHERE id=?').run(l.titel,l.text,zeit,lektionen[i].id);
    }
    return true;
  });
  if (!ok) return fehler(res,404,'beispiel_nicht_gefunden');
  res.json({id});
});
beispieleRouter.delete('/api/admin/beispiele', nurAdmin, schreibSchutz, async (req,res) => {
  const ergebnis=transaktion(() => {
    const kurse=db.prepare('SELECT * FROM kurse WHERE beispiel_key IS NOT NULL').all();
    const dateien=[];
    for (const k of kurse) {
      const zeilen=db.prepare('SELECT d.pfad,d.quelle,d.bunny_video_id FROM dateien d JOIN lektionen l ON l.id=d.lektion_id WHERE l.kurs_id=?').all(k.id);
      const varianten=db.prepare("SELECT v.pfad,'lokal' AS quelle,NULL AS bunny_video_id FROM download_varianten v JOIN lektionen l ON l.id=v.lektion_id WHERE l.kurs_id=?").all(k.id);
      db.prepare('DELETE FROM kurse WHERE id=? AND beispiel_key IS NOT NULL').run(k.id);
      vormerken(zeilen);
      dateien.push(...zeilen,...varianten);
    }
    const kategorie=db.prepare("SELECT wert FROM einstellungen WHERE schluessel='beispiel_kategorie_id'").get()?.wert;
    db.prepare("DELETE FROM kategorien WHERE id=? AND NOT EXISTS(SELECT 1 FROM kurse WHERE kategorie_id=kategorien.id AND beispiel_key IS NULL)").run(idAus(kategorie)??-1);
    return {kurse,dateien};
  });
  const { dateienNachCommitLoeschen }=await import('./dateien.mjs');
  await dateienNachCommitLoeschen(ergebnis.dateien);
  const { vorschauNachKursLoeschen }=await import('./vorschau.mjs');
  await vorschauNachKursLoeschen(req.app.locals.dateiOrdner,ergebnis.kurse);
  res.json({entfernt:ergebnis.kurse.length});
});
// Bestehende Admin-Schreibwege dürfen Beispiele weder veröffentlichen noch
// Zugänge vergeben oder Mustertexte verändern. Erst bewusst übernehmen.
beispieleRouter.use((req,res,next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  let roh=req.path;
  try { roh=decodeURIComponent(roh); } catch { return next(); }
  const pfad=roh.toLowerCase().replace(/\/+/g,'/');
  const kurs=/^\/api\/admin\/kurse\/([1-9]\d{0,15})(?:\/|$)/.exec(pfad);
  const lektion=/^\/api\/admin\/lektionen\/([1-9]\d{0,15})(?:\/|$)/.exec(pfad);
  if (!kurs && !lektion) return next();
  const k=kurs ? db.prepare('SELECT beispiel_key FROM kurse WHERE id=?').get(idAus(kurs[1])??-1)
    : db.prepare('SELECT k.beispiel_key FROM lektionen l JOIN kurse k ON k.id=l.kurs_id WHERE l.id=?').get(idAus(lektion[1])??-1);
  if (k?.beispiel_key == null) return next();
  return nurAdmin(req,res,()=>fehler(res,409,'beispiel_gesperrt'));
});
