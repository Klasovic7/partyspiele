// ============================================================================
//  Merk's dir!
// ----------------------------------------------------------------------------
//  20 Emojis erscheinen nummeriert (1-20) und müssen sich alle merken - nach
//  Ablauf der eingestellten Zeit verschwindet die Liste. Danach wird Stelle
//  für Stelle abgefragt: wer das falsche Emoji tippt (oder gar nicht
//  rechtzeitig tippt), scheidet aus. Punkte gibt es nach Rang wie bei
//  Zeitgefühl: wer zuerst ausscheidet, bekommt 0 Punkte, jeder Rang später
//  ausgeschieden (bzw. gar nicht) einen Punkt mehr; Gleichstand (mehrere
//  scheiden in derselben Runde aus) teilt sich den besseren Platz; wer als
//  Einzige(r) übrig bleibt, bekommt zusätzlich einen Extrapunkt. Alle
//  spielspezifischen Raumfelder beginnen mit "md"; die Tipp-Antworten liegen
//  getrennt in der Subcollection "mdAntworten".
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment, writeBatch
} from "../../kern/firebase.js";
import { spielerKarte, renderWarteAvatare, zeigeDebug, initBereitSystem, escapeHtml } from "../../kern/ui.js";
import { speichereWertung } from "../../kern/wertung.js";

const POSITIONEN = 20;
const STANDARD_ZEIT_SEKUNDEN = 15;
const MIN_ZEIT = 3;
const MAX_ZEIT = 60;
const STANDARD_ANZAHL = 5;
const MAX_ANZAHL = 30;
// Wie lange die Zwischen-Anzeige nach jeder Rate-Runde zu sehen ist (richtiges
// Emoji + wer neu ausgeschieden ist), bevor der Spielleiter automatisch zur
// naechsten Stelle (oder zum Durchgangs-Ergebnis) weiterschaltet.
const RUNDENERGEBNIS_ANZEIGE_MS = 3500;

// Pool aus 30 klar unterscheidbaren Emojis ...
const EMOJI_TEXTE = [
  "🍕", "🍔", "🍟", "🌭", "🍩", "🍦", "🍪", "🍇", "🍉", "🍓",
  "🥑", "🍍", "🥕", "🌽", "🍄", "🐶", "🐱", "🐵", "🦁", "🐸",
  "🐷", "🐧", "🦋", "🐢", "🐙", "🦄", "🐔", "⚽", "🏀", "🎾"
];

// ... gemischt mit selbst erstellten Freundebildern (freigestellte Fotos, als
// eigene, kleinere Kopien unter bilder/merks-dir-emojis/ abgelegt statt der
// Originale aus bilder/, damit die App offline nicht unnoetig viel cachen
// muss). Jedes Bild wird ueber seinen Dateipfad identifiziert; "label" ist
// nur die kurze, lesbare Bezeichnung fuer die Auswertungs-Anzeige ("Getippt:
// Kevin"). Wird spaeter ergaenzt, sobald weitere Bilder dazukommen (Ziel laut
// Absprache: 12 Freundebilder).
const EMOJI_BILDER = [
  { pfad: "bilder/merks-dir-emojis/kevin-rapper.png", label: "Kevin" }
];

function istBildPfad(wert) {
  return typeof wert === "string" && wert.startsWith("bilder/");
}

function labelFuer(wert) {
  if (!istBildPfad(wert)) return wert;
  return EMOJI_BILDER.find((b) => b.pfad === wert)?.label ?? wert;
}

function inhaltHtmlFuer(wert) {
  if (istBildPfad(wert)) {
    return `<img class="md-emoji-bild" src="${wert}" alt="${escapeHtml(labelFuer(wert))}" loading="lazy">`;
  }
  return `<span class="md-emoji-symbol">${escapeHtml(wert)}</span>`;
}

const EMOJI_POOL = [...EMOJI_TEXTE, ...EMOJI_BILDER.map((b) => b.pfad)];

