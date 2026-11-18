// S2b: isolierte echte UI-Funktionen, ohne Server.
import {readFileSync as read} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const shop=read('public/kunde.js','utf8'), admin=read('public/admin/admin.js','utf8');
const source=shop.slice(shop.indexOf('function beispielPreis('),shop.indexOf('async function eloadasok()'));
const as=admin.slice(admin.indexOf('const s2BeispielIds'),admin.indexOf('function k1KategorieName'));
const langs=['de','en','hu'].map(l=>JSON.parse(read('texte/'+l+'.json','utf8')));
for(const key of Object.keys(langs[0]).filter(k=>k.startsWith('s2_')))for(const l of langs)assert.ok(l[key],key);
for(const [key,value] of Object.entries(langs[2]).filter(([k])=>k.startsWith('s2_')))assert.doesNotMatch(value,/kurzus|tanfolyam/i,key);
assert.doesNotMatch(source+as,/innerHTML|localStorage|sessionStorage|document\.cookie|\/kaufen/);
assert.doesNotMatch(shop+admin,/localStorage|sessionStorage|document\.cookie/);
class El{
 constructor(tag,props={},children=[]){this.tag=tag;this.props=props;this.children=children.flat(Infinity).filter(x=>x!=null);this.hidden=!!props.hidden;this.isConnected=true;}
 replaceChildren(...children){this.children=children.flat(Infinity);}
}
const h=(tag,props,...children)=>new El(tag,props,children);
const all=n=>[n,...(n.children||[]).flatMap(x=>typeof x==='object'?all(x):[])];
const text=n=>all(n).flatMap(x=>[x.textContent || '',...(x.children||[])]).filter(x=>typeof x==='string').join(' ');
let response, rendered, requests=[];
const c=vm.createContext({h,T:langs[0],t:(k,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),langs[0][k]||k),formatBetrag:()=> '49,00 EUR',location:{hash:'#/beispiel/1'},betoltes(){},zeigen:(...n)=>rendered=n,fehlerAnsicht:(...n)=>rendered=n,fehlerText:()=> 'error',api:async(m,p)=>{requests.push([m,p]);if(response instanceof Error)throw response;return response;}});
vm.runInContext(source,c);
const course={id:1,key:'planen',titel:'<img onerror=x>',beschreibung:'Text',musterpreis_cent:4900,waehrung:'eur',gratis:false,lektionen:[{titel:'Lektion',text:'<script>Text'}]};
for(const result of [{ok:true,d:{vorhanden:false}}, {ok:false},new Error('offline'),{ok:true,d:{vorhanden:true,kurse:[course]}}]){
 response=result;const box=h('section',{hidden:true}),leer=h('p',{});
 await c.beispieleLaden(box,leer,true);
 assert.equal(box.hidden,!(result.d?.vorhanden));
 assert.equal(leer.hidden,!!result.d?.vorhanden);
 if(!box.hidden){assert.match(text(box),/BEISPIEL/);assert.match(text(box),/Musterpreis 49,00 EUR/);assert.equal(all(box).filter(n=>n.tag==='button').length,0);assert.equal(all(box).find(n=>n.tag==='a').props.href,'#/beispiel/1');}
}
response={ok:true,d:course};requests=[];await c.beispielSeite(1);
assert.deepEqual(requests,[['GET','/api/beispiele/1']]);assert.match(rendered.map(text).join(' '),/<script>Text/);assert.equal(all(rendered[0]).filter(n=>n.tag==='button').length,0);
response={ok:false,status:404};await c.beispielSeite(1);assert.equal(rendered[0],langs[0].s2_nicht_gefunden);
let confirmed, writes=[], notices=[], refreshes=0;
Object.assign(c,{bestaetigen:(key,fn)=>confirmed={key,fn},apiMitStepup:async(...a)=>{writes.push(a);return response;},meldung:(...a)=>notices.push(a),uebersicht:async()=>{refreshes++;}});
vm.runInContext(as,c);
for(const status of [{anlegbar:true},{vorhanden:true},{anlegbar:false,vorhanden:false}]){
 response={ok:true,d:status};const box=c.s2AdminBereich(async()=>{});await new Promise(r=>setImmediate(r));
 assert.equal(box.hidden,!(status.anlegbar||status.vorhanden));
 if(status.anlegbar){const b=all(box).find(n=>n.tag==='button');response={ok:true,d:{anlegbar:true}};await b.props.onclick();assert.equal(writes.at(-1)[0],'POST');assert.equal(writes.at(-1)[1],'/api/admin/beispiele');}
 if(status.vorhanden){const b=all(box).find(n=>n.tag==='button');b.props.onclick();assert.equal(confirmed.key,'s2_entfernen_frage');const before=writes.length;response={ok:true};await confirmed.fn();assert.equal(writes.at(-1)[0],'DELETE');}
}
c.s2Uebernehmen(1);assert.equal(confirmed.key,'s2_uebernehmen_frage');response={ok:true};await confirmed.fn();assert.equal(writes.at(-1)[1],'/api/admin/beispiele/1/uebernehmen');
response={ok:false,d:{fehler:'beispiele_bereits_angeboten',text:'fallback'}};await c.s2Schreiben('POST','/api/admin/beispiele');assert.equal(notices.at(-1)[0],langs[0].beispiele_bereits_angeboten);
response=new Error('offline');const box=c.s2AdminBereich(async()=>{});await new Promise(r=>setImmediate(r));assert.equal(box.hidden,true);
// Den tatsächlich verwendeten Step-up-Mechanismus mit Wiederholung und Abbruch ausführen.
const step=admin.slice(admin.indexOf('async function apiMitStepup('),admin.indexOf('function budapestZeit('));
let calls=0,allow=true;
const sc=vm.createContext({api:async()=>++calls===1?{status:401,d:{fehler:'stepup_noetig'}}:{ok:true},stepupAnfordern:async()=>allow});vm.runInContext(step,sc);
assert.equal((await sc.apiMitStepup('POST','/api/admin/beispiele',{})).ok,true);assert.equal(calls,2);
calls=0;allow=false;assert.equal((await sc.apiMitStepup('DELETE','/api/admin/beispiele',{})).status,401);assert.equal(calls,1);
assert.match(shop,/case 'beispiel':/);assert.match(admin,/s2BeispielIds.has\(String\(k.id\)\)/);
console.log('S2-Beispiele-UI: Sichtbarkeit, Fehlerisolation, Karten/Detail, Bestätigungen, Fehlercodes, Step-up und Sprachen bestanden.');

