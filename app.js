// Steuerung der App: Raum erstellen/beitreten, Lobby, Spielauswahl und das Laden
// des jeweiligen Spielmoduls. Alles Spielspezifische steckt in spiele/<id>/spiel.js.
import {
  db, RAEUME, authBereit, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, runTransaction, query, orderBy, limitToLast, where
} from "./kern/firebase.js";
import {
  FARBEN, AVATARE, FREUNDE, escapeHtml, avatarHtml, textFarbeFuer, zeigeDebug, erzeugeZufallsId
} from "./kern/ui.js";
// v202-Fix: mit Versions-Query wie bei allen anderen Dateien - sonst kann der
// Browser/GitHub-Pages-Cache hier eine alte Fassung ausliefern, obwohl
// index.html/app.js schon aktuell sind (siehe auch spiele/register.js).
// WICHTIG: bei jedem Versionssprung hier UND in spiele/register.js
// (SPIEL_VERSION) mit hochzaehlen, sonst bekommen manche Geraete
// Spiel-Fixes (spiele/<id>/spiel.js) verzoegert oder gar nicht mit.
import { SPIELE, spielInfo } from "./spiele/register.js?v=208";

export const APP_VERSION = "v208";
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

const inputRaumPrivat = document.getElementById("input-raum-privat");
const raumlisteDialog = document.getElementById("raumliste-dialog");
const raumlisteInhalt = document.getElementById("raumliste-inhalt");
const raumlisteFehler = document.getElementById("raumliste-fehler");
const btnRaumlisteSchliessen = document.getElementById("btn-raumliste-schliessen");
const btnRaumlisteCode = document.getElementById("btn-raumliste-code");
const btnBeitretenZurueck = document.getElementById("btn-beitreten-zurueck");

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
const btnWertungNaechstesSpiel = document.getElementById("btn-wertung-naechstes-spiel");
const spielmodusTabs = document.getElementById("spielmodus-tabs");
const tabSpielauswahl = document.getElementById("tab-spielauswahl");
const tabOlympiade = document.getElementById("tab-olympiade");
const spielauswahlTitel = document.getElementById("spielauswahl-titel");
const spielauswahlBereich = document.getElementById("spielauswahl-bereich");
const olympiadeBereich = document.getElementById("olympiade-bereich");
const olympiadeAuswahlGrid = document.getElementById("olympiade-auswahl-grid");
const olympiadeAuswahlListe = document.getElementById("olympiade-auswahl-liste");
const olympiadeAuswahlLeer = document.getElementById("olympiade-auswahl-leer");
const olympiadeFehler = document.getElementById("olympiade-fehler");
const btnOlympiadeStarten = document.getElementById("btn-olympiade-starten");

// v186: Chat (während Lobby und laufendem Spiel)
const chatButton = document.getElementById("btn-chat-oeffnen");
const chatBadge = document.getElementById("chat-badge");
const chatDialog = document.getElementById("chat-dialog");
const btnChatSchliessen = document.getElementById("btn-chat-schliessen");
const chatNachrichtenEl = document.getElementById("chat-nachrichten");
const chatFehler = document.getElementById("chat-fehler");
const chatForm = document.getElementById("chat-form");
const chatEingabe = document.getElementById("chat-eingabe");
const btnChatSenden = document.getElementById("btn-chat-senden");

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
let chatUnsubscribe = null;
let chatNachrichten = [];
let chatListeInitial = true;
let chatUngelesen = 0;
let aktivesSpielModul = null;
let aktivesSpielId = null;
let raumSyncIntervall = null;
let raumSyncAbrufLaeuft = false;
let letzteRaumSignatur = null;
let raumHeartbeatIntervall = null;

function raumRef() { return doc(db, RAEUME, zustand.code); }
function spielerRef(id = spielerId) { return doc(db, RAEUME, zustand.code, "spieler", id); }

// ---------- Nutzungsprotokoll (v181, erweitert v182) ----------
// Damit sich später ohne Konsolenzugriff nachvollziehen lässt, wer die App
// wann nutzt und welches Spiel läuft, wird jeder Raumeintritt und jeder
// Spielstart als kleiner Eintrag mitgeschrieben - in eine Unter-Sammlung
// eines eigens dafür reservierten "Raums" mit dem Code "0000". Der Code wird
// von generiereCode() (siehe unten, Bereich 1000-9999) nie vergeben, es
// entsteht also nie eine Kollision mit einem echten Spieleabend. Wichtig:
// diese Unter-Sammlung liegt bewusst UNTER raeume/{code}/... - nur so
// erlauben es die bestehenden Firestore-Regeln (siehe ANLEITUNG.md, Abschnitt
// 5) ohne dass an den Regeln in der Firebase-Konsole irgendetwas geändert
// werden müsste. Schlägt das Schreiben fehl (z. B. offline), wird das
// bewusst nur verschluckt - das Protokoll darf das eigentliche Spiel nie
// stören oder verzögern.
const NUTZUNG_RAUM = "0000";
function protokolliere(typ, zusatz = {}) {
  setDoc(doc(collection(db, RAEUME, NUTZUNG_RAUM, "protokoll")), {
    typ,
    zeitpunkt: serverTimestamp(),
    spielerName: zustand.name || null,
    code: zustand.code || null,
    ...zusatz
  }).catch(() => { /* rein informativ, absichtlich stumm */ });
}

// v182: Welches Feld im Raum-Dokument pro Spiel die vom Spielleiter gewählte
// Runden-/Fragenanzahl enthält - fürs Nutzungsprotokoll (siehe reagiereAufRaum
// weiter unten). Ein neues Spiel taucht hier einfach nicht auf, bis jemand
// die Zeile ergänzt - dann wird für dieses Spiel keine Anzahl protokolliert,
// alles andere läuft trotzdem normal weiter.
const SPIEL_ANZAHL_FELD = {
  schaetzfragen: "sfAnzahlFragen",
  "denk-gleich": "dgAnzahlFragen",
  "zehn-treffer": "ztAnzahlRunden",
  "reih-dich-ein": "rdAnzahlKategorien",
  "wer-ist-es": "wiAnzahlFragen",
  "wann-war-es": "wwAnzahlFragen",
  blitzquiz: "bzAnzahlFragen",
  finto: "fiAnzahlFragen",
  imposter: "impAnzahlRunden",
  doppelblick: "dbAnzahlRunden"
};
// Merkt sich, für welche Kombination aus Raum+Spiel+Anzahl schon protokolliert
// wurde, damit nicht bei jeder Raum-Aktualisierung (onSnapshot feuert oft)
// derselbe Eintrag erneut geschrieben wird.
let protokolliertesRundenSchluessel = null;

