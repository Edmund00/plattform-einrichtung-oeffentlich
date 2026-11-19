# SOURCE-VERSION

Diese Kopie wurde am 13.11.2026 aus dem eingefrorenen Stand des privaten Repos `Edmund00/stripe-muster` erzeugt:

- Quelle: Zweig `main`, Commit `390d2b61e8a030e2bc686e95d0dfd81392c6a347` ("Generatoren tools/de|en mit texte/*.json synchronisiert, Test generator-sync", 13.11.2026 07:20 +0100)
- Methode: `git archive` des Unterordners `plattform/` (nur versionierte Dateien, ohne Datenordner, ohne Abhängigkeitsordner, ohne Geheimnisse). Der Inhalt von `plattform/` liegt hier im Wurzelordner.
- Nicht enthalten: Ordner `praesentation/` (Marketing), Screenshots, Abnahmeprotokolle des Produktiv-Repos.
- Selbsttest: Der vollständige Lauf `Selbsttest-Alle` war im Quell-Repo am 13.11.2026 grün ("Alle Offline-Tests bestanden", 07:15 Budapest).
- Einzige Abweichung vom Quellstand: In `.gitignore` wurde das Byte-Order-Mark am Anfang der ersten Zeile entfernt, damit `node_modules/` wirklich ignoriert wird. Alles andere ist byte-gleich.
- Secret-Scan der Kopie am 13.11.2026: nur Prüfmuster im Code und offensichtliche Testwerte (längster Wert 34 Zeichen), kein echter Schlüssel.

Erste Pflicht (Gate 0 des Projektplans): Alle bestehenden Tests müssen in dieser Kopie mit Node 24 unverändert bestehen. Erst dann beginnt Arbeitspaket WP1.

## Aktualisierung 19.11.2026 16:35 Budapest / 15:35 UTC

Diese Kopie wurde komplett ersetzt durch den eingefrorenen Stand des privaten Repos `Edmund00/plattform-einrichtung`:

- Quelle: Zweig `main`, Commit `062d909` (Merge "F-45/F-319 behoben -- Web-Einrichtung ohne Shell, render.yaml korrigiert", 19.11.2026)
- Methode: `git archive HEAD` des gesamten Repos (nur versionierte Dateien, ohne Datenordner `daten/`, ohne `node_modules/`, ohne Geheimnisse -- das Repo hat seit dem letzten Abgleich keinen `plattform/`-Unterordner mehr, der Inhalt liegt direkt im Wurzelordner).
- Grund der Aktualisierung: `render.yaml` verlangte bis zu diesem Stand Stripe/Bunny/Resend-Schlüssel bereits im Render-Blueprint-Formular vor dem Deploy -- dadurch erreichte ein echter Kunde den geschützten Web-Einrichtungsweg (`/einrichtung`, Einmal-Code) nie und landete stattdessen im Normalmodus mit fail-closed gesperrtem Admin-Login. Jetzt: `EINRICHTUNGSMODUS=1` fest gesetzt, Stripe/Bunny/Resend nicht mehr im Blueprint-Formular (werden im Einrichtungsassistenten nach dem Admin-Login im Browser eingegeben).
- Selbsttest: `tools/selbsttest-erststart.mjs` (111/111), `tools/selbsttest-setupmodus.mjs` (85/85), `tools/selbsttest-assistent-geruest.mjs` (69/69), `tools/selbsttest-assistent-abschluss.mjs` (84/84), `tools/selbsttest-assistent-stripe.mjs` (71/71) -- alle grün im Quell-Repo vor dem Merge.
- Secret-Scan der Kopie am 19.11.2026 (`tools/geheimnis-pruefung.ps1` gegen den vollständigen Quellbaum): nur bekannte, bereits am 18.11.2026 einzeln gegengeprüfte Test-Platzhalter in `tools/selbsttest-*.mjs` (E-Mail-/Passwort-Muster in Negativtests), kein echter Schlüssel.
- Noch offen: ein echter frischer "Deploy to Render"-Test mit diesem aktualisierten Stand als endgültiger Beweis (siehe `STAND-AKTUELL.md` im Notizen-Repo).
- **Kurswechsel bei dieser Aktualisierung (Edmunds Auftrag 19.11.2026):** Diese Kopie enthält jetzt NUR noch
  den tatsächlich benötigten Code und die beiden Kunden-Anleitungen (`README-VERKAUF.md`,
  `BUNNY-EINRICHTUNG.md`). Entfernt wurden gegenüber früheren Aktualisierungen alle internen Dateien, die
  weder zum Betrieb der Plattform noch für einen Kunden nötig sind: `.claude/`, `docs/`, `handbuch/`,
  `tools/`, `tests/`, alle `BUILDER-FERTIG-*.md`/`CODEX-FERTIG-*.md`, `CLAUDE.md`, `EINRICHTUNG-PROJEKT.md`,
  `PROTOKOLL.md`. Geprüft (Grep gegen den privaten Quellbaum): keine dieser vier Verzeichnisse wird von
  irgendeinem Produktionscode (`server.mjs`, `app.mjs`, `routes-*.mjs`) zur Laufzeit importiert oder
  ausgeliefert. `README.md` war zusätzlich inhaltlich veraltet (beschrieb ein anderes, unverwandtes Projekt
  aus einer früheren Verwendung desselben Codes) und wurde neu geschrieben.
