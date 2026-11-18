// recht-vorlagen.mjs – WP6: erstelleRechtRouter – erzeugte Rechtsseiten aus Betreiber-Angaben.
// Registriert VOR betreiberRechtRouter (app.mjs) und VOR dem Catch-All (server.mjs Einrichtungsmodus).
// Wenn recht_<seite> = 'erstellt': Seite wird mit ANBIETER-Feldern aus einstellungen generiert.
// Sonst: next() – betreiberRechtRouter oder Catch-All uebernehmen.
import { Router } from 'express';
import { db } from './db.mjs';
import { farbenLink } from './marke.mjs';
import { leseAnbieter, setzeAnbieterDb } from './anbieter.mjs';
import { URL_ZU_SCHLUESSEL, leseAktivenText, setzeRechtDb, rendereKlartext } from './recht-text.mjs';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// Musterhinweis in allen drei Sprachen (R1: Seite muss alle drei enthalten).
const MUSTERHINWEIS_DE = 'Muster, ersetzt keine Rechtsberatung, vor echtem Betrieb prüfen lassen';
const MUSTERHINWEIS_EN = 'Sample only, not legal advice, have checked before going live';
const MUSTERHINWEIS_HU = 'Csak minta, nem jogi tanácsadás, éles üzem előtt ellenőriztesse';

function leseRechtModus(urlSeite) {
  const schluessel = URL_ZU_SCHLUESSEL[urlSeite];
  if (!schluessel) return null;
  return db.prepare('SELECT wert FROM einstellungen WHERE schluessel=?').get(`recht_${schluessel}`)?.wert ?? null;
}

function impressumInhalt(a, sprache) {
  const name = esc(a.name);
  const anschrift = esc(a.anschrift);
  const email = esc(a.email);
  const telefon = esc(a.telefon);
  const adoszam = esc(a.adoszam);
  const steuerhinweis = esc(a.steuerHinweis);
  if (sprache === 'de') return `<h2>Impressum</h2>
<p><strong>${name}</strong><br>${anschrift}${telefon ? '<br>Telefon: ' + telefon : ''}${email ? '<br>E-Mail: <a href="mailto:' + email + '">' + email + '</a>' : ''}</p>
${adoszam ? '<p>Steuer-/Registernummer: ' + adoszam + '</p>' : ''}${steuerhinweis ? '<p>' + steuerhinweis + '</p>' : ''}`;
  if (sprache === 'en') return `<h2>Legal Notice</h2>
<p><strong>${name}</strong><br>${anschrift}${telefon ? '<br>Phone: ' + telefon : ''}${email ? '<br>Email: <a href="mailto:' + email + '">' + email + '</a>' : ''}</p>
${adoszam ? '<p>Tax/registration number: ' + adoszam + '</p>' : ''}${steuerhinweis ? '<p>' + steuerhinweis + '</p>' : ''}`;
  return `<h2>Impresszum</h2>
<p><strong>${name}</strong><br>${anschrift}${telefon ? '<br>Telefonszám: ' + telefon : ''}${email ? '<br>E-mail: <a href="mailto:' + email + '">' + email + '</a>' : ''}</p>
${adoszam ? '<p>Adószám / Cégjegyzékszám: ' + adoszam + '</p>' : ''}${steuerhinweis ? '<p>' + steuerhinweis + '</p>' : ''}`;
}

