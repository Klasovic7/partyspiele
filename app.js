// Steuerung der App: Raum erstellen/beitreten, Lobby, Spielauswahl und das Laden
// des jeweiligen Spielmoduls. Alles Spielspezifische steckt in spiele/<id>/spiel.js.
import {
  db, RAEUME, authBereit, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, runTransaction
} from "./kern/firebase.js";
import {
  FARBEN, AVATARE, avatarHtml, escapeHtml, spielerKarte, zeigeDebug, erzeugeZufallsId
} from "./kern/ui.js";
import { SPIELE, spielInfo } from "./spiele/register.js";

export const APP_VERSION = "v26";
document.getElementById("app-version").textContent = "Version " + APP_VERSION;

// ---------- DOM ----------
const startScreen = document.getElementById("start-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const spielWurzel = document.getElementById("spiel-wurzel");
const topBar = document.getElementById("top-bar");
const btnVerlassen = document.getElementById("btn-verlassen");

const inputName = document.getElementById("input-name");
const inputCode = document.getElementById("input-code");
const btnErstellen = document.getElementById("btn-erstellen");
const btnBeitreten = document.getElementById("btn-beitreten");
const startError = document.getElementById("start-error");

const anzeigeCode = document.getElementById("anzeige-code");
const farbAuswahl = document.getElementById("farb-auswahl");
const iconAuswahl = document.getElementById("icon-auswahl");
const avatarHinweis = document.getElementById("avatar-hinweis");
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
btnBeitreten.disabled = true;
startError.textContent = "Verbinde …";
authBereit
  .then(() => {
    btnErstellen.disabled = false;
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
      farbe: zustand.farbe, icon: zustand.icon
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
  raum: null,
  spieler: [],
  istLeiter: false
};

let raumUnsubscribe = null;
let spielerUnsubscribe = null;
let aktivesSpielModul = null;
let aktivesSpielId = null;

function raumRef() { return doc(db, RAEUME, zustand.code); }
function spielerRef(id = spielerId) { return doc(db, RAEUME, zustand.code, "spieler", id); }

// ---------- Avatar-Auswahl (Farbe + Profilbild) ----------
// Prüft per Transaktion direkt vor dem Schreiben, ob der Wert nicht gerade von jemand
// anderem belegt wurde - so bekommen (praktisch) nie zwei Leute dieselbe Farbe.
async function waehleAvatarFeld(feld, wert) {
  if (!zustand.code) return;
  avatarHinweis.textContent = "";
  const andere = zustand.spieler.filter((s) => s.id !== spielerId).map((s) => s.id);

  try {
    await runTransaction(db, async (tx) => {
      for (const id of andere) {
        const snap = await tx.get(spielerRef(id));
        if (snap.exists() && snap.data()[feld] === wert) throw new Error("VERGEBEN");
      }
      tx.update(spielerRef(), { [feld]: wert });
    });
    if (feld === "farbe") zustand.farbe = wert; else zustand.icon = wert;
    sitzungSpeichern();
  } catch (e) {
    if (e.message === "VERGEBEN") {
      avatarHinweis.textContent = (feld === "farbe" ? "Diese Farbe" : "Dieses Profilbild") +
        " wurde gerade von jemand anderem gewählt. Bitte etwas anderes aussuchen.";
    } else {
      zeigeDebug("Fehler bei der Auswahl: " + e.message);
    }
  }
}

function renderFarbAuswahl() {
  const belegt = new Set(zustand.spieler.filter((s) => s.id !== spielerId && s.farbe).map((s) => s.farbe));
  farbAuswahl.innerHTML = "";
  FARBEN.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "farb-swatch";
    btn.style.background = f.hex;
    btn.title = f.name;
    if (f.hex === zustand.farbe) btn.classList.add("ausgewaehlt");
    if (belegt.has(f.hex)) { btn.classList.add("vergeben"); btn.disabled = true; }
    else btn.addEventListener("click", () => waehleAvatarFeld("farbe", f.hex));
    farbAuswahl.appendChild(btn);
  });
}

