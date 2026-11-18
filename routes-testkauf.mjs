import express from 'express';
import { nurAdmin } from './routes-kurse.mjs';
import { setzeTestkaufDb, setzeTestkaufStripeKey, testkaufStatus } from './testkauf.mjs';

export function testkaufRouter(stripeSecretKey) {
  setzeTestkaufStripeKey(stripeSecretKey);

  const router = express.Router();
  let bereit = false;

  router.get('/api/admin/testkauf', nurAdmin, async (_req, res) => {
    if (!bereit) {
      const { db } = await import('./db.mjs');
      setzeTestkaufDb(db);
      bereit = true;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(testkaufStatus());
  });

  return router;
}
