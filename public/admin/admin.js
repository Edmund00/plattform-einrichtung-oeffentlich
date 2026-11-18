// Gabriellas Admin-Seite. Alle Texte kommen aus /api/texte (texte/hu.json), nichts Sprachliches steht hier im Code.
// Sicherheit: Inhalte aus Eingaben und aus der API werden NUR als Text eingesetzt (createElement, textContent, append(Text)),
// nie als HTML. Es gibt kein innerHTML, kein eval, keine Inline-Skripte (die Content-Security-Policy würde sie blockieren).
import { preisZuCent, centZuEingabe, preisBeispiel, dezimalstellen, formatGanzeEinheiten, formatBetrag, formatMeret } from '../preis.js';

let T = {};
const ADMIN_ART_TEXTE = Object.freeze({ text: 'art_text', video: 'art_video', pdf: 'art_pdf', audio: 'art_audio', datei: 'art_datei' });
const GRUND_TEXTE = Object.freeze({
  betrag_waehrung: 'grund_betrag_waehrung',
  kunde_passt_nicht: 'grund_kunde_passt_nicht',
  kurs_unbekannt: 'grund_kurs_unbekannt',
  benutzer_unbekannt: 'grund_benutzer_unbekannt',
  erstattung_voll: 'grund_erstattung_voll',
  teilerstattung: 'grund_teilerstattung',
  doppelt_bezahlt: 'grund_doppelt_bezahlt',
  abo_intervall: 'grund_abo_intervall',
});
const wert = (vorspann, v) => { const k = vorspann + String(v ?? ''); return T[k] ?? String(v ?? ''); };
const t = (schluessel, werte) => {
  let s = T[schluessel] ?? schluessel;
  for (const [name, wert] of Object.entries(werte || {})) s = s.replaceAll('{' + name + '}', String(wert));
  return s;
};

// Kleiner Baukasten für Elemente. Kinder, die Zeichenketten sind, werden zu reinen Text-Knoten.
function h(tag, eigenschaften = {}, ...kinder) {
  const el = document.createElement(tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (wert === undefined || wert === null || wert === false) continue;
    if (name === 'class') el.className = wert;
    else if (name.startsWith('on')) el.addEventListener(name.slice(2), wert);
    else el.setAttribute(name, wert === true ? '' : wert);
  }
  for (const kind of kinder.flat(Infinity)) if (kind !== null && kind !== undefined && kind !== false) el.append(kind);
  return el;
}


// Passwort wird nur im Eingabefeld angezeigt; kein Speichern oder Protokollieren.
const jelszoAugen=new Set();
function jelszoZuruecksetzen(){
 for(const x of jelszoAugen){x.input.type='password';x.button.setAttribute('aria-pressed','false');x.button.setAttribute('aria-label',t('jelszo_zeigen'));x.text.textContent=t('jelszo_zeigen');x.strich.setAttribute('hidden','');}
}
document.addEventListener('submit',jelszoZuruecksetzen,true);
window.addEventListener('hashchange',jelszoZuruecksetzen);
window.addEventListener('pagehide',jelszoZuruecksetzen);
function jelszoMezo(input){
 const text=h('span',{class:'jelszo-knopf-text'},t('jelszo_zeigen'));
 const ns='http:'+'//www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24');
 svg.setAttribute('width','22');svg.setAttribute('height','22');
 svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');
 svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');
 const eye=document.createElementNS(ns,'path');eye.setAttribute('d','M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z');
 const pupille=document.createElementNS(ns,'circle');pupille.setAttribute('cx','12');pupille.setAttribute('cy','12');pupille.setAttribute('r','3');
 const strich=document.createElementNS(ns,'path');strich.setAttribute('d','M3 21 21 3');strich.setAttribute('hidden','');
 svg.append(eye,pupille,strich);
 const button=h('button',{type:'button',class:'jelszo-auge','aria-label':t('jelszo_zeigen'),'aria-pressed':'false'},svg,text);
 const feld=h('span',{class:'jelszo-rahmen'},input,button);
 const entry={input,button,text,strich};jelszoAugen.add(entry);
 button.addEventListener('click',()=>{
  const start=input.selectionStart,end=input.selectionEnd;
  const offen=input.type==='password';
  input.type=offen?'text':'password';
  button.setAttribute('aria-pressed',String(offen));
  button.setAttribute('aria-label',t(offen?'jelszo_verbergen':'jelszo_zeigen'));
  text.textContent=t(offen?'jelszo_verbergen':'jelszo_zeigen');
  if(offen)strich.removeAttribute('hidden');else strich.setAttribute('hidden','');
  input.focus({preventScroll:true});
  try{input.setSelectionRange(start,end);}catch{}
 });
 return feld;
}

const app = document.getElementById('app');
const meldungsfeld = h('div', { class: 'meldung', role: 'status', 'aria-live': 'polite' });

function meldung(text, art = 'ok') {
  meldungsfeld.textContent = text || '';
  meldungsfeld.className = text ? 'meldung ' + art : 'meldung';
  if (text) meldungsfeld.scrollIntoView?.({ block: 'nearest' });   // Rueckmeldung nicht ausserhalb des Bildschirms verstecken (Handy)
}

