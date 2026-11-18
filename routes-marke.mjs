import { rendereKaufmail, mitVorschauName } from './kaufmail-vorlage.mjs';
import express from 'express';
import { randomBytes } from 'node:crypto';

import { setzeS1Db, BANNER_MAX_BYTES, pruefeBanner, speichereBanner, entferneBanner, leseMarkeS1, bannerUrl, pruefeHero } from './banner-bild.mjs';

const mailVorschauen = new Map();
function entferneAbgelaufeneVorschauen() {
  for (const [token, eintrag] of mailVorschauen) {
    if (eintrag.ablauf <= Date.now()) mailVorschauen.delete(token);
  }
}
import { unlinkSync } from 'node:fs';
import { db } from './db.mjs';
import { nurAdmin } from './routes-kurse.mjs';
import { fehler, HU } from './texte.mjs';
import { stepupGueltig } from './auth.mjs';
import { pruefePlattformName, setzePlattform, plattformName, plattformStandard, logoPfade, leseFarben, setzeFarbenDb } from './marke.mjs';
import { mailAnbieter, leseAnbieter, setzeAnbieterDb, pruefeAnbieter, vorschauAnbieter } from './anbieter.mjs';
import { leiteAb } from './farben.mjs';
import { hexPruefen } from './kontrast.mjs';
import { LOGO_MAX_BYTES, speichereLogo, pruefePng } from './logo-png.mjs';

// A1b: Der im Admin gesetzte Name liegt in einer EIGENEN Tabelle "marke", NICHT in "einstellungen".
// Grund (Opus A1b-1, Chef im Code belegt): Jede Zeile ausser instanz_zustand in "einstellungen" laesst server.mjs beim Start den
// Einstellungsspeicher oeffnen und einen Hauptschluessel verlangen (server.mjs:19-25). Eine nur per Umgebung eingerichtete Instanz
// startete nach dem Umbenennen nicht mehr. Die Tabelle "marke" beeinflusst den Start nicht.
const SQL_TABELLE = `CREATE TABLE IF NOT EXISTS marke (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL, aktualisiert_am TEXT NOT NULL)`;
const SQL_LESEN = `SELECT wert FROM marke WHERE schluessel='name'`;
const SQL_SCHREIBEN = `INSERT OR REPLACE INTO marke (schluessel, wert, aktualisiert_am) VALUES ('name', ?, datetime('now'))`;

// Vorrang wie in konfig.mjs: Ist PLATTFORM_NAME in der Umgebung gesetzt, gewinnt er (server.mjs reicht das als nameFix herein; diese Datei liest die Umgebung nicht selbst).

