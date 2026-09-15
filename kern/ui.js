// Bausteine, die jedes Spiel gebrauchen kann: Spieler-Kachel, Avatare, Textausgabe.

export const FARBEN = [
  { name: "Schwarz",  hex: "#222222" },
  { name: "Hellgrau", hex: "#c7cdd3" },
  { name: "Braun",    hex: "#8a5a34" },
  { name: "Blau",     hex: "#2563eb" },
  { name: "Rot",      hex: "#e53e3e" },
  { name: "Orange",   hex: "#f97316" },
  { name: "Gelb",     hex: "#f5c518" },
  { name: "Grün",     hex: "#16a34a" },
  { name: "Pink",     hex: "#ec4899" },
  { name: "Lila",     hex: "#9333ea" }
];

// Profilbilder liegen als echte Dateien in bilder/ - der Browser cacht sie dann
// einzeln und die Startseite bleibt klein. In Firestore steht nur die id ("avatar1").
export const AVATARE = [
  { id: "avatar1", bild: "bilder/avatar1-hd.jpg?v=38", vorname: "Jens",      nachname: "Jeremies" },
  { id: "avatar2", bild: "bilder/avatar2-hd.jpg?v=38", vorname: "Marco",     nachname: "Reus" },
  { id: "avatar3", bild: "bilder/avatar3-hd.jpg?v=38", vorname: "Timothy",   nachname: "Chandler" },
  { id: "avatar4", bild: "bilder/avatar4-hd.jpg?v=38", vorname: "Lothar",    nachname: "Matthäus" },
  { id: "avatar5", bild: "bilder/avatar5-hd.jpg?v=38", vorname: "Christian", nachname: "Wörns" },
  { id: "avatar6", bild: "bilder/avatar6-hd.jpg?v=38", vorname: "Martin",    nachname: "Hinteregger" },
  { id: "avatar7", bild: "bilder/avatar7-hd.jpg?v=38", vorname: "",          nachname: "Ailton" },
  { id: "avatar8", bild: "bilder/avatar8-hd.jpg?v=38", vorname: "Niklas",    nachname: "Süle" }
];

// Zweite Kategorie: Fotos von Freunden (in Kostümen/Rollen). Ersetzt die
// Fußballer-Kategorie nicht, sondern besteht parallel dazu - auf dem
// Profilbildschirm kann zwischen beiden Kategorien gewechselt werden.
// "nachname" trägt hier die Rolle (groß dargestellt), "vorname" den Namen
// (klein dargestellt) - dieselbe Beschriftungslogik wie bei den Fußballern.
export const FREUNDE = [
  { id: "freund-rapper-kevin",       bild: "bilder/freund-rapper-kevin.jpg?v=121",       vorname: "Kevin", nachname: "Rapper" },
  { id: "freund-zocker-luca",        bild: "bilder/freund-zocker-luca.jpg?v=121",        vorname: "Luca",  nachname: "Zocker" },
  { id: "freund-bettler-nader",      bild: "bilder/freund-bettler-nader.jpg?v=121",      vorname: "Nader", nachname: "Bettler" },
  { id: "freund-eintracht-sinan",    bild: "bilder/freund-eintracht-sinan.jpg?v=121",    vorname: "Sinan", nachname: "Eintracht" },
  { id: "freund-boxer-kevin",        bild: "bilder/freund-boxer-kevin.jpg?v=121",        vorname: "Kevin", nachname: "Boxer" },
  { id: "freund-gay-luca",           bild: "bilder/freund-gay-luca.jpg?v=121",           vorname: "Luca",  nachname: "Gay" },
  { id: "freund-diktator-nader",     bild: "bilder/freund-diktator-nader.jpg?v=121",     vorname: "Nader", nachname: "Diktator" },
  { id: "freund-rambo-sinan",        bild: "bilder/freund-rambo-sinan.jpg?v=121",        vorname: "Sinan", nachname: "Rambo" },
  { id: "freund-meerjungfrau-kevin", bild: "bilder/freund-meerjungfrau-kevin.jpg?v=121", vorname: "Kevin", nachname: "Meerjungfrau" },
  { id: "freund-baywatch-luca",      bild: "bilder/freund-baywatch-luca.jpg?v=121",      vorname: "Luca",  nachname: "Baywatch" },
  { id: "freund-baby-nader",         bild: "bilder/freund-baby-nader.jpg?v=121",         vorname: "Nader", nachname: "Baby" },
  { id: "freund-leoparden-sinan",    bild: "bilder/freund-leoparden-sinan.jpg?v=121",    vorname: "Sinan", nachname: "Leoparden" }
];