// v196: Olympiade - mehrere Spiele nacheinander, siehe olympiade-Feld im
// Raum-Dokument ({ aktiv, plan: [{spielId, anzahl}], index, beendetAm }).
// Welche Spiele fuer die Olympiade waehlbar sind: alle ausser Imposter, das
// (noch) kein Punktesystem hat und sich daher nicht in die gemeinsame
// Wertung am Ende einreiht.
const OLYMPIADE_SPIELE = SPIELE.filter((s) => s.id !== "imposter");
// Vorbelegte Anzahl je Spiel in der Olympiade-Planung - bewusst bei allen
// Spielen gleich, damit eine Olympiade mit mehreren Spielen nicht von
// vornherein unterschiedlich lang pro Runde ausfaellt.
const OLYMPIADE_STANDARD_ANZAHL = 5;
// Lokaler Planungszustand des Dialogs (erst beim Klick auf "Olympiade
// starten" wird daraus ein gemeinsamer Raum-Zustand).
let olympiadePlanung = [];
// v198: statt eines eigenen Dialogs wechselt die Lobby direkt zwischen der
// normalen Spielauswahl und der Olympiade-Planung - dieser Wert merkt sich,
// welche der beiden gerade zu sehen ist (nur fuer den Spielleiter relevant).
let aktuellerSpielmodus = "auswahl";
// Verhindert, dass die Wertung bei jeder Raum-Aktualisierung erneut
// automatisch aufgeht, nachdem eine Olympiade zu Ende gegangen ist.
let olympiadeAngezeigteSignatur = null;

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
  chatButton.hidden = true;
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
    chatButton.hidden = false;
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
    await updateDoc(raumRef(), { aktuellesSpiel: id, phase: "spiel", bereitSpieler: {} });
    protokolliere("spiel_gestartet", { spielId: id, spielName: info.name });
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
    // v185: der Spielleiter kann Mitspieler*innen aus dem Raum werfen (nicht
    // sich selbst) - dafuer erscheint auf jeder anderen Kachel ein kleiner
    // "Rauswerfen"-Knopf, nur sichtbar fuer den Leiter selbst.
    const kannKicken = zustand.istLeiter && s.id !== spielerId;
    li.innerHTML =
      `<span class="lobby-avatar-rahmen">${avatarHtml(s.icon, "lobby-avatar")}` +
        (istSpielleiter ? `<span class="lobby-krone" aria-label="Spielleiter">♛</span>` : "") +
        (kannKicken ? `<button type="button" class="lobby-kick" aria-label="${escapeHtml(s.name)} aus dem Raum entfernen" title="Aus dem Raum entfernen">✕</button>` : "") +
      `</span>` +
      `<strong>${escapeHtml(s.name)}</strong>` +
      (istSpielleiter ? `<small>Spielleiter</small>` : "");
    if (kannKicken) {
      li.querySelector(".lobby-kick").addEventListener("click", (ev) => {
        ev.stopPropagation();
        kickeSpieler(s.id, s.name);
      });
    }
    spielerliste.appendChild(li);
  });
  aktualisiereWertungsKachel();
  aktualisiereSpielmodusTabs();
  renderSpieleAuswahl();
}

// ---------- Spieler rauswerfen (nur Spielleiter) ----------
async function kickeSpieler(zielId, zielName) {
  if (!zustand.istLeiter || zielId === spielerId) return;
  const bestaetigt = window.confirm(`${zielName} wirklich aus dem Raum entfernen?`);
  if (!bestaetigt) return;
  try {
    await deleteDoc(spielerRef(zielId));
  } catch (e) {
    zeigeDebug("Spieler konnte nicht entfernt werden: " + e.message);
  }
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
  // v202: "Naechstes Spiel" nur waehrend einer laufenden Olympiade und nur
  // fuer den Spielleiter - der Endstand des gerade beendeten Spiels bleibt
  // jetzt erst stehen, statt dass diese Wertung automatisch aufgeht; von
  // hier aus geht es auf Wunsch weiter zum naechsten Olympiade-Spiel.
  btnWertungNaechstesSpiel.hidden = !(
    zustand.istLeiter && zustand.raum?.olympiade?.aktiv && Boolean(zustand.raum?.aktuellesSpiel)
  );
  btnWertungNaechstesSpiel.disabled = false;
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
btnWertungNaechstesSpiel.addEventListener("click", () => {
  btnWertungNaechstesSpiel.disabled = true;
  schliesseWertungDialog(false);
  raumNavigationAusfuehren();
});
wertungDialog.addEventListener("click", (event) => {
  if (event.target === wertungDialog) schliesseWertungDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!wertungDialog.hidden) schliesseWertungDialog();
});

// ---------- Olympiade (v196, v198: inline statt eigener Dialog) ----------
// Blendet den Tab-Umschalter zwischen "Spiel auswählen" und "Olympiade" nur
// fuer den Spielleiter ein - Mitspieler*innen sehen weiterhin nur die
// normale (fuer sie ohnehin nicht klickbare) Spielauswahl.
function aktualisiereSpielmodusTabs() {
  const zeigeTabs = zustand.istLeiter;
  spielmodusTabs.hidden = !zeigeTabs;
  spielauswahlTitel.hidden = zeigeTabs;
  if (zeigeTabs) {
    setzeSpielmodusAnzeige();
  } else {
    spielauswahlBereich.hidden = false;
    olympiadeBereich.hidden = true;
  }
}

function setzeSpielmodusAnzeige() {
  const istOlympiade = aktuellerSpielmodus === "olympiade";
  tabSpielauswahl.classList.toggle("aktiv", !istOlympiade);
  tabSpielauswahl.setAttribute("aria-selected", String(!istOlympiade));
  tabOlympiade.classList.toggle("aktiv", istOlympiade);
  tabOlympiade.setAttribute("aria-selected", String(istOlympiade));
  spielauswahlBereich.hidden = istOlympiade;
  olympiadeBereich.hidden = !istOlympiade;
}

