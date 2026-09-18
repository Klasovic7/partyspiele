// Steuerung der App: Raum erstellen/beitreten, Lobby, Spielauswahl und das Laden
// des jeweiligen Spielmoduls. Alles Spielspezifische steckt in spiele/<id>/spiel.js.
import {
  db, RAEUME, authBereit, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, runTransaction
} from "./kern/firebase.js";
import {
  FARBEN, AVATARE, FREUNDE, escapeHtml, avatarHtml, textFarbeFuer, zeigeDebug, erzeugeZufallsId
} from "./kern/ui.js";
import { SPIELE, spielInfo } from "./spiele/register.js";

export const APP_VERSION = "v160";
const appVersion = document.getElementById("app-version");
appVersion.textContent = "Version " + APP_VERSION;

// ---------- DOM ----------
const startScreen = document.getElementById("start-screen");
const profilScreen = document.getElementById("profil-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const spielWurzel = document.getElementById("spiel-wurzel");
const topBar = document.getElementById("top-bar");
const btnVerlassen = document.getElementById("btn-verlassen");
const spielKopfTitel = document.getElementById("spiel-kopf-titel");
const spielKopfIcon = document.getElementById("spiel-kopf-icon");
const spielKopfName = document.getElementById("spiel-kopf-name");
const spielKopfFortschritt = document.getElementById("spiel-kopf-fortschritt");
const btnLobbyVerlassen = document.getElementById("btn-lobby-verlassen");
const raumVerlassenDialog = document.getElementById("raum-verlassen-dialog");
const btnRaumVerlassenNein = document.getElementById("btn-raum-verlassen-nein");
const btnRaumVerlassenJa = document.getElementById("btn-raum-verlassen-ja");

const inputName = document.getElementById("input-name");
const inputCode = document.getElementById("input-code");
const btnErstellen = document.getElementById("btn-erstellen");
const btnBeitretenOeffnen = document.getElementById("btn-beitreten-oeffnen");
const btnBeitreten = document.getElementById("btn-beitreten");
const startError = document.getElementById("start-error");
const beitretenDialog = document.getElementById("beitreten-dialog");
const beitretenForm = document.getElementById("beitreten-form");
const btnBeitretenSchliessen = document.getElementById("btn-beitreten-schliessen");
const beitretenError = document.getElementById("beitreten-error");

const anzeigeCode = document.getElementById("anzeige-code");
const farbKarussell = document.getElementById("farb-karussell");
const iconKarussell = document.getElementById("icon-karussell");
const profilSpielername = document.getElementById("profil-spielername");
const profilVorname = document.getElementById("profil-vorname");
const profilNachname = document.getElementById("profil-nachname");
const avatarHinweis = document.getElementById("avatar-hinweis");
const btnFarbeZurueck = document.getElementById("btn-farbe-zurueck");
const btnFarbeWeiter = document.getElementById("btn-farbe-weiter");
const btnIconZurueck = document.getElementById("btn-icon-zurueck");
const btnIconWeiter = document.getElementById("btn-icon-weiter");
const btnProfilAuswaehlen = document.getElementById("btn-profil-auswaehlen");
const btnProfilVerlassen = document.getElementById("btn-profil-verlassen");
const btnKategorieFussballer = document.getElementById("btn-kategorie-fussballer");
const btnKategorieFreunde = document.getElementById("btn-kategorie-freunde");
const spielerliste = document.getElementById("spielerliste");
const spieleGrid = document.getElementById("spiele-grid");
const spielauswahlHinweis = document.getElementById("spielauswahl-hinweis");
const lobbyFehler = document.getElementById("lobby-fehler");
const wertungKachel = document.getElementById("wertung-kachel");
const wertungDialog = document.getElementById("wertung-dialog");
const btnWertungSchliessen = document.getElementById("btn-wertung-schliessen");
const wertungTabelle = document.getElementById("wertung-tabelle");

window.addEventListener("error", (e) => zeigeDebug("Fehler: " + e.message));
window.addEventListener("unhandledrejection", (e) => zeigeDebug("Fehler: " + (e.reason?.message || e.reason)));

// Solange die anonyme Anmeldung noch läuft (normalerweise unter einer Sekunde),
// bleiben die Start-Knöpfe gesperrt - ein Klick davor würde an den Firestore-Regeln
// abprallen, weil noch niemand angemeldet ist.
btnErstellen.disabled = true;
btnBeitretenOeffnen.disabled = true;
btnBeitreten.disabled = true;
startError.textContent = "Verbinde …";
authBereit
  .then(() => {
    btnErstellen.disabled = false;
    btnBeitretenOeffnen.disabled = false;
    btnBeitreten.disabled = false;
    startError.textContent = "";
  })
  .catch((e) => zeigeDebug("Anmeldung fehlgeschlagen: " + e.message));

// ---------- Sitzung ----------
const SPEICHER_SCHLUESSEL = "partyspiele_sitzung";

function sitzungLaden() {
  try { return JSON.parse(localStorage.getItem(SPEICHER_SCHLUESSEL) || "null"); }
  catch { return null; }
}
function sitzungSpeichern() {
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify({
      code: zustand.code, name: zustand.name, spielerId,
      farbe: zustand.farbe, icon: zustand.icon,
      profilBestaetigt: zustand.profilBestaetigt
    }));
  } catch { /* im privaten Modus kann das fehlschlagen - nicht schlimm */ }
}
function sitzungLoeschen() {
  try { localStorage.removeItem(SPEICHER_SCHLUESSEL); } catch { /* egal */ }
}

const gespeicherteSitzung = sitzungLaden();
const spielerId = gespeicherteSitzung?.spielerId ?? erzeugeZufallsId();
if (gespeicherteSitzung?.name) inputName.value = gespeicherteSitzung.name;

// ---------- Zustand ----------
const zustand = {
  code: null,
  name: "",
  farbe: gespeicherteSitzung?.farbe ?? null,
  icon: gespeicherteSitzung?.icon ?? null,
  profilBestaetigt: gespeicherteSitzung?.profilBestaetigt ?? false,
  raum: null,
  spieler: [],
  istLeiter: false,
  wertung: {}
};