// Isolierte vollständige Katalogabläufe mit echtem eloadasok().
const texte=langs;
const katalog=shop.slice(shop.indexOf('function baueKatalogQuery('),shop.indexOf('// ---- Kursseite:'));
let activeElement = null;
class Dom {
  constructor(tag, props = {}, children = []) {
    this.tag = tag; this.props = props; this.children = []; this.textContent = ''; this.value = props.value || ''; this.hidden = props.hidden || false; this.disabled = props.disabled || false; this.dataset = {}; this.isConnected = true;
    this.append(...children);
  }
  append(...nodes) { const items=nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false); for(const node of items) if(node instanceof Dom) { node.parentNode=this; node.isConnected=true; } this.children.push(...items); }
  remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(n=>n!==this); this.isConnected=false; }
  addEventListener() {}
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  focus() { activeElement=this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.props[key] = value; }
  removeAttribute(key) { delete this.props[key]; }
  querySelectorAll(selectors) { const tags = selectors.split(','); return this.children.flatMap(c => c instanceof Dom ? [...(tags.includes(c.tag) ? [c] : []), ...c.querySelectorAll(selectors)] : []); }
}
async function scenario(total, categories, initial = {}, owned = null, katFehler = false, examples = {ok:false,d:{}}) {
  let rendered = [], requests = [], fail = false, scroll = 0, moreButton, duplicate = false;
  const context = {
    document:{get activeElement() {return activeElement;}}, window:{scrollY:0,scrollTo:(_x,y)=>{scroll=y;},addEventListener:()=>{},removeEventListener:()=>{}},
    formatBetrag:()=> '49,00 EUR', URLSearchParams, T:texte[0], t:(key,args) => { let s=texte[0][key] || key; for(const [k,v] of Object.entries(args || {})) s=s.replaceAll('{'+k+'}',v); return s; },
    h:(tag,props,...children) => { const el=new Dom(tag,props,children); if(tag==='button' && children.includes(texte[0].k1_mehr)) moreButton=el; return el; },
    location:{hash:'#/'}, ich:{angemeldet:owned !== null}, DEMO:false, verkaufPausiert:false,
    betoltes:() => {}, verkaufLaden:async () => {}, demoBox:async () => null, hero:() => null,
    zeigen:(...nodes) => { rendered = nodes; }, titelbild:() => null, arText:() => 'free',
    api:async (_method,path) => {
      requests.push(path);
      if(path === '/api/beispiele') {if(examples instanceof Error) throw examples;return examples;}
      if(path === '/api/meine-kurse') return owned;
      if(path === '/api/kategorien') return katFehler ? {ok:false,d:{}} : {ok:true,d:categories};
      if (fail) return {ok:false,status:400,d:{fehler:'katalog_parameter_ungueltig'}};
      const page=Number(new URLSearchParams(path.split('?')[1]).get('seite'));
      const n=Math.max(0,Math.min(12,total-(page-1)*12));
      return {ok:true,d:{kurse:Array.from({length:n},(_,i)=>({id:(page-1)*12+i+1-(duplicate && page>1 ? 1 : 0),titel:'<img onerror=x>',preis_cent:0})).reverse(),gesamt:total,seite:total ? page : 1,seiten:Math.ceil(total/12)}};
    }
  };
  vm.createContext(context); vm.runInContext(katalog,context); context.initial=initial; vm.runInContext('k1ShopZustand = initial',context); await context.eloadasok();
  const section=rendered.find(n => n?.props?.class === 'szakasz'), [toolbar,live,error,grid,empty]=section.children, more=moreButton;
  return {toolbar,live,error,grid,empty,more,requests,context,rendered:()=>rendered,scroll:()=>scroll,total:n=>{total=n;},duplicate:()=>{duplicate=true;},fail:() => {fail=true;}};
}