function wechsleSpielmodus(modus) {
  if (!zustand.istLeiter || modus === aktuellerSpielmodus) return;
  aktuellerSpielmodus = modus;
  if (modus === "olympiade") {
    olympiadePlanung = [];
    olympiadeFehler.textContent = "";
    renderOlympiadePlanung();
  }
  setzeSpielmodusAnzeige();
}

function olympiadeSpielHinzufuegen(id) {
  if (olympiadePlanung.some((e) => e.spielId === id)) return;
  const info = spielInfo(id);
  if (!info) return;
  olympiadePlanung.push({ spielId: id, anzahl: OLYMPIADE_STANDARD_ANZAHL });
  renderOlympiadePlanung();
}

function olympiadeSpielEntfernen(id) {
  olympiadePlanung = olympiadePlanung.filter((e) => e.spielId !== id);
  renderOlympiadePlanung();
}



// v200: Reihenfolge per Drag & Drop statt Pfeil-Buttons verschieben - siehe
// olympiadeZeileGriffPointerDown() unten fuer den Ablauf. Waehrend des Ziehens
// wird nur optisch per transform verschoben (DOM-Reihenfolge bleibt gleich),
// olympiadePlanung wird erst beim Loslassen tatsaechlich umsortiert.
let olympiadeDrag = null;

function olympiadeZeileGriffPointerDown(ev, li) {
  if (ev.pointerType === "mouse" && ev.button !== 0) return;
  const liste = li.parentElement;
  const zeilen = [...liste.children];
  const startIndex = zeilen.indexOf(li);
  if (startIndex < 0) return;
  const rect = li.getBoundingClientRect();
  const luecke = parseFloat(getComputedStyle(liste).rowGap || getComputedStyle(liste).gap || "0") || 0;
  ev.preventDefault();
  li.setPointerCapture(ev.pointerId);
  olympiadeDrag = {
    li, zeilen, startIndex, zielIndex: startIndex,
    startY: ev.clientY, hoehe: rect.height + luecke, pointerId: ev.pointerId
  };
  li.classList.add("ziehend");
}

function olympiadeZeileGriffPointerMove(ev) {
  const d = olympiadeDrag;
  if (!d || ev.pointerId !== d.pointerId) return;
  const dy = ev.clientY - d.startY;
  d.li.style.transform = `translateY(${dy}px)`;

  let neuesZiel = d.startIndex + Math.round(dy / d.hoehe);
  neuesZiel = Math.max(0, Math.min(d.zeilen.length - 1, neuesZiel));
  if (neuesZiel === d.zielIndex) return;
  d.zielIndex = neuesZiel;
  d.zeilen.forEach((zeile, i) => {
    if (zeile === d.li) return;
    let versatz = 0;
    if (d.zielIndex <= i && i < d.startIndex) versatz = d.hoehe;
    else if (d.startIndex < i && i <= d.zielIndex) versatz = -d.hoehe;
    zeile.style.transform = versatz ? `translateY(${versatz}px)` : "";
  });
}

function olympiadeZeileGriffPointerEnde(ev) {
  const d = olympiadeDrag;
  if (!d || ev.pointerId !== d.pointerId) return;
  try { d.li.releasePointerCapture(ev.pointerId); } catch (e) { /* egal */ }
  d.li.classList.remove("ziehend");
  d.li.style.transform = "";
  d.zeilen.forEach((zeile) => { if (zeile !== d.li) zeile.style.transform = ""; });
  olympiadeDrag = null;
  if (d.zielIndex !== d.startIndex) {
    const [eintrag] = olympiadePlanung.splice(d.startIndex, 1);
    olympiadePlanung.splice(d.zielIndex, 0, eintrag);
  }
  renderOlympiadePlanung();
}

document.addEventListener("pointermove", olympiadeZeileGriffPointerMove);
document.addEventListener("pointerup", olympiadeZeileGriffPointerEnde);
document.addEventListener("pointercancel", olympiadeZeileGriffPointerEnde);

function olympiadeAnzahlAendern(id, wert) {
  const eintrag = olympiadePlanung.find((e) => e.spielId === id);
  if (!eintrag) return;
  let anzahl = parseInt(wert, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > 50) anzahl = 50;
  eintrag.anzahl = anzahl;
}