let raumUnsubscribe = null;
let spielerUnsubscribe = null;
let wertungUnsubscribe = null;
let aktivesSpielModul = null;
let aktivesSpielId = null;
let raumSyncIntervall = null;
let raumSyncAbrufLaeuft = false;
let letzteRaumSignatur = null;

function raumRef() { return doc(db, RAEUME, zustand.code); }
function spielerRef(id = spielerId) { return doc(db, RAEUME, zustand.code, "spieler", id); }

function stabilerSignaturWert(wert) {
  if (Array.isArray(wert)) return wert.map(stabilerSignaturWert);
  if (wert && typeof wert.toMillis === "function") return wert.toMillis();
  if (wert && typeof wert === "object") {
    return Object.fromEntries(Object.keys(wert).sort().map((key) =>
      [key, stabilerSignaturWert(wert[key])]
    ));
  }
  return wert;
}

function raumSignatur(daten) {
  return JSON.stringify(stabilerSignaturWert(daten));
}

// ---------- Vollbild-Profilwahl (Farbe + Profilbild) ----------
const profilEntwurf = { farbe: zustand.farbe, icon: zustand.icon };
// v130: zweite Bilder-Kategorie ("Freunde") neben den Fußballern - beide
// Kategorien bleiben bestehen, man kann zwischen ihnen hin- und herwechseln.
let profilKategorie = "fussballer";

function aktuelleAvatarQuelle() {
  return profilKategorie === "freunde" ? FREUNDE : AVATARE;
}

function mischeFarbe(hex, ziel, anteil) {
  const kanal = (start, ende) => Math.round(start + (ende - start) * anteil);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const z = ziel === "hell" ? 255 : 0;
  return `rgb(${kanal(r, z)}, ${kanal(g, z)}, ${kanal(b, z)})`;
}

function freieOptionen(optionen, feld, schluessel) {
  const belegt = new Set(
    zustand.spieler
      .filter((s) => s.id !== spielerId && s[feld])
      .map((s) => s[feld])
  );
  return optionen.filter((option) => !belegt.has(option[schluessel]));
}

function karussellEintraege(optionen, aktuellerIndex) {
  if (optionen.length <= 1) return optionen.map((option) => ({ option, position: "mitte" }));
  if (optionen.length === 2) {
    return [
      { option: optionen[(aktuellerIndex + 1) % 2], position: "seite" },
      { option: optionen[aktuellerIndex], position: "mitte" }
    ];
  }
  return [
    { option: optionen[(aktuellerIndex - 1 + optionen.length) % optionen.length], position: "seite" },
    { option: optionen[aktuellerIndex], position: "mitte" },
    { option: optionen[(aktuellerIndex + 1) % optionen.length], position: "seite" }
  ];
}

function setzeProfilHintergrund(farbe) {
  profilScreen.style.setProperty("--profil-farbe", farbe.hex);
  profilScreen.style.setProperty("--profil-hell", mischeFarbe(farbe.hex, "hell", 0.34));
  profilScreen.style.setProperty("--profil-dunkel", mischeFarbe(farbe.hex, "dunkel", 0.42));
  profilScreen.style.setProperty("--profil-text", textFarbeFuer(farbe.hex));
}

function richteStrahlenAufSpieler() {
  if (profilScreen.hidden) return;
  const spielerBild = iconKarussell.querySelector(".icon-option.mitte");
  if (!spielerBild) return;
  const bildPosition = spielerBild.getBoundingClientRect();
  const screenPosition = profilScreen.getBoundingClientRect();
  profilScreen.style.setProperty("--strahlen-x", `${bildPosition.left + bildPosition.width / 2 - screenPosition.left}px`);
  profilScreen.style.setProperty("--strahlen-y", `${bildPosition.top + bildPosition.height / 2 - screenPosition.top}px`);
}

function renderFarbKarussell() {
  const optionen = freieOptionen(FARBEN, "farbe", "hex");
  farbKarussell.innerHTML = "";
  if (!optionen.length) {
    profilEntwurf.farbe = null;
    farbKarussell.setAttribute("aria-label", "Keine Farbe mehr frei");
    btnFarbeZurueck.disabled = true;
    btnFarbeWeiter.disabled = true;
    return;
  }

  let index = optionen.findIndex((farbe) => farbe.hex === profilEntwurf.farbe);
  if (index < 0) index = 0;
  profilEntwurf.farbe = optionen[index].hex;
  setzeProfilHintergrund(optionen[index]);
  farbKarussell.setAttribute("aria-label", `Ausgewählte Farbe: ${optionen[index].name}`);

  karussellEintraege(optionen, index).forEach(({ option, position }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `karussell-option farb-option ${position}`;
    btn.title = option.name;
    btn.setAttribute("aria-label", option.name);
    btn.setAttribute("aria-pressed", position === "mitte" ? "true" : "false");
    btn.style.setProperty("--item-farbe", option.hex);
    btn.style.setProperty("--item-hell", mischeFarbe(option.hex, "hell", 0.36));
    btn.style.setProperty("--item-dunkel", mischeFarbe(option.hex, "dunkel", 0.38));
    btn.addEventListener("click", () => {
      profilEntwurf.farbe = option.hex;
      renderFarbKarussell();
    });
    farbKarussell.appendChild(btn);
  });
  btnFarbeZurueck.disabled = optionen.length < 2;
  btnFarbeWeiter.disabled = optionen.length < 2;
}