const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const examples of [{ok:false,d:{}},new Error('offline')]) {
 const result=await scenario(2,[],{},{ok:true,d:[{id:1}]},false,examples);await tick();
 assert.equal(result.grid.children.length,2);
 assert.equal(result.grid.children[0].querySelectorAll('a')[0].props.href,'#/eloadas/1');
 assert.equal(result.empty.hidden,true);
}
for(const examples of [{ok:false,d:{}},{ok:true,d:{vorhanden:false}},{ok:true,d:{vorhanden:true,kurse:[course]}}]) {
 const result=await scenario(0,[],{},null,false,examples);await tick();
 assert.equal(result.empty.hidden,!!examples.d.vorhanden);
}
// Detailstruktur: vorhandene responsive Kursklassen, nur Shop-Rücklink.
response={ok:true,d:course};await c.beispielSeite(1);
assert.match(rendered[0].props.class,/hero hero-kurs/);
assert.match(text(rendered[0]),/BEISPIEL · Nicht buchbar/);
const info=all(rendered[1]).find(n=>n.props.class==='preis-kasten');
assert.ok(info);assert.match(text(info),/Dies ist ein Beispiel/);
assert.equal(rendered.flatMap(all).filter(n=>n.tag==='button').length,0);
assert.deepEqual(rendered.flatMap(all).filter(n=>n.tag==='a').map(n=>n.props.href),['#/']);
// Tatsächliche Weiche für ungültige ID ausführen.
const routeSource=shop.slice(shop.indexOf('async function route()'),shop.indexOf("    case 'kurs':"))+'  }\n}';
Object.assign(c,{ersteRoute:false,schutzAbschalten(){},ujUzenet:null,idErlaubt:id=>/^[1-9]\d*$/.test(id),URLSearchParams});
vm.runInContext(routeSource,c);c.location.hash='#/beispiel/abc';await c.route();
assert.equal(rendered[0],langs[0].s2_nicht_gefunden);assert.equal(rendered[1].props.href,'#/');
// Admin: Kennzeichnung aus API-Zeile; Aktionen erst nach Status-/Listenabruf.
const adminSource=admin.slice(admin.indexOf('function baueKatalogQuery('),admin.indexOf('function k1KategorienBereich('));
let adminCalls=[], statusFails=true, exists=true, writeCalls=[], stepups=0, opened;
const adminCtx=vm.createContext({URLSearchParams,T:langs[0],t:k=>langs[0][k]||k,
 h:(tag,props,...children)=>new Dom(tag,props,children),statusPlakette:()=>null,preisText:()=>'',meldung(){},kurs:id=>opened=id,
 bestaetigen:(_key,fn)=>fn(),stepupAnfordern:async()=>{stepups++;return true;},
 api:async(method,path)=>{
  adminCalls.push([method,path]);
  if(method!=='GET') {writeCalls.push([method,path]);if(writeCalls.length%2===1)return {status:401,d:{fehler:'stepup_noetig'}};exists=method!=='DELETE';return {ok:true};}
  if(path==='/api/admin/beispiele/status')return statusFails?{ok:false,d:{}}:{ok:true,d:exists?{vorhanden:true}:{anlegbar:true}};
  if(path==='/api/beispiele')return {ok:true,d:{kurse:exists?[{id:1}]:[]}};
  if(path.includes('/kategorien'))return {ok:true,d:[{id:7,name_de:'Kategorie'}]};
  return {ok:true,d:{seite:2,seiten:3,gesamt:30,kurse:[{id:1,titel:'Muster',beispiel_key:'planen',preis_cent:0},{id:2,titel:'Normal',beispiel_key:null,preis_cent:0}]}};
 }});
