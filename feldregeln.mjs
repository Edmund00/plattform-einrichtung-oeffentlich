// feldregeln.mjs – Baustein 6 (WP4): Reine Feldregel-Funktionen aus konfig.mjs herausgeloest.
// Rueckgabe: null wenn gueltig, sonst ein Fehlercode-String.
// konfig.mjs ruft diese Funktionen auf und baut daraus seine gewohnten Fehlermeldungen (kein Verhalten geaendert).
// G12-Beweis: ladeKonfig liefert bei identischen Eingaben identische Fehlermeldungen wie vor dem Umbau.

export function pruefeTextFeld(wert, maxLaenge) {
  const v = String(wert ?? '');
  if (v.length > maxLaenge || /[\u0000-\u001f\u007f]/.test(v)) return 'feld_ungueltig';
  return null;
}

export function pruefeEmailFormat(wert) {
  const v = String(wert ?? '');
  if (!v) return null;
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v))
    return 'email_ungueltig';
  return null;
}

export function pruefeTelefonFormat(wert) {
  const v = String(wert ?? '');
  if (!v) return null;
  if (!/^\+?[0-9() ./\-]{5,50}$/.test(v)) return 'telefon_ungueltig';
  return null;
}

export function istStripeTestKey(wert) {
  const v = String(wert ?? '');
  return v.startsWith('sk_test_') && v.length >= 16;
}

export function istLiveStripeKey(wert) {
  return String(wert ?? '').startsWith('sk_live_');
}

export function istWebhookSecret(wert) {
  const v = String(wert ?? '');
  return v.startsWith('whsec_') && v.length >= 12;
}

// Null wenn gueltig, Fehlercode sonst.
// Wenn resendApiKey gesetzt ist, muss mailFrom das Format "Name <adresse@domain>" haben.
// Akzeptiert jede gueltige Domain (nicht nur @resend.dev) – echtes Produkt benoetigt eigene Domain.
export function pruefeMailFromFormat(resendApiKey, mailFrom) {
  const r = String(resendApiKey ?? '');
  const m = String(mailFrom ?? '');
  if (r && (m.length > 320 || !/^[^\n<>]+ <[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}>$/i.test(m)))
    return 'mail_from_ungueltig';
  return null;
}

// pruefePlattformName ist bereits in marke.mjs; hier als Konvenienz re-exportiert.
export { pruefePlattformName } from './marke.mjs';
