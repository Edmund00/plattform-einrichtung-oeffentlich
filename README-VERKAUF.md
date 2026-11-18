# Eigene Kopie auf Render.com einrichten

Dieser Knopf erstellt eine eigene, unabhängige Kopie dieser Plattform in deinem eigenen Render-Konto.
Der Knopf zeigt auf die ÖFFENTLICHE Verkaufskopie `Edmund00/plattform-einrichtung-oeffentlich` (Stand
c17b29a, ein einziger Commit, ohne unsere interne Entwicklungsgeschichte) — das echte Entwickler-Repo
bleibt privat. Syntax wörtlich aus Renders eigener "Deploy to Render"-Doku (Beleg: Abschnitt 1.2 des Plans).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Edmund00/plattform-einrichtung-oeffentlich)

Render fragt dich beim Erstellen nach eigenen Werten für: `BASE_URL` (deine von Render zugewiesene
Adresse), `ADMIN_ERLAUBT` (deine Admin-E-Mail-Adresse), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`BUNNY_STREAM_BIBLIOTHEK_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_TOKEN_KEY`, optional `RESEND_API_KEY`
und `MAIL_FROM` (für Mails). Anleitung dafür folgt (Tag 3 des Plans).

## Pflichtschritt: Stripe-Webhook einrichten (sonst bekommen deine Kunden trotz Zahlung keinen Zugang!)
`STRIPE_WEBHOOK_SECRET` alleine reicht NICHT. Ohne einen echten, auf DEINE Adresse zeigenden Webhook-
Endpunkt in deinem Stripe-Konto erfährt deine Kopie nie, dass eine Zahlung angekommen ist: der Kunde
zahlt wirklich, sieht "Vielen Dank!", bekommt aber **nie** Zugang zu seinem Kurs — das schlimmstmögliche
Ergebnis für einen Verkauf. Mach das deshalb VOR dem ersten echten Verkauf:
1. Waehle im Blueprint-Formular (bevor du auf "Deploy Blueprint" klickst) selbst einen Namen fuer deinen
   Dienst -- daraus ergibt sich deine Adresse: `https://<dein-name>.onrender.com`.
2. Gehe in deinem Stripe-Konto zu **Entwickler → Webhooks → Endpunkt hinzufügen**. Endpunkt-URL:
   `https://<dein-name>.onrender.com/webhook`. Ereignisse: waehle genau diese 13 aus (nicht mehr, nicht
   weniger -- diese Liste ist im Quellcode selbst festgehalten, `zahlung.mjs`, `WEBHOOK_EREIGNISSE`):
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
   `refund.failed`, `refund.updated`, `charge.refund.updated`.
3. Stripe zeigt dir danach ein **Signing-Secret** (beginnt mit `whsec_`). Kopiere genau diesen Wert als
   `STRIPE_WEBHOOK_SECRET` in das Blueprint-Formular, dann erst auf "Deploy Blueprint" klicken.
4. **Falls Render deinem Dienst doch eine andere Adresse gegeben hat** (z. B. weil dein gewuenschter Name
   schon vergeben war): die echte Adresse steht oben auf der Render-Seite deines Dienstes. Geh dann zurueck
   zu deinem Stripe-Endpunkt und korrigiere dort die URL auf die echte Adresse.
5. **Testen, bevor echte Kunden kommen:** mach einen echten Testkauf mit Stripes Testkarte `4242 4242 4242
   4242`, melde dich danach unter "Meine Kurse" an und pruefe, ob der Kurs dort WIRKLICH erscheint. Siehst
   du ihn nicht, pruefe im Admin-Bereich unter "Stripe-Abgleich" ("Jetzt abgleichen"): zeigt es "Laut
   Stripe wurde bezahlt, aber auf der Plattform gibt es keine Bestellung", stimmt die Webhook-URL oder das
   Signing-Secret nicht -- Schritte 2-4 wiederholen.

## Was dir gehört, was du selbst bezahlst (bitte vorher lesen)
- **Dir gehört** die laufende Kopie: dein Render-Konto, deine Datenbank, deine Inhalte.
- **Du bezahlst selbst** Render (mindestens den "Starter"-Plan, Stand heute 7 USD/Monat, wegen der
  Festplatte) und Bunny (nach Nutzung, mindestens 1 USD/Monat bei aktivem Konto). Wir stellen dir dafür
  keine Rechnung — die Rechnung kommt direkt von Render bzw. Bunny an dich.
- **Updates** unserer Software bekommst du NICHT automatisch (bewusst so eingerichtet, `autoDeployTrigger: off`
  — deine Kopie bleibt stabil). Wie du später ein Update bekommst, legen wir noch fest (eigener Schritt).
- **Sicherung/Wiederherstellung** deiner Daten ist deine eigene Aufgabe (Render sichert deine Festplatte
  automatisch alle 24 Stunden für 7 Tage — zusätzlich dazu, nicht als Ersatz für eine eigene Sicherung).
- **Kündigen** kannst du jederzeit selbst, direkt bei Render und bei Bunny — wir müssen dafür nichts tun.

**Wichtig nach der Einrichtung:** klicke auf deiner eigenen Render-Seite nicht auf "Manual Sync", außer
du weißt genau, was sich dadurch ändert — Render könnte dabei Einstellungen aus unserer render.yaml
erneut anwenden (Quelle: render.com/docs/infrastructure-as-code, "Render applies the new configuration
to the existing resource"). Deine eigenen Geheimnisse (Stripe/Bunny/Resend-Schlüssel) bleiben dabei laut
Render-Dokumentation erhalten, andere Werte nicht unbedingt.