function datenschutzInhalt(a, sprache) {
  // Datenschutz nennt nur, was der Code wirklich verarbeitet (Bericht belegt jeden Satz):
  // - Benutzerkonten: db.mjs Tabelle benutzer (email, passwort_hash) + erststart.mjs
  // - Sitzungscookies: auth.mjs sitzungErzeugen, cookieSetzen
  // - Käufe: zahlung.mjs + db.mjs Tabellen bestellungen/abonnements
  // - Stripe-Zahlungen: zahlung.mjs stripe.checkout.sessions.create (externer Dienst)
  // - E-Mail via Resend: mail.mjs (nur wenn RESEND_API_KEY konfiguriert)
  // - Videos via Bunny CDN: bunny.mjs (nur wenn Bunny konfiguriert)
  // - IP-Nutzung: routes-auth.mjs:69 (Login-Sperre), admin-zugang.mjs:35 (admin_login_protokoll maskiert)
  const name = esc(a.name);
  const anschrift = esc(a.anschrift);
  const email = esc(a.email);
  if (sprache === 'de') return `<h2>Datenschutzhinweis</h2>
<p>Verantwortlicher: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Verarbeitete Daten</h3>
<p><strong>Kundenkonto:</strong> Bei der Registrierung speichern wir Ihre E-Mail-Adresse und einen aus Ihrem Passwort berechneten Prüfwert, nicht das Passwort selbst, in unserer Datenbank.</p>
<p><strong>Käufe:</strong> Die Zahlungsabwicklung erfolgt über Stripe. Wir speichern Angaben zu Ihren Käufen, darunter Betrag, Datum und Kurs.</p>
<p><strong>E-Mail:</strong> Falls E-Mail aktiviert ist, versenden wir Nachrichten zu Käufen und Kurszugängen über den Dienst Resend.</p>
<p><strong>Videos:</strong> Videoinhalte werden, falls aktiviert, über den Dienst Bunny CDN ausgeliefert.</p>
<p><strong>Zugriffsschutz:</strong> Zur Absicherung gegen missbräuchliche Anmeldeversuche wird die IP-Adresse vorübergehend zur Zugriffskontrolle verwendet. Admin-Zugriffsversuche werden mit gekürzter IP-Adresse in unserer Datenbank protokolliert.</p>
<p><strong>Sitzungscookies:</strong> Wir verwenden ein Cookie, um Ihre Anmeldung aufrechtzuerhalten.</p>`;
  if (sprache === 'en') return `<h2>Privacy Notice</h2>
<p>Controller: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Data processed</h3>
<p><strong>Customer account:</strong> On registration we store your email address and a verification value calculated from your password, not the password itself, in our database.</p>
<p><strong>Purchases:</strong> Payment processing is handled by Stripe. We store information about your purchases, including amount, date and course.</p>
<p><strong>Email:</strong> If email is enabled, we send messages about purchases and course access via the Resend service.</p>
<p><strong>Video:</strong> Video content, if enabled, is delivered via the Bunny CDN service.</p>
<p><strong>Security:</strong> To protect against abuse, your IP address is temporarily used for access control. Admin login attempts are logged with a shortened IP address in our database.</p>
<p><strong>Session cookie:</strong> We use a cookie to maintain your session.</p>`;
  return `<h2>Adatvédelmi tájékoztató</h2>
<p>Adatkezelő: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Kezelt adatok</h3>
<p><strong>Felhasználói fiók:</strong> Regisztrációkor az e-mail-cím és az Ön jelszavából kiszámított ellenőrző érték, nem maga a jelszó, kerül tárolásra az adatbázisunkban.</p>
<p><strong>Vásárlások:</strong> A fizetési folyamatot a Stripe bonyolítja le. Vásárlásaira vonatkozó adatokat tárolunk, köztük az összeget, dátumot és a tanfolyamot.</p>
<p><strong>E-mail:</strong> Ha az e-mail funkció aktív, vásárlásokkal és tanfolyam-hozzáférésekkel kapcsolatos üzeneteket küldünk a Resend szolgáltatáson keresztül.</p>
<p><strong>Videók:</strong> A videótartalmakat, ha aktívak, a Bunny CDN szolgáltatáson keresztül szállítjuk.</p>
<p><strong>Hozzáférés-védelem:</strong> A visszaélések megelőzése érdekében az IP-cím ideiglenesen hozzáférés-ellenőrzésre kerül felhasználásra. Az adminisztrátori bejelentkezési kísérleteket rövidített IP-címmel tároljuk adatbázisunkban.</p>
<p><strong>Munkamenet-cookie:</strong> Cookie-t használunk a bejelentkezés fenntartásához.</p>`;
}