async function api(methode, pfad, body) {
  let antwort;
  try {
    antwort = await fetch(pfad, {
      method: methode,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, d: { text: t('a_halozati_hiba') } };
  }
  let d = {};
  try { d = await antwort.json(); } catch (e) { /* leere Antwort */ }
  return { ok: antwort.ok, status: antwort.status, d };
}

// F-108: Passwort-Dialog fuer Step-up-Bestaetigung.
// Zeigt ein modales Formular, wartet auf Eingabe, POST /api/admin/stepup.
// resolve(true) bei Erfolg, resolve(false) bei Abbruch.
function stepupAnfordern() {
  return new Promise((resolve) => {
    const eingabe = h('input', { name: 'stepup_pw', autocomplete: 'current-password', required: true, class: 'eingabe' });
    eingabe.type = 'password';
    const pwFeld = jelszoMezo(eingabe);
    const fehlerAnzeige = h('p', { class: 'rot klein', hidden: true });
    const absendenKnopf = h('button', { type: 'submit', class: 'knopf' }, t('a_igen'));
    const abbrechenKnopf = h('button', { type: 'button', class: 'knopf hell', onclick: () => { dialog.remove(); resolve(false); } }, t('a_megse'));
    const form = h('form', { onsubmit: async (ev) => {
      ev.preventDefault();
      absendenKnopf.disabled = true;
      fehlerAnzeige.hidden = true;
      const r = await api('POST', '/api/admin/stepup', { passwort: eingabe.value });
      eingabe.value = '';
      if (r.ok) { dialog.remove(); resolve(true); return; }
      absendenKnopf.disabled = false;
      fehlerAnzeige.textContent = fehlerText(r);
      fehlerAnzeige.hidden = false;
      if (r.status === 429) { abbrechenKnopf.click(); return; }
      eingabe.focus();
    } },
      h('p', {}, t('stepup_noetig')),
      h('div', { class: 'feld' }, pwFeld),
      fehlerAnzeige,
      h('div', { class: 'zeile' }, absendenKnopf, abbrechenKnopf));
    const dialog = h('div', { class: 'karte', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('stepup_noetig') }, form);
    app.append(dialog);
    eingabe.focus();
  });
}

// F-108: Wrapper um api(), der bei 401 stepup_noetig automatisch den Step-up-Dialog zeigt
// und danach die Anfrage wiederholt. Bei Abbruch oder erneutem Fehler wird das Ergebnis
// unveraendert zurueckgegeben.
async function apiMitStepup(methode, pfad, body) {
  const r = await api(methode, pfad, body);
  if (r.status !== 401 || r.d?.fehler !== 'stepup_noetig') return r;
  const bestaetigt = await stepupAnfordern();
  if (!bestaetigt) return r;
  return api(methode, pfad, body);
}

function budapestZeit(wert){
 if(wert===null||wert===undefined||wert==='')return '–';
 const d=new Date(wert);
 if(!Number.isFinite(d.getTime()))return '–';
 const teile=new Intl.DateTimeFormat(LOC,{timeZone:'Europe/Budapest',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(d);
 const v=Object.fromEntries(teile.map(x=>[x.type,x.value]));
 const uhr=v.hour+':'+v.minute+':'+v.second;
 // Block 4: Datum je Oberflaechensprache (Zeitzone bleibt Budapest). HU 2026. 11. 12., DE 12.11.2026, EN 12 Nov 2026.
 if(LOC.startsWith('hu'))return v.year+'. '+v.month+'. '+v.day+'. '+uhr;
 if(LOC.startsWith('en'))return Number(v.day)+' '+MONATE_EN[Number(v.month)-1]+' '+v.year+', '+uhr;
 return v.day+'.'+v.month+'.'+v.year+' '+uhr;
}
const MONATE_EN=Object.freeze(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']);
const agentAnzeige=(typ,wert)=>!wert?'–':T['agent_protokoll_'+typ+'_'+wert]??(typ==='aktion'?T['agent_protokoll_aktion_'+String(wert).split(' ')[0]]:undefined)??t('a_ismeretlen');
const agentZiel=ziel=>/^[1-9]\d{0,15}$/.test(String(ziel??''))?'#'+ziel:'';

const fehlerText = (r) => r.d?.text || t('a_halozati_hiba');

// ---- Gemeinsame Teile ------------------------------------------------------------------------
// Die Rückmeldung steht direkt unter der Kopfzeile (und bleibt beim Scrollen oben sichtbar).
let markeAufraeumen = null;
function zeigen(...teile) {
  if (markeAufraeumen) { markeAufraeumen(); markeAufraeumen = null; }
  jelszoZuruecksetzen();
  const [erstes, ...rest] = teile.flat();
  app.replaceChildren(erstes, meldungsfeld, ...rest);
  for(const x of jelszoAugen)if(!x.input.isConnected){x.input.value='';jelszoAugen.delete(x);}
}


// Sprachumschalter (EN / DE / HU): speichert die Wahl im Cookie und, wenn angemeldet, im Konto; danach wird die Seite neu geladen.
function sprachwahl() {
  const aktiv = T._sprache || 'de';
  return h('nav', { class: 'sprachwahl', 'aria-label': t('sprache_label') },
    ...[['en', 'EN', 'English'], ['de', 'DE', 'Deutsch'], ['hu', 'HU', 'Magyar']].map(([code, kurz, name]) =>
      h('button', { type: 'button', lang: code, title: name, 'aria-label': name, 'aria-current': code === aktiv ? 'true' : 'false', class: code === aktiv ? 'aktiv' : '',
        onclick: async () => { if (code === aktiv) return; await fetch('/api/sprache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprache: code }) }); location.reload(); } }, kurz)));
}

function kopf(untertitel, mitKilepes = true) {
  return h('header', { class: 'kopf' },
    h('a', { class: 'admin-marke', href: '/admin/', 'aria-label': t('a_titel') },
      h('img', { src: T._logo || '/img/muster-logo.svg', alt: t('a_logo_alt') })),   // Produktreife Block 2: Logo-Pfad aus /api/texte
    h('h1', {}, untertitel),
    mitKilepes ? h('nav', { class: 'admin-fej-akciok', 'aria-label': t('a_titel') },
      h('button', { class: 'knopf klein hell', type: 'button', onclick: abmelden }, t('a_kilepes'))) : null);
}

function feld(beschriftung, eingabe, hinweis) {
  return h('label', { class: 'feld' },
    h('span', { class: 'beschriftung' }, beschriftung),
    eingabe,
    hinweis ? h('span', { class: 'hinweis' }, hinweis) : null);
}

const preisText = (cent, waehrung) => formatBetrag(cent, waehrung || 'huf');
const statusPlakette = (status) => h('span', { class: status === 'veroeffentlicht' ? 'plakette gruen' : 'plakette grau' },
  status === 'veroeffentlicht' ? t('a_kozzetve') : status === 'archiviert' ? t('a_archiviert') : status==='freigabe_offen'?t('agent_freigabe_offen'):t('a_piszkozat'));


function bestaetigen(frage, aktion) {
  const feld = h('div', { class: 'karte', role: 'alertdialog' },
    h('p', {}, t(frage)),
    h('div', { class: 'zeile' }));
  const knopf = h('button', { class: 'knopf', type: 'button', onclick: async () => {
    knopf.disabled = true;
    try { await aktion(); } finally { feld.remove(); }
  } }, t('a_igen'));
  feld.lastChild.append(knopf, h('button', { class: 'knopf hell', type: 'button', onclick: () => feld.remove() }, t('a_megse')));
  app.append(feld);
  knopf.focus();
}

// ---- Start: Wer ist angemeldet? -------------------------------------------------------------------
async function start() {
  const r = await api('GET', '/api/ich');
  if (!r.ok || !r.d.angemeldet) return anmeldung();
  if (r.d.rolle !== 'admin') return keinRecht();
  return uebersicht();
}

async function abmelden() {
  await api('POST', '/api/abmelden');
  listenAnzeige.clear();
  meldung('');
  return anmeldung();
}

// Das Video wird erst eingebaut, wenn die vorhandene lokale Datei erreichbar ist.
// Fehlt sie, bleibt die Anmeldung ohne defekten Player voll benutzbar.
function videoBereich() {
  const bereich = h('section', { class: 'karte admin-video-bereich', hidden: true },
    h('h2', {}, t('a_video_eloszor')),
    h('p', { class: 'admin-video-hinweis' }, t('a_video_magyarazat')));
  void fetch('/video/erklaervideo-hu.mp4', { method: 'HEAD' })
    .then(antwort => {
      if (!antwort.ok || !antwort.headers.get('content-type')?.startsWith('video/mp4') || !bereich.isConnected) return;
      bereich.append(h('video', {
        class: 'admin-video', controls: true, preload: 'metadata', playsinline: true,
        poster: '/video/erklaervideo-hu.jpg',
        src: '/video/erklaervideo-hu.mp4',
        'aria-label': t('a_video_eloszor'),
      }));
      bereich.hidden = false;
    })
    .catch(() => {}); // Keine Datei oder Netzfehler: kein kaputter Player.
  return bereich;
}

function videoAnsehen() {
  zeigen(kopf(t('a_video_eloszor')), videoBereich(),
    h('button', { class: 'knopf klein hell', type: 'button', onclick: uebersicht }, t('a_vissza')));
}

function anmeldung() {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const passwort = h('input', { type: 'password', name: 'passwort', autocomplete: 'current-password', required: true });
  const knopf = h('button', { class: 'knopf gross', type: 'submit' }, t('a_belepes_gomb'));
  const urlap = h('form', { class: 'karte', onsubmit: async (e) => {
    e.preventDefault();
    knopf.disabled = true;
    const r = await api('POST', '/api/anmelden', { email: email.value, passwort: passwort.value });
    knopf.disabled = false;
    if (!r.ok) return meldung(fehlerText(r), 'rot');
    passwort.value = '';
    meldung('');
    return start();
  } }, feld(t('a_email'), email), feld(t('a_jelszo'), jelszoMezo(passwort)), knopf);
  zeigen(kopf(t('a_belepes_cim'), false), videoBereich(), urlap,
    h('a', { class:'knopf ghost', href:'/#/passwort-vergessen' }, t('a_passwort_vergessen')));
  email.focus();
}

function keinRecht() {
  zeigen(kopf(t('a_titel')), h('p', { class: 'karte nagy' }, t('a_nincs_jog')));
}

// Scheibe 15: Filter, Zeit in Budapest und Export. Keine HTML-Injektion.
const EREIGNIS_TYP_TEXTE=Object.freeze({
  registriert:'a_ereignis_typ_registriert',
  bestaetigt:'a_ereignis_typ_bestaetigt',
  gekauft:'a_ereignis_typ_gekauft',
  erstattet:'a_ereignis_typ_erstattet',
  abo_gestartet:'a_ereignis_typ_abo_gestartet',
  abo_beendet:'a_ereignis_typ_abo_beendet',
  abo_gekuendigt:'a_ereignis_typ_abo_gekuendigt',
  geloescht:'a_ereignis_typ_geloescht',
});
const EREIGNIS_STATUS_TEXTE=Object.freeze({
  registriert:'a_ereignis_status_registriert',
  bestaetigt:'a_ereignis_status_bestaetigt',
  bezahlt:'a_ereignis_status_bezahlt',
  kostenlos:'a_ereignis_status_kostenlos',
  erstattet:'a_ereignis_status_erstattet',
  teilweise:'a_ereignis_status_teilweise',
  beendet:'a_ereignis_status_beendet',
  pruefen:'a_ereignis_status_pruefen',
  streitfall:'a_ereignis_status_streitfall',
  streit_anfrage:'a_ereignis_status_streit_anfrage',
  streit_gewonnen:'a_ereignis_status_streit_gewonnen',
  streit_verloren:'a_ereignis_status_streit_verloren',
  erstattung_fehlgeschlagen:'a_ereignis_status_erstattung_fehlgeschlagen',
});
function ereignisseBereich() {
  const typ=h('select',{},h('option',{value:''},t('a_ereignisse_mind')),
    Object.entries(EREIGNIS_TYP_TEXTE).map(([wert,key])=>h('option',{value:wert},t(key))));
  const von=h('input',{type:'date'}), bis=h('input',{type:'date'});
  const suche=h('input',{type:'search',maxlength:'254',autocomplete:'off'});
  const liste=h('div',{},h('p',{},t('a_betoltes')));
  const stand=h('span',{class:'klein'});
  const zurueck=h('button',{class:'knopf klein ghost',type:'button'},t('a_ereignisse_vissza'));
  const weiter=h('button',{class:'knopf klein ghost',type:'button'},t('a_ereignisse_weiter'));
  let seite=1, seiten=0;
  const param=()=> {
    const p=new URLSearchParams();
    if(typ.value)p.set('typ',typ.value);
    if(von.value)p.set('von',von.value);
    if(bis.value)p.set('bis',bis.value);
    if(suche.value.trim())p.set('suche',suche.value.trim());
    return p;
  };
  async function laden() {
    const p=param();p.set('seite',String(seite));
    liste.replaceChildren(h('p',{},t('a_betoltes')));
    const r=await api('GET','/api/admin/ereignisse?'+p.toString());
    if(!liste.isConnected)return;
    if(!r.ok){liste.replaceChildren(h('p',{class:'meldung rot'},r.d?.text||t('a_ereignisse_fehler')));return;}
    const d=r.d;seiten=d.seiten;
    stand.textContent=t('a_ereignisse_seite',{seite:seite,gesamt:Math.max(1,seiten)});
    zurueck.disabled=seite<=1;weiter.disabled=seite>=seiten;
    if(!d.adatok.length){liste.replaceChildren(h('p',{},t('a_ereignisse_leer')));return;}
    // A2-03: Ereignisbetraege tragen Cent (19.99); Forint bleibt ganzzahlig.
    const betragText=e=>e.betrag===null||e.betrag===undefined?'–':e.waehrung==='huf'&&Number.isSafeInteger(e.betrag)?formatGanzeEinheiten(e.betrag)+' '+t('a_ft'):formatBetrag(Math.round(Number(e.betrag)*100),String(e.waehrung||'eur'));
    liste.replaceChildren(h('div',{class:'ereignis-tabelle-box'},h('table',{class:'ereignis-tabelle','aria-label':t('a_ereignisse_tabelle')},
      h('thead',{},h('tr',{},...['a_ereignisse_zeit','a_ereignisse_ereignis','a_ereignisse_kurs','a_ereignisse_betrag','a_ereignisse_email','a_ereignisse_status'].map(k=>h('th',{scope:'col'},t(k))))),
      h('tbody',{},...d.adatok.map(e=>{const konto=['registriert','bestaetigt'].includes(e.typ);
        return h('tr',{},
          h('td',{class:'nowrap','data-label':t('a_ereignisse_zeit')},budapestZeit(e.zeit.replace(' ','T')+'Z')),
          h('td',{'data-label':t('a_ereignisse_ereignis')},h('strong',{},t(EREIGNIS_TYP_TEXTE[e.typ]||'a_ismeretlen'))),
          h('td',{'data-label':t('a_ereignisse_kurs')},konto?'–':(e.kurs||t('a_ismeretlen'))),
          h('td',{class:'nowrap rechts','data-label':t('a_ereignisse_betrag')},konto?'–':betragText(e)),
          h('td',{class:'umbruch','data-label':t('a_ereignisse_email'),title:t(konto?'a_ereignisse_benutzer':'a_ereignisse_email')},e.email||t('a_ismeretlen')),
          h('td',{'data-label':t('a_ereignisse_status')},h('span',{class:'plakette'},t(EREIGNIS_STATUS_TEXTE[e.status]||'a_ismeretlen'))));})))));
  }
  const exportieren=format=>{
    const p=param();p.set('format',format);
    // Nur eigene, authentifizierte Adresse, keine Daten an Drittseiten.
    window.location.assign('/api/admin/ereignisse?'+p.toString());
  };
  zurueck.addEventListener('click',()=>{if(seite>1){seite--;void laden();}});
  weiter.addEventListener('click',()=>{if(seite<seiten){seite++;void laden();}});
  const filtern=h('form',{class:'ereignis-filter',onsubmit:e=>{e.preventDefault();seite=1;void laden();}},
    feld(t('a_ereignisse_tipus'),typ),feld(t('a_ereignisse_von'),von),
    feld(t('a_ereignisse_bis'),bis),feld(t('a_ereignisse_suche'),suche),
    h('button',{type:'submit',class:'knopf'},t('a_ereignisse_filter')));
  const abschnitt=h('section',{class:'karte ereignis-bereich'},
    h('h2',{},t('a_ereignisse_cim')),filtern,
    h('div',{class:'ereignis-export'},
      h('button',{type:'button',class:'knopf klein ghost',onclick:()=>exportieren('csv')},t('a_ereignisse_export_csv')),
      h('button',{type:'button',class:'knopf klein ghost',onclick:()=>exportieren('json')},t('a_ereignisse_export_json'))),
    liste,h('nav',{class:'ereignis-navigation'},zurueck,stand,weiter));
  queueMicrotask(()=>{void laden();});
  return abschnitt;
}


async function agentBereich(){
  zeigen(kopf(t('agent_titel')),h('p',{},t('a_betoltes')));
  const [key,an,log]=await Promise.all([
    api('GET','/api/admin/agent/schluessel'),api('GET','/api/admin/agent/antraege'),
    api('GET','/api/admin/agent/protokoll')]);
  if(!key.ok||!an.ok||!log.ok)return zeigen(kopf(t('agent_titel')),
    h('p',{class:'meldung rot'},fehlerText(!key.ok?key:!an.ok?an:log)));
  const geheim=h('div',{class:'karte'});
  const name=h('input',{type:'text',maxlength:80,required:true,placeholder:t('agent_name')});
  const neu=h('button',{class:'knopf',type:'button',onclick:async()=>{
    const r=await api('POST','/api/admin/agent/schluessel',{name:name.value});
    if(!r.ok)return meldung(fehlerText(r),'rot');
    name.value='';
    const schluessel=r.d.schluessel;
    geheim.replaceChildren(h('strong',{},t('agent_einmal')),h('p',{},schluessel),
      h('button',{class:'knopf klein',type:'button',onclick:()=>navigator.clipboard?.writeText(schluessel)},t('agent_kopieren')));
    neu.disabled=true;
  }},t('agent_anlegen'));
  const keys=listeMitMehr(h('div',{}),key.d,x=>h('article',{class:'karte'},h('strong',{},x.name),
    h('p',{},x.vorschau+' · '+((x.zuletzt_benutzt?budapestZeit(x.zuletzt_benutzt):t('agent_nie')))),
    x.widerrufen_am?h('span',{},t('agent_widerrufen')):h('button',{class:'knopf klein',type:'button',
      onclick:()=>bestaetigen('agent_widerrufen_frage',async()=>{
        const r=await api('POST','/api/admin/agent/schluessel/'+x.id+'/widerrufen',{});
        if(!r.ok)meldung(fehlerText(r),'rot');await agentBereich();
      })},t('agent_widerrufen'))), {schluessel:'agentSchluessel'});
  const requests=listeMitMehr(h('div',{}),an.d,x=>h('article',{class:'karte'},h('strong',{},t(x.art==='aendern'?'agent_aenderung':'agent_veroeffentlichung')),
    h('p',{},x.titel+' · '+wert('agent_feld_',x.feld)),
    x.art==='veroeffentlichen'?h('p',{},x.beschreibung||''):null,
    x.vorher!==null?h('p',{},t('agent_vorher')+': '+(x.vorher==='entwurf'?t('a_piszkozat'):(['preis_cent','abo_preis_cent'].includes(x.feld)&&Number.isFinite(Number(x.vorher))?formatBetrag(Number(x.vorher),x.waehrung||'huf'):wert('agent_wert_',x.vorher)))):null,
    x.nachher!==null?h('p',{},t('agent_nachher')+': '+(x.nachher==='veroeffentlicht'?t('a_kozzetve'):(['preis_cent','abo_preis_cent'].includes(x.feld)&&Number.isFinite(Number(x.nachher))?formatBetrag(Number(x.nachher),x.waehrung||'huf'):wert('agent_wert_',x.nachher)))):null,
    h('button',{class:'knopf klein hell',type:'button',onclick:()=>kurs(x.kurs_id)},t('a_megnyitas')),
    ...['freigeben','ablehnen'].map(act=>h('button',{class:'knopf klein',type:'button',
      onclick:()=>bestaetigen(act==='freigeben'?'agent_freigeben_frage':'agent_ablehnen_frage',async()=>{
        const r=await api('POST','/api/admin/agent/antraege/'+x.id+'/entscheiden',{entscheidung:act});
        if(!r.ok)meldung(fehlerText(r),'rot');await agentBereich();
      })},t('agent_'+act)))), { leerText:t('agent_keine_antraege'), schluessel:'agentAntraege' });
  const logs=listeMitMehr(h('div',{}),log.d,x=>h('p',{class:'klein'},budapestZeit(x.zeit)+' · '+agentAnzeige('aktion',x.aktion)+' · '+agentAnzeige('ergebnis',x.ergebnis)+' · '+agentAnzeige('grund',x.beschreibung)+' · '+agentZiel(x.ziel)), {schluessel:'agentProtokoll', serverGrenze:LISTEN_GRENZEN.agentProtokoll});
  zeigen(kopf(t('agent_titel')),
    h('button',{class:'knopf hell klein',type:'button',onclick:uebersicht},t('a_vissza')),
    h('section',{class:'karte'},h('h2',{},t('agent_schluessel')),name,neu,geheim,keys),
    h('section',{class:'karte'},h('h2',{},t('agent_antraege')),requests),
    h('section',{class:'karte'},h('h2',{},t('agent_protokoll')),logs));
}


// Scheibe 25: Jede Angabe wird nur als DOM-Text ausgegeben.
async function sicherungBereich(){
 zeigen(kopf(t('sicherung_titel')),h('p',{},t('a_betoltes')));
 const r=await api('GET','/api/admin/sicherung');
 if(!r.ok)return zeigen(kopf(t('sicherung_titel')),h('p',{class:'meldung rot'},fehlerText(r)));
 const info=r.d;
 const alter=info.letzte?budapestZeit(info.letzte):t('sicherung_soha');
 const log=listeMitMehr(h('div',{}),info.eintraege,x=>h('p',{class:'klein'},
   budapestZeit(x.zeit)+' · '+wert('sicherung_wert_',x.art)+' · '+wert('sicherung_wert_',x.ergebnis)+' · '+(x.dateiname||'')+' · '+wert('sicherung_wert_',x.ziel_lokal)+' · '+wert('sicherung_wert_',x.ziel_extern)), {schluessel:'sicherungProtokoll', serverGrenze:LISTEN_GRENZEN.sicherungProtokoll});
 const save=h('button',{class:'knopf',type:'button',disabled:!info.aktiv,onclick:async()=>{
   save.disabled=true;
   try{
    const result=await api('POST','/api/admin/sicherung/jetzt',{art:'manuell'});
    meldung(result.ok?t('sicherung_ok'):fehlerText(result),result.ok?'ok':'rot');
    if(result.ok)await sicherungBereich();
   }finally{save.disabled=false}
 }},t('sicherung_jetzt'));
 zeigen(kopf(t('sicherung_titel')),
   h('button',{class:'knopf hell klein',type:'button',onclick:uebersicht},t('a_vissza')),
   h('section',{class:'karte'},h('h2',{},t('sicherung_titel')),
     h('p',{},t(info.aktiv?'sicherung_aktiv':'sicherung_inaktiv')),
     h('p',{},t('sicherung_utolso')+': '+alter),save,
     h('a',{class:'knopf hell',href:'/api/admin/sicherung/letzte',download:true},t('sicherung_letoltes'))),
   h('section',{class:'karte'},h('h2',{},t('sicherung_eredmeny')),log));
}


async function abgleichBereich(){
 zeigen(kopf(t('abgleich_titel')),h('p',{},t('a_betoltes')));
 const r=await api('GET','/api/admin/abgleich');
 if(!r.ok)return zeigen(kopf(t('abgleich_titel')),h('p',{class:'meldung rot'},fehlerText(r)));
 const last=r.d.letzter;
 const knopf=h('button',{type:'button',class:'knopf',onclick:async()=>{
   knopf.disabled=true;
   const x=await api('POST','/api/admin/abgleich/jetzt',{});
   if(!x.ok)meldung(fehlerText(x),'rot');
   else{meldung(t(x.d.status==='ok'?'abgleich_ok':'abgleich_abweichung'));await abgleichBereich()}
   knopf.disabled=false;
 }},t('abgleich_jetzt'));
 const abweichungen=listeMitMehr(h('div',{}),r.d.abweichungen,x=>h('article',{class:'karte'},
   h('strong',{},t(x.text)),
   h('p',{},(x.stripe_id||'')+' · '+(x.bestell_id||'')+' · '+(x.betrag==null?'':formatBetrag(Number(x.betrag),x.waehrung||'huf'))),
   h('span',{class:'klein'},t(x.neu?'abgleich_neu':'abgleich_alt')),
   x.art==='stripe_ohne_bestellung'?h('p',{},t('abgleich_nachbau')):null,
   x.art==='erstattung_nicht_verarbeitet'&&/^re_[A-Za-z0-9_]{1,100}$/.test(x.stripe_id||'') ?
     h('button',{type:'button',class:'knopf klein',onclick:async()=>{
       if(!window.confirm(t('aboerstattung_nachbuchen_frage')))return;
       const result=await api('POST','/api/admin/abgleich/nachbuchen',{stripe_id:x.stripe_id});
       if(!result.ok)meldung(fehlerText(result),'rot');
       else{meldung(t('aboerstattung_nachbuchen_ok'));await abgleichBereich();}
     }},t('aboerstattung_nachbuchen')):null), {schluessel:'abgleichAbweichungen'});
 const verlauf=listeMitMehr(h('div',{}),r.d.verlauf,x=>h('p',{class:'klein'},
   budapestZeit(x.ende)+' · '+wert('abgleich_wert_',x.modus)+' · '+wert('abgleich_wert_',x.status)+' · '+x.abweichungen_anzahl), {schluessel:'abgleichVerlauf', serverGrenze:LISTEN_GRENZEN.abgleichVerlauf});
 zeigen(kopf(t('abgleich_titel')),
   h('button',{class:'knopf klein hell',type:'button',onclick:uebersicht},t('a_vissza')),
   h('section',{class:'karte'},h('h2',{},t('abgleich_letzter')),
     h('p',{},last?budapestZeit(last.ende)+' · '+wert('abgleich_wert_',last.status)+' · '+wert('abgleich_wert_',last.modus):t('abgleich_noch_nie')),
     h('p',{},t('abgleich_abweichungen')+': '+(last?.abweichungen_anzahl??0)),
     h('p',{class:'klein'},t('abgleich_webhook_nicht_pruefbar')),knopf),
   h('section',{},h('h2',{},t('abgleich_abweichungen')),abweichungen),
   h('section',{class:'karte'},h('h2',{},t('abgleich_verlauf')),verlauf));
}


async function adminLogins(){
 zeigen(kopf(t('admin_logins_titel')),h('p',{},t('a_betoltes')));
 const result=await api('GET','/api/admin/logins');
 if(!result.ok)return zeigen(kopf(t('admin_logins_titel')),h('p',{class:'meldung rot'},fehlerText(result)));
 zeigen(kopf(t('admin_logins_titel')),
  h('button',{type:'button',class:'knopf klein hell',onclick:uebersicht},t('a_vissza')),
  listeMitMehr(h('section',{class:'karte'}),result.d,x=>h('p',{class:'klein'},
    budapestZeit(x.zeit)+' · '+t('admin_login_'+x.ergebnis)+' · '+x.email_maskiert+' · '+x.adresse_maskiert), {schluessel:'adminLogins', serverGrenze:LISTEN_GRENZEN.adminLogins}));
}


async function verkaufBereich(){
 zeigen(kopf(t('verkauf_titel')),h('p',{},t('a_betoltes')));
 const r=await api('GET','/api/admin/verkauf');
 if(!r.ok)return zeigen(kopf(t('verkauf_titel')),h('p',{class:'meldung rot'},fehlerText(r)));
 const v=r.d;
 const grund=h('textarea',{maxlength:200,rows:3,placeholder:t('verkauf_grund_label')});
 const neu=h('button',{class:'knopf rot',type:'button',onclick:()=>{
  const text=grund.value.trim();
  if(text.length<1||text.length>200||/[\u0000-\u001f\u007f]/.test(text))return meldung(t('verkauf_grund_fehler'),'rot');
  bestaetigen('verkauf_pause_frage',async()=>{
   const z=await api('POST','/api/admin/verkauf/pausieren',{grund:text});
   if(!z.ok)return meldung(fehlerText(z),'rot');
   await verkaufBereich();
  });
 }},t('verkauf_pausieren'));
 const weiter=h('button',{class:'knopf',type:'button',onclick:()=>bestaetigen('verkauf_weiter_frage',async()=>{
  const z=await api('POST','/api/admin/verkauf/fortsetzen',{});
  if(!z.ok)return meldung(fehlerText(z),'rot');
  await verkaufBereich();
 })},t('verkauf_fortsetzen'));
 const eintraege=listeMitMehr(h('div',{}),v.protokoll,x=>h('p',{class:'klein'},
   budapestZeit(x.zeit)+' · '+
   t('verkauf_aktion_'+x.aktion)+' · '+(x.grund==='env'?t('verkauf_grund_env'):x.grund)+' · '+x.wer), {schluessel:'verkaufProtokoll', serverGrenze:LISTEN_GRENZEN.verkaufProtokoll});
 zeigen(kopf(t('verkauf_titel')),
  h('button',{class:'knopf klein hell',type:'button',onclick:uebersicht},t('a_vissza')),
  h('section',{class:'karte'},
   h('h2',{},t(v.pausiert?'verkauf_pausiert_status':'verkauf_laeuft')),
   v.seit?h('p',{},t('verkauf_seit')+': '+budapestZeit(v.seit)):null,
   v.grund?h('p',{},t('verkauf_grund_label')+': '+v.grund):null,
   v.wer?h('p',{},t('verkauf_wer')+': '+v.wer):null,
   v.env_pausiert?h('p',{class:'meldung rot'},t('verkauf_env_hinweis')):null,
   h('p',{class:'klein'},t('verkauf_checkout_hinweis')),
   !v.db_pausiert?h('div',{},h('label',{class:'feld'},h('span',{},t('verkauf_grund_label')),grund),neu):null,
   v.db_pausiert&&!v.env_pausiert?weiter:null),
  h('section',{class:'karte'},h('h2',{},t('verkauf_protokoll')),eintraege));
}

// Kurzuscsomag: immer erst Vorschau, danach bestaetigter neuer Entwurf.
async function kurspaketImport(){
 const feld=h('textarea',{class:'kurspaket-text',rows:'14','aria-label':t('paket_eingabe')});
 const ausgabe=h('section',{class:'karte',role:'status','aria-live':'polite'});
 const create=h('button',{class:'knopf gross',type:'button',disabled:true},t('paket_anlegen'));
 let geprueft='';
 feld.addEventListener('input',()=>{create.disabled=true;geprueft='';ausgabe.replaceChildren();});
 const pfadAnzeige=pfad=>{
  const m=/^lektionen\[(\d+)\]\.(titel|inhalt|reihenfolge)$/.exec(pfad);
  if(m)return t(m[2]==='titel'?'paket_pfad_lektion_titel':m[2]==='inhalt'?'paket_pfad_lektion_inhalt':'paket_pfad_lektion_sorrend',{n:Number(m[1])+1});
  if(pfad==='kurs.titel')return t('paket_pfad_kurs_titel');
  return '';
 };
 const errors=d=>Array.isArray(d?.fehler)?d.fehler.map(e=>h('p',{class:'meldung rot'},
  (pfadAnzeige(e.pfad)?pfadAnzeige(e.pfad)+' · ':'')+t(e.code))):[h('p',{class:'meldung rot'},t('paket_fehler'))];
 const pruefen=h('button',{class:'knopf gross hell',type:'button',onclick:async()=>{
   create.disabled=true;
   const value=feld.value;
   const r=await api('POST','/api/admin/kurspaket/pruefen',{paket:value});
   if(!r.ok){ausgabe.replaceChildren(...errors(r.d));return;}
   geprueft=value;create.disabled=false;
   ausgabe.replaceChildren(h('h2',{},t('paket_vorschau')),
    h('p',{},r.d.titel+' · '+t('paket_lektionen_anzahl',{n:r.d.anzahl_lektionen})),
    h('p',{},formatBetrag(r.d.preis_forint*100,'huf')),
    ...r.d.zeichen.map((n,i)=>h('p',{},t('paket_lektion_zeichen',{n:i+1,zeichen:n}))),
    ...r.d.warnungen.map(w=>h('p',{class:'hinweis'},t(w))),
    ...(r.d.vorhanden?[h('p',{class:'hinweis'},t('paket_vorhanden'))]:[]),
    ...(r.d.umbenannt?[h('p',{class:'hinweis'},t('paket_umbenannt'))]:[]));
 }},t('paket_pruefen'));
 create.addEventListener('click',async()=>{
   if(create.disabled||geprueft!==feld.value)return;
   if(!window.confirm(t('paket_frage')))return;
   create.disabled=true;
   const r=await api('POST','/api/admin/kurspaket/anlegen',{paket:geprueft});
   if(!r.ok){ausgabe.replaceChildren(...errors(r.d));return;}
   ausgabe.replaceChildren(h('p',{},t(r.d.vorhanden?'paket_vorhanden':'paket_fertig')),
     h('p',{},t('paket_nachher')),
     h('button',{type:'button',class:'knopf',onclick:()=>kurs(r.d.kurs_id)},t('a_megnyitas')));
 });
 zeigen(kopf(t('paket_titel')),h('button',{type:'button',class:'knopf klein hell',onclick:uebersicht},t('a_vissza')),
   h('section',{class:'karte kurspaket-import'},h('h2',{},t('paket_titel')),
     h('label',{class:'feld'},h('span',{},t('paket_eingabe')),feld),pruefen,create),ausgabe);
}
async function kurspaketExport(id){
 const r=await api('GET','/api/admin/kurse/'+id+'/kurspaket');
 if(!r.ok)return meldung(fehlerText(r),'rot');
 const field=h('textarea',{class:'kurspaket-text',rows:'12',readonly:true,'aria-label':t('paket_export')});
 field.value=JSON.stringify(r.d,null,2);
 const copy=h('button',{class:'knopf',type:'button',onclick:async()=>{
   try{await navigator.clipboard.writeText(field.value);meldung(t('paket_kopiert'));}
   catch{field.focus();field.select();meldung(t('paket_markieren'));}
 }},t('paket_masolas'));
 zeigen(kopf(t('paket_export')),h('button',{type:'button',class:'knopf klein hell',onclick:()=>kurs(id)},t('a_vissza')),
   h('section',{class:'karte'},h('label',{class:'feld'},t('paket_export'),field),copy));
}

// ---- Meine Marke: Name + Logo -------------------------------------------------------------------
// Nach jeder Aenderung Name/Logo/Titel sofort erneuern (ohne Neuladen der Seite): /api/texte neu holen, Tab-Titel und Kopf-Logo setzen.
async function markeNeuLaden() {
  try {
    const rt = await fetch('/api/texte');
    if (rt.ok) {
      const n = await rt.json();
      T._logo = n._logo; T._logo_vertikal = n._logo_vertikal; T._plattform = n._plattform; T._titel_praefix = n._titel_praefix;
    }
  } catch { /* Anzeige bleibt wie sie ist */ }
  document.title = (T._titel_praefix || '') + t('a_titel');
  const bild = document.querySelector('.admin-marke img');
  // Gleiche Adresse (z. B. /img/marke-logo.svg bei zwei verschiedenen Namen) wuerde der Browser nicht neu laden: Zaehler anhaengen.
  if (bild) { const basis = T._logo || '/img/muster-logo.svg'; bild.setAttribute('src', basis + (basis.includes('?') ? '' : '?n=' + Date.now())); }
  const favLink = document.querySelector('link[rel~="icon"]');
  if (favLink) {
    if (T._logo && T._logo.startsWith('/marke/logo.png')) {
      favLink.setAttribute('type', 'image/png');
      favLink.setAttribute('href', T._logo);
    } else {
      favLink.setAttribute('type', 'image/svg+xml');
      favLink.setAttribute('href', '/favicon.svg?n=' + Date.now());
    }
  }
}
async function markeBereich() {
  zeigen(kopf(t('marke_titel')), h('p', {}, t('a_betoltes')));
  const r = await api('GET', '/api/admin/marke');
  if (r.status === 401) return anmeldung();
  if (r.status === 403) return keinRecht();
  if (!r.ok) { zeigen(kopf(t('marke_titel')), h('p', { class: 'meldung rot' }, fehlerText(r))); return; }
  const d = r.d;

  // Name-Formular
  const nameEingabe = h('input', { type: 'text', maxlength: '60', required: true, class: 'eingabe', value: d.name });
  const nameSpeichern = h('button', { class: 'knopf', type: 'submit' }, t('a_mentes'));
  const nameForm = h('form', { onsubmit: async (ev) => {
    ev.preventDefault();
    nameSpeichern.disabled = true;
    const rr = await apiMitStepup('PUT', '/api/admin/marke/name', { name: nameEingabe.value });
    nameSpeichern.disabled = false;
    if (!rr.ok) return meldung(fehlerText(rr), 'rot');
    await markeNeuLaden();
    meldung(t('marke_name_ok'));
  } }, feld(t('marke_name_bezeichnung'), nameEingabe), nameSpeichern);

  // Logo-Bereich
  const logoEingabe = h('input', { type: 'file', class: 'versteckt', accept: 'image/png' });
  const logoHochladenKnopf = h('label', { class: 'knopf klein' }, t('marke_logo_bezeichnung'), logoEingabe);
  const logoLoeschenKnopf = d.hat_logo ? h('button', { class: 'knopf klein rot', type: 'button', onclick: () => bestaetigen('marke_logo_loeschen_frage', async () => {
    const rr = await apiMitStepup('DELETE', '/api/admin/marke/logo', {});
    if (!rr.ok) return meldung(fehlerText(rr), 'rot');
    await markeNeuLaden();
    meldung(t('marke_logo_entfernt'));
    await markeBereich();
  }) }, t('marke_logo_loeschen')) : null;
  const logoVorschau = d.hat_logo ? h('img', { class: 'marke-logo-vorschau', src: d.logo, alt: t('marke_logo_vorschau_alt') }) : null;

  const logoSenden = (buf) => fetch('/api/admin/marke/logo', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf })
    .then(async (x) => { let dd = {}; try { dd = await x.json(); } catch { /* kein JSON */ } return { ok: x.ok, status: x.status, d: dd }; })
    .catch(() => ({ ok: false, status: 0, d: {} }));
  let lokaleLogoUrl = null, logoBytes = null, logoSeq = 0, logoUploadLaeuft = false;
  const logoUpload = h('button', { type: 'button', class: 'knopf klein', disabled: true, onclick: async () => {
    if (!logoBytes || logoUploadLaeuft) return;
    const bytes = logoBytes;
    logoUploadLaeuft = true; logoUpload.disabled = true;
    try {
      let rr = await logoSenden(bytes);
      if (rr.status === 401 && rr.d?.fehler === 'stepup_noetig') {
        if (!(await stepupAnfordern())) return;
        rr = await logoSenden(bytes);
      }
      if (!rr.ok) return meldung(fehlerText(rr), 'rot');
      await markeNeuLaden();
      meldung(t('marke_logo_ok'));
      await markeBereich();
    } finally { logoUploadLaeuft = false; logoUpload.disabled = !logoBytes; }
  } }, t('marke_logo_hochladen'));
  const logoHinweis = h('p', { class: 'hinweis', role: 'status' });
  logoEingabe.addEventListener('change', async () => {
    const lauf = ++logoSeq, datei = logoEingabe.files[0];
    logoHinweis.textContent = '';
    logoBytes = null; logoUpload.disabled = true;
    try {
      lokaleLogoUrl = null;   // data:-URL, nichts freizugeben (blob: waere durch die CSP img-src blockiert)
      aktualisiereMuster();
      if (!datei) return;
      const ungueltig = () => { if (lauf !== logoSeq) return; logoHinweis.textContent = t('png_ungueltig'); };
      if (datei.type !== 'image/png' || !/\.png$/i.test(datei.name) || datei.size > d.logo_max_bytes) return ungueltig();
      const buf = await datei.arrayBuffer();
      if (lauf !== logoSeq) return;
      const signatur = [137,80,78,71,13,10,26,10];
      if (buf.byteLength < 8 || !signatur.every((b, i) => new Uint8Array(buf)[i] === b)) return ungueltig();
      const url = await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(datei); });   // data:-URL, die CSP erlaubt img-src data:
      if (lauf !== logoSeq) return;
      if (typeof url !== 'string') return ungueltig();
      const bild = new Image();
      bild.src = url;
      try { await bild.decode(); } catch { if (lauf !== logoSeq) return; return ungueltig(); }
      if (lauf !== logoSeq) return;
      if (bild.naturalWidth < 64 || bild.naturalWidth > 2000 || bild.naturalHeight < 64 || bild.naturalHeight > 2000) return ungueltig();
      lokaleLogoUrl = url; logoBytes = buf; logoUpload.disabled = logoUploadLaeuft;
      logoHinweis.textContent = t('marke_vorschau_hinweis');
      aktualisiereMuster();
    } catch { if (lauf !== logoSeq) return; logoHinweis.textContent = t('png_ungueltig'); }
    finally { if (lauf === logoSeq) logoEingabe.value = ''; }
  });
  if (d.name_fix) { nameEingabe.disabled = true; nameSpeichern.disabled = true; }

  // S1: ungespeicherte Startseite, nur data:-URLs für lokale Bilder.
  let bannerUrl = d.banner_url || null, bannerDatei = null, bannerSeq = 0, bannerBusy = false;
  const s1Meldung = h('p', { role: 'status', 'aria-live': 'polite' });
  const s1Normalisiere = wert => wert.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '').trim();
  const s1Abbruch = () => {
    s1Meldung.setAttribute('role', 'status');
    s1Meldung.textContent = t('s1_abgebrochen');
  };
  const s1Api = async (methode, pfad, body) => {
    const rr = await api(methode, pfad, body);
    if (rr.status !== 401 || rr.d?.fehler !== 'stepup_noetig') return rr;
    if (!(await stepupAnfordern())) return { abgebrochen: true };
    return api(methode, pfad, body);
  };
  const s1Fehler = rr => {
    if (rr.abgebrochen) return s1Abbruch();
    const code = rr.d?.fehler;
    s1Meldung.setAttribute('role', 'alert');
    s1Meldung.textContent = T[code] || rr.d?.text || t(rr.d ? 's1_server_fehler' : 'a_halozati_hiba');
  };
  const s1Aktion = async (knopf, aktion) => {
    knopf.disabled = true;
    try { await aktion(); } catch { s1Fehler({}); }
    finally { knopf.disabled = false; }
  };
  // Standardtexte je Sprache einmal laden; auch Fehlschläge merken.
  const s1Standards = {};
  const s1Cache = markeBereich.s1Texte || (markeBereich.s1Texte = new Map());
  await Promise.all(['de', 'en', 'hu'].map(async l => {
    if (l === (T._sprache || 'de')) {
      s1Standards[l] = { titel: t('k_oldal_cim'), untertitel: t('k_hero_alkim') };
      return;
    }
    if (!s1Cache.has(l)) s1Cache.set(l, (async () => {
      try {
        const rr = await api('GET', '/api/texte?lang=' + l);
        if (!rr.ok || typeof rr.d?.k_oldal_cim !== 'string' || typeof rr.d?.k_hero_alkim !== 'string') return null;
        return { titel: rr.d.k_oldal_cim, untertitel: rr.d.k_hero_alkim };
      } catch { return null; }
    })());
    s1Standards[l] = await s1Cache.get(l);
  }));
  const heroFelder = {};
  const heroGruppen = ['de', 'en', 'hu'].map(l => {
    heroFelder[l] = {};
    return h('fieldset', {}, h('legend', {}, l.toUpperCase()), ...['titel', 'untertitel'].map(f => {
      const max = f === 'titel' ? 80 : 200;
      const standard = s1Standards[l]?.[f] || '';
      const eingabe = h('input', { type: 'text', class: 'eingabe', lang: l, value: d.hero?.[l]?.[f] || '', placeholder: standard });
      const zaehler = h('span', { class: 'klein', id: 's1-' + l + '-' + f + '-zahl' });
      eingabe.setAttribute('aria-describedby', zaehler.id);
      const zaehlen = () => {
        const anzahl = Array.from(s1Normalisiere(eingabe.value)).length;
        zaehler.textContent = anzahl + ' / ' + max;
        eingabe.setCustomValidity(anzahl > max ? t('hero_ungueltig') : '');
        eingabe.setAttribute('aria-invalid', String(anzahl > max));
      };
      eingabe.addEventListener('input', () => { zaehlen(); aktualisiereHero(); });
      zaehlen(); heroFelder[l][f] = eingabe;
      return h('div', {}, feld(t(f === 'titel' ? 's1_titel_feld' : 's1_untertitel'), eingabe), zaehler,
        h('p', { class: 'klein' }, standard ? t('s1_standard', { text: standard }) : t('s1_leer_hinweis')));
    }));
  });
  const heroSprache = h('select', { class: 'eingabe' }, ...['de', 'en', 'hu'].map(l => h('option', { value: l }, l.toUpperCase())));
  heroSprache.value = T._sprache || 'de';
  heroSprache.addEventListener('change', () => aktualisiereHero());
  const heroVorschauen = [];
  function aktualisiereHero() {
    const l = heroSprache.value;
    const titel = s1Normalisiere(heroFelder[l].titel.value) || s1Standards[l]?.titel || t('s1_leer_hinweis');
    const untertitel = s1Normalisiere(heroFelder[l].untertitel.value) || s1Standards[l]?.untertitel || t('s1_leer_hinweis');
    for (const { box, bild, kopf, text } of heroVorschauen) {
      box.lang = l; box.classList.toggle('hero-banner', !!bannerUrl);
      bild.hidden = !bannerUrl;
      if (bannerUrl) bild.src = bannerUrl; else bild.removeAttribute('src');
      bild.alt = titel; kopf.textContent = titel; text.textContent = untertitel;
    }
  }
  const bannerEingabe = h('input', { type: 'file', class: 'eingabe', accept: 'image/png,image/jpeg', id: 's1-banner-datei' });
  const bannerUpload = h('button', { type: 'button', class: 'knopf', disabled: true, onclick: async () => {
    if (!bannerDatei || bannerBusy) return;
    const datei = bannerDatei; bannerBusy = true;
    await s1Aktion(bannerUpload, async () => {
      const senden = async () => {
        try {
          const r = await fetch('/api/admin/marke/banner', { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: datei });
          let d = {}; try { d = await r.json(); } catch {}
          return { ok: r.ok, status: r.status, d };
        } catch { return { ok: false }; }
      };
      let rr = await senden();
      if (rr.status === 401 && rr.d?.fehler === 'stepup_noetig') {
        if (!(await stepupAnfordern())) return s1Abbruch();
        rr = await senden();
      }
      if (!rr.ok) return s1Fehler(rr);
      d.banner_url = rr.d.url; bannerEntfernen.disabled = false;
      s1Meldung.setAttribute('role', 'status'); s1Meldung.textContent = t('s1_ok');
    });
    bannerBusy = false; bannerUpload.disabled = !bannerDatei;
  } }, t('s1_upload'));
  bannerEingabe.addEventListener('change', async () => {
    const lauf = ++bannerSeq, datei = bannerEingabe.files[0];
    bannerDatei = null; bannerUpload.disabled = true; bannerUrl = d.banner_url || null;
    s1Meldung.textContent = ''; aktualisiereHero();
    if (!datei) return;
    const fehler = code => { if (lauf === bannerSeq) s1Fehler({ d: { fehler: code } }); };
    if (datei.size > 3145728) return fehler('banner_zu_gross');
    if (!['image/png', 'image/jpeg'].includes(datei.type)) return fehler('banner_format');
    try {
      const url = await new Promise((ok, nein) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = nein; fr.onabort = nein; fr.readAsDataURL(datei); });
      const bild = new Image(); bild.src = url; await bild.decode();
      if (lauf !== bannerSeq) return;
      if (bild.naturalWidth < 400 || bild.naturalHeight < 400 || bild.naturalWidth > 4096 || bild.naturalHeight > 4096) return fehler('banner_abmessung_ungueltig');
      bannerUrl = url; bannerDatei = datei; bannerUpload.disabled = bannerBusy; aktualisiereHero();
    } catch { fehler('s1_lokal_fehler'); }
  });
  const bannerEntfernen = h('button', { type: 'button', class: 'knopf hell', disabled: !d.banner_url, onclick: () => bestaetigen('s1_frage', () => s1Aktion(bannerEntfernen, async () => {
    const rr = await s1Api('DELETE', '/api/admin/marke/banner', {});
    if (!rr.ok) return s1Fehler(rr);
    ++bannerSeq; d.banner_url = null; bannerUrl = null; bannerDatei = null; bannerEingabe.value = ''; bannerUpload.disabled = true;
    aktualisiereHero(); s1Meldung.setAttribute('role', 'status'); s1Meldung.textContent = t('s1_ok');
  })) }, t('s1_entfernen'));
  const heroSpeichern = h('button', { type: 'button', class: 'knopf', onclick: () => s1Aktion(heroSpeichern, async () => {
    for (const felder of Object.values(heroFelder)) for (const el of Object.values(felder)) if (!el.reportValidity()) return;
    const daten = Object.fromEntries(Object.entries(heroFelder).map(([l, felder]) => [l, Object.fromEntries(Object.entries(felder).map(([f, el]) => [f, s1Normalisiere(el.value)]))]));
    const rr = await s1Api('PUT', '/api/admin/marke/hero', daten);
    if (!rr.ok) return s1Fehler(rr);
    s1Meldung.setAttribute('role', 'status'); s1Meldung.textContent = t('s1_ok');
  }) }, t('s1_speichern'));
  const heroReset = h('button', { type: 'button', class: 'knopf hell', onclick: () => s1Aktion(heroReset, async () => {
    const rr = await s1Api('DELETE', '/api/admin/marke/hero', {});
    if (!rr.ok) return s1Fehler(rr);
    for (const felder of Object.values(heroFelder)) for (const el of Object.values(felder)) { el.value = ''; el.dispatchEvent(new Event('input')); }
    s1Meldung.setAttribute('role', 'status'); s1Meldung.textContent = t('s1_ok');
  }) }, t('s1_reset'));
  const startseiteSection = h('section', { class: 'karte marke-startseite' }, h('h2', {}, t('s1_titel')),
    feld(t('s1_datei'), bannerEingabe), h('p', {}, t('s1_hilfe')), h('p', {}, t('s1_metadaten')),
    h('div', { class: 'zeile' }, bannerUpload, bannerEntfernen), ...heroGruppen,
    h('div', { class: 'zeile' }, heroSpeichern, heroReset), s1Meldung);

  const musterNamen = [], musterBilder = [];
  const muster = (admin) => {
    const name = h('strong', { class: 'marke-vorschau-name' }); musterNamen.push(name);
    const bild = h('img', { class: 'marke-logo-vorschau', alt: t('marke_logo_vorschau_alt') }); musterBilder.push(bild);
    const heroBild = h('img', { class: 'hero-banner-bild', loading: 'eager', hidden: true });
    const heroKopf = h('h3'), heroText = h('p', { class: 'lead' });
    const heroBox = h('div', { class: 'hero' }, heroBild, h('div', { class: 'hero-belso' }, heroKopf, heroText));
    heroVorschauen.push({ box: heroBox, bild: heroBild, kopf: heroKopf, text: heroText });
    return h('div', { class: 'marke-muster', 'data-muster': admin ? 'admin' : 'shop' },
      h('header', { class: 'admin-marke marke-muster-kopf' }, bild, name),
      heroBox,
      h('button', { class: 'knopf', type: 'button' }, t('marke_vorschau_beispiel')),
      h('section', { class: 'karte' }, t('marke_vorschau_beispiel')),
      admin ? h('nav', { class: 'admin-werkzeuge' }, h('button', { class: 'knopf klein hell', type: 'button' }, t('marke_titel'))) : null);
  };
  const shopMuster = muster(false), adminMuster = muster(true);
  const mailMuster = h('iframe', { name: 'marke-mail-vorschau', sandbox: '', title: t('marke_vorschau_mail'), class: 'marke-mail-vorschau' });
  const musterContainer = h('div', { class: 'marke-gesamtvorschau' }, shopMuster, adminMuster, mailMuster);
  const register = [['shop', shopMuster], ['admin', adminMuster], ['mail', mailMuster]];
  const tabs = register.map(([key, panel]) => h('button', { type: 'button', class: 'knopf klein hell', role: 'tab', 'aria-selected': key === 'shop' ? 'true' : 'false', onclick: () => {
    register.forEach(([, p], i) => { p.hidden = p !== panel; tabs[i].setAttribute('aria-selected', String(p === panel)); });
  } }, t('marke_vorschau_' + key)));
  adminMuster.hidden = true; mailMuster.hidden = true;
  let mailTimer, mailAnfrage = 0;
  function aktualisiereMuster() {
    aktualisiereHero();
    musterNamen.forEach(n => { n.textContent = nameEingabe.value; });
    musterBilder.forEach(b => { b.src = lokaleLogoUrl || d.logo; });
    clearTimeout(mailTimer);
    const anfrage = ++mailAnfrage;
    mailTimer = setTimeout(async () => {
      if (!mailMuster.isConnected) return;
      try {
        const antwort = await fetch('/api/admin/marke/vorschau/mail', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameEingabe.value, logo: lokaleLogoUrl || '', anbieter: holAnbieter() }) });
        if (!antwort.ok) throw new Error('vorschau');
        const { token } = await antwort.json();
        if (typeof token !== 'string') throw new Error('vorschau');
        if (anfrage !== mailAnfrage || !mailMuster.isConnected) return;
        // Fehlertexte kommen vom Server (404 vorschau_abgelaufen, mit Frame-Headern), kein HTML wird im Browser gebaut
        mailMuster.src = '/api/admin/marke/vorschau/mail?token=' + encodeURIComponent(token);
      } catch {
        if (anfrage !== mailAnfrage || !mailMuster.isConnected) return;
        mailMuster.src = '/api/admin/marke/vorschau/mail?token=fehler';   // bekannter ungueltiger Token: der Server liefert den Hinweistext (404), frameable
      }
    }, 350);
  }
  nameEingabe.addEventListener('input', aktualisiereMuster);
  const gesamtVorschau = h('section', { class: 'karte', id: 'marke-gesamtvorschau' }, h('h2', {}, t('marke_vorschau_titel')),
    h('p', { class: 'hinweis' }, t('marke_vorschau_hinweis')), feld(t('s1_sprache'), heroSprache), h('div', { role: 'tablist' }, ...tabs), musterContainer);

  // Farben-Bereich
  // Standardpalette aus farben.mjs (verwendet wenn keine Farben gespeichert sind)
  const FARBEN_STANDARD = { haupt: '#d4a843', dunkel: '#0d0a05', hell: '#faf6ee' };
  const farbFelder = ['haupt', 'dunkel', 'hell'].map((name) => {
    const aktiv = d.farben?.[name] || FARBEN_STANDARD[name];
    const picker = h('input', { type: 'color', value: aktiv });
    const hex = h('input', { type: 'text', class: 'farb-hex eingabe', maxlength: '7', value: aktiv, placeholder: '#rrggbb' });
    picker.addEventListener('input', () => { hex.value = picker.value; debouncedPruefen(); });
    hex.addEventListener('input', () => { if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) { picker.value = hex.value; } debouncedPruefen(); });
    return { name, picker, hex };
  });
  const holeFarben = () => Object.fromEntries(farbFelder.map(({ name, hex }) => [name, hex.value]));

  const vorschauContainer = h('div', {});
  const zeigeVorschau = (pruefung) => {
    if (!pruefung) { vorschauContainer.textContent = ''; return; }
    const sortiert = [...pruefung].sort((a, b) => a.ok - b.ok);
    const zeilen = sortiert.map((p) => {
      const paarId = p.paar.replace('/', '_');
      const paarName = t('farben_paar_' + paarId) || p.paar;
      return h('tr', { class: p.ok ? '' : 'rot' },
        h('td', {}, paarName),
        h('td', {}, p.verhaeltnis.toFixed(2) + ':1'),
        h('td', {}, p.soll + ':1'),
        h('td', {}, t(p.ok ? 'farben_status_ok' : 'farben_status_schlecht')));
    });
    vorschauContainer.textContent = '';
    vorschauContainer.appendChild(h('table', { class: 'farben-prueftabelle' },
      h('thead', {}, h('tr', {},
        h('th', {}, t('farben_paar_kopf')),
        h('th', {}, t('farben_kontrast_kopf')),
        h('th', {}, t('farben_soll_kopf')),
        h('th', {}, t('farben_status_kopf')))),
      h('tbody', {}, ...zeilen)));
  };

  // Sequenzzähler: verhindert dass eine ältere Antwort eine neuere Tabelle überschreibt
  let debounceTimer, seq = 0;
  const debouncedPruefen = () => { ++seq; farbenSpeichern.disabled = true; clearTimeout(debounceTimer); debounceTimer = setTimeout(autoVorschau, 400); };

  const autoVorschau = async () => {
    const meineSeq = ++seq;
    const rr = await api('POST', '/api/admin/marke/farben-pruefen', holeFarben());
    if (meineSeq !== seq) return; // neuere Anfrage läuft bereits
    if (!rr.ok) {
      if (rr.status === 401 || rr.status === 403) { meldung(fehlerText(rr), 'rot'); return; }
      if (rr.status === 422 && rr.d?.fehler === 'farbe_ungueltig') { farbenSpeichern.disabled = true; zeigeVorschau(null); meldung(t('farbe_ungueltig'), 'rot'); return; }
    }
    farbenSpeichern.disabled = !rr.ok || rr.d?.ok !== true;
    if (rr.d?.tokens) {
      const namen = { goldM: 'gold-m', goldD: 'gold-d', goldL: 'gold-l', textOnDark: 'text-on-dark', textSecond: 'text-second', footerText: 'footer-text', knopfText: 'knopf-text' };
      Object.entries(rr.d.tokens).forEach(([key, wert]) => musterContainer.style.setProperty('--' + (namen[key] || key), wert));
    }
    if (rr.d?.pruefung) zeigeVorschau(rr.d.pruefung);
  };

  const farbenPruefen = h('button', { class: 'knopf klein', type: 'button', onclick: autoVorschau }, t('farben_pruefen_knopf'));

  const farbenSpeichern = h('button', { class: 'knopf', type: 'button', onclick: async () => {
    const rr = await apiMitStepup('PUT', '/api/admin/marke/farben', holeFarben());
    if (!rr.ok) {
      if (rr.d?.fehler === 'farben_kontrast' || rr.d?.fehler === 'farbe_ungueltig') {
        if (rr.d?.pruefung) zeigeVorschau(rr.d.pruefung);
        if (rr.d?.probleme?.length) zeigeVorschau(rr.d.pruefung);
      }
      return meldung(fehlerText(rr), 'rot');
    }
    meldung(t('farben_gespeichert_neuladen'));
    location.reload();
  } }, t('farben_speichern_knopf'));

  const farbenZurueck = h('button', { class: 'knopf klein hell', type: 'button', onclick: async () => {
    const rr = await apiMitStepup('DELETE', '/api/admin/marke/farben', {});
    if (!rr.ok) return meldung(fehlerText(rr), 'rot');
    meldung(t('farben_gespeichert_neuladen'));
    location.reload();
  } }, t('farben_zuruecksetzen_knopf'));

  const farbenSection = h('section', { class: 'karte' },
    h('h2', {}, t('marke_farben_bezeichnung')),
    ...farbFelder.map(({ name, picker, hex }) =>
      feld(t('farben_' + name), h('div', { class: 'zeile' }, picker, hex))),
    h('div', { class: 'zeile' }, farbenPruefen, farbenSpeichern, farbenZurueck),
    h('h3', {}, t('farben_vorschau_titel')),
    vorschauContainer);

  if (d.farben) zeigeVorschau(await api('POST', '/api/admin/marke/farben-pruefen', d.farben).then(r => r.d?.pruefung));

  // Anbieterdaten-Bereich
  const ANBIETER_FELDER = ['name', 'anschrift', 'telefon', 'email', 'adoszam', 'steuerHinweis'];
  const ANBIETER_PFLICHTFELDER = ['name', 'anschrift', 'email'];
  const ANBIETER_FEHLER_ZU_FELD = {
    'anbieter_email_ungueltig': 'email',
    'anbieter_telefon_ungueltig': 'telefon',
    'anbieter_ungueltig': null,
  };
  const anbFeldEingaben = {};
  const anbFeldFehler = {};
  for (const f of ANBIETER_FELDER) {
    const textKey = 'anbieter_' + (f === 'steuerHinweis' ? 'steuerhinweis' : f);
    const eingabe = h('input', { type: 'text', class: 'eingabe', value: d.anbieter?.[f] ?? '' });
    const fehlerEl = h('span', { class: 'meldung rot klein versteckt' });
    eingabe.addEventListener('input', aktualisiereMuster);
    anbFeldEingaben[f] = eingabe;
    anbFeldFehler[f] = fehlerEl;
  }
  const holAnbieter = () => Object.fromEntries(ANBIETER_FELDER.map(f => [f, anbFeldEingaben[f].value]));
  const anbFeldFehlerAusblendenAlle = () => { for (const f of ANBIETER_FELDER) { anbFeldFehler[f].textContent = ''; anbFeldFehler[f].classList.add('versteckt'); } };

  const quelle = d.anbieter?.quelle ?? (d.anbieter ? 'marke' : 'standard');
  const quelleText = t('anbieter_quelle_' + quelle);
  const quellzeile = h('p', { class: 'klein' }, t('anbieter_quelle'), ' ', quelleText);

  const anbSpeichern = h('button', { class: 'knopf', type: 'button', onclick: async () => {
    anbFeldFehlerAusblendenAlle();
    const rr = await apiMitStepup('PUT', '/api/admin/marke/anbieter', holAnbieter());
    if (!rr.ok) {
      const code = rr.d?.fehler;
      if (code === 'anbieter_pflicht') {
        for (const f of (rr.d?.felder ?? [])) {
          if (anbFeldFehler[f]) {
            anbFeldFehler[f].textContent = t('anbieter_pflicht');
            anbFeldFehler[f].classList.remove('versteckt');
          }
        }
      } else if (code && code in ANBIETER_FEHLER_ZU_FELD) {
        const feldName = ANBIETER_FEHLER_ZU_FELD[code] ?? rr.d?.felder?.[0];
        if (feldName && anbFeldFehler[feldName]) {
          anbFeldFehler[feldName].textContent = t(code);
          anbFeldFehler[feldName].classList.remove('versteckt');
        }
      }
      return meldung(fehlerText(rr), 'rot');
    }
    meldung(t('anbieter_gespeichert'));
    await markeBereich();
  } }, t('anbieter_speichern_knopf'));

  const anbZurueck = h('button', { class: 'knopf klein hell', type: 'button', onclick: async () => {
    const rr = await apiMitStepup('DELETE', '/api/admin/marke/anbieter', {});
    if (!rr.ok) return meldung(fehlerText(rr), 'rot');
    meldung(t('anbieter_gespeichert'));
    await markeBereich();
  } }, t('anbieter_zuruecksetzen_knopf'));

  const anbSection = h('section', { class: 'karte' },
    h('h2', {}, t('marke_anbieter_bezeichnung')),
    quellzeile,
    h('p', { class: 'klein' }, t('anbieter_pflichtfeld_hinweis')),
    ...ANBIETER_FELDER.map(f => {
      const textKey = 'anbieter_' + (f === 'steuerHinweis' ? 'steuerhinweis' : f);
      const label = ANBIETER_PFLICHTFELDER.includes(f) ? t(textKey) + ' *' : t(textKey);
      return h('div', {}, feld(label, anbFeldEingaben[f]), anbFeldFehler[f]);
    }),
    h('div', { class: 'zeile' }, anbSpeichern, anbZurueck));

  // Rechtstexte-Bereich (A4b)
  const rechtBereich = h('div', { 'data-recht-admin': '' },
    h('h2', {}, t('recht_admin_ueberschrift')));
  const rechtMeldung = h('div', { 'aria-live': 'polite', role: 'status' });
  const rechtKarten = h('div', {});
  rechtBereich.append(rechtMeldung, rechtKarten);
  const rechtLaden = async (erfolg = false) => {
    rechtMeldung.replaceChildren();
    rechtKarten.replaceChildren(h('p', {}, t('a_betoltes')));
    const rr = await api('GET', '/api/admin/recht');
    if (!rr.ok) {
      rechtKarten.replaceChildren(h('p', { class: 'meldung rot' }, fehlerText(rr)),
        h('button', { type: 'button', class: 'knopf klein', onclick: () => rechtLaden() }, t('recht_admin_neu_laden')));
      return;
    }
    rechtKarten.replaceChildren();
    if (erfolg) rechtMeldung.append(h('p', { class: 'meldung' }, t('recht_admin_gespeichert')));
    for (const seite of rr.d.seiten) {
      const weg = '/api/admin/recht/' + encodeURIComponent(seite.seite);
      const basisVersion = seite.aktiv?.version ?? 0;
      const meta = (v) => [v.version, v.erstellt ? budapestZeit(v.erstellt) : '', v.bearbeiter ?? '', v.sprache].join(' · ');
      const titel = seite.seite === 'reszveteli-feltetelek' ? 'feltetelek' : seite.seite;
      const karte = h('section', { class: 'karte', 'data-recht-seite': seite.seite },
        h('h3', {}, t('recht_admin_titel_' + titel)),
        h('p', {}, t('recht_admin_status_' + seite.modus)),
        h('p', { class: 'klein' }, seite.aktiv ? meta(seite.aktiv) : t('recht_admin_keine_version')));
      rechtKarten.append(karte);
      const lokalMeldung = h('div', { 'aria-live': 'polite' });
      const eingaben = {};
      const feldFehler = {};
      const fehler = (r) => {
        const schluessel = {
          recht_url_aktiv: 'recht_admin_fehler_url_aktiv',
          recht_konflikt: 'recht_admin_fehler_konflikt',
          recht_ungueltig: 'recht_admin_fehler_ungueltig',
        }[r.d?.fehler];
        lokalMeldung.replaceChildren(h('p', { class: 'meldung rot' }, schluessel ? t(schluessel) : fehlerText(r)));
        for (const f of r.d?.felder ?? []) {
          if (!eingaben[f]) continue;
          eingaben[f].setAttribute('aria-invalid', 'true');
          feldFehler[f].textContent = t('recht_admin_fehler_ungueltig');
        }
        if (r.d?.fehler === 'recht_konflikt' || r.d?.fehler === 'recht_url_aktiv') {
          lokalMeldung.append(h('button', { type: 'button', class: 'knopf klein', onclick: () => rechtLaden() }, t('recht_admin_neu_laden')));
        }
      };
      const schreiben = async (knopf, pfad, daten) => {
        lokalMeldung.replaceChildren();
        for (const f of Object.keys(eingaben)) {
          eingaben[f].removeAttribute('aria-invalid');
          feldFehler[f].textContent = '';
        }
        knopf.disabled = true;
        try {
          const r = await apiMitStepup('POST', pfad, daten);
          if (!r.ok) { fehler(r); return; }
          await rechtLaden(true);
        } finally { knopf.disabled = false; }
      };
      if (seite.modus === 'erstellt') {
        const sprache = h('select', { class: 'eingabe' },
          ...['de', 'en', 'hu'].map(l => h('option', { value: l }, { de: 'Deutsch', en: 'English', hu: 'Magyar' }[l])));
        sprache.value = seite.aktiv?.sprache ?? 'hu';
        const inhalt = h('textarea', { class: 'eingabe', maxlength: '20000', rows: '16', lang: sprache.value });
        sprache.addEventListener('change', () => inhalt.setAttribute('lang', sprache.value));
        for (const [f, el] of Object.entries({ sprache, inhalt })) {
          eingaben[f] = el;
          feldFehler[f] = h('span', { id: 'recht-' + seite.seite + '-' + f + '-fehler', class: 'meldung rot klein' });
          el.setAttribute('aria-describedby', feldFehler[f].id);
        }
        const speichern = h('button', { type: 'button', class: 'knopf', onclick: () =>
          schreiben(speichern, weg, { inhalt: inhalt.value, sprache: sprache.value, basis_version: basisVersion })
        }, t('recht_admin_speichern'));
        karte.append(h('p', { class: 'hinweis' }, t('recht_admin_hinweis_muster')),
          h('p', { class: 'hinweis' }, t('recht_admin_hinweis_format')));
        if (basisVersion) {
          speichern.disabled = true;
          inhalt.disabled = true;
          const aktiv = await api('GET', weg + '/' + basisVersion);
          if (aktiv.ok) {
            inhalt.value = aktiv.d.inhalt;
            sprache.value = aktiv.d.sprache;
            inhalt.setAttribute('lang', sprache.value);
            speichern.disabled = false;
            inhalt.disabled = false;
          } else {
            fehler(aktiv);
            lokalMeldung.append(h('button', { type: 'button', class: 'knopf klein', onclick: () => rechtLaden() }, t('recht_admin_neu_laden')));
          }
        }
        karte.append(feld(t('recht_admin_sprache'), sprache), feldFehler.sprache,
          feld(t('recht_admin_text'), inhalt), feldFehler.inhalt, speichern);
      } else {
        karte.append(h('p', { class: 'hinweis' }, t('recht_admin_hinweis_url')));
      }
      karte.append(lokalMeldung);
      const verlauf = h('details', {}, h('summary', {}, t('recht_admin_verlauf')));
      const versionListe = h('ul', {});
      verlauf.append(versionListe);
      const vorschau = h('div', { 'aria-live': 'polite' });
      for (const version of seite.versionen.slice(0, 50)) {
        const ansehen = h('button', { type: 'button', class: 'knopf klein', onclick: async () => {
          ansehen.disabled = true;
          try {
            const r = await api('GET', weg + '/' + version.version);
            if (!r.ok) return fehler(r);
            const pre = h('pre', { lang: r.d.sprache, tabindex: '0', 'aria-label': t('recht_admin_text') });
            pre.textContent = r.d.inhalt;
            vorschau.replaceChildren(h('p', {}, meta(r.d)), pre);
          } finally { ansehen.disabled = false; }
        } }, t('recht_admin_ansehen'));
        const zeile = h('li', {}, h('span', {}, meta(version)), ' ', ansehen);
        if (seite.modus === 'erstellt') {
          let bestaetigt = false;
          const wiederherstellen = h('button', { type: 'button', class: 'knopf klein hell', onclick: () => {
            if (!bestaetigt) {
              bestaetigt = true;
              wiederherstellen.textContent = t('recht_admin_wiederherstellen_ja');
              return;
            }
            return schreiben(wiederherstellen, weg + '/wiederherstellen',
              { version: version.version, basis_version: basisVersion });
          } }, t('recht_admin_wiederherstellen'));
          zeile.append(' ', wiederherstellen);
        }
        versionListe.append(zeile);
      }
      karte.append(verlauf, vorschau);
    }
  };
  // Ende Rechtstexte-Bereich (A4b)

  zeigen(
    kopf(t('marke_titel')),
    h('button', { class: 'knopf klein hell', type: 'button', onclick: uebersicht }, t('a_vissza')),
    h('section', { class: 'karte' }, h('h2', {}, t('marke_name_bezeichnung')), nameForm, d.name_fix ? h('p', { class: 'hinweis' }, t('name_durch_umgebung')) : null),
    h('section', { class: 'karte' }, h('h2', {}, t('marke_logo_bezeichnung')),
      logoVorschau,
      h('p', { class: 'hinweis' }, t('marke_logo_hilfe')),
      h('div', { class: 'zeile' }, logoHochladenKnopf, logoUpload, logoLoeschenKnopf), logoHinweis),
    startseiteSection,
    anbSection,
    rechtBereich,
    farbenSection, gesamtVorschau);
  aktualisiereMuster();
  markeAufraeumen = () => { ++bannerSeq; ++logoSeq; ++seq; ++mailAnfrage; clearTimeout(mailTimer); clearTimeout(debounceTimer); lokaleLogoUrl = null; };
  await autoVorschau();
  await rechtLaden();
}

// ---- Testkauf-Nachweis -------------------------------------------------------------------------
async function testkaufBereich() {
  zeigen(kopf(t('g1b_testkauf_titel')), h('p', {}, t('a_betoltes')));
  const r = await api('GET', '/api/admin/testkauf');
  if (r.status === 401) return anmeldung();
  if (r.status === 403) return keinRecht();
  if (!r.ok) { zeigen(kopf(t('g1b_testkauf_titel')), h('p', { class: 'meldung rot' }, fehlerText(r))); return; }
  const d = r.d;

  const aktualisieren = h('button', { class: 'knopf klein hell', type: 'button', onclick: testkaufBereich }, t('g1b_testkauf_aktualisieren'));

  let statusEl;
  if (d.status === 'bestanden') {
    const eintrag = d.nachweis;
    const info = eintrag
      ? ` – ${budapestZeit(eintrag.erstellt)} · ${formatBetrag(eintrag.betrag, eintrag.waehrung)} · ${eintrag.kurs || ''}`
      : '';
    statusEl = h('p', { class: 'meldung gruen' }, t('g1b_testkauf_bestanden') + info);
  } else if (d.status === 'offen') {
    statusEl = h('p', { class: 'meldung' }, t('g1b_testkauf_offen'));
  } else {
    const grundKey = 'g1b_testkauf_grund_' + (d.grund || '');
    const grundText = t(grundKey) || d.grund || '';
    statusEl = h('p', { class: 'meldung' }, t('g1b_testkauf_nicht_moeglich') + (grundText ? ': ' + grundText : ''));
  }

  zeigen(
    kopf(t('g1b_testkauf_titel')),
    h('section', { class: 'karte' },
      h('p', {}, t('g1b_testkauf_anleitung')),
      statusEl,
      aktualisieren
    )
  );
}

// K1: pure query builder, shared contract with the admin catalogue.
function baueKatalogQuery(zustand = {}) {
  const p = new URLSearchParams();
  const q = [...String(zustand.q || '').trim()].slice(0, 100).join('');
  if (q) p.set('q', q);
  const id = String(zustand.kategorie || '');
  if (/^[1-9]\d{0,15}$/.test(id) && Number.isSafeInteger(Number(id))) p.set('kategorie', id);
  if (['alle','gratis','bezahlt'].includes(zustand.preis)) p.set('preis', zustand.preis);
  if (['neu','preis_auf','preis_ab','name'].includes(zustand.sort)) p.set('sort', zustand.sort);
  const seite = Number(zustand.seite);
  p.set('seite', Number.isInteger(seite) && seite >= 1 && seite <= 10000 ? String(seite) : '1');
  return p.toString();
}
// L1: Nur Darstellung bereits geladener Einträge; kein weiterer Abruf.
const listenAnzeige = new Map();
// muss zu routes-*.mjs LIMIT passen (jeweilige Admin-Endpunkte).
const LISTEN_GRENZEN = Object.freeze({
  pruefzahlungen:200, widerrufe:200, widerrufeErledigt:200,
  adminLogins:100, agentProtokoll:200, verkaufProtokoll:50,
  abgleichVerlauf:30, sicherungProtokoll:100
});

function listeMitMehr(behaelter, eintraege, zeileBauen, optionen = {}) {
  const proSeite = Number.isSafeInteger(optionen.proSeite) && optionen.proSeite > 0 ? optionen.proSeite : 20;
  const zeilen = h(optionen.zeilenTag || 'div', { class:optionen.zeilenTag === 'ol' ? 'liste-zeilen lecken' : 'liste-zeilen' });
  let sichtbar = 0;
  behaelter.replaceChildren();
  if (!eintraege.length) {
    if (optionen.schluessel) listenAnzeige.set(optionen.schluessel, 0);
    behaelter.append(h('p', {}, optionen.leerText ?? t('liste_leer')));
    return behaelter;
  }
  const zaehler = h('p', { class:'klein', role:'status', 'aria-live':'polite' }, t(optionen.serverGrenze > 0 && eintraege.length >= optionen.serverGrenze ? 'liste_gesamt_mindestens' : 'liste_gesamt', { n:eintraege.length }));
  const mehr = h('button', { class:'knopf hell klein liste-mehr', type:'button', onclick:() => anhaengen(proSeite, true) });
  function anhaengen(anzahl, geklickt = false) {
    const ende = Math.min(eintraege.length, sichtbar + anzahl);
    let erste;
    for (; sichtbar < ende; sichtbar++) {
      const zeile = zeileBauen(eintraege[sichtbar], sichtbar);
      if (!erste) erste = zeile;
      zeilen.append(zeile);
    }
    if (optionen.schluessel) listenAnzeige.set(optionen.schluessel, sichtbar);
    optionen.beimAnzeigen?.(sichtbar);
    const rest = eintraege.length - sichtbar;
    mehr.textContent = t('liste_mehr', { n:rest });
    if (!rest) {
      if (geklickt && erste) { erste.setAttribute('tabindex', '-1'); erste.focus(); }
      mehr.remove();
    }
  }
  behaelter.append(zaehler, zeilen, mehr);
  anhaengen(Math.max(proSeite, listenAnzeige.get(optionen.schluessel) ?? optionen.sichtbar ?? 0));
  return behaelter;
}

function katalogFehler(r) { const code = r.d?.fehler; return T[code] || r.d?.text || t('k1_fehler'); }
function katalogAuswahl(titel, werte, wert, aendern) {
  const select = h('select', { onchange: () => aendern(select.value) }, werte.map(([id, name]) => h('option', { value: id }, name)));
  select.value = wert || '';
  return h('label', { class: 'k1-feld' }, h('span', {}, titel), select);
}
function katalogSuchtext(q) {
  const zeichen = [...String(q || '').trim()];
  return zeichen.length > 60 ? zeichen.slice(0,60).join('') + '...' : zeichen.join('');
}
let k1AdminZustand = {};
const s2BeispielIds = new Set();
let s2Aktualisieren = async () => {};
// S2: Statusausfälle bleiben auf diesen optionalen Abschnitt begrenzt.
function s2Uebernehmen(id) {
  bestaetigen('s2_uebernehmen_frage', () => s2Schreiben('POST','/api/admin/beispiele/' + id + '/uebernehmen'));
}
async function s2Schreiben(method, path) {
  const r = await apiMitStepup(method,path,{});
  if (!r.ok) return meldung(T[r.d?.fehler] || r.d?.text || t('a_halozati_hiba'),'rot');
  s2BeispielIds.clear();
  await s2Aktualisieren();
  meldung(t('s2_gespeichert'));
}
function s2AdminBereich(refresh) {
  const box = h('section',{class:'karte s2-admin',hidden:true});
  async function laden(listeAktualisieren = true) {
    s2BeispielIds.clear();
    box.hidden = true;
    try {
      const r = await api('GET','/api/admin/beispiele/status');
      if (!box.isConnected || !r.ok) return;
      if (r.d.anlegbar) box.replaceChildren(h('h2',{},t('s2_titel')),h('p',{},t('s2_admin_text')),
        h('button',{class:'knopf',type:'button',onclick:() => s2Schreiben('POST','/api/admin/beispiele')},t('s2_erstellen')));
      else if (r.d.vorhanden) box.replaceChildren(h('h2',{},t('s2_admin_aktiv')),
        h('button',{class:'knopf hell',type:'button',onclick:() => bestaetigen('s2_entfernen_frage',() => s2Schreiben('DELETE','/api/admin/beispiele'))},t('s2_entfernen')));
      else return;
      box.hidden = false;
      const liste = await api('GET','/api/beispiele');
      if (liste.ok) {
        s2BeispielIds.clear();
        for (const k of liste.d.kurse || []) s2BeispielIds.add(String(k.id));
        if (box.isConnected && listeAktualisieren) await refresh();
      }
    } catch { /* Kursverwaltung bleibt benutzbar. */ }
  }
  s2Aktualisieren = async () => { await laden(false); await refresh(); };
  void laden();
  return box;
}

function k1KategorieName(c) { return c['name_' + (T._sprache || 'de')] || c.name_de; }
function k1AdminKatalog() {
  const liste = h('div', {}), live = h('p', { role:'status', 'aria-live':'polite' }), fehler = h('div', { role:'alert' });
  const suche = h('input', { type:'search', maxlength:'100', value:k1AdminZustand.q || '' });
  let kategorien = [], laeuft = false, kategorienOk = false;
  const katSelect = h('select', { onchange:() => aendern('kategorie',katSelect.value) });
  const vorher = h('button', { class:'knopf hell', onclick:() => laden(Number(k1AdminZustand.seite) - 1) }, t('k1_zurueck'));
  const weiter = h('button', { class:'knopf hell', onclick:() => laden(Number(k1AdminZustand.seite) + 1) }, t('k1_weiter'));
  const seiten = h('span', {});
  const controls = h('form', { class:'k1-werkzeuge', onsubmit:e => { e.preventDefault(); aendern('q',suche.value.trim()); } },
    h('label', { class:'k1-feld' }, t('k1_suche'), suche), h('button', { type:'submit', class:'knopf' }, t('k1_suchen')),
    katalogAuswahl(t('k1_status'), ['alle','entwurf','veroeffentlicht','archiviert','freigabe_offen'].map(v => [v,t('k1_' + v)]), k1AdminZustand.status || 'alle', v => aendern('status',v)),
    h('label', { class:'k1-feld' }, t('k1_kategorie'), katSelect),
    katalogAuswahl(t('k1_preis'), ['alle','gratis','bezahlt'].map(v => [v,t('k1_' + v)]), k1AdminZustand.preis || 'alle', v => aendern('preis',v)),
    katalogAuswahl(t('k1_sort'), ['neu','preis_auf','preis_ab','name'].map(v => [v,t('k1_' + v)]), k1AdminZustand.sort || 'neu', v => aendern('sort',v)),
    h('button', { type:'button', class:'knopf hell', onclick:zuruecksetzen }, t('k1_reset')));
  const box = h('section', { class:'k1-admin-katalog' }, controls, live, fehler, liste, h('div', { class:'k1-seiten' }, vorher, seiten, weiter));
  function zuruecksetzen() {
    k1AdminZustand = {}; suche.value = '';
    for (const el of controls.querySelectorAll('select')) el.selectedIndex = 0;
    void laden(1).then(() => suche.focus());
  }
  function aendern(key,value) { k1AdminZustand[key] = value; void laden(1); }
  async function laden(seite = 1) {
    if (laeuft) return;
    laeuft = true; vorher.disabled = weiter.disabled = true;
    for (const el of controls.querySelectorAll('input,select,button')) el.disabled = true;
    live.textContent = t('k1_laden'); fehler.replaceChildren();
    k1AdminZustand.seite = seite;
    const query = new URLSearchParams(baueKatalogQuery(k1AdminZustand));
    if (['alle','entwurf','veroeffentlicht','archiviert','freigabe_offen'].includes(k1AdminZustand.status)) query.set('status', k1AdminZustand.status);
    const r = await api('GET','/api/admin/kurse?' + query.toString());
    laeuft = false;
    for (const el of controls.querySelectorAll('input,select,button')) el.disabled = false;
    katSelect.disabled = !kategorienOk;
    if (r.status === 401) return anmeldung();
    if (r.status === 403) return keinRecht();
    if (!r.ok) {
      live.textContent = '';
      fehler.replaceChildren(h('p', {}, katalogFehler(r)), h('button', { class:'knopf', onclick:() => laden(seite) }, t('k1_retry'))); return;
    }
    k1AdminZustand.seite = r.d.seite;
    live.textContent = t(r.d.gesamt === 1 ? 'k1_anzahl_1' : 'k1_anzahl', { n:r.d.gesamt });
    seiten.textContent = r.d.gesamt ? t('k1_seiten', { x:r.d.seite, y:r.d.seiten }) : '';
    seiten.parentNode.hidden = r.d.gesamt === 0;
    katSelect.disabled = !kategorienOk;
    vorher.disabled = r.d.seite <= 1; weiter.disabled = r.d.seite >= r.d.seiten;
    liste.replaceChildren(...(r.d.kurse.length ? r.d.kurse.map(k => h('article', { class:'karte kurskarte' },
      h('div', { class:'zeile' }, h('h2', {}, k.titel), statusPlakette(k.status), k.beispiel_key ? h('span',{class:'plakette grau'},t('s2_admin_badge')) : null),
      h('p', { class:'klein' }, (k.preis_cent === 0 ? t('k1_gratis') : preisText(k.preis_cent,k.waehrung)) + ' · ' + t(k.lektionen === 1 ? 'a_lecke_db_1' : 'a_lecke_db', { n: k.lektionen })),
      h('p', {}, kategorien.find(c => c.id === k.kategorie_id) ? k1KategorieName(kategorien.find(c => c.id === k.kategorie_id)) : t('k1_keine_kategorie')),
      h('button', { type:'button', class:'knopf', onclick:() => { meldung(''); kurs(k.id); } }, t('a_megnyitas')),
      s2BeispielIds.has(String(k.id)) ? h('button',{type:'button',class:'knopf hell',onclick:() => s2Uebernehmen(k.id)},t('s2_uebernehmen')) : null)) : [h('p', {}, k1AdminZustand.q ? t('k1_leer_suche', { q:katalogSuchtext(k1AdminZustand.q) }) : t('k1_admin_leer')), h('button', { type:'button', class:'knopf hell', onclick:zuruecksetzen }, t('k1_reset'))]));
  }
  async function start() {
    const r = await api('GET','/api/admin/kategorien');
    if (r.status === 401) return anmeldung();
    if (r.status === 403) return keinRecht();
    kategorienOk = r.ok;
    kategorien = r.ok ? r.d : [];
    katSelect.disabled = !r.ok;
    katSelect.replaceChildren(h('option',{value:''},t('k1_kategorien_alle')), ...kategorien.map(c => h('option',{value:String(c.id)},k1KategorieName(c))));
    katSelect.value = k1AdminZustand.kategorie || '';
    if (!katSelect.value) delete k1AdminZustand.kategorie;
    await laden(k1AdminZustand.seite || 1);
  }
  box.k1Refresh = start;
  void start(); return box;
}
function k1KategorienBereich(nachAenderung = () => {}) {
  let sichtbar = 20;
  const liste = h('div', {}), editor = h('div', {}), nachricht = h('p', { role:'alert', tabindex:'-1' });
  const neu = h('button', { class:'knopf', onclick:() => formular() }, t('k1_kategorie_neu'));
  const box = h('section', { class:'karte k1-kategorien' }, h('h2', {}, t('k1_kategorien')), nachricht, neu, liste, editor);
  function melden(text) { nachricht.textContent = text; nachricht.focus(); }
  async function laden() {
    const r = await api('GET','/api/admin/kategorien');
    if (!r.ok) { melden(katalogFehler(r)); liste.replaceChildren(h('button',{class:'knopf',onclick:laden},t('k1_retry'))); return; }
    listeMitMehr(liste, r.d, c => h('article', { class:'k1-kategorie' }, h('h3', {}, k1KategorieName(c)),
      h('p', {}, t('k1_kategorie_anzahlen', { n:c.anzahl, m:c.anzahl_gesamt }) + ' · ' + t('k1_reihenfolge') + ': ' + c.reihenfolge),
      h('button', { class:'knopf hell', onclick:() => formular(c) }, t('k1_bearbeiten')),
      h('button', { class:'knopf hell', onclick:() => bestaetigen('k1_loeschen_frage', async () => {
        const r = await apiMitStepup('DELETE','/api/admin/kategorien/' + c.id,{});
        if (!r.ok) return melden(katalogFehler(r));
        editor.replaceChildren(); await laden(); nachAenderung(); melden(t('k1_gespeichert'));
      }) }, t('k1_loeschen'))), { schluessel:'kategorien', sichtbar, beimAnzeigen:n => { sichtbar = n; } });
  }
  function formular(c) {
    const namen = {};
    const felder = ['de','en','hu'].map(lang => {
      const input = h('input', { type:'text', required:true, value:c?.['name_' + lang] || '' });
      namen[lang] = input;
      const zaehler = h('span', { class:'klein', 'aria-live':'polite' });
      const zaehlen = () => { zaehler.textContent = [...input.value.normalize('NFC').trim()].length + ' / 80'; };
      input.addEventListener('input',zaehlen); zaehlen();
      return h('label', { class:'k1-feld' }, t('k1_name_' + lang), input, zaehler);
    });
    const reihenfolge = h('input', { type:'number', step:'1', value:String(c?.reihenfolge || 0) });
    const speichern = h('button', { type:'submit', class:'knopf' }, t('a_mentes'));
    const form = h('form', { class:'k1-kategorie-form', onsubmit:async e => {
      e.preventDefault();
      const body = { reihenfolge:Number(reihenfolge.value) };
      for (const lang of ['de','en','hu']) {
        const value = namen[lang].value.normalize('NFC').trim();
        if ([...value].length < 1 || [...value].length > 80 || /[\p{Cc}\p{Cf}]/u.test(value)) return melden(t('kategorie_name_ungueltig'));
        body['name_' + lang] = value;
      }
      if (!Number.isSafeInteger(body.reihenfolge)) return melden(t('reihenfolge_ungueltig'));
      speichern.disabled = true;
      const r = await apiMitStepup(c ? 'PUT' : 'POST','/api/admin/kategorien' + (c ? '/' + c.id : ''),body);
      speichern.disabled = false;
      if (!r.ok) return melden(katalogFehler(r));
      editor.replaceChildren(); await laden(); nachAenderung(); melden(t('k1_gespeichert'));
    } }, felder, h('label', { class:'k1-feld' }, t('k1_reihenfolge'), reihenfolge, h('span', {class:'klein'}, t('k1_reihenfolge_hilfe'))), speichern,
      h('button', { type:'button', class:'knopf hell', onclick:() => { editor.replaceChildren(); neu.focus(); } }, t('a_megse')));
    editor.replaceChildren(form); namen.de.focus();
  }
  void laden(); return box;
}

// E7: Eigene GETs, ohne den Katalogzustand oder dessen Fehleranzeige zu verändern.
function e7NaechsteSchritte() {
  const box = h('section', { class:'karte einr-naechste', 'aria-live':'polite' }, h('p', {}, t('e7_laden')));
  const lesen = async pfad => {
    try { const r = await api('GET', pfad); return r.ok ? r.d : null; }
    catch { return null; }
  };
  void Promise.all([lesen('/api/admin/marke'), lesen('/api/admin/beispiele/status'), lesen('/api/admin/kurse')]).then(([marke, beispiele, daten]) => {
    const markeFertig = marke?.hat_logo === true || (typeof marke?.name === 'string' && marke?.standard === false && marke.name.trim() !== '');
    const kurse = Array.isArray(daten) ? daten : (Array.isArray(daten?.kurse) ? daten.kurse : []);
    const kursFertig = kurse.some(k => (k.beispiel_key == null || k.beispiel_key === '') && k.status === 'veroeffentlicht');
    if (markeFertig && kursFertig) { box.remove(); return; }
    const aktion = (key, fertig, onclick) => h('li', {}, fertig
      ? h('span', {}, t(key), ' · ', h('span', { 'aria-hidden':'true' }, '✓'), ' ', t('e7_erledigt'))
      : h('button', { class:'knopf hell', type:'button', onclick }, t(key)));
    const liste = h('ul', {}, aktion('e7_marke', markeFertig, markeBereich));
    if (beispiele?.vorhanden === true) liste.append(h('li', {}, h('a', { class:'knopf hell', href:'/', target:'_blank', rel:'noopener noreferrer' }, t('e7_beispiel'))));
    else if (beispiele?.anlegbar === true) liste.append(h('li', {}, h('p', { class:'klein' }, t('e7_optional'))));
    liste.append(aktion('e7_kurs', kursFertig, neuerKurs));
    box.replaceChildren(h('h2', {}, t('e7_titel')), h('p', {}, t('e7_intro')), liste);
  }).catch(() => box.remove());
  return box;
}

// ---- Liste der Kurse ----------------------------------------------------------------------------
async function uebersicht() {
  zeigen(kopf(t('a_kurzusaim')), h('p', {}, t('a_betoltes')));
  const verkaufKnopf=h('button',{class:'knopf gross rot',type:'button',onclick:verkaufBereich},t('verkauf_titel'));
  const neuKnopf = h('button', { class: 'knopf gross', type: 'button', onclick: neuerKurs }, t('a_uj_kurzus'));
  const paketKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:kurspaketImport},t('paket_titel'));
  // Zahlungen, die bezahlt sind, aber nicht zum Kurs passen: kein Zugang vergeben, Gabriella soll prüfen
  const pruefenListe = h('div', {}, h('p', {}, t('a_betoltes')));
  const pruefenDoboz = h('section', { class: 'karte' }, h('h2', {}, t('a_pruefen_cim')), h('p', { class: 'klein' }, t('a_pruefen_magyarazat')), pruefenListe);
  const agentKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:agentBereich},t('agent_titel'));
  const sicherungKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:sicherungBereich},t('sicherung_titel'));
  const abgleichKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:abgleichBereich},t('abgleich_titel'));
  const loginsKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:adminLogins},t('admin_logins_titel'));
  const markeKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:markeBereich},t('marke_titel'));
  const testkaufKnopf=h('button',{class:'knopf klein hell',type:'button',onclick:testkaufBereich},t('g1b_testkauf_titel'));
  // Schritt 8 (VIDEO-11): Lage der Videoablage (nur wenn Bunny an): offene/gescheiterte Loeschauftraege und ein Abgleich-Knopf (nur lesend).
  const bunnyDoboz = h('section', { class: 'karte versteckt' }, h('h2', {}, t('a_bunny_box_cim')));
  const kpiBox = h('section', { class: 'kpi-reihe' });
  void kennzahlenLaden(kpiBox);
  const hauptReihe=h('div',{class:'admin-haupt'},neuKnopf,verkaufKnopf);
  const werkzeugReihe=h('nav',{class:'admin-werkzeuge','aria-label':t('a_werkzeuge')},h('span',{class:'klein'},t('a_werkzeuge')),paketKnopf,abgleichKnopf,sicherungKnopf,agentKnopf,loginsKnopf,markeKnopf,testkaufKnopf);
  // Block 4: offene Widerrufe (Erstattung laeuft oder fehlgeschlagen) zaehlen in 'Offene Pruefungen' mit und stehen hier lesend in einer Liste.
  const widerrufListe = h('div', {}, h('p', {}, t('a_betoltes')));
  const widerrufDoboz = h('section', { class: 'karte' }, h('h2', {}, t('a_widerruf_cim')), h('p', { class: 'klein' }, t('a_widerruf_magyarazat')), widerrufListe);
  // Backlog a: von Hand ohne Erstattung abgeschlossene Widerrufe, eingeklappt unter der offenen Liste (eigene Ansicht, nie als Erstattung dargestellt).
  const erledigtListe = h('div', {}, h('p', {}, t('a_betoltes')));
  const erledigtDoboz = h('details', { class: 'karte widerruf-erledigt' }, h('summary', {}, t('a_widerruf_erledigte_cim')), h('p', { class: 'klein' }, t('a_widerruf_erledigte_magyarazat')), erledigtListe);
  const katalog = k1AdminKatalog();
  zeigen(kopf(t('a_kurzusaim')), e7NaechsteSchritte(), kpiBox, hauptReihe, s2AdminBereich(() => katalog.k1Refresh()), katalog, k1KategorienBereich(() => void katalog.k1Refresh()), bunnyDoboz, pruefenDoboz, widerrufDoboz, erledigtDoboz, ereignisseBereich(), werkzeugReihe);
  void bunnyLage(bunnyDoboz);
  void widerrufeLaden(widerrufListe);
  void widerrufeErledigtLaden(erledigtListe);
  const b = await api('GET', '/api/admin/bestellungen?status=pruefen');
  if (!b.ok) return pruefenListe.replaceChildren(h('p', { class: 'meldung rot' }, fehlerText(b)));
  listeMitMehr(pruefenListe, b.d, (x) => h('article', { class: 'lecke' },
    h('div', { class: 'lecke-szoveg' },
      h('strong', {}, x.kurs_titel ?? t('a_ismeretlen')),
      h('span', { class: 'klein' }, (x.benutzer_email ?? t('a_ismeretlen')) + ' · ' + formatBetrag(x.betrag, x.waehrung) + ' · ' + budapestZeit(x.erstellt)),
      h('span', { class: 'klein' }, t(GRUND_TEXTE[x.grund] || 'a_ismeretlen'))),
    h('div', { class: 'lecke-gombok' },
      ...[['freigeben','a_pruefen_jovahagyom','a_pruefen_jovahagyom_frage'], ['ablehnen','a_pruefen_elutasitom','a_pruefen_elutasitom_frage']].map(([weg, titel, frage]) =>
        h('button', { class: 'knopf klein hell', type: 'button', onclick: () => bestaetigen(frage, async () => {
          const r = await api('POST', '/api/admin/bestellungen/' + x.id + '/' + weg, {});
          if (!r.ok) return meldung(fehlerText(r), 'rot');
          await uebersicht(); meldung(t('a_pruefen_erledigt'));
        }) }, t(titel))))), { leerText:t('a_nincs_pruefen'), schluessel:'pruefzahlungen', serverGrenze:LISTEN_GRENZEN.pruefzahlungen });
}