function renderIconKarussell() {
  // v130: bei "Freunde" steht die Rolle (groß) über dem Namen (klein) - bei
  // "Fußballer" bleibt es wie bisher Vorname (klein) über Nachname (groß).
  profilSpielername.classList.toggle("freunde-modus", profilKategorie === "freunde");
  const optionen = freieOptionen(aktuelleAvatarQuelle(), "icon", "id");
  iconKarussell.innerHTML = "";
  if (!optionen.length) {
    profilEntwurf.icon = null;
    profilVorname.textContent = "Kein Profilbild";
    profilNachname.textContent = "mehr frei";
    profilNachname.style.setProperty("--name-skala", 1);
    btnIconZurueck.disabled = true;
    btnIconWeiter.disabled = true;
    return;
  }

  let index = optionen.findIndex((avatar) => avatar.id === profilEntwurf.icon);
  if (index < 0) index = 0;
  const ausgewaehlt = optionen[index];
  profilEntwurf.icon = ausgewaehlt.id;
  profilVorname.textContent = ausgewaehlt.vorname;
  profilNachname.textContent = ausgewaehlt.nachname;
  // v130: lange, nicht umbrechbare Wörter (z. B. "MEERJUNGFRAU") ragen sonst
  // über den Kartenrand hinaus - ab 9 Zeichen wird die Schrift per CSS-Variable
  // passend verkleinert, kürzere Namen bleiben unverändert bei Skala 1.
  const nachnameLaenge = ausgewaehlt.nachname.length;
  const nameSkala = nachnameLaenge > 8 ? Math.max(0.6, 8 / nachnameLaenge) : 1;
  profilNachname.style.setProperty("--name-skala", nameSkala);

  karussellEintraege(optionen, index).forEach(({ option, position }) => {
    const spielerName = [option.vorname, option.nachname].filter(Boolean).join(" ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `karussell-option icon-option ${position}`;
    btn.title = spielerName;
    btn.setAttribute("aria-label", spielerName);
    btn.setAttribute("aria-pressed", position === "mitte" ? "true" : "false");
    btn.innerHTML = `<img src="${option.bild}" alt="${escapeHtml(spielerName)}">`;
    btn.addEventListener("click", () => {
      profilEntwurf.icon = option.id;
      renderIconKarussell();
    });
    iconKarussell.appendChild(btn);
  });
  btnIconZurueck.disabled = optionen.length < 2;
  btnIconWeiter.disabled = optionen.length < 2;
  requestAnimationFrame(richteStrahlenAufSpieler);
}

function renderProfilAuswahl() {
  renderFarbKarussell();
  renderIconKarussell();
  btnProfilAuswaehlen.disabled = !profilEntwurf.farbe || !profilEntwurf.icon;
}

// v130: Umschalten zwischen den Bilder-Kategorien "Fußballer" und "Freunde".
// Beim Wechseln wird das aktuell gewählte Bild zurückgesetzt, damit man nicht
// versehentlich ein Bild der anderen Kategorie "mitschleppt".
function setzeKategorie(kategorie) {
  if (kategorie === profilKategorie) return;
  profilKategorie = kategorie;
  profilEntwurf.icon = null;
  btnKategorieFussballer.classList.toggle("aktiv", kategorie === "fussballer");
  btnKategorieFussballer.setAttribute("aria-selected", kategorie === "fussballer" ? "true" : "false");
  btnKategorieFreunde.classList.toggle("aktiv", kategorie === "freunde");
  btnKategorieFreunde.setAttribute("aria-selected", kategorie === "freunde" ? "true" : "false");
  renderIconKarussell();
  btnProfilAuswaehlen.disabled = !profilEntwurf.farbe || !profilEntwurf.icon;
}

function verschiebeProfilAuswahl(typ, richtung) {
  const istFarbe = typ === "farbe";
  const optionen = freieOptionen(istFarbe ? FARBEN : aktuelleAvatarQuelle(), typ, istFarbe ? "hex" : "id");
  if (optionen.length < 2) return;
  const schluessel = istFarbe ? "hex" : "id";
  let index = optionen.findIndex((option) => option[schluessel] === profilEntwurf[typ]);
  if (index < 0) index = 0;
  profilEntwurf[typ] = optionen[(index + richtung + optionen.length) % optionen.length][schluessel];
  if (istFarbe) renderFarbKarussell(); else renderIconKarussell();
}

function aktiviereWischen(element, beiWischen) {
  let startX = null;
  element.addEventListener("pointerdown", (event) => { startX = event.clientX; });
  element.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const strecke = event.clientX - startX;
    startX = null;
    if (Math.abs(strecke) >= 35) beiWischen(strecke < 0 ? 1 : -1);
  });
  element.addEventListener("pointercancel", () => { startX = null; });
}

function zeigeProfilAuswahl() {
  if (profilScreen.hidden) {
    profilEntwurf.farbe = zustand.farbe;
    profilEntwurf.icon = zustand.icon;
    avatarHinweis.textContent = "";
    // v130: Kategorie passend zum bereits gewählten Bild vorauswählen (falls
    // vorhanden), sonst Standard "Fußballer".
    const istFreund = FREUNDE.some((f) => f.id === zustand.icon);
    profilKategorie = istFreund ? "freunde" : "fussballer";
    btnKategorieFussballer.classList.toggle("aktiv", !istFreund);
    btnKategorieFussballer.setAttribute("aria-selected", istFreund ? "false" : "true");
    btnKategorieFreunde.classList.toggle("aktiv", istFreund);
    btnKategorieFreunde.setAttribute("aria-selected", istFreund ? "true" : "false");
  }
  startScreen.hidden = true;
  lobbyScreen.hidden = true;
  spielWurzel.hidden = true;
  topBar.hidden = true;
  profilScreen.hidden = false;
  document.body.classList.add("profil-offen");
  renderProfilAuswahl();
}

