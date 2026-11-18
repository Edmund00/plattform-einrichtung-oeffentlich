// Kundenseiten (Sprache de oder hu). Alle Texte kommen aus /api/texte (texte/<sprache>.json), nichts Sprachliches steht hier im Code.
// Sicherheit: Inhalte aus Eingaben und aus der API werden NUR als Text eingesetzt (createElement, append(Text)), nie als HTML.
// Es gibt kein innerHTML, kein eval, keine Inline-Skripte (die Content-Security-Policy würde sie blockieren).
// Seiten (Adresse nach dem #): / Kurse, kurs/ID, belepes, eloadasaim, eloadas/ID, lecke/KURS/LECKE. Rückkehr von Stripe: /?kauf=...
import { formatBetrag, formatMeret } from './preis.js';

const FIZETES_ELLENORZES_MS = 2000;   // so oft nach der Zahlung nachsehen
const FIZETES_ELLENORZES_DB = 12;     // so oft, dann eine ruhige Meldung
const STRIPE_ELOTAG = 'https://checkout.stripe.com/';

let T = {};
// Produktreife (12.11.2026): Demo-/Muster-Hinweise erscheinen NUR, wenn der Server den Demo-Modus meldet (/api/anbieter -> demo:true).
let DEMO = false;
const ellallasTitel = () => t(DEMO ? 'mailrecht_ellallas_titel_demo' : 'mailrecht_ellallas_titel');
const KURS_ART_TEXTE = Object.freeze({ text: 'k_art_text', video: 'k_art_video', pdf: 'k_art_pdf', audio: 'k_art_audio', datei: 'k_art_datei' });
const ABO_INTERVAL_TEXTE = Object.freeze({ month: 'k_abo_month', year: 'k_abo_year' });
const t = (schluessel, werte) => {
  let s = T[schluessel] ?? schluessel;
  for (const [name, wert] of Object.entries(werte || {})) s = s.replaceAll('{' + name + '}', String(wert));
  return s;
};

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
const meldungsfeld = h('div', { class: 'meldung' });
const meldung = (text, art = 'ok') => { meldungsfeld.removeAttribute('role'); meldungsfeld.removeAttribute('aria-live'); if (text) { meldungsfeld.setAttribute('role', art === 'rot' ? 'alert' : 'status'); meldungsfeld.setAttribute('aria-live', art === 'rot' ? 'assertive' : 'polite'); } meldungsfeld.textContent = text || ''; meldungsfeld.className = text ? 'meldung ' + art : 'meldung'; if (text) meldungsfeld.scrollIntoView?.({ block: 'nearest' }); };