// Block 4: Liste der offenen Widerrufe (nur lesend). Im Demo-Modus sperrt der Server sie fuer den Demo-Admin (personenbezogene Daten): neutraler Hinweis statt Fehler.
// Refund-Failed (12.11.2026): Zeilen mit ergebnis 'stripe_refund_failed' = Stripe hat eine Erstattung nachtraeglich als fehlgeschlagen gemeldet. Kein Abschluss-Knopf
// (der gilt nur fuer Widerrufe mit ellallas 'fehler'), stattdessen Hinweis und die Stripe-Erstattungs-ID als Text.
const WIDERRUF_STATUS = Object.freeze({ bearbeitung: 'ellallas_inhaber_bearbeitung', fehler: 'ellallas_inhaber_fehler', stripe_refund_failed: 'a_erstattung_stripe_fehler' });
async function widerrufeLaden(liste) {
  const r = await api('GET', '/api/admin/widerrufe');
  if (r.status === 403 && r.d?.fehler === 'demo_nur_ansicht') return liste.replaceChildren(h('p', { class: 'klein' }, t('a_widerruf_demo')));
  if (!r.ok) return liste.replaceChildren(h('p', { class: 'meldung rot' }, fehlerText(r)));
  listeMitMehr(liste, r.d, (x) => h('article', { class: 'lecke' },
    h('div', { class: 'lecke-szoveg' },
      h('strong', {}, x.kurs_titel ?? t('a_ismeretlen')),
      h('span', { class: 'klein' }, (x.benutzer_email ?? t('a_ismeretlen')) + ' · ' + t('mail_kauf_nummer') + ': ' + x.bestellung_id + ' · ' +
        (x.betrag == null ? '–' : formatBetrag(x.betrag, x.waehrung || 'huf')) + ' · ' + budapestZeit(x.zeit)),
      h('span', { class: 'klein' }, t(WIDERRUF_STATUS[x.ergebnis] || 'a_ismeretlen')),
      x.ergebnis === 'fehler' ? widerrufErledigenFormular(x)
        : x.ergebnis === 'stripe_refund_failed' ? h('span', { class: 'klein erstattung-stripe-hinweis' }, t('a_erstattung_stripe_referenz') + ': ' + (x.refund_id ?? '–') + ' · ' + t('a_erstattung_stripe_hinweis'))
        : h('span', { class: 'klein' }, t('a_widerruf_laeuft_hinweis')))), { leerText:t('a_nincs_widerruf'), schluessel:'widerrufe', serverGrenze:LISTEN_GRENZEN.widerrufe });
}
// Backlog a: "Ohne Erstattung abschliessen" nur bei fehlgeschlagener Erstattung. Pflicht-Begruendung (5 bis 500 Zeichen, der Server prueft erneut),
// Bestaetigungsfrage, danach neu laden. Kein Stripe-Aufruf, keine Erstattung: der Text sagt das ausdruecklich. Begruendung wird nur als Text eingesetzt.
let widerrufFormNr = 0;
function widerrufErledigenFormular(x) {
  const nr = ++widerrufFormNr;
  const hinweisId = 'widerruf-hinweis-' + nr, fehlerId = 'widerruf-fehler-' + nr, formId = 'widerruf-form-' + nr;
  const feldText = h('textarea', { name: 'begruendung', rows: '3', required: true, minlength: '5', maxlength: '500', 'aria-describedby': hinweisId + ' ' + fehlerId });
  // Backlog c (12.11.2026): Pflicht-Fallreferenz (3 bis 100 Zeichen, eine Zeile) und Pflicht-Checkbox "Erstattungsstatus in Stripe geprueft"; der Server prueft beides erneut.
  const feldRef = h('input', { type: 'text', name: 'fallreferenz', required: true, minlength: '3', maxlength: '100', autocomplete: 'off', 'aria-describedby': fehlerId });
  const feldGeprueft = h('input', { type: 'checkbox', name: 'stripe_geprueft', required: true, 'aria-describedby': fehlerId });
  const fehlerZeile = h('p', { class: 'klein', id: fehlerId, role: 'alert' });
  const schliessen = () => { form.hidden = true; oeffnen.setAttribute('aria-expanded', 'false'); oeffnen.focus({ preventScroll: true }); };
  const form = h('form', { class: 'widerruf-erledigen', id: formId, hidden: true, novalidate: true, onsubmit: (ev) => {
    ev.preventDefault();
    const begruendung = feldText.value.trim();
    const laenge = [...begruendung].length;
    if (laenge < 5 || laenge > 500) {
      feldText.setAttribute('aria-invalid', 'true'); fehlerZeile.textContent = t('a_widerruf_begruendung_laenge');
      return feldText.focus({ preventScroll: true });
    }
    feldText.removeAttribute('aria-invalid'); fehlerZeile.textContent = '';
    const fallreferenz = feldRef.value.trim();
    const refLaenge = [...fallreferenz].length;
    if (refLaenge < 3 || refLaenge > 100 || /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(fallreferenz)) {
      feldRef.setAttribute('aria-invalid', 'true'); fehlerZeile.textContent = t('a_widerruf_fallreferenz_laenge');
      return feldRef.focus({ preventScroll: true });
    }
    feldRef.removeAttribute('aria-invalid');
    if (!feldGeprueft.checked) {
      feldGeprueft.setAttribute('aria-invalid', 'true'); fehlerZeile.textContent = t('a_widerruf_stripe_geprueft_pflicht');
      return feldGeprueft.focus({ preventScroll: true });
    }
    feldGeprueft.removeAttribute('aria-invalid');
    bestaetigen('a_widerruf_erledigen_frage', async () => {
      const a = await apiMitStepup('POST', '/api/admin/widerrufe/' + x.bestellung_id + '/erledigt', { begruendung, fallreferenz, stripe_geprueft: feldGeprueft.checked === true });
      if (!a.ok) return meldung(fehlerText(a), 'rot');
      await uebersicht(); meldung(t('a_widerruf_erledigt_ok'));
    });
  } },
    feld(t('a_widerruf_begruendung'), feldText, null),
    h('p', { class: 'hinweis klein', id: hinweisId }, t('a_widerruf_begruendung_hinweis')),
    feld(t('a_widerruf_fallreferenz'), feldRef, null),
    h('label', { class: 'feld widerruf-geprueft' }, feldGeprueft, h('span', {}, t('a_widerruf_stripe_geprueft'))),
    fehlerZeile,
    h('div', { class: 'zeile' },
      h('button', { class: 'knopf klein', type: 'submit' }, t('a_widerruf_erledigen')),
      h('button', { class: 'knopf klein hell', type: 'button', onclick: schliessen }, t('a_megse'))));
  const oeffnen = h('button', { class: 'knopf klein hell', type: 'button', 'aria-expanded': 'false', 'aria-controls': formId, onclick: () => {
    const auf = form.hidden;
    form.hidden = !auf; oeffnen.setAttribute('aria-expanded', String(auf));
    if (auf) feldText.focus({ preventScroll: true });
  } }, t('a_widerruf_erledigen'));
  return h('div', { class: 'widerruf-aktion' }, oeffnen, form);
}
// Backlog a: abgeschlossene Widerrufe (eigene Ansicht). Getrennte Angaben: Stripe-Erstattung "nicht erfolgt" (unveraendert) und Erledigung von Hand
// mit Zeitpunkt, Bearbeiter und Begruendung. Nie als Erstattung dargestellt. Demo: Server sperrt (personenbezogene Daten), neutraler Hinweis.
async function widerrufeErledigtLaden(liste) {
  const r = await api('GET', '/api/admin/widerrufe/erledigt');
  if (r.status === 403 && r.d?.fehler === 'demo_nur_ansicht') return liste.replaceChildren(h('p', { class: 'klein' }, t('a_widerruf_demo')));
  if (!r.ok) return liste.replaceChildren(h('p', { class: 'meldung rot' }, fehlerText(r)));
  listeMitMehr(liste, r.d, (x) => h('article', { class: 'lecke' },
    h('div', { class: 'lecke-szoveg' },
      h('div', { class: 'zeile' }, h('strong', {}, x.kurs_titel ?? t('a_ismeretlen')), h('span', { class: 'plakette grau' }, t('a_widerruf_erledigt_label'))),
      h('span', { class: 'klein' }, (x.benutzer_email ?? t('a_ismeretlen')) + ' · ' + t('mail_kauf_nummer') + ': ' + x.bestellung_id + ' · ' +
        (x.betrag == null ? '–' : formatBetrag(x.betrag, x.waehrung || 'huf')) + ' · ' + budapestZeit(x.zeit)),
      h('span', { class: 'klein' }, t('a_widerruf_stripe_status') + ': ' + (x.ergebnis === 'fehler' ? t('a_widerruf_stripe_fehler') : t('a_ismeretlen'))),
      h('span', { class: 'klein' }, t('a_widerruf_erledigt_am') + ': ' + budapestZeit(x.erledigt_zeit) + ' · ' + t('a_widerruf_bearbeiter') + ': ' + (x.erledigt_admin_email ?? t('a_ismeretlen'))),
      h('span', { class: 'klein widerruf-fallreferenz' }, t('a_widerruf_fallreferenz_kurz') + ': ' + (x.erledigt_fallreferenz ?? '–')),
      h('span', { class: 'klein widerruf-begruendung' }, t('a_widerruf_begruendung_kurz') + ': ' + (x.erledigt_begruendung ?? '')))), { leerText:t('a_nincs_widerruf_erledigt'), schluessel:'widerrufeErledigt', serverGrenze:LISTEN_GRENZEN.widerrufeErledigt });
}
// Management-Kennzahlen oben auf der Uebersicht (Umsatz, Bestellungen, aktive Teilnehmer, Erstattungen, offene Pruefungen, Kurse).
async function kennzahlenLaden(box) {
  const r = await api('GET', '/api/admin/kennzahlen');
  if (!r.ok) return;
  const umsatz = (r.d.umsatz || []).map((u) => formatBetrag(u.cent, u.waehrung)).join(' · ') || formatBetrag(0, 'eur');
  const zelle = (titel, wert, warn, hilfe) => h('div', { class: 'kpi' + (warn ? ' kpi-warn' : '') }, h('span', { class: 'kpi-wert' }, wert), h('span', { class: 'kpi-titel' }, titel), hilfe ? h('span', { class: 'kpi-hilfe' }, hilfe) : null);
  box.append(zelle(t(r.d.modus === 'live' ? 'a_kpi_umsatz' : 'a_kpi_umsatz_test'), umsatz, false, t('a_kpi_umsatz_hilfe')), zelle(t('a_kpi_bestellungen'), String(r.d.bestellungen)), zelle(t('a_kpi_teilnehmer'), String(r.d.teilnehmer)),
    zelle(t('a_kpi_erstattungen'), String(r.d.erstattungen)), zelle(t('a_kpi_offen'), String(r.d.offen), r.d.offen > 0), zelle(t('a_kpi_kurse'), String(r.d.kurse)));
}
// Schritt 8 (VIDEO-11): Videoablage-Doboz auf der Uebersicht. Erscheint nur, wenn Bunny an ist. Zeigt offene und mehrfach gescheiterte Loeschauftraege
// und bietet den Abgleich Bibliothek gegen Datenbank an (nur lesend; es wird nie etwas geloescht).
async function bunnyLage(doboz) {
  const r = await api('GET', '/api/admin/bunny');
  if (!r.ok || !r.d.an) return;
  const lage = r.d.loeschauftraege || { offen: 0, fehlgeschlagen: 0 };
  const ergebnis = h('p', { class: 'klein', role: 'status' });
  const knopf = h('button', { class: 'knopf klein hell', type: 'button', onclick: async () => {
    knopf.disabled = true; ergebnis.textContent = t('a_bunny_abgleich_folyamat');
    const a = await api('GET', '/api/admin/bunny/abgleich');
    knopf.disabled = false;
    if (!a.ok) { ergebnis.textContent = ''; return meldung(fehlerText(a), 'rot'); }
    const werte = { bunny: a.d.bei_bunny, gelesen: a.d.gelesen, verwaist: a.d.verwaist.length, fehlend: a.d.fehlend.length };
    ergebnis.textContent = (werte.verwaist || werte.fehlend) ? t('a_bunny_abgleich_elteres', werte) : t('a_bunny_abgleich_ok', werte);
    if (a.d.unvollstaendig) ergebnis.textContent += ' ' + t('a_bunny_abgleich_unvollstaendig', werte);   // nicht alles gelesen: "fehlend" ist dann nicht beurteilt
  } }, t('a_bunny_abgleich_knopf'));
  // F-313: anders als h() (das null-Kinder gezielt ueberspringt) stringifiziert Element.append() ein
  // rohes null-Argument zum buchstaeblichen Text "null" -- darum hier vor dem Aufruf herausfiltern.
  doboz.append(...[
    h('p', { class: lage.offen ? '' : 'klein' }, lage.offen ? t('a_bunny_box_offen', { n: lage.offen }) : t('a_bunny_box_rendben')),
    lage.fehlgeschlagen ? h('p', { class: 'meldung rot' }, t('a_bunny_box_fehler', { n: lage.fehlgeschlagen })) : null,
    knopf, ergebnis,
  ].filter(Boolean));
  doboz.classList.remove('versteckt');
}