vm.runInContext(step,adminCtx);vm.runInContext(adminSource,adminCtx);
vm.runInContext("k1AdminZustand={q:'needle',status:'entwurf',preis:'gratis',kategorie:'7',sort:'name',seite:2}",adminCtx);
const list=adminCtx.k1AdminKatalog();await tick();
let statusBox=adminCtx.s2AdminBereich(()=>list.k1Refresh());await tick();
const cards=()=>list.children[3].children;
assert.match(text(cards()[0]),/Beispiel/);
assert.equal(cards()[0].querySelectorAll('button').length,1);
cards()[0].querySelectorAll('button')[0].props.onclick();assert.equal(opened,1);
statusFails=false;statusBox=adminCtx.s2AdminBereich(()=>list.k1Refresh());await tick();await tick();
assert.equal(cards()[0].querySelectorAll('button').length,2);
assert.equal(cards()[1].querySelectorAll('button').length,1);
for(const action of ['adopt','delete','create']) {
 const before=adminCalls.length;
 if(action==='adopt')await cards()[0].querySelectorAll('button')[1].props.onclick();
 else await statusBox.querySelectorAll('button')[0].props.onclick();
 await tick();
 const writes=adminCalls.slice(before).filter(([m])=>m!=='GET');
 assert.equal(writes.length,2);
 assert.equal(writes[0][0],action==='delete'?'DELETE':'POST');
 assert.equal(writes[0][1],action==='adopt'?'/api/admin/beispiele/1/uebernehmen':'/api/admin/beispiele');
 const query=new URLSearchParams(adminCalls.filter(([m,p])=>m==='GET'&&p.startsWith('/api/admin/kurse?')).at(-1)[1].split('?')[1]);
 for(const [key,value] of Object.entries({q:'needle',status:'entwurf',preis:'gratis',kategorie:'7',sort:'name',seite:'2'}))assert.equal(query.get(key),value);
}
assert.equal(stepups,3);
console.log('S2-Nachtrag: echte Shop-/Admin-Abläufe, Statusausfall, Step-up-Klicks, Zustand, Fehlerroute und Detailstruktur bestanden.');
