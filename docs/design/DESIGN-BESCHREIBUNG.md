# VALORE: Design-Beschreibung (aus dem echten Code)

Quelle: Repo Edmund00/valorebusinessclub, Branch main, Stand 746c3f8 (31.10.2026); Live-Seite https://valorebusinessclub.com/ zum Vergleich. Nur gelesen, nichts geändert. Alles hier ist aus dem Code oder von der Live-Seite gelesen. Was ich nicht gefunden habe, steht als "nicht gefunden".

WICHTIG: Im Repository gibt es mehrere Stil-Familien. Für eine neue Plattform ist der **Haupt-Stil** gemeint: Gold und Elfenbein mit Jost und Cormorant Garamond (Startseite, Shop, Szintanácsadás). Abweichungen stehen in Abschnitt 13.

Inhalt der ZIP: css/ (echte CSS-Dateien), fonts/ (selbst gehostete woff2), logos/, referenz/startseite-struktur.html, design-tokens.css, diese Datei.


## 1. FARBEN

Variablen der Startseite:

```css
:root{--black:#000;--night:#0d0a05;--gold:#d4a843;--gold-d:#a87c2a;--ivory:#faf6ee;--ink:#211a0e;--line:#e7ddc9}
```

Benutzung:
- Seitenhintergrund hell: --ivory #faf6ee. Weiß (#fff): Navigation, Gründer-Abschnitt, Kontakt, Karten.
- Dunkel: --black #000 (Hero, Footer), --night #0d0a05 (Abschnitt "Personal Image", Cookie-Banner).
- Text: --ink #211a0e. Zweittext in Karten #4c4232. Auf dunklem Grund #e9e2d2, Footer-Text #b8ad94.
- Überschriften: --ink, auf dunklem Grund Weiß. Betonung (em): kursiv, auf Schwarz --gold, auf Hell --gold-d.
- Links: --gold-d. Hover in der Navigation: --gold-d.
- Knöpfe: Verlauf linear-gradient(100deg,var(--gold),var(--gold-d)), Schrift #000.
- Linien: --line. Akzent und Fokus: --gold (Fokusrahmen 3px, ::selection --gold mit schwarzem Text).
- Fehler: Hinweisfeld #fbeeee / Rand #e3bcbc / Text #8b2f2f. Meldung im Formular: #c0392b mit weißem Text. Erfolg: #eef7ee / #bcd9bc / #2e6b2e. WhatsApp: #25D366 mit Weiß.
- Nav-Eintrag "Hamarosan": #999.

Farbpaare: Gold auf Schwarz (h1 em, Ghost-Knopf); Schwarz auf Gold-Verlauf (gefüllte Knöpfe); Elfenbein auf Schwarz (Hero-Text); --gold-d auf Elfenbein oder Weiß (Eyebrow, Chip, Links); Weiß auf #25D366.

Shop zusätzlich: --gold-l #e8c777, --soft #7d7362, --white #fff, --grad (linear-gradient(120deg,#a87c2a,#e8c777 48%,#d4a843)), --shadow (0 24px 50px -30px rgba(20,14,8,.45)). Nicht gefunden: Variablen für Fehler, Erfolg, Hover.


## 2. SCHRIFTEN

Selbst gehostet über css/fonts.css, je Familie zwei Dateien (latin, latin-ext, per unicode-range), font-display: swap:
- Cormorant Garamond: normal 400-700 (cormorant-garamond-normal-latin.woff2, -latin-ext.woff2), kursiv 400-500 (cormorant-garamond-italic-latin.woff2, -latin-ext.woff2)
- Jost: 300-600 (jost-latin.woff2, jost-latin-ext.woff2)
- Montserrat: 300-600 (montserrat-latin.woff2, -latin-ext.woff2)
- Bricolage Grotesque: 400-800 (bricolage-grotesque-latin.woff2, -latin-ext.woff2)
- Inter: 400-700 (inter-latin.woff2, inter-latin-ext.woff2)

Die Startseite benutzt nur Jost (Fließtext) und Cormorant Garamond (Überschriften).

