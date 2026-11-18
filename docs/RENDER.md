# Render: Testbetrieb der Schulungsplattform (angelegt 31.10.2026)

Diese Datei enthält KEINE Schlüssel. Werte für Geheimnisse trägt Edmund selbst im Render-Dashboard ein.

## Dienst
- Name: `valore-tanfolyamok` (ungarisch: "tanfolyam" = Kurs). Adresse: `https://valore-tanfolyamok.onrender.com` (falls der Name vergeben war, steht die echte Adresse im Dashboard).
- Art: Web Service, Runtime Node (Version aus `.node-version`: 24, nötig wegen `node:sqlite`), Plan Starter (läuft rund um die Uhr), Region Frankfurt.
- Code: GitHub `Edmund00/schulungsplattform`, Zweig `arbeit` (NICHT `main`), Auto-Deploy AUS: Deploys löst Edmunds Claude Code von Hand aus, nachdem die Tests grün sind.
- Build `npm ci`, Start `npm start` (`node server.mjs`). Prüfpfad: `/api/kurse`.
- Dauerhafter Datenträger "daten", 1 GB, eingehängt unter `/var/data` (Datenbank und hochgeladene Dateien liegen dort).

## Umgebungsvariablen (Namen, siehe docs/UMGEBUNG.md)
Von Edmunds Claude Code gesetzt (keine Geheimnisse außer dem Wiedergabe-Geheimnis, das zufällig erzeugt und nirgends ausgegeben wurde):
`NODE_ENV=production`, `BASE_URL=https://<adresse>`, `DB_DATEI=/var/data/plattform.db`, `DATEI_ORDNER=/var/data/dateien`, `MAX_UPLOAD_MB=500`, `WIEDERGABE_GEHEIMNIS=<zufällig>`. `PORT` setzt Render selbst, `HOST` und `TRUST_PROXY` ergeben sich aus `NODE_ENV=production`.

Von EDMUND im Dashboard einzutragen (Stripe-TESTMODUS, Sandbox "Schulungsplattform"):
- `STRIPE_SECRET_KEY` (beginnt mit `sk_test_`)
- `STRIPE_WEBHOOK_SECRET` (beginnt mit `whsec_`, kommt vom Ereignisziel in Stripe, siehe unten)
Ohne diese beiden startet die App absichtlich nicht (Schutz vor Fehlkonfiguration).

## Stripe-Webhook für die Render-Adresse
In der Stripe-Sandbox ein Ereignisziel (Endpoint) anlegen: URL `https://<adresse>/webhook`, Ereignisse `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`. Das Signing-Secret (`whsec_...`) kommt als `STRIPE_WEBHOOK_SECRET` nach Render.

## Admin anlegen
Die Datenbank ist am Anfang leer. Ersten Admin im Render-Dashboard unter "Shell" anlegen: `ADMIN_PASSWORT=<Passwort> node tools/admin-anlegen.mjs gabriella@example.com` (echte Adresse einsetzen, Passwort nur dort eintippen, nie in Dateien oder Chat).

## Wichtig
- Nur Testmodus. Kein Live-Schlüssel, bis Edmund und Gabriella es ausdrücklich freigeben.
- Kosten: Starter etwa 7 USD im Monat plus Datenträger etwa 0,25 USD pro GB im Monat (Stand der Preisseiten 31.10.2026, im Dashboard prüfen). Kündigen jederzeit möglich.
- Sicherung der Daten: Render erstellt täglich eine Momentaufnahme des gesamten Datenträgers und hält sie 7 Tage vor (Stand der Projektvorgabe, vor Livegang im Render-Dashboard nachprüfen). Eine Wiederherstellung betrifft den ganzen Datenträger; Render rät bei eigenen Datenbanken von dieser Wiederherstellung ab. Deshalb sind zusätzlich eigene verschlüsselte SQLite-Kopien außerhalb von Render samt geübter Wiederherstellung Pflicht. Siehe docs/WIEDERHERSTELLUNG.md und docs/UMGEBUNG.md.
- Eigene Domain (`kurse.valorebusinessclub.com` per CNAME) erst später und nur mit Edmunds Ja.