async function bestaetigeProfilAuswahl() {
  if (!zustand.code || !profilEntwurf.farbe || !profilEntwurf.icon) return;
  avatarHinweis.textContent = "";
  btnProfilAuswaehlen.disabled = true;
  const andere = zustand.spieler.filter((s) => s.id !== spielerId).map((s) => s.id);

  try {
    await runTransaction(db, async (tx) => {
      const andereSpieler = [];
      for (const id of andere) andereSpieler.push(await tx.get(spielerRef(id)));
      for (const snap of andereSpieler) {
        if (!snap.exists()) continue;
        if (snap.data().farbe === profilEntwurf.farbe) throw new Error("FARBE_VERGEBEN");
        if (snap.data().icon === profilEntwurf.icon) throw new Error("ICON_VERGEBEN");
      }
      tx.update(spielerRef(), { farbe: profilEntwurf.farbe, icon: profilEntwurf.icon });
    });

    zustand.farbe = profilEntwurf.farbe;
    zustand.icon = profilEntwurf.icon;
    zustand.profilBestaetigt = true;
    sitzungSpeichern();

    // v142: Die Aenderung kam per Transaktion herein, die - anders als setDoc/
    // updateDoc - keine optimistische lokale Aktualisierung auslöst. Der
    // Realtime-Listener fuer die Spieler-Sammlung bekommt die neue Farbe/das
    // Bild deshalb erst nach einem Server-Roundtrip mit, was kurz nach dem
    // Bestaetigen zu einem "?"-Platzhalter-Avatar in der Lobby fuehren konnte
    // (und, falls der Listener genau in diesem Moment noch auf den - da noch
    // verstecktem - Lobby-Screen traf, sogar dauerhaft, weil kein weiteres
    // Rendern mehr ausgeloest wurde). Deshalb hier den eigenen Eintrag sofort
    // lokal nachziehen und in jedem Fall aktiv neu rendern, statt nur die
    // Lobby einzublenden.
    const eigenerEintrag = zustand.spieler.find((s) => s.id === spielerId);
    if (eigenerEintrag) {
      eigenerEintrag.farbe = profilEntwurf.farbe;
      eigenerEintrag.icon = profilEntwurf.icon;
    }

    profilScreen.hidden = true;
    document.body.classList.remove("profil-offen");
    topBar.hidden = false;
    if (zustand.raum) {
      reagiereAufRaum(zustand.raum);
    } else {
      lobbyScreen.hidden = false;
      renderLobby();
    }
  } catch (e) {
    if (e.message === "FARBE_VERGEBEN" || e.message === "ICON_VERGEBEN") {
      avatarHinweis.textContent = e.message === "FARBE_VERGEBEN"
        ? "Diese Farbe wurde gerade vergeben. Bitte wähle eine andere."
        : "Dieses Profilbild wurde gerade vergeben. Bitte wähle ein anderes.";
      renderProfilAuswahl();
    } else {
      zeigeDebug("Fehler bei der Auswahl: " + e.message);
    }
    btnProfilAuswaehlen.disabled = !profilEntwurf.farbe || !profilEntwurf.icon;
  }
}

btnFarbeZurueck.addEventListener("click", () => verschiebeProfilAuswahl("farbe", -1));
btnFarbeWeiter.addEventListener("click", () => verschiebeProfilAuswahl("farbe", 1));
btnIconZurueck.addEventListener("click", () => verschiebeProfilAuswahl("icon", -1));
btnIconWeiter.addEventListener("click", () => verschiebeProfilAuswahl("icon", 1));
btnProfilAuswaehlen.addEventListener("click", bestaetigeProfilAuswahl);
btnKategorieFussballer.addEventListener("click", () => setzeKategorie("fussballer"));
btnKategorieFreunde.addEventListener("click", () => setzeKategorie("freunde"));
aktiviereWischen(farbKarussell, (richtung) => verschiebeProfilAuswahl("farbe", richtung));
aktiviereWischen(iconKarussell, (richtung) => verschiebeProfilAuswahl("icon", richtung));
window.addEventListener("resize", () => requestAnimationFrame(richteStrahlenAufSpieler));

// ---------- Spielauswahl ----------
async function waehleSpiel(id) {
  if (!zustand.istLeiter || !zustand.code) return;
  const info = spielInfo(id);
  if (!info || info.kommtBald) return;
  if (zustand.spieler.length < info.minSpieler) {
    lobbyFehler.textContent = `Für ${info.name} braucht ihr mindestens ${info.minSpieler} Spieler.`;
    return;
  }
  lobbyFehler.textContent = "";
  try {
    await updateDoc(raumRef(), { aktuellesSpiel: id, phase: "spiel" });
  } catch (e) {
    zeigeDebug("Fehler bei der Spielauswahl: " + e.message);
  }
}

function renderSpieleAuswahl() {
  spielauswahlHinweis.textContent = zustand.istLeiter
    ? "Du bist Spielleiter - tippe auf ein Spiel, dann geht es für alle los."
    : "Der Spielleiter wählt gleich ein Spiel aus.";

  spieleGrid.innerHTML = "";
  SPIELE.forEach((spiel) => {
    const div = document.createElement("div");
    const zuWenige = zustand.spieler.length < spiel.minSpieler;
    const klickbar = zustand.istLeiter && !zuWenige && !spiel.kommtBald;
    div.className = "spiel-kachel" + (klickbar ? "" : " passiv") + (spiel.kommtBald ? " kommt-bald" : "");
    if (spiel.farbe) div.style.setProperty("--spiel-farbe", spiel.farbe);
    div.innerHTML =
      `<span class="spiel-emoji">${spiel.emoji}</span>` +
      `<span class="spiel-name">${escapeHtml(spiel.name)}</span>` +
      `<span class="spiel-beschreibung">${escapeHtml(spiel.beschreibung)}</span>` +
      (spiel.kommtBald ? `<span class="spiel-badge">bald verfügbar</span>` : "");
    if (klickbar) div.addEventListener("click", () => waehleSpiel(spiel.id));
    spieleGrid.appendChild(div);
  });
}

