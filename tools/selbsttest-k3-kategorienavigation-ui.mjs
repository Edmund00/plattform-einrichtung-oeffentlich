// K3: echte Shop-Funktionen in isolierten DOM-/API-VMs, ohne Server.
import {readFileSync as read} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const shop=read('public/kunde.js','utf8'), css=read('public/kunde.css','utf8');
const langs=['de','en','hu'].map(l=>JSON.parse(read('texte/'+l+'.json','utf8')));
const katalog=shop.slice(shop.indexOf('function baueKatalogQuery('),shop.indexOf('// ---- Kursseite:'));
const layout=shop.slice(shop.indexOf('function kopfzeile()'),shop.indexOf('function hero('));
const routing=shop.slice(shop.indexOf('async function route()'),shop.indexOf("let LOC ="));
let activeElement;
class El {
 constructor(tag,props={},children=[]) {Object.assign(this,{tag,props,children:[],dataset:{},value:props.value||'',hidden:!!props.hidden,isConnected:true,open:false,textContent:''});this.append(...children);}
 append(...nodes) {for(const n of nodes.flat(Infinity).filter(n=>n!=null&&n!==false)){if(n instanceof El){n.parentNode=this;n.isConnected=true;}this.children.push(n);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.props[k]=v;}
 removeAttribute(k){delete this.props[k];}
 addEventListener(k,fn){this.props['on'+k]=fn;}
 querySelectorAll(s){return this.children.flatMap(n=>n instanceof El?[...(s.split(',').includes(n.tag)?[n]:[]),...n.querySelectorAll(s)]:[]);}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.isConnected=false;}
 focus(){activeElement=this;}
 contains(n){return all(this).includes(n);}
}
const h=(tag,props,...children)=>new El(tag,props,children);
const all=n=>n instanceof El?[n,...n.children.flatMap(all)]:[];
const nodes=roots=>roots.flatMap(all);
const text=n=>n instanceof El?[n.textContent,...n.children.map(text)].join(' '):String(n??'');
const links=n=>all(n).filter(n=>n.tag==='a');
const tick=()=>new Promise(r=>setImmediate(r));
function scenario(n,{failure=false,desktop=false,lang=0}={}) {
 let rendered=[],requests=[];
 const listeners=new Map();
 const categories=Array.from({length:n},(_,i)=>({id:i+1,name:i===0?'Ärger & <script>':'Sport '+(i+1),anzahl:30}));
 const T={...langs[lang],_sprache:['de','en','hu'][lang],_locale:['de-DE','en-GB','hu-HU'][lang]};
 const c=vm.createContext({h,T,URLSearchParams,ich:{angemeldet:false},DEMO:false,verkaufPausiert:false,
  location:{hash:'#/',origin:'https://shop.example'},LOGO:{quer:()=>'/logo',vertikal:()=>'/logo'},sprachwahl:()=>null,ellallasTitel:()=> 'Widerruf',
  t:(k,args={})=>Object.entries(args).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),T[k]||k),
  document:{addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:(k,fn)=>{if(listeners.get(k)===fn)listeners.delete(k);},get activeElement(){return activeElement;},querySelectorAll:()=>nodes(rendered).filter(n=>n.props.class==='kopf-kategorien'&&n.open)},
  window:{scrollY:0,scrollTo(){},addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:desktop})},
  betoltes(){},verkaufLaden:async()=>{},demoBox:async()=>null,hero:()=>h('h1',{},'Katalog'),titelbild:()=>null,arText:()=> '0',formatBetrag:()=> '0',
  zeigen:(...n)=>{rendered=n.filter(Boolean);},
  fehlerAnsicht:(s,...n)=>{rendered=[h('h1',{},s),...n];},
  idErlaubt:id=>/^[1-9]\d{0,15}$/.test(String(id)),ersteRoute:false,schutzAbschalten(){},ujUzenet:null,meldung(){},
  gehe:ziel=>{c.location.hash='#/'+ziel;},
  api:async(_m,path)=>{
   requests.push(path);
   if(path==='/api/kategorien'){if(failure==='throw')throw Error('offline');return failure?{ok:false,d:{}}:{ok:true,d:categories};}
   if(path==='/api/beispiele')return {ok:true,d:{vorhanden:false}};
   const q=new URLSearchParams(path.split('?')[1]),page=Number(q.get('seite')||1);
   return {ok:true,d:{gesamt:30,seite:page,seiten:3,kurse:Array.from({length:page===3?6:12},(_,i)=>({id:(page-1)*12+i+1,titel:'Kurs',preis_cent:0}))}};
  }});
 vm.runInContext(katalog+'\n'+layout+'\n'+routing,c);
 return {c,T,categories,requests,listeners,recover:()=>{failure=false;},rendered:()=>rendered,run:s=>vm.runInContext(s,c)};
}
for(const lang of [0,1,2])for(const n of [0,1,8,9,100]) {
 const s=scenario(n,{lang});await s.c.k3Laden();await s.c.k3Laden();
 assert.equal(s.requests.filter(p=>p==='/api/kategorien').length,1);
 const head=s.c.kopfzeile(),foot=s.c.fusszeile(),chips=s.c.k3Chips();
 assert.equal(all(head).filter(n=>n.tag==='details').length,n?1:0);
 for(const block of [head,foot,chips]){
  const ls=links(block),cats=ls.filter(n=>n.props.href.startsWith('#/kategorie/'));
  assert.equal(cats.length,Math.min(n,8));
  assert.deepEqual(cats.map(n=>n.props.href),s.categories.slice(0,8).map(c=>'#/kategorie/'+c.id));
  assert.equal(ls.some(n=>n.props.href==='#/kategorien'),n>8);
 }
 assert.equal(all(foot).filter(n=>n.tag==='details')[0]?.open,n?false:undefined);
 const legal=all(foot).find(n=>n.props.class==='fuss-links');assert.equal(links(legal).length,5);
 assert.deepEqual(links(legal).map(n=>n.props.href),['https://shop.example/jogi/impresszum/','https://shop.example/jogi/adatvedelem/','https://shop.example/jogi/reszveteli-feltetelek/','#/fiokom','#/elallasi-tajekoztato']);
 if(n){assert.equal(links(chips)[0].props['aria-current'],'page');assert.equal(links(s.c.k3Chips('1'))[1].props['aria-current'],'page');
 const details=all(head).find(n=>n.tag==='details');details.open=true;details.props.onkeydown({key:'Escape'});assert.equal(details.open,false);assert.equal(activeElement,details.children[0]);
 details.open=true;details.props.onclick({target:{closest:()=>links(details)[0]}});assert.equal(details.open,false);}
 await s.c.eloadasok();assert.equal(s.requests.filter(p=>p==='/api/kategorien').length,1);
 assert.equal(nodes(s.rendered()).filter(n=>n.props.class==='kurzus-racs')[0].children.length,12);
}
for(const failure of [true,'throw']){const s=scenario(9,{failure});await s.c.eloadasok();assert.equal(s.c.k3Details(),null);assert.equal(s.c.k3Chips(),null);assert.equal(nodes(s.rendered()).filter(n=>n.props.class==='kurzus-racs')[0].children.length,12);assert.doesNotMatch(s.rendered().map(text).join(' '),/konnten nicht geladen/);}
const concurrent=scenario(9);await Promise.all([concurrent.c.k3Laden(),concurrent.c.k3Laden(),concurrent.c.k3Laden()]);assert.equal(concurrent.requests.filter(p=>p==='/api/kategorien').length,1);
const d=scenario(1,{desktop:true});await d.c.k3Laden();assert.equal(d.c.k3Details(true).open,true);
// Alle-Kurse-Link räumt einen früheren Kategorienfilter auf; Browser-Zurück hält Kategorie-Seiten getrennt.
const home=scenario(9);await home.c.k3Laden();home.run("k1ShopZustand={kategorie:'2',q:'Suche'}");
links(home.c.k3Chips('2'))[0].props.onclick();await home.c.eloadasok();
assert.equal(new URLSearchParams(home.requests.at(-1).split('?')[1]).has('kategorie'),false);
assert.equal(new URLSearchParams(home.requests.at(-1).split('?')[1]).get('q'),'Suche');
// Sprachwechsel leert den Dokumentcache.
d.c.T._sprache='en';await d.c.k3Laden();assert.equal(d.requests.filter(p=>p==='/api/kategorien').length,2);
for(const id of ['1','999','','abc','0','-1','1/extra','90071992547409999']) {
 const s=scenario(9);s.c.location.hash='#/kategorie/'+id;await s.c.route();
 const ns=nodes(s.rendered());
 if(id==='1'){
  assert.equal(text(ns.find(n=>n.tag==='h1')).trim(),s.categories[0].name);
  const crumb=ns.find(n=>n.tag==='nav'&&n.props['aria-label']===s.T.k3_breadcrumb);assert.ok(crumb);assert.equal(all(crumb).find(n=>n.props['aria-current']==='page').children[0],s.categories[0].name);
  assert.ok(s.requests.some(p=>new URLSearchParams(p.split('?')[1]).get('kategorie')==='1'));
  const toolbar=ns.find(n=>n.tag==='form');const search=toolbar.querySelectorAll('input')[0];search.value='Sport';await toolbar.props.onsubmit({preventDefault(){}});await tick();
  assert.equal(new URLSearchParams(s.requests.at(-1).split('?')[1]).get('kategorie'),'1');
  // Mehr, Zurück zur Übersicht und wieder auf die teilbare Kategorie-Adresse.
  await ns.find(n=>n.tag==='button'&&n.children.includes(s.T.k1_mehr)).props.onclick();
  s.c.location.hash='#/kategorien';await s.c.route();s.c.location.hash='#/kategorie/1';await s.c.route();
  assert.ok(s.requests.some(p=>p.includes('kategorie=1')&&p.includes('seite=2')));
 }else{assert.ok(ns.some(n=>n.tag==='h1'&&text(n).includes(s.T.k3_nicht_gefunden)));assert.ok(ns.some(n=>n.tag==='a'&&n.props.href==='#/'));}
}
const s=scenario(100);s.c.location.hash='#/kategorien';await s.c.route();
let ns=nodes(s.rendered());let list=ns.find(n=>n.props.class==='k3-liste');assert.equal(links(list).length,24);
let more=ns.find(n=>n.tag==='button');assert.equal(more.textContent,s.T.liste_mehr.replace('{n}','76'));
for(const expected of [48,72,96,100]){more.focus();more.props.onclick();assert.equal(links(list).length,expected);}
assert.equal(more.hidden,true);assert.equal(activeElement,links(list)[96]);
const search=ns.find(n=>n.tag==='input');search.value='A\u0308RGER';search.props.oninput();ns=nodes(s.rendered());list=ns.find(n=>n.props.class==='k3-liste');assert.equal(links(list).length,1);assert.match(text(list),/Ärger & <script>/);
search.value='keine solche Kategorie';search.props.oninput();assert.ok(s.rendered().map(text).join(' ').includes(s.T.k3_leer));
search.value='';search.props.oninput();assert.equal(links(nodes(s.rendered()).find(n=>n.props.class==='k3-liste')).length,24);
const empty=scenario(0);empty.c.location.hash='#/kategorien';await empty.c.route();assert.ok(empty.rendered().map(text).join(' ').includes(empty.T.k3_leer));
// Außenklick und Routennavigation schließen nur das Kopfmenü.
const head=s.c.kopfzeile();s.c.zeigen(head);const details=all(head).find(n=>n.tag==='details');details.open=true;s.c.k3Schliessen({target:details.children[0]});assert.equal(details.open,true);s.c.k3Schliessen({target:h('div')});assert.equal(details.open,false);details.open=true;s.c.k3Schliessen();assert.equal(details.open,false);
const keys=Object.keys(langs[0]).filter(k=>k.startsWith('k3_'));
for(const l of langs){assert.deepEqual(Object.keys(l).filter(k=>k.startsWith('k3_')).sort(),[...keys].sort());for(const k of keys){assert.equal(typeof l[k],'string');assert.deepEqual(l[k].match(/\{\w+\}/g),langs[0][k].match(/\{\w+\}/g));}}
for(const k of keys)assert.doesNotMatch(langs[2][k],/kurzus|tanfolyam/i);
assert.doesNotMatch(shop,/localStorage|sessionStorage|document\.cookie/);
assert.doesNotMatch(katalog,/innerHTML|outerHTML|insertAdjacentHTML|\.style\b|setAttribute\(['"]style/);
assert.match(css,/\.k3-chips\{[^}]*overflow-x:auto/);assert.match(css,/\.k3-chips a\{[^}]*min-height:44px/);assert.match(css,/\.k3-chips a:focus-visible/);assert.match(css,/\.menue\{flex-wrap:wrap\}/);
assert.doesNotMatch(css.slice(css.indexOf('/* K3:')),/#[\da-f]{3,8}\b|rgba?\(/i);
for(const f of ['public/kunde.js','public/kunde.css','tools/de/teil3.mjs','tools/en/teil3.mjs'])assert.doesNotMatch(read(f,'utf8'),/(?<!\r)\n/);
for(const f of ['tools/selbsttest-alle.sh','tools/Selbsttest-Alle.ps1'])assert.ok(read(f,'utf8').includes('k3-kategorienavigation-ui'));
console.log('K3: Navigation 0/1/8/9/100, Cache/Fehler, Routen/Katalog, Suche/24er-Liste/Fokus, Rechtslinks und drei Sprachen bestanden.');

// Nachtrag: echte Filteraktionen und Navigation; K1d prüft separat die Detail-Rückkehr.
const leak=scenario(9);await leak.c.eloadasok();
let form=nodes(leak.rendered()).find(n=>n.tag==='form');
let select=form.querySelectorAll('select')[0];select.value='1';select.props.onchange();await tick();
assert.equal(leak.run('k1ShopZustand.kategorie'),'1');
leak.c.location.hash='#/kategorie/2';await leak.c.route();
form=nodes(leak.rendered()).find(n=>n.tag==='form');select=form.querySelectorAll('select')[0];
select.value='';select.props.onchange();await leak.c.route();
assert.equal(leak.run('k1ShopZustand.kategorie'),undefined);
assert.ok(leak.requests.filter(p=>p.startsWith('/api/kurse')).at(-1).includes('seite=1'));
assert.equal(new URLSearchParams(leak.requests.filter(p=>p.startsWith('/api/kurse')).at(-1).split('?')[1]).has('kategorie'),false);
assert.equal(nodes(leak.rendered()).find(n=>n.tag==='form').querySelectorAll('select')[0].value,'');
const chipnav=nodes(leak.rendered()).find(n=>n.props.class==='k3-chips');
assert.deepEqual(links(chipnav).filter(n=>n.props['aria-current']==='page').map(n=>n.props.href),['#/']);
for(const suffix of ['','?utm=x','#rest','?utm=x#rest']) {
 const s=scenario(9);s.c.location.hash='#/kategorie/5'+suffix;await s.c.route();
 assert.equal(text(nodes(s.rendered()).find(n=>n.tag==='h1')).trim(),s.categories[4].name);
 assert.ok(s.requests.some(p=>p.includes('kategorie=5')));
}
for(const failure of [true,'throw']) {
 const s=scenario(9,{failure});s.c.location.hash='#/kategorie/5';await s.c.route();
 assert.ok(s.rendered().map(text).join(' ').includes(s.T.k3_ladefehler));
 const retry=nodes(s.rendered()).find(n=>n.tag==='button');assert.equal(text(retry).trim(),s.T.k3_erneut);
 s.recover();await retry.props.onclick();
 assert.equal(text(nodes(s.rendered()).find(n=>n.tag==='h1')).trim(),s.categories[4].name);
 assert.equal(s.requests.filter(p=>p==='/api/kategorien').length,2);
 const nav=scenario(9,{failure});await nav.c.k3Laden();nav.recover();nav.c.location.hash='#/kategorie/999';await nav.c.route();
 assert.ok(nav.rendered().map(text).join(' ').includes(nav.T.k3_nicht_gefunden));
 assert.equal(nav.requests.filter(p=>p==='/api/kategorien').length,2);
}
for(const lang of [0,1,2]) {
 const s=scenario(3,{lang});s.categories.forEach((c,i)=>c.anzahl=i);await s.c.k3Laden();
 for(const block of [s.c.kopfzeile(),s.c.fusszeile(),s.c.k3Chips(),s.c.k3Liste(s.categories)]) {
  const cats=links(block).filter(n=>n.props.href.startsWith('#/kategorie/'));
  for(const n of [0,1,2])assert.ok(text(cats[n]).includes(n===1?s.T.k3_anzahl_eins:s.T.k3_anzahl.replace('{n}',n)));
 }
}
const esc=scenario(1);await esc.c.k3Laden();const menu=all(esc.c.kopfzeile()).find(n=>n.tag==='details');
menu.open=true;menu.props.ontoggle();assert.ok(esc.listeners.has('keydown'));
esc.listeners.get('keydown')({key:'Escape'});assert.equal(menu.open,false);assert.equal(activeElement,menu.children[0]);assert.equal(esc.listeners.has('keydown'),false);
menu.open=true;menu.props.ontoggle();menu.open=false;menu.props.ontoggle();assert.equal(esc.listeners.has('keydown'),false);
assert.match(css,/\.k3-seite h1[^}]*scroll-margin-top:/);
console.log('K3 Nachtrag: Filter-Rückkehr, Hash-Anhänge, wiederholbare Ladefehler, Einzahl und Dokument-Escape bestanden.');