// Kombinierte Liste für Nachschlagen (z. B. in der Lobby, im laufenden Spiel,
// beim Endstand) - damit Freunde-Fotos überall korrekt angezeigt werden,
// nicht nur auf dem Profilbildschirm.
export const ALLE_AVATARE = [...AVATARE, ...FREUNDE];

export function avatarBild(id) {
  return ALLE_AVATARE.find((a) => a.id === id)?.bild ?? null;
}

// Zeigt das Profilbild - und fällt auf Text zurück, falls noch ein altes Emoji
// (aus einer früheren Version) im Spieler-Dokument steht.
export function avatarHtml(id, klasse) {
  const bild = avatarBild(id);
  if (bild) return `<img class="${klasse}" src="${bild}" alt="" loading="lazy">`;
  return `<span class="${klasse} ${klasse}-text">${escapeHtml(id || "?")}</span>`;
}

export function escapeHtml(text) {
  const el = document.createElement("div");
  el.textContent = text ?? "";
  return el.innerHTML;
}

// Zusatzinfos in Klammern - z. B. "(Stand: 07.09.2026)" - werden kleiner dargestellt.
export function textMitZusatz(text) {
  // Steht die Klammer am Ende direkt vor dem Fragezeichen, wandert sie dahinter -
  // sonst klebt ein großes "?" hinter dem kleinen Zusatztext.
  const roh = (text ?? "").replace(/\s*\(([^)]*)\)\s*\?\s*$/, "? ($1)");
  return escapeHtml(roh).replace(/\(([^)]*)\)/g, '<span class="frage-zusatz">($1)</span>');
}

// Wählt helle oder dunkle Schrift, je nachdem wie hell der Hintergrund ist.
export function textFarbeFuer(hex) {
  if (!hex || hex.length !== 7) return "#fff";
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#222" : "#fff";
}

