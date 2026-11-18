// Stripe-Beleg: alle Stripe-Leseaufrufe für Einmalkauf und Abo an einer Stelle.
const objektId = value => typeof value === 'string' ? value : value?.id;
async function chargeAusIntent(stripe, intentId) {
  if (!intentId) return null;
  const intent = await stripe.paymentIntents.retrieve(intentId, {expand:['latest_charge']});
  const charge = intent?.latest_charge;
  if (charge && typeof charge === 'object') return charge;
  const id = objektId(charge);
  return id ? stripe.charges.retrieve(id) : null;
}
export async function quittungVonStripe(stripe, bestellung) {
  // Abo-Bestellungen speichern als stripe_sitzung die Rechnungs-ID (in_...), Einmalkäufe die Checkout-Sitzung (cs_...).
  const istRechnung = typeof bestellung.stripe_sitzung === 'string' && bestellung.stripe_sitzung.startsWith('in_');
  const sitzung = istRechnung ? null : await stripe.checkout.sessions.retrieve(bestellung.stripe_sitzung);
  let intentId=bestellung.zahlung_id || objektId(sitzung?.payment_intent);
  // Rechnung vorhanden (Abo immer, Einmalkauf seit invoice_creation): Quittung über die Rechnungszahlung (mit Kundendaten, PDF).
  // Ältere Einmalkäufe ohne Rechnung: Quittung der Zahlung.
  const invoiceId=istRechnung ? bestellung.stripe_sitzung : (typeof sitzung?.invoice === 'string' ? sitzung.invoice : sitzung?.invoice?.id);
  if (bestellung.art === 'abo' && !invoiceId) return null;
  if (invoiceId) {
    const invoice=await stripe.invoices.retrieve(invoiceId);
    // Stripe 18/Basil: invoice.payment_intent wurde durch invoice_payments ersetzt.
    const invoicePayments=await stripe.invoicePayments.list({invoice:invoiceId,limit:20,expand:['data.payment.payment_intent']});
    const paid=invoicePayments.data?.find(p=>p.status==='paid') || invoicePayments.data?.find(p=>p.payment?.payment_intent);
    intentId=objektId(paid?.payment?.payment_intent) || objektId(invoice?.payment_intent);
  }
  const charge=await chargeAusIntent(stripe,intentId);
  return charge?.receipt_url || null;
}
