// routes-recht-admin.mjs — A4a: Admin-API für Rechtstexte.
// D6: nurAdmin + stepupGueltig; Origin-Header PFLICHT (strenger als herkunftSchutz).
import { Router } from 'express';
import express from 'express';
import { nurAdmin } from './routes-kurse.mjs';
import { fehler, HU } from './texte.mjs';
import { stepupGueltig } from './auth.mjs';
import { speichereText, stelleWiederHer, leseRechtUebersicht, leseRechtVersion } from './recht-text.mjs';

const SEITEN = new Set(['impresszum', 'adatvedelem', 'reszveteli-feltetelek']);

function originPruefen(base) {
  return (req, res, next) => {
    if (req.headers.origin !== base) return fehler(res, 403, 'herkunft_fremd');
    next();
  };
}

export function erstelleRechtAdminRouter(base) {
  const router = Router();

  // 100 kb JSON-Limit nur für diese Routen (vor dem globalen 10 kb)
  router.use(express.json({ limit: '100kb' }));

  const originCheck = originPruefen(base);

  // GET /api/admin/recht — Übersicht aller drei Seiten
  router.get('/api/admin/recht', nurAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ seiten: leseRechtUebersicht() });
  });

  // GET /api/admin/recht/:seite/:version — einzelne Version mit Inhalt
  router.get('/api/admin/recht/:seite/:version', nurAdmin, (req, res) => {
    const { seite, version } = req.params;
    if (!SEITEN.has(seite)) return fehler(res, 404, 'nicht_gefunden');
    const v = parseInt(version, 10);
    if (!Number.isFinite(v) || v < 1) return fehler(res, 400, 'nicht_gefunden');
    const zeile = leseRechtVersion(seite, v);
    if (!zeile) return fehler(res, 404, 'nicht_gefunden');
    res.setHeader('Cache-Control', 'no-store');
    res.json(zeile);
  });

  // POST /api/admin/recht/:seite — neuen Text speichern
  router.post('/api/admin/recht/:seite', originCheck, nurAdmin, (req, res) => {
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    const { seite } = req.params;
    if (!SEITEN.has(seite)) return fehler(res, 404, 'nicht_gefunden');
    const { inhalt, sprache, basis_version } = req.body ?? {};
    if (typeof inhalt !== 'string' || inhalt.length === 0) return res.status(422).json({ fehler: 'recht_text_ungueltig', text: HU.recht_text_ungueltig, felder: ['inhalt'] });
    if (!['de', 'en', 'hu'].includes(sprache)) return res.status(422).json({ fehler: 'recht_sprache_ungueltig', text: HU.recht_sprache_ungueltig, felder: ['sprache'] });
    const basis = typeof basis_version === 'number' ? basis_version : 0;
    const bearbeiter = req.benutzer?.email ?? 'unbekannt';
    try {
      const ergebnis = speichereText(seite, inhalt, sprache, basis, bearbeiter);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(ergebnis);
    } catch (e) {
      if (e.code === 'recht_url_aktiv') return fehler(res, 409, 'recht_url_aktiv');
      if (e.code === 'recht_konflikt') return fehler(res, 409, 'recht_konflikt');
      if (e.code === 'recht_text_ungueltig') return res.status(422).json({ fehler: 'recht_text_ungueltig', text: HU.recht_text_ungueltig, felder: ['inhalt'] });
      if (e.code === 'recht_sprache_ungueltig') return res.status(422).json({ fehler: 'recht_sprache_ungueltig', text: HU.recht_sprache_ungueltig, felder: ['sprache'] });
      console.error('recht POST Fehler:', e.message);
      return fehler(res, 500, 'serverfehler');
    }
  });

  // POST /api/admin/recht/:seite/wiederherstellen — alte Version als neue anlegen
  router.post('/api/admin/recht/:seite/wiederherstellen', originCheck, nurAdmin, (req, res) => {
    if (!stepupGueltig(req)) return fehler(res, 401, 'stepup_noetig');
    const { seite } = req.params;
    if (!SEITEN.has(seite)) return fehler(res, 404, 'nicht_gefunden');
    const { version, basis_version } = req.body ?? {};
    const v = typeof version === 'number' ? version : parseInt(version, 10);
    const basis = typeof basis_version === 'number' ? basis_version : 0;
    const bearbeiter = req.benutzer?.email ?? 'unbekannt';
    try {
      const ergebnis = stelleWiederHer(seite, v, basis, bearbeiter);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(ergebnis);
    } catch (e) {
      if (e.code === 'recht_url_aktiv') return fehler(res, 409, 'recht_url_aktiv');
      if (e.code === 'recht_konflikt') return fehler(res, 409, 'recht_konflikt');
      if (e.code === 'nicht_gefunden') return fehler(res, 404, 'nicht_gefunden');
      console.error('recht Wiederherstellen Fehler:', e.message);
      return fehler(res, 500, 'serverfehler');
    }
  });

  return router;
}
