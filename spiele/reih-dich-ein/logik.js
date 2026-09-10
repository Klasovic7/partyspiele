export function mischeListe(werte, zufall = Math.random) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

export function begriffNachId(karte, id) {
  return karte?.begriffe?.find((begriff) => begriff.id === id) ?? null;
}

export function richtigerEinfuegeIndex(karte, sortierteIds, kandidatId) {
  const kandidat = begriffNachId(karte, kandidatId);
  if (!kandidat) return -1;
  const sortierte = (sortierteIds || [])
    .map((id) => begriffNachId(karte, id))
    .filter(Boolean);
  const ersterGroesserer = sortierte.findIndex((begriff) => begriff.wert > kandidat.wert);
  return ersterGroesserer < 0 ? sortierte.length : ersterGroesserer;
}

export function fuegeEin(sortierteIds, kandidatId, index) {
  const ergebnis = [...(sortierteIds || [])];
  ergebnis.splice(Math.max(0, Math.min(index, ergebnis.length)), 0, kandidatId);
  return ergebnis;
}

export function aktiveSpielerId(reihenfolge, zugIndex, vorhandeneIds) {
  const vorhanden = new Set(vorhandeneIds || []);
  const spielbar = (reihenfolge || []).filter((id) => vorhanden.has(id));
  if (!spielbar.length) return null;
  return spielbar[Math.max(0, zugIndex) % spielbar.length];
}