function renderLobby() {
  spielerliste.innerHTML = "";
  zustand.spieler.forEach((s) => {
    const li = document.createElement("li");
    li.className = "lobby-spieler";
    li.style.setProperty("--spieler-farbe", s.farbe || "#7f8c8d");
    const istSpielleiter = zustand.raum?.leiterId === s.id;
    li.innerHTML =
      `<span class="lobby-avatar-rahmen">${avatarHtml(s.icon, "lobby-avatar")}` +
        (istSpielleiter ? `<span class="lobby-krone" aria-label="Spielleiter">♛</span>` : "") +
      `</span>` +
      `<strong>${escapeHtml(s.name)}</strong>` +
      (istSpielleiter ? `<small>Spielleiter</small>` : "");
    spielerliste.appendChild(li);
  });
  aktualisiereWertungsKachel();
  renderSpieleAuswahl();
}

// ---------- Wertung (Punkte aus allen bisher gespielten Spielen) ----------
function hatWertung() {
  return Object.values(zustand.wertung).some((punkte) => punkte && Object.keys(punkte).length > 0);
}

function aktualisiereWertungsKachel() {
  wertungKachel.hidden = !hatWertung();
}

function renderWertungTabelle() {
  const wertung = zustand.wertung;
  const gespielteSpiele = SPIELE.filter((s) => wertung[s.id] && Object.keys(wertung[s.id]).length > 0);

  const zeilen = zustand.spieler
    .map((spieler) => {
      const werte = gespielteSpiele.map((s) => wertung[s.id]?.[spieler.id] ?? 0);
      const gesamt = werte.reduce((summe, wert) => summe + wert, 0);
      return { spieler, werte, gesamt };
    })
    .sort((a, b) => b.gesamt - a.gesamt);

  const kopfzeile = gespielteSpiele
    .map((s) => `<th scope="col" title="${escapeHtml(s.name)}">${s.emoji}</th>`)
    .join("");

  const zeilenHtml = zeilen
    .map(({ spieler, werte, gesamt }) => {
      const zellen = werte.map((wert) => `<td>${wert}</td>`).join("");
      return (
        `<tr>` +
        `<td class="wertung-spieler-zelle">${avatarHtml(spieler.icon, "wertung-avatar")}<span>${escapeHtml(spieler.name)}</span></td>` +
        zellen +
        `<td class="wertung-gesamt-zelle">${gesamt}</td>` +
        `</tr>`
      );
    })
    .join("");

  wertungTabelle.innerHTML =
    `<thead><tr><th scope="col" class="wertung-spieler-kopf">Spieler</th>${kopfzeile}<th scope="col">Gesamt</th></tr></thead>` +
    `<tbody>${zeilenHtml}</tbody>`;
}

function oeffneWertungDialog() {
  renderWertungTabelle();
  wertungDialog.hidden = false;
  document.body.classList.add("wertung-offen");
  requestAnimationFrame(() => btnWertungSchliessen.focus());
}

function schliesseWertungDialog(fokusZurueck = true) {
  wertungDialog.hidden = true;
  document.body.classList.remove("wertung-offen");
  if (fokusZurueck && !wertungKachel.hidden) wertungKachel.focus();
}

wertungKachel.addEventListener("click", oeffneWertungDialog);
btnWertungSchliessen.addEventListener("click", () => schliesseWertungDialog());
wertungDialog.addEventListener("click", (event) => {
  if (event.target === wertungDialog) schliesseWertungDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !wertungDialog.hidden) schliesseWertungDialog();
});

// ---------- Spielmodul laden / entladen ----------
// Die Schnittstelle, die jedes Spiel bekommt.
function baueApi() {
  return {
    wurzel: spielWurzel,
    db, raumRef, spielerRef,
    code: zustand.code,
    spielerId,
    spielerName: zustand.name,
    get istLeiter() { return zustand.istLeiter; },
    get spieler() { return zustand.spieler; },
    get raum() { return zustand.raum; },
    // Vom Spiel aufzurufen, wenn es fertig ist: zurück zur Spielauswahl,
    // ohne dass jemand den Raum neu betreten muss.
    zurueckZurAuswahl: async () => {
      try { await updateDoc(raumRef(), { aktuellesSpiel: null, phase: "lobby" }); }
      catch (e) { zeigeDebug("Fehler beim Zurückkehren: " + e.message); }
    },
    // v113: gemeinsame Rundenfortschrittsanzeige oben rechts im Spielkopf (z. B.
    // "2/8") - jedes Spiel ruft das bei jeder Statusänderung mit seinem eigenen
    // Text auf, ein leerer/undefinierter Wert blendet die Anzeige wieder aus.
    fortschritt: (text) => {
      spielKopfFortschritt.textContent = text || "";
      spielKopfFortschritt.hidden = !text;
    },
    fehler: zeigeDebug
  };
}

async function ladeSpiel(id) {
  const info = spielInfo(id);
  if (!info) { zeigeDebug("Unbekanntes Spiel: " + id); return; }
  try {
    const modul = await info.laden();
    aktivesSpielModul = modul;
    aktivesSpielId = id;
    await modul.starten(baueApi());
    // Der Zustand kann sich während des Ladens geändert haben - einmal nachziehen.
    modul.raumDaten?.(zustand.raum);
    modul.spieler?.(zustand.spieler);
  } catch (e) {
    aktivesSpielModul = null;
    aktivesSpielId = null;
    zeigeDebug("Spiel konnte nicht geladen werden: " + e.message);
  }
}

function entladeSpiel() {
  try { aktivesSpielModul?.beenden?.(); } catch (e) { console.warn(e); }
  aktivesSpielModul = null;
  aktivesSpielId = null;
  spielWurzel.innerHTML = "";
}

