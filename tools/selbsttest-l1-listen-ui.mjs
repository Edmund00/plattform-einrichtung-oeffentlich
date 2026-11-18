// L1: echte Darstellungsfunktionen in isolierten VMs, ohne Server/Storage.
import { readFileSync as read } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const admin=read('public/admin/admin.js','utf8');
const helper=admin.slice(admin.indexOf('const listenAnzeige ='),admin.indexOf('function katalogFehler('));
const dom=admin.slice(admin.indexOf('function h('),admin.indexOf('// Passwort'));
const fn=name=>{const start=admin.search(new RegExp('^(?:async )?function '+name+'\\(','m'));assert.ok(start>=0,name);const rest=admin.slice(start);const end=rest.slice(1).search(/^(?:async )?function \w+\(/m);return end<0?rest:rest.slice(0,end+1);};
let focus;
class El {
 constructor(tag){this.tag=tag;this.children=[];this.props={};this.listeners={};this.textContent='';}
 setAttribute(k,v){this.props[k]=v;}
 append(...nodes){for(const n of nodes){if(n instanceof El)n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 addEventListener(k,v){this.listeners[k]=v;}
 remove(){this.parent.children=this.parent.children.filter(n=>n!==this);}
 focus(){focus=this;}
 click(){focus=this;return this.listeners.click?.();}
}
const all=n=>n instanceof El?[n,...n.children.flatMap(all)]:[];
const texts=['de','en','hu'].map(l=>JSON.parse(read('texte/'+l+'.json','utf8')));
const placeholders=s=>[...s.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
for(const key of ['liste_gesamt','liste_gesamt_mindestens','liste_mehr','liste_leer']) for(const T of texts){assert.equal(typeof T[key],'string');assert.deepEqual(placeholders(T[key]),key==='liste_leer'?[]:['{n}']);}
function context(T=texts[0],extra={}){
 const c=vm.createContext({document:{createElement:tag=>new El(tag)},t:(k,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),T[k]||k),...extra});
 vm.runInContext(dom+helper,c);return c;
}
for(const T of texts)for(const n of [0,1,20,21,45,300,1000]){
 const c=context(T), box=new El('section');let built=0;
 c.listeMitMehr(box,Array.from({length:n},(_,i)=>i),i=>{built++;return c.h('article',{},'<img onerror=x> '+i);});
 if(!n){assert.equal(box.children.length,1);assert.equal(box.children[0].children[0],T.liste_leer);continue;}
 const [count,rows,button]=box.children;
 assert.equal(count.props.role,'status');assert.equal(count.props['aria-live'],'polite');assert.equal(count.children[0],T.liste_gesamt.replace('{n}',n));
 assert.equal(rows.children.length,Math.min(20,n));assert.equal(built,Math.min(20,n));
 const first=rows.children[0];let visible=Math.min(20,n);
 while(visible<n){assert.ok(box.children.includes(button));assert.equal(button.props.type,'button');assert.equal(button.textContent,T.liste_mehr.replace('{n}',n-visible));button.click();const before=visible;visible=Math.min(n,visible+20);assert.equal(rows.children.length,visible);assert.equal(built,visible);assert.equal(rows.children[0],first);assert.equal(focus,visible===n?rows.children[before]:button);}
 assert.ok(!box.children.includes(button));assert.equal(count.children[0],T.liste_gesamt.replace('{n}',n));
 assert.equal(rows.children[0].children[0],'<img onerror=x> 0');assert.equal(all(box).filter(e=>e.props.role==='status').length,1);
}
const custom=context(), box=new El('div');custom.listeMitMehr(box,[],()=>{}, {leerText:'vorhanden'});assert.equal(box.children[0].children[0],'vorhanden');
let shown;custom.listeMitMehr(box,Array(100).fill(0),()=>new El('article'),{sichtbar:60,beimAnzeigen:n=>shown=n});assert.equal(shown,60);assert.equal(box.children[1].children.length,60);
custom.listeMitMehr(box,Array(21).fill(0),()=>new El('article'),{proSeite:7});assert.equal(box.children[1].children.length,7);box.children[2].click();assert.equal(box.children[1].children.length,14);
assert.doesNotMatch(helper,/innerHTML|outerHTML|insertAdjacentHTML|Storage|cookie|\bapi\(/);
for(const [name,count] of [['abgleichBereich',2],['agentBereich',3],['adminLogins',1],['verkaufBereich',1],['k1KategorienBereich',1],['uebersicht',1],['widerrufeLaden',1],['widerrufeErledigtLaden',1]])assert.equal([...fn(name).matchAll(/listeMitMehr\(/g)].length,count,name);
assert.match(fn('ereignisseBereich'),/p.set\('seite',String\(seite\)\)/);assert.match(fn('ereignisseBereich'),/zurueck.disabled=seite<=1;weiter.disabled=seite>=seiten/);
assert.doesNotMatch(fn('k1AdminKatalog'),/listeMitMehr/);
// Real row builders: integration at 45 entries, preserved actions and error branches.
for(const name of ['abgleichBereich','agentBereich','adminLogins','verkaufBereich','widerrufeLaden','widerrufeErledigtLaden']){
 let rendered=[],requests=0,fail=false;
 const entries=Array.from({length:45},(_,id)=>({id,zeit:'2026-11-17',ende:'2026-11-17',art:'aendern',text:'abgleich_alt',ergebnis:'bearbeitung',vorher:null,nachher:null}));
 const data=name==='abgleichBereich'?{abweichungen:entries,verlauf:entries}:name==='verkaufBereich'?{protokoll:entries}:entries;
 const c=context(texts[0],{api:async()=>{requests++;return fail?{ok:false,d:{text:'Fehler erhalten'}}:{ok:true,d:data};},zeigen:(...n)=>rendered=n,kopf:()=>new El('header'),uebersicht:()=>{},fehlerText:r=>r.d.text,budapestZeit:String,wert:(_k,v)=>String(v),agentAnzeige:(_k,v)=>String(v),agentZiel:String,kurs:()=>{},bestaetigen:()=>{},formatBetrag:String,WIDERRUF_STATUS:{bearbeitung:'ellallas_inhaber_bearbeitung'}});
 vm.runInContext(fn(name),c);const target=new El('div');await c[name](target);
 const nodes=name.startsWith('widerrufe')?all(target):rendered.flatMap(all), lists=nodes.filter(e=>e.className==='liste-zeilen');assert.ok(lists.length,name);for(const list of lists)assert.equal(list.children.length,20,name);
 const before=requests;nodes.find(e=>e.className?.includes('liste-mehr')).click();assert.equal(requests,before,'Mehr ohne Request');
 await c[name](target);const rebuilt=name.startsWith('widerrufe')?all(target):rendered.flatMap(all);for(const list of rebuilt.filter(e=>e.className==='liste-zeilen'))assert.equal(list.children.length,list===rebuilt.find(e=>e.className==='liste-zeilen')?40:20,name+' Neuaufbau');
 fail=true;await c[name](target);const errorNodes=name.startsWith('widerrufe')?all(target):rendered.flatMap(all);assert.ok(errorNodes.some(e=>e.children.includes('Fehler erhalten')),name);
}
// Kategorien: echte Löschaktion lädt neu und erhält 40 sichtbare Zeilen.
let entries=Array.from({length:45},(_,id)=>({id,name_de:'Kategorie '+id})),calls=[];
const c=context(texts[0],{api:async(method,path)=>{calls.push([method,path]);return {ok:true,d:entries};},apiMitStepup:async()=>({ok:true}),k1KategorieName:c=>c.name_de,katalogFehler:()=>'',bestaetigen:(_key,action)=>action()});
vm.runInContext(fn('k1KategorienBereich'),c);const categories=c.k1KategorienBereich();await new Promise(r=>setImmediate(r));
let rows=all(categories).find(e=>e.className==='liste-zeilen');assert.equal(rows.children.length,20);all(categories).find(e=>e.className?.includes('liste-mehr')).click();assert.equal(rows.children.length,40);
await rows.children[0].children.at(-1).click();rows=all(categories).find(e=>e.className==='liste-zeilen');assert.equal(rows.children.length,40);assert.equal(calls.length,2);
const css=read('public/admin/admin.css','utf8');assert.match(css,/\.liste-mehr\{[^}]*min-height:48px/);assert.match(css,/\.liste-mehr:focus-visible/);
for(const p of ['tools/selbsttest-alle.sh','tools/Selbsttest-Alle.ps1'])assert.ok(read(p,'utf8').includes('l1-listen-ui'));
console.log('L1-Listen-UI: Grenzwerte, drei Sprachen, Fokus, Anhängen, Aktionen, Fehler und Quellverträge bestanden.');

// N1: begrenzte Serverantworten und Zustand je Liste, ohne dauerhafte Speicherung.
for(const T of texts)for(const [n,serverGrenze,key] of [[199,200,'liste_gesamt'],[200,200,'liste_gesamt_mindestens'],[200,undefined,'liste_gesamt']]){
 const c=context(T),box=new El('div');c.listeMitMehr(box,Array(n).fill(0),()=>new El('p'),{serverGrenze});
 assert.equal(box.children[0].children[0],T[key].replace('{n}',n));
}
const state=context(texts[0],{api:async()=>({ok:true}),meldung:()=>{},anmeldung:()=>{}}),stateBox=new El('div');
const rebuild=(key,n=45)=>state.listeMitMehr(stateBox,Array(n).fill(0),()=>new El('p'),{schluessel:key});
rebuild('eins');stateBox.children[2].click();assert.equal(stateBox.children[1].children.length,40);
rebuild('eins');assert.equal(stateBox.children[1].children.length,40);
rebuild('zwei');assert.equal(stateBox.children[1].children.length,20);
rebuild('eins',25);assert.equal(stateBox.children[1].children.length,25);
rebuild('eins',0);rebuild('eins');assert.equal(stateBox.children[1].children.length,20);
stateBox.children[2].click();vm.runInContext(fn('abmelden'),state);await state.abmelden();
rebuild('eins');assert.equal(stateBox.children[1].children.length,20);
const limits={pruefzahlungen:200,widerrufe:200,widerrufeErledigt:200,adminLogins:100,agentProtokoll:200,verkaufProtokoll:50,abgleichVerlauf:30,sicherungProtokoll:100};
for(const [key,n] of Object.entries(limits)){
 assert.match(admin,new RegExp(key+':'+n+'\\b'));
 assert.match(admin,new RegExp("schluessel:'"+key+"', serverGrenze:LISTEN_GRENZEN\\."+key));
}
assert.match(fn('sicherungBereich'),/listeMitMehr\(h\('div',\{\}\),info.eintraege/);
assert.match(admin,/listeMitMehr\(zugangListe, zugangAntwort.d/);
assert.match(admin,/listeMitMehr\(h\('div',\{\}\), aboAntwort.d/);
assert.match(admin,/listeMitMehr\(h\('div',\{\}\), lecken/);
for(const key of ['kursZugaenge','kursAbos','kursLektionen'])assert.match(admin,new RegExp("schluessel:'"+key+":'\\+id"));
assert.doesNotMatch(admin,/serverGrenze:LISTEN_GRENZEN\.(?:kursZugaenge|kursAbos|kategorien)/);
console.log('L1-N1: Servergrenzen, Kurslisten, Sicherungen, Anzeigezustand und Abmelden bestanden.');

const ordered=context(),olBox=new El('div');ordered.listeMitMehr(olBox,Array(21).fill(0),()=>new El('li'),{zeilenTag:'ol'});assert.equal(olBox.children[1].tag,'ol');assert.ok(olBox.children[1].children.every(e=>e.tag==='li'));
