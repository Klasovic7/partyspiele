// ============================================================================
//  Doppelblick!
// ----------------------------------------------------------------------------
//  Nach dem Prinzip von Symbol-Kartenspielen wie "Dobble"/"Spot it!": zwei
//  runde Karten mit je 8 Symbolen liegen nebeneinander - und zwischen JEDEM
//  Kartenpaar aus dem Deck gibt es garantiert GENAU EIN gemeinsames Symbol.
//  Wer es zuerst antippt, bekommt die meisten Punkte.
//
//  Die Karten werden nicht aus einer fragen.json geladen, sondern rein
//  rechnerisch erzeugt: 57 Symbole, 57 Karten, jede mit 8 der 57 Symbole -
//  eine sogenannte endliche projektive Ebene der Ordnung 7 (siehe
//  generiereDeck() unten). Das ist keine Trickserei, sondern eine
//  mathematische Garantie: bei dieser speziellen Konstruktion teilen sich
//  IRGENDZWEI der 57 Karten immer exakt ein Symbol - nie null, nie mehr.
//
//  Ablauf (wie bei Blitzquiz' "Schnelligkeits"-Fragen, siehe dort für die
//  ausführliche Erklärung des Grundprinzips): pro Runde bekommt jeder
//  Mitspieler EINEN Versuch, ein Symbol auf einer der beiden Karten
//  anzutippen - liegt man falsch, ist man für den Rest der Runde raus.
//  Unter allen richtigen Antworten bekommt die schnellste so viele Punkte
//  wie Mitspieler mitmachen, jede weitere einen weniger. Die Antworten
//  liegen in der Unter-Sammlung "raeume/{code}/dbantworten", damit alle live
//  sehen, wer schon dran war, ohne dass alle Geräte gleichzeitig ins
//  Raum-Dokument schreiben müssen.
//
//  Wie bei den anderen Spielen meldet sich dieses Modul über
//  starten/raumDaten/spieler/beenden zurück (siehe schaetzfragen/spiel.js).
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment
} from "../../kern/firebase.js";
import { spielerKarte, teamEndstandHtml, teamGruppeHtml, renderWarteAvatare, zeigeDebug } from "../../kern/ui.js";
import { erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";
import { speichereWertung } from "../../kern/wertung.js";

// ----------------------------------------------------------------------------
//  Deck-Erzeugung: endliche projektive Ebene der Ordnung n (hier n=7).
//  Liefert n²+n+1 Karten mit je n+1 Symbolen aus insgesamt n²+n+1 Symbolen,
//  wobei zwei beliebige Karten immer genau ein Symbol gemeinsam haben. Das
//  ist ein Standardverfahren (siehe z. B. die öffentlich dokumentierten
//  "Dobble-Generator"-Algorithmen) und wurde vor dem Einbau per Skript an
//  allen 57*56/2 Kartenpaaren gegengeprüft (siehe Commit-Beschreibung).
// ----------------------------------------------------------------------------
function generiereDeck(n) {
  const deck = [];
  deck.push(Array.from({ length: n + 1 }, (_, i) => i));
  for (let i = 0; i < n; i++) {
    const karte = [0];
    for (let j = 0; j < n; j++) karte.push(n + 1 + i * n + j);
    deck.push(karte);
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const karte = [i + 1];
      for (let k = 0; k < n; k++) karte.push(n + 1 + n * k + ((i * k + j) % n));
      deck.push(karte);
    }
  }
  return deck;
}

// 57 möglichst gut unterscheidbare Emoji als Symbole - keine Bild-Assets
// nötig, das spart einen fetch() beim Start und Einträge im Service-Worker-
// Cache (siehe sw.js).
const SYMBOLE = [
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🦁",
  "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🦉", "🐴", "🐝", "🐢",
  "🐙", "🦋", "🐟", "🦀", "🐳", "🌵", "🌴", "🍄", "🌻", "🌈",
  "⭐", "🌞", "🌙", "⚡", "❄️", "🔥", "🍎", "🍌", "🍉", "🍕",
  "🍔", "🍦", "🎂", "🍩", "🍪", "⚽", "🏀", "🎾", "🎯", "🎸",
  "🎨", "🎈", "🎁", "🚗", "🚀", "🔑", "💎"
];

