// S2: ausschließlich festgelegte Mustertexte, keine Kundendaten oder Medien.
export const BEISPIELE = {
  planen: {
    preis_cent: 4900, gratis: false,
    de: { titel: 'Dein Online-Angebot planen', beschreibung: 'Entwickle aus deinem Wissen ein verständliches Lernangebot. Beginne mit einem klaren Ziel.', lektionen: [{ titel: 'Deine Zielgruppe', text: 'Überlege, wem du helfen möchtest. Notiere drei typische Fragen deiner Zielgruppe. Formuliere anschließend ein konkretes Lernergebnis.' }] },
    en: { titel: 'Plan Your Online Offering', beschreibung: 'Turn your expertise into a clear learning experience. Start with one practical goal.', lektionen: [{ titel: 'Your Audience', text: 'Identify the people you want to help. Write down three questions they often ask. Define one achievable learning outcome.' }] },
    hu: { titel: 'Tervezze meg online ajánlatát', beschreibung: 'Alakítsa tudását érthető tananyaggá. Kezdje egy világos céllal.', lektionen: [{ titel: 'Célközönség', text: 'Gondolja át, kiknek szeretne segíteni. Írjon le három gyakori kérdést, majd fogalmazzon meg egy elérhető tanulási célt.' }] },
  },
  video: {
    preis_cent: 7900, gratis: false,
    de: { titel: 'Lernvideos verständlich gestalten', beschreibung: 'Gute Videos vermitteln eine klare Botschaft. Kurze Abschnitte helfen beim Lernen.', lektionen: [{ titel: 'Ein Video strukturieren', text: 'Beginne mit dem Lernziel. Erkläre einen Gedanken, zeige ein Beispiel und schließe mit einer kleinen Übung.' }] },
    en: { titel: 'Create Clear Learning Videos', beschreibung: 'Effective videos focus on one message. Short sections make learning easier.', lektionen: [{ titel: 'Video Structure', text: 'State the learning goal. Explain one idea, demonstrate an example, and finish with a short exercise.' }] },
    hu: { titel: 'Készítsen érthető oktatóvideókat', beschreibung: 'A jó videó egyértelmű üzenetet közvetít. A rövid részek segítik a tanulást.', lektionen: [{ titel: 'Egy előadás felépítése', text: 'Mutassa be a célt, magyarázzon el egy gondolatot, hozzon példát, végül adjon rövid feladatot.' }] },
  },
  plattform: {
    preis_cent: 0, gratis: true,
    de: { titel: 'So funktioniert diese Plattform', beschreibung: 'Entdecke den Aufbau eines Online-Kurses. Dieses Angebot dient ausschließlich als Beispiel.', lektionen: [{ titel: 'Dein Lernbereich', text: 'Hier findest du Lektionen, Dateien und deinen Fortschritt. Dies ist eine Vorschau ohne Registrierung oder Kauf.' }] },
    en: { titel: 'Explore This Learning Platform', beschreibung: 'Discover how online courses are organized. This content is for demonstration only.', lektionen: [{ titel: 'Your Learning Area', text: 'Find lessons, files, and progress information here. This preview requires no registration or purchase.' }] },
    hu: { titel: 'Így működik ez a tanulási platform', beschreibung: 'Ismerje meg az online előadások felépítését. Ez kizárólag bemutatóanyag.', lektionen: [{ titel: 'Tanulási felület', text: 'Itt találhatók a leckék, fájlok és a haladási információk. A bemutatóhoz nem szükséges regisztráció vagy vásárlás.' }] },
  },
};
export function tr(key, sprache) {
  const beispiel = Object.hasOwn(BEISPIELE, key) ? BEISPIELE[key] : null;
  return beispiel ? (['de', 'en', 'hu'].includes(sprache) ? beispiel[sprache] : beispiel.de) : null;
}
