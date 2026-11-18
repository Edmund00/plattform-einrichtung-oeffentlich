import { rendereKaufmail, rendereMailKopf, baueAbsender } from './kaufmail-vorlage.mjs';
import {formatGeld,formatGeldEinheiten} from './betrag.mjs';
// Resend ohne zusätzliche Pakete. Keine Geheimnisse in Logs oder Antworten.
import { lstatSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { plattformName } from './marke.mjs';
import { LOGO_MAX_BYTES } from './logo-png.mjs';
import { transaktion } from './db.mjs';
import { db } from './db.mjs';
import { HU, sprache, locale, spracheSetzen } from './texte.mjs';
import { titelUebersetzt } from './demo-uebersetzung.mjs';
// Backlog b (12.11.2026): Betraege in Mails immer in der Sprache des Jobs (spracheSetzen: Bestell-/Kontosprache, Betreibermails Standardsprache).
const geldText=(cent,waehrung)=>formatGeld(cent,waehrung,sprache());
import {anbieterZeilen,rechtLinks,widerrufsZeilen,rechtMap,ellallasTitel} from './mail-recht.mjs';
import { mailAnbieter } from './anbieter.mjs';
// Gesetzliche Widerrufsfunktion der Hauptseite (45/2014 Korm. rendelet, seit 19.06.2026), mit Bestätigungsmail samt Datum/Uhrzeit.

const htmlEscape = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const datum = () => Date.now();
let fehlendeKonfigurationGemeldet = false;
const RESEND_URL = 'https://api.resend.com/emails';

// A8-02 (12.11.2026): gemeinsamer Backoff fuer alle acht Mail-Warteschlangen. Vorher versuchte jeder Anstoss (Webhook, Aktion, Timer)
// alle offenen Jobs sofort neu; nach fuenf schnellen Fehlversuchen (Sekunden) war die Mail endgueltig 'fehler', ohne Alarm.
// Jetzt: Versuch n setzt naechster_versuch = jetzt + MAIL_WARTE_MINUTEN[n-1]; vorher wird der Job nicht angefasst.
// Nach MAIL_MAX_VERSUCHE Fehlversuchen: 'fehler' plus Alarm an den Betreiber (Alarmdienst drosselt auf eine Mail je 6 Stunden).
// Der letzte Wert (240) ist die Schutzfrist fuer den fuenften Versuch: stuerzt der Prozess waehrend des Versands ab, wird der Job
// danach als 'fehler' abgeschlossen statt still liegen zu bleiben (A8-06).
export const MAIL_MAX_VERSUCHE = 5;
export const MAIL_WARTE_MINUTEN = Object.freeze([1, 5, 15, 60, 240]);
export const MAIL_TABELLEN = Object.freeze(['mail_ausgang', 'email_ausgang', 'gratis_mail_ausgang', 'konto_mail_ausgang',
  'abo_kuendigung_mail', 'meldung_ausgang', 'ellallas_mail', 'abo_erstattung_mail', 'zugang_mail_ausgang']);   // Block 4: neunte Warteschlange
// SQL-Ausdruck fuer naechster_versuch im Claim-UPDATE (rechts steht noch der ALTE Wert von versuche); ein Parameter: jetzt.
const NAECHSTER_SQL = 'naechster_versuch=?+60000*(CASE versuche ' +
  MAIL_WARTE_MINUTEN.slice(0, -1).map((m, i) => 'WHEN ' + i + ' THEN ' + m).join(' ') +
  ' ELSE ' + MAIL_WARTE_MINUTEN[MAIL_WARTE_MINUTEN.length - 1] + ' END)';
const FAELLIG_SQL = 'COALESCE(naechster_versuch,0)<=?';
// A8-04 (12.11.2026): Demo-Bremse fuer Betreibermeldungen (nur DEMO_MODUS). Normale Demo-Kaeufe bleiben weit darunter.
export const DEMO_MELDUNG_JE_STUNDE = 60;
export const DEMO_MELDUNG_JE_TAG = 300;
const STUNDE_MS = 3600000, TAG_MS = 24 * STUNDE_MS;

export function resendMailer({ apiKey, from, fetchFn = fetch }) {
  if (!apiKey) return null;
  return async ({ to, subject, html, text, idempotencyKey, anhaenge }) => {
    let antwort;
    const absender = baueAbsender(from, plattformName(), db.prepare("SELECT wert FROM einstellungen WHERE schluessel='MAIL_ABSENDER_NAME'").get()?.wert);
    if (!absender) return false;
    const koerper = { from: absender, to: [to], subject, html, text };
    if (anhaenge && anhaenge.length > 0) {
      koerper.attachments = anhaenge.map(a => ({ filename: a.dateiname, content: a.inhaltBase64, content_type: a.typ, content_id: a.contentId }));
    }
    try {
      antwort = await fetchFn(RESEND_URL, {
        method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify(koerper), signal: AbortSignal.timeout(8000),
      });
    } catch {
      console.warn('Mailversand: Netzwerk- oder Zeitüberschreitungsfehler');
      return false;
    }
    if (!antwort.ok) {
      console.warn('Mailversand HTTP-Status:', antwort.status);
      return false;
    }
    return true;
  };
}
export async function mailTesten({ apiKey, from, to, ueberschreibName, idempotencyKey, resendUrl = RESEND_URL, fetchFn: fetchImpl = fetch } = {}) {
  from = baueAbsender(from, plattformName(), ueberschreibName);
  if (!from) return { fehler: 'kein_absender' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetchImpl(resendUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from, to, subject: 'Test', text: 'Test.' }),
      signal: controller.signal,
    });
    if (r.ok) return { ok: true };
    if (r.status === 401) return { fehler: 'schluessel_abgelehnt' };
    if (r.status === 403) return { fehler: 'absender_abgelehnt' };
    if (r.status === 400 || r.status === 422) return { fehler: 'eingabe_fehler' };
    if (r.status === 429) {
      const retryAfter = Number(r.headers.get('retry-after')) || null;
      return { fehler: 'limit_erreicht', retryAfter };
    }
    return { fehler: 'allgemein' };
  } catch (e) {
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return { fehler: 'timeout' };
    return { fehler: 'netzwerk_fehler' };
  } finally {
    clearTimeout(timer);
  }
}