const ORDNUNG = 7;
const DECK = generiereDeck(ORDNUNG); // 57 Karten, je 8 Symbole, 57 Symbole insgesamt
// Pro Runde werden zwei verschiedene Karten aus dem Deck gezogen, ohne
// Zurücklegen - so kommt innerhalb eines Spieldurchgangs keine Karte
// zweimal vor. Das begrenzt die maximale Rundenzahl auf die Hälfte des
// Decks (eine erneute Wiederholungsschutz-Logik wie bei den fragenbasierten
// Spielen - siehe kern/verlauf.js - ist hier bewusst weggelassen: bei jedem
// neuen Spieldurchgang wird ohnehin komplett neu gemischt).
const MAX_RUNDEN = Math.floor(DECK.length / 2);
const STANDARD_ANZAHL = 10;
// Sicherheitsnetz wie bei Blitzquiz: kein manueller "Runde auswerten"-Knopf,
// falls jemand gar nicht reagiert wertet der Spielleiter spätestens danach
// automatisch aus.
const FRAGE_TIMEOUT_MS = 90000;

// Acht feste "Steckplätze" (Mittelpunkt links/oben in % des quadratischen
// Kartenbereichs, dazu die Kantenlänge der Kachel in %) für die 8 Symbole
// einer Karte - ein lockerer Kranz plus ein etwas größeres Symbol in der
// Mitte, angelehnt an die Optik echter Symbol-Suchkarten. Welches Symbol in
// welchem Steckplatz landet, ist schon beim Mischen der Kartenreihenfolge
// zufällig (siehe neueRunden()) - die Plätze selbst bleiben immer gleich,
// nur so bleibt garantiert genug Abstand zum Kartenrand und zueinander.
const SLOT_POSITIONEN = [
  { links: 50, oben: 18, groesse: 18 },
  { links: 76, oben: 28, groesse: 15 },
  { links: 82, oben: 54, groesse: 17 },
  { links: 68, oben: 78, groesse: 14 },
  { links: 35, oben: 80, groesse: 16 },
  { links: 17, oben: 60, groesse: 15 },
  { links: 21, oben: 32, groesse: 15 },
  { links: 50, oben: 50, groesse: 23 }
];

