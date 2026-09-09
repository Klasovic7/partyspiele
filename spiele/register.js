// Verzeichnis aller Spiele in der App.
//
// Ein neues Spiel hinzufügen = drei Schritte:
//   1. Ordner spiele/<meinspiel>/ mit einer spiel.js anlegen
//      (siehe spiele/schaetzfragen/spiel.js als Vorlage - nötig sind die Funktionen
//       starten(api), raumDaten(daten), spieler(liste) und beenden()).
//   2. Hier unten einen Eintrag ergänzen.
//   3. In sw.js die Dateien in die Liste DATEIEN aufnehmen, damit sie offline verfügbar sind.
//
// "laden" wird erst beim Klick auf die Kachel ausgeführt - so lädt die App beim Start
// nur das, was gerade gebraucht wird, und bleibt auch mit vielen Spielen schnell.
export const SPIELE = [
  {
    id: "schaetzfragen",
    name: "Schätzfragen",
    emoji: "🎯",
    beschreibung: "Wer tippt am nächsten dran?",
    minSpieler: 1,
    laden: () => import("./schaetzfragen/spiel.js")
  },
  {
    // Noch ohne eigenes Spielmodul - "kommtBald" macht die Kachel sichtbar,
    // aber nicht anklickbar. Sobald spiele/denk-gleich/spiel.js existiert,
    // hier "kommtBald" entfernen und ein "laden" ergänzen (wie oben bei Schätzfragen).
    id: "denk-gleich",
    name: "Denk gleich!",
    emoji: "🧠",
    beschreibung: "Bald verfügbar",
    minSpieler: 1,
    kommtBald: true
  }
];

export function spielInfo(id) {
  return SPIELE.find((s) => s.id === id) ?? null;
}
