// Barrierefreiheit der Handbuch-PDFs (12.11.2026): gemeinsamer Waechter fuer tools/handbuch-bauen.mjs und tools/handbuch-admin-bauen.mjs.
// Laeuft im Bauskript auf der geladenen HTML-Quelle (Druckansicht), BEVOR page.pdf({ tagged: true, outline: true }) das PDF schreibt.
// Bricht den Bau ab (Fehlerliste nicht leer), wenn:
// - <html lang> fehlt oder nicht der Zielsprache entspricht, <title> leer ist,
// - genau ein h1 fehlt oder die Ueberschriften eine Stufe ueberspringen (h1 -> h3),
// - ein Bild keinen Alternativtext hat (leer, nur Dateiname oder "Abb./Fig./ábra"-Kurzform) und nicht ausdruecklich aria-hidden ist,
// - eine Tabellen-Kopfzelle (th) kein scope hat,
// - ein Link keinen sprechenden Text hat,
// - Text den Kontrast nach WCAG 2.1 AA unterschreitet (4,5:1; grosse Schrift ab 18 pt bzw. 14 pt fett 3:1). Hintergrund = erster deckender Hintergrund der Vorfahren.
// Lesezeichen sauber halten (12.11.2026). Chromium baut die PDF-Lesezeichen (outline) aus dem gemalten Text der Ueberschriften. Zwei Eigenheiten
// (gemessen mit Chrome 14x / Playwright 1.64, Versuche im Bau-Protokoll):
// 1) An einem weichen Zeilenumbruch faellt das Leerzeichen weg ("Handbuch fürKäuferinnen undKäufer"). Mit white-space:break-spaces bleibt es
//    erhalten; fuer den Deckblatt-Titel ist das Bild pixelgleich (die Umbruchstellen aendern sich nicht). Der Waechter unten prueft das bei jedem Bau.
// 2) Der Stern vor "Schnellstart" (Zierzeichen in span.nr) kommt aus einer Ersatzschrift (Segoe UI Symbol); Chromium legt dafuer ein zweites
//    H2-Strukturelement an, das Lesezeichen heisst dann "★★ Schnellstart". Loesung: Zierzeichen (kein Buchstabe, keine Ziffer) wird als
//    CSS-Inhalt (::before, aria-hidden) gemalt, das Leerzeichen danach gleich mit. Sichtbar gleich (Verschiebung < 0,1 px), Lesezeichen
//    "Schnellstart in fünf Schritten", Text im PDF weiter "★ Schnellstart ...". Die HTML-Quelle bleibt unveraendert (Tests und Praesentation lesen sie).
// Bricht ab (Fehlerliste), wenn sich dadurch Hoehe/Zeilen des Titels oder die Lage des Ueberschriftentextes um mehr als 0,5 px aendern.
export async function lesezeichenVorbereiten(page) {
  return page.evaluate(() => {
    const fehler = [];
    const mass = () => {
      const h1 = document.querySelector('h1'), r = h1.getBoundingClientRect();
      const zeilen = h1.getClientRects().length && document.createRange ? (() => { const g = document.createRange(); g.selectNodeContents(h1); return new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size; })() : 0;
      const text = [...document.querySelectorAll('h2.kapitel')].map((h) => { const t = [...h.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); if (!t) return null;
        const g = document.createRange(), i = t.textContent.search(/\S/); g.setStart(t, i); g.setEnd(t, i + 1); const b = g.getBoundingClientRect(); return [b.left, b.top]; });
      return { h: r.height, w: r.width, zeilen, text };
    };
    const vorher = mass();
    const st = document.createElement('style');
    st.textContent = '.deckblatt h1{white-space:break-spaces} h2.kapitel .nr[data-zier]::before{content:attr(data-zier) " "}';
    document.head.append(st);
    for (const nr of document.querySelectorAll('h2.kapitel > .nr')) {
      const z = nr.textContent.trim();
      if (!z || /[\p{L}\p{N}]/u.test(z)) continue;   // Ziffern ("1", "12") bleiben Text
      nr.dataset.zier = z; nr.textContent = ''; nr.setAttribute('aria-hidden', 'true');
      const t = nr.nextSibling; if (t && t.nodeType === 3) t.textContent = t.textContent.replace(/^\s+/, '');
    }
    const nachher = mass();
    if (Math.abs(nachher.h - vorher.h) > 0.5 || Math.abs(nachher.w - vorher.w) > 0.5 || nachher.zeilen !== vorher.zeilen) fehler.push('Deckblatt-Titel veraendert: ' + JSON.stringify({ vorher, nachher }).slice(0, 200));
    vorher.text.forEach((a, i) => { const b = nachher.text[i]; if (a && b && (Math.abs(a[0] - b[0]) > 0.5 || Math.abs(a[1] - b[1]) > 0.5)) fehler.push('Kapiteltitel verschoben: ' + (i + 1) + ' ' + JSON.stringify([a, b])); });
    return fehler;
  });
}

export async function barrierefreiFehler(page, sprache) {
  return page.evaluate((sprache) => {
    const fehler = [];
    const lang = document.documentElement.getAttribute('lang') || '';
    if (lang.toLowerCase() !== sprache) fehler.push('html lang="' + lang + '" statt "' + sprache + '"');
    if (!document.title.trim()) fehler.push('<title> leer');
    const h = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    if (document.querySelectorAll('h1').length !== 1) fehler.push('Anzahl h1 = ' + document.querySelectorAll('h1').length);
    let vorher = 0;
    for (const el of h) { const s = Number(el.tagName[1]); if (s > vorher + 1) fehler.push('Ueberschrift springt von h' + vorher + ' auf ' + el.tagName + ': ' + el.textContent.trim().slice(0, 40)); vorher = s; }
    for (const img of document.images) {
      if (img.closest('[aria-hidden=true]') || img.getAttribute('role') === 'presentation') continue;
      const alt = (img.getAttribute('alt') || '').trim(), datei = (img.getAttribute('src') || '').split('/').pop();
      if (alt.length < 15) fehler.push('Alt-Text fehlt oder zu kurz: ' + datei);
      else if (alt.includes(datei) || /\.(png|jpe?g|svg|webp)\b/i.test(alt)) fehler.push('Alt-Text ist ein Dateiname: ' + datei);
    }
    for (const th of document.querySelectorAll('th')) if (!th.getAttribute('scope')) { fehler.push('th ohne scope: ' + th.textContent.trim().slice(0, 30)); break; }
    for (const a of document.querySelectorAll('a')) if (a.textContent.replace(/\s+/g, ' ').trim().length < 3 || /^(hier|here|itt|link|mehr|more)$/i.test(a.textContent.trim())) fehler.push('Link ohne sprechenden Text: ' + a.getAttribute('href'));
    const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const hintergrund = (el) => { for (let e = el; e; e = e.parentElement) { const m = getComputedStyle(e).backgroundColor.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return getComputedStyle(e).backgroundColor; } return 'rgb(255, 255, 255)'; };
    const kontrast = new Map();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement, cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const l1 = lum(cs.color), l2 = lum(hintergrund(el)), k = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const pt = parseFloat(cs.fontSize) * 0.75, gross = pt >= 18 || (Number(cs.fontWeight) >= 700 && pt >= 14);
      if (k < (gross ? 3 : 4.5)) kontrast.set(el.tagName + '.' + el.className + ' ' + cs.color + ' ' + k.toFixed(2) + ':1', 1);
    }
    for (const k of kontrast.keys()) fehler.push('Kontrast zu gering: ' + k);
    return fehler;
  }, sprache);
}
