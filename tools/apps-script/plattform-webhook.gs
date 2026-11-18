/** @OnlyCurrentDoc */
/**
 * VALORE Plattform-Webhook (03.11.2026). Gebunden an das Sheet "VALORE Plattform - Ereignisse und Zusammenfassung".
 * Nimmt POST von der Schulungsplattform entgegen und haengt EINE Zeile in den Reiter "Ereignisse".
 * Schutz: geheimer Schluessel in den Script-Eigenschaften (SCHLUESSEL), im Body der Anfrage, nie in der Adresse.
 * Idempotent: gleiche quelle_id wird nie zweimal geschrieben (Antwort duplicate). Nie eine Kaeufer-E-Mail: Spalte F bleibt leer, jedes Feld mit @ wird abgelehnt.
 * Schreibt NUR in "Ereignisse" und "Fehler", nie in andere Reiter.
 */
var BLATT = 'Ereignisse';
var BLATT_FEHLER = 'Fehler';
var TYPEN = ['registriert', 'bestaetigt', 'gekauft', 'erstattet', 'abo_gestartet', 'abo_beendet', 'abo_gekuendigt'];

function antwort_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fehler_(grund, typ, quelle) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var b = ss.getSheetByName(BLATT_FEHLER) || ss.insertSheet(BLATT_FEHLER);
    if (b.getLastRow() === 0) b.appendRow(['Zeit UTC', 'Grund', 'Typ', 'Quelle-ID']);
    b.appendRow([Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd HH:mm:ss'), String(grund).slice(0, 80), String(typ || '').slice(0, 40), String(quelle || '').slice(0, 80)]);
  } catch (e) { /* Fehlerprotokoll darf nie die Antwort verhindern */ }
}