function renderIconAuswahl() {
  const belegt = new Set(zustand.spieler.filter((s) => s.id !== spielerId && s.icon).map((s) => s.icon));
  iconAuswahl.innerHTML = "";
  AVATARE.forEach((avatar) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-swatch";
    btn.innerHTML = avatarHtml(avatar.id, "avatar-bild");
    if (avatar.id === zustand.icon) btn.classList.add("ausgewaehlt");
    if (belegt.has(avatar.id)) { btn.classList.add("vergeben"); btn.disabled = true; }
    else btn.addEventListener("click", () => waehleAvatarFeld("icon", avatar.id));
    iconAuswahl.appendChild(btn);
  });
}

// ---------- Spielauswahl ----------
async function waehleSpiel(id) {
  if (!zustand.istLeiter || !zustand.code) return;
  const info = spielInfo(id);
  if (!info) return;
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
    div.className = "spiel-kachel" + (zustand.istLeiter && !zuWenige ? "" : " passiv");
    div.innerHTML =
      `<span class="spiel-emoji">${spiel.emoji}</span>` +
      `<span class="spiel-name">${escapeHtml(spiel.name)}</span>` +
      `<span class="spiel-beschreibung">${escapeHtml(spiel.beschreibung)}</span>`;
    if (zustand.istLeiter && !zuWenige) div.addEventListener("click", () => waehleSpiel(spiel.id));
    spieleGrid.appendChild(div);
  });
}

function renderLobby() {
  spielerliste.innerHTML = "";
  zustand.spieler.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, 0, { punkteLinks: false });
    spielerliste.appendChild(li);
  });
  renderFarbAuswahl();
  renderIconAuswahl();
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

// ---------- Reaktion auf Änderungen am Raum ----------
function reagiereAufRaum(daten) {
  zustand.raum = daten;
  zustand.istLeiter = daten.leiterId === spielerId;

  const spielId = daten.aktuellesSpiel ?? null;

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
    if (!lobbyScreen.hidden) renderLobby();
    aktivesSpielModul?.spieler?.(zustand.spieler);
  });

  raumUnsubscribe = onSnapshot(raumRef(), (snap) => {
    const daten = snap.data();
    if (!daten) return;
    reagiereAufRaum(daten);
  });
}

function betreteRaum(code, name) {
  zustand.code = code;
  zustand.name = name;
  anzeigeCode.textContent = code;
  startScreen.hidden = true;
  lobbyScreen.hidden = false;
  topBar.hidden = false;
  starteListener(code);
}

// ---------- Raum verlassen ----------
async function verlasseRaum() {
  btnVerlassen.disabled = true;

  if (raumUnsubscribe) { raumUnsubscribe(); raumUnsubscribe = null; }
  if (spielerUnsubscribe) { spielerUnsubscribe(); spielerUnsubscribe = null; }
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

  lobbyScreen.hidden = true;
  spielWurzel.hidden = true;
  topBar.hidden = true;
  startScreen.hidden = false;
  inputCode.value = "";
  startError.textContent = "";
  btnErstellen.disabled = false;
  btnBeitreten.disabled = false;
  btnVerlassen.disabled = false;
}

btnVerlassen.addEventListener("click", verlasseRaum);

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

// Farbe und Profilbild aus der letzten Sitzung übernehmen, aber nur wenn im neuen
// Raum noch frei - sonst startet man ohne und wählt in der Lobby.
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

btnBeitreten.addEventListener("click", async () => {
  const name = inputName.value.trim();
  const code = inputCode.value.trim();
  if (!name) { startError.textContent = "Bitte gib zuerst deinen Namen ein."; return; }
  if (!code) { startError.textContent = "Bitte gib den Code ein."; return; }

  startError.textContent = "";
  btnBeitreten.disabled = true;

  try {
    const snap = await getDoc(doc(db, RAEUME, code));
    if (!snap.exists()) {
      startError.textContent = "Diesen Code gibt es nicht.";
      btnBeitreten.disabled = false;
      return;
    }

    zustand.name = name;
    zustand.code = code;

    // Belegte Farben/Bilder einmal abfragen, damit man nicht direkt mit einer
    // schon vergebenen Farbe hereinkommt.
    const vorhandene = [];
    (await getDocs(collection(db, RAEUME, code, "spieler"))).forEach((d) => vorhandene.push(d.data()));

    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte(vorhandene));

    sitzungSpeichern();
    betreteRaum(code, name);
  } catch (e) {
    zeigeDebug("Fehler beim Beitreten: " + e.message);
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