function renderOlympiadePlanung() {
  // Verfuegbare Spiele: noch nicht ausgewaehlt, sonst wie in der normalen
  // Spielauswahl grau/deaktiviert, wenn zu wenige Mitspieler*innen da sind.
  olympiadeAuswahlGrid.innerHTML = "";
  OLYMPIADE_SPIELE.forEach((spiel) => {
    if (olympiadePlanung.some((e) => e.spielId === spiel.id)) return;
    const zuWenige = zustand.spieler.length < spiel.minSpieler;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "spiel-kachel olympiade-spiel-kachel" + (zuWenige ? " passiv" : "");
    if (spiel.farbe) btn.style.setProperty("--spiel-farbe", spiel.farbe);
    btn.innerHTML =
      `<span class="spiel-emoji">${spiel.emoji}</span>` +
      `<span class="spiel-name">${escapeHtml(spiel.name)}</span>` +
      (zuWenige ? `<span class="spiel-badge">mind. ${spiel.minSpieler} Spieler</span>` : `<span class="olympiade-hinzufuegen-hinweis">+ hinzufuegen</span>`);
    if (zuWenige) btn.disabled = true;
    else btn.addEventListener("click", () => olympiadeSpielHinzufuegen(spiel.id));
    olympiadeAuswahlGrid.appendChild(btn);
  });

  // Ausgewaehlte Spiele in Reihenfolge, mit Anzahl-Eingabe und Sortier-Pfeilen.
  olympiadeAuswahlListe.innerHTML = "";
  olympiadePlanung.forEach((eintrag, i) => {
    const info = spielInfo(eintrag.spielId);
    if (!info) return;
    const li = document.createElement("li");
    li.className = "olympiade-auswahl-zeile";
    li.innerHTML =
      // v200: Pfeil-Buttons durch einen Ziehgriff ersetzt - Reihenfolge wird
      // jetzt per Drag & Drop (siehe olympiadeZeileGriffPointerDown()) statt
      // ueber ↑/↓ festgelegt, das schafft mehr Platz fuer den Spielnamen.
      `<span class="olympiade-zeile-griff" aria-hidden="true">⠿</span>` +
      `<span class="olympiade-zeile-nummer">${i + 1}</span>` +
      `<span class="olympiade-zeile-emoji">${info.emoji}</span>` +
      `<span class="olympiade-zeile-name">${escapeHtml(info.name)}</span>` +
      `<label class="olympiade-zeile-anzahl">` +
        `<span class="nur-screenreader">Anzahl fuer ${escapeHtml(info.name)}</span>` +
        `<input type="text" inputmode="numeric" class="olympiade-anzahl-feld" value="${eintrag.anzahl}">` +
      `</label>` +
      `<button type="button" class="olympiade-zeile-btn olympiade-zeile-entfernen" aria-label="${escapeHtml(info.name)} entfernen">✕</button>`;
    const olympiadeAnzahlFeld = li.querySelector(".olympiade-anzahl-feld");
    olympiadeAnzahlFeld.addEventListener("change", (ev) => olympiadeAnzahlAendern(eintrag.spielId, ev.target.value));
    // v200: Wert beim Reintippen sofort markiert, wie bei den Anzahl-Feldern
    // in den einzelnen Spielen - erspart das manuelle Loeschen der alten Zahl.
    olympiadeAnzahlFeld.addEventListener("focus", () => olympiadeAnzahlFeld.select());
    li.querySelector(".olympiade-zeile-griff").addEventListener("pointerdown", (ev) => olympiadeZeileGriffPointerDown(ev, li));
    li.querySelector(".olympiade-zeile-entfernen").addEventListener("click", () => olympiadeSpielEntfernen(eintrag.spielId));
    olympiadeAuswahlListe.appendChild(li);
  });

  olympiadeAuswahlLeer.hidden = olympiadePlanung.length > 0;
  btnOlympiadeStarten.disabled = olympiadePlanung.length === 0;
}

async function starteOlympiade() {
  if (!zustand.istLeiter || olympiadePlanung.length === 0) return;
  olympiadeFehler.textContent = "";
  const plan = olympiadePlanung.map((e) => ({ spielId: e.spielId, anzahl: e.anzahl }));
  try {
    await updateDoc(raumRef(), {
      olympiade: { aktiv: true, plan, index: 0 },
      aktuellesSpiel: plan[0].spielId,
      phase: "spiel",
      bereitSpieler: {}
    });
    protokolliere("olympiade_gestartet", { anzahlSpiele: plan.length });
  } catch (e) {
    olympiadeFehler.textContent = "Die Olympiade konnte nicht gestartet werden: " + e.message;
  }
}

tabSpielauswahl.addEventListener("click", () => wechsleSpielmodus("auswahl"));
tabOlympiade.addEventListener("click", () => wechsleSpielmodus("olympiade"));
btnOlympiadeStarten.addEventListener("click", starteOlympiade);

// ---------- Chat (v186) ----------
// Ein Chat pro Raum, in einer Unter-Sammlung "chat" (gleiches Muster wie
// "spieler"/"wertung") - läuft während der ganzen Raum-Sitzung mit, also
// sowohl in der Lobby als auch während eines laufenden Spiels, nicht nur
// während des Spiels selbst.
function chatRef() { return collection(db, RAEUME, zustand.code, "chat"); }

