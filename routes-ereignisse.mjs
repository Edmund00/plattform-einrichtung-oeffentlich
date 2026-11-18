// Admin-only Ereignisliste und datenschutzsicherer CSV/JSON-Export.
import express from 'express';
import { plattformSlug } from './marke.mjs';
import { db } from './db.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { fehler, HU } from './texte.mjs';
import { EREIGNIS_TYPEN } from './ereignis-liste.mjs';
import { titelUebersetzt } from './demo-uebersetzung.mjs';

const router=express.Router();
const DATUM=/^\d{4}-\d{2}-\d{2}$/;
const ZAHL=/^[1-9]\d{0,5}$/;
const FELDER=['zeit','typ','kurs','betrag','waehrung','email','status','quelle_id'];
const SPALTEN=['zeit','typ','kurs','betrag','waehrung','email','status','quelle'].map(k=>HU['ereignis_export_'+k]);
const hu=(praefix,wert)=>wert?(HU[praefix+wert]??HU.a_ismeretlen):'';
function filter(req) {
  const erlaubt=['typ','von','bis','suche','seite','format'];
  if(Object.keys(req.query).some(k=>!erlaubt.includes(k)))return null;
  const {typ, von,bis,suche,seite='1',format} = req.query;
  if(typ!==undefined && !EREIGNIS_TYPEN.includes(typ))return null;
  if(format!==undefined && !['csv','json'].includes(format))return null;
  if(!ZAHL.test(String(seite)) || Number(seite)>20000)return null;
  for(const date of [von,bis]) {
    if(date!==undefined && (!DATUM.test(date) || Number.isNaN(Date.parse(date+'T00:00:00Z')) ||
       new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))return null;
  }
  if(von && bis && von>bis)return null;
  if(suche!==undefined && (typeof suche!=='string'||suche.length>254||/[\x00-\x1f]/.test(suche)))return null;
  const clauses=[],args=[];
  if(typ){clauses.push('typ=?');args.push(typ);}
  if(von){clauses.push('zeit>=?');args.push(Date.parse(von+'T00:00:00Z'));}
  if(bis){clauses.push('zeit<?');args.push(Date.parse(bis+'T00:00:00Z')+86400000);}
  if(suche){clauses.push("LOWER(email) LIKE ? ESCAPE '\\'");args.push('%'+suche.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%');}
  return {where:clauses.length?'WHERE '+clauses.join(' AND '):'',args,page:Number(seite),format};
}
const utc=ms=>new Date(ms).toISOString().slice(0,19).replace('T',' ');
const zeile=e=>({
  zeit:utc(e.zeit),typ:e.typ,kurs:titelUebersetzt(e.kurs_titel)||'',betrag:e.betrag,
  waehrung:e.waehrung||'',email:e.email||'',status:e.status||'',quelle_id:e.quelle_id,
});
function csvZelle(wert) {
  let s=wert===null||wert===undefined?'':String(wert);
  if(/^[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
router.get('/api/admin/ereignisse',nurAdmin,(req,res)=>{
  const f=filter(req);
  if(!f)return fehler(res,400,'ereignis_filter_ungueltig');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  const rows=db.prepare('SELECT zeit,typ,kurs_titel,betrag,waehrung,email,status,quelle_id FROM ereignisse '+
    f.where+' ORDER BY zeit DESC,id DESC LIMIT ? OFFSET ?')
    .all(...f.args,f.format?10000:50,f.format?0:(f.page-1)*50);
  const data=rows.map(zeile);
  if(f.format){
    for(const row of data){
      row.typ=hu('a_ereignis_typ_',row.typ);row.status=hu('a_ereignis_status_',row.status);
      row.waehrung=row.waehrung.toUpperCase();
    }
    res.setHeader('Content-Disposition','attachment; filename="'+plattformSlug()+'-esemenyek.'+f.format+'"');
    if(f.format==='json')return res.type('application/json; charset=utf-8').send(JSON.stringify(data.map(row=>Object.fromEntries(FELDER.map((k,i)=>[SPALTEN[i],row[k]])))));
    const csv=[SPALTEN.map(csvZelle).join(','),...data.map(row=>FELDER.map(k=>csvZelle(row[k])).join(','))].join('\r\n')+'\r\n';
    return res.type('text/csv; charset=utf-8').send('\ufeff'+csv);
  }
  const count=db.prepare('SELECT COUNT(*) AS n FROM ereignisse '+f.where).get(...f.args).n;
  return res.json({adatok:data,seite:f.page,gesamt:count,seiten:Math.ceil(count/50)});
});
export const ereignisseRouter=router;