```css
body{font-family:'Jost',sans-serif;font-weight:300;color:var(--ink);background:var(--ivory);line-height:1.7;font-size:17px}
h1{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:clamp(34px,5vw,56px);line-height:1.14;max-width:21ch;margin:0 auto}
h1 em{font-style:italic;color:var(--gold)}
h2{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:clamp(29px,3.4vw,42px);line-height:1.15;margin-bottom:16px}
h2 em{font-style:italic;color:var(--gold-d)}
.club-card h3{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;margin:14px 0 8px}
.club-card p{font-size:15.5px;color:#4c4232}
.hero p.lead{margin:24px auto 0;font-size:18px;max-width:54ch;color:#e9e2d2}
.eyebrow{font-size:12px;letter-spacing:.3em;text-transform:uppercase;color:var(--gold-d);font-weight:600;margin-bottom:16px}
.navlinks a{font-size:12.5px;letter-spacing:.12em;text-transform:uppercase;text-decoration:none;color:var(--ink);font-weight:500;white-space:nowrap}
.chip{align-self:flex-start;font-size:10.5px;letter-spacing:.24em;text-transform:uppercase;font-weight:600;color:var(--gold-d);border:1px solid var(--gold);border-radius:30px;padding:4px 12px}
.ct-form input,.ct-form textarea{width:100%;background:var(--ivory);border:1px solid var(--line);border-radius:12px;padding:13px 15px;font-family:'Jost',sans-serif;font-size:15px;color:var(--ink);transition:border-color .2s}
.lead-form-wrapper .formline label{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-d);font-weight:600;margin-bottom:6px}
```

Weitere Größen: Impressum 14.5px (Hinweis 13.5px), Footer 13px, Sprachknöpfe 11.5px/600. Handy: Überschriften sind fließend (clamp), Mobil-Navigation 14px (bis 1000px), bis 430px Logo 36px hoch und Sprachknöpfe 11px. Eigene Mobil-Schriftgrößen für den Fließtext: nicht gefunden. h3 in den Link-Karten: Cormorant 600, 24px, Zeilenhöhe 1.25.


## 3. KNÖPFE

```css
.cta{display:inline-block;padding:15px 34px;background:linear-gradient(100deg,var(--gold),var(--gold-d));color:#000;text-decoration:none;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;border-radius:40px;transition:transform .2s,box-shadow .2s}
.cta:hover{transform:translateY(-2px);box-shadow:0 14px 28px -12px rgba(212,168,67,.55)}
.cta.ghost{background:transparent;color:var(--gold);border:1px solid var(--gold)}
.linkbtn{display:inline-block;align-self:flex-start;margin-top:10px;padding:11px 26px;background:linear-gradient(100deg,var(--gold),var(--gold-d));color:#000;text-decoration:none;font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;border-radius:40px;transition:transform .2s,box-shadow .2s}
.linkbtn:hover{transform:translateY(-2px);box-shadow:0 12px 24px -10px rgba(212,168,67,.55)}
.wa{display:inline-flex;align-items:center;gap:10px;padding:16px 36px;background:#25D366;color:#fff;text-decoration:none;font-size:15px;letter-spacing:.06em;font-weight:600;border-radius:40px;transition:transform .2s,box-shadow .2s}
.wa:hover{transform:translateY(-2px);box-shadow:0 14px 28px -12px rgba(37,211,102,.5)}
.wa svg{width:22px;height:22px;flex-shrink:0}
a:focus-visible,button:focus-visible{outline:3px solid var(--gold);outline-offset:3px;border-radius:2px}
.lead-form-wrapper .myformsubmit{margin-top:14px;padding:15px 34px;font-family:'Jost',sans-serif;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:#000;background:linear-gradient(100deg,var(--gold),var(--gold-d));border:none;border-radius:40px;cursor:pointer;transition:transform .2s,box-shadow .2s}
.lead-form-wrapper .myformsubmit:hover{transform:translateY(-2px);box-shadow:0 14px 28px -12px rgba(212,168,67,.55)}
```

Shop-Varianten (aus shop/style.css), inklusive deaktiviert:

