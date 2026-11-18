// Scheibe 13: Oeffentliche Kurs-Werbematerialien. Niemals Lektionsdateien ausliefern.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { db, transaktion } from './db.mjs';
import { aktuellerBenutzer } from './auth.mjs';
import { gueltigerZugang } from './zugang.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { fehler } from './texte.mjs';
import { bereichLesen } from './dateien.mjs';

export const TITELBILD_MAX_BYTES = 2 * 1024 * 1024;
export const TRAILER_MAX_BYTES = 30 * 1024 * 1024;
const ID = /^[1-9]\d{0,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ARTEN = Object.freeze({
  titelbild: { datei: 'titelbild_datei', typ: 'titelbild_typ', max: TITELBILD_MAX_BYTES },
  trailer: { datei: 'trailer_datei', typ: 'trailer_typ', max: TRAILER_MAX_BYTES },
});
const hat = (b, offset, ascii) => b.length >= offset + ascii.length && b.toString('latin1', offset, offset + ascii.length) === ascii;
export function vorschauMime(art, b) {
  if (art === 'titelbild') {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length >= 8 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
    if (hat(b,0,'RIFF') && hat(b,8,'WEBP')) return 'image/webp';
  }
  if (art === 'trailer') {
    if (hat(b,4,'ftyp') && b.length >= 12) return 'video/mp4';
    if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  }
  return null;
}
const idAus = x => ID.test(String(x)) ? Number(x) : null;
const leer = body => body === undefined || (!!body && typeof body === 'object' && !Array.isArray(body) && !Object.keys(body).length);
async function weg(pfad) {
  try { await unlink(pfad); }
  catch (e) { if (e.code !== 'ENOENT') console.warn('Vorschau-Datei nicht entfernbar:', e.code || 'unbekannt'); }
}
function kursSichtbar(kurs, req) {
  if (kurs.status === 'veroeffentlicht') return true;
  if (kurs.status !== 'archiviert') return false;
  const b = aktuellerBenutzer(req);
  return !!b && (b.rolle === 'admin' || gueltigerZugang(b.id, kurs.id));
}
export function vorschauRouter({ ordner }) {
  const router = express.Router();
  const basis = resolve(ordner,'vorschau');   // wird erst beim ersten Upload angelegt (ein leerer DATEI_ORDNER bleibt leer)

  // Rohdaten mit 12 Headerbytes pruefen. Kein Nutzerpfad und kein MIME aus Dateiname.
  router.put('/api/admin/kurse/:id/vorschau/:art',nurAdmin,async(req,res) => {
    const id = idAus(req.params.id), art = Object.hasOwn(ARTEN,req.params.art) ? ARTEN[req.params.art] : null;
    if (!id) return fehler(res,400,'ungueltige_id');
    if (!art) return fehler(res,400,'vorschau_typ_ungueltig');
    if (!db.prepare('SELECT 1 FROM kurse WHERE id=?').get(id)) return fehler(res,404,'nicht_gefunden');
    const clen = req.headers['content-length'];
    if (clen !== undefined && (!/^\d+$/.test(String(clen)) || Number(clen) > art.max)) return fehler(res,400,'vorschau_zu_gross');
    const temp = join(basis,'.tmp-'+randomUUID());
    const zielname = randomUUID();
    const ziel = join(basis,zielname);
    let handle, groesse=0, kopf=Buffer.alloc(0), mime=null, gespeichert=false;
    try {
      mkdirSync(basis,{recursive:true});
      handle = await open(temp,'wx');
      for await (const chunk of req) {
        groesse += chunk.length;
        if (groesse > art.max) throw new Error('vorschau_zu_gross');
        if (kopf.length < 16) kopf = Buffer.concat([kopf,chunk.subarray(0,16-kopf.length)]);
        await handle.writeFile(chunk);
      }
      await handle.close(); handle=null;
      if (!groesse || !(mime=vorschauMime(req.params.art,kopf))) throw new Error('vorschau_typ_ungueltig');
      await rename(temp,ziel);
      gespeichert=true;
      const alt = transaktion(() => {
        const k = db.prepare('SELECT titelbild_datei,trailer_datei FROM kurse WHERE id=?').get(id);
        if (!k) throw new Error('nicht_gefunden');
        db.prepare('UPDATE kurse SET '+art.datei+'=?, '+art.typ+'=?, geaendert=? WHERE id=?')
          .run(zielname,mime,new Date().toISOString(),id);
        return k[art.datei];
      });
      if (alt && UUID.test(alt)) await weg(join(basis,alt));
      return res.status(201).json({ typ:mime, groesse });
    } catch(e) {
      if(handle) await handle.close().catch(()=>{});
      await weg(temp);
      if(gespeichert) await weg(ziel);
      if(e.message==='vorschau_zu_gross') return fehler(res,400,'vorschau_zu_gross');
      if(e.message==='vorschau_typ_ungueltig') return fehler(res,400,'vorschau_typ_ungueltig');
      if(e.message==='nicht_gefunden') return fehler(res,404,'nicht_gefunden');
      console.warn('Vorschau-Upload fehlgeschlagen:',e.code || e.name || 'unbekannt');
      return fehler(res,500,'upload_fehlgeschlagen');
    }
  });
  router.delete('/api/admin/kurse/:id/vorschau/:art',nurAdmin,async(req,res) => {
    const id=idAus(req.params.id), art=Object.hasOwn(ARTEN,req.params.art) ? ARTEN[req.params.art] : null;
    if(!id)return fehler(res,400,'ungueltige_id');
    if(!art || !leer(req.body))return fehler(res,400,'body_ungueltig');
    const alt=transaktion(()=>{
      const k=db.prepare('SELECT '+art.datei+' FROM kurse WHERE id=?').get(id);
      if(!k)return undefined;
      db.prepare('UPDATE kurse SET '+art.datei+'=NULL, '+art.typ+'=NULL,geaendert=? WHERE id=?').run(new Date().toISOString(),id);
      return k[art.datei];
    });
    if(alt===undefined)return fehler(res,404,'nicht_gefunden');
    if(alt && UUID.test(alt))await weg(join(basis,alt));
    res.json({geloescht:true});
  });
  router.patch('/api/admin/kurse/:id/nutzen',nurAdmin,(req,res)=>{
    const id=idAus(req.params.id);
    if(!id)return fehler(res,400,'ungueltige_id');
    if(!req.body || Object.keys(req.body).length!==1 || typeof req.body.nutzen!=='string')
      return fehler(res,400,'body_ungueltig');
    const zeilen=req.body.nutzen.replace(/\r\n/g,'\n').split('\n');
    if(zeilen.length>8 || zeilen.some(z=>[...z].length>120))
      return fehler(res,400,'vorschau_nutzen_ungueltig');
    const result=db.prepare('UPDATE kurse SET nutzen=?,geaendert=? WHERE id=?')
      .run(zeilen.join('\n'),new Date().toISOString(),id);
    if(!result.changes)return fehler(res,404,'nicht_gefunden');
    res.json({nutzen:zeilen.join('\n')});
  });

  async function ausliefern(req,res,art,admin=false) {
    const felder=ARTEN[art];
    const id=idAus(req.params.id);
    if(!id)return fehler(res,404,'nicht_gefunden');
    const k=db.prepare('SELECT id,status,'+felder.datei+','+felder.typ+' FROM kurse WHERE id=?').get(id);
    const name=k?.[felder.datei], mime=k?.[felder.typ];
    if(!k || (!admin && !kursSichtbar(k,req)) || !name || !UUID.test(name) || !mime) return fehler(res,404,'nicht_gefunden');
    if(!['image/jpeg','image/png','image/webp','video/mp4','video/webm'].includes(mime))return fehler(res,404,'nicht_gefunden');
    let datei;
    try{datei=await stat(join(basis,name));}catch{return fehler(res,404,'nicht_gefunden');}
    if(!datei.isFile())return fehler(res,404,'nicht_gefunden');
    res.setHeader('Content-Type',mime);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Cache-Control', !admin && k.status==='veroeffentlicht'?'public, max-age=300':'private, no-store');
    res.setHeader('Accept-Ranges','bytes');
    const range=bereichLesen(req.headers.range,datei.size);
    if(range.ungueltig){res.setHeader('Content-Range','bytes */'+datei.size);return res.status(416).end();}
    if(!range.alle){
      res.status(206);
      res.setHeader('Content-Range','bytes '+range.start+'-'+range.end+'/'+datei.size);
      res.setHeader('Content-Length',range.end-range.start+1);
      const teil=createReadStream(join(basis,name),{start:range.start,end:range.end}).on('error',()=>res.destroy());
      res.once('close',()=>teil.destroy());   // Abbruch des Clients: Dateihandle freigeben
      return teil.pipe(res);
    }
    res.setHeader('Content-Length',datei.size);
    const ganz=createReadStream(join(basis,name)).on('error',()=>res.destroy());
    res.once('close',()=>ganz.destroy());   // Abbruch des Clients: Dateihandle freigeben
    ganz.pipe(res);
  }
  for (const art of Object.keys(ARTEN)) {
    router.get('/api/kurse/:id/'+art,(req,res)=>ausliefern(req,res,art));
    router.get('/api/admin/kurse/:id/vorschau/'+art,nurAdmin,(req,res)=>ausliefern(req,res,art,true));
  }
  return router;
}
export async function vorschauNachKursLoeschen(ordner,zeilen){
  const basis=resolve(ordner,'vorschau');
  for(const k of zeilen)for(const key of ['titelbild_datei','trailer_datei'])
    if(k[key] && UUID.test(k[key])) await weg(join(basis,k[key]));
}