const VORLAGE = `
  <div id="db-setup" class="bildschirm-karte" hidden>
    <h1>🔍 Doppelblick!</h1>
    <p class="hinweis-text">Zwei Karten, viele Symbole - aber immer genau eines
      ist auf beiden zu finden. Wer es zuerst antippt, bekommt die meisten
      Punkte. Liegt man falsch, ist man für den Rest der Runde raus.</p>

    <div id="db-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="db-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="10" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="db-teammodus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Teammodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Teammodus">i</summary>
            <div>Jeder entscheidet sich für ein Team und tippt weiterhin selbst - die Punkte bekommt bzw. verliert immer nur die einzelne Person, zusätzlich seht ihr die Summe pro Team.</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="db-teammodus">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="db-teams" hidden>
      <div class="zt-team-grid">
        <button type="button" id="db-team-wahl-blau" class="zt-team zt-team-blau zt-team-waehlbar">
          <h3>🔵 Team Blau</h3>
          <ul id="db-team-blau"></ul>
        </button>
        <button type="button" id="db-team-wahl-rot" class="zt-team zt-team-rot zt-team-waehlbar">
          <h3>🔴 Team Rot</h3>
          <ul id="db-team-rot"></ul>
        </button>
      </div>
      <p><button id="db-teams-zufall" class="btn-flach" hidden>Zufällige Teams</button></p>
    </div>

    <p id="db-setup-fehler" class="fehler-text"></p>
    <p><button id="db-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="db-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="db-frage-screen" class="bildschirm-karte" hidden>
    <p class="hinweis-text db-anleitung">Welches Symbol ist auf BEIDEN Karten zu sehen?</p>
    <div id="db-karten-bereich" class="db-karten-bereich"></div>
    <p id="db-eigenes-status" class="hinweis-text" hidden></p>
    <div id="db-frage-status" class="warten-block"></div>
  </div>

  <div id="db-ergebnis-screen" class="bildschirm-karte" hidden>
    <h2>Gesucht war …</h2>
    <div id="db-erg-karten" class="db-karten-bereich db-karten-bereich-klein"></div>
    <ul id="db-erg-liste"></ul>
    <p><button id="db-weiter" hidden>Weiter</button></p>
  </div>

  <div id="db-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="db-endstand-teams" hidden></div>
    <ul id="db-endstand-liste"></ul>
    <p id="db-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

// ---------- Modulzustand ----------
let api = null;
let el = {};
let raum = {};
let spielerListe = [];
let alleAntworten = [];
let antwortenUnsub = null;

let index = -1;
let anzahlRunden = 0;
let status = null;
let rundenKartenA = []; // Array von Kommagetrennten Symbol-Id-Zeichenketten, eine pro Runde
let rundenKartenB = [];
let rundenGemeinsam = []; // Flaches Zahlen-Array: die gesuchte Symbol-Id je Runde
let rundeSeit = 0;
let gewuenschteAnzahl = 0;
let teammodus = false;
let teams = {};
let ausgewertetAusgeloest = false;
let timerId = null;
// Wie bei Blitzquiz: die eigene Antwort wird sofort lokal gemerkt, damit ein
// zwischenzeitlicher Raum-Listener-Trigger den gerade gesetzten
// gesperrt/hervorgehoben-Zustand nicht zurücksetzt, bevor der eigene
// Firestore-Eintrag über den Listener zurückkommt.
let eigeneAntwortenLokal = {};
// Cosmetic: die kleinen Zufalls-Drehwinkel der Symbole sollen nur einmal pro
// Runde ausgewürfelt werden, nicht bei jedem Re-Render (der z. B. durch einen
// Mitspieler ausgelöst wird, der gerade tippt) - sonst würden die Symbole
// bei jeder Aktualisierung sichtbar "zappeln".
let rotationRunde = -1;
let rotationenA = [];
let rotationenB = [];

const $ = (id) => el.wurzel.querySelector("#" + id);

function kartenAn(pos, seite) {
  const text = (seite === "a" ? rundenKartenA : rundenKartenB)[pos];
  return text ? text.split(",").map(Number) : [];
}

function gemeinsamAn(pos) {
  return rundenGemeinsam[pos];
}

function mischeIndizes(werte) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

function formatiertePunkte(p) {
  return p > 0 ? `+${p}` : `${p}`;
}

function eigeneAntwort(pos) {
  return alleAntworten.find((a) => a.spielerId === api.spielerId && a.rundenIndex === pos);
}

// Bevorzugt die lokal gemerkte Antwort (siehe eigeneAntwortenLokal oben) -
// fällt auf die aus Firestore geladene zurück, sobald der Listener sie
// bestätigt hat.
function eigeneAntwortAnzeige(pos) {
  return eigeneAntwortenLokal[pos] ?? eigeneAntwort(pos);
}

function zufallsRotationen(anzahl) {
  return Array.from({ length: anzahl }, () => (Math.random() * 24 - 12).toFixed(1));
}

function zeitText(millisekunden) {
  return `${(millisekunden / 1000).toFixed(2)}s`;
}

// ============================================================================
//  Start
// ============================================================================
export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  verdrahteBedienelemente();
  starteListener();

  if (api.istLeiter && !api.raum?.dbStatus) {
    await setzeGrundzustand("setup");
  }

  timerId = setInterval(() => { pruefeZeitlimit(); }, 300);
}

function verdrahteBedienelemente() {
  $("db-anzahl").addEventListener("input", () => {
    const feld = $("db-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("db-anzahl").addEventListener("change", () => anzahlUebernehmen());
  $("db-anzahl").addEventListener("focus", () => { $("db-anzahl").select(); });
  $("db-teammodus").addEventListener("change", teammodusUmschalten);
  $("db-team-wahl-blau").addEventListener("click", () => waehleEigenesTeam("blau"));
  $("db-team-wahl-rot").addEventListener("click", () => waehleEigenesTeam("rot"));
  $("db-teams-zufall").addEventListener("click", zufaelligeTeams);
  $("db-starten").addEventListener("click", spielStarten);
  $("db-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "dbantworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereAntworten();
  });
}

export function beenden() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  el = {}; raum = {}; spielerListe = []; alleAntworten = [];
  index = -1; anzahlRunden = 0; status = null;
  rundenKartenA = []; rundenKartenB = []; rundenGemeinsam = []; rundeSeit = 0;
  gewuenschteAnzahl = 0; teammodus = false; teams = {};
  ausgewertetAusgeloest = false; eigeneAntwortenLokal = {};
  rotationRunde = -1; rotationenA = []; rotationenB = [];
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "setup" || !status) zeigeSetup();
  else if (status === "frage_aktiv") zeigeFrage();
  else if (status === "ausgewertet") zeigeErgebnis();
  else if (status === "beendet") zeigeEndstand();
  aktualisiereAntworten();
}

// ============================================================================
//  Reaktion auf das Raum-Dokument
// ============================================================================
export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  raum = daten;
  status = daten.dbStatus ?? null;
  anzahlRunden = daten.dbAnzahlRunden ?? 0;
  rundenKartenA = daten.dbKartenA ?? [];
  rundenKartenB = daten.dbKartenB ?? [];
  rundenGemeinsam = daten.dbGemeinsam ?? [];
  rundeSeit = daten.dbRundeSeit ?? 0;
  teammodus = !!daten.dbTeammodus;
  teams = daten.dbTeams ?? {};

  if ($("db-teammodus").checked !== teammodus) $("db-teammodus").checked = teammodus;

  const neuerIndex = daten.dbRundenIndex ?? 0;
  if (status === "frage_aktiv" && index !== neuerIndex) {
    index = neuerIndex;
    ausgewertetAusgeloest = false;
    eigeneAntwortenLokal = {};
  } else if (status === "ausgewertet") {
    index = neuerIndex;
  }

  api.fortschritt(
    status === "frage_aktiv" || status === "ausgewertet" ? `${index + 1}/${anzahlRunden}` : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("db-setup").hidden = false;
  } else if (status === "frage_aktiv") {
    zeigeFrage();
    $("db-frage-screen").hidden = false;
  } else if (status === "ausgewertet") {
    zeigeErgebnis();
    $("db-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("db-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["db-setup", "db-frage-screen", "db-ergebnis-screen", "db-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup
// ============================================================================
function zeigeSetup() {
  if (gewuenschteAnzahl === 0) gewuenschteAnzahl = Math.min(STANDARD_ANZAHL, MAX_RUNDEN);
  $("db-anzahl").max = String(MAX_RUNDEN);
  $("db-anzahl").value = String(gewuenschteAnzahl);
  $("db-anzahl-zeile").hidden = false;
  $("db-anzahl").disabled = !api.istLeiter;
  $("db-teammodus-zeile").hidden = false;
  const teamSchalter = $("db-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("db-teams").hidden = !teammodus;
  $("db-teams-zufall").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("db-starten").hidden = !api.istLeiter;
  $("db-setup-warten").hidden = api.istLeiter;
}

async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("db-teammodus").checked;
  const neueTeams = aktiviert ? teams : {};
  try {
    await updateDoc(api.raumRef(), { dbTeammodus: aktiviert, dbTeams: neueTeams });
  } catch (e) {
    $("db-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function waehleEigenesTeam(team) {
  if (!teammodus) return;
  try {
    await updateDoc(api.raumRef(), { dbTeams: { ...teams, [api.spielerId]: team } });
  } catch (e) {
    zeigeDebug("Team konnte nicht gewählt werden: " + e.message);
  }
}

async function zufaelligeTeams() {
  if (!api.istLeiter || !teammodus) return;
  $("db-teams-zufall").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      dbTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("db-teams-zufall").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("db-team-" + team);
  liste.innerHTML = "";
  spielerListe.filter((spieler) => teams[spieler.id] === team).forEach((spieler) => {
    const li = document.createElement("li");
    li.textContent = spieler.name + (spieler.id === api.spielerId ? " (du)" : "");
    liste.appendChild(li);
  });
  if (!liste.children.length) {
    const li = document.createElement("li");
    li.textContent = "Noch niemand";
    liste.appendChild(li);
  }
  $("db-team-wahl-" + team).classList.toggle("zt-team-eigenes", teams[api.spielerId] === team);
}

function anzahlUebernehmen() {
  if (!api.istLeiter) return;
  let wert = parseInt($("db-anzahl").value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > MAX_RUNDEN) wert = MAX_RUNDEN;
  gewuenschteAnzahl = wert;
  $("db-anzahl").value = String(wert);
}

async function setzeGrundzustand(dbStatus) {
  await updateDoc(api.raumRef(), {
    dbStatus, dbRundenIndex: 0, dbAnzahlRunden: 0,
    dbKartenA: [], dbKartenB: [], dbGemeinsam: [], dbRundeSeit: 0,
    dbTeammodus: false, dbTeams: {}
  });
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "dbantworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

// Zieht "anzahl" Kartenpaare ohne Zurücklegen aus dem Deck (siehe MAX_RUNDEN
// oben) und mischt für jede der beiden Karten zusätzlich die Reihenfolge
// ihrer eigenen Symbole - sonst stünde das gesuchte Symbol bei beiden Karten
// zufällig an derselben Stelle, was das Suchen zu leicht machen würde.
function neueRunden(anzahl) {
  const kartenReihenfolge = mischeIndizes(DECK.map((_, i) => i)).slice(0, anzahl * 2);
  const kartenA = [];
  const kartenB = [];
  const gemeinsam = [];
  for (let i = 0; i < anzahl; i++) {
    const karteA = DECK[kartenReihenfolge[i * 2]];
    const karteB = DECK[kartenReihenfolge[i * 2 + 1]];
    const gemeinsames = karteA.find((symbolId) => karteB.includes(symbolId));
    kartenA.push(mischeIndizes(karteA).join(","));
    kartenB.push(mischeIndizes(karteB).join(","));
    gemeinsam.push(gemeinsames);
  }
  return { kartenA, kartenB, gemeinsam };
}

async function spielStarten() {
  $("db-setup-fehler").textContent = "";
  anzahlUebernehmen();
  $("db-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahl = Math.min(gewuenschteAnzahl || STANDARD_ANZAHL, MAX_RUNDEN);
    const { kartenA, kartenB, gemeinsam } = neueRunden(anzahl);
    const neueTeams = teammodus
      ? ergaenzeFehlendeTeams(teams, spielerListe.map((spieler) => spieler.id))
      : teams;
    await updateDoc(api.raumRef(), {
      dbStatus: "frage_aktiv", dbRundenIndex: 0, dbAnzahlRunden: anzahl,
      dbKartenA: kartenA, dbKartenB: kartenB, dbGemeinsam: gemeinsam,
      dbRundeSeit: Date.now(), dbTeammodus: teammodus, dbTeams: neueTeams
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("db-starten").disabled = false;
}

export async function vorZurueck() {
  await raeumeSpieldatenAuf();
  await setzeGrundzustand("setup");
  await api.zurueckZurAuswahl();
}

// ============================================================================
//  Runde: Karten, Antwort
// ============================================================================
function zeigeFrage() {
  const eigene = eigeneAntwortAnzeige(index);
  rendereKarten($("db-karten-bereich"), kartenAn(index, "a"), kartenAn(index, "b"), eigene, true);
  $("db-eigenes-status").hidden = !eigene;
  if (eigene) {
    $("db-eigenes-status").textContent = eigene.richtig
      ? "✅ Du hast das gemeinsame Symbol gefunden - warte auf die anderen."
      : "❌ Leider falsch - du bist für diese Runde raus. Warte auf die anderen.";
  }
  aktualisiereAntworten();
}

// container   - Ziel-Element, wird komplett neu befüllt
// symboleA/B  - Arrays von Symbol-Ids (schon in Anzeige-Reihenfolge)
// eigene      - die eigene (ggf. lokal gemerkte) Antwort dieser Runde, falls
//               vorhanden - sperrt dann beide Karten und hebt die eigene Wahl
//               farbig hervor
// interaktiv  - true im Frage-Screen (antippbar), false im Ergebnis-Screen
//               (dort ist ohnehin niemand mehr dran, stattdessen wird das
//               richtige Symbol auf beiden Karten golden hervorgehoben)
function rendereKarten(container, symboleA, symboleB, eigene, interaktiv) {
  if (rotationRunde !== index) {
    rotationRunde = index;
    rotationenA = zufallsRotationen(symboleA.length);
    rotationenB = zufallsRotationen(symboleB.length);
  }
  const gemeinsam = gemeinsamAn(index);
  const gesperrt = !interaktiv || !!eigene;

  const karteHtml = (symbole, rotationen, klasse) => {
    const kacheln = symbole.map((symbolId, i) => {
      let extraKlasse = "";
      if (!interaktiv && symbolId === gemeinsam) extraKlasse = " db-symbol-richtig";
      else if (eigene && symbolId === eigene.symbolId) {
        extraKlasse = eigene.richtig ? " db-symbol-richtig" : " db-symbol-falsch";
      }
      const rotation = rotationen[i] ?? 0;
      const platz = SLOT_POSITIONEN[i % SLOT_POSITIONEN.length];
      const tag = interaktiv ? "button" : "div";
      const typAttr = interaktiv ? ' type="button"' : "";
      const disabledAttr = interaktiv && gesperrt ? " disabled" : "";
      const stil = `left:${platz.links}%;top:${platz.oben}%;width:${platz.groesse}%;height:${platz.groesse}%;transform:translate(-50%,-50%) rotate(${rotation}deg);`;
      return `<${tag}${typAttr} class="db-symbol${extraKlasse}" style="${stil}"${disabledAttr} data-symbol="${symbolId}">${SYMBOLE[symbolId] ?? "❔"}</${tag}>`;
    }).join("");
    return `<div class="db-karte ${klasse}">${kacheln}</div>`;
  };

  container.innerHTML = karteHtml(symboleA, rotationenA, "db-karte-a") + karteHtml(symboleB, rotationenB, "db-karte-b");

  if (interaktiv) {
    container.querySelectorAll(".db-symbol").forEach((el) => {
      el.addEventListener("click", () => antworteSymbol(Number(el.dataset.symbol)));
    });
  }
}

async function antworteSymbol(symbolId) {
  if (status !== "frage_aktiv" || eigeneAntwortAnzeige(index)) return;
  const gemeinsam = gemeinsamAn(index);
  if (gemeinsam === undefined) return;
  const millisekunden = Date.now() - rundeSeit;
  const eintrag = {
    spielerId: api.spielerId, spielerName: api.spielerName, rundenIndex: index,
    symbolId, millisekunden, richtig: symbolId === gemeinsam
  };
  eigeneAntwortenLokal[index] = eintrag;
  zeigeFrage();
  try {
    await setDoc(doc(api.db, "raeume", api.code, "dbantworten", `${api.spielerId}_${index}`), {
      ...eintrag, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    delete eigeneAntwortenLokal[index];
    zeigeFrage();
    zeigeDebug("Fehler beim Absenden der Antwort: " + e.message);
  }
}

async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const dieserRunde = alleAntworten.filter((a) => a.rundenIndex === index);
  if (status === "frage_aktiv") {
    const beantwortetIds = new Set(dieserRunde.map((a) => a.spielerId));
    renderWarteAvatare($("db-frage-status"), spielerListe.filter((sp) => !beantwortetIds.has(sp.id)));

    if (api.istLeiter && !ausgewertetAusgeloest &&
        spielerListe.length > 0 && dieserRunde.length >= spielerListe.length) {
      await loeseRundeAuf();
    }
  } else if (status === "ausgewertet") {
    zeigeErgebnisListe(index);
  }
}

async function pruefeZeitlimit() {
  if (!api?.istLeiter || status !== "frage_aktiv" || ausgewertetAusgeloest) return;
  if (Date.now() - rundeSeit >= FRAGE_TIMEOUT_MS) await loeseRundeAuf();
}

// ============================================================================
//  Auswertung
// ============================================================================
// Unter allen richtigen Antworten bekommt die schnellste so viele Punkte wie
// Mitspieler mitmachen, jede weitere einen weniger - identisch zu Blitzquiz'
// "Schnelligkeits"-Fragen.
function berechneRundenpunkte(pos) {
  const antworten = alleAntworten.filter((a) => a.rundenIndex === pos);
  const ergebnis = {};
  const richtige = antworten.filter((a) => a.richtig);
  const sortiert = [...richtige].sort((a, b) => (a.millisekunden ?? 0) - (b.millisekunden ?? 0));
  const n = spielerListe.length;
  sortiert.forEach((a, i) => {
    const punkte = n - i;
    if (punkte > 0) ergebnis[a.spielerId] = punkte;
  });
  return ergebnis;
}

async function loeseRundeAuf() {
  if (ausgewertetAusgeloest) return;
  ausgewertetAusgeloest = true;
  try {
    const punkte = berechneRundenpunkte(index);
    for (const [id, wert] of Object.entries(punkte)) {
      if (wert) await updateDoc(api.spielerRef(id), { punkte: increment(wert) });
    }
    await updateDoc(api.raumRef(), { dbStatus: "ausgewertet" });
  } catch (e) {
    ausgewertetAusgeloest = false;
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
}

function zeigeErgebnisListe(pos) {
  if (!el.wurzel) return;
  const rundenpunkte = berechneRundenpunkte(pos);
  const dieserRunde = alleAntworten.filter((a) => a.rundenIndex === pos);

  const kartenFuerSpieler = (s) => {
    const antwort = dieserRunde.find((a) => a.spielerId === s.id);
    const extra = !antwort ? "nicht getippt" : (antwort.richtig ? zeitText(antwort.millisekunden) : "falsch");
    return spielerKarte(
      s.name, s.farbe, s.icon,
      formatiertePunkte(rundenpunkte[s.id] ?? 0),
      { extra, punkteRechts: s.punkte ?? 0 }
    );
  };

  const liste = $("db-erg-liste");
  if (teammodus) {
    liste.innerHTML = teamGruppeHtml(spielerListe, teams, kartenFuerSpieler);
  } else {
    const sortiert = [...spielerListe].sort(
      (a, b) => (rundenpunkte[b.id] ?? 0) - (rundenpunkte[a.id] ?? 0)
    );
    liste.innerHTML = "";
    sortiert.forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = kartenFuerSpieler(s);
      liste.appendChild(li);
    });
  }
}

function zeigeErgebnis() {
  rendereKarten($("db-erg-karten"), kartenAn(index, "a"), kartenAn(index, "b"), null, false);
  zeigeErgebnisListe(index);
  $("db-weiter").hidden = !api.istLeiter;
  $("db-weiter").textContent = index + 1 >= anzahlRunden ? "Endstand anzeigen" : "Nächste Runde";
}

async function weiter() {
  $("db-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlRunden) {
      await updateDoc(api.raumRef(), { dbStatus: "beendet" });
      speichereWertung(api, "doppelblick", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), {
        dbStatus: "frage_aktiv", dbRundenIndex: naechster, dbRundeSeit: Date.now()
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("db-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("db-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  const teamsEl = $("db-endstand-teams");
  teamsEl.hidden = !teammodus;
  if (teammodus) teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("db-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { generiereDeck, mischeIndizes };
