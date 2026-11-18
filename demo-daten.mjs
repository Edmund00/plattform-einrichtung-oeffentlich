// Erfundene Beispielkurse (Deutsch). Nur Demo-Inhalt, keine echten Daten, nichts von einem Kunden. Gemeinsam genutzt von tools/muster-inhalt.mjs und demo.mjs (DEMO_MODUS).
export const KURSE = [
  { titel: 'Musterkurs: Stripe Billing in der Praxis', preis: 64900,
    beschreibung: 'Von der ersten Rechnung bis zum automatischen Abo: Dieser Beispielkurs zeigt, wie Zahlungen, Belege und Erstattungen in einer eigenen Kursplattform zusammenspielen. Alle Daten sind erfunden, bezahlt wird nur mit Testkarten.',
    nutzen: 'Zahlungsablauf vom Kauf bis zum Zugang verstehen\nBelege und Kaufmails nachvollziehen\nWiderruf und Erstattung sicher abwickeln\nSofort anwendbare Checklisten für den Alltag',
    lektionen: [['Einführung', 'Willkommen', 'Willkommen im Musterkurs. Hier siehst du, was nach dem Kauf freigeschaltet wird: Lektionen mit Text, später auch Video, PDF und Audio.'], ['Abrechnung', 'Wie ein Abo entsteht', 'Kunde, Produkt, Preis, Abo, Rechnung. Der Zugang entsteht erst durch die signierte Bestätigung des Zahlungsanbieters, nicht durch die Erfolgsseite.'], ['Zahlungen', 'Zahlung, Beleg, Erstattung', 'Was passiert bei einer Zahlung, welcher Beleg entsteht, und wie läuft eine Erstattung ab.']] },
  { titel: 'Muster: Online-Kurse professionell verkaufen', preis: 29000,
    beschreibung: 'Ein kompakter Leitfaden für Trainer und Akademien: Angebot formulieren, Preis festlegen, Kaufweg verständlich gestalten und Teilnehmer ohne Handarbeit freischalten.',
    nutzen: 'Angebot und Preis klar formulieren\nKaufweg ohne Rückfragen gestalten\nTeilnehmer automatisch freischalten\nRechtliche Pflichtangaben im Überblick',
    lektionen: [['Grundlagen', 'Das Angebot schärfen', 'Für wen ist der Kurs, welches Ergebnis bekommen Teilnehmer, und was ist enthalten?'], ['Grundlagen', 'Preis und Kaufweg', 'Preisrahmen, Zahlungsarten und die wichtigsten Angaben vor dem Kauf.'], ['Betrieb', 'Freischaltung und Betreuung', 'Wie Teilnehmer nach der Zahlung automatisch Zugang erhalten.']] },
  { titel: 'Muster: Kundenbetreuung und Erstattungen', preis: 14900,
    beschreibung: 'Wie du Fragen, Widerrufe und Erstattungen freundlich und rechtssicher beantwortest, ohne jede Zahlung von Hand zu prüfen.',
    nutzen: 'Widerrufe sicher bearbeiten\nTeil- und Vollerstattungen unterscheiden\nMustertexte für Kundenantworten\nProbleme früh erkennen',
    lektionen: [['Grundlagen', 'Widerruf und Frist', 'Wann ein Widerruf möglich ist und was dabei automatisch passiert.'], ['Praxis', 'Erstattungen erklären', 'Teilerstattung, Vollerstattung und Zugang nach der Erstattung.'], ['Praxis', 'Antworten an Kunden', 'Freundliche Mustertexte für typische Fragen.']] },
];
// Block 3 (12.11.2026): Download-Produkt "Handbuch" (Kaeufer). Wird NUR angelegt, wenn alle drei PDFs (de, en, hu) in handbuch/ausgabe liegen (demo.mjs).
// Einmalkauf 9 EUR, eine PDF-Lektion mit download_erlaubt = 1. Uebersetzungen EN/HU in demo-uebersetzung.mjs (HU noch NICHT abgenommen).
export const HANDBUCH = { titel: 'Handbuch für Käuferinnen und Käufer', preis: 900,
  beschreibung: 'Das Handbuch zur Plattform als PDF zum Herunterladen: Registrierung, Kauf, Zugang zu den Kursen, Belege, Widerruf und Konto, Schritt für Schritt erklärt. Nach der Zahlung kannst du es herunterladen und behalten.',
  nutzen: 'Alle Schritte vom Konto bis zum Kurszugang\nKauf, Beleg und Widerruf verständlich erklärt\nPDF zum Herunterladen und Behalten\nIn deiner Sprache: Deutsch, Englisch oder Ungarisch',
  lektion: ['Handbuch', 'Handbuch als PDF', 'Hier lädst du das Handbuch als PDF herunter. Du bekommst die Fassung in der Sprache deiner Bestellung.'],
  dateien: { de: 'handbuch-kaeufer-de.pdf', en: 'handbuch-kaeufer-en.pdf', hu: 'handbuch-kaeufer-hu.pdf' } };
// Zweites Download-Produkt (12.11.2026, Entscheidung ChatGPT + Claude): das Admin-Handbuch, Einmalkauf 19 EUR, gleiche Mechanik wie HANDBUCH.
// Wird NUR angelegt, wenn alle drei PDFs handbuch-admin-<l>.pdf echte PDFs sind. Uebersetzungen EN/HU in demo-uebersetzung.mjs (HU noch NICHT abgenommen).
export const HANDBUCH_ADMIN = { titel: 'Handbuch für den Admin-Bereich', preis: 1900,
  beschreibung: 'Das Handbuch zum Admin-Bereich der Plattform als PDF zum Herunterladen: Kurse und Lektionen anlegen, veröffentlichen, Bestellungen und Zugänge, Erstattungen und Widerruf, Kunden, Ereignisse, Verkauf pausieren und Datensicherung, Schritt für Schritt erklärt. Nach der Zahlung kannst du es herunterladen und behalten.',
  nutzen: 'Alle Funktionen des Admin-Bereichs im Überblick\nKurse, Lektionen und Medien Schritt für Schritt anlegen\nBestellungen, Zugänge und Erstattungen verständlich erklärt\nPDF zum Herunterladen und Behalten, auf Deutsch, Englisch oder Ungarisch',
  lektion: ['Handbuch', 'Admin-Handbuch als PDF', 'Hier lädst du das Handbuch für den Admin-Bereich als PDF herunter. Du bekommst die Fassung in der Sprache deiner Bestellung.'],
  dateien: { de: 'handbuch-admin-de.pdf', en: 'handbuch-admin-en.pdf', hu: 'handbuch-admin-hu.pdf' } };
// Reihenfolge = Reihenfolge der Kurs-IDs in einer leeren Demo: Kaeufer-Handbuch Kurs 4, Admin-Handbuch Kurs 5 (die Praesentation verlinkt #/kurs/4 und #/kurs/5).
export const HANDBUECHER = [HANDBUCH, HANDBUCH_ADMIN];
