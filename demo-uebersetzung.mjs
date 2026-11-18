// Uebersetzungen der erfundenen Beispielkurse (nur Demo-Inhalt). Die Datenbank haelt nur die deutsche Fassung (Seed aus demo-daten.mjs);
// beim LESEN wird sie je nach Anfrage-Sprache ersetzt, aber nur fuer Zeilen, die noch dem deutschen Seed entsprechen (Titel gleich).
// Eigene oder geaenderte Kurse bleiben unveraendert. Reihenfolge der Eintraege = Reihenfolge von KURSE in demo-daten.mjs.
import { KURSE, HANDBUECHER } from './demo-daten.mjs';
// Block 3: die Handbuch-Produkte (Kaeufer, Admin; nur angelegt, wenn alle drei PDFs da sind) werden wie weitere Seed-Kurse uebersetzt (gleiche Regel:
// nur unveraenderte Zeilen). Reihenfolge der Eintraege in UE.*.kurse = KURSE, dann HANDBUECHER.
const ALLE = [...KURSE, ...HANDBUECHER.map((h) => ({ ...h, lektionen: [h.lektion] }))];
import { sprache } from './texte.mjs';

export const VIDEOPROBE_DE = { abschnitt: 'Videoprobe', titel: 'Test-Video (Demo)', inhalt: 'Kurzes Testvideo: so sieht eine Videolektion aus. Das Video liegt geschützt bei Bunny Stream.' };

