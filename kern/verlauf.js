// Gemeinsame Hilfsfunktion für alle Spiele mit einem Fragen-/Wörterpool:
// verhindert, dass innerhalb eines Raums zu früh wieder dieselben Fragen/
// Wörter drankommen. Funktioniert wie ein Kartendeck ("Shuffle Bag"): jede
// Frage kommt erst dann wieder dran, wenn wirklich alle anderen (aus dem
// aktuell gültigen Pool, z. B. den ausgewählten Kategorien) schon einmal
// gespielt wurden - danach beginnt der Zyklus von neuem. Vorher wurde bei
// jeder neuen Runde einfach komplett neu aus dem ganzen Pool gewürfelt, ohne
// sich zu merken, was in diesem Raum schon dran war - dadurch konnten
// dieselben Fragen/Wörter (rein zufällig) auffällig oft kurz hintereinander
// wiederkommen, obwohl der Pool insgesamt groß war.
//
// pool: Array aller aktuell in Frage kommenden Indizes (z. B. nach Kategorie
//   gefiltert).
// verlauf: Array der zuletzt in diesem Raum bereits gespielten Indizes
//   (kommt aus dem Raum-Dokument, überlebt daher auch ein "Zurück zur
//   Spielauswahl" und ein erneutes Starten desselben Spiels).
// gewuenschteAnzahl: wie viele Indizes für die neue Runde gebraucht werden.
//
// Rückgabe: { kandidaten, wurdeZurueckgesetzt }. kandidaten ist der Pool, aus
// dem die aufrufende Funktion ihre eigene Auswahl/Mischung ziehen soll -
// schon ohne die zuletzt gespielten, außer der Vorrat reicht nicht mehr
// (dann wieder der komplette aktuelle Pool). wurdeZurueckgesetzt sagt, ob der
// Zyklus dabei neu beginnt (wichtig für aktualisierterVerlauf unten).
export function pooleOhneWiederholung(pool, verlauf, gewuenschteAnzahl) {
  const gespieltSet = new Set(verlauf);
  const frisch = pool.filter((i) => gespieltSet.has(i) === false);
  if (frisch.length >= gewuenschteAnzahl) {
    return { kandidaten: frisch, wurdeZurueckgesetzt: false };
  }
  // Vorrat reicht nicht mehr (oder der bisherige Verlauf passt nicht mehr zum
  // aktuellen Pool, z. B. weil sich die gewählten Kategorien geändert haben) -
  // der Zyklus beginnt neu mit dem kompletten aktuellen Pool.
  return { kandidaten: pool, wurdeZurueckgesetzt: true };
}

// Nach dem tatsächlichen Ziehen der `gezogen`-Indizes für die neue Runde: den
// neuen Verlauf berechnen, der dann im Raum-Dokument gespeichert wird. Bei
// einem Reset (siehe oben) faengt der Verlauf einfach mit den gerade
// gezogenen Fragen neu an, sonst wird er an den bisherigen drangehaengt.
export function aktualisierterVerlauf(verlauf, gezogen, wurdeZurueckgesetzt) {
  return wurdeZurueckgesetzt ? [...gezogen] : [...verlauf, ...gezogen];
}