function formatiereChatZeit(zeit) {
  if (!zeit || typeof zeit.toDate !== "function") return "";
  return zeit.toDate().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function renderChatNachrichten() {
  if (!chatNachrichten.length) {
    chatNachrichtenEl.innerHTML = '<p class="chat-leer">Noch keine Nachrichten - schreib die erste!</p>';
    return;
  }
  chatNachrichtenEl.innerHTML = chatNachrichten.map((n) => {
    const eigene = n.autorId === spielerId;
    // v188: statt des Namens in schwer lesbarer Textfarbe zeigt jede fremde
    // Nachricht das Profilbild der Person (wie in Lobby/Wertung) - eindeutig
    // erkennbar, ohne auf Kontrast/Textfarbe angewiesen zu sein.
    return (
      `<div class="chat-nachricht ${eigene ? "chat-eigene" : "chat-fremde"}">` +
      (eigene ? "" : avatarHtml(n.icon, "chat-avatar")) +
      `<div class="chat-inhalt">` +
      `<span class="chat-blase">${escapeHtml(n.text || "")}</span>` +
      `<span class="chat-zeit">${formatiereChatZeit(n.zeit)}</span>` +
      `</div>` +
      `</div>`
    );
  }).join("");
  chatNachrichtenEl.scrollTop = chatNachrichtenEl.scrollHeight;
}

function aktualisiereChatBadge() {
  chatBadge.hidden = chatUngelesen <= 0;
  chatBadge.textContent = chatUngelesen > 9 ? "9+" : String(chatUngelesen);
}

function oeffneChatDialog() {
  chatDialog.hidden = false;
  document.body.classList.add("chat-offen");
  chatUngelesen = 0;
  aktualisiereChatBadge();
  renderChatNachrichten();
  requestAnimationFrame(() => chatEingabe.focus());
}

function schliesseChatDialog(fokusZurueck = true) {
  chatDialog.hidden = true;
  document.body.classList.remove("chat-offen");
  if (fokusZurueck && !chatButton.hidden) chatButton.focus();
}

chatButton.addEventListener("click", oeffneChatDialog);
btnChatSchliessen.addEventListener("click", () => schliesseChatDialog());
chatDialog.addEventListener("click", (event) => {
  if (event.target === chatDialog) schliesseChatDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatDialog.hidden) schliesseChatDialog();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = chatEingabe.value.trim();
  if (!text || !zustand.code) return;
  chatFehler.textContent = "";
  chatEingabe.value = "";
  btnChatSenden.disabled = true;
  try {
    await setDoc(doc(chatRef()), {
      text: text.slice(0, 500),
      autorId: spielerId,
      autorName: zustand.name || "?",
      farbe: zustand.farbe,
      icon: zustand.icon,
      zeit: serverTimestamp()
    });
  } catch (e) {
    chatFehler.textContent = "Nachricht konnte nicht gesendet werden.";
    zeigeDebug("Chat-Fehler: " + e.message);
  }
  btnChatSenden.disabled = false;
  chatEingabe.focus();
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
    // v196: In einer laufenden Olympiade gibt dies die vorab festgelegte
    // Anzahl (Runden/Fragen) fuer das GERADE aktive Spiel zurueck, damit es
    // ohne eigenes Setup-Fenster direkt mit dieser Anzahl starten kann - sonst
    // null (keine Olympiade, oder das Spiel ist nicht das aktuelle Olympiade-Spiel).
    get olympiadeAnzahl() {
      const oly = zustand.raum?.olympiade;
      if (!oly?.aktiv) return null;
      const eintrag = oly.plan?.[oly.index];
      if (!eintrag || eintrag.spielId !== aktivesSpielId) return null;
      return eintrag.anzahl || null;
    },
    // Vom Spiel aufzurufen, wenn es fertig ist: zurück zur Spielauswahl (oder,
    // in einer laufenden Olympiade, direkt weiter zum naechsten Spiel dieser
    // Olympiade), ohne dass jemand den Raum neu betreten muss.
    zurueckZurAuswahl: async () => {
      try {
        const oly = zustand.raum?.olympiade;
        if (oly?.aktiv) {
          const naechsterIndex = oly.index + 1;
          if (naechsterIndex < (oly.plan?.length ?? 0)) {
            await updateDoc(raumRef(), {
              aktuellesSpiel: oly.plan[naechsterIndex].spielId,
              phase: "spiel",
              bereitSpieler: {},
              "olympiade.index": naechsterIndex
            });
          } else {
            await updateDoc(raumRef(), {
              aktuellesSpiel: null,
              phase: "lobby",
              "olympiade.aktiv": false,
              "olympiade.beendetAm": serverTimestamp()
            });
          }
          return;
        }
        await updateDoc(raumRef(), { aktuellesSpiel: null, phase: "lobby" });
      }
      catch (e) { zeigeDebug("Fehler beim Zurückkehren: " + e.message); }
    },
    // v113: gemeinsame Rundenfortschrittsanzeige oben rechts im Spielkopf (z. B.
    // "2/8") - jedes Spiel ruft das bei jeder Statusänderung mit seinem eigenen
    // Text auf, ein leerer/undefinierter Wert blendet die Anzeige wieder aus.
    fortschritt: (text) => {
      spielKopfFortschritt.textContent = text || "";
      spielKopfFortschritt.hidden = !text;
    },
    // v202: vom eigenen Endstand-Bildschirm aus (waehrend einer aktiven
    // Olympiade) zur Gesamtwertung springen statt direkt zum naechsten
    // Spiel - "Naechstes Spiel" gibt es von dort aus jetzt nur noch als
    // eigenen Button INNERHALB der Gesamtwertung (siehe oeffneWertungDialog()).
    zeigeGesamtwertung: () => oeffneWertungDialog(),
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
  // v185: der Verlassen-Button ist jetzt für ALLE Spieler*innen sichtbar,
  // nicht mehr nur für den Spielleiter. Vorher konnten Mitspieler*innen
  // weder das Spiel noch den Raum verlassen, wenn der Spielleiter einfach
  // offline/inaktiv war. Der Leiter behält seine bisherige Funktion (Klick
  // beendet das Spiel für ALLE und geht zurück zur Spielauswahl); bei
  // Mitspieler*innen verlässt derselbe Button stattdessen nur sie selbst den
  // Raum, ohne das laufende Spiel für die anderen zu beenden (siehe
  // raumNavigationAusfuehren()).
  // v189: für Mitspieler*innen sieht der Button jetzt genauso aus wie im
  // Hauptmenü (Icon oben rechts statt Text-Pille oben links) und öffnet
  // dieselbe Bestätigung ("Raum verlassen? Ja/Nein") statt sofort ohne
  // Rückfrage zu verlassen - siehe btnVerlassen-Klick-Handler weiter unten.
  const verlassenAlsIcon = imSpiel && !zustand.istLeiter;
  topBar.classList.toggle("verlassen-icon-modus", verlassenAlsIcon);
  btnVerlassen.classList.toggle("verlassen-icon", verlassenAlsIcon);
  if (verlassenAlsIcon) {
    btnVerlassen.innerHTML =
      '<img src="bilder/icon-raum-verlassen.svg" width="20" height="20" alt="">' +
      '<span class="nur-screenreader">Raum verlassen</span>';
  } else {
    btnVerlassen.textContent = imSpiel && zustand.istLeiter ? "←  Spielauswahl" : "Raum verlassen";
  }
  btnVerlassen.disabled = false;
  btnVerlassen.hidden = false;
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
  // v198: kommt die Lobby gerade aus einem beendeten Spiel zurueck (vorher
  // aktiv, jetzt keins mehr), zeigt sie wieder die normale Spielauswahl statt
  // eine noch offene Olympiade-Planung stehen zu lassen. Waehrend man selbst
  // in der Lobby herumklickt, feuert dieser Listener aber staendig erneut
  // (z. B. wenn jemand beitritt) - deshalb NICHT bei jedem Aufruf zuruecksetzen.
  const kommtGeradeAusSpiel = !spielId && Boolean(aktivesSpielId);
  aktualisiereRaumNavigation(spielId);

  // v182: Sobald der Spielleiter eine Runden-/Fragenanzahl wählt, landet das
  // im Nutzungsprotokoll - nur beim Leiter selbst (sonst käme der Eintrag
  // einmal pro Person im Raum, weil dieser Listener bei allen feuert).
  if (zustand.istLeiter && spielId) {
    const feld = SPIEL_ANZAHL_FELD[spielId];
    const anzahl = feld ? daten[feld] : null;
    if (anzahl) {
      const schluessel = `${zustand.code}:${spielId}:${anzahl}`;
      if (schluessel !== protokolliertesRundenSchluessel) {
        protokolliertesRundenSchluessel = schluessel;
        protokolliere("runden_gewaehlt", { spielId, spielName: spielInfo(spielId)?.name, anzahl });
      }
    }
  }

  if (spielId !== aktivesSpielId) {
    entladeSpiel();
    if (spielId) ladeSpiel(spielId);
  }

  // v196: Ist gerade eine Olympiade zu Ende gegangen, geht bei allen im Raum
  // automatisch die Wertung mit der Gesamtpunktzahl aller gespielten Spiele
  // auf - "beendetAm" dient als Signatur, damit das nicht bei jeder weiteren
  // Raum-Aktualisierung (onSnapshot feuert oft) erneut passiert.
  const olyBeendetAm = daten.olympiade?.beendetAm;
  if (!spielId && !daten.olympiade?.aktiv && olyBeendetAm) {
    const signatur = `${zustand.code}:${olyBeendetAm.toMillis?.() ?? olyBeendetAm}`;
    if (signatur !== olympiadeAngezeigteSignatur) {
      olympiadeAngezeigteSignatur = signatur;
      requestAnimationFrame(() => oeffneWertungDialog());
    }
  }

  // v202: Ist gerade EIN Spiel innerhalb einer noch laufenden Olympiade zu
  // Ende gegangen, geht die Gesamtwertung NICHT mehr automatisch auf (das
  // hat vorher den gerade erst angezeigten Endstand des Spiels sofort
  // wieder verdeckt) - stattdessen bleibt der Endstand stehen, und wer will,
  // oeffnet die Wertung ueber die "Wertung"-Kachel selbst; von dort geht es
  // dann per "Naechstes Spiel"-Button weiter (siehe oeffneWertungDialog()).

  if (spielId) {
    lobbyScreen.hidden = true;
    spielWurzel.hidden = false;
    aktivesSpielModul?.raumDaten?.(daten);
  } else {
    if (kommtGeradeAusSpiel) aktuellerSpielmodus = "auswahl";
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
    // v185: Fehlt der eigene Eintrag komplett, obwohl das eigene Profil schon
    // bestätigt war, wurde man vom Spielleiter aus dem Raum geworfen (siehe
    // kickeSpieler()) - dann automatisch und mit Hinweis zurück zum Startbildschirm,
    // statt in einer Lobby/einem Spiel ohne eigenen Spieler-Eintrag hängen zu bleiben.
    if (zustand.profilBestaetigt && !eigenerEintrag && zustand.code) {
      wurdeAusRaumGeworfen();
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

  // v186: Chat - läuft die ganze Raum-Sitzung über mit (Lobby + Spiel). Beim
  // allerersten Snapshot nach dem Verbinden zählen die schon vorhandenen
  // Nachrichten NICHT als "neu" (docChanges() liefert für sie trotzdem
  // "added") - sonst stünde direkt beim Betreten ein falscher Ungelesen-Zähler.
  chatListeInitial = true;
  chatUnsubscribe = onSnapshot(
    query(collection(db, RAEUME, code, "chat"), orderBy("zeit", "asc"), limitToLast(200)),
    (snap) => {
      chatNachrichten = [];
      snap.forEach((d) => chatNachrichten.push({ id: d.id, ...d.data() }));
      if (!chatListeInitial) {
        snap.docChanges().forEach((change) => {
          if (change.type === "added" && change.doc.data().autorId !== spielerId && chatDialog.hidden) {
            chatUngelesen++;
          }
        });
        aktualisiereChatBadge();
      }
      chatListeInitial = false;
      if (!chatDialog.hidden) renderChatNachrichten();
    },
    (e) => zeigeDebug("Chat-Synchronisation unterbrochen: " + e.message)
  );

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

  // Solange jemand im Raum aktiv ist, wird "zuletztAktiv" regelmaessig
  // aktualisiert. Die Raumliste blendet Raeume aus, die lange keinen
  // Heartbeat mehr hatten (z. B. weil alle die App einfach geschlossen statt
  // "Raum verlassen" geklickt haben, wodurch sonst niemand aufraeumt).
  if (raumHeartbeatIntervall) clearInterval(raumHeartbeatIntervall);
  raumHeartbeatIntervall = setInterval(() => {
    if (zustand.code !== code) return;
    updateDoc(doc(db, RAEUME, code), { zuletztAktiv: serverTimestamp() }).catch(() => {});
  }, 120000);
}

// v182: betreteRaum() wird von drei Stellen aus aufgerufen - Raum erstellen,
// Raum beitreten UND beim automatischen Fortsetzen einer gespeicherten
// Sitzung nach jedem Neuladen der Seite. Würde hier protokolliert, gäbe es
// bei jedem Tab-Refresh im Raum einen neuen Eintrag im Nutzungsprotokoll
// (das war der Grund für die mehrfachen "App geöffnet"-Einträge). Protokolliert
// wird deshalb NICHT hier, sondern gezielt an den beiden echten Ereignissen:
// btnErstellen-Handler ("raum_eroeffnet") und beitretenForm-Handler
// ("raum_beigetreten"). Das Fortsetzen einer Sitzung protokolliert bewusst
// nichts.
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
    chatButton.hidden = false;
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
  if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
  chatNachrichten = [];
  chatListeInitial = true;
  chatUngelesen = 0;
  aktualisiereChatBadge();
  schliesseChatDialog(false);
  chatButton.hidden = true;
  if (raumSyncIntervall) { clearInterval(raumSyncIntervall); raumSyncIntervall = null; }
  if (raumHeartbeatIntervall) { clearInterval(raumHeartbeatIntervall); raumHeartbeatIntervall = null; }
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

// v185: wird aufgerufen, wenn der eigene Spieler-Eintrag plötzlich aus dem
// Raum verschwunden ist, weil der Spielleiter einen aus dem Raum geworfen
// hat (siehe kickeSpieler()). Nutzt dieselbe Aufräum-Logik wie verlasseRaum()
// (der eigene Eintrag ist ja schon weg, das deleteDoc dort ist dann einfach
// ein No-op), zeigt danach aber zusätzlich einen erklärenden Hinweis auf dem
// Startbildschirm an.
async function wurdeAusRaumGeworfen() {
  await verlasseRaum();
  startError.textContent = "Du wurdest vom Spielleiter aus dem Raum entfernt.";
}

async function raumNavigationAusfuehren() {
  const spielId = zustand.raum?.aktuellesSpiel ?? null;
  if (!spielId) {
    await verlasseRaum();
    return;
  }
  // v185: Mitspieler*innen können ein laufendes Spiel nicht für alle
  // beenden (das darf weiterhin nur der Leiter) - für sie verlässt der
  // Button stattdessen einfach den Raum, damit sie nicht mehr blockiert
  // sind, wenn der Spielleiter inaktiv ist.
  if (!zustand.istLeiter) {
    await verlasseRaum();
    return;
  }

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

// v189: im Spiel bekommt nur noch der Spielleiter den direkten Klick-Effekt
// (Spiel für alle beenden) - Mitspieler*innen sehen stattdessen dieselbe
// Bestätigung wie im Hauptmenü (siehe aktualisiereRaumNavigation()).
btnVerlassen.addEventListener("click", () => {
  if (zustand.istLeiter) raumNavigationAusfuehren();
  else oeffneRaumVerlassenDialog(btnVerlassen);
});
let raumVerlassenAusloeser = null;
function oeffneRaumVerlassenDialog(ausloeser) {
  raumVerlassenAusloeser = ausloeser || btnLobbyVerlassen;
  raumVerlassenDialog.hidden = false;
  document.body.classList.add("raum-verlassen-offen");
  requestAnimationFrame(() => btnRaumVerlassenNein.focus());
}

function schliesseRaumVerlassenDialog() {
  raumVerlassenDialog.hidden = true;
  document.body.classList.remove("raum-verlassen-offen");
  (raumVerlassenAusloeser || btnLobbyVerlassen).focus();
}

// v199: nicht direkt als Handler uebergeben - addEventListener wuerde dann
// das Klick-Event (statt des Buttons) als "ausloeser" hineinreichen, worauf
// spaeter .focus() aufgerufen wird -> "focus is not a function".
btnLobbyVerlassen.addEventListener("click", () => oeffneRaumVerlassenDialog(btnLobbyVerlassen));
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
      zuletztAktiv: serverTimestamp(),
      leiterId: spielerId,
      phase: "lobby",
      aktuellesSpiel: null,
      privat: inputRaumPrivat.checked
    });
    await setDoc(doc(db, RAEUME, code, "spieler", spielerId), startWerte([]), { merge: true });

    zustand.code = code;
    sitzungSpeichern();
    protokolliere("raum_eroeffnet");
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

btnBeitretenSchliessen.addEventListener("click", () => schliesseBeitretenDialog());
beitretenDialog.addEventListener("click", (event) => {
  if (event.target === beitretenDialog) schliesseBeitretenDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !beitretenDialog.hidden) schliesseBeitretenDialog();
  if (event.key === "Escape" && !raumlisteDialog.hidden) schliesseRaumlisteDialog();
});
inputCode.addEventListener("input", () => {
  inputCode.value = inputCode.value.replace(/\D/g, "").slice(0, 4);
  beitretenError.textContent = "";
});
btnBeitretenZurueck.addEventListener("click", () => {
  schliesseBeitretenDialog(false);
  oeffneRaumlisteDialog();
});

// Gemeinsame Beitritts-Logik (v191) - genutzt sowohl von der Code-Eingabe als
// auch vom direkten Klick auf einen öffentlichen Raum in der Raumliste.
async function raumBeitreten(code, name, { aufFehler } = {}) {
  try {
    const snap = await getDoc(doc(db, RAEUME, code));
    if (!snap.exists()) {
      aufFehler?.("Diesen Raum gibt es nicht.");
      return false;
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
    protokolliere("raum_beigetreten");
    betreteRaum(code, name);
    return true;
  } catch (e) {
    zeigeDebug("Fehler beim Beitreten: " + e.message);
    aufFehler?.("Der Raum konnte nicht geöffnet werden. Versuche es erneut.");
    return false;
  }
}

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
  const erfolgreich = await raumBeitreten(code, name, {
    aufFehler: (text) => { beitretenError.textContent = text; }
  });
  if (erfolgreich) schliesseBeitretenDialog(false);
  btnBeitreten.disabled = false;
});