const UE = {
  en: {
    kurse: [
      { titel: 'Sample course: Stripe Billing in practice',
        beschreibung: 'From the first invoice to the automatic subscription: this example course shows how payments, receipts and refunds work together on your own course platform. All data is fictional; payments are made with test cards only.',
        nutzen: 'Understand the payment flow from purchase to access\nFollow receipts and purchase emails\nHandle withdrawals and refunds safely\nChecklists you can use right away',
        lektionen: [['Introduction', 'Welcome', 'Welcome to the sample course. Here you can see what is unlocked after a purchase: lessons with text, and later video, PDF and audio.'],
          ['Billing', 'How a subscription is created', 'Customer, product, price, subscription, invoice. Access is only granted by the payment provider\'s signed confirmation, not by the success page.'],
          ['Payments', 'Payment, receipt, refund', 'What happens when a payment is made, which receipt is issued, and how a refund works.']] },
      { titel: 'Sample: Selling online courses professionally',
        beschreibung: 'A compact guide for trainers and academies: formulate your offer, set a price, design a clear purchase path and unlock participants without manual work.',
        nutzen: 'Formulate offer and price clearly\nDesign a purchase path without follow-up questions\nGrant participants access automatically\nLegal mandatory information at a glance',
        lektionen: [['Basics', 'Sharpen your offer', 'Who is the course for, what result do participants get, and what is included?'],
          ['Basics', 'Price and purchase path', 'Price range, payment methods and the key information before purchase.'],
          ['Operations', 'Unlocking and support', 'How participants automatically get access after payment.']] },
      { titel: 'Sample: Customer care and refunds',
        beschreibung: 'How to respond to customer questions, withdrawal requests and refund requests in a friendly and legally sound way, without checking every payment by hand.',
        nutzen: 'Handle withdrawals safely\nDistinguish partial and full refunds\nTemplate texts for customer replies\nSpot problems early',
        lektionen: [['Basics', 'Withdrawal and deadline', 'When a withdrawal is possible and what happens automatically.'],
          ['Practice', 'Explaining refunds', 'Partial refund, full refund and access after the refund.'],
          ['Practice', 'Replies to customers', 'Friendly template texts for typical questions.']] },
      { titel: 'Handbook for buyers',
        beschreibung: 'The platform handbook as a PDF to download: registration, purchase, access to courses, receipts, withdrawal and account, explained step by step. After payment you can download it and keep it.',
        nutzen: 'Every step from account to course access\nPurchase, receipt and withdrawal clearly explained\nPDF to download and keep\nIn your language: German, English or Hungarian',
        lektionen: [['Handbook', 'Handbook as PDF', 'Download the handbook as a PDF here. You receive the version in the language of your order.']] },
      { titel: 'Admin area manual',
        beschreibung: 'The manual for the platform\'s admin area as a PDF to download: creating courses and lessons, publishing, orders and access, refunds and withdrawal, customers, events, pausing sales and backups, explained step by step. After payment you can download it and keep it.',
        nutzen: 'All functions of the admin area at a glance\nCreate courses, lessons and media step by step\nOrders, access and refunds clearly explained\nPDF to download and keep, in German, English or Hungarian',
        lektionen: [['Handbook', 'Admin manual as PDF', 'Download the admin area manual as a PDF here. You receive the version in the language of your order.']] },
    ],
    video: { abschnitt: 'Video sample', titel: 'Test video (demo)', inhalt: 'A short test video: this is what a video lesson looks like. The video is stored securely at Bunny Stream.' },
  },
  hu: {
    kurse: [
      { titel: 'Mintaelőadás: Stripe Billing a gyakorlatban',
        beschreibung: 'Az első számlától az automatikus előfizetésig: ez a példaelőadás megmutatja, hogyan működik együtt a fizetés, a bizonylat és a visszatérítés egy saját előadásplatformon. Minden adat kitalált, fizetni csak tesztkártyával lehet.',
        nutzen: 'Megérted a fizetési folyamatot a vásárlástól a hozzáférésig\nKövetni tudod a bizonylatokat és a vásárlási e-maileket\nBiztonságosan kezeled az elállást és a visszatérítést\nAzonnal használható ellenőrző listák a mindennapokra',
        lektionen: [['Bevezetés', 'Üdvözlünk', 'Üdvözlünk a mintaelőadáson. Itt láthatod, mi nyílik meg a vásárlás után: szöveges leckék, később videó, PDF és hang is.'],
          ['Számlázás', 'Hogyan jön létre egy előfizetés', 'Ügyfél, termék, ár, előfizetés, számla. A hozzáférést a fizetési szolgáltató aláírt visszaigazolása adja, nem a sikeroldal.'],
          ['Fizetések', 'Fizetés, bizonylat, visszatérítés', 'Mi történik fizetéskor, milyen bizonylat készül, és hogyan zajlik egy visszatérítés.']] },
      { titel: 'Minta: Online előadások professzionális értékesítése',
        beschreibung: 'Tömör útmutató oktatóknak és akadémiáknak: az ajánlat megfogalmazása, az ár meghatározása, érthető vásárlási út kialakítása, és a résztvevők hozzáférésének kézi munka nélküli biztosítása.',
        nutzen: 'Az ajánlat és az ár világos megfogalmazása\nVásárlási út kialakítása felesleges kérdések nélkül\nAutomatikus hozzáférés biztosítása a résztvevőknek\nA kötelező jogi tájékoztatás áttekintése',
        lektionen: [['Alapok', 'Az ajánlat élesítése', 'Kinek szól az előadás, milyen eredményt kapnak a résztvevők, és mi tartozik bele?'],
          ['Alapok', 'Ár és vásárlási út', 'Árkeret, fizetési módok és a legfontosabb tudnivalók a vásárlás előtt.'],
          ['Működés', 'Hozzáférés és támogatás', 'Hogyan kapnak a résztvevők automatikusan hozzáférést a fizetés után.']] },
      { titel: 'Minta: Ügyfélkezelés és visszatérítések',
        beschreibung: 'Hogyan válaszolj kedvesen és jogszerűen a kérdésekre, az elállásokra és a visszatérítésekre anélkül, hogy minden fizetést kézzel kellene ellenőrizned.',
        nutzen: 'Az elállások biztonságos kezelése\nRészleges és teljes visszatérítés megkülönböztetése\nMintaszövegek az ügyfélválaszokhoz\nA problémák korai felismerése',
        lektionen: [['Alapok', 'Elállás és határidő', 'Mikor lehetséges az elállás, és mi történik közben automatikusan.'],
          ['Gyakorlat', 'A visszatérítések magyarázata', 'Részleges visszatérítés, teljes visszatérítés és a hozzáférés a visszatérítés után.'],
          ['Gyakorlat', 'Válaszok az ügyfeleknek', 'Barátságos mintaszövegek a tipikus kérdésekhez.']] },
      // HU NOCH NICHT ABGENOMMEN: Gabriella bzw. Muttersprachler pruefen (docs/SCHUTZ.md, Abschnitt Block 3).
      { titel: 'Kézikönyv vásárlóknak',
        beschreibung: 'A platform kézikönyve letölthető PDF-ként: regisztráció, vásárlás, hozzáférés az előadásokhoz, bizonylatok, elállás és fiók, lépésről lépésre elmagyarázva. A fizetés után letöltheted és megtarthatod.',
        nutzen: 'Minden lépés a fióktól az előadás eléréséig\nVásárlás, bizonylat és elállás érthetően elmagyarázva\nLetölthető és megtartható PDF\nA te nyelveden: németül, angolul vagy magyarul',
        lektionen: [['Kézikönyv', 'A kézikönyv PDF-ben', 'Itt töltheted le a kézikönyvet PDF-ként. A rendelésed nyelvén kapod meg.']] },
      // HU NOCH NICHT ABGENOMMEN (wie oben). Titel = Titel des ungarischen Admin-PDFs; "előadás" statt "kurzus" wie in der Plattform.
      { titel: 'Kézikönyv az admin felülethez',
        beschreibung: 'A platform admin felületének kézikönyve letölthető PDF-ként: előadások és leckék létrehozása, közzététel, rendelések és hozzáférések, visszatérítések és elállás, vásárlók, események, az értékesítés szüneteltetése és a biztonsági mentés, lépésről lépésre elmagyarázva. A fizetés után letöltheted és megtarthatod.',
        nutzen: 'Az admin felület összes funkciója egy helyen\nElőadások, leckék és médiafájlok létrehozása lépésről lépésre\nRendelések, hozzáférések és visszatérítések érthetően elmagyarázva\nLetölthető és megtartható PDF, németül, angolul vagy magyarul',
        lektionen: [['Kézikönyv', 'Az admin kézikönyv PDF-ben', 'Itt töltheted le az admin felület kézikönyvét PDF-ként. A rendelésed nyelvén kapod meg.']] },
    ],
    video: { abschnitt: 'Videópróba', titel: 'Tesztvideó (demó)', inhalt: 'Rövid tesztvideó: így néz ki egy videós lecke. A videó védetten tárolva van a Bunny Stream szolgáltatónál.' },
  },
};