export function mailDienst({ mailer, base, logoPfad = null, verkaufsmeldungMail = '', registrierungMeldung = true, supportMail = '', anbieter = {}, demoModus = false, alarm = null, jetzt = Date.now }) {
  const anbieterAktuell = () => mailAnbieter(anbieter);
  const RECHT_LINKS = rechtMap(base);
  // Backoff-Bausteine (A8-02). jetzt ist fuer Tests steuerbar; Zeitstempel (geaendert) bleiben bei datum().
  const ausgeschoepft = (tabelle, anzahl) => {
    if (!anzahl) return;
    console.error('Mail-Ausgang: ' + anzahl + ' Auftrag/Auftraege in ' + tabelle + ' nach ' + MAIL_MAX_VERSUCHE + ' Versuchen endgueltig fehlgeschlagen');
    if (typeof alarm === 'function') Promise.resolve().then(() => alarm('ausgang')).catch(() => console.warn('Mail-Alarm nicht zugestellt'));
  };
  // Aufraeumen vor jedem Lauf: Job mit allen Versuchen verbraucht, aber noch 'offen' (Absturz waehrend des letzten Versuchs, A8-06),
  // wird nach Ablauf der Schutzfrist 'fehler' und meldet Alarm. Laufende Versuche haben eine Frist in der Zukunft und bleiben unberuehrt.
  const haengendeAbschliessen = (tabelle, zusatz = '') => {
    try {
      const n = db.prepare("UPDATE " + tabelle + " SET status='fehler'" + zusatz + " WHERE status='offen' AND versuche>=" + MAIL_MAX_VERSUCHE + " AND " + FAELLIG_SQL)
        .run(jetzt()).changes;
      ausgeschoepft(tabelle, n);
    } catch { console.warn('Mail-Ausgang: Aufraeumen nicht moeglich'); }
  };
  const abschlussPruefen = (tabelle, id) => {
    if (db.prepare('SELECT status FROM ' + tabelle + ' WHERE id=?').get(id)?.status === 'fehler') ausgeschoepft(tabelle, 1);
  };
  const ELALLAS_URL = RECHT_LINKS.ellallas;
  // Das Logo ist optional: Jeder Fehler (fehlt, Verzeichnis, Symlink, keine PNG-Datei, zu gross, nicht lesbar) ergibt "kein Logo", nie einen Fehler beim Mailversand.
  function logoLesen(pfad) {
    if (!pfad) return null;
    try {
      const st = lstatSync(pfad);   // lstat folgt keinem Symlink am Ziel
      if (!st.isFile() || st.size < 8 || st.size > LOGO_MAX_BYTES) return null;
      const daten = readFileSync(pfad);
      // Laenge nach dem Lesen nochmals pruefen (Datei kann zwischen lstat und Lesen getauscht worden sein).
      return daten.length >= 8 && daten.length <= LOGO_MAX_BYTES && daten.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? daten : null;
    } catch { return null; }
  }
  function mailKopf() {
    const name = plattformName();
    const buf = logoLesen(logoPfad);
    const anhang = buf ? { dateiname: 'logo.png', inhaltBase64: buf.toString('base64'), typ: 'image/png', contentId: 'marke-logo' } : null;
    const htmlKopf = rendereMailKopf(name, buf ? 'cid:marke-logo' : '');
    return { htmlKopf, anhang };
  }
  if (!mailer && !fehlendeKonfigurationGemeldet) {
    fehlendeKonfigurationGemeldet = true;
    console.warn('Mailversand nicht konfiguriert');
  }
  const laufende = new Set();
  const emailLaufende = new Set();
  const meldungLaufende = new Set();
  const kontoLaufende = new Set();
  // Demo-Instanz (DEMO_MODUS=1): Die Datenbank liegt in /tmp und ist nach jedem Neustart leer, die Nummern der Mails beginnen wieder bei 1.
  // Resend lehnt wiederverwendete Idempotenz-Schluessel mit HTTP 409 ab, daher bekommt jeder Start der Demo eine eigene Kennung. Im Normalbetrieb bleibt sie stabil.
  const plattformId = createHash('sha256').update(base + (demoModus ? '|start-' + randomBytes(6).toString('hex') : '')).digest('hex').slice(0,16);

  function nachricht(typ, benutzer, zusatz = {}) {
    let subject, text;
    if (typ === 'reset') {
      subject = HU.mail_reset_betreff;
      text = HU.mail_reset_text + '\n' + zusatz.link + '\n' + HU.mail_reset_ablauf + '\n' + HU.mail_reset_ignorieren;
    } else if (typ === 'bestaetigung') {
      subject = HU.mail_bestaetigung_betreff;
      const zeilen = [
        HU.mail_bestaetigung_sziasztok, HU.mail_bestaetigung_willkommen,
        HU.mail_bestaetigung_warum, zusatz.link,
        HU.mail_bestaetigung_ablauf, HU.mail_bestaetigung_erwartet,
        '- '+HU.mail_bestaetigung_punkt1, '- '+HU.mail_bestaetigung_punkt2,
        '- '+HU.mail_bestaetigung_punkt3, HU.mail_bestaetigung_ignorieren,
        HU.mail_bestaetigung_gruss, HU.mail_bestaetigung_signatur,
      ];
      zeilen.push(...anbieterZeilen(anbieterAktuell()),HU.mailrecht_willkommen_links,...rechtLinks(base).slice(0,2));
      text = zeilen.join('\n');
    } else if (typ === 'geaendert') {
      subject = HU.mail_geaendert_betreff;
      text = HU.mail_geaendert_text + '\n' + HU.mail_geaendert_warnung;
    } else {
      subject = HU.mail_kauf_betreff;
      text = HU.mail_kauf_text.replace('{tanfolyam}', zusatz.kurs) + '\n' +
        base + '/#/eloadasaim';
    }
    text += '\n'+HU.mail_systemhinweis;
    const zeilen = text.split('\n');
    const rechtUrls = Object.values(RECHT_LINKS);
    const inhalt = zeilen.map((z, i) => rechtUrls.includes(zeilen[i + 1]) ? ''
      : rechtUrls.includes(z)
      ? '<p><a href="' + htmlEscape(z) + '" style="color:#a87c2a">' + htmlEscape(zeilen[i - 1]) + '</a></p>'
      : z.startsWith('https://') || z.startsWith('http://')
      ? '<p><a href="' + htmlEscape(z) + '" style="display:inline-block;background:#d4a843;color:#000;text-decoration:none;border-radius:40px;padding:14px 20px;font-weight:600">' + htmlEscape(typ === 'bestaetigung' ? HU.mail_bestaetigung_knopf : HU.mail_link_oeffnen) + '</a></p>'
      : z.startsWith('- ') && typ === 'bestaetigung'
        ? '<p style="margin:0 0 9px 16px;line-height:1.7">• ' + htmlEscape(z.slice(2)) + '</p>'
        : '<p style="margin:0 0 14px;line-height:1.7">' + htmlEscape(z) + '</p>').join('');
    const { htmlKopf, anhang } = mailKopf();
    const html = '<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:28px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif">' +
      '<main style="max-width:600px;margin:auto;padding:26px;border:1px solid #e7ddc9;background:#fff;border-radius:18px">' +
      htmlKopf + '<h1 style="color:#a87c2a;font-size:26px">' + htmlEscape(subject) + '</h1>' + inhalt +
      '</main></body></html>';
    return { to: benutzer.email, subject, html, text, anhaenge: anhang ? [anhang] : [] };
  }

  // Mailinhalt allein aus der bereits gespeicherten Bestellung, nie aus Browser- oder Stripe-Links.
  function kaufNachricht(e) {
    const { anhang } = mailKopf();
    return rendereKaufmail(e, { base, supportMail, demoModus, anbieter: anbieterAktuell(), name: plattformName(), logo: anhang ? 'cid:marke-logo' : '', anhang });
  }
  function versandStarten(typ, benutzer, zusatz) {
    if (!mailer) return;
    // Nie die Antwort der API bzw. des Stripe-Webhooks auf das Netzwerk warten lassen.
    queueMicrotask(() => {
      Promise.resolve().then(() => mailer(nachricht(typ, benutzer, zusatz)))
        .catch(() => console.warn('Mailversand: Fehler'));
    });
  }
  async function ausgangSenden() {
    if (!mailer) return;
    haengendeAbschliessen('mail_ausgang');
    const eintraege = db.prepare(
      "SELECT m.id,m.typ,m.benutzer_id,m.bestellung_id,b.email,COALESCE(best.sprache,b.sprache) AS sprache,k.titel,best.betrag,best.waehrung,best.erstellt,k.abo_intervall,b.rechnung_name,b.rechnung_strasse,b.rechnung_plz,b.rechnung_ort,(SELECT z.zeit FROM kauf_zustimmung z WHERE z.stripe_sitzung=best.stripe_sitzung) AS zustimmung_zeit FROM mail_ausgang m " +
      "JOIN benutzer b ON b.id=m.benutzer_id JOIN bestellungen best ON best.id=m.bestellung_id " +
      "JOIN kurse k ON k.id=best.kurs_id " +
      "WHERE m.status='offen' AND m.versuche<5 AND COALESCE(m.naechster_versuch,0)<=? ORDER BY m.id LIMIT 20"
    ).all(jetzt());
    for (const e of eintraege) {
      if (laufende.has(e.id)) continue;
      laufende.add(e.id);
      spracheSetzen(e.sprache);   // Sprache der Bestellung (gespeichert), nicht die des Timers
      try {
        // Sofort vor der Sendung zählen; nach einem Neustart ist der Versuch nachvollziehbar.
        const r = db.prepare(
          "UPDATE mail_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+",geaendert=? WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL
        ).run(jetzt(),datum(),e.id,jetzt());
        if (!r.changes) continue;
        let ok = false;
        try { ok = await mailer({ ...kaufNachricht(e),
          idempotencyKey: 'schulung-' + plattformId + '-' + e.id }); }
        catch { console.warn('Mailversand: Fehler'); }
        db.prepare(
          "UPDATE mail_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,geaendert=? WHERE id=?"
        ).run(ok ? 1 : 0,datum(),e.id);
        if (!ok) abschlussPruefen('mail_ausgang', e.id);
      } catch {
        console.warn('Mail-Ausgang konnte nicht verarbeitet werden');
      } finally { laufende.delete(e.id); }
    }
  }
  // Der Klartext-Einmalcode liegt ausschliesslich bis zum Versand im Speicher.
  // Persistente Wiederholungen erhalten jeweils einen NEUEN Zufallscode;
  // alte Links werden atomar ungueltig. Nie Token im DB-Ausgang speichern.
  function emailVormerken(benutzerId) {
    const now = datum();
    db.prepare("INSERT INTO email_ausgang(benutzer_id,status,versuche,erstellt,geaendert) VALUES(?,'offen',0,?,?) ON CONFLICT(benutzer_id) DO UPDATE SET status='offen',versuche=0,naechster_versuch=NULL,geaendert=excluded.geaendert,generation=generation+1")
      .run(benutzerId,now,now);
  }
  function emailTokenNeu(benutzerId) {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const now = datum();
    transaktion(() => {
      db.prepare('UPDATE email_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(now,benutzerId);
      db.prepare('INSERT INTO email_token(benutzer_id,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?)')
        .run(benutzerId,hash,now,now+24*60*60*1000);
      emailVormerken(benutzerId);
    });
    return token;
  }
  async function emailAusgangSenden() {
    if (!mailer) return;
    haengendeAbschliessen('email_ausgang');
    const jobs=db.prepare("SELECT a.id,a.benutzer_id,b.email,b.email_bestaetigt,a.versuche,a.generation FROM email_ausgang a JOIN benutzer b ON b.id=a.benutzer_id WHERE a.status='offen' AND a.versuche<5 AND COALESCE(a.naechster_versuch,0)<=? ORDER BY a.id LIMIT 20").all(jetzt());
    for(const j of jobs) {
      if(emailLaufende.has(j.id))continue;
      emailLaufende.add(j.id);
      try {
        if(j.email_bestaetigt!==null) {
          db.prepare("UPDATE email_ausgang SET status='gesendet',geaendert=? WHERE id=?").run(datum(),j.id);
          continue;
        }
        const token=randomBytes(32).toString('base64url');
        const hash=createHash('sha256').update(token).digest('hex');
        const versuch=transaktion(()=>{
          const neu=db.prepare("UPDATE email_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+",geaendert=? WHERE id=? AND generation=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),datum(),j.id,j.generation,jetzt());
          if(!neu.changes)return null;
          // Alte Token nur entwerten, wenn wirklich eine neue Mail vorbereitet wird.
          db.prepare('UPDATE email_token SET benutzt=? WHERE benutzer_id=? AND benutzt IS NULL').run(datum(),j.benutzer_id);
          db.prepare('INSERT INTO email_token(benutzer_id,token_hash,erstellt,laeuft_ab) VALUES(?,?,?,?)')
            .run(j.benutzer_id,hash,datum(),datum()+24*60*60*1000);
          return j.versuche+1;
        });
        if(!versuch)continue;
        const link=base+'/#/megerosites/'+token;
        let erfolgreich=false;
        try {
          erfolgreich=await mailer({...nachricht('bestaetigung',j,{link}),
            idempotencyKey:'schulung-email-'+plattformId+'-'+j.id+'-'+hash.slice(0,32)});
        } catch {console.warn('Mailversand: Fehler');}
        db.prepare("UPDATE email_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,geaendert=? WHERE id=? AND generation=? AND status='offen'")
          .run(erfolgreich?1:0,datum(),j.id,j.generation);
        if(!erfolgreich)abschlussPruefen('email_ausgang',j.id);
      } catch {console.warn('E-Mail-Bestaetigung konnte nicht versendet werden');}
      finally {
        emailLaufende.delete(j.id);
        // Falls waehrend des Versands ein neuer Link angefordert wurde:
        // den neuen Auftrag sofort starten, nicht erst nach zehn Minuten.
        const aktuell=db.prepare('SELECT generation,status FROM email_ausgang WHERE id=?').get(j.id);
        if(aktuell && aktuell.generation!==j.generation && aktuell.status==='offen')
          queueMicrotask(()=>{void emailAusgangSenden();});
      }
    }
  }
  function emailNachCommitSenden() { queueMicrotask(()=>{void emailAusgangSenden();}); }

  async function gratisAusgangSenden() {
    if(!mailer)return;
    haengendeAbschliessen('gratis_mail_ausgang');
    let jobs;
    try {jobs=db.prepare("SELECT g.id,g.benutzer_id,g.kurs_id,g.erstellt,b.email,b.sprache,k.titel,k.waehrung FROM gratis_mail_ausgang g JOIN benutzer b ON b.id=g.benutzer_id JOIN kurse k ON k.id=g.kurs_id WHERE g.status='offen' AND g.versuche<5 AND COALESCE(g.naechster_versuch,0)<=? ORDER BY g.id LIMIT 20").all(jetzt());}
    catch{console.warn('Gratis-Mailausgang konnte nicht gelesen werden');return;}
    for(const j of jobs){
      const id='gratis:'+j.id;if(laufende.has(id))continue;
      laufende.add(id);
      spracheSetzen(j.sprache);
      try{
        const r=db.prepare("UPDATE gratis_mail_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+",geaendert=? WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),datum(),j.id,jetzt());
        if(!r.changes)continue;
        let ok=false;
        try{ok=await mailer({...kaufNachricht({...j,typ:'kauf',bestellung_id:j.id,betrag:0,gratis:true}),
          idempotencyKey:'schulung-gratis-'+plattformId+'-'+j.id});}
        catch{console.warn('Gratis-Mailversand fehlgeschlagen');}
        db.prepare("UPDATE gratis_mail_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,geaendert=? WHERE id=?").run(ok?1:0,datum(),j.id);
        if(!ok)abschlussPruefen('gratis_mail_ausgang',j.id);
      }catch{console.warn('Gratis-Mailausgang nicht verarbeitet');}
      finally{laufende.delete(id);}
    }
  }
  function gratisVormerken(benutzerId,kursId) {
    db.prepare("INSERT OR IGNORE INTO gratis_mail_ausgang(benutzer_id,kurs_id,status,versuche,erstellt,geaendert) VALUES(?,?,'offen',0,?,?)")
      .run(benutzerId,kursId,datum(),datum());
  }
  function gratisNachCommitSenden(){queueMicrotask(()=>{void gratisAusgangSenden();});}
  // Block 4: kurze Benachrichtigung, wenn der Admin einen Zugang erteilt (Kurstitel und Link, Sprache des Kundenkontos).
  // Demo-Adressen (demo-...@example.com) faengt demoMailer ab; geloeschte Konten bekommen nichts.
  const zugangLaufend=new Set();
  function zugangNachricht(j){
    const kurs=titelUebersetzt(j.titel),link=base+'/#/eloadasaim';
    const subject=HU.mail_zugang_betreff.replace('{tanfolyam}',kurs);
    const zeilen=[HU.mail_zugang_text.replace('{tanfolyam}',kurs),link,HU.mail_systemhinweis];
    const { htmlKopf, anhang } = mailKopf();
    const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif">'+
      '<main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9;border-radius:18px">'+
      htmlKopf+'<h1 style="font-size:26px;color:#a87c2a">'+htmlEscape(subject)+'</h1>'+
      zeilen.map(z=>z===link
        ?'<p style="margin:14px 0 22px"><a href="'+htmlEscape(z)+'" style="display:inline-block;background:#d4a843;color:#000;border-radius:40px;padding:14px 24px;text-decoration:none;font-weight:600">'+htmlEscape(HU.mail_link_oeffnen)+'</a></p>'
        :'<p style="margin:0 0 12px;line-height:1.7">'+htmlEscape(z)+'</p>').join('')+'</main></body></html>';
    return {to:j.email,subject,text:zeilen.join('\n'),html,anhaenge:anhang?[anhang]:[]};
  }
  async function zugangAusgangSenden(){
    if(!mailer)return;
    haengendeAbschliessen('zugang_mail_ausgang');
    let jobs;
    try{jobs=db.prepare("SELECT z.id,b.email,b.sprache,k.titel FROM zugang_mail_ausgang z JOIN benutzer b ON b.id=z.benutzer_id JOIN kurse k ON k.id=z.kurs_id WHERE z.status='offen' AND z.versuche<5 AND COALESCE(z.naechster_versuch,0)<=? AND b.geloescht IS NULL ORDER BY z.id LIMIT 20").all(jetzt());}
    catch{console.warn('Zugangs-Mailausgang konnte nicht gelesen werden');return;}
    for(const j of jobs){
      if(zugangLaufend.has(j.id))continue;
      zugangLaufend.add(j.id);
      spracheSetzen(j.sprache);
      try{
        const r=db.prepare("UPDATE zugang_mail_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+",geaendert=? WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),datum(),j.id,jetzt());
        if(!r.changes)continue;
        let ok=false;
        try{ok=!!await mailer({...zugangNachricht(j),idempotencyKey:'schulung-zugang-'+plattformId+'-'+j.id});}
        catch{console.warn('Zugangs-Mailversand fehlgeschlagen');}
        db.prepare("UPDATE zugang_mail_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,geaendert=? WHERE id=?").run(ok?1:0,datum(),j.id);
        if(!ok)abschlussPruefen('zugang_mail_ausgang',j.id);
      }catch{console.warn('Zugangs-Mailausgang nicht verarbeitet');}
      finally{zugangLaufend.delete(j.id);}
    }
  }
  // Nur innerhalb der Transaktion der Zugangsvergabe aufrufen; versendet wird danach mit zugangNachCommitSenden.
  function zugangVormerken(benutzerId,kursId){
    if(!mailer)return;
    db.prepare("INSERT INTO zugang_mail_ausgang(benutzer_id,kurs_id,status,versuche,erstellt,geaendert) VALUES(?,?,'offen',0,?,?)").run(benutzerId,kursId,datum(),datum());
  }
  function zugangNachCommitSenden(){queueMicrotask(()=>{void zugangAusgangSenden();});}
  async function kontoMailSenden(email,typ,{link,idempotencyKey}={}) {
    if(!mailer)return false;
    const config={
      email_pruefen:['mail_konto_email_betreff','mail_konto_email_text'],
      email_geaendert:['mail_konto_geaendert_betreff','mail_konto_geaendert_text'],
      konto_geloescht:['mail_konto_geloescht_betreff','mail_konto_geloescht_text'],
    }[typ];
    if(!config||typeof email!=='string')return false;
    const subject=HU[config[0]];
    const text=[HU[config[1]],link||null,HU.mail_systemhinweis].filter(Boolean).join('\n');
    const { htmlKopf, anhang } = mailKopf();
    const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9;border-radius:18px">' +
      htmlKopf+'<h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1>'+
      text.split('\n').map(x=>x===link?'<p><a href="'+htmlEscape(link)+'">'+htmlEscape(HU.mail_link_oeffnen)+'</a></p>':
        '<p>'+htmlEscape(x)+'</p>').join('')+'</main></body></html>';
    try{return !!await mailer({to:email,subject,text,html,idempotencyKey,anhaenge:anhang?[anhang]:[]});}
    catch{console.warn('Konto-Mailversand fehlgeschlagen');return false;}
  }
  async function kontoAusgangSenden() {
    if(!mailer)return;
    haengendeAbschliessen('konto_mail_ausgang',',empfaenger=NULL');
    const jobs=db.prepare("SELECT id,empfaenger,typ,versuche FROM konto_mail_ausgang WHERE status='offen' AND versuche<5 AND empfaenger IS NOT NULL AND "+FAELLIG_SQL+" ORDER BY id LIMIT 20").all(jetzt());
    for(const j of jobs){
      if(kontoLaufende.has(j.id))continue;
      kontoLaufende.add(j.id);
      try{
      const claim=db.prepare("UPDATE konto_mail_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+" WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),j.id,jetzt());
      if(!claim.changes)continue;
      const ok=await kontoMailSenden(j.empfaenger,j.typ,{idempotencyKey:'schulung-konto-'+plattformId+'-'+j.id});
      db.prepare("UPDATE konto_mail_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,empfaenger=CASE WHEN ? OR versuche>=5 THEN NULL ELSE empfaenger END WHERE id=?")
        .run(ok?1:0,ok?1:0,j.id);
      if(!ok)abschlussPruefen('konto_mail_ausgang',j.id);
      }catch{console.warn('Konto-Mailauftrag nicht verarbeitet');}
      finally{kontoLaufende.delete(j.id);}
    }
  }
  function kontoNachCommitSenden(){queueMicrotask(()=>{void kontoAusgangSenden();});}
  const aboKuendigungLaufend=new Set();
  const aboDatum=(ms,uhr=false)=>new Date(ms).toLocaleString(locale(),{
    timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',
    ...(uhr?{hour:'2-digit',minute:'2-digit',hour12:false}:{})});
  async function aboKuendigungAusgangSenden(){
    if(!mailer)return;
    haengendeAbschliessen('abo_kuendigung_mail');
    const jobs=db.prepare("SELECT m.id,m.erfasst,m.ende,b.email,b.sprache,k.titel FROM abo_kuendigung_mail m JOIN benutzer b ON b.id=m.benutzer_id JOIN kurse k ON k.id=m.kurs_id WHERE m.status='offen' AND m.versuche<5 AND COALESCE(m.naechster_versuch,0)<=? AND b.geloescht IS NULL ORDER BY m.id LIMIT 20").all(jetzt());
    for(const j of jobs){
      if(aboKuendigungLaufend.has(j.id))continue;
      aboKuendigungLaufend.add(j.id);
      spracheSetzen(j.sprache);
      try{
        const r=db.prepare("UPDATE abo_kuendigung_mail SET versuche=versuche+1,"+NAECHSTER_SQL+" WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),j.id,jetzt());
        if(!r.changes)continue;
        const subject=HU.mail_abo_kuendigung_betreff;
        const zeilen=[subject,HU.mail_abo_kuendigung_kurs+': '+titelUebersetzt(j.titel),
          HU.mail_abo_kuendigung_zeit+': '+aboDatum(j.erfasst,true),
          HU.mail_abo_ende+': '+(j.ende?aboDatum(j.ende):HU.a_ismeretlen),
          HU.mail_abo_kuendigung_keine_abbuchung,
          HU.mail_abo_kuendigung_konto,base+'/#/fiokom',HU.mail_systemhinweis];
        const text=zeilen.join('\n');
        const { htmlKopf, anhang } = mailKopf();
        const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif">'+
          '<main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9;border-radius:18px">'+
          htmlKopf+'<h1 style="font-size:26px;color:#a87c2a">'+htmlEscape(zeilen[0])+'</h1>'+
          zeilen.slice(1).map(z=>z===base+'/#/fiokom'
            ?'<p style="margin:14px 0 22px"><a href="'+htmlEscape(z)+'" style="display:inline-block;background:#d4a843;color:#000;border-radius:40px;padding:14px 24px;text-decoration:none;font-weight:600">'+htmlEscape(HU.k_fiokom_cim)+'</a></p>'
            :'<p style="margin:0 0 12px;line-height:1.7">'+htmlEscape(z)+'</p>').join('')+'</main></body></html>';
        let ok=false;
        try{ok=!!await mailer({to:j.email,subject,text,html,
          idempotencyKey:'schulung-abo-lemondas-'+plattformId+'-'+j.id,anhaenge:anhang?[anhang]:[]});}
        catch{console.warn('Abo-Kündigungsmail: Versandfehler');}
        db.prepare("UPDATE abo_kuendigung_mail SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END WHERE id=?").run(ok?1:0,j.id);
        if(!ok)abschlussPruefen('abo_kuendigung_mail',j.id);
      }catch{console.warn('Abo-Kündigungsmail konnte nicht verarbeitet werden');}
      finally{aboKuendigungLaufend.delete(j.id);}
    }
  }
  function aboKuendigungNachCommitSenden(){queueMicrotask(()=>{void aboKuendigungAusgangSenden();});}
  function meldungNachricht(e) {
    const zeit=new Date(e.zeit).toLocaleString(locale(),{
      timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',
    });
    const kurs=titelUebersetzt(e.kurs_titel) || HU.a_ismeretlen;
    const betreffMap={
      registriert:'mail_meldung_registriert',bestaetigt:'mail_meldung_bestaetigt',
      gekauft:'mail_meldung_gekauft',erstattet:'mail_meldung_erstattet',
      abo_gestartet:'mail_meldung_abo_gestartet',abo_beendet:'mail_meldung_abo_beendet',
      abo_gekuendigt:'mail_meldung_abo_gekuendigt',
    };
    const pruefen=(e.typ==='gekauft'||e.typ==='abo_gestartet')&&e.status==='pruefen';
    // U4: Sondermeldungen (Streitfall, Streit beendet, Erstattung fehlgeschlagen): eigener Betreff und Einleitung, keine "Art"-Zeile.
    const sonder=e.typ==='gekauft'?{streitfall:'streitfall',streit_anfrage:'streit_anfrage',streit_gewonnen:'streit_gewonnen',streit_verloren:'streit_verloren',erstattung_fehlgeschlagen:'erstattung_fehlgeschlagen'}[e.status]:null;
    const betreff=HU[sonder?'mail_meldung_'+sonder:pruefen?'mail_meldung_pruefen':betreffMap[e.typ]] || HU.a_ismeretlen;
    const subject=betreff.replace('{tanfolyam}',kurs).replace(/[\r\n]/g,' ').slice(0,240);
    const einleitungen={registriert:'mail_meldung_intro_registriert',bestaetigt:'mail_meldung_intro_bestaetigt',gekauft:'mail_meldung_intro_gekauft',erstattet:'mail_meldung_intro_erstattet',abo_gestartet:'mail_meldung_intro_abo_gestartet',abo_beendet:'mail_meldung_intro_abo_beendet',abo_gekuendigt:'mail_meldung_intro_abo_gekuendigt'};
    const zeilen=[HU[sonder?'mail_meldung_intro_'+sonder:pruefen?'mail_meldung_intro_pruefen':einleitungen[e.typ]] || HU.mail_meldung_intro_gekauft];
    if(e.kurs_titel)zeilen.push(HU.mail_meldung_kurs+': '+kurs);
    if(e.betrag!==null)zeilen.push(HU.mail_meldung_betrag+': '+
      formatGeldEinheiten(e.betrag,e.waehrung,sprache()));   // A2-03: Cent bleiben erhalten; Backlog b: Sprache der Mail
    zeilen.push(HU.mail_meldung_benutzer+': '+(e.email||HU.a_ismeretlen));
    zeilen.push(HU.mail_meldung_zeit+': '+zeit);
    if(e.typ==='abo_gekuendigt'){
      const abo=db.prepare('SELECT gueltig_bis FROM abos WHERE kurs_id=? AND benutzer_id=(SELECT id FROM benutzer WHERE email=?) ORDER BY id DESC LIMIT 1').get(e.kurs_id,e.email);
      if(abo?.gueltig_bis)zeilen.push(HU.mail_meldung_hozzaferes_ende+': '+new Date(abo.gueltig_bis).toLocaleDateString(locale(),{timeZone:'Europe/Budapest'}));
    }
    if(!sonder&&(e.typ==='gekauft'||e.typ==='abo_gestartet'))zeilen.push(
      HU.mail_meldung_art+': '+(e.typ==='abo_gestartet'?HU.mail_meldung_abo:
        e.status==='kostenlos'?HU.mail_meldung_kostenlos:HU.mail_meldung_einmal));
    if(pruefen&&e.typ==='abo_gestartet')zeilen.push(HU.mail_meldung_pruefen_abo_hinweis);
    zeilen.push(base+'/admin/');
    const text=zeilen.map(z=>z===base+'/admin/'?HU.mail_meldung_admin+'\n'+z:z).join('\n');
    const inhalt=zeilen.map(z=>z===base+'/admin/'
      ? '<p><a href="'+htmlEscape(z)+'" style="color:#a87c2a">'+htmlEscape(HU.mail_meldung_admin)+'</a></p>'
      : '<p style="margin:0 0 14px;line-height:1.7">'+htmlEscape(z)+'</p>').join('');
    const { htmlKopf, anhang } = mailKopf();
    const html='<!doctype html><html lang="'+sprache()+'"><body style="background:#faf6ee;color:#211a0e;padding:28px">'+
      '<main style="background:#fff;border:1px solid #e7ddc9;padding:26px;max-width:600px;margin:auto">'+
      htmlKopf+'<h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1>'+inhalt+'</main></body></html>';
    return {to:verkaufsmeldungMail,subject,html,text,anhaenge:anhang?[anhang]:[]};
  }
  // A8-04: Demo-Bremse. Im Speicher, weil die Demo-Datenbank ohnehin fluechtig ist. Gezaehlt werden erfolgreich gesendete Betreibermeldungen.
  const demoGesendet=[];
  let demoUnterdrueckt=0, demoNaechsteSammel=0, demoSammelLaeuft=false;
  function demoMeldungErlaubt(){
    const t=jetzt();
    while(demoGesendet.length&&demoGesendet[0]<=t-TAG_MS)demoGesendet.shift();
    const stunde=demoGesendet.filter(x=>x>t-STUNDE_MS).length;
    return stunde<DEMO_MELDUNG_JE_STUNDE&&demoGesendet.length<DEMO_MELDUNG_JE_TAG;
  }
  // Hoechstens eine Sammelmeldung je Stunde: "N weitere unterdrueckt". Sie fasst alles zusammen, was ab der ersten Unterdrueckung eine Stunde lang
  // zurueckgehalten wurde. Scheitert der Versand, naechster Versuch fruehestens nach 10 Minuten.
  function demoUnterdrueckenMerken(){
    if(!demoUnterdrueckt)demoNaechsteSammel=Math.max(demoNaechsteSammel,jetzt()+STUNDE_MS);
    demoUnterdrueckt++;
  }
  async function demoSammelSenden(){
    if(!demoUnterdrueckt||demoSammelLaeuft||jetzt()<demoNaechsteSammel)return;
    demoSammelLaeuft=true;
    const t=jetzt(),anzahl=demoUnterdrueckt;
    const ersetzen=s=>String(s).replace('{anzahl}',()=>String(anzahl)).replace('{stunde}',()=>String(DEMO_MELDUNG_JE_STUNDE)).replace('{tag}',()=>String(DEMO_MELDUNG_JE_TAG));
    const subject=ersetzen(HU.mail_meldung_unterdrueckt_betreff).replace(/[\r\n]/g,' ').slice(0,240);
    const text=[ersetzen(HU.mail_meldung_unterdrueckt_text),HU.mail_meldung_admin,base+'/admin/'].join('\n');
    const { htmlKopf, anhang } = mailKopf();
    const html='<!doctype html><html lang="'+sprache()+'"><body style="background:#faf6ee;color:#211a0e;padding:28px">'+
      '<main style="background:#fff;border:1px solid #e7ddc9;padding:26px;max-width:600px;margin:auto">'+
      htmlKopf+'<h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1><p style="margin:0 0 14px;line-height:1.7">'+htmlEscape(ersetzen(HU.mail_meldung_unterdrueckt_text))+'</p>'+
      '<p><a href="'+htmlEscape(base+'/admin/')+'" style="color:#a87c2a">'+htmlEscape(HU.mail_meldung_admin)+'</a></p></main></body></html>';
    let ok=false;
    try{ok=!!await mailer({to:verkaufsmeldungMail,subject,text,html,idempotencyKey:'schulung-meldung-sammel-'+plattformId+'-'+t,anhaenge:anhang?[anhang]:[]});}
    catch{console.warn('Demo-Sammelmeldung: Versandfehler');}
    if(ok){demoUnterdrueckt-=anzahl;demoNaechsteSammel=t+STUNDE_MS;}
    else demoNaechsteSammel=t+10*60000;
    demoSammelLaeuft=false;
  }
  async function meldungAusgangSenden() {
    if(!mailer || !verkaufsmeldungMail)return;
    haengendeAbschliessen('meldung_ausgang');
    let jobs;
    try {
      jobs=db.prepare("SELECT m.id,m.versuche,e.zeit,e.typ,e.kurs_id,e.kurs_titel,e.betrag,e.waehrung,e.email,e.status "+
      "FROM meldung_ausgang m JOIN ereignisse e ON e.id=m.ereignis_id "+
      "WHERE m.status='offen' AND m.versuche<5 AND COALESCE(m.naechster_versuch,0)<=? ORDER BY m.id LIMIT 20").all(jetzt());
    } catch {
      console.warn('Geschäftsmeldungen können derzeit nicht geladen werden');
      return;
    }
    for(const j of jobs) {
      if(meldungLaufende.has(j.id))continue;
      meldungLaufende.add(j.id);
      try {
        if(demoModus&&!demoMeldungErlaubt()){
          // Ueber der Demo-Grenze: nicht senden, als erledigt markieren (unterdrueckt=1), in der Sammelmeldung zaehlen.
          const u=db.prepare("UPDATE meldung_ausgang SET status='gesendet',unterdrueckt=1,geaendert=? WHERE id=? AND status='offen'").run(datum(),j.id);
          if(u.changes)demoUnterdrueckenMerken();
          continue;
        }
        const a=db.prepare("UPDATE meldung_ausgang SET versuche=versuche+1,"+NAECHSTER_SQL+",geaendert=? WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL)
          .run(jetzt(),datum(),j.id,jetzt());
        if(!a.changes)continue;
        let ok=false;
        try {
          ok=await mailer({...meldungNachricht(j),idempotencyKey:'schulung-meldung-'+plattformId+'-'+j.id});
        } catch {console.warn('Geschäftsmeldung: Versandfehler');}
        db.prepare("UPDATE meldung_ausgang SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END,geaendert=? WHERE id=?")
          .run(ok?1:0,datum(),j.id);
        if(ok&&demoModus)demoGesendet.push(jetzt());
        if(!ok)abschlussPruefen('meldung_ausgang',j.id);
      } catch {console.warn('Geschäftsmeldung nicht verarbeitet');}
      finally {meldungLaufende.delete(j.id);}
    }
    if(demoModus)await demoSammelSenden();
  }
  function meldungNachCommitSenden() {queueMicrotask(()=>{void meldungAusgangSenden();});}
  const ellallasLaufend=new Set();
  async function ellallasAusgangSenden(){
    if(!mailer)return;
    haengendeAbschliessen('ellallas_mail');
    const jobs=db.prepare("SELECT m.id,m.empfaenger,m.bestellung_id,m.versuche,e.zeit,e.ergebnis,e.hinweis,e.erstattet_betrag,b.email,COALESCE(o.sprache,b.sprache) AS sprache,k.titel,o.betrag,o.waehrung FROM ellallas_mail m JOIN ellallas e ON e.bestellung_id=m.bestellung_id JOIN bestellungen o ON o.id=m.bestellung_id LEFT JOIN benutzer b ON b.id=o.benutzer_id LEFT JOIN kurse k ON k.id=o.kurs_id WHERE m.status='offen' AND m.versuche<5 AND COALESCE(m.naechster_versuch,0)<=? AND e.ergebnis<>'bearbeitung' ORDER BY m.id LIMIT 20").all(jetzt());
    for(const j of jobs){
      if(ellallasLaufend.has(j.id))continue;
      ellallasLaufend.add(j.id);
      spracheSetzen(j.empfaenger==='kunde'?j.sprache:null);   // Kunde: Bestellsprache; Inhaber/Warnmail: Standardsprache (Betreiber)
      try{
        const q=db.prepare("UPDATE ellallas_mail SET versuche=versuche+1,"+NAECHSTER_SQL+" WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),j.id,jetzt());
        if(!q.changes)continue;
        const name=titelUebersetzt(j.titel)||HU.a_ismeretlen;
        const zeit=new Date(j.zeit).toLocaleString(locale(),{timeZone:'Europe/Budapest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
        const geld=geldText(j.betrag,j.waehrung);
        const istKunde=j.empfaenger==='kunde';
        const subject=j.empfaenger==='warnung'?HU.ellallas_warn_betreff:
          istKunde?HU.ellallas_mail_betreff:HU.ellallas_inhaber_betreff.replace('{tanfolyam}',name);
        // Inhaberin und Warnmail bekommen eigene, neutrale Formulierungen (nicht die Kundenansprache mit -od und nicht den Verweis auf den Kundendienst).
        const grund=(!istKunde&&HU['ellallas_inhaber_'+j.ergebnis])||HU['ellallas_'+j.ergebnis]||HU.ellallas_fehler;
        const zeilen=[subject,HU.ellallas_mail_erklaerung,name,HU.k_fiokom_rendeles+': '+j.bestellung_id,
          HU.k_fiokom_betrag+': '+geld,HU.ellallas_zeit+': '+zeit,
          HU.ellallas_ergebnis+': '+grund];
        // F-93: bei erfolgter Erstattung den TATSAECHLICH erstatteten Betrag nennen (kann nach einer Vorerstattung kleiner als der Bestellbetrag sein).
        if(j.ergebnis==='erstattung'&&Number.isSafeInteger(j.erstattet_betrag))zeilen.push(HU.ellallas_erstattet_betrag+': '+geldText(j.erstattet_betrag,j.waehrung));
        // Inhaberin muss erkennen koennen, WER widerrufen hat.
        if(!istKunde&&j.email)zeilen.splice(3,0,HU.mail_meldung_benutzer+': '+j.email);
        if(istKunde&&j.ergebnis==='erstattung')zeilen.push(HU.ellallas_banki_ido);
        if(istKunde)zeilen.push(HU.mail_systemhinweis);
        else zeilen.push(j.ergebnis.startsWith('abgelehnt')?HU.ellallas_manuell:HU.ellallas_inhaber_info);
        if(!istKunde&&j.hinweis==='stripe_abo')zeilen.push(HU.ellallas_abo_stripe_hinweis);
        const text=zeilen.join('\n');
        const { htmlKopf, anhang } = mailKopf();
        const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9">'+htmlKopf+'<h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1>'+zeilen.slice(1).map(x=>'<p>'+htmlEscape(x)+'</p>').join('')+'</main></body></html>';
        const to=istKunde?j.email:verkaufsmeldungMail;
        let ok=false;
        if(to)try{ok=!!await mailer({to,subject,text,html,idempotencyKey:'schulung-ellallas-'+plattformId+'-'+j.id,anhaenge:anhang?[anhang]:[]});}catch{console.warn('Widerrufsmail nicht zugestellt');}
        db.prepare("UPDATE ellallas_mail SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END WHERE id=?").run(ok?1:0,j.id);
        if(!ok)abschlussPruefen('ellallas_mail',j.id);
      }catch{console.warn('Widerrufsmail-Ausgang nicht verarbeitet');}
      finally{ellallasLaufend.delete(j.id);}
    }
  }
  function ellallasNachCommitSenden(){queueMicrotask(()=>{void ellallasAusgangSenden();});}
  const aboErstattungLaufend = new Set();
  async function aboErstattungAusgangSenden() {
    if (!mailer || !verkaufsmeldungMail) return;
    haengendeAbschliessen('abo_erstattung_mail');
    const jobs=db.prepare("SELECT m.id,m.bestell_id,m.refund_id,m.betrag,m.versuche,b.waehrung,b.sprache,k.titel,(SELECT a.status FROM abos a WHERE a.benutzer_id=b.benutzer_id AND a.kurs_id=b.kurs_id ORDER BY a.id DESC LIMIT 1) AS abo_status FROM abo_erstattung_mail m JOIN bestellungen b ON b.id=m.bestell_id LEFT JOIN kurse k ON k.id=b.kurs_id WHERE m.status='offen' AND m.versuche<5 AND COALESCE(m.naechster_versuch,0)<=? ORDER BY m.id LIMIT 20").all(jetzt());
    for (const j of jobs) {
      if(aboErstattungLaufend.has(j.id)) continue;
      aboErstattungLaufend.add(j.id);
      spracheSetzen(j.sprache);
      try {
        const up=db.prepare("UPDATE abo_erstattung_mail SET versuche=versuche+1,"+NAECHSTER_SQL+" WHERE id=? AND status='offen' AND versuche<5 AND "+FAELLIG_SQL).run(jetzt(),j.id,jetzt());
        if (!up.changes) continue;
        const geld=geldText(j.betrag,j.waehrung);
        // F2: Ist das Abo schon beendet (volle Erstattung beendet es automatisch bei Stripe), steht das so in der Mail; sonst bleibt die Pruefbitte.
        const beendet=j.abo_status==='beendet';
        const subject=beendet?HU.aboerstattung_mail_betreff_beendet:HU.aboerstattung_mail_betreff;
        const zeilen=[HU.aboerstattung_mail_szia,HU.aboerstattung_mail_intro,
          HU.aboerstattung_mail_kurs+': '+(titelUebersetzt(j.titel)||HU.a_ismeretlen),
          HU.aboerstattung_mail_betrag+': '+geld,
          HU.aboerstattung_mail_bestellung+': '+j.bestell_id,
          beendet?HU.aboerstattung_mail_beendet:HU.aboerstattung_mail_pruefen,HU.mail_systemhinweis];
        const adminLink=base+'/admin/';
        const text=zeilen.join('\n')+'\n'+HU.mail_meldung_admin+'\n'+adminLink;
        const { htmlKopf, anhang } = mailKopf();
        const html='<!doctype html><html lang="'+sprache()+'"><body style="margin:0;padding:24px;background:#faf6ee;color:#211a0e;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:26px;background:#fff;border:1px solid #e7ddc9">'+htmlKopf+'<h1 style="color:#a87c2a">'+htmlEscape(subject)+'</h1>'+
          zeilen.map(x=>'<p style="line-height:1.7">'+htmlEscape(x)+'</p>').join('')+
          '<p><a href="'+htmlEscape(adminLink)+'" style="display:inline-block;background:#d4a843;color:#211a0e;padding:14px 22px;border-radius:30px;text-decoration:none">'+htmlEscape(HU.mail_meldung_admin)+'</a></p></main></body></html>';
        let ok=false;
        try{ok=!!await mailer({to:verkaufsmeldungMail,subject,text,html,idempotencyKey:'schulung-abo-erstattung-'+plattformId+'-'+j.id,anhaenge:anhang?[anhang]:[]});}
        catch{console.warn('Abo-Erstattungsmail nicht zugestellt');}
        db.prepare("UPDATE abo_erstattung_mail SET status=CASE WHEN ? THEN 'gesendet' WHEN versuche>=5 THEN 'fehler' ELSE 'offen' END WHERE id=?")
          .run(ok?1:0,j.id);
        if(!ok)abschlussPruefen('abo_erstattung_mail',j.id);
      }catch{console.warn('Abo-Erstattungsmail-Ausgang nicht verarbeitet');}
      finally{aboErstattungLaufend.delete(j.id);}
    }
  }
  function aboErstattungNachCommitSenden(){queueMicrotask(()=>{void aboErstattungAusgangSenden();});}
  let timer = null;
  function starten() {
    queueMicrotask(() => { void ausgangSenden(); void emailAusgangSenden(); void meldungAusgangSenden(); void gratisAusgangSenden(); void kontoAusgangSenden(); void aboKuendigungAusgangSenden(); void ellallasAusgangSenden(); void aboErstattungAusgangSenden(); void zugangAusgangSenden(); });
    timer = setInterval(() => { void ausgangSenden(); void emailAusgangSenden(); void meldungAusgangSenden(); void gratisAusgangSenden(); void kontoAusgangSenden(); void aboKuendigungAusgangSenden(); void ellallasAusgangSenden(); void aboErstattungAusgangSenden(); void zugangAusgangSenden(); }, 10 * 60 * 1000);
    timer.unref?.();
  }
  function stoppen() { if (timer) clearInterval(timer); timer = null; }
  return { zugangVormerken, zugangAusgangSenden, zugangNachCommitSenden, aboErstattungNachCommitSenden, aboErstattungAusgangSenden, ellallasNachCommitSenden,ellallasAusgangSenden,aboKuendigungNachCommitSenden, aboKuendigungAusgangSenden, kontoMailSenden, kontoNachCommitSenden, kontoAusgangSenden, versandStarten, ausgangSenden, gratisVormerken, gratisAusgangSenden, gratisNachCommitSenden, meldungAusgangSenden, meldungNachCommitSenden, emailAusgangSenden, emailNachCommitSenden, emailVormerken, emailTokenNeu, mailAktiv:!!mailer, starten, stoppen };
}
export function kaufVormerken(benutzerId, bestellungId, typ = 'kauf') {
  if (!benutzerId || !bestellungId) return;
  db.prepare(
    "INSERT OR IGNORE INTO mail_ausgang (typ,benutzer_id,bestellung_id,status,versuche,erstellt,geaendert) " +
    "VALUES (?,?,?,'offen',0,?,?)"
  ).run(typ,benutzerId,bestellungId,datum(),datum());
}