// ---- Kursdaten: neu anlegen oder ändern ---------------------------------------------------------------
// Preis (Block 4): HUF als ganze Forint, EUR mit hoechstens zwei Nachkommastellen; die API bekommt preis_cent (ganze Zahl, kleinste Einheit).
function kursUrlap(vorhanden, nachSpeichern) {
  const kategorie = h('select', { disabled:true }, h('option', { value:'' }, t('k1_keine_kategorie')));
  const kategorieFehler = h('p', { role:'alert' });
  async function kategorienLaden() {
    const r = await api('GET','/api/admin/kategorien');
    if (!r.ok) { kategorieFehler.replaceChildren(h('span',{},t('k1_kategorien_fehler')),h('button',{type:'button',class:'knopf',onclick:kategorienLaden},t('k1_retry'))); return; }
    kategorieFehler.replaceChildren();
    kategorie.replaceChildren(h('option',{value:''},t('k1_keine_kategorie')), ...r.d.map(c => h('option',{value:String(c.id)},k1KategorieName(c))));
    kategorie.value = vorhanden?.kategorie_id ? String(vorhanden.kategorie_id) : ''; kategorie.disabled = false;
  }
  void kategorienLaden();
  const titel = h('input', { type: 'text', maxlength: '200', value: vorhanden?.titel ?? '' });
  const leiras = h('textarea', { rows: '4', maxlength: '5000' });
  leiras.value = vorhanden?.beschreibung ?? '';
  const startWaehrung = vorhanden?.waehrung || 'huf';
  const ar = h('input', { type: 'text', inputmode: dezimalstellen(startWaehrung) ? 'decimal' : 'numeric', placeholder: preisBeispiel(startWaehrung),
    value: vorhanden ? centZuEingabe(vorhanden.preis_cent, startWaehrung) : '' });
  const aboPreis = h('input', { type:'text', inputmode: dezimalstellen(startWaehrung) ? 'decimal' : 'numeric',
    value: vorhanden?.abo_preis_cent != null ? centZuEingabe(vorhanden.abo_preis_cent, startWaehrung) : '' });
  const waehrungSel = h('select', {}, [h('option', { value: 'huf' }, 'HUF (Ft)'), h('option', { value: 'eur' }, 'EUR (€)')]);
  waehrungSel.value = startWaehrung;
  waehrungSel.disabled = !!vorhanden;   // Die Waehrung eines bestehenden Kurses aendert sich nicht
  const aboIntervall = h('select', {}, [
    h('option', { value: 'month' }, t('a_abo_monat')),
    h('option', { value: 'year' }, t('a_abo_jahr')),
  ]);
  aboIntervall.value = vorhanden?.abo_intervall || 'month';
  const seged = (w) => t('k1_null_gratis') + ' · ' + (w === 'huf' ? t('a_ar_seged', { beispiel: preisBeispiel(w) }) : t('a_ar_seged_dezimal', { beispiel: preisBeispiel(w) }));
  const arFeld = feld(t('a_ar', { w: startWaehrung.toUpperCase() }), ar, seged(startWaehrung));
  const aboArFeld = feld(t('a_abo_ar', { w: startWaehrung.toUpperCase() }), aboPreis);
  waehrungSel.addEventListener('change', () => {
    const w = waehrungSel.value;
    arFeld.firstChild.textContent = t('a_ar', { w: w.toUpperCase() }); aboArFeld.firstChild.textContent = t('a_abo_ar', { w: w.toUpperCase() });
    arFeld.lastChild.textContent = seged(w); ar.placeholder = preisBeispiel(w);
    ar.inputMode = aboPreis.inputMode = dezimalstellen(w) ? 'decimal' : 'numeric';
  });
  const knopf = h('button', { class: 'knopf', type: 'submit' }, t('a_mentes'));
  return h('form', { class: 'karte', onsubmit: async (e) => {
    e.preventDefault();
    if (!titel.value.trim()) return meldung(t('a_cim_kell'), 'rot');
    const w = vorhanden ? startWaehrung : waehrungSel.value;
    const cent = preisZuCent(ar.value, w);
    if (cent === null) return meldung(w === 'huf' ? t('a_ar_hibas') : t('a_ar_hibas_dezimal', { beispiel: preisBeispiel(w) }), 'rot');
    const aboCent = aboPreis.value.trim() ? preisZuCent(aboPreis.value, w) : null;
    const aboFehler = w === 'huf' ? t('a_abo_ar_hibas') : t('a_abo_ar_hibas_dezimal');
    if (aboCent !== null && aboCent <= 0) return meldung(aboFehler, 'rot');
    if (aboPreis.value.trim() && aboCent === null) return meldung(aboFehler, 'rot');
    knopf.disabled = true;   // erst NACH allen Pruefungen sperren, sonst bleibt der Knopf nach einem Eingabefehler tot
    const csomag = { titel: titel.value, beschreibung: leiras.value, preis_cent: cent, ...(kategorie.disabled ? {} : {kategorie_id:kategorie.value ? Number(kategorie.value) : null}),
      abo_preis_cent: aboCent, abo_intervall: aboCent === null ? null : aboIntervall.value };
    const r = vorhanden
      ? await api('PATCH', '/api/admin/kurse/' + vorhanden.id, csomag)
      : await api('POST', '/api/admin/kurse', { ...csomag, waehrung: waehrungSel.value });
    knopf.disabled = false;
    if (!r.ok) return meldung(katalogFehler(r), 'rot');
    return nachSpeichern(r.d);
  } }, feld(t('a_cim'), titel), feld(t('a_leiras'), leiras), feld(t('k1_kategorie'), kategorie), kategorieFehler, feld(t('a_waehrung'), waehrungSel), arFeld, aboArFeld, feld(t('a_abo_intervall'), aboIntervall), knopf);
}

