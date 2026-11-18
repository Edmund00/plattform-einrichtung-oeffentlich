// stripe-verbindung.mjs – WP8: Stripe Verbindungstest (GET /v1/balance) und Webhook-Selbsttest.
// Kein process.env – alle Konfiguration kommt von aussen (stripeOptionen aus konfig.stripeOptionen).
import Stripe from 'stripe';

export async function stripeVerbindungTesten({ stripeSecretKey, zeitlimitMs = 10000, stripeOptionen = {} }) {
  let stripe;
  try {
    stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2025-07-30.basil',
      maxNetworkRetries: 0,
      timeout: zeitlimitMs,
      ...(stripeOptionen || {}),
    });
  } catch {
    return { fehler: 'schluessel_abgelehnt' };
  }
  try {
    await stripe.balance.retrieve();
    return { ok: true };
  } catch (e) {
    if (e?.statusCode === 401 || e?.type === 'StripeAuthenticationError') {
      return { fehler: 'schluessel_abgelehnt' };
    }
    if (e?.statusCode >= 500) return { fehler: 'stripe_fehler' };
    if (e?.type === 'StripeConnectionError') {
      if (e?.code === 'ETIMEDOUT' || (e?.message && /timeout/i.test(e.message))) {
        return { fehler: 'timeout' };
      }
      return { fehler: 'netzwerk_fehler' };
    }
    if (e?.name === 'AbortError' || e?.code === 'ETIMEDOUT') return { fehler: 'timeout' };
    return { fehler: 'netzwerk_fehler' };
  }
}

export function stripeWebhookSelbsttest({ whsec }) {
  const stripe = new Stripe('sk_test_webhook_selbsttest_dummy_000000');
  const payload = JSON.stringify({
    id: 'evt_test_selbsttest',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: {} },
  });
  try {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: whsec });
    stripe.webhooks.constructEvent(payload, header, whsec);
    return { ok: true };
  } catch {
    return { fehler: 'webhook_fehler' };
  }
}
