// Fachliche Regeln – vor Livebetrieb juristisch prüfen. Alle Fristen ab gespeicherter UTC-Bestellzeit.
export const WIDERRUF_TAGE=14;
export const ZUSTIMMUNG_VERSION='v1';
// Sicherheitsgrenze beim Stripe-Abo-Verlauf; bei mehr Einträgen wird nicht automatisch erstattet.
export const ABO_RECHNUNGEN_MAX=100;
export const WIDERRUF_FRIST_MS=WIDERRUF_TAGE*24*60*60*1000;
export function entscheidung({bestellung,zustimmung,ersterZugriff,ersteAboZahlung,jetzt=Date.now()}) {
  const zeit=Date.parse(bestellung.erstellt);
  if(!Number.isFinite(zeit)||jetzt<zeit||jetzt-zeit>WIDERRUF_FRIST_MS)return 'abgelehnt_frist';
  // Abo: Widerruf nur an der ersten Abo-Zahlung. Dann gilt dieselbe Regel wie beim Einmalkauf (Gesamtpruefung 12.11.2026):
  // ausdrueckliche Zustimmung zum sofortigen Beginn UND Inhalt danach geoeffnet -> kein Widerruf.
  if(bestellung.art==='abo'&&!ersteAboZahlung)return 'abgelehnt_frist';
  return zustimmung&&ersterZugriff?'abgelehnt_zustimmung':'erlaubt';
}