function aktualisiereRaumNavigation(spielId) {
  const imSpiel = Boolean(spielId);
  const info = imSpiel ? spielInfo(spielId) : null;
  // v137: der diagonale Verlauf im Hintergrund faerbt sich je aktivem Spiel um
  // (statt immer Lila) - siehe body[data-spiel] in stil.css.
  if (imSpiel) document.body.dataset.spiel = spielId;
  else delete document.body.dataset.spiel;
  topBar.classList.toggle("im-spiel", imSpiel);
  btnVerlassen.textContent = imSpiel ? "←  Spielauswahl" : "Raum verlassen";
  btnVerlassen.disabled = false;
  btnVerlassen.hidden = imSpiel && !zustand.istLeiter;
  spielKopfTitel.hidden = !imSpiel;
  // v113: bei jedem Spielwechsel (oder Rückkehr zur Auswahl) erstmal ausblenden -
  // das aktive Spiel setzt den Text direkt danach über api.fortschritt() wieder.
  spielKopfFortschritt.hidden = true;
  spielKopfFortschritt.textContent = "";
  if (info?.emoji) {
    spielKopfIcon.textContent = info.emoji;
  } else {
    spielKopfIcon.innerHTML = '<span class="spiel-logo-badge"><img src="bilder/logo-fuchs-transparent.png" alt=""></span>';
  }
  spielKopfName.textContent = info?.name ?? "Trollhouse";
  // Das Zurückkehren aus einem Spiel ändert den gemeinsamen Raumzustand und
  // bleibt deshalb dem Spielleiter vorbehalten. Im Hauptmenü darf jeder den
  // Raum für sich verlassen.
  topBar.hidden = !imSpiel;
  appVersion.hidden = true;
}

// ---------- Reaktion auf Änderungen am Raum ----------
function reagiereAufRaum(daten) {
  zustand.raum = daten;
  zustand.istLeiter = daten.leiterId === spielerId;

  // Die Profilwahl liegt bewusst vor Lobby und Spiel. Startet der Leiter in der
  // Zwischenzeit schon ein Spiel, wird es direkt nach „Auswählen“ geladen.
  if (!zustand.profilBestaetigt) {
    zeigeProfilAuswahl();
    return;
  }

  const spielId = daten.aktuellesSpiel ?? null;
  aktualisiereRaumNavigation(spielId);

  if (spielId !== aktivesSpielId) {
    entladeSpiel();
    if (spielId) ladeSpiel(spielId);
  }

  if (spielId) {
    lobbyScreen.hidden = true;
    spielWurzel.hidden = false;
    aktivesSpielModul?.raumDaten?.(daten);
  } else {
    spielWurzel.hidden = true;
    lobbyScreen.hidden = false;
    renderLobby();
  }
}

function starteListener(code) {
  spielerUnsubscribe = onSnapshot(collection(db, RAEUME, code, "spieler"), (snap) => {
    zustand.spieler = [];
    snap.forEach((d) => zustand.spieler.push({ id: d.id, ...d.data() }));
    // Sicherheitsnetz: taucht der eigene Eintrag ohne Farbe/Bild auf (z. B. durch
    // einen inzwischen behobenen, aber vielleicht noch nicht überall ausgerollten
    // Schreibfehler), zeigt sich das sonst nur als "?"-Avatar ohne jede Möglichkeit,
    // das selbst zu korrigieren. Stattdessen automatisch zurück zur Profilwahl.
    const eigenerEintrag = zustand.spieler.find((s) => s.id === spielerId);
    if (zustand.profilBestaetigt && eigenerEintrag && (!eigenerEintrag.farbe || !eigenerEintrag.icon)) {
      zustand.profilBestaetigt = false;
      zeigeProfilAuswahl();
      return;
    }
    if (!profilScreen.hidden) renderProfilAuswahl();
    if (!lobbyScreen.hidden) renderLobby();
    aktivesSpielModul?.spieler?.(zustand.spieler);
  });

  wertungUnsubscribe = onSnapshot(collection(db, RAEUME, code, "wertung"), (snap) => {
    zustand.wertung = {};
    snap.forEach((d) => { zustand.wertung[d.id] = d.data()?.punkte ?? {}; });
    aktualisiereWertungsKachel();
    if (!wertungDialog.hidden) renderWertungTabelle();
  });

  const uebernehmeRaum = (daten) => {
    letzteRaumSignatur = raumSignatur(daten);
    reagiereAufRaum(daten);
  };

  raumUnsubscribe = onSnapshot(raumRef(), (snap) => {
    const daten = snap.data();
    if (!daten) return;
    uebernehmeRaum(daten);
  }, (e) => zeigeDebug("Echtzeit-Synchronisation unterbrochen: " + e.message));

  // Auf einzelnen mobilen Browsern kann der Firestore-Stream einschlafen.
  // Dieser Rückfall lädt nur dann neu, wenn sich der Raum wirklich verändert hat.
  if (raumSyncIntervall) clearInterval(raumSyncIntervall);
  letzteRaumSignatur = null;
  raumSyncIntervall = setInterval(async () => {
    if (raumSyncAbrufLaeuft || zustand.code !== code) return;
    raumSyncAbrufLaeuft = true;
    try {
      const snap = await getDoc(doc(db, RAEUME, code));
      const daten = snap.data();
      if (daten && raumSignatur(daten) !== letzteRaumSignatur && zustand.code === code) {
        uebernehmeRaum(daten);
      }
    } catch { /* Der Snapshot-Listener bleibt der Hauptweg. */ }
    raumSyncAbrufLaeuft = false;
  }, 1000);
}

function betreteRaum(code, name) {
  zustand.code = code;
  zustand.name = name;
  anzeigeCode.textContent = code;
  startScreen.hidden = true;
  if (zustand.profilBestaetigt) {
    profilScreen.hidden = true;
    document.body.classList.remove("profil-offen");
    lobbyScreen.hidden = false;
    topBar.hidden = true;
    appVersion.hidden = true;
  } else {
    zeigeProfilAuswahl();
  }
  starteListener(code);
}