```css
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:'Jost',sans-serif;font-weight:600;font-size:13px;letter-spacing:.16em;text-transform:uppercase;padding:15px 34px;border-radius:40px;cursor:pointer;border:1px solid transparent;transition:.2s;text-align:center}
.btn-gold{background:linear-gradient(100deg,var(--gold),var(--gold-d));color:#000}
.btn-gold:hover{transform:translateY(-2px);box-shadow:0 14px 28px -12px rgba(212,168,67,.55);color:#000}
.btn-dark{background:var(--black);color:var(--gold-l);border-color:var(--black)}
.btn-out{background:transparent;color:var(--ink);border-color:var(--gold)}
.btn-ghost{background:transparent;color:var(--gold-l);border-color:rgba(212,168,67,.35)}
.btn.full{width:100%}
.btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
```

Nicht gefunden: ein deaktivierter Knopf in der Startseiten-CSS (nur im Shop).


## 4. KARTEN UND ABSCHNITTE

```css
.wrap{max-width:1060px;margin:0 auto;padding:0 22px}
section{padding:86px 0}
.club-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:38px}
.club-card{background:var(--ivory);padding:34px 30px}
.links-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:40px}
.linkcard{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 28px 26px;display:flex;flex-direction:column;gap:8px;transition:border-color .2s,transform .2s,box-shadow .2s}
.linkcard:hover{border-color:var(--gold);transform:translateY(-3px);box-shadow:0 18px 36px -24px rgba(33,26,14,.35)}
.founder .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:54px;align-items:center}
.buyer-type-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 24px;text-align:center;cursor:pointer;transition:border-color .2s,transform .2s,box-shadow .2s;position:relative}
.buyer-type-card:hover{border-color:var(--gold);transform:translateY(-3px);box-shadow:0 18px 36px -24px rgba(33,26,14,.35)}
.lead-form-wrapper{max-width:600px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:18px;padding:40px;display:none}
.color-sec{background:var(--night);color:var(--ivory)}
.contact{background:#fff;text-align:center}
.imp{background:var(--ivory);border-top:1px solid var(--line);padding:70px 0}
```

Shop-Karte (nächste Entsprechung zu Produkt- oder Kurskarte):

```css
.wrap{max-width:1150px;margin:0 auto;padding:0 24px}
.sec{padding:64px 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;transition:transform .3s,box-shadow .3s,border-color .3s}
.card:hover{transform:translateY(-5px);box-shadow:var(--shadow);border-color:var(--gold)}
.card .top{position:relative;aspect-ratio:16/10;background:#f1ece0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.card .body{padding:20px;display:flex;flex-direction:column;flex:1}
.card h3{font-size:22px;margin-bottom:8px}
.card .price{margin-top:auto;font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:var(--ink);margin-bottom:12px}
.tag{position:absolute;top:12px;left:12px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;padding:5px 10px;border-radius:20px;background:rgba(255,255,255,.92);color:var(--ink)}
.status{position:absolute;top:12px;right:12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:20px;background:rgba(13,10,5,.75);color:var(--gold-l)}
.note{background:#fff;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:6px;padding:14px 18px;font-size:14px;color:var(--soft);margin:18px 0}
```

Paketkarte (szintanacsadas, dunkler Grund):

```css
.price-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-top:40px}
.price{background:rgba(255,255,255,.04);border:1px solid rgba(212,168,67,.3);border-radius:16px;padding:26px 28px;display:flex;flex-direction:column;gap:6px}
.price .nm{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:#fff;line-height:1.25}
.price .ds{font-size:14.5px;color:#cfc6b4;flex:1}
.price .amt{font-size:24px;font-weight:600;color:var(--gold);margin-top:8px;font-family:'Cormorant Garamond',serif}
.price.feat{border-color:var(--gold);background:rgba(212,168,67,.08)}
.price .badge{align-self:flex-start;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:#000;background:var(--gold);border-radius:20px;padding:3px 12px;margin-bottom:4px}
```


## 5. KOPFBEREICH UND FUSSBEREICH

