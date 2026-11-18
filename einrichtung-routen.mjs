// WP3 Sicherheitsblock: /einrichtung-Routen fuer den geschuetzten Erststart.
// GET /einrichtung  -> Formular (nur im Zustand UNINITIALISIERT; sonst 404).
// POST /einrichtung -> prueft Code + Email + Passwort, legt Admin + instanz_zustand='ADMIN_ERSTELLT' in EINER Transaktion an,
//                      loescht Token-Zeile, loescht ERSTSTART.txt. Alle Antworten no-store + no-referrer.
import express from 'express';
import { PASSWORT_MIN_LAENGE } from './passwort-regeln.mjs';
import { HU, sprache, spracheMiddleware, mitSprache, STANDARD_SPRACHE } from './texte.mjs';
import { pruefeEinrichtungscode, tokenZeileLoeschen, loescheErststartDatei, sperreZustand, fehlversuchMerken } from './erststart.mjs';

function sichereKopfzeilen(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

// Immer gleiche neutrale Fehlerseite: gleicher Status, gleicher Textkoerper, gleiche Content-Length.
// Spez-3: "Ein ungueltiger, fehlender oder abgelaufener Code beim POST: immer dieselbe Antwort".
function antwortNeutral(res, l) {
  sichereKopfzeilen(res);
  res.status(400).type('text/html; charset=utf-8').send(mitSprache(l, () => formular('neutral')));
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = k => esc(HU['einrichtung_' + k]).replace('{MIN}', String(PASSWORT_MIN_LAENGE));

// Gemeinsamer Rahmen für Erststart, Neustarthinweis und Anmeldung; Standardfarben ohne marke.css.
export function einrichtungsSeite(titel, inhalt, pfad, klasse = '') {
  const wahl = ['de', 'hu', 'en'].map(l => '<a class="knopf klein hell" href="' + pfad + '?lang=' + l + '" hreflang="' + l + '"' + (sprache() === l ? ' aria-current="page"' : '') + '>' + l.toUpperCase() + '</a>').join(' ');
  return '<!doctype html><html lang="' + sprache() + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>' + text(titel) + '</title><link rel="stylesheet" href="/fonts/fonts.css"><link rel="stylesheet" href="/kunde.css"><link rel="stylesheet" href="/admin/admin.css"></head><body><div id="app"><header class="kopf"><h1>' + text('name') + '</h1><nav aria-label="' + text('sprache') + '">' + wahl + '</nav></header><main class="karte formular-kartya' + klasse + '"><h2>' + text(titel) + '</h2>' + inhalt + '</main></div></body></html>';
}
function hinweisSeite() {
  return einrichtungsSeite('konto', '<p>' + text('hinweis') + '</p><a class="knopf" href="/anmelden?lang=' + sprache() + '">' + text('anmelden') + '</a>', '/anmelden');
}
function feld(name, typ, extra = '', hilfe = '') {
  return '<div class="feld"><label for="' + name + '">' + text(name) + '</label><input id="' + name + '" name="' + name + '" type="' + typ + '" required ' + extra + (hilfe ? ' aria-describedby="' + name + '-hilfe"' : '') + '>' + (hilfe ? '<p class="hinweis" id="' + name + '-hilfe">' + text(hilfe) + '</p>' : '') + '</div>';
}
export function anmeldeSeite(fehler = false, l = sprache()) {
  return mitSprache(l, () => anmeldeSeiteInSprache(fehler));
}
function anmeldeSeiteInSprache(fehler) {
  return einrichtungsSeite('anmelden', (fehler ? '<p role="alert" class="meldung rot">' + text('anmeldung_fehler') + '</p>' : '') + '<form method="post" action="/anmelden?lang=' + sprache() + '" enctype="application/x-www-form-urlencoded">' + feld('email', 'email', 'autocomplete="username"') + feld('passwort', 'password', 'autocomplete="current-password"') + '<button class="knopf" type="submit">' + text('anmelden') + '</button></form>', '/anmelden');
}
function formular(fehler = '') {
  const willkommen = '<p>' + text('schritt') + '</p><p>' + text('daten') + '</p><p>' + text('dienste') + '</p>';
  return einrichtungsSeite('willkommen', willkommen + (fehler ? '<p role="alert" class="meldung rot">' + text(fehler) + '</p>' : '') + '<form class="einrichtung-form" method="post" action="/einrichtung?lang=' + sprache() + '" enctype="application/x-www-form-urlencoded"><h2>' + text('zugang') + '</h2>' + feld('code', 'text', 'minlength="8" maxlength="80" autocomplete="off" spellcheck="false" autocapitalize="off" inputmode="text"', 'code_hilfe') + feld('email', 'email', 'autocomplete="email"') + feld('passwort', 'password', 'minlength="' + PASSWORT_MIN_LAENGE + '" maxlength="200" autocomplete="new-password"', 'passwort_regel') + '<button class="knopf" type="submit">' + text('starten') + '</button></form>', '/einrichtung', ' einrichtung-karte');
}
const FORMULAR_FEHLER = { passwort_zu_kurz: 'passwort_zu_kurz', passwort_zu_lang: 'passwort_zu_lang', email_ungueltig: 'email_ungueltig' };

// Bestimmt die IP sicher: nutzt express req.ip (respektiert `trust proxy`-Einstellung aus der Konfig).
function ipAusAnfrage(req) {
  return (req.ip && String(req.ip)) || (req.socket?.remoteAddress || '') || 'unbekannt';
}

export function erstelleEinrichtungsRouter({ db, erststartDateiPfad = 'daten/ERSTSTART.txt', jetztFn = () => Date.now(), auth }) {
  const router = express.Router();
  router.use(spracheMiddleware);

  // Nur urlencoded (kleine Groesse); kein JSON. Content-Type-Pruefung durch express selbst.
  router.use(express.urlencoded({ extended: false, limit: '8kb' }));

  router.use((req, res, next) => {
    sichereKopfzeilen(res);
    next();
  });

  router.get('/einrichtung', (_req, res) => {
    res.status(200).type('text/html; charset=utf-8').send(formular());
  });

  router.post('/einrichtung', async (req, res) => {
    const l = res.getHeader('Content-Language');
    const render = fn => mitSprache(l, fn);
    const jetzt = jetztFn();
    const ip = ipAusAnfrage(req);
    const zustand = sperreZustand(ip, { jetzt });
    if (zustand.gesperrt) return antwortNeutral(res, l);
    // Content-Type-Pruefung: wenn aus irgendeinem Grund kein urlencoded, neutrale Fehlerseite.
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    if (!ctype.startsWith('application/x-www-form-urlencoded')) return antwortNeutral(res, l);

    const codeRoh = req.body?.code;
    const emailRoh = req.body?.email;
    const passwortRoh = req.body?.passwort;

    // 1) Code pruefen (konstant-Zeit, auch bei leerem Feld). Fehler liefern IMMER dieselbe neutrale Antwort.
    const { gueltig } = pruefeEinrichtungscode(db, codeRoh, { jetzt });
    if (!gueltig) {
      fehlversuchMerken(ip, { jetzt });
      return antwortNeutral(res, l);
    }
    // 2) Eingaben pruefen. Hier verrraet die Antwort, dass der Code gueltig war - aber der Angreifer hat den Code nicht (Spez-C7 beabsichtigt).
    const email = auth.emailPruefen(emailRoh);
    if (!email) {
      res.status(400).type('text/html; charset=utf-8').send(render(() => formular(FORMULAR_FEHLER.email_ungueltig)));
      return;
    }
    const passwortFehler = auth.passwortRegelnPruefen(passwortRoh);
    if (passwortFehler) {
      res.status(400).type('text/html; charset=utf-8').send(render(() => formular(FORMULAR_FEHLER[passwortFehler] || FORMULAR_FEHLER.passwort_zu_kurz)));
      return;
    }

    // 3) Passwort hashen (ausserhalb der Transaktion; scrypt ist langsam).
    const hash = await auth.passwortHashen(String(passwortRoh));

    // 4) Transaktion: Admin anlegen + instanz_zustand='ADMIN_ERSTELLT' + Token-Zeile loeschen.
    //    Wenn ein zweiter Prozess das Token schon verbraucht hat (C3), ist die Token-Zeile weg -> wir brechen ab (neutral).
    //    node:sqlite kennt kein db.transaction()-Helper; BEGIN IMMEDIATE/COMMIT/ROLLBACK manuell.
    let ok = false;
    try {
      db.exec('BEGIN IMMEDIATE');
      const zeile = db.prepare('SELECT 1 FROM einrichtungs_token WHERE id=1').get();
      if (!zeile) {
        db.exec('ROLLBACK');
      } else {
        db.prepare("INSERT INTO benutzer (email, passwort_hash, erstellt, rolle, sprache) VALUES (?, ?, ?, 'admin', ?)").run(email, hash, new Date(jetzt).toISOString(), l !== STANDARD_SPRACHE ? l : null); // nur eine VOM STANDARD ABWEICHENDE Sprache speichern (sonst haengt der Login ein zweites Set-Cookie lang= an)
        db.prepare("INSERT OR REPLACE INTO einstellungen (schluessel, wert, verschluesselt, aktualisiert_am) VALUES ('instanz_zustand','ADMIN_ERSTELLT',0,?)").run(new Date(jetzt).toISOString());
        tokenZeileLoeschen(db);
        db.exec('COMMIT');
        ok = true;
      }
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      // z.B. UNIQUE email-Verletzung (Admin existiert bereits durch anderen Prozess). Keine Details nach aussen.
      return antwortNeutral(res, l);
    }
    if (!ok) return antwortNeutral(res, l);

    // 5) Nach Abschluss ERSTSTART.txt loeschen (ausserhalb der Transaktion; Datei ist kein Teil der DB).
    loescheErststartDatei(erststartDateiPfad);

    // 6) Antwort: Hinweisseite (kein Redirect – /anmelden existiert im Setup-Modus nicht).
    //    Keine Sitzung vor Abschluss (Spez-7); lang ist nur die Sprachwahl. Anmeldung im Einrichtungsmodus-Server.
    sichereKopfzeilen(res);
    res.status(200).type('text/html; charset=utf-8').send(render(hinweisSeite));
  });

  router.get('/anmelden', (_req, res) => {
    sichereKopfzeilen(res);
    res.status(200).type('text/html; charset=utf-8').send(hinweisSeite());
  });

  return router;
}