export function markeAdminRouter(logoPfad, { nameFix = false, supportMail = '', demoModus = false, anbieter = {} } = {}) {
  const nameAusUmgebung = () => nameFix === true;
  db.exec(SQL_TABELLE);
  setzeS1Db(db);
  setzeFarbenDb(db);
  setzeAnbieterDb(db);
  // Beim Start: im Admin gespeicherten Namen anwenden, ausser die Umgebung legt den Namen fest.
  const gespeicherterName = db.prepare(SQL_LESEN).get()?.wert;
  if (gespeicherterName && !nameAusUmgebung() && !pruefePlattformName(gespeicherterName)) setzePlattform(gespeicherterName);

  const router = express.Router();

  // GET /api/admin/marke — aktuellen Zustand lesen (kein Stepup noetig)
  router.get('/api/admin/marke', nurAdmin, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const logo = logoPfade();
    res.json({
      name: plattformName(),
      standard: plattformStandard(),
      name_fix: nameAusUmgebung(),
      banner: leseMarkeS1('banner'),
      hero: leseMarkeS1('hero'),
      banner_url: bannerUrl(),
      logo_max_bytes: LOGO_MAX_BYTES,
      hat_logo: logo.quer.startsWith('/marke/logo.png'),
      logo: logo.quer,
      farben: leseFarben().farben,
      anbieter: (() => { const a = leseAnbieter(); return a.quelle === 'standard' ? null : { name: a.name, anschrift: a.anschrift, telefon: a.telefon, email: a.email, adoszam: a.adoszam, steuerHinweis: a.steuerHinweis, quelle: a.quelle }; })(),
    });
  });

  function setzeVorschauHeader(_req, res, next) {
    res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff' });
    next();
  }
  router.use('/api/admin/marke/vorschau/mail', nurAdmin, setzeVorschauHeader);

  function mailVorschau(req, res) {
    entferneAbgelaufeneVorschauen();
    const eintrag = Object.hasOwn(req.query, 'token') ? mailVorschauen.get(req.query.token) : null;
    if (Object.hasOwn(req.query, 'token') && (!eintrag || eintrag.adminId !== req.benutzer.id)) return fehler(res, 404, 'vorschau_abgelaufen');
    const name = eintrag ? eintrag.name : req.query.name;
    if (typeof name !== 'string' || pruefePlattformName(name)) return fehler(res, 422, 'name_ungueltig');
    const logo = eintrag?.logo || (logoPfade().quer.startsWith('/marke/logo.png') ? '/marke/logo.png' : '');
    const { html } = mitVorschauName(name, () => rendereKaufmail({ titel: HU.marke_vorschau_beispiel, betrag: 1900, waehrung: 'EUR', erstellt: '2026-11-16T12:00:00Z', bestellung_id: 'MUSTER', email: '', typ: 'einmal' }, {
      base: '', name, logo, supportMail, demoModus, anbieter: mailAnbieter(anbieter, eintrag?.anbieter),
    }));
    res.type('html').send(html);
  }
  router.get('/api/admin/marke/vorschau/mail', nurAdmin, mailVorschau);
  router.post('/api/admin/marke/vorschau/mail', nurAdmin, express.json({ limit: '900kb' }), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    entferneAbgelaufeneVorschauen();
    const name = req.body?.name;
    if (typeof name !== 'string' || pruefePlattformName(name)) return fehler(res, 422, 'name_ungueltig');
    let logo = '';
    const roh = req.body?.logo;
    if (typeof roh === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(roh)) {
      const b64 = roh.slice('data:image/png;base64,'.length);
      const bytes = Buffer.from(b64, 'base64');
      if (b64.length % 4 === 0 && bytes.toString('base64') === b64 && bytes.length <= LOGO_MAX_BYTES && !pruefePng(bytes)) logo = 'data:image/png;base64,' + bytes.toString('base64');
    }
    const token = randomBytes(16).toString('hex');
    const eigene = [...mailVorschauen].filter(([, e]) => e.adminId === req.benutzer.id);
    while (eigene.length >= 5) mailVorschauen.delete(eigene.shift()[0]);
    while (mailVorschauen.size >= 20) mailVorschauen.delete(mailVorschauen.keys().next().value);
    mailVorschauen.set(token, { name, logo, anbieter: vorschauAnbieter(req.body?.anbieter), adminId: req.benutzer.id, ablauf: Date.now() + 120_000 });
    res.json({ token });
  });
  router.use('/api/admin/marke/vorschau/mail', (err, _req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) return fehler(res, 413, 'png_zu_gross');
    if (err?.type === 'entity.parse.failed') return fehler(res, 400, 'ungueltiges_json');
    return next(err);
  });

  // Vorschau bewertet auch Kontrastfehler; nur das Speichern braucht Step-up.
  function farbenPruefen(req, res, speichern) {
    res.setHeader('Cache-Control', 'no-store');
    if (speichern && !stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    const { gueltig, ok, pruefung, probleme, tokens } = leiteAb(req.body);
    const antwort = { ok, pruefung, probleme, tokens };
    if (!gueltig) return res.status(422).json({ fehler: 'farbe_ungueltig', text: HU.farbe_ungueltig, ...antwort });
    if (speichern && !ok) return res.status(422).json({ fehler: 'farben_kontrast', text: HU.farben_kontrast, ...antwort });
    if (speichern) {
      const farben = Object.fromEntries(['haupt', 'dunkel', 'hell'].map(feld => [feld, hexPruefen(req.body[feld])]));
      db.prepare("INSERT OR REPLACE INTO marke (schluessel, wert, aktualisiert_am) VALUES ('farben', ?, datetime('now'))").run(JSON.stringify(farben));
    }
    return res.json(antwort);
  }
  router.post('/api/admin/marke/farben-pruefen', nurAdmin, (req, res) => farbenPruefen(req, res, false));
  router.put('/api/admin/marke/farben', nurAdmin, (req, res) => farbenPruefen(req, res, true));
  router.delete('/api/admin/marke/farben', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    db.prepare("DELETE FROM marke WHERE schluessel='farben'").run();
    res.json({ ok: true });
  });

  // PUT /api/admin/marke/anbieter — Anbieterdaten speichern
  router.put('/api/admin/marke/anbieter', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    const pruefeErg = pruefeAnbieter(req.body ?? {});
    if (pruefeErg) return res.status(422).json({ text: HU[pruefeErg.fehler] ?? pruefeErg.fehler, ...pruefeErg });
    const felder = ['name', 'anschrift', 'telefon', 'email', 'adoszam', 'steuerHinweis'];
    const daten = Object.fromEntries(felder.map(f => [f, String(req.body?.[f] ?? '').normalize('NFC')]));
    db.prepare("INSERT OR REPLACE INTO marke (schluessel, wert, aktualisiert_am) VALUES ('anbieter', ?, datetime('now'))").run(JSON.stringify(daten));
    res.json({ ok: true });
  });
  router.delete('/api/admin/marke/anbieter', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    db.prepare("DELETE FROM marke WHERE schluessel='anbieter'").run();
    res.json({ ok: true });
  });

  // PUT /api/admin/marke/name — Plattformname aendern
  router.put('/api/admin/marke/name', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    if (nameAusUmgebung()) return fehler(res, 409, 'name_durch_umgebung');
    const roh = req.body?.name;
    if (typeof roh !== 'string' || pruefePlattformName(roh)) return fehler(res, 400, 'name_ungueltig');
    db.prepare(SQL_SCHREIBEN).run(roh);
    setzePlattform(roh);
    res.json({ name: plattformName() });
  });

  // PUT /api/admin/marke/logo — PNG-Logo hochladen (Body als Rohbytes, hoechstens LOGO_MAX_BYTES)
  router.put('/api/admin/marke/logo', nurAdmin,
    express.raw({ type: ['application/octet-stream', 'image/png'], limit: LOGO_MAX_BYTES }),
    (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) return fehler(res, 400, 'png_leer');
      if (buf.length > LOGO_MAX_BYTES) return fehler(res, 413, 'png_zu_gross');
      const pFehler = pruefePng(buf);
      // Bekannte Codes mit eigenem Text; alle anderen (rund 25 genaue PNG-Strukturfehler) bekommen den allgemeinen Text "ungueltig oder beschaedigt".
      if (pFehler) return fehler(res, 400, ['png_leer', 'png_zu_gross', 'png_kein_png', 'png_abmessung_ungueltig'].includes(pFehler) ? pFehler : 'png_ungueltig');
      try {
        speichereLogo(buf, logoPfad);
      } catch {
        // Keine Systemtexte (Pfade, Fehlercodes) nach aussen.
        return fehler(res, 500, 'logo_speichern_fehlgeschlagen');
      }
      // speichereLogo aendert mtime/size -> naechster logoPfade()-Aufruf liest neu
      res.json({ logo: logoPfade().quer });
    });

  // Zu grosser Body: express.raw wirft entity.too.large -> 413 mit unserem Code (statt 400 ungueltiges_json)
  router.use('/api/admin/marke/logo', (err, _req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      res.setHeader('Cache-Control', 'no-store');
      return fehler(res, 413, 'png_zu_gross');
    }
    return next(err);
  });

  // DELETE /api/admin/marke/logo — Logo entfernen (idempotent bei fehlender Datei, echte Fehler werden gemeldet)
  router.delete('/api/admin/marke/logo', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    try { unlinkSync(logoPfad); } catch (e) {
      if (e?.code !== 'ENOENT') return fehler(res, 500, 'logo_entfernen_fehlgeschlagen');
    }
    // statSync in logoPfade() schlaegt fehl -> Cache wird geleert -> SVG-Rueckfall
    res.json({ ok: true });
  });

  // S1: Fehler ausschließlich als stabile Codes, ohne Systemdetails.
  const s1Fehler = (res, status, code) => res.status(status).json({ fehler: code });
  const schutz = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!stepupGueltig(req)) return s1Fehler(res, 401, 'stepup_noetig');
    next();
  };
  const speichern = (key, data) => db.prepare("INSERT OR REPLACE INTO marke(schluessel,wert,aktualisiert_am) VALUES(?,?,datetime('now'))").run(key, JSON.stringify(data));
  router.put('/api/admin/marke/banner', nurAdmin, schutz,
    express.raw({ type: ['application/octet-stream', 'image/png', 'image/jpeg'], limit: BANNER_MAX_BYTES }), (req, res) => {
      if (!req.is(['application/octet-stream', 'image/png', 'image/jpeg'])) return fehler(res, 415, 'banner_typ');
      const b = pruefeBanner(req.body);
      if (b === 'banner_metadaten_zu_gross') return fehler(res, 400, 'banner_metadaten_zu_gross');
      if (!b.ok) return s1Fehler(res, b === 'banner_zu_gross' ? 413 : 400, b);
      try { speichereBanner(req.body, logoPfad, meta => speichern('banner', meta)); }
      catch (e) {
        if (e.message === 'banner_beschaedigt') return fehler(res, 400, 'banner_beschaedigt');
        return s1Fehler(res, 500, 'banner_speichern_fehlgeschlagen');
      }
      res.json({ banner: leseMarkeS1('banner'), url: bannerUrl() });
    });
  router.use('/api/admin/marke/banner', (err, _req, res, next) => {
    if (err?.type === 'entity.too.large' || err?.status === 413) return s1Fehler(res, 413, 'banner_zu_gross');
    next(err);
  });
  router.delete('/api/admin/marke/banner', nurAdmin, schutz, (_req, res) => {
    try {
      for (const ext of ['png', 'jpg']) entferneBanner(logoPfad, ext);
      db.prepare("DELETE FROM marke WHERE schluessel='banner'").run();
    } catch { return s1Fehler(res, 500, 'banner_entfernen_fehlgeschlagen'); }
    res.json({ ok: true });
  });
  router.put('/api/admin/marke/hero', nurAdmin, schutz, (req, res) => {
    const hero = pruefeHero(req.body);
    if (!hero) return s1Fehler(res, 400, 'hero_ungueltig');
    speichern('hero', hero);
    res.json({ ok: true, hero });
  });
  router.delete('/api/admin/marke/hero', nurAdmin, schutz, (_req, res) => {
    db.prepare("DELETE FROM marke WHERE schluessel='hero'").run();
    res.json({ ok: true });
  });
  return router;
}
