# Előadáscsomag v1 / Kurspaket v1

A VALORE-előadás szövegét a KI ebben az egységes formátumban készítse el. Gabriella az **Admin → Előadáscsomag importálása** mezőbe másolja a teljes szöveget, először az **Ellenőrzés** gombbal ellenőrzi, majd külön megerősítéssel **új piszkozatot** hoz létre.

- `format`: mindig `valore-kurspaket-v1`
- `kurs.titel`: 1–160 karakter; `kurs.beschreibung`: legfeljebb 5000 karakter
- `kurs.preis_forint`: opcionális, 0–10 000 000 egész forint. Kihagyva: 0 Ft
- `kurs.abo_preis_forint`, `kurs.abo_intervall`: opcionális. Az import figyelmeztet és nem menti el az előfizetés adatait; ezeket külön lehet ellenőrizni.
- `lektionen`: 1–40 lecke, mindegyik `titel` (1–160 karakter), `inhalt` (0–20 000 karakter), opcionális `reihenfolge` (egész szám). A hiányzó sorrend 1-től kezdődik.
- Csak az ismert mezők engedélyezettek. A csomag szövege legfeljebb 300 KB. A lecke szövege nem tartalmazhat HTML-jelölést, vezérlőkaraktereket (tab és sortörés kivételével).
- A teljes szöveg egy `json` kódblokkban is beilleszthető. Nem kell fájlt feltölteni.

## Vollständiges Beispiel mit drei Lektionen

```json
{
  "format": "valore-kurspaket-v1",
  "kurs": {
    "titel": "Kapcsolatépítés a gyakorlatban",
    "beschreibung": "Három lépés a tudatos üzleti kapcsolatépítéshez.",
    "preis_forint": 4900
  },
  "lektionen": [
    {
      "titel": "Az első találkozás",
      "inhalt": "Készülj három kérdéssel.\nHallgasd meg a másik felet."
    },
    {
      "titel": "Értékes beszélgetések",
      "inhalt": "Keress közös témát, és kérdezz nyitottan."
    },
    {
      "titel": "Utánkövetés",
      "inhalt": "A találkozó után küldj személyes köszönőüzenetet."
    }
  ]
}
```

**Wichtig:** Der Import erstellt niemals einen veröffentlichten Kurs. Nach dem Import müssen Videos/PDFs einzeln hochgeladen, der Preis kontrolliert und der Kurs ausdrücklich freigegeben werden. Exportierte Kurspakete enthalten keine Kundendaten, Bestellungen oder Dateien. Ein Import legt stets einen neuen Entwurf an, niemals Änderungen an einem vorhandenen Kurs.