async function api(methode, pfad, body) {
  let antwort;
  try {
    antwort = await fetch(pfad, { method: methode, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    return { ok: false, status: 0, d: { text: t('k_halozati_hiba') } };
  }
  let d = {};
  try { d = await antwort.json(); } catch (e) { /* leere Antwort */ }
  return { ok: antwort.ok, status: antwort.status, d };
}
const fehlerText = (r) => r.d?.text || t('k_halozati_hiba');

let ich = { angemeldet: false };
let verkaufPausiert=true;
async function verkaufLaden(){
 const r=await api('GET','/api/verkauf-status');
 verkaufPausiert=!(r.ok&&r.d&&r.d.pausiert===false);
}
const verkaufHinweis=()=>h('p',{class:'karte verkauf-hinweis',role:'status'},t('verkauf_hinweis'));

async function ichLaden() {
  const r = await api('GET', '/api/ich');
  ich = r.ok && r.d.angemeldet ? r.d : { angemeldet: false };
}

// Wohin nach der Anmeldung? Nur bekannte Ziele (kein Weiterleiten auf fremde Adressen).
const ERLAUBTES_ZIEL = /^(?:kurs\/[1-9]\d{0,15}|(?:eloadas|tanfolyam)\/[1-9]\d{0,15}|eloadasaim|kurzusaim|fiokom)$/;
const idErlaubt = (x) => /^[1-9]\d{0,15}$/.test(String(x));
// Eine Meldung, die nach dem Seitenwechsel erscheinen soll (der Wechsel selbst löscht sonst die alte Meldung)
let ujUzenet = null;
const uzenetKesobb = (text, art = 'ok') => { ujUzenet = { text, art }; };
const gehe = (ziel) => { const neu = '#/' + ziel; if (location.hash === neu) route(); else location.hash = neu; };
const belepesre = (vissza) => gehe('belepes' + (ERLAUBTES_ZIEL.test(vissza || '') ? '?vissza=' + vissza : ''));


// Sprachumschalter (EN / DE / HU): speichert die Wahl im Cookie und, wenn angemeldet, im Konto; danach wird die Seite neu geladen.
function sprachwahl() {
  const aktiv = T._sprache || 'de';
  return h('nav', { class: 'sprachwahl', 'aria-label': t('sprache_label') },
    ...[['en', 'EN', 'English'], ['de', 'DE', 'Deutsch'], ['hu', 'HU', 'Magyar']].map(([code, kurz, name]) =>
      h('button', { type: 'button', lang: code, title: name, 'aria-label': name, 'aria-current': code === aktiv ? 'true' : 'false', class: code === aktiv ? 'aktiv' : '',
        onclick: async () => { if (code === aktiv) return; await fetch('/api/sprache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sprache: code }) });
          // Eine Sprache in der Adresse (?lang=xx oder Praefix /xx) schlaegt das Cookie: sie muss vor dem Neuladen weg, sonst springt die Seite zurueck.
          const u = new URL(location.href); u.searchParams.delete('lang'); u.pathname = u.pathname.replace(/^\/(en|de|hu)(?=\/|$)/, '') || '/';
          if (u.href !== location.href) location.replace(u.href); else location.reload(); } }, kurz)));
}

// ---- Gemeinsame Teile ------------------------------------------------------------------------
// Produktreife Block 2: Logo-Pfade meldet der Server in /api/texte (_logo, _logo_vertikal; eigener PLATTFORM_NAME = Textlogo). Rueckfall: Muster-Logo.
const LOGO = { quer: () => T._logo || '/img/muster-logo.svg', vertikal: () => T._logo_vertikal || '/img/muster-logo-vertikal.svg' };
function kopfzeile() {
  const menue = h('nav', { class: 'menue', 'aria-label': t('k_navigacio') },
    h('a', { href: '#/' }, t('k_nav_eloadasok')),
    k3Details(),
    ich.angemeldet ? h('a', { href: '#/eloadasaim' }, t('k_nav_kurzusaim')) : null,
    ich.angemeldet ? h('a', { href: '#/fiokom' }, t('k_nav_fiokom')) : null,
    ich.angemeldet ? h('button', { type: 'button', onclick: kilepes }, t('k_nav_kilepes'))
      : [h('a', { href: '#/belepes' }, t('k_nav_belepes')), h('a', { href: '#/regisztracio' }, t('k_nav_regisztracio'))]);
  return h('header', { class: 'kopf' }, h('div', { class: 'kopf-belso' },
    h('a', { class: 'marka', href: '#/', 'aria-label': t('k_nav_eloadasok') },
      h('img', { src: LOGO.quer(), alt: t('k_logo_alt') })),
    h('div', { class: 'kopf-rechts' }, menue, sprachwahl())));
}
// Gesetzliche Widerrufsfunktion (ungarische Verordnung 45/2014, seit 19.06.2026): zentrale Seite der Hauptseite, schon fertig mit Bestätigungsmail (Datum/Uhrzeit).
const ELALLAS_URL = '#/fiokom';
function fusszeile() {
  const alap = location.origin + '/jogi/';
  return h('footer', { class: 'fuss' }, h('div', { class: 'fuss-inhalt' },
    h('a', { href: '#/' }, h('img', { class: 'fuss-logo', src: LOGO.vertikal(), alt: t('k_logo_alt') })),
    k3Details(true),
    h('nav', { class: 'fuss-links', 'aria-label': t('k_jogi_linkek') },
      h('a', { href: alap + 'impresszum/', target: '_blank', rel: 'noopener noreferrer' }, t('k_impresszum')),
      h('a', { href: alap + 'adatvedelem/', target: '_blank', rel: 'noopener noreferrer' }, t('k_adatvedelem')),
      h('a', { href: alap + 'reszveteli-feltetelek/', target: '_blank', rel: 'noopener noreferrer' }, t('k_feltetelek')),
      h('a', { href: ELALLAS_URL, target: '_blank', rel: 'noopener noreferrer' }, t('k_elallas')),
      h('a', { href: '#/elallasi-tajekoztato' }, ellallasTitel()))));
}
function hero(cim, leiras, logo = false, kursHero = false, startseite = false) {
  if (startseite) {
    cim = T._hero?.titel?.trim() || cim;
    leiras = T._hero?.untertitel?.trim() || leiras;
    const titel = document.createElement('h1'); titel.textContent = cim;
    const text = document.createElement('p'); text.className = 'lead'; text.textContent = leiras;
    if (T._banner) {
      return h('section', { class: 'hero hero-banner' },
        h('img', { class: 'hero-banner-bild', src: T._banner, alt: cim, loading: 'eager' }),
        h('div', { class: 'hero-belso' }, titel, text));
    }
    return h('section', { class: 'hero' }, h('div', { class: 'hero-belso' },
      logo ? h('img', { class: 'hero-logo', src: LOGO.vertikal(), alt: t('k_logo_alt') }) : null,
      titel, leiras ? text : null));
  }

  return h('section', { class: kursHero ? 'hero hero-kurs' : 'hero' }, h('div', { class: 'hero-belso' },
    logo ? h('img', { class: 'hero-logo', src: LOGO.vertikal(), alt: t('k_logo_alt') }) : null,
    h('h1', {}, cim), leiras ? h('p', { class: 'lead' }, leiras) : null));
}
function emailLeiste() {
  if(!ich.angemeldet || !ich.email_bestaetigung_pflicht || ich.email_bestaetigt!==false)return null;
  const knopf=h('button',{class:'knopf klein',type:'button',onclick:async()=>{
    knopf.disabled=true;
    const r=await api('POST','/api/email-bestaetigung-erneut',{});
    antwort.textContent=r.ok?t('k_email_erneut_ok'):fehlerText(r);
    // Kein Timer: Entsperren erst beim neuen Aufruf, um Doppelversand zu vermeiden.
  }},t('k_email_erneut'));
  const antwort=h('span',{class:'klein',role:'status'});
  return h('aside',{class:'email-hinweis',role:'status'},
    h('strong',{},t('k_email_hinweis')),knopf,antwort);
}
function zeigen(...teile) {
  meldung('');
  jelszoZuruecksetzen();
  const haupt = h('main', { class: 'oldal-main', tabindex: '-1' }, emailLeiste(), meldungsfeld, ...teile.flat(Infinity));
  app.replaceChildren(kopfzeile(), haupt, fusszeile());
  document.querySelectorAll('.k3-chips').forEach(k3ChipsEnde);
  for(const x of jelszoAugen)if(!x.input.isConnected){x.input.value='';jelszoAugen.delete(x);}
  seiteAnsagen(haupt);
}
// A10-03 (WCAG 2.4.2/2.4.3): jede Seite bekommt einen eigenen Titel (Hauptueberschrift + Seitenname). Nach einem Routenwechsel (nicht beim ersten Laden)
// geht der Fokus auf die Hauptueberschrift (tabindex -1), solange es noch keine gibt (Ladeanzeige) auf main; preventScroll: kein Sprung.
let fokusNachRoute = false, ersteRoute = true;
// Gleicher Ablauf fuer Zwischenschritte ohne Routenwechsel (z. B. Widerruf): Titel und Fokus auf die neue Ueberschrift.
function zeigenMitFokus(...teile) { fokusNachRoute = true; zeigen(...teile); }
// Fehlerzustand als eigene Seite: der vorhandene Fehlertext ist die Hauptueberschrift (Titel, Fokusziel nach Routenwechsel).
const fehlerAnsicht = (text, ...rest) => zeigen(h('h1', { class: 'meldung rot fehlerseite', role: 'alert' }, text), ...rest);
function seiteAnsagen(haupt) {
  const ueberschrift = haupt.querySelector('h1, h2');
  const name = ueberschrift ? ueberschrift.textContent.trim() : '';
  const basisTitel = (T._titel_praefix || '') + t('k_oldal_cim');   // F-141: Plattformname bleibt bei jedem Ansichtswechsel im Titel
  document.title = name && name !== t('k_oldal_cim') ? name + ' – ' + basisTitel : basisTitel;
  if (!fokusNachRoute) return;
  if (ueberschrift) { ueberschrift.setAttribute('tabindex', '-1'); fokusNachRoute = false; }
  (ueberschrift || haupt).focus({ preventScroll: true });
}

const betoltes = () => zeigen(h('p', {}, t('k_betoltes')));

async function kilepes() {
  await api('POST', '/api/abmelden');
  ich = { angemeldet: false };
  uzenetKesobb(t('k_kilepve'));
  gehe('');
}

const arText = (k) => (k.preis_cent === 0 ? t('k_ingyenes') : formatBetrag(k.preis_cent, k.waehrung));

// Öffentliche Werbe-Vorschau, technisch getrennt von geschützten Lektionen.
function coverText(k){const teile=String(k.titel||'').split(':');const x=(teile.length>1?teile.slice(1).join(':'):teile[0]).trim();return x;}
function titelbild(k) {
  const flaeche=h('div',{class:'kurs-titelbild'});
  if (!k.hat_titelbild) {
    flaeche.append(h('span',{class:'kurs-bild-platzhalter','aria-hidden':'true'},coverText(k)));
    return flaeche;
  }
  const bild=h('img',{src:'/api/kurse/'+k.id+'/titelbild',alt:k.titel,loading:'lazy'});
  bild.addEventListener('error',()=>flaeche.replaceChildren(h('span',{class:'kurs-bild-platzhalter','aria-hidden':'true'},coverText(k))));
  flaeche.append(bild);
  return flaeche;
}
function lernziele(k) {
  const zeilen=(k.nutzen||'').split('\n').map(x=>x.trim()).filter(Boolean);
  return zeilen.length ? h('section',{class:'kurs-nutzen'},h('h2',{},t('k_vorschau_nutzen')),
    h('ul',{},zeilen.map(x=>h('li',{},x)))) : null;
}
function trailer(k) {
  if (!k.hat_trailer) return null;
  const video=h('video',{class:'kurs-trailer-video',controls:true,preload:'metadata',playsinline:true,
    ...(k.hat_titelbild?{poster:'/api/kurse/'+k.id+'/titelbild'}:{}),
    src:'/api/kurse/'+k.id+'/trailer','aria-label':t('k_vorschau_trailer')});
  const bereich=h('section',{class:'kurs-trailer'},h('h2',{},t('k_vorschau_trailer')),video);
  video.addEventListener('error',()=>bereich.remove());
  return bereich;
}
// B9: Demo-Instanz (DEMO_MODUS): Knoepfe "Demo ausprobieren" mit sichtbarem Testmodus-Hinweis. Auf normalen Instanzen kommt nichts.
// Weiterleitung zum Admin per Link-Klick (die Seiten-Tests erlauben keine direkte Zuweisung an die Adresse).
function nachAdmin() { const a = document.createElement('a'); a.href = '/admin/'; document.body.append(a); a.click(); }
async function demoBox() {
  const a = await api('GET', '/api/anbieter');
  if (!(a.ok && a.d?.demo)) return null;
  const start = async (rolle) => {
    const x = await api('POST', '/api/demo/zugang', { rolle });
    if (!x.ok) return meldung(fehlerText(x), 'rot');
    if (rolle === 'admin') return nachAdmin();
    await ichLaden(); gehe('');
    location.reload();
  };
  return h('section', { class: 'karte demo-box', role: 'region', 'aria-label': t('demo_box_titel') },
    h('h2', {}, t('demo_box_titel')), h('p', {}, t('demo_box_text')), h('p', { class: 'klein demo-reset' }, t('demo_reset_hinweis')),
    h('div', { class: 'demo-knoepfe' },
      h('button', { class: 'knopf', type: 'button', onclick: () => start('kaeufer') }, t('demo_kaeufer')),
      h('button', { class: 'knopf ghost', type: 'button', onclick: () => start('admin') }, t('demo_admin'))));
}
// ---- Startseite: veröffentlichte Kurse ---------------------------------------------------------------------
// K1: pure query builder, shared contract with the admin catalogue.
window.addEventListener('resize', () => document.querySelectorAll('.k3-chips').forEach(k3ChipsEnde));
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
// K3: Erfolgreiche Abrufe je Sprache cachen; Fehler bleiben wiederholbar.
let k3Cache, k3Sprache, k3Kategorien = [];
let k3KatalogBereich = '';
const k3KatalogZustaende = new Map();
function k3Laden() {
  const sprache = T._sprache || 'de';
  if (!k3Cache || k3Sprache !== sprache) {
    k3Sprache = sprache; k3Kategorien = [];
    k3Cache = Promise.resolve().then(() => api('GET', '/api/kategorien')).then(r => {
      const d = r.ok && Array.isArray(r.d) ? r.d : [];
      k3Kategorien = d;
      return { ok:r.ok && Array.isArray(r.d), d };
    }).catch(() => ({ ok:false, d:[] })).then(r => {
      if (!r.ok) k3Cache = null;
      return r;
    });
  }
  return k3Cache;
}
function k3Anzahl(n) { return n === 1 ? t('k3_anzahl_eins') : t('k3_anzahl', {n}); }
function k3Link(c, aktiv = '') {
  return h('a', { href:'#/kategorie/' + c.id, ...(String(c.id) === aktiv ? {'aria-current':'page'} : {}) },
    c.name, ' · ', k3Anzahl(c.anzahl));
}
function k3Links() {
  return h('ul', {}, k3Kategorien.slice(0,8).map(c => h('li', {}, k3Link(c))),
    k3Kategorien.length > 8 ? h('li', {}, h('a', {href:'#/kategorien'}, t('k3_alle'))) : null);
}
function k3Details(fuss = false) {
  if (!k3Kategorien.length) return null;
  const summary = h('summary', {}, t('k3_titel'));
  const details = h('details', {class:fuss ? 'fuss-kategorien' : 'kopf-kategorien'}, summary,
    fuss ? h('nav', {'aria-label':t('k3_footer')}, k3Links()) : k3Links());
  if (fuss) details.open = !!window.matchMedia?.('(min-width: 768px)').matches;
  else {
    const escape = e => {
      if (e.key === 'Escape') { details.open = false; document.removeEventListener('keydown', escape); summary.focus(); }
    };
    details.k3Schliessen = () => { details.open = false; document.removeEventListener('keydown', escape); };
    details.addEventListener('toggle', () => {
      document.removeEventListener('keydown', escape);
      if (details.open) document.addEventListener('keydown', escape);
    });
    details.addEventListener('keydown', escape);
    details.addEventListener('click', e => {
      if (e.target.closest?.('a')) details.k3Schliessen();
    });
  }
  return details;
}
function k3Schliessen(e) {
  for (const details of document.querySelectorAll('.kopf-kategorien[open]')) {
    if (!e || !details.contains(e.target)) details.k3Schliessen();
  }
}
function k3Alle() {
  const zustand = {...(k3KatalogBereich ? k3KatalogZustaende.get('') : k1ShopZustand)};
  delete zustand.kategorie; zustand.seite = 1; zustand.scroll = 0;
  k3KatalogZustaende.set('', zustand);
  if (!k3KatalogBereich) k1ShopZustand = zustand;
}
function k3ChipsEnde(chips) {
  chips.classList.toggle('k3-chips-ende', chips.scrollLeft + chips.clientWidth >= chips.scrollWidth - 1);
}
function k3Chips(aktiv = '') {
  if (!k3Kategorien.length) return null;
  return h('nav', {class:'k3-chips', 'aria-label':t('k3_chips'), onscroll:e => k3ChipsEnde(e.currentTarget)}, h('ul', {},
    h('li', {}, h('a', {href:'#/', onclick:k3Alle, ...(!aktiv ? {'aria-current':'page'} : {})}, t('k3_alle_chips'))),
    k3Kategorien.slice(0,8).map(c => h('li', {}, k3Link(c, aktiv))),
    k3Kategorien.length > 8 ? h('li', {}, h('a', {href:'#/kategorien'}, t('k3_mehr'))) : null));
}
function k3NichtGefunden() {
  zeigen(h('section', {class:'szakasz k3-seite'}, h('h1', {}, t('k3_nicht_gefunden')),
    h('a', {class:'knopf', href:'#/'}, t('k3_kurse'))));
}
function k3Ladefehler(erneut) {
  zeigen(h('section', {class:'szakasz k3-seite'}, h('h1', {}, t('k3_titel')),
    h('p', {role:'alert'}, t('k3_ladefehler')),
    h('button', {class:'knopf', onclick:erneut}, t('k3_erneut'))));
}
async function k3Kategorie(id) {
  const hash = location.hash;
  if (!idErlaubt(id)) return k3NichtGefunden();
  const kat = await k3Laden();
  if (location.hash !== hash) return;
  if (!kat.ok) return k3Ladefehler(() => k3Kategorie(id));
  if (!k3Kategorien.some(c => String(c.id) === id)) return k3NichtGefunden();
  return eloadasok();
}
function k3Breadcrumb(c) {
  return h('section', {class:'szakasz k3-seite'},
    h('nav', {'aria-label':t('k3_breadcrumb')}, h('ol', {class:'k3-pfad'},
      h('li', {}, h('a', {href:'#/', onclick:k3Alle}, t('k3_kurse'))),
      h('li', {}, h('span', {'aria-hidden':'true'}, ' › '), h('span', {'aria-current':'page'}, c.name)))),
    h('h1', {}, c.name));
}
// Kleine eigenständige Liste: 24 weitere, mit Fokusübergabe beim letzten Schritt.
function k3Liste(kategorien) {
  const liste = h('ul', {class:'k3-liste'}), live = h('p', {role:'status', 'aria-live':'polite'});
  const mehr = h('button', {class:'knopf', type:'button', onclick:() => fuellen(true)});
  const box = h('div', {}, liste, live, mehr);
  let sichtbar = 0;
  function fuellen(klick = false) {
    const neue = kategorien.slice(sichtbar, sichtbar + 24).map(c => h('li', {}, k3Link(c)));
    liste.append(...neue); sichtbar += neue.length;
    mehr.hidden = sichtbar >= kategorien.length;
    mehr.textContent = t('liste_mehr', {n:kategorien.length - sichtbar});
    live.textContent = kategorien.length ? t('liste_gesamt', {n:kategorien.length}) : t('k3_leer');
    if (klick && mehr.hidden) neue[0]?.children[0]?.focus();
  }
  fuellen();
  return box;
}
async function k3Uebersicht() {
  const hash = location.hash;
  const kat = await k3Laden();
  if (location.hash !== hash) return;
  if (!kat.ok) return k3Ladefehler(k3Uebersicht);
  const ergebnisse = h('div', {}, k3Liste(k3Kategorien));
  const suche = h('input', {type:'search', oninput:() => {
    const q = suche.value.normalize('NFC').trim().toLocaleLowerCase(T._locale || 'de-DE');
    ergebnisse.replaceChildren(k3Liste(k3Kategorien.filter(c => c.name.normalize('NFC').toLocaleLowerCase(T._locale || 'de-DE').includes(q))));
  }});
  zeigen(h('section', {class:'szakasz k3-seite'}, h('h1', {}, t('k3_titel')),
    h('label', {class:'k3-suche'}, h('span', {}, t('k3_suche')), suche), ergebnisse));
}
function katalogFehler(r) { const code = r.d?.fehler; return T[code] || r.d?.text || t('k1_fehler'); }
function katalogAuswahl(titel, werte, wert, aendern) {
  const select = h('select', { onchange: () => aendern(select.value) }, werte.map(([id, name]) => h('option', { value: id }, name)));
  select.value = wert || '';
  return h('label', { class: 'k1-feld' }, h('span', {}, titel), select);
}
function katalogStatus(neu, angezeigt, gesamt, alle) {
  if (alle) return t(gesamt === 1 ? 'k1_alle_angezeigt_1' : 'k1_alle_angezeigt', { n:gesamt });
  return t(neu === 1 ? 'k1_geladen_1' : 'k1_geladen', { n:neu, x:angezeigt, y:gesamt });
}
function katalogNeue(kurse, ids) {
  return kurse.filter(k => { const id = String(k.id); if (ids.has(id)) return false; ids.add(id); return true; });
}
let k1ShopZustand = {};
function katalogSuchtext(q) {
  const zeichen = [...String(q || '').trim()];
  return zeichen.length > 60 ? zeichen.slice(0,60).join('') + '...' : zeichen.join('');
}
// S2: Beispiele sind ein eigenständiger, öffentlicher Lesebereich.
function beispielPreis(k) {
  return k.gratis ? t('s2_preis_gratis') : t('s2_preis', { muster:formatBetrag(k.musterpreis_cent,k.waehrung) });
}
function beispielKarte(k) {
  const key = ['planen','video','plattform'].includes(k.key) ? k.key : 'planen';
  return h('article',{class:'karte kurzus-kartya s2-karte'},
    h('div',{class:'s2-cover s2-' + key,'aria-hidden':'true'},h('span',{},k.titel)),
    h('h3',{},k.titel), h('span',{class:'s2-kennzeichen'},t('s2_badge')),
    h('p',{class:'szoveg'},k.beschreibung),h('p',{},beispielPreis(k)),
    h('a',{class:'knopf',href:'#/beispiel/' + k.id},t('s2_ansehen')));
}
async function beispieleLaden(box, leer, katalogLeer) {
  try {
    const r = await api('GET','/api/beispiele');
    if (!box.isConnected || !r.ok || !r.d?.vorhanden) return;
    box.replaceChildren(h('h2',{},t('s2_titel')),h('p',{},t('s2_hinweis')),
      h('div',{class:'kurzus-racs'},r.d.kurse.map(beispielKarte)));
    box.hidden = false;
    if (katalogLeer) leer.hidden = true;
  } catch { /* Beispiele dürfen den Katalog nicht beeinträchtigen. */ }
}
async function beispielSeite(id) {
  betoltes();
  const hashBeginn = location.hash;
  const r = await api('GET','/api/beispiele/' + id);
  if (location.hash !== hashBeginn) return;
  const zurueck = h('a',{class:'knopf ghost',href:'#/'},t('s2_zurueck'));
  if (!r.ok) return fehlerAnsicht(r.status === 404 ? t('s2_nicht_gefunden') : (T[r.d?.fehler] || fehlerText(r)),zurueck);
  const k = r.d;
  zeigen(h('section',{class:'hero hero-kurs s2-detail'},h('div',{class:'hero-belso'},
    h('h1',{},k.titel),h('p',{},h('span',{class:'s2-kennzeichen'},t('s2_badge'))))),
    h('div',{class:'kurs-layout s2-detail'},
      h('section',{class:'kurs-beschreibung'},h('p',{class:'kurs-beschreibung-text'},k.beschreibung)),
      h('section',{class:'kurs-lektionen'},h('h2',{},t('s2_lektion')),k.lektionen.map(l => {
        const titel = h('h3',{}), text = h('p',{class:'szoveg'});
        titel.textContent = l.titel; text.textContent = l.text;
        return h('article',{class:'karte'},titel,text);
      })),
      h('aside',{class:'kurs-kauf-rechts'},h('div',{class:'preis-kasten'},
        h('h2',{},t('s2_admin_badge')),h('p',{class:'ar'},beispielPreis(k)),
        h('p',{},t('s2_detail_hinweis')),zurueck))));
}

async function eloadasok() {
  betoltes();
  await verkaufLaden();
  const hashBeginn = location.hash;
  const bereich = /^#\/kategorie\//.test(hashBeginn) ? hashBeginn.replace(/^#/, '').split(/[?#]/)[0].split('/')[2] : '';
  if (bereich !== k3KatalogBereich) {
    k3KatalogZustaende.set(k3KatalogBereich, {...k1ShopZustand});
    k1ShopZustand = {...(k3KatalogZustaende.get(bereich) || {})};
    if (!bereich && k3KatalogBereich) { delete k1ShopZustand.kategorie; k1ShopZustand.seite = 1; k1ShopZustand.scroll = 0; }
    k3KatalogBereich = bereich;
  }
  let zustand = { ...k1ShopZustand };
  const wiederSeiten = Number(zustand.seite) || 1, wiederScroll = zustand.scroll || 0;
  zustand.seite = 1;
  const [basis, kat, m] = await Promise.all([api('GET', bereich ? '/api/kurse?' + baueKatalogQuery({kategorie:bereich, seite:1}) : '/api/kurse?seite=1'), k3Laden(), ich.angemeldet ? api('GET', '/api/meine-kurse') : Promise.resolve(null)].map(p => p.catch(() => ({ok:false,d:{}}))));
  if (location.hash !== hashBeginn) return;
  if (!basis.ok) {
    zeigen(h('p', { role: 'alert' }, katalogFehler(!basis.ok ? basis : kat)), h('button', { class:'knopf', onclick: eloadasok }, t('k1_retry')));
    return;
  }
  const kategorien = kat.ok ? kat.d : [];
  const k3Aktiv = /^#\/kategorie\//.test(hashBeginn) ? kategorien.find(c => String(c.id) === bereich) : null;
  if (k3Aktiv) zustand.kategorie = String(k3Aktiv.id);
  if (!kategorien.some(c => String(c.id) === zustand.kategorie)) delete zustand.kategorie;
  const einfach = basis.d.gesamt <= 12 && kategorien.length === 0 && kat.ok;
  if (einfach) zustand = { seite: 1 };
  let meine = new Set();
  if (m && m.ok && Array.isArray(m.d)) meine = new Set(m.d.map((x) => String(x.id)));
  const raster = h('div', { class:'kurzus-racs' });
  const live = h('p', { 'aria-live':'polite', role:'status', tabindex:'-1' });
  const leerText = h('p', {}, t('k1_leer'));
  const leer = h('div', { hidden:true }, leerText, h('button', { class:'knopf', onclick:zuruecksetzen }, t('k1_reset')));
  const fehler = h('div', { hidden:true, role:'alert' });
  let laeuft = false, letzteSeite = 1, letzteAnfrage = false, weitere = false, wiederherstellen = true;
  const ids = new Set();
  const mehr = h('button', { class:'knopf', hidden:true, onclick:() => laden(true) }, t('k1_mehr'));
  function karte(k) {
    const hat = meine.has(String(k.id));
    return h('article', { class:'karte kurzus-kartya' }, titelbild(k), h('h2', {}, k.titel),
      DEMO ? h('span', { class:'plakette grau demo-plakette' }, t('k_demo_kurs')) : null,
      k.beschreibung ? h('p', { class:'szoveg' }, k.beschreibung) : null,
      hat ? h('span', { class:'plakette ok' }, t('k_megvasarolva')) : h('span', { class:'ar' }, arText(k)),
      hat ? h('a', { class: 'knopf gross gruen', href: '#/eloadas/' + k.id }, t('k_megnyitas')) : h('a', { class: 'knopf', href: '#/kurs/' + k.id }, t('k_megnezem')));
  }
  function anzeigen(d, anhaengen) {
    const fokusMehr = document.activeElement === mehr;
    if (!anhaengen) { raster.replaceChildren(); ids.clear(); }
    const neue = katalogNeue(einfach ? [...d.kurse].sort((a,b) => a.id - b.id) : d.kurse, ids);
    raster.append(...neue.map(karte));
    letzteSeite = d.seite;
    zustand.seite = letzteSeite;
    weitere = d.seite < d.seiten;
    live.textContent = einfach ? '' : anhaengen ? katalogStatus(neue.length, ids.size, d.gesamt, !weitere) : t(d.gesamt === 1 ? 'k1_anzahl_1' : 'k1_anzahl', { n:d.gesamt });
    leerText.textContent = einfach ? t('k_nincs_kurzus') : zustand.q ? t('k1_leer_suche', { q:katalogSuchtext(zustand.q) }) : t('k1_leer');
    leer.hidden = d.gesamt !== 0;
    for (const b of leer.querySelectorAll('button')) b.hidden = einfach;
    if (weitere) { mehr.hidden = false; if (!mehr.isConnected) raster.parentNode.append(mehr); }
    else { mehr.remove(); if (anhaengen) live.textContent = katalogStatus(neue.length, ids.size, d.gesamt, true); }
    if (fokusMehr) { if (weitere) mehr.focus(); else live.focus(); }
    speichern();
  }
  function speichern() {
    k1ShopZustand = { ...zustand, scroll:window.scrollY };
  }
  async function laden(anhaengen = false) {
    if (laeuft) return;
    laeuft = true; letzteAnfrage = anhaengen;
    werkzeuge.setAttribute('aria-busy', 'true');
    for (const el of werkzeuge.querySelectorAll('input,select,button')) el.disabled = true;
    mehr.setAttribute('aria-disabled', 'true'); fehler.hidden = true; live.textContent = t('k1_laden');
    zustand.seite = anhaengen ? letzteSeite + 1 : 1;
    const r = await api('GET', '/api/kurse?' + baueKatalogQuery(zustand));
    if (location.hash !== hashBeginn || !raster.isConnected) return;
    laeuft = false; mehr.removeAttribute('aria-disabled'); werkzeuge.removeAttribute('aria-busy');
    for (const el of werkzeuge.querySelectorAll('input,select,button')) el.disabled = false;
    if (!r.ok) {
      live.textContent = '';
      fehler.replaceChildren(h('p', {}, katalogFehler(r)), h('button', { class:'knopf', onclick:() => laden(letzteAnfrage) }, t('k1_retry')));
      fehler.hidden = false; return;
    }
    anzeigen(r.d, anhaengen);
  }
  function aendern(key, value) {
    zustand[key] = value;
    if (key === 'kategorie' && chips) chips.replaceChildren(k3Chips(value).children[0]);
    void laden();
  }
  function zuruecksetzen() {
    zustand = { seite:1, ...(k3Aktiv ? {kategorie:String(k3Aktiv.id)} : {}) }; suche.value = '';
    for (const select of werkzeuge.querySelectorAll('select')) select.selectedIndex = 0;
    if (k3Aktiv) werkzeuge.querySelectorAll('select')[0].value = String(k3Aktiv.id);
    if (chips) chips.replaceChildren(k3Chips(k3Aktiv ? String(k3Aktiv.id) : '').children[0]);
    for (const b of preisGruppe.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.preis === 'alle'));
    void laden().then(() => suche.focus());
  }
  const suche = h('input', { type:'search', maxlength:'100', value:zustand.q || '' });
  const preisGruppe = h('div', { class:'k1-preis', role:'group', 'aria-label':t('k1_preis') }, ['alle','gratis','bezahlt'].map(preis => {
    const b = h('button', { class:'knopf ghost', type:'button', 'aria-pressed':String((zustand.preis || 'alle') === preis), onclick:() => {
      for (const el of preisGruppe.querySelectorAll('button')) el.setAttribute('aria-pressed', String(el === b));
      aendern('preis', preis);
    } }, t('k1_' + preis));
    b.dataset.preis = preis; return b;
  }));
  const werkzeuge = h('form', { class:'k1-werkzeuge', hidden:einfach, onsubmit:e => {
    e.preventDefault(); suche.value = [...suche.value.trim()].slice(0,100).join(''); aendern('q', suche.value);
  } }, h('label', { class:'k1-feld' }, h('span', {}, t('k1_suche')), suche),
    h('button', { class:'knopf', type:'submit' }, t('k1_suchen')),
    h('button', { class:'knopf ghost', type:'button', onclick:() => { suche.value = ''; aendern('q',''); } }, t('k1_suche_reset')),
    kat.ok ? katalogAuswahl(t('k1_kategorie'), [['',t('k1_kategorien_alle')], ...kategorien.map(c => [String(c.id), c.name + ' (' + c.anzahl + ')'])], zustand.kategorie, v => k3Aktiv ? gehe(v ? 'kategorie/' + v : '') : aendern('kategorie',v)) : null,
    preisGruppe, katalogAuswahl(t('k1_sort'), ['neu','preis_auf','preis_ab','name'].map(v => [v,t('k1_' + v)]), zustand.sort || 'neu', v => aendern('sort',v)));
  const beispiele = h('section',{class:'szakasz s2-beispiele',hidden:true});
  const demo = await demoBox();
  if (location.hash !== hashBeginn) return;
  const chips = k3Chips(k3Aktiv ? String(k3Aktiv.id) : String(zustand.kategorie || ''));
  zeigen(k3Aktiv ? k3Breadcrumb(k3Aktiv) : hero(t('k_oldal_cim'), t('k_hero_alkim'), true, false, true), chips, demo, verkaufPausiert ? verkaufHinweis() : null,
    h('section', { class:'szakasz' }, werkzeuge, live, fehler, raster, leer, mehr), beispiele);
  anzeigen(basis.d, false);
  void beispieleLaden(beispiele, leer, basis.d.gesamt === 0);
  if (!einfach && (zustand.q || zustand.kategorie || zustand.preis || zustand.sort)) await laden();
  for (let seite = 2; !einfach && seite <= wiederSeiten && weitere && location.hash === hashBeginn; seite++) {
    await laden(true); if (fehler.hidden === false) break;
  }
  if (location.hash !== hashBeginn || !raster.isConnected) return;
  wiederherstellen = false;
  if (wiederScroll) window.scrollTo(0, wiederScroll);
  const scrollSpeichern = () => { if (!wiederherstellen && raster.isConnected && location.hash === hashBeginn) speichern(); };
  window.addEventListener('scroll', scrollSpeichern, { passive:true });
  window.addEventListener('hashchange', () => window.removeEventListener('scroll', scrollSpeichern), { once:true });
}

// ---- Kursseite: Lektionen (nur Titel) und Kaufen ---------------------------------------------------------------
function lektionenListe(lektionen, zugang = false, kursId = null) {
  if (lektionen.length === 0) return h('p', { class: 'klein' }, t('k_nincs_lecke'));
  const gruppen = [];
  for (const l of lektionen) {
    const abschnitt = l.abschnitt || '';
    const gruppe = gruppen[gruppen.length - 1];
    if (!gruppe || gruppe.abschnitt !== abschnitt) gruppen.push({ abschnitt, lektionen: [l] });
    else gruppe.lektionen.push(l);
  }
  let nummer = 0;
  return h('div', { class: 'lektions-gruppen' }, gruppen.map(g => [
    g.abschnitt ? h('h3', {}, g.abschnitt) : null,
    h('ol', { class: 'liste kurs-lektionen-liste' }, g.lektionen.map(l => {
      nummer++;
      const inhalt = [
        h('span', { class: 'lektion-nummer', 'aria-hidden': 'true' }, String(nummer).padStart(2, '0')),
        h('span', { class: 'lektion-titel' }, l.titel),
        h('span', { class: 'plakette' }, t(zugang ? 'k_szabad' : 'k_gesperrt')),
      ];
      return h('li', { class: zugang && kursId ? 'lektion-eintrag waehlbar' : 'lektion-eintrag gesperrt' },
        zugang && kursId
          ? h('a', { class: 'lektions-link', href: '#/lecke/' + kursId + '/' + l.id }, inhalt)
          : h('div', { class: 'lektions-inhalt' }, inhalt));
    }))
  ]));
}

async function kurs(id) {
  betoltes();
  await verkaufLaden();
  const r = await api('GET', '/api/kurse/' + id);
  if (!r.ok) return fehlerAnsicht(fehlerText(r), h('a', { class: 'knopf hell', href: '#/' }, t('k_vissza')));
  const k = r.d;
  let bezahlenLaeuft = false;   // Doppelklick: nur EINE Kaufanfrage gleichzeitig
  async function bezahlen(modell) {
    if (bezahlenLaeuft) return;
    bezahlenLaeuft = true;
    try { return await bezahlenAusfuehren(modell); } finally { bezahlenLaeuft = false; }
  }
  async function bezahlenAusfuehren(modell) {
    if (k.zugang) return gehe('eloadas/' + k.id);
    if(verkaufPausiert&&!(modell==='einmal'&&k.preis_cent===0))return meldung(t('verkauf_hinweis'),'rot');
    if (!ich.angemeldet) return belepesre('kurs/' + k.id);
    if (ich.email_bestaetigt === false && ich.email_bestaetigung_pflicht) {
      if (k.preis_cent === 0) gratisMailHinweis(); else meldung(t('k_email_hinweis'),'rot');
      return;
    }
    const v = await api('POST', '/api/kurse/' + k.id + '/kaufen', { modell, ...((modell==='einmal'&&k.preis_cent>0)||modell==='abo'?{zustimmung:zustimmInput.checked}:{}) });
    if (v.ok && typeof v.d.url === 'string' && v.d.url.startsWith(STRIPE_ELOTAG)) {
      meldung(t('k_atiranyitas'));
      return location.assign(v.d.url);
    }
    if (v.ok && v.d.code === 'kostenloser_kurs') { uzenetKesobb(v.d.text); return gehe('eloadas/' + k.id); }
    // Laeuft fuer diesen Kurs noch ein Abo: auf der Seite bleiben und den Text in Rot zeigen (die Weiterleitung unten wuerde die Meldung loeschen).
    if (v.status === 409 && (v.d?.fehler === 'abo_laeuft_bereits' || v.d?.fehler === 'zahlung_wird_verarbeitet')) return meldung(fehlerText(v), 'rot');
    if (v.status === 409) { uzenetKesobb(v.d.text); return gehe('eloadas/' + k.id); }
    if (v.status === 401) { await ichLaden(); return belepesre('kurs/' + k.id); }
    if (v.status === 403 && v.d?.fehler === 'email_unbestaetigt' && k.preis_cent === 0) return gratisMailHinweis();
    meldung(fehlerText(v), 'rot');
  }
  function gratisMailHinweis() {
    meldung(t('k1_gratis_mail'),'rot');
    if (document.querySelector('.email-hinweis')) return;
    meldungsfeld.replaceChildren(h('div', { class:'gratis-mail-hinweis' },
      h('span', {}, t('k1_gratis_mail')), h('button', { class:'knopf ghost', type:'button', onclick:async e => {
      e.currentTarget.disabled = true;
      const r = await api('POST','/api/email-bestaetigung-erneut',{});
      meldung(r.ok ? t('k_email_erneut_ok') : katalogFehler(r), r.ok ? 'ok' : 'rot');
    } }, t('k1_mail_erneut'))));
  }
  const zustimmInput=h('input',{type:'checkbox'});
  // Die Zustimmung gilt fuer den Einmalkauf UND das Abo (beide Knoepfe erst nach dem Haekchen aktiv).
  const zustimmPflicht=(k.preis_cent>0||k.abo_preis_cent!=null)&&!k.zugang;
  const zustimmBox=zustimmPflicht?h('label',{class:'feld ellallas-zustimmung'},zustimmInput,h('span',{},t('k_ellallas_zustimmung'))):null;
  // P2 (18.11.2026): sichtbarer Hinweis, solange der Kaufen-Knopf wegen fehlendem Haekchen blass/deaktiviert ist.
  const zustimmHinweis=zustimmPflicht?h('p',{class:'klein zustimmung-hinweis',role:'status'},t('ellallas_zustimmung_pflicht')):null;
  const gomb = h('button', { class: 'knopf gross gruen', type: 'button',disabled:k.preis_cent>0&&!k.zugang,
    onclick: () => k.zugang ? gehe('eloadas/' + k.id) : bezahlen('einmal') },
    k.zugang ? t('k_megnyitas') : k.preis_cent === 0 ? t('k_ingyenes_gomb') : t('k_megvasarlom'));
  zustimmInput.addEventListener('change',()=>{gomb.disabled=k.preis_cent>0&&!zustimmInput.checked;if(aboGomb)aboGomb.disabled=!zustimmInput.checked;if(zustimmHinweis)zustimmHinweis.hidden=zustimmInput.checked;});
  const aboGomb = k.abo_preis_cent != null && !k.zugang
    ? h('button', { class: 'knopf gross ghost', type: 'button', disabled: true, onclick: () => bezahlen('abo') },
      t('k_abo_kaufen') + ' · ' + formatBetrag(k.abo_preis_cent, k.waehrung) +
      ' / ' + t(ABO_INTERVAL_TEXTE[k.abo_intervall] || 'k_abo_month')) : null;
  // Trailer zuerst im DOM. Mobil folgt direkt der Preis, erst danach die lange Beschreibung.
  // Desktop bleibt dieselbe Lesereihenfolge: Trailer, Beschreibung, Lernziele, Preis seitlich.
  zeigen(hero(k.titel, '', false, true),
    verkaufPausiert&&(k.zugang||k.preis_cent===0)?verkaufHinweis():null,
    h('section', { class: 'kurs-layout' },
      trailer(k),
      h('div', { class:'kurs-beschreibung' },
        k.hat_titelbild&&!k.hat_trailer ? titelbild(k) : null,
        k.beschreibung ? h('p', { class:'kurs-beschreibung-text' }, k.beschreibung) : null,
        anbieterBlock()),
      h('aside', { class: 'kurs-kauf-rechts' },
        h('div', { class:'preis-kasten' }, h('p', { class: 'ar' }, arText(k)),
          h('div',{class:'kaufbox-liste'},h('p',{class:'kaufbox-titel'},t('k_kaufbox_titel')),h('ul',{},(k.preis_cent === 0 && k.abo_preis_cent == null
            ? ['k_gratis_box_1','k_gratis_box_2','k_gratis_box_3']
            : ['k_kaufbox_1','k_kaufbox_2','k_kaufbox_3','k_kaufbox_4']).map(x=>h('li',{},t(x)))),DEMO&&k.preis_cent>0?h('p',{class:'klein kaufbox-demo'},t('k_kaufbox_demo')):null),
          verkaufPausiert&&!k.zugang&&k.preis_cent>0?verkaufHinweis():null,
          verkaufPausiert&&!k.zugang&&k.preis_cent>0?null:zustimmBox,
          verkaufPausiert&&!k.zugang&&k.preis_cent>0?null:zustimmHinweis,
          verkaufPausiert&&!k.zugang&&k.preis_cent>0?null:gomb,
          h('a',{class:'klein',href:'#/elallasi-tajekoztato'},t('k_mailrecht_seite_hinweis')),
          verkaufPausiert&&!k.zugang?null:aboGomb)),
      h('div', { class: 'kurs-lektionen' },
        lernziele(k),
        h('h2', {}, t('k_leckek')), lektionenListe(k.lektionen, k.zugang, k.id))));
}

// Vertrauensblock auf der Kursseite: Anbieter und Kontakt (aus der Anbieter-Konfiguration, nichts erfunden) und Demo-Hinweis.
function anbieterBlock(){
  const box=h('section',{class:'anbieter-block'});
  void api('GET','/api/anbieter').then(r=>{const a=r.ok&&r.d?.anbieter||{};if(!a.ANBIETER_NAME)return;
    box.replaceChildren(h('h3',{},t('k_anbieter_titel')),h('p',{},t('k_anbieter_text',{name:a.ANBIETER_NAME,mail:a.ANBIETER_EMAIL||''})),r.d?.demo?h('p',{class:'klein'},t('k_anbieter_demo')):'');}).catch(()=>{});
  return box;
}

// Öffentliche Informationsseite: reine DOM-Knoten.
async function elallasiTajekoztato(){
  betoltes();
  const r=await api('GET','/api/anbieter');
  const a=r.ok&&r.d?.anbieter||{};
  const zeilen=[['ANBIETER_NAME','mailrecht_name'],['ANBIETER_ANSCHRIFT','mailrecht_anschrift'],
    ['ANBIETER_TELEFON','mailrecht_telefon'],['ANBIETER_EMAIL','mailrecht_email'],
    ['ANBIETER_ADOSZAM','mailrecht_adoszam']]
    .filter(([key])=>a[key]).map(([key,label])=>h('p',{},t(label)+': '+a[key]));
  // Produktreife: fehlende Anbieterangaben zeigen im Normalbetrieb "Vom Betreiber noch nicht hinterlegt" statt Platzhaltern (Demo unveraendert "...").
  const demo=!!(r.ok&&r.d?.demo);
  const nh=t('recht_nicht_hinterlegt');
  const werte=[a.ANBIETER_NAME,a.ANBIETER_ANSCHRIFT,a.ANBIETER_EMAIL];
  const anbieter=!demo&&werte.every(v=>!v)?nh:werte.map(v=>v||(demo?'...':nh)).join(', ');
  const muster=t('mailrecht_muster',{anbieter,tanfolyam:'...',datum:'...',kunde:'...',adresse:'...'});
  const titel=t(demo?'mailrecht_ellallas_titel_demo':'mailrecht_ellallas_titel');
  zeigen(hero(titel),
    h('section',{class:'szakasz karte'},
      h('h2',{},titel),
      h('p',{},t('mailrecht_ellallas_frist')),
      h('p',{},t('mailrecht_ellallas_ausuebung')+' '+(a.ANBIETER_EMAIL||(demo?'':nh))),
      h('p',{},t('mailrecht_ellallas_folgen')),
      h('p',{},t('mailrecht_ellallas_zustimmung')),
      h('p',{},t('k_mailrecht_gyakorlas')),
      h('a',{class:'knopf',href:'#/fiokom'},t('k_elallas')),
      h('a',{class:'knopf ghost',href:ELALLAS_URL,target:'_blank',rel:'noopener noreferrer'},t('k_elallas'))),
    zeilen.length?h('section',{class:'szakasz karte'},h('h2',{},t('mailrecht_anbieter')),...zeilen)
      :demo?null:h('section',{class:'szakasz karte'},h('h2',{},t('mailrecht_anbieter')),h('p',{class:'nicht-hinterlegt'},nh)),
    h('section',{class:'szakasz karte'},h('h2',{},titel),
      h('p',{class:'mailrecht-muster'},muster)));
}

// ---- Anmeldung und Registrierung ---------------------------------------------------------------------------
function belepes(vissza) {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const jelszo = h('input', { type: 'password', name: 'passwort', autocomplete: 'current-password', required: true, minlength: '8' });
  const lepj = ERLAUBTES_ZIEL.test(vissza || '') ? vissza : '';
  const lokalFehler=h('div',{class:'meldung',role:'alert','aria-live':'assertive'});
  const kuldes = async () => {
    if (!email.reportValidity() || !jelszo.reportValidity()) return;
    jelszoZuruecksetzen();
    const r = await api('POST', '/api/anmelden', { email: email.value, passwort: jelszo.value });
    if (!r.ok) { lokalFehler.className='meldung rot'; lokalFehler.textContent=fehlerText(r); return; }
    lokalFehler.replaceChildren();lokalFehler.className='meldung';
    jelszo.value = '';
    await ichLaden();
    gehe(lepj);
  };
  const belep = h('button', { class: 'knopf gross', type: 'submit' }, t('k_belepes_gomb'));
  const urlap = h('form', { class: 'karte formular-kartya', onsubmit: (e) => { e.preventDefault(); kuldes(); } },
    h('h2', {}, t('k_belepes_cim')),
    lokalFehler,
    h('label', { class: 'feld' }, h('span', { class: 'beschriftung' }, t('k_email')), email),
    h('label', { class: 'feld' }, h('span', { class: 'beschriftung' }, t('k_jelszo')), jelszoMezo(jelszo)),
    belep,
    h('a', { class: 'knopf ghost', href: '#/passwort-vergessen' }, t('k_passwort_vergessen')),
    h('p', { class:'klein' }, t('k_nincs_fiok'), ' ', h('a', { href: '#/regisztracio' + (lepj ? '?vissza=' + lepj : '') }, t('k_regisztracio_gomb'))),
    h('p', { class:'klein' }, t('k_sitzung_limit_info')));
  zeigen(urlap);
  email.focus();
}

// Registrierung auf eigener Seite: Einwilligung (Teilnahmebedingungen und Datenschutz) ist Pflicht, Passwort einmal.
function regisztracio(vissza) {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, maxlength: '254' });
  const jelszo = h('input', { type: 'password', name: 'passwort', autocomplete: 'new-password', required: true, minlength: '8' });
  const lepj = ERLAUBTES_ZIEL.test(vissza || '') ? vissza : '';
  const alap = location.origin + '/jogi/';
  const hozzajarul = h('input', { type: 'checkbox', name: 'elfogad', required: true });
  hozzajarul.addEventListener('invalid', () => hozzajarul.setCustomValidity(t('k_elfogadas_kotelezo')));
  hozzajarul.addEventListener('change', () => hozzajarul.setCustomValidity(''));
  const lokalFehler = h('div', { class: 'meldung', role: 'alert', 'aria-live': 'assertive' });
  let fut = false;
  const kuldes = async () => {
    if (fut) return;
    if (!email.reportValidity() || !jelszo.reportValidity() || !hozzajarul.reportValidity()) return;
    fut = true;
    jelszoZuruecksetzen();
    // F-98: echter Zustand des Hakens; der Server lehnt alles ausser boolean true ab (zustimmung_noetig).
    const r = await api('POST', '/api/registrieren', { email: email.value, passwort: jelszo.value, zustimmung: hozzajarul.checked === true });
    if (!r.ok) {
      fut = false;
      lokalFehler.className = 'meldung rot';
      if (r.status === 409) { lokalFehler.replaceChildren(h('span', {}, fehlerText(r)), h('a', { class: 'knopf ghost', href: '#/passwort-vergessen' }, t('k_passwort_vergessen'))); lokalFehler.scrollIntoView({ block: 'nearest' }); }
      else lokalFehler.textContent = fehlerText(r);
      return;
    }
    lokalFehler.replaceChildren(); lokalFehler.className = 'meldung';
    jelszo.value = '';
    await ichLaden();
    uzenetKesobb(t('k_regisztralva'));
    gehe(lepj);
  };
  const urlap = h('form', { class: 'karte formular-kartya', onsubmit: (e) => { e.preventDefault(); kuldes(); } },
    h('h2', {}, t('k_regisztracio_cim')),
    lokalFehler,
    h('label', { class: 'feld' }, h('span', { class: 'beschriftung' }, t('k_email')), email),
    h('label', { class: 'feld' }, h('span', { class: 'beschriftung' }, t('k_jelszo')), jelszoMezo(jelszo), h('span', { class: 'hinweis' }, t('k_jelszo_seged'))),
    h('label', { class: 'feld ellallas-zustimmung' }, hozzajarul, h('span', {},
      t('k_elfogadom_1'), ' ', h('a', { href: alap + 'reszveteli-feltetelek/', target: '_blank', rel: 'noopener noreferrer' }, t('k_feltetelek')),
      ' ', t('k_elfogadom_2'), ' ', h('a', { href: alap + 'adatvedelem/', target: '_blank', rel: 'noopener noreferrer' }, t('k_adatvedelem')),
      )),
    h('button', { class: 'knopf gross', type: 'submit' }, t('k_regisztracio_gomb')),
    h('p', { class: 'klein' }, t('k_van_fiok'), ' ', h('a', { href: '#/belepes' + (lepj ? '?vissza=' + lepj : '') }, t('k_nav_belepes'))));
  zeigen(urlap);
  email.focus();
}