let an = false;
export const demoUebersetzungAn = (x) => { an = !!x; };   // von app.mjs gesetzt, wenn demoModus aktiv ist
export const demoUebersetzungAktiv = () => an;

const index = (titelDe) => ALLE.findIndex(k => k.titel === titelDe);

// Kurs (Liste oder Detail): ersetzt titel, beschreibung, nutzen, wenn die Zeile noch der deutschen Seed-Fassung entspricht.
export function kursUebersetzt(k, l = sprache()) {
  const i = index(k.titel);
  const u = UE[l]?.kurse[i];
  // Nur wenn Beschreibung und Nutzen noch dem deutschen Seed entsprechen; sonst hat jemand den Kurs bearbeitet und der Text bleibt unveraendert.
  if (!u || k.beschreibung !== ALLE[i].beschreibung || k.nutzen !== ALLE[i].nutzen) return k;
  return { ...k, titel: u.titel, beschreibung: u.beschreibung, nutzen: u.nutzen };
}

// Lektionen eines Kurses (Reihenfolge wie in der Datenbank). kursTitelDe = deutscher Titel des Kurses VOR der Uebersetzung.
export function lektionenUebersetzt(kursTitelDe, lektionen, l = sprache()) {
  const i = index(kursTitelDe);
  const T = UE[l];
  if (!T || i < 0) return lektionen;
  return lektionen.map(x => {
    const j = ALLE[i].lektionen.findIndex(([ab, ti, inh]) => ab === x.abschnitt && ti === x.titel && inh === x.inhalt);
    if (j >= 0) { const [ab, ti, inh] = T.kurse[i].lektionen[j]; return { ...x, abschnitt: ab, titel: ti, ...(x.inhalt !== undefined ? { inhalt: inh } : {}) }; }
    if (x.abschnitt === VIDEOPROBE_DE.abschnitt && x.titel === VIDEOPROBE_DE.titel && x.inhalt === VIDEOPROBE_DE.inhalt) return { ...x, abschnitt: T.video.abschnitt, titel: T.video.titel, ...(x.inhalt !== undefined ? { inhalt: T.video.inhalt } : {}) };
    return x;
  });
}

// Nur der Titel (fuer Listen, Bestellungen, Mails): ersetzt, wenn der Titel dem deutschen Seed-Titel entspricht.
export function titelUebersetzt(titelDe, l = sprache()) {
  if (!an || typeof titelDe !== 'string') return titelDe;
  const u = UE[l]?.kurse[index(titelDe)];
  return u ? u.titel : titelDe;
}
// Beschreibung (z. B. Meine Kurse): nur wenn Titel UND Beschreibung dem Seed entsprechen.
export function beschreibungUebersetzt(titelDe, beschreibungDe, l = sprache()) {
  if (!an) return beschreibungDe;
  const i = index(titelDe);
  const u = UE[l]?.kurse[i];
  return u && beschreibungDe === ALLE[i].beschreibung ? u.beschreibung : beschreibungDe;
}
