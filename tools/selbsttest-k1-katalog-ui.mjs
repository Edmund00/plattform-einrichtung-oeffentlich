// K1b: source contracts and isolated UI execution; no server, browser or database.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const read = p => readFileSync(p, 'utf8');
const shop = read('public/kunde.js'), admin = read('public/admin/admin.js');
const katalog = shop.slice(shop.indexOf('function baueKatalogQuery('), shop.indexOf('// ---- Kursseite:'));
const verwaltung = admin.slice(admin.indexOf('function baueKatalogQuery('), admin.indexOf('// ---- Liste der Kurse'));
const form = admin.slice(admin.indexOf('function kursUrlap('), admin.indexOf('function neuerKurs('));
const texte = ['de','en','hu'].map(l => JSON.parse(read('texte/' + l + '.json')));
for (const key of Object.keys(texte[0]).filter(k => k.startsWith('k1_'))) for (const t of texte) assert.equal(typeof t[key], 'string', key);
for (const m of (katalog + verwaltung + form + shop.slice(shop.indexOf('function gratisMailHinweis()'), shop.indexOf('  const zustimmInput'))).matchAll(/t\('(k1_[a-z_]+)'\s*[,)]/g)) for (const t of texte) assert.ok(t[m[1]], m[1]);
const codes = new Set();
for (const file of ['routes-kategorien.mjs','routes-kurse.mjs']) {
  const source = read(file);
  for (const m of source.matchAll(/(?:fehler\(res,\s*\d+,\s*|nein\(|code:\s*)'([a-z_]+)'/g)) codes.add(m[1]);
}
for (const code of codes) for (const t of texte) assert.ok(t[code], code);
for (const source of [katalog, verwaltung, form]) assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\.style\b/);
assert.match(katalog, /textContent/); assert.match(verwaltung, /textContent/);
for (const source of [shop, admin]) {
  const fn = source.slice(source.indexOf('function baueKatalogQuery('), source.indexOf('function katalogFehler('));
  const build = vm.runInNewContext(fn + '\nbaueKatalogQuery', { URLSearchParams });
  assert.equal(build({}), 'seite=1');
  assert.equal(build({ q:'  Küche & 茶  ', kategorie:12, preis:'gratis', sort:'name', seite:2 }), 'q=K%C3%BCche+%26+%E8%8C%B6&kategorie=12&preis=gratis&sort=name&seite=2');
  assert.equal(build({ q:'  ', kategorie:'1&status=entwurf', preis:'x', sort:'x', seite:0, status:'x', pro_seite:13 }), 'seite=1');
  for (const seite of [-1,1.5,10001,Infinity,'abc']) assert.equal(build({seite}), 'seite=1');
  assert.equal(new URLSearchParams(build({q:'😀'.repeat(101)})).get('q'), '😀'.repeat(100));
  for (const preis of ['alle','gratis','bezahlt']) assert.equal(new URLSearchParams(build({preis})).get('preis'), preis);
  for (const sort of ['neu','preis_auf','preis_ab','name']) assert.equal(new URLSearchParams(build({sort})).get('sort'), sort);
  const error = vm.runInNewContext(source.slice(source.indexOf('function katalogFehler('), source.indexOf('function katalogAuswahl(')) + '\nkatalogFehler', {T:texte[0],t:k=>texte[0][k]});
  for (const code of codes) assert.equal(error({d:{fehler:code,text:'fallback'}}), texte[0][code]);
  assert.equal(error({d:{fehler:'unknown',text:'server'}}),'server');
}
assert.match(katalog, /basis.d.gesamt <= 12 && kategorien.length === 0/);
assert.match(katalog, /raster.append\(\.\.\.neue.map\(karte\)\)/);
assert.match(katalog, /if \(!anhaengen\) \{ raster.replaceChildren/);
assert.doesNotMatch(shop + admin, /localStorage|sessionStorage|document\.cookie/);
assert.match(katalog, /letzteSeite \+ 1/);
assert.match(shop, /v.status === 403 && v.d\?\.fehler === 'email_unbestaetigt' && k.preis_cent === 0/);

assert.match(shop, /api\('POST','\/api\/email-bestaetigung-erneut',\{\}\)/);
assert.match(form, /kategorie_id:kategorie.value \? Number\(kategorie.value\) : null/);
for (const method of ['DELETE', 'PUT', 'POST']) assert.ok(verwaltung.includes("'" + method + "'"));
assert.match(verwaltung, /apiMitStepup/);
assert.match(verwaltung, /normalize\('NFC'\).trim\(\)/);
assert.match(admin, /if \(r.status !== 401 \|\| r.d\?\.fehler !== 'stepup_noetig'\) return r/);
assert.match(verwaltung, /r.d.seite >= r.d.seiten/);
// Minimal DOM implements only the existing h() contract. Execute the actual shop catalogue.
let activeElement = null;
class El {
  constructor(tag, props = {}, children = []) {
    this.tag = tag; this.props = props; this.children = []; this.textContent = ''; this.value = props.value || ''; this.hidden = props.hidden || false; this.disabled = props.disabled || false; this.dataset = {}; this.isConnected = true;
    this.append(...children);
  }
  append(...nodes) { const items=nodes.flat(Infinity).filter(n => n !== null && n !== undefined && n !== false); for(const node of items) if(node instanceof El) { node.parentNode=this; node.isConnected=true; } this.children.push(...items); }
  remove() { if(this.parentNode) this.parentNode.children=this.parentNode.children.filter(n=>n!==this); this.isConnected=false; }
  addEventListener() {}
  get firstChild() { return this.children[0]; }
  get lastChild() { return this.children.at(-1); }
  focus() { activeElement=this; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.props[key] = value; }
  removeAttribute(key) { delete this.props[key]; }
  querySelectorAll(selectors) { const tags = selectors.split(','); return this.children.flatMap(c => c instanceof El ? [...(tags.includes(c.tag) ? [c] : []), ...c.querySelectorAll(selectors)] : []); }
}
async function scenario(total, categories, initial = {}, owned = null, katFehler = false) {
  let rendered = [], requests = [], fail = false, scroll = 0, moreButton, duplicate = false;
  const context = {
    document:{get activeElement() {return activeElement;}}, window:{scrollY:0,scrollTo:(_x,y)=>{scroll=y;},addEventListener:()=>{},removeEventListener:()=>{}},
    URLSearchParams, T:texte[0], t:(key,args) => { let s=texte[0][key] || key; for(const [k,v] of Object.entries(args || {})) s=s.replaceAll('{'+k+'}',v); return s; },
    h:(tag,props,...children) => { const el=new El(tag,props,children); if(tag==='button' && children.includes(texte[0].k1_mehr)) moreButton=el; return el; },
    location:{hash:'#/'}, ich:{angemeldet:owned !== null}, DEMO:false, verkaufPausiert:false,
    betoltes:() => {}, verkaufLaden:async () => {}, demoBox:async () => null, hero:() => null,
    zeigen:(...nodes) => { rendered = nodes; }, titelbild:() => null, arText:() => 'free',
    api:async (_method,path) => {
      requests.push(path);
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
const small=await scenario(12,[]); assert.equal(small.toolbar.hidden,true); assert.equal(small.grid.children.length,12); assert.equal(small.more.isConnected,false);
const large=await scenario(25,[]); assert.equal(large.toolbar.hidden,false);
large.more.focus(); await large.more.props.onclick(); assert.equal(activeElement,large.more); assert.equal(large.live.textContent,'12 weitere Kurse geladen, 24 von 25 angezeigt'); assert.equal(large.grid.children.length,24); assert.equal(large.more.hidden,false);
await large.more.props.onclick(); assert.equal(large.grid.children.length,25); assert.equal(large.more.isConnected,false); assert.equal(activeElement,large.live); assert.equal(large.live.textContent,'Alle 25 Kurse angezeigt');
assert.ok(large.requests.includes('/api/kurse?seite=3'));
const empty=await scenario(0,[{id:1,name:'<script>',anzahl:1}]); assert.equal(empty.empty.hidden,false); assert.equal(empty.toolbar.hidden,false);
const restored=await scenario(40,[],{q:'test',preis:'gratis',seite:3,scroll:450}); assert.ok(restored.requests.includes('/api/kurse?q=test&preis=gratis&seite=1')); assert.equal(restored.grid.children.length,36); assert.equal(restored.scroll(),450); assert.deepEqual(restored.requests.filter(p=>p.includes('q=test')).map(p=>Number(new URLSearchParams(p.split('?')[1]).get('seite'))),[1,2,3]);
const search=restored.toolbar.querySelectorAll('input')[0]; search.value=' no match '; await restored.toolbar.props.onsubmit({preventDefault(){}}); await new Promise(resolve=>setImmediate(resolve)); assert.equal(restored.grid.children.length,12); assert.ok(restored.requests.at(-1).includes('seite=1'));
await restored.empty.querySelectorAll('button')[0].props.onclick(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(activeElement,search);
const failed=await scenario(20,[]); failed.fail(); await failed.more.props.onclick(); assert.equal(failed.error.hidden,false); assert.equal(failed.grid.children.length,12);
// The shared layout wraps, while all catalogue controls keep touch targets.
const css=read('public/kunde.css'); assert.match(css,/\.k1-werkzeuge\{[^}]*flex-wrap:wrap/); assert.match(css,/min-height:44px/);
for (const file of ['tools/selbsttest-alle.sh','tools/Selbsttest-Alle.ps1']) assert.ok(read(file).includes('k1-katalog-ui'));


// N1–N4: isolated helpers and source rules.
const helpers=katalog.slice(katalog.indexOf('function katalogStatus('),katalog.indexOf('async function eloadasok('));
for (const language of texte) {
  const translate=(key,args)=>Object.entries(args||{}).reduce((s,[k,v])=>s.replaceAll('{'+k+'}',v),language[key]);
  const ctx={URLSearchParams,t:translate}; vm.createContext(ctx);
  vm.runInContext(katalog.slice(0,katalog.indexOf('function katalogFehler('))+helpers,ctx);
  assert.equal(ctx.katalogStatus(1,13,20,false),translate('k1_geladen_1',{n:1,x:13,y:20}));
  assert.equal(ctx.katalogStatus(2,14,20,false),translate('k1_geladen',{n:2,x:14,y:20}));
  for(const n of [0,1,100]) assert.equal(ctx.katalogStatus(1,n,n,true),translate(n===1?'k1_alle_angezeigt_1':'k1_alle_angezeigt',{n}));
  const ids=new Set(['1']); assert.equal(JSON.stringify(ctx.katalogNeue([{id:1},{id:'2'},{id:2},{id:3}],ids)),JSON.stringify([{id:'2'},{id:3}]));
  assert.equal(ctx.katalogSuchtext('  '+ '😀'.repeat(61)+'  '),'😀'.repeat(60)+'...');
}
assert.doesNotMatch(katalog,/karte[^;]*\.focus\(/);
assert.match(katalog,/if \(fokusMehr\).*mehr.focus\(\); else live.focus\(\)/);
assert.match(katalog,/leerText.textContent = einfach/);
assert.match(verwaltung,/let k1AdminZustand = \{\}/);
assert.match(verwaltung,/await laden\(k1AdminZustand.seite \|\| 1\)/);

const changed=await scenario(25,[]); changed.duplicate(); changed.total(24);
await changed.more.props.onclick(); assert.equal(changed.grid.children.length,23);
assert.equal(changed.live.textContent,'Alle 24 Kurse angezeigt');
const combined=await scenario(40,[{id:1,name:'Category',anzahl:40}]);
await combined.more.props.onclick();
const [category,sort]=combined.toolbar.querySelectorAll('select');
category.value='1'; category.props.onchange(); await new Promise(resolve=>setImmediate(resolve));
sort.value='name'; sort.props.onchange(); await new Promise(resolve=>setImmediate(resolve));
const searchCombined=combined.toolbar.querySelectorAll('input')[0]; searchCombined.value=' x ';
combined.toolbar.props.onsubmit({preventDefault(){}}); await new Promise(resolve=>setImmediate(resolve));
const queryCombined=new URLSearchParams(combined.requests.at(-1).split('?')[1]);
assert.equal(queryCombined.get('q'),'x'); assert.equal(queryCombined.get('kategorie'),'1'); assert.equal(queryCombined.get('sort'),'name'); assert.equal(queryCombined.get('seite'),'1'); assert.equal(combined.grid.children.length,12);
combined.total(0); searchCombined.value='  <img onerror=x>  '; combined.toolbar.props.onsubmit({preventDefault(){}}); await new Promise(resolve=>setImmediate(resolve));
assert.equal(combined.empty.hidden,false); assert.equal(combined.empty.children[0].textContent,'Keine passenden Kurse für „<img onerror=x>“ gefunden.'); assert.equal(combined.live.textContent,'0 Kurse');
// N3: execute the real admin catalogue twice, with an edit visit in between.
const adminRequests=[]; let edited=null;
const adminContext={URLSearchParams,T:texte[0],t:(k)=>texte[0][k]||k,
  h:(tag,props,...children)=>new El(tag,props,children), statusPlakette:()=>null,
  melden:()=>{},meldung:()=>{},kurs:id=>{edited=id;},preisText:()=>'',
  api:async(_method,path)=>{adminRequests.push(path); if(path.includes('/kategorien')) return {ok:true,d:[]}; const page=Number(new URLSearchParams(path.split('?')[1]).get('seite')); return {ok:true,d:{seite:page,seiten:4,gesamt:40,kurse:[{id:page,titel:'Course',preis_cent:0,lektionen:0}]}};}
};
vm.createContext(adminContext);
vm.runInContext(verwaltung.slice(0,verwaltung.indexOf('function k1KategorienBereich(')),adminContext);
vm.runInContext("k1AdminZustand={q:'needle',status:'entwurf',preis:'gratis',sort:'name',seite:2}",adminContext);
const adminFirst=vm.runInContext('k1AdminKatalog()',adminContext); await new Promise(resolve=>setImmediate(resolve));
adminFirst.children[3].querySelectorAll('button')[0].props.onclick(); assert.equal(edited,2);
vm.runInContext('k1AdminKatalog()',adminContext); await new Promise(resolve=>setImmediate(resolve));
const adminBack=new URLSearchParams(adminRequests.at(-1).split('?')[1]);
for(const [key,value] of Object.entries({q:'needle',status:'entwurf',preis:'gratis',sort:'name',seite:'2'})) assert.equal(adminBack.get(key),value);
console.log('K1-Katalog-UI: N1–N4, Query, Texte, Fehlercodes, Shop-Ablauf und Admin-Verträge bestanden.');

// Nachtrag 2: execute partial outages, simple catalogue, purchase and form submission.
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const partial=await scenario(20,[],{},null,true);
assert.equal(partial.grid.children.length,12); assert.equal(partial.toolbar.hidden,false);
assert.equal(partial.toolbar.querySelectorAll('select').length,1);
await partial.more.props.onclick(); assert.equal(partial.grid.children.length,20);
const simpleEmpty=await scenario(0,[]);
assert.equal(simpleEmpty.empty.children[0].textContent,texte[0].k_nincs_kurzus);
assert.equal(simpleEmpty.live.textContent,''); assert.equal(simpleEmpty.empty.querySelectorAll('button')[0].hidden,true);
assert.equal(small.live.textContent,'');
assert.deepEqual(small.grid.children.map(c=>c.children.find(x=>x instanceof El && x.tag==='a').props.href),Array.from({length:12},(_,i)=>'#/kurs/'+(i+1)));
let adminZero=false;
adminContext.api=async(_method,path)=>{adminRequests.push(path); return path.includes('/kategorien') ? {ok:false,d:{}} : {ok:true,d:{seite:1,seiten:adminZero?0:1,gesamt:adminZero?0:1,kurse:adminZero?[]:[{id:1,titel:'Visible',preis_cent:0,lektionen:0}]}};};
vm.runInContext('k1AdminZustand={}',adminContext);
const partialAdmin=vm.runInContext('k1AdminKatalog()',adminContext); await tick();
assert.equal(partialAdmin.children[3].children[0].children[0].children[0].children[0],'Visible');
assert.equal(partialAdmin.children[0].querySelectorAll('select')[1].disabled,true);
adminZero=true;
const zeroAdmin=vm.runInContext('k1AdminKatalog()',adminContext); await tick();
assert.equal(zeroAdmin.children[4].hidden,true);
assert.equal(zeroAdmin.children[3].children[0].children[0],'Keine Kurse gefunden');
const categoryBox=vm.runInContext(verwaltung.slice(verwaltung.indexOf('function k1KategorienBereich('))+'; k1KategorienBereich()',adminContext); await tick();
assert.equal(categoryBox.children[3].querySelectorAll('button').length,1);
let sentBody;
Object.assign(adminContext,{
 feld:(label,input,help)=>new El('label',{},[label,input,help]),
 dezimalstellen:()=>0,preisBeispiel:()=>'',centZuEingabe:String,preisZuCent:v=>Number(v),
 api:async(method,path,body)=>{if(method==='GET')return {ok:false,d:{}}; sentBody=body;return {ok:true,d:{id:1}};}
});
vm.runInContext(form,adminContext);
const courseForm=vm.runInContext("kursUrlap({id:1,titel:'Before',preis_cent:5,kategorie_id:7},()=>{})",adminContext); await tick();
courseForm.querySelectorAll('input')[0].value='After';
await courseForm.props.onsubmit({preventDefault(){}});
assert.equal(sentBody.titel,'After'); assert.equal(sentBody.preis_cent,5); assert.equal(Object.hasOwn(sentBody,'kategorie_id'),false);
// Actual course purchase uses a simulated 403, then neutral Hungarian resend response.
const purchaseSource=shop.slice(shop.indexOf('async function kurs(id)'),shop.indexOf('  const zustimmInput'))+'\n}';
const purchaseField=new El('div'); let purchaseMessage=''; let purchaseKind='';
const messageSource=shop.slice(shop.indexOf('const meldung ='),shop.indexOf('const meldung =')+shop.slice(shop.indexOf('const meldung =')).indexOf('\n'));
let emailBanner = false;
const purchaseContext={document:{querySelector:selector=>selector === '.email-hinweis' && emailBanner ? {} : null},h:(tag,props,...children)=>new El(tag,props,children),meldungsfeld:purchaseField,
 t:k=>texte[0][k]||k,betoltes(){},verkaufLaden:async()=>{},ich:{angemeldet:true},verkaufPausiert:false,
 T:texte[0],katalogFehler:()=>'',fehlerText:()=>'',
 api:async(method,path)=>method==='GET'?{ok:true,d:{id:1,preis_cent:0}}:path.includes('kaufen')?{ok:false,status:403,d:{fehler:'email_unbestaetigt'}}:{ok:true,d:{text:'Semleges magyar szöveg'}}};
vm.createContext(purchaseContext); vm.runInContext(messageSource,purchaseContext);
vm.runInContext(purchaseSource.replace('\n}',"\nreturn bezahlen('einmal');\n}"),purchaseContext);
await purchaseContext.kurs(1);
assert.equal(purchaseField.textContent,texte[0].k1_gratis_mail); assert.equal(purchaseField.props.role,'alert');
const resendButton=purchaseField.querySelectorAll('button')[0];
assert.ok(resendButton);
await resendButton.props.onclick({currentTarget:resendButton});
assert.equal(purchaseField.textContent,texte[0].k_email_erneut_ok); assert.equal(purchaseField.props.role,'status');
vm.runInContext("meldung('Next');",purchaseContext); assert.equal(purchaseField.props.role,'status');
vm.runInContext("meldung('');",purchaseContext); assert.equal(purchaseField.props.role,undefined); assert.equal(purchaseField.props['aria-live'],undefined);
// Execute real render cleanup up to creation of main (remaining layout is irrelevant here).
vm.runInContext(shop.slice(shop.indexOf('function zeigen(...teile)'),shop.indexOf('  const haupt =',shop.indexOf('function zeigen(...teile)')))+'}',Object.assign(purchaseContext,{jelszoZuruecksetzen(){}}));
vm.runInContext("meldung('Error','rot'); zeigen();",purchaseContext); assert.equal(purchaseField.props.role,undefined);
console.log('Nachtrag 2: VM-Abläufe für Teilausfälle, Formular, Gratis/Neusenden, einfache Ansicht und Meldungsrollen bestanden.');

// K1c: execute the actual benefit selection for free, paid and subscription courses.
const benefitSource=shop.slice(shop.indexOf("(k.preis_cent === 0 && k.abo_preis_cent == null"),shop.indexOf(".map(x=>h('li'",shop.indexOf("(k.preis_cent === 0 && k.abo_preis_cent == null")));
for (const [course,expected] of [
  [{preis_cent:0},['k_gratis_box_1','k_gratis_box_2','k_gratis_box_3']],
  [{preis_cent:100},['k_kaufbox_1','k_kaufbox_2','k_kaufbox_3','k_kaufbox_4']],
  [{preis_cent:0,abo_preis_cent:100},['k_kaufbox_1','k_kaufbox_2','k_kaufbox_3','k_kaufbox_4']],
  [{preis_cent:100,abo_preis_cent:100},['k_kaufbox_1','k_kaufbox_2','k_kaufbox_3','k_kaufbox_4']]
]) assert.deepEqual(Array.from(vm.runInNewContext(benefitSource,{k:course})),expected);
for(const language of texte) for(let i=1;i<=3;i++) assert.ok(language['k_gratis_box_'+i]);
for(const present of [true,false]) {
  emailBanner=present;
  purchaseField.replaceChildren(); // Real DOM textContent in meldung() clears previous children.
  await purchaseContext.kurs(1);
  assert.equal(purchaseField.props.role,'alert');
  assert.equal(purchaseField.querySelectorAll('button').length,present?0:1);
  if(present) assert.equal(purchaseField.textContent,texte[0].k1_gratis_mail);
  else {
    const hint=purchaseField.children[0];
    assert.equal(hint.props.class,'gratis-mail-hinweis');
    assert.equal(hint.children[0].children[0],texte[0].k1_gratis_mail);
  }
}
assert.match(css,/\.gratis-mail-hinweis\{[^}]*display:flex;[^}]*gap:var\(--sp-3\)/);
console.log('K1c: Gratis-/Kauf-/Abo-Box, Sprachschlüssel und Hinweis mit/ohne Leiste bestanden.');

// K1d: SPA return keeps the actual module state; a fresh VM starts at defaults.
const memory=await scenario(40,[{id:1,name:'Category',anzahl:40}]);
const memorySearch=memory.toolbar.querySelectorAll('input')[0]; memorySearch.value=' saved ';
memory.toolbar.props.onsubmit({preventDefault(){}}); await tick();
const [memoryCategory,memorySort]=memory.toolbar.querySelectorAll('select');
memoryCategory.value='1'; memoryCategory.props.onchange(); await tick();
memorySort.value='name'; memorySort.props.onchange(); await tick();
await memory.toolbar.querySelectorAll('button').find(b=>b.dataset.preis==='gratis').props.onclick(); await tick();
await memory.more.props.onclick();
memory.context.window.scrollY=321;
// Capture the installed scroll handler and exercise it before navigating away.
let scrollHandler;
memory.context.window.addEventListener=(event,fn)=>{if(event==='scroll') scrollHandler=fn;};
await memory.context.eloadasok();
memory.context.window.scrollY=321; scrollHandler();
memory.context.location.hash='#/kurs/1';
memory.context.location.hash='#/'; await memory.context.eloadasok();
const returned=memory.rendered().find(n => n?.props?.class === 'szakasz').children;
assert.equal(returned[3].children.length,24); assert.equal(memory.scroll(),321);
const returnQuery=new URLSearchParams(memory.requests.at(-1).split('?')[1]);
for(const [key,value] of Object.entries({q:'saved',kategorie:'1',preis:'gratis',sort:'name',seite:'2'})) assert.equal(returnQuery.get(key),value);
const fresh=await scenario(40,[]); assert.equal(fresh.grid.children.length,12); assert.equal(fresh.requests.filter(p => p !== '/api/beispiele').at(-1),'/api/kategorien');
// Ownership applies to simple, toolbar and appended cards; failures and guests stay unmarked.
for(const total of [2,20]) {
  const owned=await scenario(total,[],{},{ok:true,d:[{id:1},{id:13}]});
  if(total>12) await owned.more.props.onclick();
  const marked=owned.grid.children.filter(card=>card.querySelectorAll('span').some(span=>span.children.includes(texte[0].k_megvasarolva)));
  assert.equal(marked.length,total>12?2:1);
  for(const card of marked) { const link=card.querySelectorAll('a')[0]; assert.match(link.props.href,/^#\/eloadas\//); assert.equal(link.props.class,'knopf gross gruen'); assert.ok(link.children.includes(texte[0].k_megnyitas)); }
}
for(const owned of [null,{ok:false,d:{}}]) {
  const unmarked=await scenario(20,[],{},owned); await unmarked.more.props.onclick();
  assert.ok(unmarked.grid.children.every(card=>card.querySelectorAll('a')[0].props.href.startsWith('#/kurs/')));
  assert.equal(unmarked.requests.includes('/api/meine-kurse'),owned!==null);
}
console.log('K1d: Modulzustand, SPA-Rückkehr, Neustart und Besitzmarken bestanden.');