// ---------- Raum verlassen ----------
async function verlasseRaum() {
  btnVerlassen.disabled = true;
  btnLobbyVerlassen.disabled = true;
  btnProfilVerlassen.disabled = true;

  if (raumUnsubscribe) { raumUnsubscribe(); raumUnsubscribe = null; }
  if (spielerUnsubscribe) { spielerUnsubscribe(); spielerUnsubscribe = null; }
  if (wertungUnsubscribe) { wertungUnsubscribe(); wertungUnsubscribe = null; }
  if (raumSyncIntervall) { clearInterval(raumSyncIntervall); raumSyncIntervall = null; }
  raumSyncAbrufLaeuft = false;
  letzteRaumSignatur = null;
  zustand.wertung = {};
  schliesseWertungDialog(false);
  entladeSpiel();

  if (zustand.code) {
    try { await deleteDoc(spielerRef()); }
    catch (e) { console.warn("Konnte Spieler-Eintrag nicht entfernen:", e); }
  }

  sitzungLoeschen();
  zustand.code = null;
  zustand.name = "";
  zustand.raum = null;
  zustand.spieler = [];
  zustand.istLeiter = false;
  zustand.profilBestaetigt = false;

  profilScreen.hidden = true;
  lobbyScreen.hidden = true;
  spielWurzel.hidden = true;
  topBar.hidden = true;
  appVersion.hidden = false;
  document.body.classList.remove("profil-offen");
  startScreen.hidden = false;
  inputCode.value = "";
  startError.textContent = "";
  beitretenError.textContent = "";
  beitretenDialog.hidden = true;
  document.body.classList.remove("beitreten-offen");
  raumVerlassenDialog.hidden = true;
  document.body.classList.remove("raum-verlassen-offen");
  btnErstellen.disabled = false;
  btnBeitretenOeffnen.disabled = false;
  btnBeitreten.disabled = false;
  btnVerlassen.disabled = false;
  btnLobbyVerlassen.disabled = false;
  btnProfilVerlassen.disabled = false;
}

async function raumNavigationAusfuehren() {
  const spielId = zustand.raum?.aktuellesSpiel ?? null;
  if (!spielId) {
    await verlasseRaum();
    return;
  }
  if (!zustand.istLeiter) return;

  btnVerlassen.disabled = true;
  try {
    // v87: Manche Spiele müssen vor dem Zurückgehen eigene Rundendaten aufräumen
    // (z. B. Schätzfragen: Punkte, Antworten, sfStatus). Bietet das aktive Spiel
    // dafür den Hook "vorZurueck" an, übernimmt der das Zurücksetzen des Raums
    // gleich mit - sonst reicht das einfache Zurücksetzen hier.
    if (aktivesSpielModul?.vorZurueck) {
      await aktivesSpielModul.vorZurueck();
    } else {
      await updateDoc(raumRef(), { aktuellesSpiel: null, phase: "lobby" });
    }
  } catch (e) {
    zeigeDebug("Hauptmenü konnte nicht geöffnet werden: " + e.message);
    btnVerlassen.disabled = false;
  }
}

btnVerlassen.addEventListener("click", raumNavigationAusfuehren);
function oeffneRaumVerlassenDialog() {
  raumVerlassenDialog.hidden = false;
  document.body.classList.add("raum-verlassen-offen");
  requestAnimationFrame(() => btnRaumVerlassenNein.focus());
}

function schliesseRaumVerlassenDialog() {
  raumVerlassenDialog.hidden = true;
  document.body.classList.remove("raum-verlassen-offen");
  btnLobbyVerlassen.focus();
}

btnLobbyVerlassen.addEventListener("click", oeffneRaumVerlassenDialog);
btnRaumVerlassenNein.addEventListener("click", schliesseRaumVerlassenDialog);
btnRaumVerlassenJa.addEventListener("click", async () => {
  btnRaumVerlassenJa.disabled = true;
  raumVerlassenDialog.hidden = true;
  document.body.classList.remove("raum-verlassen-offen");
  await verlasseRaum();
  btnRaumVerlassenJa.disabled = false;
});
raumVerlassenDialog.addEventListener("click", (event) => {
  if (event.target === raumVerlassenDialog) schliesseRaumVerlassenDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !raumVerlassenDialog.hidden) schliesseRaumVerlassenDialog();
});
btnProfilVerlassen.addEventListener("click", verlasseRaum);

// ---------- Raum erstellen / beitreten ----------
function generiereCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function neuenRaumCodeErzeugen() {
  for (let versuch = 0; versuch < 20; versuch++) {
    const code = generiereCode();
    const snap = await getDoc(doc(db, RAEUME, code));
    if (!snap.exists()) return code;
  }
  throw new Error("Es konnte kein freier Raum-Code gefunden werden.");
}

// Farbe und Profilbild aus der letzten Sitzung als Vorauswahl übernehmen, aber nur
// wenn sie im neuen Raum noch frei sind. Bestätigt wird erst im Vollbild-Schritt.
// Wichtig: der eigene, schon vorhandene Spieler-Eintrag zählt dabei NICHT als
// "belegt" - sonst gilt beim erneuten Betreten eines Raums, dem man schon
// angehört, das eigene Profilbild fälschlich als vergeben und fällt beim
// Neuschreiben (setDoc) komplett weg -> Spieler wird ohne Bild angezeigt.
function startWerte(vorhandene) {
  const andere = vorhandene.filter((s) => s.id !== spielerId);
  const belegteFarben = new Set(andere.map((s) => s.farbe).filter(Boolean));
  const belegteIcons = new Set(andere.map((s) => s.icon).filter(Boolean));
  const werte = { name: zustand.name, punkte: 0 };
  if (zustand.farbe && !belegteFarben.has(zustand.farbe)) werte.farbe = zustand.farbe;
  if (zustand.icon && !belegteIcons.has(zustand.icon)) werte.icon = zustand.icon;
  return werte;
}

btnErstellen.addEventListener("click", async () => {
  const name = inputName.value.trim();
  if (!name) { startError.textContent = "Bitte gib zuerst deinen Namen ein."; return; }
  startError.textContent = "";
  btnErstellen.disabled = true;

  try {
    const code = await neuenRaumCodeErzeugen();
    zustand.name = name;
    zustand.profilBestaetigt = false;

    await setDoc(doc(db, RAEUME, code), {
      erstelltAm: serverTimestamp(),
      leiterId: spielerId,
      phase: "lobby",
      aktuellesSpiel: null
    });
    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte([]), { merge: true });

    zustand.code = code;
    sitzungSpeichern();
    betreteRaum(code, name);
  } catch (e) {
    zeigeDebug("Fehler beim Erstellen: " + e.message);
    btnErstellen.disabled = false;
  }
});

