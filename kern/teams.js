// Gemeinsame Team-Hilfsfunktionen für den Teammodus - genutzt von 10 Treffer!,
// Schätzfragen und Wer ist es?. Jeder Spieler wählt sein Team selbst (Klick auf
// die Team-Kachel im Setup); diese Funktionen kommen nur dort zum Einsatz, wo
// zusätzlich eine zufällige bzw. ausgeglichene Zuteilung gebraucht wird.
export function mischeListe(werte, zufall = Math.random) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

// Für den Button "Zufällige Teams" (nur der Spielleiter kann ihn auslösen):
// verteilt ALLE Spieler neu, unabhängig von einer eventuell schon getroffenen
// eigenen Wahl.
export function erstelleTeams(spielerIds, zufall = Math.random) {
  const gemischt = mischeListe(spielerIds, zufall);
  return Object.fromEntries(gemischt.map((id, index) => [id, index % 2 === 0 ? "blau" : "rot"]));
}

// Für den Spielstart: lässt bereits getroffene Team-Wahlen unangetastet und
// verteilt nur die Spieler ohne eigene Wahl ausgeglichen auf beide Teams.
export function ergaenzeFehlendeTeams(teams, spielerIds, zufall = Math.random) {
  const ergebnis = { ...(teams || {}) };
  const anzahl = { blau: 0, rot: 0 };
  spielerIds.forEach((id) => {
    if (ergebnis[id] === "blau" || ergebnis[id] === "rot") anzahl[ergebnis[id]] += 1;
  });
  const fehlende = mischeListe(
    spielerIds.filter((id) => ergebnis[id] !== "blau" && ergebnis[id] !== "rot"),
    zufall
  );
  fehlende.forEach((id) => {
    const team = anzahl.blau <= anzahl.rot ? "blau" : "rot";
    ergebnis[id] = team;
    anzahl[team] += 1;
  });
  return ergebnis;
}
