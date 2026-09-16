// ============================================================================
//  Wertung: raumuebergreifende Punkte-Historie je Spiel-Typ
// ----------------------------------------------------------------------------
//  Jedes Spielmodul ruft speichereWertung() genau einmal auf, sobald ein
//  Durchgang beendet ist (Uebergang zum Endstand) - direkt an der Stelle, an
//  der der Status auf "beendet" gesetzt wird, damit das garantiert nur einmal
//  pro Durchgang passiert (nicht bei jedem Rendern des Endstand-Screens, der
//  bei allen Mitspielern durch den Realtime-Listener erneut ausgeloest wird).
//  Die Punkte landen unter raeume/{code}/wertung/{spielId} und werden ueber
//  mehrere Durchgaenge desselben Spiels hinweg aufaddiert (increment), damit
//  z. B. zweimal gespieltes Schaetzfragen in einer Spalte zusammengefasst
//  wird. Gelesen/angezeigt wird das Ganze in app.js (Wertungs-Kachel + Dialog
//  in der Lobby).
// ============================================================================
import { doc, setDoc, collection, increment } from "./firebase.js";

export async function speichereWertung(api, spielId, punkteProSpieler) {
  // Nur der Spielleiter schreibt - sonst wuerde jedes Geraet, das den
  // Endstand-Screen anzeigt, dieselben Punkte nochmal aufaddieren.
  if (!api?.istLeiter || !spielId || !punkteProSpieler) return;
  const werte = {};
  for (const [id, wert] of Object.entries(punkteProSpieler)) {
    const zahl = Number(wert) || 0;
    if (zahl) werte[id] = increment(zahl);
  }
  if (!Object.keys(werte).length) return;
  try {
    const ref = doc(collection(api.raumRef(), "wertung"), spielId);
    await setDoc(ref, { punkte: werte }, { merge: true });
  } catch (e) {
    api.fehler?.("Fehler beim Speichern der Wertung: " + e.message);
  }
}
