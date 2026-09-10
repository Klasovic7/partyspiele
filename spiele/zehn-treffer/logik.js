export function mischeListe(werte, zufall = Math.random) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

export function erstelleTeams(spielerIds, zufall = Math.random) {
  const gemischt = mischeListe(spielerIds, zufall);
  return Object.fromEntries(gemischt.map((id, index) => [id, index % 2 === 0 ? "blau" : "orange"]));
}

export function bereinigeTreffer(treffer, anzahl = 10) {
  return [...new Set((treffer || []).filter((wert) =>
    Number.isInteger(wert) && wert >= 0 && wert < anzahl
  ))].sort((a, b) => a - b);
}

export function aktiveSpielerId(reihenfolge, rundenIndex, vorhandeneIds) {
  const vorhanden = new Set(vorhandeneIds);
  const spielbar = (reihenfolge || []).filter((id) => vorhanden.has(id));
  if (spielbar.length === 0) return null;
  return spielbar[rundenIndex % spielbar.length];
}

export function aktivesTeam(startTeam, rundenIndex, teams, vorhandeneIds) {
  const erstes = startTeam === "orange" ? "orange" : "blau";
  const anderes = erstes === "blau" ? "orange" : "blau";
  const bevorzugt = rundenIndex % 2 === 0 ? erstes : anderes;
  const vorhanden = new Set(vorhandeneIds);
  const hatMitglieder = (team) => Object.entries(teams || {})
    .some(([id, wert]) => wert === team && vorhanden.has(id));
  if (hatMitglieder(bevorzugt)) return bevorzugt;
  return hatMitglieder(bevorzugt === "blau" ? "orange" : "blau")
    ? (bevorzugt === "blau" ? "orange" : "blau")
    : null;
}