// Passwortseiten: Werte bleiben in Passwortfeldern, niemals im URL-Pfad.
function passwortVergessen() {
  const email = h('input', { type:'email', autocomplete:'email', required:true, maxlength:'254' });
  const senden = h('button', { class:'knopf gross', type:'submit' }, t('k_passwort_vergessen_gomb'));
  const formular = h('form', { class:'karte formular-kartya', onsubmit: async e => {
    e.preventDefault(); if (!email.reportValidity()) return;
    senden.disabled = true;
    const r = await api('POST','/api/passwort-vergessen',{email:email.value});
    senden.disabled = false;
    // Keine Aussage darüber, ob es das Konto gibt.
    meldung(r.d?.text || t('passwort_neutral'), (r.status === 0 || r.status === 429 || r.status >= 500) ? 'rot' : 'ok');   // Fehler nicht als gruene Erfolgsmeldung zeigen
  } }, h('h2',{},t('k_passwort_vergessen_cim')),
  h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_email')),email),
  senden,h('a',{class:'knopf ghost',href:'#/belepes'},t('k_vissza_belepeshez')));
  zeigen(formular); email.focus();
}
function passwortNeu(token) {
  const neu = h('input',{type:'password',autocomplete:'new-password',minlength:'8',maxlength:'200',required:true});
  const nochmal = h('input',{type:'password',autocomplete:'new-password',minlength:'8',maxlength:'200',required:true});
  const button = h('button',{class:'knopf gross',type:'submit'},t('k_passwort_uj_gomb'));
  const form = h('form',{class:'karte formular-kartya',onsubmit:async e=>{
    e.preventDefault();if(!neu.reportValidity()||!nochmal.reportValidity())return;
    if(neu.value!==nochmal.value)return meldung(t('k_passwort_nem_egyezik'),'rot');
    button.disabled=true;
    const r=await api('POST','/api/passwort-zuruecksetzen',{token,passwort:neu.value});
    neu.value='';nochmal.value='';button.disabled=false;
    if(!r.ok)return meldung(fehlerText(r),'rot');
    uzenetKesobb(r.d?.text||t('passwort_zurueck_ok'));
    ich = { angemeldet: false }; // Server hat alle bisherigen Sitzungen beendet.
    return gehe('belepes');
  }},h('h2',{},t('k_passwort_uj_cim')),
  h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_passwort_uj')),jelszoMezo(neu),h('span',{class:'hinweis'},t('k_jelszo_seged'))),
  h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_passwort_uj_ismet')),jelszoMezo(nochmal)),
  button);
  zeigen(form);neu.focus();
}
function passwortAendern() {
  if(!ich.angemeldet)return belepesre('eloadasaim');
  const alt=h('input',{type:'password',autocomplete:'current-password',required:true});
  const neu=h('input',{type:'password',autocomplete:'new-password',minlength:'8',maxlength:'200',required:true});
  const nochmal=h('input',{type:'password',autocomplete:'new-password',minlength:'8',maxlength:'200',required:true});
  const button=h('button',{class:'knopf gross',type:'submit'},t('k_passwort_valtoztatas_gomb'));
  const form=h('form',{class:'karte formular-kartya',onsubmit:async e=>{
    e.preventDefault();
    if(!alt.reportValidity()||!neu.reportValidity()||!nochmal.reportValidity())return;
    if(neu.value!==nochmal.value)return meldung(t('k_passwort_nem_egyezik'),'rot');
    button.disabled=true;
    const r=await api('POST','/api/passwort-aendern',{aktuell:alt.value,neu:neu.value});
    alt.value='';neu.value='';nochmal.value='';button.disabled=false;
    meldung(r.ok?r.d.text:fehlerText(r),r.ok?'ok':'rot');
  }},h('h2',{},t('k_passwort_valtoztatas_cim')),
    h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_passwort_regi')),jelszoMezo(alt)),
    h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_passwort_uj')),jelszoMezo(neu),h('span',{class:'hinweis'},t('k_jelszo_seged'))),
    h('label',{class:'feld'},h('span',{class:'beschriftung'},t('k_passwort_uj_ismet')),jelszoMezo(nochmal)),
    button);
  zeigen(form);alt.focus();
}

