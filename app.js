// Steuerung der App: Raum erstellen/beitreten, Lobby, Spielauswahl und das Laden
// des jeweiligen Spielmoduls. Alles Spielspezifische steckt in spiele/<id>/spiel.js.
import {
  db, RAEUME, authBereit, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, runTransaction
} from "./kern/firebase.js";
import {
  FARBEN, AVATARE, escapeHtml, avatarHtml, textFarbeFuer, zeigeDebug, erzeugeZufallsId
} from "./kern/ui.js";
import { SPIELE, spielInfo } from "./spiele/register.js";

export const APP_VERSION = "v71";
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
const profilVorname = document.getElementById("profil-vorname");
const profilNachname = document.getElementById("profil-nachname");
const avatarHinweis = document.getElementById("avatar-hinweis");
const btnFarbeZurueck = document.getElementById("btn-farbe-zurueck");
const btnFarbeWeiter = document.getElementById("btn-farbe-weiter");
const btnIconZurueck = document.getElementById("btn-icon-zurueck");
const btnIconWeiter = document.getElementById("btn-icon-weiter");
const btnProfilAuswaehlen = document.getElementById("btn-profil-auswaehlen");
const btnProfilVerlassen = document.getElementById("btn-profil-verlassen");
const spielerliste = document.getElementById("spielerliste");
const spieleGrid = document.getElementById("spiele-grid");
const spielauswahlHinweis = document.getElementById("spielauswahl-hinweis");
const lobbyFehler = document.getElementById("lobby-fehler");

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
  istLeiter: false
};

let raumUnsubscribe = null;
let spielerUnsubscribe = null;
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
  const optionen = freieOptionen(AVATARE, "icon", "id");
  iconKarussell.innerHTML = "";
  if (!optionen.length) {
    profilEntwurf.icon = null;
    profilVorname.textContent = "Kein Profilbild";
    profilNachname.textContent = "mehr frei";
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

function verschiebeProfilAuswahl(typ, richtung) {
  const istFarbe = typ === "farbe";
  const optionen = freieOptionen(istFarbe ? FARBEN : AVATARE, typ, istFarbe ? "hex" : "id");
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
    profilScreen.hidden = true;
    document.body.classList.remove("profil-offen");
    topBar.hidden = false;
    if (zustand.raum) reagiereAufRaum(zustand.raum);
    else lobbyScreen.hidden = false;
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
  renderSpieleAuswahl();
}

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
  topBar.classList.toggle("im-spiel", imSpiel);
  btnVerlassen.textContent = imSpiel ? "←  Spielauswahl" : "Raum verlassen";
  btnVerlassen.disabled = false;
  btnVerlassen.hidden = imSpiel && !zustand.istLeiter;
  spielKopfTitel.hidden = !imSpiel;
  if (info?.emoji) {
    spielKopfIcon.textContent = info.emoji;
  } else {
    spielKopfIcon.innerHTML = '<span class="spiel-logo-badge"><img src="bilder/logo-fuchs-transparent.png" alt=""></span>';
  }
  spielKopfName.textContent = info?.name ?? "Partyspiele";
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
    if (!profilScreen.hidden) renderProfilAuswahl();
    if (!lobbyScreen.hidden) renderLobby();
    aktivesSpielModul?.spieler?.(zustand.spieler);
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
  if (raumSyncIntervall) { clearInterval(raumSyncIntervall); raumSyncIntervall = null; }
  raumSyncAbrufLaeuft = false;
  letzteRaumSignatur = null;
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
    await updateDoc(raumRef(), { aktuellesSpiel: null, phase: "lobby" });
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
function startWerte(vorhandene) {
  const belegteFarben = new Set(vorhandene.map((s) => s.farbe).filter(Boolean));
  const belegteIcons = new Set(vorhandene.map((s) => s.icon).filter(Boolean));
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
    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte([]));

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
    (await getDocs(collection(db, RAEUME, code, "spieler"))).forEach((d) => vorhandene.push(d.data()));

    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte(vorhandene));

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
}