function doGet() {
  return antwort_({ ok: true, dienst: 'valore-plattform' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var gesperrt = false;
  try {
    var d;
    try { d = JSON.parse(e.postData.contents); } catch (x) { fehler_('format', '', ''); return antwort_({ ok: false, fehler: 'format' }); }
    var schluessel = PropertiesService.getScriptProperties().getProperty('SCHLUESSEL');
    if (!schluessel || typeof d.schluessel !== 'string' || d.schluessel !== schluessel) { fehler_('schluessel', '', ''); return antwort_({ ok: false, fehler: 'schluessel' }); }

    if (d && typeof d === 'object' && d.typ === 'zeile') return zeile_(d);

    var grund = pruefen_(d);
    if (grund) { fehler_(grund, d.typ, d.quelle_id); return antwort_({ ok: false, fehler: grund }); }

    lock.waitLock(20000); gesperrt = true;
    var blatt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BLATT);
    if (!blatt) { fehler_('blatt', d.typ, d.quelle_id); return antwort_({ ok: false, fehler: 'blatt' }); }
    var letzte = blatt.getLastRow();
    if (letzte >= 2) {
      var ids = blatt.getRange(2, 8, letzte - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) { if (String(ids[i][0]) === d.quelle_id) return antwort_({ ok: true, duplicate: true }); }
    }
    var z = blatt.getLastRow() + 1;
    // Spalten: A Zeit UTC (Text), B Typ, C Kurs (Text), D Betrag (Zahl), E Waehrung, F Kaeufer-E-Mail (bleibt leer), G Status, H Quelle-ID (Text), I Test/Live
    blatt.getRange(z, 1).setNumberFormat('@').setValue(d.zeit_utc);
    blatt.getRange(z, 2).setValue(d.typ);
    blatt.getRange(z, 3).setNumberFormat('@').setValue(d.kurs);
    blatt.getRange(z, 4).setValue(d.betrag === '' ? '' : Number(d.betrag));
    blatt.getRange(z, 5).setValue(d.waehrung);
    blatt.getRange(z, 7).setValue('');
    blatt.getRange(z, 8).setNumberFormat('@').setValue(d.quelle_id);
    blatt.getRange(z, 9).setValue(d.modus);
    SpreadsheetApp.flush();
    return antwort_({ ok: true });
  } catch (err) {
    fehler_('ausnahme', '', '');
    return antwort_({ ok: false, fehler: 'ausnahme' });
  } finally {
    if (gesperrt) lock.releaseLock();
  }
}

// ---- Zeile setzen (Kunden-Abos, Zahlungen, Auszahlungen, Probleme) -------------------------------------------------------------
// Nachricht: { schluessel, typ:'zeile', blatt, zeilenschluessel, werte:{ <Kopfzeilen-Name>: Text|Zahl } }
// Gleicher zeilenschluessel ueberschreibt nur die genannten Spalten derselben Zeile, ein neuer haengt eine Zeile an. Nur diese vier Reiter.
// Spaltennamen kommen aus der Kopfzeile des Reiters (unbekannte Namen werden abgelehnt). Ein @ ist nur in den Spalten E-Mail und Kunde erlaubt.
var ZEILEN_BLAETTER = ['Kunden-Abos', 'Zahlungen', 'Auszahlungen', 'Probleme'];
var SCHLUESSEL_SPALTE = 'Zeilenschlüssel';
var AT_ERLAUBT = ['E-Mail', 'Kunde'];

function zeile_(d) {
  var lock = LockService.getScriptLock();
  var gesperrt = false;
  try {
    var grund = zeilePruefen_(d);
    if (grund) { fehler_(grund, 'zeile', d && d.zeilenschluessel); return antwort_({ ok: false, fehler: grund }); }
    lock.waitLock(20000); gesperrt = true;
    var blatt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(d.blatt);
    if (!blatt) { fehler_('blatt', 'zeile', d.zeilenschluessel); return antwort_({ ok: false, fehler: 'blatt' }); }
    var spalten = blatt.getLastColumn();
    var kopf = blatt.getRange(1, 1, 1, spalten).getValues()[0].map(String);
    var kIdx = kopf.indexOf(SCHLUESSEL_SPALTE);
    if (kIdx < 0) { fehler_('kopfzeile', 'zeile', d.zeilenschluessel); return antwort_({ ok: false, fehler: 'kopfzeile' }); }
    for (var name in d.werte) {
      if (kopf.indexOf(name) < 0 || name === SCHLUESSEL_SPALTE) { fehler_('spalte_' + name, 'zeile', d.zeilenschluessel); return antwort_({ ok: false, fehler: 'spalte' }); }
    }
    var letzte = blatt.getLastRow();
    var zeile = 0;
    if (letzte >= 2) {
      var keys = blatt.getRange(2, kIdx + 1, letzte - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) { if (String(keys[i][0]) === d.zeilenschluessel) { zeile = i + 2; break; } }
    }
    var neu = zeile === 0;
    if (neu) zeile = letzte + 1;
    for (var n in d.werte) {
      var z = blatt.getRange(zeile, kopf.indexOf(n) + 1);
      var v = d.werte[n];
      if (typeof v === 'number') z.setNumberFormat('General').setValue(v); else z.setNumberFormat('@').setValue(v);
    }
    blatt.getRange(zeile, kIdx + 1).setNumberFormat('@').setValue(d.zeilenschluessel);
    SpreadsheetApp.flush();
    return antwort_({ ok: true, neu: neu });
  } catch (err) {
    fehler_('ausnahme', 'zeile', '');
    return antwort_({ ok: false, fehler: 'ausnahme' });
  } finally {
    if (gesperrt) lock.releaseLock();
  }
}

function zeilePruefen_(d) {
  if (ZEILEN_BLAETTER.indexOf(d.blatt) < 0) return 'blatt_unbekannt';
  if (typeof d.zeilenschluessel !== 'string' || !/^[A-Za-z0-9:_-]{1,80}$/.test(d.zeilenschluessel)) return 'zeilenschluessel';
  if (!d.werte || typeof d.werte !== 'object' || Array.isArray(d.werte)) return 'werte';
  var erlaubtKopf = { schluessel: 1, typ: 1, blatt: 1, zeilenschluessel: 1, werte: 1 };
  for (var k in d) { if (!erlaubtKopf[k]) return 'unbekanntes_feld'; }
  var anzahl = 0;
  for (var name in d.werte) {
    anzahl++;
    if (anzahl > 20) return 'zu_viele_felder';
    var v = d.werte[name];
    if (typeof v === 'number') { if (!isFinite(v) || Math.abs(v) > 1e12) return 'feld_' + name; continue; }
    if (typeof v !== 'string' || v.length > 300 || /[\u0000-\u001f]/.test(v)) return 'feld_' + name;
    if (v.indexOf('@') >= 0 && AT_ERLAUBT.indexOf(name) < 0) return 'feld_' + name;
    if (/^[=+@-]/.test(v) && name !== 'Betrag') return 'feld_' + name;   // keine Formeln einschleusen (Bindestrich am Ende der Zeichenklasse, kein Bereich)
  }
  if (d.werte['Test/Live'] !== 'Test' && d.werte['Test/Live'] !== 'Live') return 'modus';
  return '';
}

function pruefen_(d) {
  if (!d || typeof d !== 'object') return 'format';
  var texte = ['zeit_utc', 'typ', 'kurs', 'waehrung', 'modus', 'quelle_id'];
  for (var i = 0; i < texte.length; i++) {
    var v = d[texte[i]];
    if (typeof v !== 'string') return 'feld_' + texte[i];
    if (v.indexOf('@') >= 0 || /[\u0000-\u001f]/.test(v)) return 'feld_' + texte[i];
  }
  if (TYPEN.indexOf(d.typ) < 0) return 'typ';
  if (d.modus !== 'Test' && d.modus !== 'Live') return 'modus';
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(d.zeit_utc)) return 'zeit';
  if (d.kurs !== '' && !/^\d{1,9}$/.test(d.kurs)) return 'kurs';
  if (d.waehrung !== '' && !/^[A-Z]{3}$/.test(d.waehrung)) return 'waehrung';
  if (!/^[0-9a-f]{32}$/.test(d.quelle_id)) return 'quelle_id';   // gehashte Kennung (HMAC), nie die Klartext-ID der Plattform
  if (d.betrag !== '' && (typeof d.betrag !== 'number' || !isFinite(d.betrag) || d.betrag < 0 || d.betrag > 100000000)) return 'betrag';
  var erlaubt = { schluessel: 1, zeit_utc: 1, typ: 1, kurs: 1, betrag: 1, waehrung: 1, modus: 1, quelle_id: 1 };
  for (var k in d) { if (!erlaubt[k]) return 'unbekanntes_feld'; }
  return '';
}