function neuerKurs() {
  meldung('');
  const urlap = kursUrlap(null, async (uj) => { await kurs(uj.id); meldung(t('a_kurzus_letrehozva')); });
  zeigen(kopf(t('a_uj_kurzus')), h('button', { class: 'knopf klein hell', type: 'button', onclick: uebersicht }, t('a_vissza')), urlap);
}

// ---- Video zu Bunny Stream hochladen (docs/BUNNY-STREAM-PLAN.md Schritt 6) -------------------------------------------------------------------
// Ablauf laut Bunny-Doku (stream/tus-resumable-uploads): 1) der Server legt das Video an und signiert (der API-Schluessel bleibt dort), 2) der Browser
// laedt mit tus-js-client DIREKT zu Bunny hoch (Kopfzeilen AuthorizationSignature, AuthorizationExpire, VideoId, LibraryId; Metadaten filetype und title),
// 3) der Server uebernimmt das Video in die Lektion, sobald Bunny "fertig" meldet. Die Bibliothek liegt lokal (/vendor/tus) und wird erst bei Bedarf nachgeladen.
const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
let tusLadevorgang = null;
function tusLaden() {
  if (window.tus) return Promise.resolve(window.tus);
  if (!tusLadevorgang) {
    tusLadevorgang = new Promise((fertig, nein) => {
      const s = document.createElement('script');
      s.src = '/vendor/tus/tus.min.js';
      s.onload = () => (window.tus ? fertig(window.tus) : nein(new Error('tus')));
      s.onerror = () => { tusLadevorgang = null; nein(new Error('tus')); };
      document.head.append(s);
    });
  }
  return tusLadevorgang;
}
const BUNNY_STATUS_TEXTE = Object.freeze({
  erstellt: 'a_bunny_st_erstellt', hochgeladen: 'a_bunny_st_hochgeladen', verarbeitet: 'a_bunny_st_verarbeitet', umgerechnet: 'a_bunny_st_umgerechnet',
  fertig: 'a_bunny_st_fertig', fehler: 'a_bunny_st_fehler', upload_fehler: 'a_bunny_st_upload_fehler', unbekannt: 'a_bunny_st_unbekannt',
});
const bunnyStatusText = (status) => t(BUNNY_STATUS_TEXTE[status] ?? BUNNY_STATUS_TEXTE.unbekannt);
// Wirft einen Error mit ungarischem Text bei Fehlern. Gibt 'fertig' zurueck, wenn das Video schon in der Lektion ist, sonst 'feldolgozas' (der Server uebernimmt es spaeter selbst).
// ui: { fortschritt, status, folytatas (Knopf zum Fortsetzen), nochDa (Seite noch da?), nachUpload (Upload zu Ende: Verlassen-Warnung aufheben) }
async function bunnyHochladen(lecke, datei, ui) {
  const { fortschritt, status } = ui;
  if (datei.type && !datei.type.startsWith('video/')) throw new Error(t('a_bunny_nur_video_fajl'));   // gar nicht erst ein Video bei Bunny anlegen
  // Schritt 8 (VIDEO-10): Groesse und Typ gehen mit; der Server prueft beides gegen seine Grenze, bevor bei Bunny ein Video entsteht.
  const a = await api('POST', '/api/admin/lektionen/' + lecke.id + '/bunny-upload', { groesse: datei.size, mime: datei.type || '' });
  if (!a.ok) throw new Error(fehlerText(a));
  let tus;
  try { tus = await tusLaden(); } catch (e) { throw new Error(t('a_halozati_hiba')); }
  await new Promise((fertig, nein) => {
    const feltoltes = new tus.Upload(datei, {
      endpoint: a.d.upload.url,
      retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
      headers: a.d.upload.kopfzeilen,
      metadata: { filetype: datei.type || 'video/mp4', title: lecke.titel },
      storeFingerprintForResuming: false,                        // nichts im Browser-Speicher ablegen (die Upload-Adresse gehoert zu genau diesem einen Video)
      onProgress: (feltoltve, osszes) => {
        const n = osszes ? Math.floor((feltoltve / osszes) * 100) : 0;
        fortschritt.value = n;
        status.textContent = t('a_bunny_folyamat') + ' ' + t('a_szazalek', { n });
      },
      onError: (hiba) => {
        const kod = hiba?.originalResponse?.getStatus?.();
        if (kod === 401 || kod === 404) return nein(new Error(t('a_bunny_lejart')));       // Berechtigung abgelaufen oder Upload weg: Wiederholen hilft nicht (Bunny-Doku)
        // Netz weg o. ae.: der Upload bleibt erhalten; ein Klick setzt ihn dort fort, wo er stehen geblieben ist (tus fragt den Stand bei Bunny ab).
        status.textContent = t('a_bunny_megszakadt');
        ui.folytatas.hidden = false;
      },
      onSuccess: () => fertig(),
    });
    ui.folytatas.onclick = () => { ui.folytatas.hidden = true; status.textContent = t('a_bunny_folyamat'); feltoltes.start(); };
    feltoltes.start();
  });
  ui.nachUpload();
  fortschritt.hidden = true;
  status.textContent = t('a_bunny_feldolgozas');
  for (let i = 0; i < 180 && ui.nochDa(); i++) {                // bis zu 15 Minuten nachfragen; danach uebernimmt der Server es selbst (alle 10 Minuten)
    await warten(5000);
    const s = await api('GET', '/api/admin/lektionen/' + lecke.id + '/bunny-status');
    if (!s.ok) {
      if (s.status === 401 || s.status === 403 || s.status === 404) throw new Error(fehlerText(s));   // Anmeldung weg oder Lektion/Video gibt es nicht mehr: nicht still weiterfragen
      continue;                                                  // kurzer Serverfehler: naechste Runde
    }
    if (s.d.uebernommen) return 'fertig';
    if (s.d.status === 'fehler' || s.d.status === 'upload_fehler') throw new Error(t('a_bunny_feldolgozas_hiba'));
    status.textContent = t('a_bunny_feldolgozas') + ' (' + t('a_bunny_allapot') + ': ' + bunnyStatusText(s.d.status) + ')';
  }
  return 'feldolgozas';
}

