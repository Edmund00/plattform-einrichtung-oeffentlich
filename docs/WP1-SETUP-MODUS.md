# WP1 Setup-Modus: Notizen und Bedrohungsmodell

Stand: 2026-11-13, Bau-Sitzung Omen. Baut auf `docs/SPEZ-WP1-3-SICHERHEITSBLOCK.md` auf.
Chef-Entscheidung R1 = Variante D (2026-11-13): Setup-Modus wird nur mit `EINRICHTUNGSMODUS=1` freigeschaltet.

## Was WP1 tut (kurz)
- `konfig.mjs` erkennt vor jedem Fehlerwurf, ob ein **Setup-Modus** (`UNINITIALISIERT` + `EINRICHTUNGSMODUS=1`) oder **Einrichtungsmodus** (`ADMIN_ERSTELLT`, ohne Schalter) vorliegt. Ohne Schalter und ohne Admin bleibt bei fehlenden Stripe-Variablen das bisherige Abbruch-Verhalten.
- `leseStartZustand(dbDatei)` prueft die DB im `readOnly`-Modus: zuerst `einstellungen.instanz_zustand`, sonst Fallback ueber `benutzer.rolle='admin'`. Fehlende Datei oder kaputte DB -> `UNINITIALISIERT` (fail-safe).
- `server.mjs` verzweigt vor dem Laden von `app.mjs`, Stripe, Mail und Bunny. Im Setup-/Einrichtungsmodus wird ein minimaler Express-Server gestartet (`GET /health` -> `{"modus":"setup"|"einrichtung"}`, alles andere `404 text/plain nicht_gefunden`). Weder Shop- noch Kauf-, Konto-, Admin- oder Webhook-Routen werden geladen; kein Stripe-Client wird angelegt.
- `db.mjs` legt die Tabelle `einstellungen` schon im WP2-konformen Schema an (Spalten `wert`, `verschluesselt`, `iv`, `tag`, `aktualisiert_am`), damit WP2 darauf aufbauen kann. In WP1 bleiben alle Werte im Klartext (`verschluesselt=0`).

## Bedrohungsmodell (kurz)
- Der Schalter `EINRICHTUNGSMODUS=1` liegt in der Verantwortung des Installers/Hosters (WP10) und der Hosting-Vorlage. Eine fertige Instanz (`KONFIGURIERT`/`AKTIV`) ignoriert ihn auch dann, wenn er zufaellig gesetzt ist.
- Der Setup-Modus hat keinen Einmaltoken (der kommt in WP3) und keine `/einrichtung`-Routen. Es gibt nur `/health`; alle anderen Pfade sind 404.
- Der Server nennt in 404-Antworten keine Pfadnamen, keine Version und keinen Stacktrace. `GET /health` ist der einzige Pfad, der `200` liefert, mit genau einem Feld `modus`.
- Verschluesselte Werte und Hauptschluessel-Datei kommen in WP2. Der Einstellungsspeicher schuetzt eine entwendete DB-Datei NICHT, wenn der Angreifer die Schluesseldatei ebenfalls hat; `EINSTELLUNGEN_SCHLUESSEL` aus der Umgebung des Hosters ist zu bevorzugen.
- `sk_live_` wird in jedem Modus abgelehnt (Live-Schluessel sind weiter nicht freigegeben).