// Scheibe 18: Konto-Seite; nur DOM-Knoten, keine HTML-Strings.
const datumBudapest=ms=>new Date(ms).toLocaleDateString(LOC,{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit'});
async function aboKuendigen(id){
  const r=await api('POST','/api/abo/lemondas',{abo_id:id});
  if(!r.ok)return meldung(fehlerText(r),'rot');
  try{const u=new URL(r.d.url);if(u.protocol==='https:'&&u.hostname==='billing.stripe.com')location.assign(u.href);
  else meldung(t('abo_lemondas_fehler'),'rot');}
  catch{meldung(t('abo_lemondas_fehler'),'rot');}
}
async function fiokom() {
  if(!ich.angemeldet)return belepesre('fiokom');
  betoltes();
  const r=await api('GET','/api/konto');
  if(r.status===401){await ichLaden();return belepesre('fiokom');}
  if(!r.ok)return fehlerAnsicht(fehlerText(r));
  const d=r.d.daten, eintraege=r.d.bestellungen||[];
  if(new URLSearchParams(location.hash.split('?')[1]||'').get('abo')==='lemondva'){
    history.replaceState(null,'',location.pathname+location.search+'#/fiokom');
    meldung(t('k_abo_lemondva_ok'));
  }
  const form=h('div',{class:'karte konto-form'},
    h('p',{},t('k_fiokom_email')+': '+d.email));
  // Teil 2 (12.11.2026): fehlgeschlagene oder von Hand ohne Erstattung abgeschlossene Erstattung zuerst (Server-Feld), nie "Erstattet".
  const status=b=>b.erstattung_fehlgeschlagen===true?t('k_erstattung_fehlgeschlagen')
    :b.status==='erstattet'||b.grund==='erstattung_voll'?t('k_fiokom_erstattet')
    :b.abo_status==='gekuendigt'||b.endet_zum_periodenende?t('k_fiokom_gekuendigt')
    :t(b.status==='bezahlt'?'k_fiokom_bezahlt':'k_fiokom_pruefen');
  async function ellallasStart(b){
    const schritt1=h('div',{class:'karte'},h('h2',{},t('k_elallas')),h('p',{},b.kurs||''),
      h('p',{},formatBetrag(b.betrag,b.waehrung)),h('p',{},new Date(b.erstellt).toLocaleString(LOC,{timeZone:'Europe/Budapest'})),
      h('p',{},t('ellallas_magyarazat')),
      h('button',{class:'knopf',type:'button',onclick:()=>{
        const schritt2=h('div',{class:'karte'},h('h2',{},t('k_ellallas_megerosites')),h('p',{},t('ellallas_erklaerung')),
          h('button',{class:'knopf',type:'button',onclick:async()=>{
            const r=await api('POST','/api/bestellungen/'+b.id+'/ellallas',{bestaetigt:true});
            meldung(r.d?.text||fehlerText(r),r.ok?'ok':'rot');
            fokusNachRoute=true;await fiokom();
          }},t('k_ellallas_megerosites')));
        zeigenMitFokus(schritt2);
      }},t('k_ellallas_tovabb')));
    zeigenMitFokus(schritt1);
  }
  const menge=eintraege.map(b=>h('article',{class:'karte konto-bestellung'},
    h('h3',{},t('k_fiokom_rendeles')+': '+b.id),
    h('p',{},t('k_fiokom_datum')+': '+new Date(b.erstellt).toLocaleString(LOC,{timeZone:'Europe/Budapest'})),
    h('p',{},t('k_fiokom_kurs')+': '+(b.kurs||'')),
    h('p',{},t('k_fiokom_betrag')+': '+formatBetrag(b.betrag,b.waehrung)),
    h('p',{},t('k_fiokom_art')+': '+t(b.art==='abo'?'k_fiokom_abo':'k_fiokom_einmal')),
    h('p',{},t('k_fiokom_status')+': '+status(b)),
    b.kurs_id&&b.status==='bezahlt'?h('a',{class:'knopf klein',href:'#/eloadas/'+b.kurs_id},t('k_megnyitas')):null,
    b.status==='bezahlt'&&!b.ellallas_ergebnis&&b.grund!=='erstattung_voll'&&b.betrag>0?h('a',{class:'knopf klein ghost',href:'/api/bestellungen/'+b.id+'/beleg',target:'_blank',rel:'noopener noreferrer'},t('k_fiokom_beleg')):null,
    b.ellallas_ergebnis?h('p',{class:'abo-lemondva'},b.ellallas_ergebnis==='erstattung'||b.ellallas_ergebnis==='bearbeitung'?t('k_ellallas_rogzitve'):t('ellallas_'+b.ellallas_ergebnis)) :b.status==='bezahlt'&&b.grund!=='erstattung_voll'&&b.betrag>0?h('button',{class:'knopf klein',type:'button',onclick:()=>ellallasStart(b)},t('k_elallas')):null,
    b.art==='abo'&&b.abo_status==='gekuendigt'?h('p',{class:'abo-lemondva'},t('k_abo_lemondva_ende',{datum:b.abo_ende?datumBudapest(b.abo_ende):t('a_ismeretlen')})):null,
    b.art==='abo'&&['aktiv','zahlung_offen'].includes(b.abo_status)&&!b.endet_zum_periodenende?h('button',{class:'knopf abo-lemondas',type:'button',onclick:()=>aboKuendigen(b.abo_id)},t('k_abo_lemondas')):null,
    b.art==='abo'?h('button',{class:'knopf ghost klein',type:'button',onclick:aboPortal},t('k_abo_portal')):null));
  const herunterladen=async()=>{
    const antwort=await fetch('/api/konto/auskunft');
    if(!antwort.ok){meldung(t('k_halozati_hiba'),'rot');return;}
    const datei=await antwort.blob(),url=URL.createObjectURL(datei);
    const a=h('a',{href:url,download:(T._plattform_slug||'plattform')+'-adataim.json'});
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const emailNeu=h('input',{type:'email',required:true,maxlength:'254',autocomplete:'email'});
  const emailPass=h('input',{type:'password',required:true,autocomplete:'current-password'});
  const emailForm=h('form',{class:'karte konto-form',onsubmit:async e=>{
    e.preventDefault();const v=await api('POST','/api/konto/email-aendern',{email:emailNeu.value,passwort:emailPass.value});
    emailPass.value='';meldung(v.ok?v.d.text:fehlerText(v),v.ok?'ok':'rot');
  }},h('label',{class:'feld'},h('span',{},t('k_fiokom_email_neu')),emailNeu),
  h('label',{class:'feld'},h('span',{},t('k_fiokom_passwort')),jelszoMezo(emailPass)),
  h('button',{class:'knopf',type:'submit'},t('k_fiokom_email_senden')));
  const loeschPass=h('input',{type:'password',required:true,autocomplete:'current-password'});
  const loeschForm=h('form',{class:'karte konto-form',onsubmit:async e=>{
    e.preventDefault();
    if(!window.confirm(t('k_fiokom_loeschen_frage')))return;
    const r=await api('POST','/api/konto/loeschen',{passwort:loeschPass.value,bestaetigt:true});
    loeschPass.value='';
    if(!r.ok)return meldung(fehlerText(r),'rot');
    ich={angemeldet:false};uzenetKesobb(r.d.text);gehe('belepes');
  }},h('p',{},t('k_fiokom_loeschen_hinweis')),
    h('label',{class:'feld'},h('span',{},t('k_fiokom_passwort')),jelszoMezo(loeschPass)),
    h('button',{class:'knopf rot',type:'submit'},t('k_fiokom_loeschen_gomb')));
  zeigen(hero(t('k_fiokom_cim')),
    h('section',{class:'szakasz'},h('h2',{},t('k_fiokom_adatok')),form),
    h('section',{class:'szakasz'},h('h2',{},t('k_fiokom_rendelesek')),
      menge.length?menge:h('p',{},t('k_fiokom_leer'))),
    h('section',{class:'szakasz'},
      h('a',{class:'knopf ghost',href:'#/passwort-aendern'},t('k_passwort_valtoztatas'))),
    h('section',{class:'szakasz'},h('h2',{},t('k_fiokom_auskunft')),
      h('p',{},t('k_fiokom_auskunft_hinweis')),
      h('button',{class:'knopf',type:'button',onclick:herunterladen},t('k_fiokom_herunterladen'))),
    h('section',{class:'szakasz'},h('h2',{},t('k_fiokom_email_aendern')),emailForm),
    h('section',{class:'szakasz'},h('h2',{},t('k_fiokom_loeschen')),loeschForm));
}
async function emailAendernBestaetigen(token) {
  history.replaceState(null,'',location.pathname+location.search+'#/fiokom');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))
    return fehlerAnsicht(t('konto_token_ungueltig'));
  const r=await api('POST','/api/email-aendern-bestaetigen',{token});
  await ichLaden();
  zeigen(h('section',{class:'szakasz'},h('h1',{},t('k_fiokom_email_bestaetigen')),
    h('p',{class:r.ok?'meldung ok':'meldung rot'},r.ok?t('konto_email_fertig'):fehlerText(r))));
}
// ---- Meine Kurse, Kurs mit Zugang, Lektion ----------------------------------------------------------------------------
async function aboPortal() {
  const r = await api('POST','/api/abo/portal',{});
  if (!r.ok) return meldung(fehlerText(r),'rot');
  if (typeof r.d.url === 'string' && r.d.url.startsWith('https://billing.stripe.com/')) location.assign(r.d.url);
  else meldung(t('k_abo_portal_fehler'),'rot');
}
async function sajatEloadasok() {
  if (!ich.angemeldet) return belepesre('eloadasaim');
  betoltes();
  const r = await api('GET', '/api/meine-kurse');
  if (r.status === 401) { await ichLaden(); return belepesre('eloadasaim'); }
  if (!r.ok) return fehlerAnsicht(fehlerText(r));
  zeigen(h('section', { class: 'szakasz' }, h('h1', {}, t('k_kurzusaim_cim')),
    h('button', { class: 'knopf ghost', type: 'button', onclick: aboPortal }, t('k_abo_portal')),
    h('a', { class: 'knopf ghost', href: '#/passwort-aendern' }, t('k_passwort_valtoztatas'))),
    r.d.length === 0 ? h('p', { class: 'karte' }, t('k_nincs_sajat')) :
      h('div', { class: 'kurzus-racs' }, r.d.map((k) => h('article', { class: 'karte kurzus-kartya' },
        h('h2', {}, k.titel), k.beschreibung ? h('p', { class: 'szoveg' }, k.beschreibung) : null,
        k.abo_status && { aktiv:'k_status_aktiv',gekuendigt:'k_status_gekuendigt',zahlung_offen:'k_status_zahlung_offen',beendet:'k_status_beendet' }[k.abo_status]
          ? h('span', { class: k.abo_status === 'zahlung_offen' ? 'plakette offen' : 'plakette ok' },
              t({ aktiv:'k_status_aktiv',gekuendigt:'k_status_gekuendigt',zahlung_offen:'k_status_zahlung_offen',beendet:'k_status_beendet' }[k.abo_status])) : null,
        h('span', { class: 'plakette ok' }, t('k_hozzaferes_aktiv')),
        k.abo_status==='aktiv'?h('a',{href:'#/fiokom',class:'abo-link'},t('k_abo_lemondas')):null,
        h('a', { class: 'knopf', href: '#/eloadas/' + k.id }, t('k_megnyitas'))))));
}

async function tanfolyam(id) {
  if (!ich.angemeldet) return belepesre('eloadas/' + id);
  betoltes();
  const r = await api('GET', '/api/kurse/' + id);
  if (!r.ok) return fehlerAnsicht(fehlerText(r), h('a', { class: 'knopf hell', href: '#/eloadasaim' }, t('k_vissza')));
  if (!r.d.zugang) return gehe('kurs/' + id);                       // ohne Zugang gibt es nur die Kursseite
  const elemek = [];
  let letzter = null;
  for (const l of r.d.lektionen) {
    if (l.abschnitt && l.abschnitt !== letzter) { elemek.push(h('h3', {}, l.abschnitt)); letzter = l.abschnitt; }
    elemek.push(h('div', { class: 'karte zeile lecke-kartya' }, h('span', {}, h('strong', {}, l.titel), ' ', h('span', { class: 'klein' }, t(KURS_ART_TEXTE[l.art] || 'k_art_text'))),
      h('a', { class: 'knopf klein', href: '#/lecke/' + r.d.id + '/' + l.id }, t('k_megnyitas'))));
  }
  zeigen(h('section', { class: 'tananyag-fej' }, h('h1', {}, r.d.titel)), r.d.lektionen.length ? elemek : h('p', { class: 'karte' }, t('k_nincs_lecke')),
    h('a', { class: 'knopf hell', href: '#/eloadasaim' }, t('k_vissza')));
}

// Keine direkte Datei-Adresse im sichtbaren Link. Ticket wird pro Sitzung/Lektion
// erneuert. Falls ein Medium nach 6 Stunden noch läuft, Stellung/Abspielzustand erhalten.
let wiedergabeAufraeumen = null;
function schutzAbschalten() { if (wiedergabeAufraeumen) wiedergabeAufraeumen(); wiedergabeAufraeumen = null; }
// Benannte Anzeigeparameter: dezenter, aber weiterhin personenbezogen und bewegt.
const WASSERZEICHEN_POSITIONEN = Object.freeze([[12,14],[57,20],[31,62],[62,72],[18,42]]);
const WASSERZEICHEN_WECHSEL_MS = 9000;
const PDF_WASSERZEICHEN = Object.freeze({
  deckkraft: 0.12, schriftPx: 13, abstandX: 470, abstandY: 360, maxBreite: 340,
  randPx: 1.1, drehung: -Math.PI / 6,
});
function wasserzeichen(email) {
  const zeichen = h('div', { class:'wasserzeichen', 'aria-hidden':'true' }, email);
  let stelle = 0;
  const positionen = WASSERZEICHEN_POSITIONEN;
  function bewegen() {
    const [x,y] = positionen[stelle++ % positionen.length];
    zeichen.style.left = x + '%'; zeichen.style.top = y + '%';
  }
  bewegen();
  const uhr = setInterval(bewegen, WASSERZEICHEN_WECHSEL_MS);
  return { element: zeichen, stop: () => clearInterval(uhr) };
}
// PDF-Canvas statt eingebautem Browser-Betrachter. Die Seitenadresse wird
// ausschließlich an pdf.js übergeben und nie als sichtbarer DOM-Link eingesetzt.
async function pdfCanvasAnsicht(l, url, email, meldenAufraeumen) {
  const ansicht = h('section', { class: 'pdf-leser', role: 'region', 'aria-label': t('k_pdf_olvasas') });
  const seiten = h('div', { class: 'pdf-seiten' });
  const zaehler = h('span', { class: 'pdf-zaehler', 'aria-live': 'polite' }, t('k_pdf_laden'));
  const zurueck = h('button', { class: 'knopf klein hell', type: 'button',
    'aria-label': t('k_pdf_zurueck'), title: t('k_pdf_zurueck') }, '\u2039');
  const vor = h('button', { class: 'knopf klein hell', type: 'button',
    'aria-label': t('k_pdf_weiter'), title: t('k_pdf_weiter') }, '\u203a');
  const kleiner = h('button', { class: 'knopf klein hell', type: 'button',
    'aria-label': t('k_pdf_kleiner'), title: t('k_pdf_kleiner') }, '\u2212');
  const groesser = h('button', { class: 'knopf klein hell', type: 'button',
    'aria-label': t('k_pdf_groesser'), title: t('k_pdf_groesser') }, '+');
  const leiste = h('nav', { class: 'pdf-werkzeuge', 'aria-label': t('k_pdf_werkzeuge') },
    zurueck, zaehler, vor, kleiner, groesser);
  ansicht.append(leiste, seiten);
  let pdf = null, auftrag = null, aktiv = true, seiteAktuell = 1, zoom = 1;
  let startZeitgeber = null;
  let generation = 0;
  let seitenElemente = [];
  function aktualisieren() {
    const gesamt = pdf?.numPages || 0;
    zaehler.textContent = gesamt
      ? t('k_pdf_seitenstand').replace('{seite}', String(seiteAktuell)).replace('{gesamt}', String(gesamt))
      : t('k_pdf_laden');
    zurueck.disabled = !gesamt || seiteAktuell <= 1;
    vor.disabled = !gesamt || seiteAktuell >= gesamt;
    kleiner.disabled = zoom <= 0.75;
    groesser.disabled = zoom >= 2;
  }
  function wasserzeichenAufLeinwand(ctx, breite, hoehe) {
    // Sichtbar INS Canvas gezeichnet, nicht nur ein entfernbares DOM-Overlay.
    ctx.save();
    ctx.globalAlpha = PDF_WASSERZEICHEN.deckkraft;
    ctx.font = '600 ' + PDF_WASSERZEICHEN.schriftPx + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = PDF_WASSERZEICHEN.randPx;
    ctx.lineJoin = 'round';
    ctx.translate(breite / 2, hoehe / 2);
    ctx.rotate(PDF_WASSERZEICHEN.drehung);
    const diagonal = Math.hypot(breite, hoehe);
    for (let x = -diagonal; x <= diagonal; x += PDF_WASSERZEICHEN.abstandX) {
      for (let y = -diagonal; y <= diagonal; y += PDF_WASSERZEICHEN.abstandY) {
        ctx.strokeStyle = '#ffffff'; // dünner heller Rand für dunkle PDF-Seiten
        ctx.strokeText(email, x, y, PDF_WASSERZEICHEN.maxBreite);
        ctx.fillStyle = '#211a0e'; // dunkle Schrift für helle PDF-Seiten
        ctx.fillText(email, x, y, PDF_WASSERZEICHEN.maxBreite);
      }
    }
    ctx.restore();
  }
  async function alleSeitenZeichnen() {
    if (!aktiv || !pdf) return;
    const aufruf = ++generation;
    seiten.replaceChildren();
    seitenElemente = [];
    for (let nummer = 1; nummer <= pdf.numPages; nummer++) {
      if (!aktiv || aufruf !== generation) return;
      const box = h('div', { class: 'pdf-seite', oncontextmenu: e => e.preventDefault() });
      const canvas = h('canvas', { class: 'pdf-leinwand', 'aria-label':
        t('k_pdf_seitenstand').replace('{seite}', String(nummer)).replace('{gesamt}', String(pdf.numPages)) });
      box.append(canvas);
      seiten.append(box);
      seitenElemente.push(box);
      try {
        const seite = await pdf.getPage(nummer);
        if (!aktiv || aufruf !== generation) return;
        const basis = seite.getViewport({ scale: 1 });
        const breite = Math.max(1, Math.min(seiten.clientWidth || 720, 900));
        const scale = zoom * breite / basis.width;
        const viewport = seite.getViewport({ scale });
        const pixel = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.ceil(viewport.width * pixel);
        canvas.height = Math.ceil(viewport.height * pixel);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('canvas');
        auftrag = seite.render({
          canvasContext: ctx, viewport,
          transform: pixel === 1 ? null : [pixel, 0, 0, pixel, 0, 0],
        });
        await auftrag.promise;
        auftrag = null;
        if (!aktiv || aufruf !== generation) return;
        wasserzeichenAufLeinwand(ctx, canvas.width, canvas.height);
      } catch (e) {
        if (!aktiv || aufruf !== generation) return;
        zaehler.textContent = t('k_pdf_fehler');
        throw e;
      }
    }
    aktualisieren();
  }
  function blaettern(delta) {
    if (!pdf) return;
    seiteAktuell = Math.max(1, Math.min(pdf.numPages, seiteAktuell + delta));
    seitenElemente[seiteAktuell - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    aktualisieren();
  }
  zurueck.addEventListener('click', () => blaettern(-1));
  vor.addEventListener('click', () => blaettern(1));
  async function zoomSetzen(delta) {
    const neu = Math.round((zoom + delta) * 100) / 100;
    if (neu < 0.75 || neu > 2) return;
    zoom = neu;
    aktualisieren();
    auftrag?.cancel();
    try {
      await alleSeitenZeichnen();
      seitenElemente[seiteAktuell - 1]?.scrollIntoView({ block: 'start' });
    } catch {
      if (aktiv) zaehler.textContent = t('k_pdf_fehler');
    }
  }
  kleiner.addEventListener('click', () => zoomSetzen(-0.25));
  groesser.addEventListener('click', () => zoomSetzen(0.25));

  // Kein globales Druckverbot für andere Seiten; nur solange das PDF angezeigt wird.
  const druckVerhindern = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', druckVerhindern, true);
  const urspruenglichDrucken = window.print;
  try { window.print = () => {}; } catch {}
  const cleanup = () => {
    aktiv = false;
    generation++;
    if (startZeitgeber !== null) clearTimeout(startZeitgeber);
    document.removeEventListener('keydown', druckVerhindern, true);
    try { window.print = urspruenglichDrucken; } catch {}
    try { auftrag?.cancel(); } catch {}
    try { pdf?.destroy(); } catch {}
    seiten.replaceChildren();
  };
  meldenAufraeumen(cleanup);
  aktualisieren();
  async function laden(adresse) {
    if (!aktiv) return;
    try {
      const pdfjs = await import('/vendor/pdfjs/pdf.min.mjs');
      if (!aktiv) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      // Standard: Worker von gleicher Herkunft. Keine fremden Server oder Blob-URL.
      const neuAuftrag = pdfjs.getDocument({ url: adresse, withCredentials: true, isEvalSupported: false });
      const dokument = await neuAuftrag.promise;
      if (!aktiv) { await dokument.destroy(); return; }
      if (pdf) await pdf.destroy();
      pdf = dokument;
      seiteAktuell = Math.min(seiteAktuell, pdf.numPages);
      await alleSeitenZeichnen();
    } catch (e) {
      if (!aktiv) return;
      seiten.replaceChildren(h('p', { class: 'meldung rot' }, t('k_pdf_fehler')));
      zaehler.textContent = t('k_pdf_fehler');
    }
  }
  // Erst nach dem Einfügen in die Seite laden, damit die Breite bekannt ist.
  startZeitgeber = setTimeout(() => { void laden(url); }, 0);
  return { element: ansicht, erneuern: laden, stop: cleanup };
}
// Video bei Bunny Stream: Der Server hat den Zugang schon geprueft und einen signierten Einbett-Link geschickt (docs/BUNNY-STREAM-PLAN.md Schritt 5).
// Attribute laut Bunny-Doku (stream/embedding): allow, referrerpolicy strict-origin-when-cross-origin (unsere Seite sendet sonst keinen Referrer,
// und Bunny wuerde den Aufruf als "direkt" blockieren). Bild-im-Bild ist bewusst NICHT erlaubt. VOLLBILD IST SEIT 04.11.2026 ERLAUBT (Edmunds
// Entscheidung fuer die Testphase): im Vollbild laeuft nur der Rahmen, das Wasserzeichen (E-Mail-Adresse) ist dann NICHT mehr zu sehen; es soll spaeter
// in den Player selbst verlegt werden (Checkliste GL-13). Rueckweg: 'fullscreen' aus allow entfernen.
// Link-Pruefung (rein): nur der Bunny-Player-Host, ohne Benutzername/Passwort und ohne eigenen Port, nur Pfad /embed/.
const BUNNY_PLAYER_HOST = 'player.mediadelivery.net';
function bunnyAdresse(text) {
  try {
    const u = new URL(String(text || ''));
    if (u.protocol === 'https:' && u.hostname === BUNNY_PLAYER_HOST && u.port === '' && !u.username && !u.password && u.pathname.startsWith('/embed/')) return u.href;
  } catch { /* keine gueltige Adresse */ }
  return null;
}
function bunnyAnsicht(l, antwort) {
  const adresse = bunnyAdresse(antwort.einbett_url);
  if (!adresse) return [h('p', { class:'meldung rot' }, t('k_lejatszas_hiba'))];
  const wasser = wasserzeichen(antwort.email);
  const rahmen = h('div', { class:'schutz-rahmen' });
  const player = h('iframe', { class:'bunny-player', src:adresse, title:l.titel,
    allow:'autoplay; encrypted-media; fullscreen', referrerpolicy:'strict-origin-when-cross-origin' });
  rahmen.append(player, wasser.element);
  wiedergabeAufraeumen = () => { wasser.stop(); player.removeAttribute('src'); };
  return [rahmen, h('p', { class:'klein' }, t('k_schutz_hinweis'))];
}
async function geschuetzteAnsicht(l) {
  const ticketAntwort = await api('POST', '/api/lektionen/' + l.id + '/wiedergabe', {});
  if (!ticketAntwort.ok) return [h('p', { class:'meldung rot' }, fehlerText(ticketAntwort))];
  if (ticketAntwort.d.art === 'bunny') return bunnyAnsicht(l, ticketAntwort.d);
  let ticket = ticketAntwort.d.ticket, ablauf = ticketAntwort.d.ablauf;
  const adresse = () => '/api/lektionen/' + l.id + '/datei?ticket=' + encodeURIComponent(ticket);
  const wasser = l.art === 'pdf' ? null : wasserzeichen(ticketAntwort.d.email);
  const rahmen = h('div', { class: l.art === 'pdf' ? 'schutz-rahmen pdf-rahmen' : 'schutz-rahmen', oncontextmenu: e => e.preventDefault() });
  let medium, pdfAnsicht = null, pdfCleanup = null;
  let aktiv = true, arbeitet = false;
  if (l.art === 'video' || l.art === 'audio') {
    medium = h(l.art, { class:'medium', controls:true, playsinline:true, controlsList:'nodownload noplaybackrate nofullscreen',
      disablePictureInPicture:true, preload:'metadata', src:adresse() });
    medium.controlsList?.add('nodownload','noplaybackrate','nofullscreen');
    medium.disablePictureInPicture = true;
    medium.addEventListener('error', () => meldung(t('k_lejatszas_hiba'), 'rot'));
    rahmen.append(medium, wasser.element);
  } else if (l.art === 'pdf') {
    pdfAnsicht = await pdfCanvasAnsicht(l, adresse(), ticketAntwort.d.email, fn => { pdfCleanup = fn; });
    medium = pdfAnsicht.element;
    rahmen.append(medium);
  } else {
    return [h('p', { class:'karte' }, t('k_datei_nur_pdf'))];
  }
  async function erneuern() {
    if (!aktiv || arbeitet || Date.now() < ablauf - 45 * 60 * 1000) return;
    arbeitet = true;
    try {
      const neu = await api('POST','/api/lektionen/'+l.id+'/wiedergabe',{});
      if (!aktiv) return;
      if (!neu.ok) {
        meldung(fehlerText(neu),'rot');
        if (pdfCleanup) pdfCleanup();
        if (medium && l.art !== 'pdf') medium.removeAttribute('src');
        return;
      }
      ticket = neu.d.ticket; ablauf = neu.d.ablauf;
      if (l.art === 'video' || l.art === 'audio') {
        const sekunden = medium.currentTime, pause = medium.paused;
        medium.src = adresse();
        medium.addEventListener('loadedmetadata', () => {
          if (Number.isFinite(sekunden) && sekunden > 0) {
            try { medium.currentTime = sekunden; } catch {}
          }
          if (!pause) medium.play().catch(() => {});
        }, { once:true });
      } else {
        // Neue Sitzungsberechtigung auch bei sehr lange geöffneten PDFs verwenden.
        await pdfAnsicht.erneuern(adresse());
      }
    } finally { arbeitet = false; }
  }
  const uhr = setInterval(erneuern, 60 * 1000);
  document.addEventListener('visibilitychange', erneuern);
  if (l.art === 'video' || l.art === 'audio') medium.addEventListener('play', erneuern);
  wiedergabeAufraeumen = () => {
    aktiv = false;
    clearInterval(uhr);
    document.removeEventListener('visibilitychange', erneuern);
    if (medium) medium.removeEventListener('play', erneuern);
    wasser?.stop();
    pdfCleanup?.();
    if (l.art !== 'pdf' && medium) medium.removeAttribute('src');
  };
  return [rahmen, h('p', { class:'klein' }, t('k_schutz_hinweis'))];
}

async function lecke(kursId, leckeId) {
  if (!ich.angemeldet) return belepesre('eloadas/' + kursId);
  betoltes();
  // Nur die Lektionsseite fragt den Text der Lektion an (?lektion=); das zaehlt als erster Zugriff (Widerruf).
  const r = await api('GET', '/api/kurse/' + kursId + '?lektion=' + encodeURIComponent(leckeId));
  if (!r.ok || !r.d.zugang) return gehe('kurs/' + kursId);
  const l = r.d.lektionen.find((x) => String(x.id) === String(leckeId));
  if (!l) return gehe('eloadas/' + kursId);
  const text = l.inhalt ? h('p', { class: 'szoveg' }, l.inhalt) : null;
  const datei = (l.dateien || [])[0];
  let torzs;
  // Block 3: Download-Produkt (vom Server als download markiert). Keine Ansicht im Browser, nur der Knopf; der Server prueft Anmeldung und Zugang bei jedem Abruf
  // und liefert die Fassung in der Sprache der Bestellung. Alle anderen Lektionen bleiben reine Ansicht.
  if (l.download) torzs = [text, h('p', {}, h('a', { class: 'knopf gross', href: '/api/kurse/' + encodeURIComponent(kursId) + '/lektionen/' + encodeURIComponent(l.id) + '/download', download: '' }, t('k_pdf_herunterladen'))),
    h('p', { class: 'klein' }, t('k_download_hinweis'))];
  else if (l.art === 'text') torzs = text || h('p', { class: 'klein' }, t('k_nincs_szoveg'));
  else if (l.art === 'datei') torzs = [h('p', { class:'karte' }, t('k_datei_nur_pdf')), text];
  else if (!datei) torzs = [text, h('p', { class:'karte' }, t('k_fajl_hamarosan'))];
  else torzs = [await geschuetzteAnsicht(l), text];
  const index = r.d.lektionen.findIndex(x => x.id === l.id);
  const navigacio = h('nav', { class: 'lecke-linkek', 'aria-label': t('k_lecke_navigacio') },
    index > 0 ? h('a', { class: 'knopf ghost', href: '#/lecke/' + kursId + '/' + r.d.lektionen[index-1].id }, t('k_elozo_lecke')) : null,
    index >= 0 && index < r.d.lektionen.length - 1 ?
      h('a', { class: 'knopf ghost', href: '#/lecke/' + kursId + '/' + r.d.lektionen[index+1].id }, t('k_kovetkezo_lecke')) : null);
  zeigen(h('section', { class: 'lecke-nezet' + (l.art === 'video' || l.art === 'audio' || l.art === 'pdf' ? ' media-tartalom' : '') },
    l.abschnitt ? h('p', { class: 'klein' }, l.abschnitt) : null,
    h('h1', {}, l.titel), torzs),
    navigacio,
    h('a', { class: 'knopf ghost', href: '#/eloadas/' + kursId }, t('k_vissza')));
}

// ---- Rückkehr von Stripe: ?kauf=erfolg oder ?kauf=abgebrochen --------------------------------------------------------------
// Der Zugang entsteht erst, wenn Stripe dem Server per Webhook die Zahlung bestätigt. Deshalb fragen wir einige Sekunden nach.
async function vasarlasVisszateres(allapot, kursId) {
  if (allapot === 'abgebrochen') {
    return zeigen(h('article', { class: 'karte allapot-kartya' }, h('h2', {}, t('k_megszakitva_cim')), h('p', {}, t('k_megszakitva')),
      h('a', { class: 'knopf', href: kursId ? '#/kurs/' + kursId : '#/' }, kursId ? t('k_vissza_kurzushoz') : t('k_vissza'))));
  }
  if (!ich.angemeldet) return belepesre('eloadasaim');
  const allapotSor = h('p', {}, t('k_ellenorizzuk'));
  const hely = h('div', {});
  zeigen(h('article', { class: 'karte allapot-kartya' }, h('h2', {}, t('k_koszonjuk_cim')), allapotSor, hely));
  for (let i = 0; i < FIZETES_ELLENORZES_DB; i++) {
    const r = await api('GET', '/api/meine-kurse');
    if (r.status === 401) return belepesre('eloadasaim');
    const talalt = r.ok && r.d.find((k) => !kursId || String(k.id) === String(kursId));
    if (talalt) {
      allapotSor.textContent = t('k_fizetes_ok');
      return hely.replaceChildren(h('a', { class: 'knopf gross gruen', href: '#/eloadas/' + talalt.id }, t('k_megnyitas')),
        h('a', { class: 'knopf hell', href: '#/' }, t('k_tovabbi_eloadasok')));   // zweiter Knopf: weitere Kurse ansehen
    }
    await new Promise((x) => setTimeout(x, FIZETES_ELLENORZES_MS));
  }
  allapotSor.textContent = t('k_ellenorizzuk_nyugodt');
  hely.replaceChildren(h('a', { class: 'knopf', href: '#/eloadasaim' }, t('k_nav_kurzusaim')),
    h('a', { class: 'knopf hell', href: '#/' }, t('k_tovabbi_eloadasok')));
}

async function emailBestaetigen(token) {
  // Fragment sofort entfernen, noch vor dem Netzwerkaufruf.
  history.replaceState(null,'',location.pathname+location.search+'#/');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))
    return fehlerAnsicht(t('bestaetigung_link_ungueltig'));
  betoltes();
  const r=await api('POST','/api/email-bestaetigen',{token});
  if(r.ok)await ichLaden();
  zeigen(h('section',{class:'karte'},
    h('h2',{},r.ok?t('k_email_erfolg_titel'):t('k_email_fehler_titel')),
    h('p',{class:r.ok?'meldung ok':'meldung rot',role:'status'},r.ok?t('bestaetigung_erfolg'):fehlerText(r)),
    h('a',{class:'knopf',href:'#/'},t('k_vissza'))));
}