function teilnahmeInhalt(a, sprache) {
  const name = esc(a.name);
  const anschrift = esc(a.anschrift);
  const email = esc(a.email);
  if (sprache === 'de') return `<h2>Allgemeine Teilnahmebedingungen</h2>
<p>Anbieter: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Vertragsschluss und Zugang</h3>
<p>Mit dem Kauf eines Kurses kommt ein Vertrag zwischen Ihnen und dem Anbieter zustande. Sie erhalten Zugang zu den Kursinhalten für die Dauer Ihres Abonnements.</p>
<h3>Zahlung</h3>
<p>Die Zahlung erfolgt über Stripe. Es gelten die Zahlungsbedingungen von Stripe.</p>`;
  if (sprache === 'en') return `<h2>Terms of Participation</h2>
<p>Provider: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Contract and access</h3>
<p>By purchasing a course, a contract is concluded between you and the provider. You receive access to the course content for the duration of your subscription.</p>
<h3>Payment</h3>
<p>Payment is processed by Stripe. Stripe's payment terms apply.</p>`;
  return `<h2>Részvételi feltételek</h2>
<p>Szolgáltató: ${name}${anschrift ? ', ' + anschrift : ''}${email ? ', ' + email : ''}</p>
<h3>Szerződéskötés és hozzáférés</h3>
<p>Tanfolyam vásárlásakor Ön és a szolgáltató között szerződés jön létre. Az előfizetés időtartamára hozzáférést kap a tanfolyam tartalmaihoz.</p>
<h3>Fizetés</h3>
<p>A fizetés a Stripe-on keresztül történik. A Stripe fizetési feltételei érvényesek.</p>`;
}

function generiereHtml(seite, anbieter) {
  const inhalte = { de: null, en: null, hu: null };
  for (const sprache of ['de', 'en', 'hu']) {
    if (seite === 'impresszum') inhalte[sprache] = impressumInhalt(anbieter, sprache);
    else if (seite === 'adatvedelem') inhalte[sprache] = datenschutzInhalt(anbieter, sprache);
    else inhalte[sprache] = teilnahmeInhalt(anbieter, sprache);
  }
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="stylesheet" href="/jogi/recht.css">${farbenLink()}</head><body>
<p><a href="/">&#8592;</a></p>
<div class="musterhinweis-block"><p class="musterhinweis-de">${esc(MUSTERHINWEIS_DE)}</p><p class="musterhinweis-en">${esc(MUSTERHINWEIS_EN)}</p><p class="musterhinweis-hu">${esc(MUSTERHINWEIS_HU)}</p></div>
${inhalte.de}
<hr lang="en">
${inhalte.en}
<hr lang="hu">
${inhalte.hu}
</body></html>`;
}

function generiereKlartextHtml(seite, version) {
  return `<!doctype html><html lang="${esc(version.sprache)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><link rel="stylesheet" href="/jogi/recht.css">${farbenLink()}</head><body>
<p><a href="/">&#8592;</a></p>
${rendereKlartext(version.inhalt)}
</body></html>`;
}

export function erstelleRechtRouter() {
  setzeAnbieterDb(db);
  setzeRechtDb(db);
  const r = Router();
  r.get(/^\/jogi\/(impresszum|adatvedelem|reszveteli-feltetelek)\/?(?:index\.html)?$/, (req, res, next) => {
    const seite = req.params[0];
    const modus = leseRechtModus(seite);
    if (!modus) return next();
    if (modus !== 'erstellt') {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, modus);
    }
    const aktiv = leseAktivenText(seite);
    if (aktiv) {
      res.setHeader('Cache-Control', 'no-store');
      return res.type('text/html; charset=utf-8').send(generiereKlartextHtml(seite, aktiv));
    }
    const anbieter = leseAnbieter();
    res.setHeader('Cache-Control', 'no-store');
    res.type('text/html; charset=utf-8').send(generiereHtml(seite, anbieter));
  });
  return r;
}