// ---------- Raumliste: offene Räume durchsuchen (v191) ----------
function oeffneRaumlisteDialog() {
  const name = inputName.value.trim();
  if (!name) {
    startError.textContent = "Bitte gib zuerst deinen Namen ein.";
    inputName.focus();
    return;
  }
  startError.textContent = "";
  raumlisteFehler.textContent = "";
  raumlisteDialog.hidden = false;
  document.body.classList.add("beitreten-offen");
  ladeOffeneRaeume();
}

function schliesseRaumlisteDialog(fokusZurueck = true) {
  raumlisteDialog.hidden = true;
  document.body.classList.remove("beitreten-offen");
  if (fokusZurueck) btnBeitretenOeffnen.focus();
}

btnBeitretenOeffnen.addEventListener("click", oeffneRaumlisteDialog);
btnRaumlisteSchliessen.addEventListener("click", () => schliesseRaumlisteDialog());
raumlisteDialog.addEventListener("click", (event) => {
  if (event.target === raumlisteDialog) schliesseRaumlisteDialog();
});
btnRaumlisteCode.addEventListener("click", () => {
  schliesseRaumlisteDialog(false);
  oeffneBeitretenDialog();
});

// Holt alle Räume, die noch in der Lobby (nicht mitten im Spiel) sind, und
// blendet dabei verwaiste Räume ohne Spieler (z. B. weil niemand ordentlich
// verlassen hat) aus - eine echte Löschung alter Räume gibt es bisher nicht.
// Raeume gelten ab diesem Alter ohne Heartbeat als verwaist und werden aus
// der Liste ausgeblendet (siehe starteListener() fuer den Heartbeat selbst).
const RAUM_INAKTIV_MS = 6 * 60 * 60 * 1000; // 6 Stunden

