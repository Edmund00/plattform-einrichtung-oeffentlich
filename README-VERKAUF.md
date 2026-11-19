# Eigene Kopie auf Render.com einrichten

Dieser Knopf erstellt eine eigene, unabhängige Kopie dieser Plattform in deinem eigenen Render-Konto.
Der Knopf zeigt auf die ÖFFENTLICHE Verkaufskopie `Edmund00/plattform-einrichtung-oeffentlich` (Stand
c17b29a, ein einziger Commit, ohne unsere interne Entwicklungsgeschichte) — das echte Entwickler-Repo
bleibt privat. Syntax wörtlich aus Renders eigener "Deploy to Render"-Doku (Beleg: Abschnitt 1.2 des Plans).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Edmund00/plattform-einrichtung-oeffentlich)

Render fragt dich beim Erstellen nur nach zwei eigenen Werten: `BASE_URL` (deine von Render zugewiesene
Adresse) und `ADMIN_ERLAUBT` (deine Admin-E-Mail-Adresse). Stripe, Bunny und Resend trägst du NICHT hier
ein, sondern erst später, bequem im Browser (siehe unten) — bewusst so eingerichtet, damit deine Kopie
nach dem Deploy erst einmal in einem geschützten Einrichtungsmodus startet.

**Tipp vor dem Klick:** Wähle im Blueprint-Formular selbst einen Namen für deinen Dienst — daraus ergibt
sich deine Adresse: `https://<dein-name>.onrender.com`. Ist der Name schon vergeben, wählt Render
automatisch eine andere Adresse; die steht dann oben auf der Render-Seite deines Dienstes.

## Deinen ersten Admin anlegen (kein Terminal, keine Kommandozeile nötig)
Nach dem Deploy läuft deine Kopie zunächst in einem geschützten Einrichtungsmodus, bis du deinen ersten
Admin-Zugang angelegt hast:
1. Öffne in deinem Render-Dashboard deinen Dienst und dort den Reiter **"Logs"** (nur lesen, kein Terminal).
   Dort steht einmalig eine Zeile wie `Einrichtungscode (24 h gueltig): ABCD-EFGH-...` — das ist dein
   persönlicher, 24 Stunden gültiger Code.
2. Öffne `https://<deine-adresse>.onrender.com/einrichtung` und trage dort Code, deine E-Mail-Adresse und
   ein Passwort ein.
3. Die Seite zeigt danach eine kurze Anleitung: Gehe im Render-Dashboard zu deinem Dienst und klicke einmal
   auf **"Manual Deploy" → "Restart service"**. Die Seite erkennt den Neustart selbst (automatisches Prüfen
   im Hintergrund) und bringt dich dann zur Anmeldung.
4. Melde dich mit deiner E-Mail-Adresse und deinem Passwort an — du landest jetzt direkt im
   Einrichtungsassistenten (sechs Schritte, ganz im Browser).

## Pflichtschritt im Assistenten: Stripe-Webhook einrichten (sonst bekommen deine Kunden trotz Zahlung keinen Zugang!)
Einer der sechs Schritte des Assistenten fragt nach deinem Stripe-Testschlüssel. Ein Schlüssel alleine
reicht NICHT: ohne einen echten, auf DEINE Adresse zeigenden Webhook-Endpunkt in deinem Stripe-Konto
erfährt deine Kopie nie, dass eine Zahlung angekommen ist — der Kunde zahlt wirklich, sieht "Vielen
Dank!", bekommt aber **nie** Zugang zu seinem Kurs. Mach das deshalb sorgfältig, bevor du echte Kunden
zahlen lässt:
1. Gehe in deinem Stripe-Konto zu **Entwickler → Webhooks → Endpunkt hinzufügen**. Endpunkt-URL:
   `https://<deine-adresse>.onrender.com/webhook` (die echte Adresse deines Dienstes, oben auf deiner
   Render-Seite). Ereignisse: waehle genau diese 13 aus (nicht mehr, nicht weniger -- diese Liste ist im
   Quellcode selbst festgehalten, `zahlung.mjs`, `WEBHOOK_EREIGNISSE`):
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
   `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
   `refund.failed`, `refund.updated`, `charge.refund.updated`.
2. Stripe zeigt dir danach ein **Signing-Secret** (beginnt mit `whsec_`). Trage deinen Stripe-Testschlüssel
   UND dieses Signing-Secret im Assistenten ein und klicke dort auf "Verbindung testen".
3. **Testen, bevor echte Kunden kommen:** mach einen echten Testkauf mit Stripes Testkarte `4242 4242 4242
   4242`, melde dich danach unter "Meine Kurse" an und pruefe, ob der Kurs dort WIRKLICH erscheint. Siehst
   du ihn nicht, pruefe im Admin-Bereich unter "Stripe-Abgleich" ("Jetzt abgleichen"): zeigt es "Laut
   Stripe wurde bezahlt, aber auf der Plattform gibt es keine Bestellung", stimmt die Webhook-URL oder das
   Signing-Secret nicht -- Schritte 1-2 wiederholen.

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
to the existing resource"). Deine Stripe-/Bunny-/Resend-Schlüssel liegen NICHT in Render, sondern
verschlüsselt in deiner eigenen Datenbank (vom Assistenten gespeichert) — "Manual Sync" kann sie also
gar nicht betreffen. Deine Render-eigenen Werte (`BASE_URL`, `ADMIN_ERLAUBT`) bleiben dabei laut
Render-Dokumentation erhalten.
