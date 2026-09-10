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
  { id: "avatar1", bild: "bilder/avatar1-hd.jpg?v=35", vorname: "Jens",      nachname: "Jeremies" },
  { id: "avatar2", bild: "bilder/avatar2-hd.jpg?v=35", vorname: "Marco",     nachname: "Reus" },
  { id: "avatar3", bild: "bilder/avatar3-hd.jpg?v=35", vorname: "Timothy",   nachname: "Chandler" },
  { id: "avatar4", bild: "bilder/avatar4-hd.jpg?v=35", vorname: "Lothar",    nachname: "Matthäus" },
  { id: "avatar5", bild: "bilder/avatar5-hd.jpg?v=35", vorname: "Christian", nachname: "Wörns" },
  { id: "avatar6", bild: "bilder/avatar6-hd.jpg?v=35", vorname: "Martin",    nachname: "Hinteregger" },
  { id: "avatar7", bild: "bilder/avatar7-hd.jpg?v=35", vorname: "",          nachname: "Ailton" },
  { id: "avatar8", bild: "bilder/avatar8-hd.jpg?v=35", vorname: "Niklas",    nachname: "Süle" }
];

export function avatarBild(id) {
  return AVATARE.find((a) => a.id === id)?.bild ?? null;
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

// Die abgerundete Kachel mit Farbe, Profilbild, Name und großer Punktzahl links.
// Alle Kacheln sind gleich breit, unabhängig von der Länge des Namens.
// optionen.extra        - zweite Zeile unter dem Namen (z. B. die Schätzung)
// optionen.punkteRechts - zweite große Zahl ganz rechts (z. B. Gesamtpunktstand)
// optionen.punkteLinks  - false blendet die linke Zahl aus (z. B. in der Lobby)
export function spielerKarte(name, farbe, icon, punkte, optionen = {}) {
  const sichereFarbe = farbe || "#7f8c8d";
  const textFarbe = textFarbeFuer(sichereFarbe);
  const linksHtml = optionen.punkteLinks === false
    ? ""
    : `<div class="spieler-punkte">${escapeHtml(String(punkte ?? 0))}</div>`;
  const extraHtml = optionen.extra ? `<span class="spieler-extra">${escapeHtml(optionen.extra)}</span>` : "";
  const rechtsHtml = optionen.punkteRechts !== undefined
    ? `<div class="spieler-punkte spieler-punkte-gesamt">${escapeHtml(String(optionen.punkteRechts))}</div>`
    : "";

  return (
    `<div class="spieler-karte" style="background:${sichereFarbe}; color:${textFarbe}">` +
      linksHtml +
      `<div class="spieler-info">` +
        avatarHtml(icon, "spieler-icon") +
        `<div class="spieler-text">` +
          `<span class="spieler-name">${escapeHtml(name)}</span>` +
          extraHtml +
        `</div>` +
      `</div>` +
      rechtsHtml +
    `</div>`
  );
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
