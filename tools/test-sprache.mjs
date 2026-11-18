// Muss die ERSTE Einfuhr jedes sprachabhaengigen Selbsttests sein: die Tests erwarten die ungarische Fassung (Standardsprache der Plattform fuer Gabriella).
// Der Test setzt seine Sprache selbst, es braucht keine Umgebungsvariable von aussen (Etappe B6).
process.env.TEXT_SPRACHE = 'hu';
