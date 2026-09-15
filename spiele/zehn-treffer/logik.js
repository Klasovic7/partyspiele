export { mischeListe, erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";

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
  const normalisiere = (team) => team === "orange" ? "rot" : team;
  const erstes = normalisiere(startTeam) === "rot" ? "rot" : "blau";
  const anderes = erstes === "blau" ? "rot" : "blau";
  const bevorzugt = rundenIndex % 2 === 0 ? erstes : anderes;
  const vorhanden = new Set(vorhandeneIds);
  const hatMitglieder = (team) => Object.entries(teams || {})
    .some(([id, wert]) => normalisiere(wert) === team && vorhanden.has(id));
  if (hatMitglieder(bevorzugt)) return bevorzugt;
  return hatMitglieder(bevorzugt === "blau" ? "rot" : "blau")
    ? (bevorzugt === "blau" ? "rot" : "blau")
    : null;
}
