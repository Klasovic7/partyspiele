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
  serverTimestamp, increment, runTransaction
} from "../../kern/firebase.js";
import { spielerKarte, teamEndstandHtml, teamGruppeHtml, renderWarteAvatare, avatarHtml, zeigeDebug } from "../../kern/ui.js";
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
// Kartenbereichs, dazu eine GRUND-Kantenlänge der Kachel in %) für die 8
// Symbole einer Karte - ein lockerer Kranz plus ein Platz in der Mitte,
// angelehnt an die Optik echter Symbol-Suchkarten. Welches Symbol in
// welchem Steckplatz landet, ist schon beim Mischen der Kartenreihenfolge
// zufällig (siehe neueRunden()) - die Plätze selbst bleiben immer gleich,
// nur so bleibt garantiert genug Abstand zum Kartenrand und zueinander,
// auch wenn die tatsächliche Größe (siehe ZUFALLSGROESSE_BEREICH unten)
// pro Symbol nochmal zufällig nach oben abweicht.
const SLOT_POSITIONEN = [
  { links: 50, oben: 18, groesse: 10 },
  { links: 76, oben: 28, groesse: 8 },
  { links: 82, oben: 54, groesse: 9 },
  { links: 68, oben: 78, groesse: 7 },
  { links: 35, oben: 80, groesse: 8 },
  { links: 17, oben: 60, groesse: 8 },
  { links: 21, oben: 32, groesse: 8 },
  { links: 50, oben: 50, groesse: 12 }
];
// v178: wie beim echten Vorbild ist dasselbe Symbol auf den beiden Karten
// unterschiedlich groß und unterschiedlich gedreht (auch mal auf dem Kopf) -
// jeder Steckplatz-Auftritt bekommt unabhängig einen eigenen Zufallsfaktor
// zwischen 1.3 und 2.0 auf seine Grundgröße oben. Die Grundgrößen selbst
// wurden gegenüber v176 nochmal nach unten angepasst, damit auch das
// größte mögliche Symbol (Faktor 2.0) noch sicher innerhalb der Karte
// bleibt und sich Symbole im ungünstigsten Fall nicht überlappen (per
// Skript gegengerechnet).
const ZUFALLSGROESSE_BEREICH = [1.3, 2.0];

