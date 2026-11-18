import {readFileSync as read} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const admin=read('public/admin/admin.js','utf8');
const source=admin.slice(admin.indexOf('// E7:'),admin.indexOf('// ---- Liste der Kurse'));
const langs=['de','en','hu'].map(l=>JSON.parse(read(`texte/${l}.json`,'utf8')));
for(const key of [...source.matchAll(/t\('(e7_\w+)'/g)].map(m=>m[1]).concat(['e7_marke','e7_kurs'])) for(const l of langs)assert.ok(l[key],key);
for(const [k,v] of Object.entries(langs[2]).filter(([k])=>k.startsWith('e7_')))assert.doesNotMatch(v,/kurzus|tanfolyam/i,k);
assert.doesNotMatch(source,/innerHTML|localStorage|sessionStorage|document\.cookie|style:/);
class El{
 constructor(tag,props={},children=[]){Object.assign(this,{tag,props,children:children.flat(Infinity).filter(x=>x!=null),removed:false});}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 remove(){this.removed=true;}
}
const all=n=>[n,...(n.children||[]).flatMap(x=>typeof x==='object'?all(x):[])];
const text=n=>all(n).flatMap(n=>n.children||[]).filter(x=>typeof x==='string').join(' ');
const tick=()=>new Promise(r=>setImmediate(r));
async function scenario(marke,beispiele,kurse,lang=langs[0]){
 let brand=0,course=0,requests=[];
 const c=vm.createContext({h:(tag,p,...ch)=>new El(tag,p,ch),t:k=>lang[k],markeBereich:()=>brand++,neuerKurs:()=>course++,api:async(method,path)=>{
  requests.push([method,path]);const result=path.endsWith('/marke')?marke:path.endsWith('/status')?beispiele:kurse;
  if(result instanceof Error)throw result;return result===null?{ok:false}:{ok:true,d:result};
 }});
 vm.runInContext(source,c);const box=c.e7NaechsteSchritte();assert.equal(text(box),lang.e7_laden);await tick();
 return {box,requests,counts:()=>[brand,course]};
}
for(const lang of langs){
 const {box,counts,requests}=await scenario({}, {anlegbar:true},[],lang);
 assert.equal(box.removed,false);assert.match(text(box),new RegExp(lang.e7_titel));assert.ok(text(box).includes(lang.e7_optional));
 const buttons=all(box).filter(n=>n.tag==='button');assert.equal(buttons.length,2);buttons.forEach(n=>n.props.onclick());assert.deepEqual(counts(),[1,1]);assert.ok(requests.every(([m])=>m==='GET'));
}
for(const m of [{hat_logo:true},{name:'Eigene Marke',standard:false}]){
 const {box}=await scenario(m,{},[{beispiel_key:null,status:'veroeffentlicht'}]);assert.equal(box.removed,true);
}
{ // F-296: Standardname ohne Logo gilt nicht als erledigt (echte Serverform: standard ist Boolean)
 const {box}=await scenario({name:'Musterakademie',standard:true},{},[{beispiel_key:null,status:'veroeffentlicht'}]);assert.equal(box.removed,false);
}
for(const k of [{beispiel_key:'demo',status:'veroeffentlicht'},{beispiel_key:null,status:'entwurf'}]){
 const {box}=await scenario({hat_logo:true},{},[k]);assert.equal(box.removed,false);assert.equal(all(box).filter(n=>n.tag==='button').length,1);
}
const completed=await scenario({}, {}, {kurse:[{beispiel_key:'',status:'veroeffentlicht'}]});assert.ok(text(completed.box).includes('✓'));assert.ok(text(completed.box).includes('Erledigt'));assert.equal(all(completed.box).filter(n=>n.tag==='button').length,1);
for(const status of [{vorhanden:true},{anlegbar:true},{}]){
 const {box}=await scenario({},status,[]);const links=all(box).filter(n=>n.tag==='a');assert.equal(links.length,status.vorhanden?1:0);
 if(links.length)assert.deepEqual({...links[0].props},{class:'knopf hell',href:'/',target:'_blank',rel:'noopener noreferrer'});
}
for(const failure of [null,new Error('offline')]){
 const {box}=await scenario(failure,failure,failure);assert.equal(box.removed,false);assert.equal(all(box).filter(n=>n.tag==='button').length,2);assert.ok(!text(box).includes('✓'));
 for(const index of [0,1,2]){const inputs=[{}, {}, []];inputs[index]=failure;const result=await scenario(...inputs);assert.equal(result.box.removed,false);}
}
// Bestehende extrahierte Testbereiche bleiben von der Ergänzung frei.
for(const test of ['k1-katalog-ui','s2-beispiele-ui']){
 const prior=read(`tools/selbsttest-${test}.mjs`,'utf8');assert.ok(prior.includes('admin.slice'));
}
const integration=admin.slice(admin.indexOf('async function uebersicht()'),admin.indexOf('  void bunnyLage',admin.indexOf('async function uebersicht()')));
assert.match(integration,/e7NaechsteSchritte\(\), kpiBox, hauptReihe, s2AdminBereich\(\(\) => katalog.k1Refresh\(\)\), katalog/);
assert.doesNotMatch(integration,/await e7/);
const css=read('public/admin/admin.css','utf8');assert.match(css,/\.einr-naechste \.knopf\{[^}]*min-height:48px/);assert.match(css,/\.einr-naechste :focus-visible/);
console.log('E7: VM-Abläufe, Erledigung, Teilausfälle, Aktionen, Integration, sichere Texte und drei Sprachen bestanden.');

// Die wirkliche Übersicht bis zur unveränderten Bestellungsverwaltung ausführen.
const overview=admin.slice(admin.indexOf('async function uebersicht()'),admin.indexOf('  const b = await api',admin.indexOf('async function uebersicht()')))+'}';
for(const failure of [null,new Error('offline')]){
 let rendered, refresh=0;
 const catalog=new El('catalog');catalog.k1Refresh=()=>refresh++;
 const c=vm.createContext({h:(tag,p,...ch)=>new El(tag,p,ch),t:k=>langs[0][k]||k,
  zeigen:(...nodes)=>rendered=nodes,kopf:()=>new El('header'),k1AdminKatalog:()=>catalog,
  s2AdminBereich:()=>new El('examples'),k1KategorienBereich:()=>new El('categories'),ereignisseBereich:()=>new El('events'),
  api:async()=>{if(failure instanceof Error)throw failure;return {ok:false};}
 });
 for(const name of ['verkaufBereich','neuerKurs','kurspaketImport','agentBereich','sicherungBereich','abgleichBereich','adminLogins','markeBereich','testkaufBereich','kennzahlenLaden','bunnyLage','widerrufeLaden','widerrufeErledigtLaden']) c[name]=()=>{};
 vm.runInContext(source+overview,c);await c.uebersicht();await tick();
 assert.ok(rendered.includes(catalog));assert.equal(catalog.children.length,0);assert.equal(refresh,0);
 const card=rendered.find(n=>n.props.class==='karte einr-naechste');assert.ok(card);assert.equal(all(card).filter(n=>n.tag==='button').length,2);
}
console.log('E7: Echte Übersicht bei HTTP-/Netzfehlern mit unversehrtem Katalog bestanden.');