// ---- Datei hochladen: der Browser schickt den rohen Dateiinhalt per PUT (mit Fortschritt). Dateiname und Typ gehen als Kopfzeilen mit. ----
function dateiSenden(lecke, datei, fortschritt, prozent) {
  return new Promise((fertig) => {
    const x = new XMLHttpRequest();
    x.open('PUT', '/api/admin/lektionen/' + lecke.id + '/datei');
    x.setRequestHeader('Content-Type', datei.type || 'application/octet-stream');
    x.setRequestHeader('X-Dateiname', encodeURIComponent(datei.name));
    x.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const n = Math.floor((e.loaded / e.total) * 100);
      fortschritt.value = n;
      prozent.textContent = t('a_szazalek', { n });
    };
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch (e) { /* leere Antwort */ }
      fertig({ ok: x.status >= 200 && x.status < 300, status: x.status, d });
    };
    x.onerror = () => fertig({ ok: false, status: 0, d: { text: t('a_halozati_hiba') } });
    x.send(datei);
  });
}

// ---- Ein Kurs mit Lektionen -------------------------------------------------------------------------
async function kurs(id) {
  const r = await api('GET', '/api/kurse/' + id);
  if (r.status === 401) return anmeldung();
  if (!r.ok) { meldung(fehlerText(r), 'rot'); return uebersicht(); }
  const k = r.d;
  const lecken = k.lektionen; // schon nach Reihenfolge sortiert, Admin sieht auch ausgeblendete

  const ujraTolt = async (uzenet) => { await kurs(id); if (uzenet) meldung(uzenet); };

  // Größe und erlaubte Endungen vom Server (er prüft beim Hochladen trotzdem selbst)
  const grenze = lecken.some((l) => l.art !== 'text') ? await api('GET', '/api/admin/upload-grenze') : null;
  const maxBytes = grenze?.ok ? grenze.d.max_bytes : 0;
  const endungen = grenze?.ok ? grenze.d.endungen : {};
  // Ist die Videoablage bei Bunny eingerichtet? (nur dann erscheint der Bunny-Upload fuer Videolektionen)
  const bunnyInfo = lecken.some((l) => l.art === 'video') ? await api('GET', '/api/admin/bunny') : null;
  const bunnyAn = !!(bunnyInfo?.ok && bunnyInfo.d.an);
  const bunnyMaxBytes = bunnyAn && Number.isFinite(bunnyInfo.d.max_bytes) ? bunnyInfo.d.max_bytes : 0;   // Schritt 8: Groessengrenze vom Server

  // Bunny-Teil einer Videolektion: Upload direkt zu Bunny, Status der Verarbeitung, Hinweis auf ein noch ausstehendes neues Video.
  function bunnyBlock(l, jetzt) {
    const eingabe = h('input', { type: 'file', class: 'versteckt', accept: 'video/*' });
    const fortschritt = h('progress', { max: '100', value: '0', hidden: true });
    const status = h('span', { class: 'klein', role: 'status' });
    const folytatas = h('button', { class: 'knopf klein hell', type: 'button', hidden: true }, t('a_bunny_folytatas'));     // erscheint nur nach einem Netzabbruch
    const hochladen = async (datei) => {
      eingabe.disabled = true; fortschritt.value = 0; fortschritt.hidden = false; status.textContent = t('a_bunny_folyamat');
      const sperre = (e) => { e.preventDefault(); e.returnValue = ''; };      // Browser warnt, wenn man waehrend des Uploads die Seite verlaesst
      window.addEventListener('beforeunload', sperre);
      try {
        const ergebnis = await bunnyHochladen(l, datei, { fortschritt, status, folytatas, nochDa: () => document.body.contains(eingabe), nachUpload: () => window.removeEventListener('beforeunload', sperre) });   // nach dem Upload darf man die Seite verlassen
        if (ergebnis === 'fertig') return ujraTolt(t('a_bunny_kesz'));
        eingabe.disabled = false;
      } catch (e) {
        eingabe.disabled = false; fortschritt.hidden = true; folytatas.hidden = true; status.textContent = '';
        meldung(e.message || t('a_bunny_feltoltes_hiba'), 'rot');
      } finally { window.removeEventListener('beforeunload', sperre); }
    };
    eingabe.addEventListener('change', () => {
      const datei = eingabe.files[0];
      eingabe.value = '';                                   // dieselbe Datei muss nach Abbruch, Nachfrage oder Fehler erneut waehlbar sein (change feuert nur bei Aenderung)
      if (!datei) return;
      // Schritt 8 (VIDEO-10): zu grosse Datei sofort ablehnen (bevor bei Bunny ein Video entsteht); die Grenze kommt vom Server.
      if (bunnyMaxBytes && datei.size > bunnyMaxBytes) { eingabe.value = ''; return meldung(t('a_bunny_tul_nagy', { mb: Math.ceil(datei.size / 1048576), max: Math.floor(bunnyMaxBytes / 1048576) }), 'rot'); }
      // Laeuft fuer diese Lektion schon ein neues Video, wird es durch einen zweiten Upload verworfen: vorher fragen.
      if (l.bunny_ausstehend) return bestaetigen('a_bunny_masodik_frage', () => hochladen(datei));
      return hochladen(datei);
    });
    const frissites = async () => {
      const s = await api('GET', '/api/admin/lektionen/' + l.id + '/bunny-status');
      if (!s.ok) return meldung(fehlerText(s), 'rot');
      if (s.d.uebernommen) return ujraTolt(t('a_bunny_kesz'));
      meldung(t('a_bunny_allapot') + ': ' + bunnyStatusText(s.d.status));
    };
    return h('div', { class: 'fajl' },
      h('strong', { class: 'klein' }, t('a_bunny_cim')),
      jetzt?.quelle === 'bunny' ? h('span', { class: 'klein' }, t('a_bunny_allapot') + ': ' + bunnyStatusText(jetzt.bunny_status)) : null,
      h('label', { class: 'knopf klein' }, t('a_bunny_feltoltes'), eingabe),
      fortschritt, status, folytatas,
      l.bunny_ausstehend ? h('span', { class: 'klein' }, t('a_bunny_ausstehend')) : null,
      l.bunny_ausstehend ? h('button', { class: 'knopf klein hell', type: 'button', onclick: frissites }, t('a_bunny_frissites')) : null,
      h('span', { class: 'klein' }, t('a_bunny_tipp')));
  }

  function dateiBlock(l) {
    if (l.art === 'text') return null;
    if (l.art === 'datei') return h('p', { class: 'hinweis' }, t('a_datei_umwandeln'));
    const jetzt = (l.dateien || [])[0];
    const eingabe = h('input', { type: 'file', class: 'versteckt', accept: (endungen[l.art] || []).join(',') });
    const fortschritt = h('progress', { max: '100', value: '0', hidden: true });
    const prozent = h('span', { class: 'klein' });
    eingabe.addEventListener('change', async () => {
      const datei = eingabe.files[0];
      if (!datei) return;
      if (maxBytes && datei.size > maxBytes) { eingabe.value = ''; return meldung(t('a_fajl_tul_nagy', { mb: Math.floor(maxBytes / (1024 * 1024)) }), 'rot'); }
      eingabe.disabled = true; fortschritt.hidden = false;
      meldung(t('a_fajl_folyamat'));
      const a = await dateiSenden(l, datei, fortschritt, prozent);
      eingabe.disabled = false; fortschritt.hidden = true;
      if (!a.ok) return meldung(a.d?.text || t('a_halozati_hiba'), 'rot');
      return ujraTolt(t('a_fajl_feltoltve'));
    });
    return h('div', { class: 'fajl' },
      l.art === 'datei' ? h('p', { class: 'hinweis' }, t('a_datei_umwandeln')) : null,
      h('span', { class: 'klein' }, jetzt ? t('a_fajl_cim') + ': ' + jetzt.name + (jetzt.quelle === 'bunny' ? '' : ' (' + formatMeret(jetzt.groesse) + ')') : t('a_fajl_nincs')),
      h('label', { class: 'knopf klein' }, t('a_fajl_feltoltese'), eingabe),
      fortschritt, prozent,
      jetzt ? h('span', { class: 'klein' }, t('a_fajl_csere')) : null,
      jetzt ? h('button', { class: 'knopf klein rot', type: 'button', onclick: () => bestaetigen('a_datei_loeschen_frage', async () => {
        const r = await api('DELETE', '/api/admin/lektionen/' + l.id + '/datei');
        if (!r.ok) return meldung(fehlerText(r), 'rot');
        await ujraTolt(t('a_loeschen_ok'));
      }) }, t('a_datei_loeschen')) : null,
      l.art === 'video' && bunnyAn ? bunnyBlock(l, jetzt) : null);
  }

  async function athelyez(index, irany) {
    const cel = index + irany;
    if (cel < 0 || cel >= lecken.length) return;
    const sorrend = lecken.slice();
    [sorrend[index], sorrend[cel]] = [sorrend[cel], sorrend[index]];
    // Alle Lektionen neu von 1 an nummerieren; nur geänderte Nummern werden gespeichert.
    for (let i = 0; i < sorrend.length; i++) {
      if (sorrend[i].reihenfolge === i + 1) continue;
      const a = await api('PATCH', '/api/admin/lektionen/' + sorrend[i].id, { reihenfolge: i + 1 });
      if (!a.ok) { await kurs(id); return meldung(fehlerText(a), 'rot'); }
    }
    return ujraTolt(t('a_sorrend_mentve'));
  }

  async function lathatosag(lecke) {
    const uj = lecke.status === 'veroeffentlicht' ? 'entwurf' : 'veroeffentlicht';
    const a = await api('PATCH', '/api/admin/lektionen/' + lecke.id, { status: uj });
    if (!a.ok) return meldung(fehlerText(a), 'rot');
    return ujraTolt(uj === 'entwurf' ? t('a_lecke_elrejtve') : t('a_lecke_lathato'));
  }


  function lektionBearbeiten(l) {
    const titel = h('input', { type: 'text', maxlength: '200', value: l.titel });
    const abschnitt = h('input', { type: 'text', maxlength: '200', value: l.abschnitt || '' });
    const inhalt = h('textarea', { rows: '6', maxlength: '8000' }); inhalt.value = l.inhalt || '';
    const bereich = h('form', { class: 'karte', onsubmit: async (e) => {
      e.preventDefault();
      const r = await api('PATCH', '/api/admin/lektionen/' + l.id, { titel: titel.value, abschnitt: abschnitt.value, inhalt: inhalt.value });
      if (!r.ok) return meldung(fehlerText(r), 'rot');
      await ujraTolt(t('a_lecke_mentve'));
    } }, feld(t('a_lecke_cim'), titel), feld(t('a_szakasz'), abschnitt),
      feld(t('a_lecke_szoveg'), inhalt), h('button', { class: 'knopf', type: 'submit' }, t('a_mentes')));
    app.append(bereich);
    bereich.scrollIntoView({ block: 'nearest' });
  }

  const sorok = listeMitMehr(h('div',{}), lecken, (l, i) => h('li', { class: l.status === 'veroeffentlicht' ? 'lecke' : 'lecke rejtett' },
    h('div', { class: 'lecke-szoveg' },
      l.abschnitt ? h('span', { class: 'klein' }, l.abschnitt) : null,
      h('strong', {}, l.titel),
      h('span', { class: 'klein' }, t(ADMIN_ART_TEXTE[l.art] || 'a_ismeretlen') + (l.status === 'veroeffentlicht' ? '' : ' · ' + t('a_rejtett')))),
    dateiBlock(l),
    h('div', { class: 'lecke-gombok' },
      h('button', { class: 'knopf klein hell', type: 'button', disabled: i === 0, 'aria-label': t('a_fel'), onclick: () => athelyez(i, -1) }, '▲ ' + t('a_fel')),
      h('button', { class: 'knopf klein hell', type: 'button', disabled: i === lecken.length - 1, 'aria-label': t('a_le'), onclick: () => athelyez(i, 1) }, '▼ ' + t('a_le')),
      h('button', { class: 'knopf klein hell', type: 'button', onclick: () => lathatosag(l) }, l.status === 'veroeffentlicht' ? t('a_elrejtes') : t('a_megjelenites')),
      h('button', { class: 'knopf klein hell', type: 'button', onclick: () => lektionBearbeiten(l) }, t('a_szerkesztes')),
      (k.status === 'entwurf' || l.status !== 'veroeffentlicht') ? h('button', { class: 'knopf klein rot', type: 'button', onclick: () => bestaetigen('a_lektion_loeschen_frage', async () => {
        const r = await api('DELETE', '/api/admin/lektionen/' + l.id);
        if (!r.ok) return meldung(fehlerText(r), 'rot');
        await ujraTolt(t('a_loeschen_ok'));
      }) }, t('a_lektion_loeschen')) : null)), {zeilenTag:'ol', leerText:t('a_nincs_lecke'), schluessel:'kursLektionen:'+id});

  // Neue Lektion
  const szakasz = h('input', { type: 'text', maxlength: '200' });
  const leckeCim = h('input', { type: 'text', maxlength: '200' });
  const tipus = h('select', {}, ['text', 'video', 'pdf', 'audio'].map((a) => h('option', { value: a }, t(ADMIN_ART_TEXTE[a]))));
  const szoveg = h('textarea', { rows: '6', maxlength: '8000' });
  const feltoltesHint = h('p', { class: 'hinweis', hidden: true }, t('a_feltoltes_hint'));
  tipus.addEventListener('change', () => { feltoltesHint.hidden = tipus.value === 'text'; });
  const hozzaad = h('button', { class: 'knopf', type: 'submit' }, t('a_hozzaadas'));
  const leckeUrlap = h('form', { class: 'karte', onsubmit: async (e) => {
    e.preventDefault();
    if (!leckeCim.value.trim()) return meldung(t('a_cim_kell'), 'rot');
    hozzaad.disabled = true;
    const a = await api('POST', '/api/admin/kurse/' + id + '/lektionen', { titel: leckeCim.value, abschnitt: szakasz.value, art: tipus.value, inhalt: szoveg.value });
    hozzaad.disabled = false;
    if (!a.ok) return meldung(fehlerText(a), 'rot');
    // Block 4: In einem bereits sichtbaren Kurs legt der Server die Lektion ausgeblendet an; der Admin gibt sie mit "Einblenden" frei.
    return ujraTolt(a.d?.status === 'entwurf' ? t('a_lecke_hozzaadva_rejtett') : t('a_lecke_hozzaadva'));
  } }, h('h3', {}, t('a_uj_lecke')),
  k.status !== 'entwurf' ? h('p', { class: 'hinweis' }, t('a_uj_lecke_rejtett_hinweis')) : null,
  feld(t('a_szakasz'), szakasz), feld(t('a_lecke_cim'), leckeCim), feld(t('a_lecke_tipus'), tipus), feldCsoport(t('a_lecke_szoveg'), szoveg, feltoltesHint), hozzaad);

  // Kész: Rückfrage, dann veröffentlichen
  const veroeffentlichBereich = h('div', { class: 'kesz-bereich' });
  if (k.status !== 'veroeffentlicht') {
    const kesz = h('button', { class: 'knopf gross gruen', type: 'button' }, t(k.status === 'entwurf' ? 'a_kurs_veroeffentlichen' : 'a_kesz'));
    kesz.addEventListener('click', () => {
      const igen = h('button', { class: 'knopf gross gruen', type: 'button', onclick: async () => {
        igen.disabled = true;
        const a = await api('POST', '/api/admin/kurse/' + id + '/veroeffentlichen', {});
        if (!a.ok) { igen.disabled = false; return meldung(fehlerText(a), 'rot'); }
        return ujraTolt(t('a_kozzetetel_ok'));
      } }, t('a_igen'));
      const megse = h('button', { class: 'knopf gross hell', type: 'button', onclick: () => veroeffentlichBereich.replaceChildren(kesz) }, t('a_megse'));
      veroeffentlichBereich.replaceChildren(h('div', { class: 'karte', role: 'alertdialog' },
        h('p', { class: 'nagy' }, t('a_biztosan')), h('p', {}, t('a_kesz_magyarazat')),
        lecken.some(l => l.status === 'veroeffentlicht') ? null : h('p', { class: 'meldung rot' }, t('a_nincs_lathato_lecke')),
        h('div', { class: 'zeile' }, igen, megse)));
      igen.focus();
    });
    veroeffentlichBereich.append(kesz);
  }


  const aktionen = h('section', { class: 'karte' },
    k.status === 'veroeffentlicht' ? h('button', { class: 'knopf', type: 'button',
      onclick: () => bestaetigen('a_archivieren_frage', async () => {
        const r = await api('POST', '/api/admin/kurse/' + id + '/archivieren', {});
        if (!r.ok) return meldung(fehlerText(r), 'rot');
        await ujraTolt(t('a_archiviert_ok'));
      }) }, t('a_archivieren')) : null,
    k.status === 'entwurf' ? h('button', { class: 'knopf rot', type: 'button',
      onclick: () => bestaetigen('a_kurs_loeschen_frage', async () => {
        const r = await api('DELETE', '/api/admin/kurse/' + id);
        if (!r.ok) return meldung(fehlerText(r), 'rot');
        await uebersicht(); meldung(t('a_loeschen_ok'));
      }) }, t('a_kurs_loeschen')) : null);
  const zugangListe = h('div', {}, t('a_betoltes'));
  const zugangEmail = h('input', { type: 'email', maxlength: '254', required: true });
  const zugangBereich = h('section', { class: 'karte' }, h('h2', {}, t('a_zugaenge')), zugangListe,
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const r = await api('POST', '/api/admin/kurse/' + id + '/zugaenge', { email: zugangEmail.value });
      if (!r.ok) return meldung(fehlerText(r), 'rot');
      await ujraTolt(t('a_zugang_ok'));
    } }, feld(t('a_email_bestehend'), zugangEmail),
    h('button', { class: 'knopf', type: 'submit' }, t('a_zugang_geben'))));
  const zugangAntwort = await api('GET', '/api/admin/kurse/' + id + '/zugaenge');
  if (!zugangAntwort.ok) zugangListe.replaceChildren(h('p', {}, fehlerText(zugangAntwort)));
  else listeMitMehr(zugangListe, zugangAntwort.d, z =>
    h('div', { class: 'lecke' },
      h('span', {}, z.email + ' · ' + budapestZeit(z.erstellt) + ' · ' + t(z.quelle === 'zahlung' ? 'a_quelle_zahlung' : z.quelle === 'abo' ? 'a_quelle_abo' : 'a_quelle_einladung') + (z.gueltig_bis ? ' · ' + t('a_abo_gueltig_bis') + ': ' + budapestZeit(z.gueltig_bis) : '')),
      h('button', { class: 'knopf klein rot', type: 'button', onclick: () => bestaetigen('a_zugang_entziehen_frage', async () => {
        const r = await api('DELETE', '/api/admin/kurse/' + id + '/zugaenge/' + z.benutzer_id);
        if (!r.ok) return meldung(fehlerText(r), 'rot');
        await ujraTolt(t('a_zugang_ok'));
      }) }, t('a_zugang_entziehen'))), {leerText:t('a_nincs_zugang'), schluessel:'kursZugaenge:'+id});

  const aboListe = h('section', { class:'karte' }, h('h2', {}, t('a_abok')),
    h('p', {}, t('a_betoltes')));
  const aboAntwort = await api('GET','/api/admin/kurse/' + id + '/abos');
  if (aboAntwort.ok) aboListe.replaceChildren(h('h2', {}, t('a_abok')),
    listeMitMehr(h('div',{}), aboAntwort.d, a => h('p', { class:'klein' },
      a.email + ' · ' + t({ aktiv: 'a_abo_status_aktiv', zahlung_offen: 'a_abo_status_zahlung_offen', gekuendigt: 'a_abo_status_gekuendigt', beendet: 'a_abo_status_beendet' }[a.status] ?? 'a_abo_status_beendet') + ' · ' +
      (a.gueltig_bis ? budapestZeit(a.gueltig_bis) : t('a_abo_keine_zahlung')) +
      (a.endet_zum_periodenende ? ' · ' + t('a_abo_endet') : '')), {leerText:t('a_nincs_abo'), schluessel:'kursAbos:'+id}));
  else aboListe.replaceChildren(h('p', { class:'meldung rot' }, fehlerText(aboAntwort)));

  // Oeffentliche Werbung: niemals geschuetzte Lektionen als Trailer hochladen.
  function vorschauBereich() {
    const BILD_MAX=2*1024*1024, TRAILER_MAX=30*1024*1024;
    const nutzen=h('textarea',{rows:'8'});
    nutzen.value=k.nutzen || '';
    const bild=h('input',{type:'file',class:'versteckt',accept:'image/jpeg,image/png,image/webp'});
    const clip=h('input',{type:'file',class:'versteckt',accept:'video/mp4,video/webm'});
    function hochladen(art,datei,limit) {
      if (!datei) return;
      if (datei.size > limit) { meldung(t('a_vorschau_zu_gross'),'rot'); return; }
      const xhr=new XMLHttpRequest();
      xhr.open('PUT','/api/admin/kurse/'+id+'/vorschau/'+art);
      xhr.setRequestHeader('Content-Type','application/octet-stream');
      xhr.onload=()=> {
        let d={};try{d=JSON.parse(xhr.responseText);}catch{}
        if(xhr.status!==201)return meldung(d.text||t('a_halozati_hiba'),'rot');
        ujraTolt(t('a_fajl_feltoltve'));
      };
      xhr.onerror=()=>meldung(t('a_halozati_hiba'),'rot');
      xhr.send(datei);
    }
    bild.addEventListener('change',()=>{
      const datei=bild.files[0]; if(!datei)return;
      if(k.hat_titelbild)bestaetigen('a_vorschau_ersetzen_frage',()=>hochladen('titelbild',datei,BILD_MAX));
      else hochladen('titelbild',datei,BILD_MAX);
    });
    clip.addEventListener('change',()=>{
      const datei=clip.files[0]; if(!datei)return;
      if(k.hat_trailer)bestaetigen('a_vorschau_ersetzen_frage',()=>hochladen('trailer',datei,TRAILER_MAX));
      else hochladen('trailer',datei,TRAILER_MAX);
    });
    function loeschen(art) {
      return bestaetigen('a_vorschau_loeschen_frage',async()=>{
        const r=await api('DELETE','/api/admin/kurse/'+id+'/vorschau/'+art);
        if(!r.ok)return meldung(fehlerText(r),'rot');
        await ujraTolt(t('a_loeschen_ok'));
      });
    }
    return h('section',{class:'karte admin-vorschau'},
      h('h2',{},t('a_vorschau_cim')),
      h('p',{class:'hinweis'},t('a_vorschau_oeffentlich')),
      k.hat_titelbild ? h('img',{class:'admin-vorschau-bild',src:'/api/admin/kurse/'+id+'/vorschau/titelbild',alt:k.titel}) : null,
      h('div',{class:'fajl'}, h('label',{class:'knopf klein'},k.hat_titelbild?t('a_vorschau_cserel'):t('a_fajl_feltoltese'),bild),
        k.hat_titelbild?h('button',{class:'knopf klein rot',type:'button',onclick:()=>loeschen('titelbild')},t('a_vorschau_torol')):null),
      h('p',{class:'hinweis'},t('a_vorschau_bild_limit')),
      k.hat_trailer?h('video',{class:'admin-vorschau-video',controls:true,preload:'metadata',playsinline:true,src:'/api/admin/kurse/'+id+'/vorschau/trailer'}):null,
      h('div',{class:'fajl'},h('label',{class:'knopf klein'},k.hat_trailer?t('a_vorschau_cserel'):t('a_fajl_feltoltese'),clip),
        k.hat_trailer?h('button',{class:'knopf klein rot',type:'button',onclick:()=>loeschen('trailer')},t('a_vorschau_torol')):null),
      h('p',{class:'hinweis'},t('a_vorschau_trailer_limit')),
      h('form',{onsubmit:async e=>{
        e.preventDefault();
        const r=await api('PATCH','/api/admin/kurse/'+id+'/nutzen',{nutzen:nutzen.value});
        if(!r.ok)return meldung(fehlerText(r),'rot');
        await ujraTolt(t('a_kurzus_mentve'));
      }},feld(t('a_vorschau_nutzen'),nutzen,t('a_vorschau_nutzen_hinweis')),
      h('button',{class:'knopf',type:'submit'},t('a_mentes'))));
  }
  const szerkeszto = h('details', { class: 'karte' }, h('summary', {}, t('a_adatok')),
    kursUrlap(k, async () => { await ujraTolt(t('a_kurzus_mentve')); }));

  zeigen(
    kopf(k.titel),
    h('div', { class: 'zeile' }, statusPlakette(k.status), h('span', { class: 'klein' }, preisText(k.preis_cent, k.waehrung))),
    h('button', { class: 'knopf klein hell', type: 'button', onclick: () => { meldung(''); uebersicht(); } }, t('a_vissza')),
    szerkeszto,
    h('button',{type:'button',class:'knopf klein hell',onclick:()=>kurspaketExport(id)},t('paket_export')),
    vorschauBereich(),
    aktionen,
    zugangBereich,
    aboListe,
    h('h2', {}, t('a_leckek')),
    sorok,
    leckeUrlap,
    veroeffentlichBereich);
}

function feldCsoport(beschriftung, eingabe, hinweisElement) {
  return h('label', { class: 'feld' }, h('span', { class: 'beschriftung' }, beschriftung), eingabe, hinweisElement);
}

let LOC = 'de-DE';
// ---- Los geht's --------------------------------------------------------------------------------------
try {
  const r = await fetch('/api/texte');
  if (!r.ok) throw new Error('texte');
  T = await r.json();
  if (!T.a_titel) throw new Error('texte');
} catch (e) { throw new Error('texts not loaded; the fixed notice in index.html stays'); }
LOC = T._locale || LOC; document.documentElement.lang = T._sprache || 'de';
document.title = (T._titel_praefix || '') + t('a_titel');
try { const a = await (await fetch('/api/anbieter')).json(); if (a.demo) { const b = document.createElement('p'); b.className = 'demo-banner'; b.setAttribute('role', 'note'); b.textContent = t('demo_banner'); document.body.prepend(b); } } catch { /* kein Banner */ }
await start();