// ---- Weiche ---------------------------------------------------------------------------------------------------------
async function route() {
  fokusNachRoute = !ersteRoute; ersteRoute = false;
  schutzAbschalten();
  if (ujUzenet) { meldung(ujUzenet.text, ujUzenet.art); ujUzenet = null; } else meldung('');
  const hashPfad = /^#\/kategorien?(?:[/?#]|$)/.test(location.hash) ? location.hash.split('#').slice(0,2).join('#') : location.hash;
  const [pfad, lekerdezes = ''] = hashPfad.replace(/^#\/?/, '').split('?');
  const reszek = pfad.split('/');
  const vissza = new URLSearchParams(lekerdezes).get('vissza');
  switch (reszek[0]) {
    case 'elallasi-tajekoztato': return elallasiTajekoztato();
    case 'beispiel': return idErlaubt(reszek[1]) ? beispielSeite(reszek[1]) : fehlerAnsicht(t('s2_nicht_gefunden'),h('a',{class:'knopf ghost',href:'#/'},t('s2_zurueck')));
    case 'kurs': if (ich.angemeldet) await ichLaden(); return idErlaubt(reszek[1]) ? kurs(reszek[1]) : eloadasok();
    case 'kategorie': window.scrollTo(0,0); return k3Kategorie(reszek.length === 2 ? reszek[1] : '');
    case 'kategorien': window.scrollTo(0,0); return k3Uebersicht();
    case 'belepes': return belepes(vissza);
    case 'regisztracio': return regisztracio(vissza);
    case 'passwort-vergessen': return passwortVergessen();
    case 'passwort-neu': return /^[A-Za-z0-9_-]{43}$/.test(reszek[1] || '') ? passwortNeu(reszek[1]) : fehlerAnsicht(t('passwort_link_ungueltig'));
    case 'megerosites': return emailBestaetigen(reszek[1]);
    case 'passwort-aendern': return passwortAendern();
    case 'eloadasaim': case 'kurzusaim': return sajatEloadasok();   // kurzusaim/tanfolyam: alte Adressen (schon verschickte Links) laufen weiter
    case 'fiokom': return fiokom();
    case 'email-aendern': return emailAendernBestaetigen(reszek[1]);
    case 'eloadas': case 'tanfolyam': return idErlaubt(reszek[1]) ? tanfolyam(reszek[1]) : sajatEloadasok();
    case 'lecke': return idErlaubt(reszek[1]) && idErlaubt(reszek[2]) ? lecke(reszek[1], reszek[2]) : sajatEloadasok();
    default: return eloadasok();
  }
}

let LOC = 'de-DE';
// ---- Los geht's ---------------------------------------------------------------------------------------------------------
try {
  const r = await fetch('/api/texte');
  if (!r.ok) throw new Error('texte');
  T = await r.json();
  if (!T.k_oldal_cim) throw new Error('texte');
} catch (e) { throw new Error('texts not loaded; the fixed notice in index.html stays'); }
LOC = T._locale || LOC; document.documentElement.lang = T._sprache || 'de';
document.title = (T._titel_praefix || '') + t('k_oldal_cim');
{ const an = await api('GET', '/api/anbieter'); DEMO = !!(an.ok && an.d?.demo); }
await ichLaden();
// Andere Shop-Seiten warten nicht auf die Kategorien; nur deren Navigation wird ergänzt.
void k3Laden().then(() => {
  const alt = app.querySelector('header.kopf');
  const fokus = document.activeElement;
  const ziele = alt ? [...alt.querySelectorAll('a,button,summary,select')] : [];
  const index = ziele.indexOf(fokus);
  const neu = kopfzeile();
  k3Schliessen();
  alt?.replaceWith(neu);
  if (index >= 0) {
    const kandidaten = [...neu.querySelectorAll('a,button,summary,select')];
    const href = fokus.getAttribute('href');
    (href ? kandidaten.find(el => el.getAttribute('href') === href) : kandidaten[index])?.focus();
  }
  app.querySelector('footer.fuss')?.replaceWith(fusszeile());
});
document.addEventListener('click', k3Schliessen);
window.addEventListener('hashchange', () => k3Schliessen());
window.addEventListener('hashchange', route);
// F-308: Rueckkehr in einen schon offenen Tab (z. B. nach E-Mail-Bestaetigung in einem ANDEREN Tab) laedt sonst
// den veralteten Anmeldestatus von vor dem Tab-Wechsel weiter. Beim Sichtbarwerden einmal neu abfragen und neu zeichnen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && ich.angemeldet) void ichLaden().then(route);
});
// Ein Link auf die Adresse, auf der man schon steht (zum Beispiel VISSZA nach der Mailbestaetigung oder ELŐADÁSOK auf '#/'), loest kein hashchange aus:
// dann bauen wir die Seite selbst neu auf. Normale Klicks mit Sondertasten (neuer Tab) bleiben unberuehrt.
document.addEventListener('click', (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  // Nur Shop und Menue (nicht Anmeldung, Passwort, Lektionen): dort gaengen sonst Eingaben oder ein laufendes Video verloren.
  if (a.getAttribute('href') === location.hash && /^#\/(eloadasaim|fiokom)?$/.test(location.hash)) { e.preventDefault(); route(); }
});
const params = new URLSearchParams(location.search);
// B9: Links aus der Praesentation (?demo=kaeufer / ?demo=admin) starten den Demo-Zugang mit einem Klick (nur auf der Demo-Instanz).
const demoStart = params.get('demo');
if (['kaeufer', 'admin'].includes(demoStart) && !ich.angemeldet) {
  history.replaceState(null, '', location.pathname);
  const a = await api('GET', '/api/anbieter');
  if (a.ok && a.d?.demo) {
    const x = await api('POST', '/api/demo/zugang', { rolle: demoStart });
    if (x.ok && demoStart === 'admin') nachAdmin();
    else if (x.ok) await ichLaden();
  }
}
const kauf = params.get('kauf');
if (kauf === 'erfolg' || kauf === 'abgebrochen') {
  const kursParam = params.get('kurs');
  history.replaceState(null, '', location.pathname);               // Adresse aufräumen (kein erneutes Abspielen beim Neuladen)
  await vasarlasVisszateres(kauf, idErlaubt(kursParam) ? kursParam : null);
} else {
  await route();
}
