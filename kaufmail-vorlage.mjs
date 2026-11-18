// Reine gemeinsame Kaufmail-Vorlage: kein Versand und kein Datenbankzugriff.
import { formatGeld } from './betrag.mjs';
import { plattformName, setzePlattform } from './marke.mjs';
import { HU, sprache, locale } from './texte.mjs';
import { titelUebersetzt } from './demo-uebersetzung.mjs';
import { anbieterZeilen, widerrufsZeilen, rechtLinks, rechtMap, ellallasTitel } from './mail-recht.mjs';
const htmlEscape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const geldText = (cent, waehrung) => formatGeld(cent, waehrung, sprache());
// Nur die vorhandene technische Adresse behalten; Anzeigenamen bei jedem Versand neu bilden.
export function baueAbsender(mailFromRoh, plattformName, ueberschreibName) {
  const roh = String(mailFromRoh ?? '').trim();
  if (/[\r\n]/.test(roh)) return '';
  const treffer = roh.match(/^[^<>]*<([^<>]+)>$/);
  const adresse = (treffer ? treffer[1] : roh).trim();
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(adresse)) return '';
  const roh2 = String(String(ueberschreibName ?? '').trim() ? ueberschreibName : plattformName ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff<>"\\]/g, '').replace(/\s+/g, ' ').trim();
  const name = Array.from(roh2).slice(0, 60).join('').trim();
  return name ? '"' + name + '" <' + adresse + '>' : adresse;
}
export function rendereMailKopf(name, logo = '') {
  const bild = logo ? '<img src="' + htmlEscape(logo) + '" alt="' + htmlEscape(name) + '" width="64" style="display:block;margin-bottom:8px;height:auto">' : '';
  return '<p style="margin:0 0 16px">' + bild + '<strong>' + htmlEscape(name) + '</strong></p>';
}
export function rendereKaufmail(e, { base, supportMail = '', demoModus = false, anbieter = {}, name = plattformName(), logo = '', anhang = null } = {}) {
    const ELALLAS_URL = rechtMap(base).ellallas;
    const gratis=e.gratis===true;
    const abo=e.typ==='abo';
    const kurs=String(titelUebersetzt(e.titel)||'');
    const betrag=Number.isSafeInteger(e.betrag)&&e.betrag>=0?geldText(e.betrag,e.waehrung):HU.mail_kauf_unbekannt;
    const zeit=new Date(e.erstellt).toLocaleString(locale(),{
      timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false,
    });
    const z=[
      HU.mail_kauf_ueberschrift, HU.mail_kauf_sziasztok, gratis?HU.mail_kauf_gratis_aktiv:HU.mail_kauf_aktiv, HU.mail_kauf_zusammenfassung,
      HU.mail_kauf_kurs+': '+kurs,
      gratis?HU.mail_kauf_gratis:HU.mail_kauf_betrag+': '+betrag,
      HU.mail_kauf_datum+': '+zeit,
      (gratis?HU.mail_kauf_gratis_nummer:HU.mail_kauf_nummer)+': '+String(e.bestellung_id),
    ];
    if(!gratis)z.push(HU.mail_kauf_zahlungsart+': '+HU.mail_kauf_stripe);
    z.push(HU.mailrecht_teljes_ar+': '+betrag);
    const akt=anbieter;
    if(akt.STEUER_HINWEIS)z.push(akt.STEUER_HINWEIS);
    z.push(...anbieterZeilen(akt));
    if(!gratis&&!abo&&e.zustimmung_zeit)z.push(HU.k_ellallas_zustimmung,HU.ellallas_zustimmung_zeit+': '+new Date(e.zustimmung_zeit).toLocaleString(locale(),{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}));
    if(abo){
      z.push(HU.mail_kauf_abo+': '+betrag+' / '+(e.abo_intervall==='year'?HU.mail_kauf_jahr:HU.mail_kauf_monat));
      z.push(HU.mail_kauf_abo_portal, e.abo_intervall==='year'?HU.mailrecht_abo_jahr:HU.mailrecht_abo_monat);
    }
    const ziel=base+'/#/eloadasaim';
    const belegZiel=base+'/#/fiokom';
    z.push(ziel);
    if(!gratis)z.push(HU.mail_kauf_beleg_text,HU.mail_kauf_beleg_knopf+'\n'+belegZiel,HU.mail_kauf_elallas+'\n'+ELALLAS_URL);
    z.push(...widerrufsZeilen({anbieter:akt,kurs,datum:zeit,kunde:e.rechnung_name||'...',adresse:[e.rechnung_plz,e.rechnung_ort,e.rechnung_strasse].filter(Boolean).join(' ')||'...',zustimmung:!abo&&!!e.zustimmung_zeit,demo:!!demoModus}),...rechtLinks(base,!!demoModus));
    z.push(HU.mail_kauf_hinweise,
      '- '+HU.mail_kauf_info_kurse,
      '- '+HU.mail_kauf_info_schutz);
    if(supportMail)z.push('- '+HU.mail_kauf_info_support.replace('{email}',supportMail));
    z.push(HU.mail_kauf_danke,HU.mail_kauf_signatur);
    z.push(HU.mail_systemhinweis);
    const text=z.map(v=>v===ziel?HU.mail_kauf_oeffnen+'\n'+ziel:v).join('\n');
    const abschnitte=z.filter(v=>v!==HU.mail_kauf_ueberschrift).map(v=>rechtLinks(base,!!demoModus).includes(v)
      ? '<p><a href="'+htmlEscape(v.split('\n')[1])+'" style="color:#a87c2a">'+htmlEscape(v.split('\n')[0])+'</a></p>'
      : v.startsWith(HU.mailrecht_muster.split('\n')[0])
      ? '<p style="white-space:pre-line;line-height:1.7">'+htmlEscape(v)+'</p>'
      : v===ellallasTitel(!!demoModus) || v===HU.mailrecht_anbieter
      ? '<h2 style="font-size:20px;color:#a87c2a">'+htmlEscape(v)+'</h2>'
      : v.startsWith(HU.mail_kauf_elallas+'\n')
      ? '<p style="margin:0 0 12px"><a href="'+htmlEscape(ELALLAS_URL)+'" style="color:#a87c2a">'+htmlEscape(HU.mail_kauf_elallas)+'</a></p>'
      : v.startsWith(HU.mail_kauf_beleg_knopf+'\n')
      ? '<p style="margin:14px 0 22px"><a href="'+htmlEscape(belegZiel)+'" style="display:inline-block;border:1px solid #d4a843;color:#a87c2a;border-radius:40px;padding:12px 22px;text-decoration:none;font-weight:600">'+htmlEscape(HU.mail_kauf_beleg_knopf)+'</a></p>'
      : v===ziel
      ? '<p style="margin:22px 0"><a href="'+htmlEscape(ziel)+'" style="display:inline-block;background:#d4a843;color:#000;border-radius:40px;padding:14px 24px;text-decoration:none;font-weight:600">'+htmlEscape(HU.mail_kauf_oeffnen)+'</a></p>'
      : v===HU.mail_kauf_zusammenfassung || v===HU.mail_kauf_hinweise
        ? '<h2 style="font-size:20px;color:#a87c2a;margin:24px 0 12px">'+htmlEscape(v)+'</h2>'
        : v.startsWith('- ')
          ? '<p style="margin:4px 0 4px 20px;line-height:1.7">• '+htmlEscape(v.slice(2))+'</p>'
          : '<p style="margin:0 0 12px;line-height:1.7">'+htmlEscape(v)+'</p>').join('');
    const subject=(gratis?HU.mail_kauf_betreff_gratis:HU.mail_kauf_betreff_neu).replace('{tanfolyam}',kurs)
      .replace(/[\r\n]/g,' ').slice(0,240);
    const htmlKopf = rendereMailKopf(name, logo);
    const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif">'+
      '<main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9;border-radius:18px">'+
      htmlKopf+'<h1 style="font-size:28px;color:#a87c2a">'+htmlEscape(HU.mail_kauf_ueberschrift)+'</h1>'+
      abschnitte+'</main></body></html>';
    return {to:e.email,subject,html,text,anhaenge:anhang?[anhang]:[]};
  }

// Ausschliesslich synchron rendern: kein await zwischen Setzen und Wiederherstellen.
export function mitVorschauName(name, rendern) {
  const vorher = plattformName();
  try {
    setzePlattform(name);
    return rendern();
  } finally {
    setzePlattform(vorher);
  }
}
