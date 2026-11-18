# SOURCE-VERSION

Diese Kopie wurde am 13.11.2026 aus dem eingefrorenen Stand des privaten Repos `Edmund00/stripe-muster` erzeugt:

- Quelle: Zweig `main`, Commit `390d2b61e8a030e2bc686e95d0dfd81392c6a347` ("Generatoren tools/de|en mit texte/*.json synchronisiert, Test generator-sync", 13.11.2026 07:20 +0100)
- Methode: `git archive` des Unterordners `plattform/` (nur versionierte Dateien, ohne Datenordner, ohne Abhängigkeitsordner, ohne Geheimnisse). Der Inhalt von `plattform/` liegt hier im Wurzelordner.
- Nicht enthalten: Ordner `praesentation/` (Marketing), Screenshots, Abnahmeprotokolle des Produktiv-Repos.
- Selbsttest: Der vollständige Lauf `Selbsttest-Alle` war im Quell-Repo am 13.11.2026 grün ("Alle Offline-Tests bestanden", 07:15 Budapest).
- Einzige Abweichung vom Quellstand: In `.gitignore` wurde das Byte-Order-Mark am Anfang der ersten Zeile entfernt, damit `node_modules/` wirklich ignoriert wird. Alles andere ist byte-gleich.
- Secret-Scan der Kopie am 13.11.2026: nur Prüfmuster im Code und offensichtliche Testwerte (längster Wert 34 Zeichen), kein echter Schlüssel.

Erste Pflicht (Gate 0 des Projektplans): Alle bestehenden Tests müssen in dieser Kopie mit Node 24 unverändert bestehen. Erst dann beginnt Arbeitspaket WP1.