async function ladeOffeneRaeume() {
  raumlisteInhalt.innerHTML = '<p class="raumliste-hinweis">Räume werden geladen …</p>';
  raumlisteFehler.textContent = "";
  try {
    await authBereit;
    const snap = await getDocs(query(collection(db, RAEUME), where("phase", "==", "lobby")));
    const jetzt = Date.now();
    const raeume = [];
    for (const raumDoc of snap.docs) {
      const daten = raumDoc.data();
      // Fallback auf erstelltAm fuer Raeume, die vor Einfuehrung von
      // zuletztAktiv angelegt wurden.
      const letzteAktivitaet = (daten.zuletztAktiv || daten.erstelltAm)?.toDate?.();
      if (letzteAktivitaet && jetzt - letzteAktivitaet.getTime() > RAUM_INAKTIV_MS) continue;
      const spielerSnap = await getDocs(collection(db, RAEUME, raumDoc.id, "spieler"));
      if (spielerSnap.empty) continue;
      let leiterName = "";
      const spielerListe = [];
      spielerSnap.forEach((s) => {
        const daten2 = s.data();
        if (s.id === daten.leiterId) leiterName = daten2.name || "";
        spielerListe.push({ id: s.id, name: daten2.name || "", icon: daten2.icon || "", farbe: daten2.farbe || "" });
      });
      raeume.push({
        code: raumDoc.id,
        privat: !!daten.privat,
        anzahlSpieler: spielerSnap.size,
        leiterName,
        leiterId: daten.leiterId || "",
        spielerListe,
        erstelltAm: daten.erstelltAm?.toDate?.() || null
      });
    }
    raeume.sort((a, b) => b.anzahlSpieler - a.anzahlSpieler);
    renderRaumliste(raeume);
  } catch (e) {
    zeigeDebug("Fehler beim Laden der Raumliste: " + e.message);
    raumlisteInhalt.innerHTML = "";
    raumlisteFehler.textContent = "Die Raumliste konnte nicht geladen werden.";
  }
}