Kopfzeile: sticky, 70px hoch, weiß, Linie unten; Logo links (44px, bis 430px 36px), rechts Navigation, Sprachumschalter HU/IT/EN/RO/DE und Burger-Menü. Im CSS keine Veränderung beim Scrollen (kein Schrumpfen oder Verstecken). Navigationspunkte: A Klub, Az alapító, Personal Image, Klubnapok & elérhetőségek, Kapcsolatépítő Klub, Webshop, Magazin (Badge Hamarosan), Kapcsolat.

```css
nav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--line)}
nav .wrap{display:flex;align-items:center;justify-content:space-between;height:70px;gap:12px;position:relative}
.brand img{height:44px;width:auto}
.navright{display:flex;align-items:center;gap:18px}
.navlinks{display:flex;gap:22px}
.langswitch{display:flex;gap:3px;background:var(--ivory);border-radius:30px;padding:4px;border:1px solid var(--line)}
.langswitch button{border:none;background:transparent;cursor:pointer;font-family:'Jost',sans-serif;font-size:11.5px;font-weight:600;letter-spacing:.06em;color:var(--ink);padding:6px 9px;border-radius:20px;transition:background .2s,color .2s}
.langswitch button.active{background:var(--gold);color:#000}
.menubtn{display:none;border:none;background:transparent;cursor:pointer;padding:10px 6px}
.menubtn span{display:block;width:23px;height:2px;background:var(--ink);margin:5px 0;border-radius:2px;transition:transform .25s,opacity .25s}
footer{background:var(--black);color:#b8ad94;padding:44px 0 40px;text-align:center;font-size:13px}
footer img{width:240px;margin:0 auto 18px}
```

Mobil-Menü (Breakpoint 1000px der Startseite):

```css
@media(max-width:1000px){.menubtn{display:block} .navlinks{display:none;position:absolute;top:70px;left:0;right:0;background:#fff;border-bottom:1px solid var(--line);flex-direction:column;gap:0;padding:6px 22px 14px;box-shadow:0 20px 32px -22px rgba(0,0,0,.35)} .navlinks.open{display:flex} .navlinks a{padding:13px 0;border-bottom:1px solid var(--line);font-size:14px} .navlinks a:last-child{border-bottom:none}}
```

Shop-Fußzeile (4 Spalten):

```css
footer.site{background:linear-gradient(180deg,#0d0a05,#000);color:#a2977f;padding:56px 0 28px;border-top:1px solid rgba(212,168,67,.25)}
footer.site .cols{display:grid;grid-template-columns:1.6fr 1fr 1fr 1fr;gap:30px;margin-bottom:34px}
footer.site h4{font-family:'Jost',sans-serif;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold-l);margin-bottom:14px;font-weight:600}
footer.site a{color:#a2977f;font-size:13.5px}
footer.site a:hover{color:var(--gold-l)}
footer.site .copy{border-top:1px solid rgba(212,168,67,.2);padding-top:22px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#776e5c}
```


## 6. FORMULARE

```css
.ct-form{max-width:480px;margin:34px auto 0;display:flex;flex-direction:column;gap:12px;text-align:left}
.ct-form input,.ct-form textarea{width:100%;background:var(--ivory);border:1px solid var(--line);border-radius:12px;padding:13px 15px;font-family:'Jost',sans-serif;font-size:15px;color:var(--ink);transition:border-color .2s}
.ct-form input:focus,.ct-form textarea:focus{outline:none;border-color:var(--gold)}
.ct-note{border-radius:12px;padding:12px 16px;font-size:14px;text-align:center}
.ct-note.ok{background:#eef7ee;border:1px solid #bcd9bc;color:#2e6b2e}
.ct-note.err{background:#fbeeee;border:1px solid #e3bcbc;color:#8b2f2f}
.lead-form-wrapper{max-width:600px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:18px;padding:40px;display:none}
.lead-form-wrapper .formline label{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--gold-d);font-weight:600;margin-bottom:6px}
.lead-form-wrapper .myformtext{padding:12px 14px;font-size:15px;font-family:'Jost',sans-serif;color:var(--ink);border:1px solid var(--line);background:var(--ivory);width:100%;border-radius:10px}
.lead-form-wrapper .myformtext:focus{outline:none;border-color:var(--gold)}
.lead-form-wrapper #privacydiv-company,.lead-form-wrapper #privacydiv-csave{display:flex;align-items:flex-start;gap:10px;padding:14px;background:var(--ivory);border-radius:10px;margin-top:6px}
.lead-form-wrapper .error-message{display:none;background:#c0392b;color:#fff;padding:12px 16px;border-radius:10px;font-size:13.5px;margin-top:10px}
```