const VORLAGE = `
  <div id="db-setup" class="bildschirm-karte" hidden>
    <p class="hinweis-text">Zwei Karten, viele Symbole - aber immer genau eines
      ist auf beiden zu finden. Sei der schnellste!</p>

    <div id="db-modus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile db-modus-zeile-kopf">
        <span class="modus-text-zeile">
          <span class="schalter-text">Spielmodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zu den Modi">i</summary>
            <div>Schnelligkeit: alle sehen dieselben zwei Karten und tippen um die Wette. Turm: jede*r hat einen eigenen Kartenstapel und muss ihn als Erstes loswerden.</div>
          </details>
        </span>
      </div>
      <div class="db-modus-wahl">
        <button type="button" id="db-modus-schnelligkeit" class="db-modus-btn">⚡ Schnelligkeit</button>
        <button type="button" id="db-modus-turm" class="db-modus-btn">🗼 Turm</button>
      </div>
    </div>

    <div id="db-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="db-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="10" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="db-kpsp-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Karten pro Spieler</span>
        <span class="anzahl-picker">
          <input id="db-kpsp" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="5" class="anzahl-eingabe">
        </span>
      </div>
      <p class="hinweis-text db-turm-hinweis">Jede*r bekommt so viele Karten als verdeckten Stapel. Wer seinen Stapel zuerst los ist, gewinnt.</p>
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
    <div id="db-karten-bereich" class="db-karten-bereich"></div>
    <p id="db-eigenes-status" class="hinweis-text" hidden></p>
    <div id="db-frage-status" class="warten-block"></div>
  </div>

  <div id="db-turm-screen" class="bildschirm-karte" hidden>
    <div class="db-turm-bereich">
      <div class="db-turm-spalte">
        <p class="db-turm-label">Mitte</p>
        <div id="db-turm-mitte" class="db-karten-bereich"></div>
      </div>
      <div class="db-turm-spalte">
        <p class="db-turm-label">Deine Karte</p>
        <div id="db-turm-eigene" class="db-karten-bereich"></div>
      </div>
    </div>
    <p id="db-turm-status" class="hinweis-text" hidden></p>
    <div id="db-turm-staende" class="db-turm-staende"></div>
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
let groessenA = [];
let groessenB = [];

// ---------- Turm-Modus: eigener Zustand ----------
// Anders als beim Schnelligkeits-Modus hat hier jede*r einen eigenen,
// privaten Kartenstapel (dtStapel[spielerId], oberste Karte = erster
// Eintrag) und alle teilen sich EINE "Mitte"-Karte (dtMitte). Wer zuerst das
// Symbol findet, das auf der eigenen obersten Karte UND der Mitte-Karte
// vorkommt, legt seine Karte als neue Mitte ab - das ist per Firestore-
// Transaktion abgesichert, damit bei einem Beinahe-Gleichstand nur eine
// Person tatsächlich gewinnt (siehe tippeSymbolTurm()).
let spielModus = "schnelligkeit"; // "schnelligkeit" | "turm"
let gewuenschteKartenProSpieler = 0;
let dtMitte = null; // DECK-Index der aktuellen Mitte-Karte
let dtStapel = {}; // spielerId -> Kommagetrennte DECK-Indizes, oberste zuerst
let dtKartenProSpieler = 0;
let dtSiegerId = null;
let turmGesperrtBis = 0; // Date.now()-Zeitstempel: bis dahin nach Falsch-Tipp lokal gesperrt
let turmLetzteMeldung = null; // "falsch" während der kurzen Sperre nach einem Falsch-Tipp, sonst null
let turmSperreTimer = null;
let turmRotationSchluessel = null;
let turmSymboleEigene = []; // v189: gemischte Symbol-Reihenfolge der eigenen Karte (siehe zeigeTurm())
let turmSymboleMitte = []; // v189: gemischte Symbol-Reihenfolge der Mitte-Karte
let turmRotationenEigene = [];
let turmGroessenEigene = [];
let turmRotationenMitte = [];
let turmGroessenMitte = [];
let turmWertungGespeichert = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function eigenerStapel() {
  const text = dtStapel?.[api.spielerId];
  return text ? text.split(",").map(Number) : [];
}

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

// Voller Drehwinkelbereich (-180..180 Grad) - anders als beim vorherigen,
// nur leicht schiefen ±12°-Bereich kann ein Symbol jetzt auch quer oder
// komplett auf dem Kopf stehen, wie bei den echten Karten.
function zufallsRotationen(anzahl) {
  return Array.from({ length: anzahl }, () => (Math.random() * 360 - 180).toFixed(1));
}

function zufallsGroessen(anzahl) {
  const [min, max] = ZUFALLSGROESSE_BEREICH;
  return Array.from({ length: anzahl }, () => (min + Math.random() * (max - min)).toFixed(2));
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
  $("db-kpsp").addEventListener("input", () => {
    const feld = $("db-kpsp");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("db-kpsp").addEventListener("change", () => kartenProSpielerUebernehmen());
  $("db-kpsp").addEventListener("focus", () => { $("db-kpsp").select(); });
  $("db-modus-schnelligkeit").addEventListener("click", () => modusUmschalten("schnelligkeit"));
  $("db-modus-turm").addEventListener("click", () => modusUmschalten("turm"));
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
  if (turmSperreTimer) { clearTimeout(turmSperreTimer); turmSperreTimer = null; }
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  el = {}; raum = {}; spielerListe = []; alleAntworten = [];
  index = -1; anzahlRunden = 0; status = null;
  rundenKartenA = []; rundenKartenB = []; rundenGemeinsam = []; rundeSeit = 0;
  gewuenschteAnzahl = 0; teammodus = false; teams = {};
  ausgewertetAusgeloest = false; eigeneAntwortenLokal = {};
  rotationRunde = -1; rotationenA = []; rotationenB = []; groessenA = []; groessenB = [];
  spielModus = "schnelligkeit"; gewuenschteKartenProSpieler = 0;
  dtMitte = null; dtStapel = {}; dtKartenProSpieler = 0; dtSiegerId = null;
  turmGesperrtBis = 0; turmLetzteMeldung = null; turmRotationSchluessel = null;
  turmRotationenEigene = []; turmGroessenEigene = []; turmRotationenMitte = []; turmGroessenMitte = [];
  turmWertungGespeichert = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "setup" || !status) zeigeSetup();
  else if (status === "frage_aktiv" && spielModus === "turm") zeigeTurm();
  else if (status === "frage_aktiv") zeigeFrage();
  else if (status === "ausgewertet") zeigeErgebnis();
  else if (status === "beendet") zeigeEndstand();
  if (spielModus !== "turm") aktualisiereAntworten();
}

// ============================================================================
//  Reaktion auf das Raum-Dokument
// ============================================================================
export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  raum = daten;
  status = daten.dbStatus ?? null;
  spielModus = daten.dbModus === "turm" ? "turm" : "schnelligkeit";
  anzahlRunden = daten.dbAnzahlRunden ?? 0;
  rundenKartenA = daten.dbKartenA ?? [];
  rundenKartenB = daten.dbKartenB ?? [];
  rundenGemeinsam = daten.dbGemeinsam ?? [];
  rundeSeit = daten.dbRundeSeit ?? 0;
  teammodus = !!daten.dbTeammodus;
  teams = daten.dbTeams ?? {};
  dtMitte = daten.dtMitte ?? null;
  dtStapel = daten.dtStapel ?? {};
  dtKartenProSpieler = daten.dtKartenProSpieler ?? 0;
  dtSiegerId = daten.dtSiegerId ?? null;

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
    spielModus !== "turm" && (status === "frage_aktiv" || status === "ausgewertet")
      ? `${index + 1}/${anzahlRunden}` : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("db-setup").hidden = false;
  } else if (status === "frage_aktiv" && spielModus === "turm") {
    zeigeTurm();
    $("db-turm-screen").hidden = false;
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
  ["db-setup", "db-frage-screen", "db-turm-screen", "db-ergebnis-screen", "db-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup
// ============================================================================
function maxKartenProSpieler() {
  const anzahlSpieler = Math.max(spielerListe.length, 1);
  // +1, weil zu Beginn zusätzlich noch eine Karte als erste Mitte-Karte
  // gezogen wird (siehe spielStartenTurm()).
  return Math.max(1, Math.floor((DECK.length - 1) / anzahlSpieler));
}

function zeigeSetup() {
  $("db-modus-zeile").hidden = false;
  $("db-modus-schnelligkeit").classList.toggle("db-modus-aktiv", spielModus === "schnelligkeit");
  $("db-modus-turm").classList.toggle("db-modus-aktiv", spielModus === "turm");
  $("db-modus-schnelligkeit").disabled = !api.istLeiter;
  $("db-modus-turm").disabled = !api.istLeiter;

  const istTurm = spielModus === "turm";

  if (gewuenschteAnzahl === 0) gewuenschteAnzahl = Math.min(STANDARD_ANZAHL, MAX_RUNDEN);
  $("db-anzahl").max = String(MAX_RUNDEN);
  $("db-anzahl").value = String(gewuenschteAnzahl);
  $("db-anzahl-zeile").hidden = istTurm;
  $("db-anzahl").disabled = !api.istLeiter;

  const maxKpsp = maxKartenProSpieler();
  if (gewuenschteKartenProSpieler === 0) gewuenschteKartenProSpieler = Math.min(5, maxKpsp);
  if (gewuenschteKartenProSpieler > maxKpsp) gewuenschteKartenProSpieler = maxKpsp;
  $("db-kpsp").max = String(maxKpsp);
  $("db-kpsp").value = String(gewuenschteKartenProSpieler);
  $("db-kpsp-zeile").hidden = !istTurm;
  $("db-kpsp").disabled = !api.istLeiter;

  $("db-teammodus-zeile").hidden = istTurm;
  const teamSchalter = $("db-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("db-teams").hidden = istTurm || !teammodus;
  $("db-teams-zufall").hidden = !api.istLeiter;
  if (!istTurm && teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("db-setup-fehler").textContent = istTurm && spielerListe.length < 2
    ? "Für den Turm-Modus werden mindestens 2 Mitspieler*innen benötigt."
    : "";
  $("db-starten").hidden = !api.istLeiter;
  $("db-starten").disabled = istTurm && spielerListe.length < 2;
  $("db-setup-warten").hidden = api.istLeiter;
}

async function modusUmschalten(neuerModus) {
  if (!api.istLeiter || neuerModus === spielModus) return;
  try {
    await updateDoc(api.raumRef(), { dbModus: neuerModus });
  } catch (e) {
    zeigeDebug("Modus konnte nicht geändert werden: " + e.message);
  }
}

function kartenProSpielerUebernehmen() {
  if (!api.istLeiter) return;
  const maxKpsp = maxKartenProSpieler();
  let wert = parseInt($("db-kpsp").value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > maxKpsp) wert = maxKpsp;
  gewuenschteKartenProSpieler = wert;
  $("db-kpsp").value = String(wert);
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
    dbStatus, dbModus: spielModus, dbRundenIndex: 0, dbAnzahlRunden: 0,
    dbKartenA: [], dbKartenB: [], dbGemeinsam: [], dbRundeSeit: 0,
    dbTeammodus: false, dbTeams: {},
    dtMitte: null, dtStapel: {}, dtKartenProSpieler: 0, dtSiegerId: null
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
  if (spielModus === "turm") await spielStartenTurm();
  else await spielStartenSchnelligkeit();
}

async function spielStartenSchnelligkeit() {
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
      dbStatus: "frage_aktiv", dbModus: "schnelligkeit", dbRundenIndex: 0, dbAnzahlRunden: anzahl,
      dbKartenA: kartenA, dbKartenB: kartenB, dbGemeinsam: gemeinsam,
      dbRundeSeit: Date.now(), dbTeammodus: teammodus, dbTeams: neueTeams
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("db-starten").disabled = false;
}

// Turm-Modus: jede*r bekommt "gewuenschteKartenProSpieler" Karten als
// eigenen, verdeckten Stapel (oberste zuerst) - dazu wird eine weitere Karte
// als erste "Mitte"-Karte gezogen. Alle Karten stammen aus demselben Deck
// ohne Zurücklegen, damit jede Karte im Spiel höchstens einmal vorkommt und
// die projektive-Ebene-Garantie (irgendzwei Karten teilen genau ein Symbol)
// weiterhin für JEDES Paar aus (eigene oberste Karte, Mitte-Karte) gilt.
async function spielStartenTurm() {
  $("db-setup-fehler").textContent = "";
  kartenProSpielerUebernehmen();
  if (spielerListe.length < 2) {
    $("db-setup-fehler").textContent = "Für den Turm-Modus werden mindestens 2 Mitspieler*innen benötigt.";
    return;
  }
  $("db-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahlKarten = Math.min(gewuenschteKartenProSpieler || 1, maxKartenProSpieler());
    const reihenfolge = mischeIndizes(DECK.map((_, i) => i));
    let cursor = 0;
    const mitteIdx = reihenfolge[cursor++];
    const neuerDtStapel = {};
    spielerListe.forEach((spieler) => {
      neuerDtStapel[spieler.id] = reihenfolge.slice(cursor, cursor + anzahlKarten).join(",");
      cursor += anzahlKarten;
    });
    await updateDoc(api.raumRef(), {
      dbStatus: "frage_aktiv", dbModus: "turm", dbRundeSeit: Date.now(),
      dtMitte: mitteIdx, dtStapel: neuerDtStapel, dtKartenProSpieler: anzahlKarten, dtSiegerId: null
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
// Baut die Kachel-HTML für EIN Symbol an Steckplatz "i" - gemeinsam genutzt
// von rendereKarten() (Kartenpaar im Schnelligkeits-Modus) und
// rendereEinzelKarte() (einzelne Karte im Turm-Modus), damit Größen-/
// Drehwinkel-Logik und Geometrie nur an einer Stelle gepflegt werden müssen.
function kachelHtml(symbolId, i, rotation, groessenFaktor, extraKlasse, interaktiv, gesperrt) {
  const platz = SLOT_POSITIONEN[i % SLOT_POSITIONEN.length];
  const faktor = Number(groessenFaktor ?? 1);
  const groesse = (platz.groesse * faktor).toFixed(2);
  const tag = interaktiv ? "button" : "div";
  const typAttr = interaktiv ? ' type="button"' : "";
  const disabledAttr = interaktiv && gesperrt ? " disabled" : "";
  // font-size in "cqw" (% der eigenen Kartenbreite, siehe .db-karte
  // { container-type: inline-size } in stil.css) statt fester px/vw-Werte -
  // so wächst/schrumpft das Emoji-Zeichen selbst exakt mit der ebenfalls
  // in % gesetzten Kachelgröße mit, statt nur die (unsichtbare) Fläche
  // drumherum zu ändern.
  const stil = `left:${platz.links}%;top:${platz.oben}%;width:${groesse}%;height:${groesse}%;` +
    `transform:translate(-50%,-50%) rotate(${rotation ?? 0}deg);font-size:${(groesse * 0.82).toFixed(2)}cqw;`;
  return `<${tag}${typAttr} class="db-symbol${extraKlasse || ""}" style="${stil}"${disabledAttr} data-symbol="${symbolId}">${SYMBOLE[symbolId] ?? "❔"}</${tag}>`;
}

function rendereKarten(container, symboleA, symboleB, eigene, interaktiv) {
  if (rotationRunde !== index) {
    rotationRunde = index;
    rotationenA = zufallsRotationen(symboleA.length);
    rotationenB = zufallsRotationen(symboleB.length);
    // Unabhängig von der Karte A/B nochmal eigene Zufallsgrößen je Steckplatz -
    // dasselbe Symbol kann dadurch auf der einen Karte größer sein als auf
    // der anderen (siehe ZUFALLSGROESSE_BEREICH oben).
    groessenA = zufallsGroessen(symboleA.length);
    groessenB = zufallsGroessen(symboleB.length);
  }
  const gemeinsam = gemeinsamAn(index);
  const gesperrt = !interaktiv || !!eigene;

  const karteHtml = (symbole, rotationen, groessenFaktoren, klasse) => {
    const kacheln = symbole.map((symbolId, i) => {
      let extraKlasse = "";
      if (!interaktiv && symbolId === gemeinsam) extraKlasse = " db-symbol-richtig";
      else if (eigene && symbolId === eigene.symbolId) {
        extraKlasse = eigene.richtig ? " db-symbol-richtig" : " db-symbol-falsch";
      }
      return kachelHtml(symbolId, i, rotationen[i], groessenFaktoren[i], extraKlasse, interaktiv, gesperrt);
    }).join("");
    return `<div class="db-karte ${klasse}">${kacheln}</div>`;
  };

  // v187: siehe Kommentar in rendereEinzelKarte() - derselbe Fokus/Tap-Ring-Bug
  // kann grundsätzlich auch hier auftreten.
  if (document.activeElement && container.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  container.innerHTML = karteHtml(symboleA, rotationenA, groessenA, "db-karte-a") + karteHtml(symboleB, rotationenB, groessenB, "db-karte-b");

  if (interaktiv) {
    container.querySelectorAll(".db-symbol").forEach((el) => {
      el.addEventListener("click", () => antworteSymbol(Number(el.dataset.symbol)));
    });
  }
}

// Rendert EINE einzelne runde Karte (Turm-Modus: entweder die eigene
// oberste Stapelkarte oder die gemeinsame Mitte-Karte).
// interaktiv - true, wenn diese Karte grundsätzlich antippbar ist (nur die
//              eigene Karte, nie die Mitte-Karte)
// gesperrt   - true, wenn gerade NICHT angetippt werden darf (z. B. während
//              der kurzen Sperre nach einem Tipp) - wird dann als "disabled"
//              gerendert (button bleibt ein <button>, nur ausgegraut), statt
//              gar keinen Klick-Handler zu bekommen
function rendereEinzelKarte(container, symbole, rotationen, groessenFaktoren, klasse, interaktiv, gesperrt, aufKlick) {
  // v187: Bug behoben - nach einem Tipp auf ein Symbol (z. B. eine korrekte
  // Karte, die daraufhin durch die NEUE oberste Stapelkarte ersetzt wird)
  // blieb auf iOS Safari manchmal der native Tap-/Fokus-Ring des gerade
  // angetippten Buttons an derselben Bildschirmposition "kleben", obwohl
  // dort inzwischen ein komplett neues <button>-Element (mit einem anderen
  // Symbol, z. B. dem Ballon) steht - WebKit räumt das :active/:focus des
  // entfernten Elements nicht zuverlässig auf, wenn es per innerHTML mitten
  // im Tap ausgetauscht wird. Deshalb hier VOR dem Austausch aktiv den Fokus
  // von jedem noch fokussierten Symbol in dieser Karte nehmen.
  if (document.activeElement && container.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  const kacheln = symbole.map((symbolId, i) =>
    kachelHtml(symbolId, i, rotationen[i], groessenFaktoren[i], "", interaktiv, gesperrt)
  ).join("");
  container.innerHTML = `<div class="db-karte ${klasse}">${kacheln}</div>`;
  if (interaktiv && !gesperrt) {
    container.querySelectorAll(".db-symbol").forEach((el) => {
      el.addEventListener("click", () => aufKlick(Number(el.dataset.symbol)));
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

// ============================================================================
//  Turm-Modus: Anzeige & Ablegen
// ============================================================================
function zeigeTurm() {
  const meinStapel = eigenerStapel();
  const mitteKarteRoh = dtMitte !== null && dtMitte !== undefined ? DECK[dtMitte] : [];
  const fertig = meinStapel.length === 0;
  const eigeneKarteRoh = fertig ? [] : DECK[meinStapel[0]];

  // Wie bei rotationRunde (Schnelligkeits-Modus): Drehwinkel/Größen nur neu
  // auswürfeln, wenn sich die Mitte-Karte oder die eigene oberste Karte
  // tatsächlich geändert hat - nicht bei jedem Re-Render (z. B. weil ein
  // anderer Spielerstand sich ändert).
  const schluessel = `${dtMitte}_${meinStapel[0] ?? "leer"}`;
  if (turmRotationSchluessel !== schluessel) {
    turmRotationSchluessel = schluessel;
    // v189: Bug behoben - anders als im Schnelligkeits-Modus (neueRunden()
    // mischt jede Karte einmal per mischeIndizes()) kamen die Turm-Karten
    // bisher UNGEMISCHT direkt aus DECK[...]. Da das Kartendeck rechnerisch
    // erzeugt wird, landete das gemeinsame Symbol zwischen zwei Karten
    // dadurch verlässlich immer am selben Steckplatz (z. B. immer unten
    // links) - kein Zufall, sondern eine Eigenschaft der Deck-Konstruktion.
    // Jetzt wird die Symbol-Reihenfolge pro neu gezogener Karte einmal
    // gemischt (und wie Drehwinkel/Größen nur bei echtem Kartenwechsel neu
    // gewürfelt) - die dataset-Symbol-Id je Kachel bleibt dabei korrekt,
    // nur ihre Position auf der Karte wird zufällig.
    turmSymboleMitte = mischeIndizes(mitteKarteRoh);
    turmSymboleEigene = mischeIndizes(eigeneKarteRoh);
    turmRotationenMitte = zufallsRotationen(turmSymboleMitte.length);
    turmGroessenMitte = zufallsGroessen(turmSymboleMitte.length);
    turmRotationenEigene = zufallsRotationen(turmSymboleEigene.length);
    turmGroessenEigene = zufallsGroessen(turmSymboleEigene.length);
  }

  const gesperrt = fertig || Date.now() < turmGesperrtBis;
  rendereEinzelKarte($("db-turm-eigene"), turmSymboleEigene, turmRotationenEigene, turmGroessenEigene, "db-karte-turm-eigene", !fertig, gesperrt, tippeSymbolTurm);
  rendereEinzelKarte($("db-turm-mitte"), turmSymboleMitte, turmRotationenMitte, turmGroessenMitte, "db-karte-turm-mitte", false, true);

  const statusEl = $("db-turm-status");
  if (fertig) {
    statusEl.hidden = false;
    statusEl.textContent = "🎉 Dein Stapel ist leer - warte, bis das Spiel endet.";
  } else if (turmLetzteMeldung === "falsch") {
    statusEl.hidden = false;
    statusEl.textContent = "❌ Falsch! Du bekommst von allen Mitspieler*innen die unterste Karte.";
  } else if (Date.now() < turmGesperrtBis) {
    statusEl.hidden = false;
    statusEl.textContent = "⏳ Einen Moment …";
  } else {
    statusEl.hidden = true;
  }

  rendereTurmStaende();
}

// Kompakte Anzeige (Profilbild + Kartenanzahl daneben) statt der großen
// spielerKarte()-Zeilen - dieselbe Optik wie die Warteavatare der anderen
// Spiele (siehe renderWarteAvatare in kern/ui.js), nur mit Zahl statt
// Ausgegraut/Nicht-Ausgegraut.
function rendereTurmStaende() {
  const container = $("db-turm-staende");
  if (!container) return;
  const anzahlVon = (s) => (dtStapel[s.id] || "").split(",").filter(Boolean).length;
  const sortiert = [...spielerListe].sort((a, b) => anzahlVon(a) - anzahlVon(b));
  container.innerHTML = "";
  sortiert.forEach((s) => {
    const div = document.createElement("div");
    div.className = "db-turm-stapel-item";
    div.innerHTML = avatarHtml(s.icon, "db-turm-stapel-avatar") +
      `<span class="db-turm-stapel-anzahl">${anzahlVon(s)}</span>`;
    container.appendChild(div);
  });
}

// Prüft und beansprucht per Firestore-Transaktion einen Treffer: nur wenn
// das Symbol WIRKLICH sowohl auf der (serverseitig) eigenen obersten Karte
// als auch auf der aktuellen Mitte-Karte liegt, gewinnt diese Person die
// Runde - bei einem Beinahe-Gleichstand entscheidet die Transaktion atomar,
// wer zuerst dran war, alle anderen scheitern einfach und bekommen die neue
// Mitte-Karte über den nächsten raumDaten()-Push.
// Jeder Tipp läuft über eine Transaktion (auch ein falscher!), weil ein
// falscher Tipp jetzt eine echte Strafe auslöst, die den Zustand ALLER
// Spieler*innen verändert (siehe unten) - anders als vorher reicht dafür
// kein rein lokaler Check mehr. Richtig oder falsch entscheidet dabei immer
// der serverseitige Stand, nicht der lokale Cache - bei einem
// Beinahe-Gleichstand gewinnt so nur eine Person wirklich.
async function tippeSymbolTurm(symbolId) {
  if (status !== "frage_aktiv" || spielModus !== "turm") return;
  if (Date.now() < turmGesperrtBis) return;
  const meinStapelLokal = eigenerStapel();
  if (meinStapelLokal.length === 0) return;
  if (turmSperreTimer) { clearTimeout(turmSperreTimer); turmSperreTimer = null; }
  // Kurze Sperre schon vor der Transaktion, damit ein zweiter Klick während
  // der Netzwerk-Laufzeit nicht nochmal auslöst.
  turmGesperrtBis = Date.now() + 250;
  let ergebnis = null;
  try {
    await runTransaction(api.db, async (tx) => {
      const raumSnap = await tx.get(api.raumRef());
      const daten = raumSnap.data();
      if (!daten || daten.dbStatus !== "frage_aktiv" || daten.dbModus !== "turm") {
        throw new Error("ueberholt");
      }
      const serverDtStapel = daten.dtStapel || {};
      const serverMitteKarte = DECK[daten.dtMitte] ?? [];
      const serverStapelText = serverDtStapel[api.spielerId] || "";
      const serverStapel = serverStapelText ? serverStapelText.split(",").map(Number) : [];
      if (serverStapel.length === 0) throw new Error("ueberholt");
      const obersteIdx = serverStapel[0];
      const obersteKarte = DECK[obersteIdx] ?? [];
      const richtig = obersteKarte.includes(symbolId) && serverMitteKarte.includes(symbolId);

      if (richtig) {
        const neuerStapel = serverStapel.slice(1);
        const neuesDtStapel = { ...serverDtStapel, [api.spielerId]: neuerStapel.join(",") };
        const aktualisierung = { dtMitte: obersteIdx, dtStapel: neuesDtStapel };
        if (neuerStapel.length === 0) {
          aktualisierung.dbStatus = "beendet";
          aktualisierung.dtSiegerId = api.spielerId;
          // v185: Punkte gibt es jetzt nicht mehr pro einzelnem Treffer
          // während des laufenden Spiels (das ergab bei ungleich schnellen
          // Spieler*innen einen irreführenden Zwischenstand und stimmte am
          // Ende nicht mit "wer ist zuerst fertig" überein). Stattdessen wird
          // erst genau jetzt - sobald jemand seinen kompletten Stapel los ist
          // und die Runde damit sofort endet - für ALLE Spieler*innen einmalig
          // nach Rang gepunktet: letzter Platz (die meisten verbleibenden
          // Karten) bekommt 0 Punkte, der/die Vorletzte 1, usw. aufsteigend
          // bis zum ersten Platz, der zusätzlich zu seinen Rang-Punkten einen
          // Bonuspunkt für den Sieg bekommt. Bei gleich vielen verbleibenden
          // Karten (Gleichstand) entscheidet die Reihenfolge der Spieler-IDs
          // im Raum-Dokument - ein "echtes" Tiebreak gibt es hier nicht, da
          // beide zu diesem Zeitpunkt schlicht exakt gleich weit waren.
          const rangfolge = Object.keys(neuesDtStapel)
            .map((id) => ({ id, anzahl: (neuesDtStapel[id] || "").split(",").filter(Boolean).length }))
            .sort((a, b) => a.anzahl - b.anzahl);
          const anzahlSpieler = rangfolge.length;
          rangfolge.forEach((eintrag, i) => {
            const rang = i + 1; // 1 = Sieger*in (leerer Stapel)
            const punkte = (anzahlSpieler - rang) + (rang === 1 ? 1 : 0);
            tx.update(api.spielerRef(eintrag.id), { punkte });
          });
        }
        tx.update(api.raumRef(), aktualisierung);
        ergebnis = { richtig: true, dtMitte: obersteIdx, dtStapel: neuesDtStapel };
      } else {
        // Strafe: von JEDER anderen Person die unterste Karte ihres Stapels
        // klauen und unten an den eigenen Stapel anhängen (siehe Erklärung
        // im Commit) - wer schon leer ist, wird dabei übersprungen.
        const neuesDtStapel = { ...serverDtStapel };
        const eigenerNeuerStapel = [...serverStapel];
        Object.keys(serverDtStapel).forEach((spielerId) => {
          if (spielerId === api.spielerId) return;
          const text = serverDtStapel[spielerId] || "";
          const arr = text ? text.split(",").map(Number) : [];
          if (arr.length === 0) return;
          const unterste = arr.pop();
          neuesDtStapel[spielerId] = arr.join(",");
          eigenerNeuerStapel.push(unterste);
        });
        neuesDtStapel[api.spielerId] = eigenerNeuerStapel.join(",");
        tx.update(api.raumRef(), { dtStapel: neuesDtStapel });
        ergebnis = { richtig: false, dtStapel: neuesDtStapel };
      }
    });
    // Lokal sofort übernehmen statt auf den nächsten Firestore-Push zu
    // warten - sonst könnte kurz noch die alte Karte/der alte Stapelstand zu
    // sehen sein, bevor die eigene Änderung über den Listener zurückkommt.
    if (ergebnis) {
      dtStapel = ergebnis.dtStapel;
      if (ergebnis.dtMitte !== undefined) dtMitte = ergebnis.dtMitte;
      turmGesperrtBis = ergebnis.richtig ? 0 : Date.now() + 1200;
      turmLetzteMeldung = ergebnis.richtig ? null : "falsch";
      zeigeTurm();
      if (!ergebnis.richtig) {
        turmSperreTimer = setTimeout(() => { turmLetzteMeldung = null; zeigeTurm(); }, 1250);
      }
    }
  } catch (e) {
    if (e.message === "ueberholt") {
      turmGesperrtBis = Date.now() + 300;
      zeigeTurm();
    } else {
      turmGesperrtBis = 0;
      zeigeDebug("Fehler beim Tippen: " + e.message);
    }
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
  if (spielModus === "turm") {
    speichereEndstandTurm();
  }
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("db-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const zusatz = spielModus === "turm" && s.id === dtSiegerId ? " 🏆 Stapel zuerst leer!" : "";
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    if (zusatz) li.innerHTML += `<p class="hinweis-text db-turm-sieger-hinweis">${s.name}${zusatz}</p>`;
    liste.appendChild(li);
  });
  const teamsEl = $("db-endstand-teams");
  teamsEl.hidden = !teammodus || spielModus === "turm";
  if (teammodus && spielModus !== "turm") teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("db-endstand-warten").hidden = api.istLeiter;
}

// Anders als im Schnelligkeits-Modus gibt es im Turm-Modus keinen "weiter()"-
// Knopf, der beim letzten Runden-Übergang die Wertung speichert - das Spiel
// endet ja mitten in einer Transaktion, sobald jemand seinen Stapel leert
// (siehe tippeSymbolTurm()). Die Wertung wird daher hier einmalig beim
// ersten Anzeigen des Endstands gespeichert, abgesichert durch dieselbe
// ausgewertetAusgeloest-Sperre wie bei den anderen Spielen.
function speichereEndstandTurm() {
  if (turmWertungGespeichert || !api.istLeiter) return;
  turmWertungGespeichert = true;
  speichereWertung(api, "doppelblick", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { generiereDeck, mischeIndizes };