// Erzeugt für jede Spielerfarbe eine hellere und eine dunklere Variante.
// Dadurch bleibt das Zackenmuster bei allen zehn auswählbaren Farben sichtbar.
function mischeSpielerFarbe(hex, zielwert, anteil) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const kanal = (start) => Math.round(start + (zielwert - start) * anteil);
  const r = kanal(parseInt(hex.slice(1, 3), 16));
  const g = kanal(parseInt(hex.slice(3, 5), 16));
  const b = kanal(parseInt(hex.slice(5, 7), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

// Kompakte Spielerzeile nach dem gemeinsamen Designsystem: Farbring am Profil,
// eine farbige Fortschrittslinie und die Gesamtpunkte gut sichtbar rechts.
// optionen.extra        - zweite Zeile unter dem Namen (z. B. die Schätzung)
// optionen.punkteRechts - zweite große Zahl ganz rechts (z. B. Gesamtpunktstand)
// optionen.punkteLinks  - false blendet die linke Zahl aus (z. B. in der Lobby)
// optionen.rang         - Platzierung für Endstände, wenn es keine Rundenpunkte gibt
export function spielerKarte(name, farbe, icon, punkte, optionen = {}) {
  const sichereFarbe = farbe || "#7f8c8d";
  const nurIdentitaet = optionen.punkteLinks === false;
  const hatGesamtpunkte = optionen.punkteRechts !== undefined;
  const gesamtpunkte = hatGesamtpunkte ? optionen.punkteRechts : punkte;
  const numerischePunkte = Number(gesamtpunkte);
  const fortschritt = Number.isFinite(numerischePunkte)
    ? Math.max(9, Math.min(100, 18 + Math.max(0, numerischePunkte) * 11))
    : 18;
  const linkeAnzeige = hatGesamtpunkte ? punkte : optionen.rang;
  const linksKlasse = String(linkeAnzeige ?? "").trim().startsWith("+")
    ? " positiv"
    : String(linkeAnzeige ?? "").trim().startsWith("-") || String(linkeAnzeige ?? "").trim().startsWith("−")
      ? " negativ"
      : "";
  const linksHtml = nurIdentitaet || linkeAnzeige === undefined
    ? ""
    : `<div class="spieler-punkte${linksKlasse}">${escapeHtml(String(linkeAnzeige))}</div>`;
  const extraHtml = optionen.extra ? `<span class="spieler-extra">${escapeHtml(optionen.extra)}</span>` : "";
  const balkenHtml = nurIdentitaet ? "" :
    `<span class="spieler-fortschritt" aria-hidden="true"><i style="width:${fortschritt}%"></i></span>`;
  const rechtsHtml = nurIdentitaet
    ? ""
    : `<div class="spieler-punkte-gesamt">${escapeHtml(String(gesamtpunkte ?? 0))}</div>`;

  const kartenKlasse = nurIdentitaet ? " spieler-identitaet" : " spieler-punktestand";

  return (
    `<div class="spieler-karte${kartenKlasse}" style="--spieler-farbe:${sichereFarbe}">` +
      linksHtml +
      `<div class="spieler-info">` +
        avatarHtml(icon, "spieler-icon") +
        `<div class="spieler-text">` +
          `<span class="spieler-name">${escapeHtml(name)}</span>` +
          extraHtml +
          balkenHtml +
        `</div>` +
      `</div>` +
      rechtsHtml +
    `</div>`
  );
}

// v109: Team-Endstand für Spiele, in denen weiterhin jede Person einzeln Punkte
// bekommt (Schätzfragen, Wer ist es?) - die Punkte der Teammitglieder werden nur
// für die Anzeige zusammengezählt, das Punktesystem selbst bleibt unverändert.
export function teamEndstandHtml(spielerListe, teams) {
  const summen = { blau: 0, rot: 0 };
  spielerListe.forEach((s) => {
    const team = teams?.[s.id];
    if (team === "blau" || team === "rot") summen[team] += (s.punkte ?? 0);
  });
  const gewinner = summen.blau === summen.rot ? null : (summen.blau > summen.rot ? "blau" : "rot");
  const teamInfo = [
    { id: "blau", name: "Team Blau", emoji: "🔵" },
    { id: "rot", name: "Team Rot", emoji: "🔴" }
  ];
  return `<div class="zt-team-endstand">` + teamInfo.map((t) => {
    const mitglieder = spielerListe.filter((s) => teams?.[s.id] === t.id)
      .sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
    return `<section class="zt-team zt-team-${t.id}${gewinner === t.id ? " gewinner" : ""}">` +
      `<h2>${gewinner === t.id ? "🏆 " : ""}${t.emoji} ${t.name}</h2>` +
      `<strong class="zt-team-punkte">${summen[t.id]}</strong>` +
      `<p>${mitglieder.map((s) => escapeHtml(s.name)).join(", ") || "Niemand"}</p>` +
    `</section>`;
  }).join("") + `</div>`;
}

// v110: Rundenergebnis nach Team gruppiert - eine Kachel pro Team mit der
// Gesamtpunktzahl (Summe der einzelnen Mitgliederpunkte) oben und darunter die
// einzelnen Spieler mit ihren eigenen Punkten (kartenHtmlFn liefert dafür die
// fertige spielerKarte-HTML je Spieler, damit jedes Spiel seine eigenen Extras
// - z. B. die Schätzung bei Schätzfragen - weiterhin selbst bestimmen kann).
export function teamGruppeHtml(spielerListe, teams, kartenHtmlFn) {
  const summen = { blau: 0, rot: 0 };
  spielerListe.forEach((s) => {
    const team = teams?.[s.id];
    if (team === "blau" || team === "rot") summen[team] += (s.punkte ?? 0);
  });
  const teamInfo = [
    { id: "blau", name: "Team Blau", emoji: "🔵" },
    { id: "rot", name: "Team Rot", emoji: "🔴" }
  ];
  return `<div class="zt-team-rundenergebnis">` + teamInfo.map((t) => {
    const mitglieder = spielerListe.filter((s) => teams?.[s.id] === t.id)
      .sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
    return `<section class="zt-team zt-team-${t.id}">` +
      `<div class="zt-team-kopf">` +
        `<h2>${t.emoji} ${t.name}</h2>` +
        `<strong class="zt-team-punkte">${summen[t.id]}</strong>` +
      `</div>` +
      `<ul class="zt-team-mitglieder">${mitglieder.map((s) => `<li>${kartenHtmlFn(s)}</li>`).join("") || `<li class="zt-team-leer">Niemand</li>`}</ul>` +
    `</section>`;
  }).join("") + `</div>`;
}

// Sichtbare Fehlermeldung - besser als eine stumme Konsole auf dem Handy.
export function zeigeDebug(text) {
  const el = document.getElementById("debug-log");
  if (el) { el.textContent = text; el.hidden = false; }
  console.error(text);
}

// crypto.randomUUID() gibt es nur in "sicheren Kontexten" (https oder localhost).
export function erzeugeZufallsId() {
  if (window.crypto && typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch { /* Ersatz unten */ }
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
