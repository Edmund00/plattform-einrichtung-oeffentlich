// Stripe-18-API – einziger Zahlungs-Erstattungsaufruf, im Test durch Stripe-Mock ersetzbar.
export async function vollErstatten(stripe,b,idempotencyKey){
  let intent=b.zahlung_id;
  if(!intent){
    if(b.art==='einmal'){
      const s=await stripe.checkout.sessions.retrieve(b.stripe_sitzung);
      intent=typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id;
    } else {
      const inv=await stripe.invoices.retrieve(b.stripe_sitzung);
      intent=typeof inv.payment_intent==='string'?inv.payment_intent:inv.payment_intent?.id;
      if(!intent){
        const p=await stripe.invoicePayments.list({invoice:b.stripe_sitzung,limit:20});
        const found=p.data?.find(x=>x.status==='paid');
        intent=typeof found?.payment?.payment_intent==='string'?found.payment.payment_intent:found?.payment?.payment_intent?.id;
      }
    }
  }
  if(!intent)throw new Error('payment intent unavailable');
  // P1 Teilerstattung: wurde schon ein Teil erstattet (zum Beispiel im Stripe-Dashboard), wird nur der RESTBETRAG erstattet (sonst lehnt Stripe ab).
  // Ist nichts mehr uebrig, ist der Widerruf bereits durch eine fruehere Erstattung erledigt (kein zweiter Aufruf, keine Doppelerstattung).
  let betrag=b.betrag;
  if(typeof stripe.paymentIntents?.retrieve==='function'){
    const pi=await stripe.paymentIntents.retrieve(intent,{expand:['latest_charge']});
    const ch=pi?.latest_charge;
    if(ch&&typeof ch==='object'&&Number.isSafeInteger(ch.amount)&&Number.isSafeInteger(ch.amount_refunded)){
      const rest=ch.amount-ch.amount_refunded;
      if(rest<=0)return {id:'bereits_erstattet',status:'succeeded',erstattet_betrag:null};
      betrag=Math.min(betrag,rest);
    }
  }
  // Der Schluessel haengt zusaetzlich an der Zahlung (pi_...): Stripe merkt sich Schluessel 24 Stunden und lehnt denselben Schluessel mit anderen Parametern ab
  // (StripeIdempotencyError). Lokale Bestellnummern zaehlen nach einem Datenbank-Reset (Demo-Neustart, Restore) wieder bei 1; ohne die Zahlung im Schluessel
  // scheiterte dann jede Erstattung einer neuen Bestellung mit gleicher Nummer (live gefunden 12.11.2026). Gleiche Bestellung + gleiche Zahlung = gleicher Schluessel.
  const refund=await stripe.refunds.create({payment_intent:intent,amount:betrag},{idempotencyKey:`${idempotencyKey}-${String(intent).replace(/[^A-Za-z0-9_]/g,'').slice(0,64)}`});
  // F-93: tatsaechlich erstatteter Betrag dieser Erstattung (Stripe-Angabe; fehlt sie, der angeforderte Betrag) fuer die Widerrufs-Mail.
  return refund&&typeof refund==='object'?{...refund,erstattet_betrag:Number.isSafeInteger(refund.amount)?refund.amount:betrag}:refund;
}