Shop-Felder:

```css
.field{margin-bottom:14px}
.field label{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--soft);margin-bottom:6px}
.field input,.field textarea{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:6px;font-family:'Jost',sans-serif;font-size:15px;background:#fff}
```

Nicht gefunden: eigene Fehler-Umrandung am Eingabefeld (Fehler erscheint als Meldung); CSS für select-Felder.


## 7. LOGOS UND BILDER

Dateien in logos/ (aus brand-assets/logos und Root):
- Valore_Horizontal_Logo_RGB_Transparent_5000px.png (5000x1695, transparent)
- Valore_Vertical_Logo_RGB_Transparent_5000px.png (5000x5000, transparent)
- logo-og-share.jpg (1200x630, Share-Bild, og:image) und logo-og.jpg (800x800)
Im Repo außerdem (hier nicht enthalten, zu groß): weiße JPG-Fassungen und Valore_Logos_CMYK.ai/.pdf.

Startseite: die Bilder sind als Base64-JPEG eingebettet (verkleinerte Fassungen, nicht byte-gleich mit den Dateien): Kopf 520x176 (angezeigt 44px hoch, 36px bis 430px), Hero 720x902 (Breite min(420px,72vw)), Gründerin 680x1021, Kontaktkarte 640x640 (max. 320px), Footer 480x295 (240px breit). Favicon: SVG, schwarzes Quadrat (rx 14) mit goldenem "V" (#d4a843, Georgia).

```css
.hero img.logo{width:min(420px,72vw);margin:0 auto 8px}
.founder .photo img{width:100%;height:auto;border-radius:18px;border:1px solid var(--line);box-shadow:0 30px 60px -32px rgba(33,26,14,.45)}
.founder .photo::after{content:"";position:absolute;inset:14px -14px -14px 14px;border:1px solid var(--gold);border-radius:18px;z-index:-1}
.contact .logocard img{width:100%;border-radius:18px;border:1px solid var(--line)}
```

Event-Seite (zweiter Stil): Bilder in weißem Rahmen mit 3px Goldrand, 10px Innenabstand, leichter Grauton, beim Darüberfahren farbig. Herkunft der eingebetteten JPEGs: nicht gefunden.


## 8. RASTER UND BREAKPOINTS

Benannte Breakpoints (Handy/Tablet/Desktop) gibt es nicht. Startseite: 1000 (Burger-Menü), 820 (Gründer einspaltig), 740 (Link-Karten einspaltig), 680 (Klub-Raster einspaltig), 640 (Anmeldeart einspaltig), 600 (Formular-Abstand kleiner), 560 (Impressum einspaltig), 430 (kleineres Logo und Sprachknöpfe). Shop: 900, 860, 820, 760, 600, 520, 480, 430, 360. Event-Seite: 480, 600, 768, 800, 900.

Alle @media-Regeln der Startseite:

```css
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
@media(max-width:1000px){.menubtn{display:block} .navlinks{display:none;position:absolute;top:70px;left:0;right:0;background:#fff;border-bottom:1px solid var(--line);flex-direction:column;gap:0;padding:6px 22px 14px;box-shadow:0 20px 32px -22px rgba(0,0,0,.35)} .navlinks.open{display:flex} .navlinks a{padding:13px 0;border-bottom:1px solid var(--line);font-size:14px} .navlinks a:last-child{border-bottom:none}}
@media(max-width:430px){.brand img{height:36px}.langswitch button{padding:5px 7px;font-size:11px}}
@media(max-width:680px){.club-grid{grid-template-columns:1fr}}
@media(max-width:820px){.founder .grid{grid-template-columns:1fr;gap:36px}}
@media(max-width:740px){.links-grid{grid-template-columns:1fr}}
@media(max-width:560px){.imp .irow{grid-template-columns:1fr}}
@media(max-width:430px){.va-nudge{right:84px;bottom:28px}}
@media(max-width:430px){.va-fab{bottom:16px;right:16px}.va-panel{bottom:84px;right:16px}}
@media (prefers-reduced-motion: reduce){.reveal{opacity:1;transform:none}}
@media(max-width:640px){.buyer-type-selector{grid-template-columns:1fr}}
@media(max-width:600px){.lead-form-wrapper{padding:26px 20px}}
```


## 9. ANIMATIONEN UND DETAILS

```css
.reveal{opacity:0;transform:translateY(18px);transition:opacity .7s ease,transform .7s ease}
.reveal.in{opacity:1;transform:none}
.goldline{display:inline-block;width:70px;height:2px;background:linear-gradient(90deg,var(--gold),var(--gold-d));border-radius:2px}
.va-fab{position:fixed;bottom:22px;right:22px;z-index:70;width:58px;height:58px;border-radius:50%;border:none;cursor:pointer; background:linear-gradient(135deg,var(--gold),var(--gold-d));color:#000;font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:600; box-shadow:0 12px 28px -8px rgba(212,168,67,.65);transition:transform .2s}
.va-panel{position:fixed;bottom:92px;right:22px;z-index:70;width:min(350px,calc(100vw - 32px));max-height:min(520px,calc(100vh - 130px)); background:#fff;border:1px solid var(--gold);border-radius:18px;box-shadow:0 30px 60px -24px rgba(0,0,0,.45);overflow:hidden;display:flex;flex-direction:column}
.va-q{display:flex;align-items:center;gap:11px;text-align:left;background:var(--ivory);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-family:'Jost',sans-serif;font-size:14px;font-weight:500;color:var(--ink);cursor:pointer;transition:border-color .2s,background .2s,transform .15s}
.va-q svg{width:19px;height:19px;stroke:var(--gold-d);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
```

Weitere Regeln (aus der Startseite):

```css
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
@media (prefers-reduced-motion: reduce){.reveal{opacity:1;transform:none}}
```

Einblenden per IntersectionObserver (Schwelle 0.1, setzt die Klasse in). Cookie-Banner und WhatsApp-Zustimmung: siehe css/consent-manager.css und css/whatsapp-gate.css (Arial, Banner #0d0a05 mit Goldknöpfen, Dialog #fffaf3, Radius 16px, brauner Akzent #b6752f). Icons: eingebettete SVGs (WhatsApp 22px; Assistent 19px, Strichstärke 1.7, --gold-d); Shop: Zeichen ✓; Event-Seite: Emojis. Hintergrundmuster, dunkler Modus (prefers-color-scheme): nicht gefunden.


## 10. TON UND TEXTSTIL

Ungarisch, Du-Form: "Csatlakozz", "Lépj velünk kapcsolatba", "Írj nekünk", "töltsd ki". Die Formen "Ön/Önök" nicht gefunden. Überschriften sind Sätze mit kursiver Gold-Betonung, Knopftexte kurz (2-4 Wörter, oft Ich-Form). Großbuchstaben kommen aus dem CSS (nur eine Überschrift ist von Hand in Großbuchstaben).

Echte Beispiele:
1. Überschrift: "Ahol a kapcsolatokból üzleti eredmények születnek."
2. Unterzeile: "A VALORE Business Club exkluzív közösség vállalkozóknak és döntéshozóknak, akik valódi, értékalapú kapcsolatokat szeretnének építeni."
3. Knopf: "Írj nekünk WhatsAppon" (weitere: "Klubest & jelentkezés", "Megrendelem", "Jelentkezem")
4. Hinweis (Erfolg): "Köszönjük! Üzeneted megérkezett — hamarosan jelentkezünk."
5. Hinweis (Fehler): "Kérlek, töltsd ki a hiányzó mezőket!"


## 11. SEITENAUFBAU DER STARTSEITE

1. nav (weiß #fff, sticky)
2. header.hero #top (Schwarz #000; Logo, H1, zwei Knöpfe)
3. section #klub "Miért a VALORE?" (Elfenbein; 2-spaltiges Kartenraster)
4. section.founder #alapito (weiß; Foto und Text)
5. section.color-sec #personalimage (Nachtschwarz #0d0a05; zentrierter Text)
6. section #linkek "Minden fontos kapcsolat egy helyen" (Elfenbein; Link-Karten)
7. section #jelentkezes (Elfenbein; Anmeldeart und Formular)
8. section.contact #kapcsolat (weiß; WhatsApp-Knopf, Kontaktformular)
9. section.imp #impresszum (Elfenbein; Linie oben)
10. footer (Schwarz)
Dazu der schwebende Assistenten-Knopf unten rechts. HTML-Aufbau: referenz/startseite-struktur.html


## 12. SEITE FÜR EINE BEZAHLUNG

Zwei Zahlungsseiten, zwei Designs:

A) szintanacsadas/ (Gold-Stil): Abschnitte nav, hero (Schwarz), story, imagine, pain (Nachtschwarz), services, wide, pricing (#arak, Nachtschwarz, "Válaszd ki, mit szeretnél megrendelni"), gift, steps, contact, footer. Jede Preiskarte hat einen Knopf "Megrendelem" zu einer externen Stripe-Bezahlseite (neuer Tab). Eigene Erfolgs-/Abbruchseiten dafür: nicht gefunden.

```css
.price{background:rgba(255,255,255,.04);border:1px solid rgba(212,168,67,.3);border-radius:16px;padding:26px 28px;display:flex;flex-direction:column;gap:6px}
.price .nm{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;color:#fff;line-height:1.25}
.price .ds{font-size:14.5px;color:#cfc6b4;flex:1}
.price .amt{font-size:24px;font-weight:600;color:var(--gold);margin-top:8px;font-family:'Cormorant Garamond',serif}
.price.feat{border-color:var(--gold);background:rgba(212,168,67,.08)}
.price .badge{align-self:flex-start;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;color:#000;background:var(--gold);border-radius:20px;padding:3px 12px;margin-bottom:4px}
.price .buy-btn{display:inline-block;margin-top:16px;padding:12px 0;text-align:center;background:linear-gradient(100deg,var(--gold),var(--gold-d));color:#000;text-decoration:none;font-size:13px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;border-radius:30px;transition:transform .2s,box-shadow .2s}
.price .buy-btn:hover{transform:translateY(-2px);box-shadow:0 12px 24px -10px rgba(212,168,67,.6)}
.pricing{background:var(--night);color:var(--ivory)}
.cta{display:inline-block;padding:16px 40px;background:linear-gradient(100deg,var(--gold),var(--gold-d));color:#000;text-decoration:none;font-size:13px;letter-spacing:.16em;text-transform:uppercase;font-weight:600;border-radius:40px;transition:transform .2s,box-shadow .2s}
.cta:hover{transform:translateY(-2px);box-shadow:0 16px 30px -12px rgba(212,168,67,.6)}
```

Dankesseite im Gold-Stil: shop/danke.html (zentrierter Text, 18px, und Knopf btn btn-gold "Vissza a boltba"; CSS in css/shop-style.css).

B) balaton/ (türkis, anderes Design): Hero, Anmeldeformular (#jelentkezes), Knopf "Tovább a biztonságos fizetéshez", Preisband; dazu sikeres-fizetes.html ("Sikeres fizetés", Knopf "Vissza a főoldalra") und fizetes-megszakitva.html ("A fizetés nem fejeződött be", "A helyed még nincs lefoglalva.", Knopf "Fizetés újraindítása").

```css
.btn{display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:14px 28px; background:var(--turquoise); color:#fff; font-weight:700; font-size:15px; border:none; border-radius:999px; text-decoration:none; cursor:pointer; box-shadow:0 12px 24px -10px rgba(43,184,172,0.55); transition:transform .18s ease, background .18s ease, box-shadow .18s ease; white-space:nowrap;}
.btn:hover{background:var(--turquoise-dark); transform:translateY(-2px); box-shadow:0 16px 28px -10px rgba(43,184,172,0.6);}
.price-band{background:var(--navy); border-radius:32px; padding:52px 48px; display:grid; grid-template-columns:1.2fr 0.8fr; gap:32px; align-items:center; color:#fff;}
.price-box{background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.18); border-radius:20px; padding:28px; text-align:center;}
.price-box .amount{font-family:'Bricolage Grotesque',sans-serif; font-size:44px; font-weight:800; color:#fff;}
```

```css
.status-section{padding:100px 0; min-height:60vh; display:flex; align-items:center;}
.status-card{max-width:560px; margin:0 auto; text-align:center; background:#fff; border:1px solid var(--line); border-radius:var(--radius-lg); padding:56px 40px; box-shadow:var(--shadow);}
.status-icon{width:64px;height:64px; border-radius:50%; display:flex;align-items:center;justify-content:center; margin:0 auto 22px;}
.status-icon.success{background:var(--sky-deep); color:var(--turquoise-dark);}
.status-icon.cancel{background:#fdeee9; color:#c2542e;}
.status-card h1{font-family:'Bricolage Grotesque',sans-serif; font-size:26px; margin-bottom:14px;}
.status-card p{color:var(--navy-soft); font-size:16px; margin-bottom:10px; line-height:1.6;}
.status-card .btn{margin-top:18px;}
```


## 13. FRAGEN UND LÜCKEN

Mehrere Stile im Repository:
- Haupt-Stil (Gold/Elfenbein, Jost): Startseite, Shop, Szintanácsadás, Elállás.
- Event-Stil (kapcsolatepitoklub/*): Gold #C9A962, Anthrazit #1A1A1A, Creme #F8F6F1, Montserrat, eckige Knöpfe mit 2px Rand, Überschrift bis 6rem (css/kapcsolatepitoklub-inline.css).
- Balaton-Stil: Türkis und Navy, Bricolage Grotesque und Inter, Knöpfe mit Radius 999px (css/balaton-*.css). Auch /adatvedelem/, /impresszum/, /reszveteli-feltetelek/ sind in Navy/Türkis und passen nicht zur Gold-Startseite.
- Weitere: malacpersely/ (dunkel, Inter und Georgia), magazin/ (Gold #C2A14D), szintanacsadas/elallas.html (Arial, brauner Akzent #b6752f). Cookie-Banner und WhatsApp-Dialog: Arial, im Dialog brauner Akzent #b6752f statt Gold.

Live gegen Repo: css/fonts.css und shop/style.css byte-gleich. HTML: Shop identisch; Startseite, szintanacsadas/, balaton/, kapcsolatepitoklub/ weichen nur um wenige Bytes ab (Netlify-Umformungen bei Formularen und Links), kein Unterschied im Aussehen gefunden.

Nicht gefunden oder nicht geprüft: deaktivierter Knopf in der Startseiten-CSS; Kurs-/Lernplattform-Komponenten (nächste Entsprechung: Shop-Karte); mobile Anpassung des Abschnitts-Abstands; Herkunft der eingebetteten JPEGs; welches Logo die Shop-Unterseiten benutzen; ob JavaScript beim Scrollen die Kopfzeile verändert (gefunden wurden nur Scroll-zu-Formular-Aufrufe).

## Zusammenfassung in 5 Sätzen

Das VALORE-Design ist ein edler, ruhiger Stil aus Gold (#d4a843 und dunkleres #a87c2a) auf Elfenbein (#faf6ee), Weiß und Schwarz (#000 und #0d0a05). Überschriften stehen in der hohen Serifenschrift Cormorant Garamond (500, mit kursiver Gold-Betonung), alles andere in der leichten Jost (300, 17px). Knöpfe sind schmale Pillen (Radius 40px) mit Gold-Verlauf, schwarzer Großbuchstaben-Schrift mit viel Buchstabenabstand und leichtem Anheben beim Darüberfahren. Karten sind weiß mit 1px Linie, Radius 18px (Shop 10px) und weichem Schatten, die Abschnitte haben viel Luft (86px) und wechseln zwischen Elfenbein, Weiß und Nachtschwarz. Die Texte duzen kurz und warm auf Ungarisch, und die weiteren Stile im Repository (Event, Balaton, Magazin) sollten für die Kurs-Plattform bewusst nicht gemischt werden.
