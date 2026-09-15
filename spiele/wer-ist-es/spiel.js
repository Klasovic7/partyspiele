// ============================================================================
//  Wer ist es?
// ----------------------------------------------------------------------------
//  Jeder bekommt nacheinander Hinweise zu einer Person (bisher nur Kategorie
//  "Fußballer") - vom schwersten zum leichtesten. Wer zuerst buzzert, darf als
//  Erstes raten. Je weniger Hinweise bis dahin aufgedeckt waren, desto mehr
//  Punkte gibt es für eine richtige Antwort.
//
//  Ablauf pro Runde (Felder im Raum-Dokument, alle mit Präfix "wi"):
//    frage_aktiv - Hinweise werden alle 10 Sekunden nachgelegt, jeder kann buzzern
//    gebuzzert   - jemand hat zuerst gebuzzert und darf jetzt raten
//    aufgeloest  - Antwort (oder "niemand wusste es") wird gezeigt
//    beendet     - Endstand
//
//  v95: Eine FALSCHE Antwort beendet die Runde NICHT mehr - sie kostet der
//  ratenden Person einen Punkt, alle sehen den geratenen Namen in der Liste
//  der bisherigen Fehlversuche, der nächste Hinweis wird sofort aufgedeckt und
//  jeder (auch die Person, die falsch lag) kann direkt weiter buzzern. Nur eine
//  RICHTIGE Antwort oder das manuelle Auflösen durch den Spielleiter beendet
//  die Runde (Status "aufgeloest").
//
//  Wie bei Schätzfragen meldet sich dieses Modul über starten/raumDaten/spieler/
//  beenden zurück (siehe Kommentar in spiele/schaetzfragen/spiel.js).
// ============================================================================
import { updateDoc, increment, runTransaction, arrayUnion } from "../../kern/firebase.js";
import { spielerKarte, teamEndstandHtml, zeigeDebug } from "../../kern/ui.js";
import { erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";

const HINWEIS_DAUER_MS = 10000;
const STANDARD_ANZAHL = 8;

const VORLAGE = `
  <div id="wi-setup" class="bildschirm-karte" hidden>
    <h1>🕵️ Wer ist es?</h1>
    <p class="hinweis-text">Ihr bekommt nacheinander Hinweise zu einem Fußballer - vom
      schwersten zum leichtesten. Wer zuerst buzzert, darf raten. Je weniger Hinweise
      es bis dahin gab, desto mehr Punkte gibt es.</p>

    <div id="wi-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="wi-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="8" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="wi-teammodus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Teammodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Teammodus">i</summary>
            <div>Jeder entscheidet sich für ein Team. Alle dürfen buzzern - richtig oder falsch, das Ergebnis zählt fürs ganze Team (Punkt bzw. Punktabzug für alle Mitglieder).</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="wi-teammodus">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="wi-teams" hidden>
      <div class="zt-team-grid">
        <button type="button" id="wi-team-wahl-blau" class="zt-team zt-team-blau zt-team-waehlbar">
          <h3>🔵 Team Blau</h3>
          <ul id="wi-team-blau"></ul>
        </button>
        <button type="button" id="wi-team-wahl-rot" class="zt-team zt-team-rot zt-team-waehlbar">
          <h3>🔴 Team Rot</h3>
          <ul id="wi-team-rot"></ul>
        </button>
      </div>
      <p><button id="wi-teams-zufall" class="btn-flach" hidden>Zufällige Teams</button></p>
    </div>

    <p id="wi-setup-fehler" class="fehler-text"></p>
    <p><button id="wi-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="wi-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="wi-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Fußballer</p>
    <p class="fortschritt" id="wi-frage-fortschritt"></p>

    <p class="wi-hinweis-aktuell" id="wi-hinweis-aktuell"></p>
    <ul class="wi-hinweis-liste" id="wi-hinweis-liste"></ul>
    <p class="wi-countdown" id="wi-countdown"></p>

    <ul class="wi-falsch-liste" id="wi-falsch-liste" hidden></ul>

    <p><button id="wi-buzzer" class="wi-buzzer" type="button">🔔 Buzzern!</button></p>
    <p id="wi-frage-status" class="hinweis-text"></p>

    <div id="wi-antwort-bereich" hidden>
      <p class="wi-antwort-zeile">
        <input id="wi-antwort-eingabe" type="text" placeholder="Wer ist es?" autocomplete="off">
        <button id="wi-antwort-absenden">Absenden</button>
      </p>
      <p id="wi-antwort-fehler" class="fehler-text"></p>
    </div>

    <p><button id="wi-ueberspringen" class="btn-flach" hidden>Niemand weiß es - Frage auflösen</button></p>
  </div>

  <div id="wi-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Fußballer</p>
    <p class="fortschritt" id="wi-erg-fortschritt"></p>
    <h2 id="wi-erg-status"></h2>
    <p>Gesucht war: <strong id="wi-erg-name"></strong></p>
    <ul id="wi-erg-liste"></ul>
    <p><button id="wi-weiter" hidden>Weiter</button></p>
  </div>

  <div id="wi-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="wi-endstand-teams" hidden></div>
    <ul id="wi-endstand-liste"></ul>
    <p id="wi-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

// ---------- Modulzustand ----------
let api = null;
let fragen = [];
let el = {};
let raum = {};
let spielerListe = [];

let index = -1;
let reihenfolge = [];
let anzahlFragen = 0;
let status = null;
let hinweisIndex = 1;
let hinweisSeit = 0;
let gebuzzertVon = null;
let antwortText = "";
let antwortKorrekt = null;
let falscheVersuche = [];
let gewuenschteAnzahl = 0;
let hinweisFortschreibenLaeuft = false;
let timerId = null;
let teammodus = false;
let teams = {};

const $ = (id) => el.wurzel.querySelector("#" + id);

function frageAn(pos) {
  return fragen[reihenfolge[pos]];
}

function mischeIndizes(werte) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

// Nachname reicht auch - Groß-/Kleinschreibung und Akzente spielen keine Rolle.
function normalisiere(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

// v94: Tippfehler-Toleranz. In der Hektik beim Buzzern werden Namen oft leicht
// falsch getippt ("Osimen" statt "Osimhen") - das soll trotzdem als richtig
// zählen. Klassische Levenshtein-Distanz (Anzahl Einfuegen/Loeschen/Ersetzen,
// um von a zu b zu kommen); je laenger das Wort, desto mehr Abweichung ist
// erlaubt, damit kurze Namen nicht versehentlich mit einem komplett anderen
// kurzen Namen verwechselt werden.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const zeile = new Array(n + 1);
  for (let j = 0; j <= n; j++) zeile[j] = j;
  for (let i = 1; i <= m; i++) {
    let vorherige = zeile[0];
    zeile[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = zeile[j];
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      zeile[j] = Math.min(zeile[j] + 1, zeile[j - 1] + 1, vorherige + kosten);
      vorherige = temp;
    }
  }
  return zeile[n];
}

function toleranzFuer(laenge) {
  if (laenge <= 4) return 0;
  if (laenge <= 7) return 1;
  return 2;
}

function passtUngefaehr(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const toleranz = toleranzFuer(Math.max(a.length, b.length));
  return toleranz > 0 && levenshtein(a, b) <= toleranz;
}

function istAntwortRichtig(eingabe, name) {
  const a = normalisiere(eingabe);
  if (!a) return false;
  if (passtUngefaehr(a, normalisiere(name))) return true;
  const nachname = normalisiere(name.split(" ").slice(-1)[0]);
  return passtUngefaehr(a, nachname);
}

function formatiertePunkte(p) {
  return p > 0 ? `+${p}` : `${p}`;
}

// ============================================================================
//  Start
// ============================================================================
export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  if (fragen.length === 0) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url));
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.wiStatus) {
    await setzeGrundzustand("setup");
  }

  timerId = setInterval(() => { aktualisiereCountdown(); pruefeHinweisFortschritt(); }, 300);
}

function verdrahteBedienelemente() {
  $("wi-anzahl").addEventListener("input", () => {
    const feld = $("wi-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("wi-anzahl").addEventListener("change", () => anzahlUebernehmen());
  // v105: als type="number" ließ sich der vorhandene Wert beim Fokussieren nicht
  // markieren - jetzt ein Textfeld mit numerischer Tastatur, select() funktioniert.
  $("wi-anzahl").addEventListener("focus", () => { $("wi-anzahl").select(); });
  $("wi-teammodus").addEventListener("change", teammodusUmschalten);
  $("wi-team-wahl-blau").addEventListener("click", () => waehleEigenesTeam("blau"));
  $("wi-team-wahl-rot").addEventListener("click", () => waehleEigenesTeam("rot"));
  $("wi-teams-zufall").addEventListener("click", zufaelligeTeams);
  $("wi-starten").addEventListener("click", spielStarten);
  $("wi-buzzer").addEventListener("click", buzzern);
  $("wi-antwort-absenden").addEventListener("click", antwortAbsenden);
  $("wi-antwort-eingabe").addEventListener("keydown", (e) => { if (e.key === "Enter") antwortAbsenden(); });
  $("wi-ueberspringen").addEventListener("click", ueberspringen);
  $("wi-weiter").addEventListener("click", weiter);
}

export function beenden() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  el = {}; raum = {}; spielerListe = [];
  index = -1; reihenfolge = []; anzahlFragen = 0; status = null;
  hinweisIndex = 1; hinweisSeit = 0; gebuzzertVon = null;
  antwortText = ""; antwortKorrekt = null; falscheVersuche = []; gewuenschteAnzahl = 0;
  hinweisFortschreibenLaeuft = false;
  teammodus = false; teams = {};
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "setup" || !status) zeigeSetup();
  else if (status === "frage_aktiv" || status === "gebuzzert") zeigeFrage();
  else if (status === "aufgeloest") zeigeErgebnis();
  else if (status === "beendet") zeigeEndstand();
}

// ============================================================================
//  Reaktion auf das Raum-Dokument
// ============================================================================
export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  raum = daten;
  status = daten.wiStatus ?? null;
  reihenfolge = daten.wiReihenfolge ?? [];
  anzahlFragen = daten.wiAnzahlFragen ?? 0;
  hinweisIndex = daten.wiHinweisIndex ?? 1;
  hinweisSeit = daten.wiHinweisSeit ?? 0;
  gebuzzertVon = daten.wiGebuzzertVon ?? null;
  antwortText = daten.wiAntwortText ?? "";
  antwortKorrekt = daten.wiAntwortKorrekt ?? null;
  falscheVersuche = daten.wiFalscheVersuche ?? [];
  teammodus = !!daten.wiTeammodus;
  teams = daten.wiTeams ?? {};

  if ($("wi-teammodus").checked !== teammodus) $("wi-teammodus").checked = teammodus;

  const neuerIndex = daten.wiFragenIndex ?? 0;
  if (index !== neuerIndex) {
    index = neuerIndex;
    $("wi-antwort-eingabe").value = "";
    $("wi-antwort-fehler").textContent = "";
  }

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("wi-setup").hidden = false;
  } else if (status === "frage_aktiv" || status === "gebuzzert") {
    zeigeFrage();
    $("wi-frage-screen").hidden = false;
  } else if (status === "aufgeloest") {
    zeigeErgebnis();
    $("wi-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("wi-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["wi-setup", "wi-frage-screen", "wi-ergebnis-screen", "wi-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup
// ============================================================================
function zeigeSetup() {
  if (gewuenschteAnzahl === 0) gewuenschteAnzahl = Math.min(STANDARD_ANZAHL, fragen.length);
  $("wi-anzahl").max = String(Math.max(1, fragen.length));
  $("wi-anzahl").value = String(gewuenschteAnzahl);
  $("wi-anzahl-zeile").hidden = !api.istLeiter;
  $("wi-teammodus-zeile").hidden = !api.istLeiter;
  const teamSchalter = $("wi-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("wi-teams").hidden = !teammodus;
  $("wi-teams-zufall").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("wi-starten").hidden = !api.istLeiter;
  $("wi-setup-warten").hidden = api.istLeiter;
}

// v109: Teammodus - alle dürfen buzzern, gewinnt aber das ganze Team die Punkte
// (siehe antwortAbsenden). Jeder wählt sich selbst ein Team; nur der Spielleiter
// darf über "Zufällige Teams" alle Zuordnungen neu auswürfeln.
async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("wi-teammodus").checked;
  const neueTeams = aktiviert ? teams : {};
  try {
    await updateDoc(api.raumRef(), { wiTeammodus: aktiviert, wiTeams: neueTeams });
  } catch (e) {
    $("wi-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function waehleEigenesTeam(team) {
  if (!teammodus) return;
  try {
    await updateDoc(api.raumRef(), { wiTeams: { ...teams, [api.spielerId]: team } });
  } catch (e) {
    zeigeDebug("Team konnte nicht gewählt werden: " + e.message);
  }
}

async function zufaelligeTeams() {
  if (!api.istLeiter || !teammodus) return;
  $("wi-teams-zufall").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      wiTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("wi-teams-zufall").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("wi-team-" + team);
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
  $("wi-team-wahl-" + team).classList.toggle("zt-team-eigenes", teams[api.spielerId] === team);
}

// v104: ersetzt den fruehereren Plus/Minus-Stepper - das Zahlenfeld wird
// beim Verlassen (change) auf [1, Anzahl verfuegbarer Fragen] begrenzt.
function anzahlUebernehmen() {
  if (!api.istLeiter) return;
  let wert = parseInt($("wi-anzahl").value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > fragen.length) wert = fragen.length;
  gewuenschteAnzahl = wert;
  $("wi-anzahl").value = String(wert);
}

async function setzeGrundzustand(wiStatus) {
  await updateDoc(api.raumRef(), {
    wiStatus, wiReihenfolge: [], wiFragenIndex: 0, wiAnzahlFragen: 0,
    wiHinweisIndex: 1, wiHinweisSeit: 0, wiGebuzzertVon: null,
    wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0,
    wiFalscheVersuche: [], wiTeammodus: false, wiTeams: {}
  });
}

async function raeumeSpieldatenAuf() {
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

async function spielStarten() {
  $("wi-setup-fehler").textContent = "";
  if (fragen.length === 0) {
    $("wi-setup-fehler").textContent = "Es sind noch keine Fußballer hinterlegt.";
    return;
  }
  anzahlUebernehmen();
  $("wi-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahl = Math.min(gewuenschteAnzahl || fragen.length, fragen.length);
    const neueReihenfolge = mischeIndizes(fragen.map((_, i) => i)).slice(0, anzahl);
    const neueTeams = teammodus
      ? ergaenzeFehlendeTeams(teams, spielerListe.map((spieler) => spieler.id))
      : teams;
    await updateDoc(api.raumRef(), {
      wiStatus: "frage_aktiv", wiFragenIndex: 0, wiAnzahlFragen: anzahl,
      wiReihenfolge: neueReihenfolge, wiHinweisIndex: 1, wiHinweisSeit: Date.now(),
      wiGebuzzertVon: null, wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0,
      wiFalscheVersuche: [], wiTeammodus: teammodus, wiTeams: neueTeams
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("wi-starten").disabled = false;
}

// v90: Gleicher Rückweg-Haken wie bei Schätzfragen (siehe dort, v87) - der obere
// Button in der Kopfzeile räumt darüber die Rundendaten dieses Spiels mit auf.
export async function vorZurueck() {
  await raeumeSpieldatenAuf();
  await setzeGrundzustand("setup");
  await api.zurueckZurAuswahl();
}

// ============================================================================
//  Frage: Hinweise, Buzzer, Antwort
// ============================================================================
function zeigeFrage() {
  const frage = frageAn(index);
  if (!frage) return;
  $("wi-frage-fortschritt").textContent = `Frage ${index + 1} von ${anzahlFragen}`;

  const gesamt = frage.hinweise.length;
  const sichtbar = Math.min(Math.max(hinweisIndex, 1), gesamt);
  $("wi-hinweis-aktuell").textContent = frage.hinweise[sichtbar - 1] ?? "";

  const liste = $("wi-hinweis-liste");
  liste.innerHTML = "";
  for (let i = 0; i < sichtbar - 1; i++) {
    const li = document.createElement("li");
    li.textContent = frage.hinweise[i];
    liste.appendChild(li);
  }

  // v95: Bisherige Fehlversuche dieser Runde - für alle sichtbar, damit man
  // nicht denselben schon genannten falschen Namen nochmal versucht.
  const falschListe = $("wi-falsch-liste");
  falschListe.innerHTML = "";
  falscheVersuche.forEach((v) => {
    const li = document.createElement("li");
    li.textContent = `${v.name}: „${v.text}“ - falsch (-1 Punkt${teammodus ? " fürs Team" : ""})`;
    falschListe.appendChild(li);
  });
  falschListe.hidden = falscheVersuche.length === 0;

  const amZug = gebuzzertVon === api.spielerId;
  const jemandBuzzerte = !!gebuzzertVon;
  $("wi-buzzer").hidden = jemandBuzzerte;
  $("wi-buzzer").disabled = jemandBuzzerte;
  $("wi-antwort-bereich").hidden = !amZug;
  // v94: Erst ab dem letzten Hinweis anbieten, damit niemand vorzeitig aufgibt,
  // solange noch Hinweise nachkommen.
  $("wi-ueberspringen").hidden = !api.istLeiter || sichtbar < gesamt;

  if (jemandBuzzerte) {
    const s = spielerListe.find((x) => x.id === gebuzzertVon);
    $("wi-frage-status").textContent = amZug
      ? "Du bist dran - wer ist es?"
      : `${s?.name ?? "Jemand"} antwortet gerade …`;
  } else {
    $("wi-frage-status").textContent = "";
  }
}

function aktualisiereCountdown() {
  if (!el.wurzel) return;
  if (status !== "frage_aktiv") { $("wi-countdown").textContent = ""; return; }
  const frage = frageAn(index);
  if (!frage) return;
  const gesamt = frage.hinweise.length;
  if (hinweisIndex >= gesamt) { $("wi-countdown").textContent = "Letzter Hinweis"; return; }
  const rest = Math.max(0, HINWEIS_DAUER_MS - (Date.now() - hinweisSeit));
  $("wi-countdown").textContent = `Nächster Hinweis in ${Math.ceil(rest / 1000)}s`;
}

// Nur der Spielleiter-Client schreibt das Fortschalten in den Raum - sonst
// würden mehrere Geräte gleichzeitig denselben nächsten Hinweis aufdecken.
async function pruefeHinweisFortschritt() {
  if (!api?.istLeiter || status !== "frage_aktiv" || hinweisFortschreibenLaeuft) return;
  const frage = frageAn(index);
  if (!frage) return;
  if (hinweisIndex >= frage.hinweise.length) return;
  if (Date.now() - hinweisSeit < HINWEIS_DAUER_MS) return;

  hinweisFortschreibenLaeuft = true;
  try {
    await updateDoc(api.raumRef(), { wiHinweisIndex: increment(1), wiHinweisSeit: Date.now() });
  } catch (e) {
    zeigeDebug("Fehler beim Aufdecken des nächsten Hinweises: " + e.message);
  }
  hinweisFortschreibenLaeuft = false;
}

// Wer zuerst hier ankommt, gewinnt - die Transaktion sorgt dafür, dass bei
// gleichzeitigem Buzzern trotzdem nur eine Person den Zuschlag bekommt.
async function buzzern() {
  if (status !== "frage_aktiv") return;
  $("wi-buzzer").disabled = true;
  try {
    await runTransaction(api.db, async (tx) => {
      const snap = await tx.get(api.raumRef());
      const daten = snap.data();
      if (!daten || daten.wiStatus !== "frage_aktiv" || daten.wiGebuzzertVon) {
        throw new Error("__ZU_SPAET__");
      }
      tx.update(api.raumRef(), { wiStatus: "gebuzzert", wiGebuzzertVon: api.spielerId });
    });
  } catch (e) {
    if (e.message !== "__ZU_SPAET__") {
      zeigeDebug("Fehler beim Buzzern: " + e.message);
      $("wi-buzzer").disabled = false;
    }
  }
}

async function antwortAbsenden() {
  if (gebuzzertVon !== api.spielerId) return;
  const text = $("wi-antwort-eingabe").value.trim();
  if (!text) {
    $("wi-antwort-fehler").textContent = "Bitte eine Antwort eingeben.";
    return;
  }
  $("wi-antwort-fehler").textContent = "";
  $("wi-antwort-absenden").disabled = true;
  try {
    const frage = frageAn(index);
    const richtig = istAntwortRichtig(text, frage.name);
    if (richtig) {
      // Richtig: Runde ist zu Ende, ganz normal auflösen und Punkte gutschreiben.
      const punkte = Math.max(1, frage.hinweise.length - hinweisIndex + 1);
      await updateDoc(api.raumRef(), {
        wiStatus: "aufgeloest", wiAntwortText: text, wiAntwortKorrekt: true, wiPunkteDieserRunde: punkte
      });
      // v110: Im Teammodus bekommt/verliert das ganze Team die Punkte, nicht nur
      // die buzzernde Person - der Gesamtstand pro Team ist dabei immer die
      // Summe der einzelnen Mitgliederpunkte (siehe teamEndstandHtml).
      if (teammodus && teams[api.spielerId]) {
        const eigenesTeam = teams[api.spielerId];
        const mitglieder = spielerListe.filter((s) => teams[s.id] === eigenesTeam);
        await Promise.all(mitglieder.map((s) => updateDoc(api.spielerRef(s.id), { punkte: increment(punkte) })));
      } else {
        await updateDoc(api.spielerRef(), { punkte: increment(punkte) });
      }
    } else {
      // v95: Falsch: KEIN Rundenende. Ein Punkt Abzug, der genannte Name bleibt
      // für alle sichtbar in der Fehlversuch-Liste, der Buzzer wird für alle
      // wieder freigegeben und der nächste Hinweis kommt sofort (ohne auf die
      // volle 10-Sekunden-Wartezeit zu warten).
      const naechsterHinweisIndex = Math.min(hinweisIndex + 1, frage.hinweise.length);
      $("wi-antwort-eingabe").value = "";
      await updateDoc(api.raumRef(), {
        wiStatus: "frage_aktiv", wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0,
        wiGebuzzertVon: null, wiHinweisIndex: naechsterHinweisIndex, wiHinweisSeit: Date.now(),
        wiFalscheVersuche: arrayUnion({ name: api.spielerName, text })
      });
      // v110: Im Teammodus trifft der Punktabzug bei einer falschen Antwort
      // ebenfalls das ganze Team, nicht nur die ratende Person.
      if (teammodus && teams[api.spielerId]) {
        const eigenesTeam = teams[api.spielerId];
        const mitglieder = spielerListe.filter((s) => teams[s.id] === eigenesTeam);
        await Promise.all(mitglieder.map((s) => updateDoc(api.spielerRef(s.id), { punkte: increment(-1) })));
      } else {
        await updateDoc(api.spielerRef(), { punkte: increment(-1) });
      }
    }
  } catch (e) {
    zeigeDebug("Fehler beim Absenden der Antwort: " + e.message);
  }
  $("wi-antwort-absenden").disabled = false;
}

// Spielleiter kann jederzeit abbrechen, wenn eine Runde feststeckt (z. B. weil
// niemand mehr buzzert, oder der Ratende die Antwort nie abschickt).
async function ueberspringen() {
  if (!api.istLeiter) return;
  try {
    await updateDoc(api.raumRef(), {
      wiStatus: "aufgeloest", wiAntwortText: "", wiAntwortKorrekt: null,
      wiPunkteDieserRunde: 0, wiGebuzzertVon: null
    });
  } catch (e) {
    zeigeDebug("Fehler beim Überspringen: " + e.message);
  }
}

// ============================================================================
//  Auswertung
// ============================================================================
function zeigeErgebnis() {
  const frage = frageAn(index);
  if (!frage) return;
  $("wi-erg-fortschritt").textContent = `Frage ${index + 1} von ${anzahlFragen}`;
  $("wi-erg-name").textContent = frage.name;

  const raterName = spielerListe.find((s) => s.id === gebuzzertVon)?.name;
  if (!gebuzzertVon) {
    $("wi-erg-status").textContent = "Niemand hat gebuzzert";
  } else if (antwortKorrekt) {
    $("wi-erg-status").textContent = `${raterName ?? "?"} hatte recht! 🎉`;
  } else {
    $("wi-erg-status").textContent = `${raterName ?? "?"} lag daneben ("${antwortText}")`;
  }

  const liste = $("wi-erg-liste");
  liste.innerHTML = "";
  const gewinnerTeam = teammodus && gebuzzertVon ? teams[gebuzzertVon] : null;
  [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0)).forEach((s) => {
    const hatGewonnen = antwortKorrekt && (s.id === gebuzzertVon || (gewinnerTeam && teams[s.id] === gewinnerTeam));
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      s.name, s.farbe, s.icon,
      formatiertePunkte(hatGewonnen ? (raum.wiPunkteDieserRunde ?? 0) : 0),
      { punkteRechts: s.punkte ?? 0 }
    );
    liste.appendChild(li);
  });

  $("wi-weiter").hidden = !api.istLeiter;
  $("wi-weiter").textContent = index + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
}

async function weiter() {
  $("wi-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { wiStatus: "beendet" });
    } else {
      await updateDoc(api.raumRef(), {
        wiStatus: "frage_aktiv", wiFragenIndex: naechster,
        wiHinweisIndex: 1, wiHinweisSeit: Date.now(),
        wiGebuzzertVon: null, wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0,
        wiFalscheVersuche: []
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("wi-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("wi-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  const teamsEl = $("wi-endstand-teams");
  teamsEl.hidden = !teammodus;
  if (teammodus) teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("wi-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { istAntwortRichtig, mischeIndizes };