// Zeigt die Uhrzeit (heute) bzw. Datum + Uhrzeit (aeltere Raeume) der
// Raumerstellung an.
function formatRaumZeit(datum) {
  if (!datum) return "";
  const heute = new Date();
  const istHeute = datum.toDateString() === heute.toDateString();
  const uhrzeit = datum.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (istHeute) return `Erstellt um ${uhrzeit} Uhr`;
  const datumText = datum.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `Erstellt am ${datumText}, ${uhrzeit} Uhr`;
}

// Baut die Mini-Avatarliste (Name + Bild) fuer die aufklappbare Spieleransicht
// einer Raum-Kachel in der Raumliste.
function renderRaumSpielerListe(raum) {
  return raum.spielerListe
    .map((s) => {
      const istLeiter = s.id === raum.leiterId;
      return (
        `<li class="raumliste-spieler-zeile">` +
          `<span class="raumliste-spieler-avatar" style="--spieler-farbe:${escapeHtml(s.farbe || "#7f8c8d")}">${avatarHtml(s.icon, "raumliste-spieler-bild")}</span>` +
          `<span class="raumliste-spieler-name">${escapeHtml(s.name || "Unbenannt")}</span>` +
          (istLeiter ? `<span class="raumliste-spieler-krone" title="Spielleiter" aria-label="Spielleiter">♛</span>` : "") +
        `</li>`
      );
    })
    .join("");
}

function renderRaumliste(raeume) {
  if (raeume.length === 0) {
    raumlisteInhalt.innerHTML = '<p class="raumliste-hinweis">Gerade ist kein Raum offen. Erstelle doch einen!</p>';
    return;
  }
  raumlisteInhalt.innerHTML = "";
  raeume.forEach((raum) => {
    // Ein <div role="button"> statt <button>, weil die Kachel jetzt selbst
    // einen echten <button> (Spieler-aufklappen) enthaelt - verschachtelte
    // Buttons sind ungueltiges HTML und wuerden vom Browser aus der Kachel
    // herausgehoben.
    const kachel = document.createElement("div");
    kachel.setAttribute("role", "button");
    kachel.tabIndex = 0;
    kachel.className = "raum-kachel" + (raum.privat ? " raum-kachel-privat" : "");
    const spielerText = raum.anzahlSpieler === 1 ? "1 Spieler*in" : `${raum.anzahlSpieler} Spieler*innen`;
    const zeitText = formatRaumZeit(raum.erstelltAm);
    kachel.innerHTML =
      (raum.privat
        ? `<span class="raum-kachel-schloss">` +
            `<span class="raum-kachel-schloss-icon" aria-hidden="true">🔒</span>` +
            `<span class="raum-kachel-schloss-text">Privat</span>` +
          `</span>`
        : "") +
      `<span class="raum-kachel-info">` +
        `<strong class="raum-kachel-name">${escapeHtml(raum.leiterName ? `Raum von ${raum.leiterName}` : "Raum")}</strong>` +
        `<button type="button" class="raum-kachel-spieler-toggle" aria-expanded="false">` +
          `<span class="raum-kachel-spieler">${spielerText}</span>` +
          `<span class="raum-kachel-spieler-pfeil" aria-hidden="true">▾</span>` +
        `</button>` +
        (raum.privat ? "" : `<span class="raum-kachel-code">Code: ${escapeHtml(raum.code)}</span>`) +
        (zeitText ? `<span class="raum-kachel-zeit">${escapeHtml(zeitText)}</span>` : "") +
        `<ul class="raumliste-spieler-liste" hidden>${renderRaumSpielerListe(raum)}</ul>` +
      `</span>`;
    const toggle = kachel.querySelector(".raum-kachel-spieler-toggle");
    const liste = kachel.querySelector(".raumliste-spieler-liste");
    toggle.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const offen = !liste.hidden;
      liste.hidden = offen;
      toggle.setAttribute("aria-expanded", String(!offen));
    });
    kachel.addEventListener("click", () => raumKachelKlick(raum, kachel));
    kachel.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        raumKachelKlick(raum, kachel);
      }
    });
    raumlisteInhalt.appendChild(kachel);
  });
}

function raumKachelKlick(raum, kachel) {
  if (kachel.classList.contains("raum-kachel-deaktiviert")) return;
  if (raum.privat) {
    schliesseRaumlisteDialog(false);
    oeffneBeitretenDialog();
    return;
  }
  raumlisteFehler.textContent = "";
  kachel.classList.add("raum-kachel-deaktiviert");
  kachel.setAttribute("aria-disabled", "true");
  raumBeitreten(raum.code, inputName.value.trim(), {
    aufFehler: (text) => { raumlisteFehler.textContent = text; }
  }).then((erfolgreich) => {
    if (erfolgreich) schliesseRaumlisteDialog(false);
    else {
      kachel.classList.remove("raum-kachel-deaktiviert");
      kachel.removeAttribute("aria-disabled");
    }
  });
}

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