const VORLAGE = `
  <div id="md-setup" class="bildschirm-karte" hidden>
    <h1>🧩 Merk's dir!</h1>
    <p class="hinweis-text">Merkt euch die Reihenfolge von 20 Emojis. Danach tippt ihr Stelle für Stelle
      das Emoji an, das dort war - wer daneben tippt, scheidet aus. Wer am längsten dabei bleibt, gewinnt
      und bekommt einen Extrapunkt.</p>

    <div id="md-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Durchgänge</span>
        <span class="anzahl-picker">
          <input id="md-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
      <p id="md-anzahl-max" class="hinweis-text"></p>
    </div>

    <div class="setup-anzahlblock">
      <div class="setup-anzahl-zeile">
        <span>Zeit zum Merken/Raten (Sekunden)</span>
        <span class="anzahl-picker">
          <input id="md-zeit" type="text" inputmode="numeric" pattern="[0-9]*" min="3" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <p id="md-setup-fehler" class="fehler-text"></p>
    <p><button id="md-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="md-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <div id="md-bereit-bereich" class="bereit-bereich" hidden></div>
  </div>

  <div id="md-merken-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Merk's dir!</p>
    <p class="hinweis-text" id="md-merken-hinweis">Merk dir die Reihenfolge!</p>
    <div id="md-merken-liste" class="md-emoji-liste"></div>
  </div>

  <div id="md-raten-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Merk's dir!</p>
    <h2 id="md-raten-frage"></h2>
    <p id="md-raten-hinweis" class="hinweis-text"></p>
    <div id="md-raten-gitter" class="md-emoji-gitter"></div>
    <div id="md-raten-status" class="warten-block"></div>
    <ul id="md-status-liste" class="md-status-liste"></ul>
  </div>

  <div id="md-rundenergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Merk's dir!</p>
    <h2 id="md-re-frage"></h2>
    <ul id="md-re-liste"></ul>
    <ul id="md-status-liste-re" class="md-status-liste"></ul>
  </div>

  <div id="md-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Merk's dir!</p>
    <h2>Durchgang beendet</h2>
    <ul id="md-erg-liste"></ul>
    <p><button id="md-weiter" hidden>Weiter</button></p>
  </div>

  <div id="md-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <ul id="md-endstand-liste"></ul>
    <p id="md-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
    <p><button id="md-gesamtwertung-btn" class="btn-primaer" type="button" hidden>Gesamtwertung</button></p>
  </div>
`;

let api = null;
let el = {};
let spielerListe = [];
let alleAntworten = [];
let antwortenUnsub = null;
let tickId = null;

let status = null;
let durchgangIndex = -1;
let anzahlDurchgaenge = 0;
let zeitSekunden = STANDARD_ZEIT_SEKUNDEN;
let reihenfolge = [];
let gitterReihenfolge = [];
let ausgeschieden = {}; // { [spielerId]: Stelle, an der ausgeschieden wurde } - fuer den aktuellen Durchgang
let merkenSeit = 0;
let position = 0;
let ratenSeit = 0;
let rundenergebnisSeit = 0;

let eigeneAntwortGesetzt = false;
// Diese drei Flags verhindern, dass der Spielleiter denselben automatischen
// Uebergang mehrfach ausloest (z. B. bei jedem Tick), und werden jeweils beim
// Erkennen eines NEUEN Durchgangs/einer neuen Stelle/eines neuen
// Rundenergebnisses zurueckgesetzt (siehe raumDaten()).
let merkenAusgeloest = false;
let raterundeAusgeloest = false;
let rundenergebnisAusgeloest = false;
// v205-Lehre (Zeitgefühl!): das komplette Emoji-Gitter bzw. die Rundenergebnis-
// Liste nur EINMAL pro Runde per innerHTML aufbauen, nicht bei jedem
// (haeufigeren) raumDaten()-Aufruf neu - sonst flackern Buttons/Avatare.
let gitterGerendert = false;
let rundenergebnisGerendert = false;

