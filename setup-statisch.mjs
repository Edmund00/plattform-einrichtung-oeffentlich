// Ausschließlich öffentliche Gestaltungsressourcen, keine Verzeichnisfreigabe.
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const modulOrdner = dirname(fileURLToPath(import.meta.url));
export const SETUP_DATEIEN = [
  '/kunde.css', '/admin/admin.css', '/fonts/fonts.css',
  '/fonts/cormorant-garamond-normal-latin-ext.woff2',
  '/fonts/cormorant-garamond-normal-latin.woff2',
  '/fonts/cormorant-garamond-italic-latin-ext.woff2',
  '/fonts/cormorant-garamond-italic-latin.woff2',
  '/fonts/jost-latin-ext.woff2', '/fonts/jost-latin.woff2',
];
export function erstelleSetupStatischRouter() {
  const router = express.Router({ caseSensitive: true, strict: true });
  for (const pfad of SETUP_DATEIEN) {
    const datei = resolve(modulOrdner, 'public', '.' + pfad);
    router.get(pfad, (_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(pfad.endsWith('.woff2') ? 'font/woff2' : 'text/css');
      res.sendFile(datei, { maxAge: 300000, dotfiles: 'deny' }, err => { if (err) next(err); });
    });
  }
  return router;
}
