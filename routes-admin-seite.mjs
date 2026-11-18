// Sicherheits-Kopfzeilen für ALLE Antworten (Seiten, Skripte, API) und Gabriellas Admin-Seite (/admin) als statische Dateien.
// Die Seite selbst zeigt nur eine Anmeldung; was der Admin darf, entscheidet immer der Server (Rolle in der Datenbank).
import express from 'express';
import { fileURLToPath } from 'node:url';

export const KOPFZEILEN = {
  // Nur eigene Dateien: keine fremden Skripte, Stile, Schriften oder Bilder; keine Inline-Skripte; nicht einbettbar.
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

// Bunny Stream (docs/BUNNY-STREAM-PLAN.md Schritt 5): Ist Bunny eingeschaltet, darf die Seite GENAU EINEN fremden Rahmen laden, den Bunny-Player
// (frame-src, Bunny-Doku stream/embedding). Alles andere bleibt wie in KOPFZEILEN. Ohne Bunny wird diese Funktion nicht benutzt (dann gilt exakt KOPFZEILEN).
// Schritt 6: Die ADMIN-Seite (Pfad /admin) braucht statt des Rahmens die Verbindung zu Bunny fuer den Browser-Upload (connect-src, TUS-Verfahren, Bunny-Doku
// stream/tus-resumable-uploads). Alle anderen Seiten bekommen nur den Rahmen fuer den Player. Jeweils NUR dieser eine Eintrag, sonst nichts.
export const BUNNY_PLAYER_ADRESSE = 'https://player.mediadelivery.net';
export const BUNNY_UPLOAD_ADRESSE = 'https://video.bunnycdn.com';
export function cspMitBunny(csp, pfad) {
  return /^\/admin(\/|$)/i.test(pfad || '')       // Express leitet auch /ADMIN/ zur Admin-Seite: darum ohne Beachtung der Gross-/Kleinschreibung
    ? csp.replace("connect-src 'self'", `connect-src 'self' ${BUNNY_UPLOAD_ADRESSE}`)
    : `${csp}; frame-src ${BUNNY_PLAYER_ADRESSE}`;
}
export function sicherheitsKopfzeilenMitBunny(req, res, next) {
  for (const [name, wert] of Object.entries(KOPFZEILEN)) res.setHeader(name, name === 'Content-Security-Policy' ? cspMitBunny(wert, req.path) : wert);
  next();
}

export function sicherheitsKopfzeilen(_req, res, next) {
  for (const [name, wert] of Object.entries(KOPFZEILEN)) res.setHeader(name, wert);
  next();
}

export const adminSeiteRouter = express.Router();
adminSeiteRouter.use('/admin', express.static(fileURLToPath(new URL('./public/admin', import.meta.url)), { index: 'index.html' }));