let bereitSystem = null;
let olympiadeAutoStart = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function mischeArray(werte) {
  const kopie = [...werte];
  for (let i = kopie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopie[i], kopie[j]] = [kopie[j], kopie[i]];
  }
  return kopie;
}

function neuerDurchgangInhalt() {
  const reihenfolgeNeu = mischeArray(EMOJI_POOL).slice(0, POSITIONEN);
  const gitterNeu = mischeArray(reihenfolgeNeu);
  return { reihenfolgeNeu, gitterNeu };
}

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;
  bereitSystem = initBereitSystem(api, "md");
  olympiadeAutoStart = false;

  verdrahteBedienelemente();
  starteListener();

  if (api.istLeiter && !api.raum?.mdStatus) {
    await updateDoc(api.raumRef(), {
      mdStatus: "setup", mdDurchgangIndex: 0, mdAnzahlDurchgaenge: 0,
      mdZeitSekunden: STANDARD_ZEIT_SEKUNDEN, mdReihenfolge: [], mdGitterReihenfolge: [],
      mdMerkenSeit: 0, mdPosition: 0, mdRatenSeit: 0, mdRundenergebnisSeit: 0, mdAusgeschieden: {}
    });
  }

  tickId = setInterval(spielTick, 200);
}

function verdrahteBedienelemente() {
  $("md-anzahl").addEventListener("input", () => {
    const feld = $("md-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("md-anzahl").addEventListener("change", () => {
    const feld = $("md-anzahl");
    let wert = parseInt(feld.value, 10);
    if (!Number.isFinite(wert) || wert < 1) wert = 1;
    if (wert > MAX_ANZAHL) wert = MAX_ANZAHL;
    feld.value = String(wert);
  });
  $("md-anzahl").addEventListener("focus", () => { $("md-anzahl").select(); });

  $("md-zeit").addEventListener("input", () => {
    const feld = $("md-zeit");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("md-zeit").addEventListener("change", () => {
    const feld = $("md-zeit");
    let wert = parseInt(feld.value, 10);
    if (!Number.isFinite(wert) || wert < MIN_ZEIT) wert = MIN_ZEIT;
    if (wert > MAX_ZEIT) wert = MAX_ZEIT;
    feld.value = String(wert);
  });
  $("md-zeit").addEventListener("focus", () => { $("md-zeit").select(); });

  $("md-starten").addEventListener("click", spielStarten);
  $("md-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "mdAntworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    if (status === "raten") aktualisiereRatenStatus();
  });
}

export function beenden() {
  bereitSystem = null;
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  if (tickId) { clearInterval(tickId); tickId = null; }
  el = {};
  spielerListe = [];
  alleAntworten = [];
  status = null;
  durchgangIndex = -1;
  anzahlDurchgaenge = 0;
  zeitSekunden = STANDARD_ZEIT_SEKUNDEN;
  reihenfolge = [];
  gitterReihenfolge = [];
  ausgeschieden = {};
  merkenSeit = 0;
  position = 0;
  ratenSeit = 0;
  rundenergebnisSeit = 0;
  eigeneAntwortGesetzt = false;
  merkenAusgeloest = false;
  raterundeAusgeloest = false;
  rundenergebnisAusgeloest = false;
  gitterGerendert = false;
  rundenergebnisGerendert = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "raten") {
    aktualisiereRatenStatus();
    renderStatusliste($("md-status-liste"));
  } else if (status === "rundenergebnis") {
    renderStatusliste($("md-status-liste-re"));
  } else if (status === "ausgewertet") {
    zeigeErgebnis();
  } else if (status === "beendet") {
    zeigeEndstand();
  }
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.mdStatus ?? null;
  anzahlDurchgaenge = daten.mdAnzahlDurchgaenge ?? 0;
  zeitSekunden = daten.mdZeitSekunden ?? STANDARD_ZEIT_SEKUNDEN;
  reihenfolge = daten.mdReihenfolge ?? [];
  gitterReihenfolge = daten.mdGitterReihenfolge ?? [];
  ausgeschieden = daten.mdAusgeschieden ?? {};

  const neuerDurchgang = daten.mdDurchgangIndex ?? 0;
  const neuerMerkenSeit = daten.mdMerkenSeit ?? 0;
  if (status === "merken" && (durchgangIndex !== neuerDurchgang || merkenSeit !== neuerMerkenSeit)) {
    merkenAusgeloest = false;
    zeigeMerken();
  }
  durchgangIndex = neuerDurchgang;
  merkenSeit = neuerMerkenSeit;

  const neuePosition = daten.mdPosition ?? 0;
  const neuerRatenSeit = daten.mdRatenSeit ?? 0;
  if (status === "raten" && (position !== neuePosition || ratenSeit !== neuerRatenSeit)) {
    position = neuePosition;
    ratenSeit = neuerRatenSeit;
    eigeneAntwortGesetzt = false;
    raterundeAusgeloest = false;
    gitterGerendert = false;
  } else {
    position = neuePosition;
  }

  const neuerRundenergebnisSeit = daten.mdRundenergebnisSeit ?? 0;
  if (status === "rundenergebnis" && rundenergebnisSeit !== neuerRundenergebnisSeit) {
    rundenergebnisAusgeloest = false;
    rundenergebnisGerendert = false;
  }
  rundenergebnisSeit = neuerRundenergebnisSeit;

  api.fortschritt(
    ["merken", "raten", "rundenergebnis", "ausgewertet"].includes(status)
      ? `${durchgangIndex + 1}/${anzahlDurchgaenge}`
      : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("md-setup").hidden = false;
  } else if (status === "merken") {
    $("md-merken-screen").hidden = false;
  } else if (status === "raten") {
    if (!gitterGerendert) {
      gitterGerendert = true;
      zeigeRaten();
    } else {
      aktualisiereRatenStatus();
      renderStatusliste($("md-status-liste"));
    }
    $("md-raten-screen").hidden = false;
  } else if (status === "rundenergebnis") {
    if (!rundenergebnisGerendert) {
      rundenergebnisGerendert = true;
      zeigeRundenergebnis();
    }
    $("md-rundenergebnis-screen").hidden = false;
  } else if (status === "ausgewertet") {
    zeigeErgebnis();
    $("md-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("md-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["md-setup", "md-merken-screen", "md-raten-screen", "md-rundenergebnis-screen",
    "md-ergebnis-screen", "md-endstand-screen"].forEach((id) => { $(id).hidden = true; });
}

function zeigeSetup() {
  const anzahlFeld = $("md-anzahl");
  anzahlFeld.max = MAX_ANZAHL;
  const inOlympiade = Boolean(api.olympiadeAnzahl);
  if (inOlympiade) {
    const festgelegt = Math.min(Math.max(1, api.olympiadeAnzahl), MAX_ANZAHL);
    anzahlFeld.value = String(festgelegt);
    $("md-anzahl-max").textContent =
      `In der Olympiade festgelegt: ${festgelegt} ${festgelegt === 1 ? "Durchgang" : "Durchgänge"}.`;
    anzahlFeld.disabled = true;
  } else {
    if (!anzahlFeld.value) anzahlFeld.value = String(STANDARD_ANZAHL);
    $("md-anzahl-max").textContent =
      `Jeder Durchgang mischt 20 neue Emojis, bis zu ${MAX_ANZAHL} Durchgänge.`;
    anzahlFeld.disabled = !api.istLeiter;
  }
  $("md-anzahl-zeile").hidden = false;

  const zeitFeld = $("md-zeit");
  if (!zeitFeld.value) zeitFeld.value = String(STANDARD_ZEIT_SEKUNDEN);
  zeitFeld.disabled = !api.istLeiter;

  $("md-starten").hidden = !api.istLeiter;
  $("md-setup-warten").hidden = api.istLeiter;
  bereitSystem?.render();

  if (api.istLeiter && api.olympiadeAnzahl && !olympiadeAutoStart && bereitSystem?.alleBereit()) {
    olympiadeAutoStart = true;
    spielStarten();
  }
}

async function spielStarten() {
  $("md-setup-fehler").textContent = "";
  if (spielerListe.length < 2) {
    $("md-setup-fehler").textContent = "Für Merk's dir! braucht ihr mindestens zwei Spieler.";
    return;
  }

  let anzahl = parseInt($("md-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > MAX_ANZAHL) anzahl = MAX_ANZAHL;

  let zeit = parseInt($("md-zeit").value, 10);
  if (!Number.isFinite(zeit) || zeit < MIN_ZEIT) zeit = MIN_ZEIT;
  if (zeit > MAX_ZEIT) zeit = MAX_ZEIT;

  const { reihenfolgeNeu, gitterNeu } = neuerDurchgangInhalt();

  $("md-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      mdStatus: "merken",
      mdDurchgangIndex: 0,
      mdAnzahlDurchgaenge: anzahl,
      mdZeitSekunden: zeit,
      mdReihenfolge: reihenfolgeNeu,
      mdGitterReihenfolge: gitterNeu,
      mdMerkenSeit: Date.now(),
      mdPosition: 0,
      mdRatenSeit: 0,
      mdRundenergebnisSeit: 0,
      mdAusgeschieden: {}
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("md-starten").disabled = false;
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "mdAntworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  alleAntworten = [];
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

export async function vorZurueck() {
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      mdStatus: null, mdDurchgangIndex: 0, mdAnzahlDurchgaenge: 0,
      mdZeitSekunden: STANDARD_ZEIT_SEKUNDEN, mdReihenfolge: [], mdGitterReihenfolge: [],
      mdMerkenSeit: 0, mdPosition: 0, mdRatenSeit: 0, mdRundenergebnisSeit: 0, mdAusgeschieden: {}
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

function zeigeMerken() {
  const liste = $("md-merken-liste");
  liste.innerHTML = "";
  reihenfolge.forEach((wert, i) => {
    const eintrag = document.createElement("div");
    eintrag.className = "md-emoji-eintrag";
    eintrag.innerHTML = `<span class="md-emoji-nr">${i + 1}.</span>${inhaltHtmlFuer(wert)}`;
    liste.appendChild(eintrag);
  });
}

function aktiveSpieler() {
  return spielerListe.filter((s) => ausgeschieden[s.id] == null);
}

function antwortenDieserPosition() {
  const aktiveIds = new Set(spielerListe.map((s) => s.id));
  return alleAntworten.filter((a) =>
    a.durchgangIndex === durchgangIndex && a.position === position && aktiveIds.has(a.spielerId)
  );
}

function renderStatusliste(container) {
  if (!container) return;
  container.innerHTML = "";
  spielerListe.forEach((s) => {
    const istAusgeschieden = ausgeschieden[s.id] != null;
    const li = document.createElement("li");
    li.className = "md-status-eintrag" + (istAusgeschieden ? " md-ausgeschieden" : "");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { punkteLinks: false });
    container.appendChild(li);
  });
}

function zeigeRaten() {
  $("md-raten-frage").textContent = `Stelle ${position}`;
  const eigeneEliminiert = ausgeschieden[api.spielerId] != null;
  const gitter = $("md-raten-gitter");
  gitter.innerHTML = "";
  gitterReihenfolge.forEach((wert) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "md-emoji-btn";
    knopf.innerHTML = inhaltHtmlFuer(wert);
    knopf.disabled = eigeneEliminiert || eigeneAntwortGesetzt;
    knopf.addEventListener("click", () => emojiGetippt(wert, knopf));
    gitter.appendChild(knopf);
  });
  aktualisiereRatenStatus();
  renderStatusliste($("md-status-liste"));
}

function aktualisiereRatenStatus() {
  if (!el.wurzel || status !== "raten") return;
  const eigeneEliminiert = ausgeschieden[api.spielerId] != null;
  const antworten = antwortenDieserPosition();
  const geantwortetIds = new Set(antworten.map((a) => a.spielerId));
  eigeneAntwortGesetzt = geantwortetIds.has(api.spielerId);
  $("md-raten-hinweis").textContent = eigeneEliminiert
    ? "Du bist in diesem Durchgang schon ausgeschieden - schau den anderen zu!"
    : eigeneAntwortGesetzt
      ? "Getippt! Warte auf die anderen …"
      : "Welches Emoji war an dieser Stelle?";
  renderWarteAvatare(
    $("md-raten-status"),
    aktiveSpieler().filter((sp) => !geantwortetIds.has(sp.id))
  );
}

async function emojiGetippt(emoji, knopf) {
  if (status !== "raten" || eigeneAntwortGesetzt || ausgeschieden[api.spielerId] != null) return;
  eigeneAntwortGesetzt = true;
  $("md-raten-gitter").querySelectorAll(".md-emoji-btn").forEach((b) => { b.disabled = true; });
  knopf.classList.add("md-eigene-wahl");
  try {
    await setDoc(doc(api.db, "raeume", api.code, "mdAntworten", `${api.spielerId}_${durchgangIndex}_${position}`), {
      spielerId: api.spielerId,
      spielerName: api.spielerName,
      durchgangIndex,
      position,
      emoji,
      zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    eigeneAntwortGesetzt = false;
    knopf.classList.remove("md-eigene-wahl");
    $("md-raten-gitter").querySelectorAll(".md-emoji-btn").forEach((b) => { b.disabled = false; });
    zeigeDebug("Fehler beim Tippen: " + e.message);
  }
}

// Wird alle 200ms aufgerufen - treibt (rein lokal anhand der geteilten
// Zeitstempel) die Countdown-Texte und, fuer den Spielleiter, die
// automatischen Uebergaenge zwischen den Phasen voran.
function spielTick() {
  if (!el.wurzel) return;
  const jetzt = Date.now();

  if (status === "merken") {
    const elapsed = jetzt - merkenSeit;
    const rest = Math.max(0, zeitSekunden * 1000 - elapsed);
    $("md-merken-hinweis").textContent = rest > 0
      ? `Merk dir die Reihenfolge! Noch ${Math.ceil(rest / 1000)}s`
      : "Zeit ist um!";
    if (api.istLeiter && !merkenAusgeloest && elapsed >= zeitSekunden * 1000) {
      merkenAusgeloest = true;
      naechstePositionStarten(1);
    }
  } else if (status === "raten") {
    const elapsed = jetzt - ratenSeit;
    const rest = Math.max(0, zeitSekunden * 1000 - elapsed);
    if (ausgeschieden[api.spielerId] == null && !eigeneAntwortGesetzt) {
      $("md-raten-hinweis").textContent = rest > 0
        ? `Noch ${Math.ceil(rest / 1000)}s, um zu tippen`
        : "Zeit ist um!";
    }
    if (api.istLeiter) pruefeRatenAuswertung(elapsed);
  } else if (status === "rundenergebnis") {
    if (api.istLeiter && !rundenergebnisAusgeloest && jetzt - rundenergebnisSeit >= RUNDENERGEBNIS_ANZEIGE_MS) {
      rundenergebnisAusgeloest = true;
      naechsterSchrittNachRundenergebnis();
    }
  }
}

async function naechstePositionStarten(neuePosition) {
  try {
    await updateDoc(api.raumRef(), {
      mdStatus: "raten",
      mdPosition: neuePosition,
      mdRatenSeit: Date.now()
    });
  } catch (e) {
    zeigeDebug("Fehler beim Rundenstart: " + e.message);
  }
}

async function pruefeRatenAuswertung(elapsed) {
  if (!api.istLeiter || status !== "raten" || raterundeAusgeloest) return;
  const aktive = aktiveSpieler();
  if (aktive.length === 0) return;
  const antworten = antwortenDieserPosition();
  const geantwortetIds = new Set(antworten.map((a) => a.spielerId));
  const fehlend = aktive.filter((sp) => !geantwortetIds.has(sp.id));
  const zeitAbgelaufen = elapsed >= zeitSekunden * 1000;
  if (fehlend.length > 0 && !zeitAbgelaufen) return;

  raterundeAusgeloest = true;
  try {
    const richtigesEmoji = reihenfolge[position - 1];
    const neueAusgeschiedene = { ...ausgeschieden };
    antworten.forEach((a) => {
      if (a.emoji !== richtigesEmoji) neueAusgeschiedene[a.spielerId] = position;
    });
    // Nicht (rechtzeitig) getippt zaehlt ebenfalls als falsch - sonst wuerde
    // eine abwesende Person die Runde nie verlassen.
    fehlend.forEach((sp) => { neueAusgeschiedene[sp.id] = position; });
    await updateDoc(api.raumRef(), {
      mdStatus: "rundenergebnis",
      mdAusgeschieden: neueAusgeschiedene,
      mdRundenergebnisSeit: Date.now()
    });
  } catch (e) {
    raterundeAusgeloest = false;
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
}

function zeigeRundenergebnis() {
  const richtigesEmoji = reihenfolge[position - 1];
  $("md-re-frage").innerHTML = `Stelle ${position} war: ${inhaltHtmlFuer(richtigesEmoji)}`;
  const antworten = [...antwortenDieserPosition()].sort((a, b) =>
    (a.spielerName || "").localeCompare(b.spielerName || "", "de")
  );
  const liste = $("md-re-liste");
  liste.innerHTML = "";
  if (antworten.length === 0) {
    const li = document.createElement("li");
    li.className = "hinweis-text";
    li.textContent = "Niemand hat rechtzeitig getippt.";
    liste.appendChild(li);
  }
  antworten.forEach((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    const richtig = antwort.emoji === richtigesEmoji;
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      antwort.spielerName, s?.farbe, s?.icon,
      richtig ? "✓" : "✗",
      { extra: `Getippt: ${labelFuer(antwort.emoji)}`, punkteRechts: s ? (s.punkte ?? 0) : "?" }
    );
    liste.appendChild(li);
  });
  renderStatusliste($("md-status-liste-re"));
}

async function naechsterSchrittNachRundenergebnis() {
  try {
    const nochAktiv = aktiveSpieler().length;
    const letztePositionErreicht = position >= POSITIONEN;
    if (nochAktiv <= 1 || letztePositionErreicht) {
      await beendeDurchgang();
    } else {
      await naechstePositionStarten(position + 1);
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
}

// Rang-Punkte wie bei Zeitgefühl: wer zuerst ausscheidet, bekommt 0 Punkte,
// jeder Rang, der laenger dabei blieb (bzw. gar nicht ausschied), einen mehr;
// Gleichstand (gleiche Ausscheiderunde) teilt sich den besseren Platz; wer am
// laengsten uebrig bleibt, bekommt zusaetzlich einen Extrapunkt.
function distanzFuer(eintrag) {
  return eintrag.ausgeschiedenInRunde == null ? -Infinity : -eintrag.ausgeschiedenInRunde;
}

function berechneSpielpunkte(eintraege) {
  const sortiert = [...eintraege].sort((a, b) => distanzFuer(a) - distanzFuer(b));
  const ergebnis = {};
  let vorherigeDistanz = null;
  let vorherigeRangpunkte = null;
  const besteDistanz = sortiert.length ? distanzFuer(sortiert[0]) : null;

  sortiert.forEach((eintrag, i) => {
    const distanz = distanzFuer(eintrag);
    const rangpunkte = (vorherigeDistanz !== null && distanz === vorherigeDistanz)
      ? vorherigeRangpunkte
      : sortiert.length - 1 - i;
    const siegerBonus = distanz === besteDistanz ? 1 : 0;
    ergebnis[eintrag.spielerId] = rangpunkte + siegerBonus;
    vorherigeDistanz = distanz;
    vorherigeRangpunkte = rangpunkte;
  });
  return ergebnis;
}

async function beendeDurchgang() {
  const eintraege = spielerListe.map((s) => ({
    spielerId: s.id,
    ausgeschiedenInRunde: ausgeschieden[s.id] ?? null
  }));
  const punkte = berechneSpielpunkte(eintraege);
  const batch = writeBatch(api.db);
  Object.entries(punkte).forEach(([id, wert]) => {
    batch.update(api.spielerRef(id), { punkte: increment(wert) });
  });
  batch.update(api.raumRef(), { mdStatus: "ausgewertet" });
  await batch.commit();
}

function formatiertePunkte(punkte) {
  return punkte > 0 ? `+${punkte}` : "0";
}

function zeigeErgebnis() {
  const eintraege = spielerListe.map((s) => ({
    spielerId: s.id,
    ausgeschiedenInRunde: ausgeschieden[s.id] ?? null
  }));
  const punkte = berechneSpielpunkte(eintraege);
  const sortiert = [...eintraege].sort((a, b) => distanzFuer(a) - distanzFuer(b));

  const liste = $("md-erg-liste");
  liste.innerHTML = "";
  sortiert.forEach((eintrag) => {
    const s = spielerListe.find((x) => x.id === eintrag.spielerId);
    if (!s) return;
    const beschreibung = eintrag.ausgeschiedenInRunde == null
      ? "Sieger!"
      : `Ausgeschieden bei Stelle ${eintrag.ausgeschiedenInRunde}`;
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      s.name, s.farbe, s.icon,
      formatiertePunkte(punkte[eintrag.spielerId] ?? 0),
      { extra: beschreibung, punkteRechts: s.punkte ?? 0 }
    );
    liste.appendChild(li);
  });

  $("md-weiter").hidden = !api.istLeiter;
  $("md-weiter").textContent =
    durchgangIndex + 1 >= anzahlDurchgaenge ? "Endstand anzeigen" : "Nächster Durchgang";
}

async function weiter() {
  $("md-weiter").disabled = true;
  try {
    const naechster = durchgangIndex + 1;
    if (naechster >= anzahlDurchgaenge) {
      await updateDoc(api.raumRef(), { mdStatus: "beendet" });
      speichereWertung(api, "merks-dir", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      const { reihenfolgeNeu, gitterNeu } = neuerDurchgangInhalt();
      await updateDoc(api.raumRef(), {
        mdStatus: "merken",
        mdDurchgangIndex: naechster,
        mdReihenfolge: reihenfolgeNeu,
        mdGitterReihenfolge: gitterNeu,
        mdMerkenSeit: Date.now(),
        mdPosition: 0,
        mdRatenSeit: 0,
        mdRundenergebnisSeit: 0,
        mdAusgeschieden: {}
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("md-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("md-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  $("md-endstand-warten").hidden = api.istLeiter;
  const mdGesamtwertungBtn = $("md-gesamtwertung-btn");
  if (mdGesamtwertungBtn) {
    mdGesamtwertungBtn.hidden = !(api.istLeiter && Boolean(api.olympiadeAnzahl));
    mdGesamtwertungBtn.onclick = () => api.zeigeGesamtwertung();
  }
}

// Für kleine lokale Tests exportiert; die Spiellogik nutzt dieselbe Funktion.
export { berechneSpielpunkte };