function oeffneBeitretenDialog() {
  startError.textContent = "";
  beitretenError.textContent = "";
  beitretenDialog.hidden = false;
  document.body.classList.add("beitreten-offen");
  requestAnimationFrame(() => {
    inputCode.focus();
    inputCode.select();
  });
}

function schliesseBeitretenDialog(fokusZurueck = true) {
  beitretenDialog.hidden = true;
  document.body.classList.remove("beitreten-offen");
  beitretenError.textContent = "";
  if (fokusZurueck) btnBeitretenOeffnen.focus();
}

btnBeitretenOeffnen.addEventListener("click", oeffneBeitretenDialog);
btnBeitretenSchliessen.addEventListener("click", () => schliesseBeitretenDialog());
beitretenDialog.addEventListener("click", (event) => {
  if (event.target === beitretenDialog) schliesseBeitretenDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !beitretenDialog.hidden) schliesseBeitretenDialog();
});
inputCode.addEventListener("input", () => {
  inputCode.value = inputCode.value.replace(/\D/g, "").slice(0, 4);
  beitretenError.textContent = "";
});

beitretenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = inputName.value.trim();
  const code = inputCode.value.trim();
  if (!name) {
    schliesseBeitretenDialog(false);
    startError.textContent = "Bitte gib zuerst deinen Namen ein.";
    inputName.focus();
    return;
  }
  if (!/^\d{4}$/.test(code)) {
    beitretenError.textContent = "Bitte gib einen vierstelligen Code ein.";
    inputCode.focus();
    return;
  }

  beitretenError.textContent = "";
  btnBeitreten.disabled = true;

  try {
    const snap = await getDoc(doc(db, RAEUME, code));
    if (!snap.exists()) {
      beitretenError.textContent = "Diesen Raum gibt es nicht.";
      btnBeitreten.disabled = false;
      return;
    }

    zustand.name = name;
    zustand.code = code;
    zustand.profilBestaetigt = false;

    // Belegte Farben/Bilder einmal abfragen, damit man nicht direkt mit einer
    // schon vergebenen Farbe hereinkommt.
    const vorhandene = [];
    (await getDocs(collection(db, RAEUME, code, "spieler"))).forEach((d) => vorhandene.push({ id: d.id, ...d.data() }));

    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte(vorhandene), { merge: true });

    sitzungSpeichern();
    schliesseBeitretenDialog(false);
    betreteRaum(code, name);
  } catch (e) {
    zeigeDebug("Fehler beim Beitreten: " + e.message);
    beitretenError.textContent = "Der Raum konnte nicht geöffnet werden. Versuche es erneut.";
    btnBeitreten.disabled = false;
  }
});

// ---------- Nach Neuladen wieder in den Raum ----------
async function versucheSitzungFortzusetzen() {
  if (!gespeicherteSitzung?.code) return;
  try {
    await authBereit;
    const snap = await getDoc(doc(db, RAEUME, gespeicherteSitzung.code));
    if (!snap.exists()) { sitzungLoeschen(); return; }
    zustand.code = gespeicherteSitzung.code;
    zustand.name = gespeicherteSitzung.name;
    // Der eigene Spieler-Eintrag kann fehlen (z. B. nach "Raum verlassen" auf einem
    // anderen Gerät) - dann wieder anlegen, sonst taucht man in keiner Liste auf.
    const eigener = await getDoc(doc(db, RAEUME, gespeicherteSitzung.code, "spieler", spielerId));
    if (!eigener.exists()) {
      await setDoc(doc(db, RAEUME, gespeicherteSitzung.code, "spieler", spielerId), {
        name: gespeicherteSitzung.name, punkte: 0,
        ...(gespeicherteSitzung.farbe ? { farbe: gespeicherteSitzung.farbe } : {}),
        ...(gespeicherteSitzung.icon ? { icon: gespeicherteSitzung.icon } : {})
      });
      // Ohne Farbe/Bild (z. B. wenn der eigene Eintrag zwischenzeitlich gelöscht
      // wurde und die alte Sitzung keine vollständigen Angaben mehr hatte) muss
      // die Profilwahl erneut erscheinen - sonst landet man ohne Bild direkt in
      // der Lobby, ohne die Möglichkeit, das zu korrigieren.
      if (!gespeicherteSitzung.farbe || !gespeicherteSitzung.icon) {
        zustand.profilBestaetigt = false;
      }
    }
    betreteRaum(gespeicherteSitzung.code, gespeicherteSitzung.name);
  } catch (e) {
    zeigeDebug("Fehler beim Fortsetzen: " + e.message);
  }
}

versucheSitzungFortzusetzen();

// ---------- Service Worker (macht die Seite als App installierbar) ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service Worker:", e));
  });

  // Beim ALLERERSTEN Öffnen nach einem neuen Deploy steuert kurzzeitig noch der
  // ALTE Service Worker die Seite (Browser-Standardverhalten: ein bereits
  // laufender Tab wird von einer neuen SW-Version erst uebernommen, nachdem sie
  // im Hintergrund fertig installiert+aktiviert ist). In diesem kurzen Fenster
  // liefert der alte SW noch alte/zwischengespeicherte Dateien aus - das war
  // vermutlich der Grund fuer das gemeldete "weisse Viereck beim Fuchs, das
  // nach Aktualisieren verschwindet". Sobald die neue SW-Version uebernimmt
  // (controllerchange), laden wir die Seite darum genau einmal automatisch neu,
  // damit man den manuellen Reload nicht mehr selbst machen muss.
  let neuGeladenWegenSW = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (neuGeladenWegenSW) return;
    neuGeladenWegenSW = true;
    window.location.reload();
  });
}
