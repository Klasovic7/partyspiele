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
    farbe: "#ff6b5c",
    beschreibung: "Wer tippt am nächsten dran?",
    minSpieler: 1,
    laden: () => import("./schaetzfragen/spiel.js")
  },
  {
    id: "denk-gleich",
    name: "Denk gleich!",
    emoji: "🧠",
    farbe: "#818cf8",
    beschreibung: "Gleiche Antwort, gleiche Punkte!",
    minSpieler: 2,
    laden: () => import("./denk-gleich/spiel.js")
  },
  {
    id: "zehn-treffer",
    name: "10 Treffer!",
    emoji: "💥",
    farbe: "#ffa94d",
    beschreibung: "Ein Begriff, zehn gesuchte Treffer!",
    minSpieler: 2,
    laden: () => import("./zehn-treffer/spiel.js")
  },
  {
    id: "reih-dich-ein",
    name: "Reih dich ein!",
    emoji: "↕️",
    farbe: "#2dd4bf",
    beschreibung: "Setz den Begriff an die richtige Stelle!",
    minSpieler: 2,
    laden: () => import("./reih-dich-ein/spiel.js")
  },
  {
    id: "wer-ist-es",
    name: "Wer ist es?",
    emoji: "🕵️",
    farbe: "#4ade80",
    beschreibung: "Buzzere zuerst und errate den Fußballer",
    minSpieler: 2,
    laden: () => import("./wer-ist-es/spiel.js")
  },
  {
    id: "wann-war-es",
    name: "Wann war es?",
    emoji: "📅",
    farbe: "#c084fc",
    beschreibung: "Buzzere zuerst und errate das gesuchte Jahr",
    minSpieler: 2,
    laden: () => import("./wann-war-es/spiel.js")
  },
  {
    id: "blitzquiz",
    name: "Blitzquiz",
    emoji: "⚡",
    farbe: "#fbbf24",
    beschreibung: "Drei Frage-Typen auf Zeit: Schnelligkeit, Wortrate, Bild-Reveal",
    minSpieler: 1,
    laden: () => import("./blitzquiz/spiel.js")
  },
  {
    id: "finto",
    name: "Finto",
    emoji: "🦉",
    farbe: "#38bdf8",
    beschreibung: "Bluffe mit einer erfundenen Antwort und errate die echte",
    minSpieler: 3,
    laden: () => import("./finto/spiel.js")
  },
  {
    id: "imposter",
    name: "Imposter",
    emoji: "🎭",
    farbe: "#fb7185",
    beschreibung: "Einer kennt das Geheimwort nicht - deckt eure Karte auf und findet ihn",
    minSpieler: 3,
    laden: () => import("./imposter/spiel.js")
  },
  {
    id: "doppelblick",
    name: "Doppelblick!",
    emoji: "🔍",
    farbe: "#f472b6",
    beschreibung: "Zwei Karten, ein gemeinsames Symbol - wer tippt es zuerst?",
    minSpieler: 2,
    laden: () => import("./doppelblick/spiel.js")
  }
];

export function spielInfo(id) {
  return SPIELE.find((s) => s.id === id) ?? null;
}
