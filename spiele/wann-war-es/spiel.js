// ============================================================================
//  Wann war es?
// ----------------------------------------------------------------------------
//  Baugleich zu "Wer ist es?" (siehe spiele/wer-ist-es/spiel.js für die
//  ausführlichen Kommentare zum Ablauf) - nur dass statt eines Fußballers ein
//  JAHR gesucht wird. Jeder bekommt nacheinander Hinweise zu einem Jahr, in
//  fester (Autoren-)Reihenfolge. Wer zuerst buzzert, darf raten. Je weniger
//  Hinweise bis dahin aufgedeckt waren, desto mehr Punkte gibt es für eine
//  richtige Antwort.
//
//  Ablauf pro Runde (Felder im Raum-Dokument, alle mit Präfix "ww"):
//    frage_aktiv - Hinweise werden alle 7 Sekunden nachgelegt, jeder kann buzzern
//    gebuzzert   - jemand hat zuerst gebuzzert und darf jetzt raten
//    aufgeloest  - Antwort (oder "niemand wusste es") wird gezeigt
//    beendet     - Endstand
//
//  Punkte: Eine FALSCHE Antwort beendet die Runde nicht - sie kostet der
//  ratenden Person mindestens einen Punkt, alle sehen den geratenen Wert in
//  der Liste der bisherigen Fehlversuche, der nächste Hinweis wird sofort
//  aufgedeckt und jeder (auch die Person, die falsch lag) kann direkt weiter
//  buzzern. Nur eine RICHTIGE Antwort oder das manuelle Auflösen durch den
//  Spielleiter beendet die Runde (Status "aufgeloest").
//  Der Punktabzug steigt pro Person UND pro Frage an - der erste Fehlversuch
//  kostet 1 Punkt, tippt dieselbe Person bei DERSELBEN Frage danach nochmal
//  falsch, kostet das 2 Punkte, beim dritten Fehlversuch 3 usw. Andere
//  Personen, die bei dieser Frage noch nicht falsch lagen, starten weiterhin
//  bei 1 Punkt Abzug.
//
//  v1: Erste Version, mit 3 Jahren zum Ausprobieren (siehe jahre.json).
//
//  Wie bei Schätzfragen meldet sich dieses Modul über starten/raumDaten/spieler/
//  beenden zurück (siehe Kommentar in spiele/schaetzfragen/spiel.js).
// ============================================================================
import { updateDoc, increment, runTransaction, arrayUnion } from "../../kern/firebase.js";
import { spielerKarte, teamEndstandHtml, teamGruppeHtml, zeigeDebug } from "../../kern/ui.js";
import { erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";
import { speichereWertung } from "../../kern/wertung.js";
import { pooleOhneWiederholung, aktualisierterVerlauf } from "../../kern/verlauf.js";

const HINWEIS_DAUER_MS = 7000;
// v173: Nach dem Buzzern hat die ratende Person 10 Sekunden Zeit zu antworten -
// laeuft die Zeit ab, zaehlt das wie eine falsche Antwort (gestaffelter Abzug).
const ANTWORT_ZEIT_MS = 10000;
const STANDARD_ANZAHL = 8;

const VORLAGE = `
  <div id="ww-setup" class="bildschirm-karte" hidden>
    <h1>📅 Wann war es?</h1>
    <p class="hinweis-text">Ihr bekommt nacheinander Hinweise zu einem Jahr - in
      fester Reihenfolge. Wer zuerst buzzert, darf das Jahr erraten. Je weniger
      Hinweise es bis dahin gab, desto mehr Punkte gibt es.</p>

    <div id="ww-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="ww-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="8" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="ww-teammodus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Teammodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Teammodus">i</summary>
            <div>Jeder entscheidet sich für ein Team. Alle dürfen buzzern, aber die Punkte (richtig oder falsch) bekommt bzw. verliert immer nur die einzelne Person - der Team-Gesamtstand ist einfach die Summe aller Mitgliederpunkte.</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="ww-teammodus">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="ww-teams" hidden>
      <div class="zt-team-grid">
        <button type="button" id="ww-team-wahl-blau" class="zt-team zt-team-blau zt-team-waehlbar">
          <h3>🔵 Team Blau</h3>
          <ul id="ww-team-blau"></ul>
        </button>
        <button type="button" id="ww-team-wahl-rot" class="zt-team zt-team-rot zt-team-waehlbar">
          <h3>🔴 Team Rot</h3>
          <ul id="ww-team-rot"></ul>
        </button>
      </div>
      <p><button id="ww-teams-zufall" class="btn-flach" hidden>Zufällige Teams</button></p>
    </div>

    <p id="ww-setup-fehler" class="fehler-text"></p>
    <p><button id="ww-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="ww-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="ww-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Jahr</p>
    <p class="fortschritt" id="ww-frage-fortschritt"></p>

    <p class="wi-hinweis-aktuell" id="ww-hinweis-aktuell"></p>
    <ul class="wi-hinweis-liste" id="ww-hinweis-liste"></ul>
    <p class="wi-countdown" id="ww-countdown"></p>

    <ul class="wi-falsch-liste" id="ww-falsch-liste" hidden></ul>

    <p><button id="ww-buzzer" class="wi-buzzer" type="button">🔔 Buzzern!</button></p>
    <p id="ww-frage-status" class="hinweis-text"></p>

    <div id="ww-antwort-bereich" hidden>
      <p class="wi-antwort-zeile">
        <input id="ww-antwort-eingabe" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="In welchem Jahr war das?" autocomplete="off">
        <button id="ww-antwort-absenden">Absenden</button>
      </p>
      <p id="ww-antwort-fehler" class="fehler-text"></p>
    </div>

    <p><button id="ww-ueberspringen" class="btn-flach" hidden>Niemand weiß es - Frage auflösen</button></p>
  </div>

  <div id="ww-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Jahr</p>
    <h2 id="ww-erg-status"></h2>
    <p>Gesucht war das Jahr: <strong id="ww-erg-jahr"></strong></p>
    <ul id="ww-erg-liste"></ul>
    <p><button id="ww-weiter" hidden>Weiter</button></p>
  </div>

  <div id="ww-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="ww-endstand-teams" hidden></div>
    <ul id="ww-endstand-liste"></ul>
    <p id="ww-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
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
let gespielt = []; // Indizes der zuletzt gespielten Fragen (fuer Wiederholungsschutz)
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
let antwortZeitAblaufLaeuft = false;
let gebuzzertSeit = 0;
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

// Extrahiert die erste Zahl aus der Eingabe - so zählen auch Eingaben wie
// "im Jahr 1969" oder "1969?" als "1969".
function extrahiereJahr(text) {
  const treffer = (text ?? "").match(/-?\d+/);
  return treffer ? parseInt(treffer[0], 10) : null;
}

function istAntwortRichtig(eingabe, jahr) {
  const zahl = extrahiereJahr(eingabe);
  return zahl !== null && zahl === jahr;
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
    const antwort = await fetch(new URL("jahre.json", import.meta.url), { cache: "no-store" });
    if (!antwort.ok) throw new Error("jahre.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.wwStatus) {
    await setzeGrundzustand("setup");
  }

  timerId = setInterval(() => { aktualisiereCountdown(); pruefeHinweisFortschritt(); pruefeAntwortZeitAblauf(); }, 300);
}

function verdrahteBedienelemente() {
  $("ww-anzahl").addEventListener("input", () => {
    const feld = $("ww-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("ww-anzahl").addEventListener("change", () => anzahlUebernehmen());
  $("ww-anzahl").addEventListener("focus", () => { $("ww-anzahl").select(); });
  $("ww-teammodus").addEventListener("change", teammodusUmschalten);
  $("ww-team-wahl-blau").addEventListener("click", () => waehleEigenesTeam("blau"));
  $("ww-team-wahl-rot").addEventListener("click", () => waehleEigenesTeam("rot"));
  $("ww-teams-zufall").addEventListener("click", zufaelligeTeams);
  $("ww-starten").addEventListener("click", spielStarten);
  $("ww-buzzer").addEventListener("click", buzzern);
  $("ww-antwort-absenden").addEventListener("click", antwortAbsenden);
  $("ww-antwort-eingabe").addEventListener("keydown", (e) => { if (e.key === "Enter") antwortAbsenden(); });
  $("ww-ueberspringen").addEventListener("click", ueberspringen);
  $("ww-weiter").addEventListener("click", weiter);
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
  status = daten.wwStatus ?? null;
  reihenfolge = daten.wwReihenfolge ?? [];
  gespielt = daten.wwGespielt ?? [];
  anzahlFragen = daten.wwAnzahlFragen ?? 0;
  hinweisIndex = daten.wwHinweisIndex ?? 1;
  hinweisSeit = daten.wwHinweisSeit ?? 0;
  gebuzzertVon = daten.wwGebuzzertVon ?? null;
  gebuzzertSeit = daten.wwGebuzzertSeit ?? 0;
  antwortText = daten.wwAntwortText ?? "";
  antwortKorrekt = daten.wwAntwortKorrekt ?? null;
  falscheVersuche = daten.wwFalscheVersuche ?? [];
  teammodus = !!daten.wwTeammodus;
  teams = daten.wwTeams ?? {};

  if ($("ww-teammodus").checked !== teammodus) $("ww-teammodus").checked = teammodus;

  const neuerIndex = daten.wwFragenIndex ?? 0;
  if (index !== neuerIndex) {
    index = neuerIndex;
    $("ww-antwort-eingabe").value = "";
    $("ww-antwort-fehler").textContent = "";
  }

  api.fortschritt(
    status === "frage_aktiv" || status === "gebuzzert" || status === "aufgeloest"
      ? `${index + 1}/${anzahlFragen}`
      : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("ww-setup").hidden = false;
  } else if (status === "frage_aktiv" || status === "gebuzzert") {
    zeigeFrage();
    $("ww-frage-screen").hidden = false;
  } else if (status === "aufgeloest") {
    zeigeErgebnis();
    $("ww-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("ww-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["ww-setup", "ww-frage-screen", "ww-ergebnis-screen", "ww-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup
// ============================================================================
function zeigeSetup() {
  if (gewuenschteAnzahl === 0) gewuenschteAnzahl = Math.min(STANDARD_ANZAHL, fragen.length);
  $("ww-anzahl").max = String(Math.max(1, fragen.length));
  $("ww-anzahl").value = String(gewuenschteAnzahl);
  $("ww-anzahl-zeile").hidden = false;
  $("ww-anzahl").disabled = !api.istLeiter;
  $("ww-teammodus-zeile").hidden = false;
  const teamSchalter = $("ww-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("ww-teams").hidden = !teammodus;
  $("ww-teams-zufall").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("ww-starten").hidden = !api.istLeiter;
  $("ww-setup-warten").hidden = api.istLeiter;
}

async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("ww-teammodus").checked;
  const neueTeams = aktiviert ? teams : {};
  try {
    await updateDoc(api.raumRef(), { wwTeammodus: aktiviert, wwTeams: neueTeams });
  } catch (e) {
    $("ww-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function waehleEigenesTeam(team) {
  if (!teammodus) return;
  try {
    await updateDoc(api.raumRef(), { wwTeams: { ...teams, [api.spielerId]: team } });
  } catch (e) {
    zeigeDebug("Team konnte nicht gewählt werden: " + e.message);
  }
}

async function zufaelligeTeams() {
  if (!api.istLeiter || !teammodus) return;
  $("ww-teams-zufall").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      wwTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("ww-teams-zufall").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("ww-team-" + team);
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
  $("ww-team-wahl-" + team).classList.toggle("zt-team-eigenes", teams[api.spielerId] === team);
}

function anzahlUebernehmen() {
  if (!api.istLeiter) return;
  let wert = parseInt($("ww-anzahl").value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > fragen.length) wert = fragen.length;
  gewuenschteAnzahl = wert;
  $("ww-anzahl").value = String(wert);
}

async function setzeGrundzustand(wwStatus) {
  await updateDoc(api.raumRef(), {
    wwStatus, wwReihenfolge: [], wwFragenIndex: 0, wwAnzahlFragen: 0,
    wwHinweisIndex: 1, wwHinweisSeit: 0, wwGebuzzertVon: null, wwGebuzzertSeit: 0,
    wwAntwortText: "", wwAntwortKorrekt: null, wwPunkteDieserRunde: 0,
    wwFalscheVersuche: [], wwTeammodus: false, wwTeams: {}, wwRundenDelta: {}
  });
}

async function raeumeSpieldatenAuf() {
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

async function spielStarten() {
  $("ww-setup-fehler").textContent = "";
  if (fragen.length === 0) {
    $("ww-setup-fehler").textContent = "Es sind noch keine Jahre hinterlegt.";
    return;
  }
  anzahlUebernehmen();
  $("ww-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahl = Math.min(gewuenschteAnzahl || fragen.length, fragen.length);
    // Wiederholungsschutz: bevorzugt Fragen ziehen, die in diesem Raum noch
    // nicht drankamen (siehe kern/verlauf.js).
    const { kandidaten, wurdeZurueckgesetzt } = pooleOhneWiederholung(fragen.map((_, i) => i), gespielt, anzahl);
    const neueReihenfolge = mischeIndizes(kandidaten).slice(0, anzahl);
    const neuerGespielt = aktualisierterVerlauf(gespielt, neueReihenfolge, wurdeZurueckgesetzt);
    const neueTeams = teammodus
      ? ergaenzeFehlendeTeams(teams, spielerListe.map((spieler) => spieler.id))
      : teams;
    await updateDoc(api.raumRef(), {
      wwStatus: "frage_aktiv", wwFragenIndex: 0, wwAnzahlFragen: anzahl,
      wwReihenfolge: neueReihenfolge, wwGespielt: neuerGespielt,
      wwHinweisIndex: 1, wwHinweisSeit: Date.now(),
      wwGebuzzertVon: null, wwGebuzzertSeit: 0, wwAntwortText: "", wwAntwortKorrekt: null, wwPunkteDieserRunde: 0,
      wwFalscheVersuche: [], wwTeammodus: teammodus, wwTeams: neueTeams, wwRundenDelta: {}
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("ww-starten").disabled = false;
}

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

  const gesamt = frage.hinweise.length;
  const sichtbar = Math.min(Math.max(hinweisIndex, 1), gesamt);
  $("ww-frage-fortschritt").textContent = `Hinweis ${sichtbar} von ${gesamt}`;
  $("ww-hinweis-aktuell").textContent = frage.hinweise[sichtbar - 1] ?? "";

  const liste = $("ww-hinweis-liste");
  liste.innerHTML = "";
  for (let i = 0; i < sichtbar - 1; i++) {
    const li = document.createElement("li");
    li.textContent = frage.hinweise[i];
    liste.appendChild(li);
  }

  const falschListe = $("ww-falsch-liste");
  falschListe.innerHTML = "";
  falscheVersuche.forEach((v) => {
    const li = document.createElement("li");
    const abzug = v.abzug ?? 1;
    li.textContent = `${v.name}: „${v.text}“ - falsch (-${abzug} ${abzug === 1 ? "Punkt" : "Punkte"})`;
    falschListe.appendChild(li);
  });
  falschListe.hidden = falscheVersuche.length === 0;

  const amZug = gebuzzertVon === api.spielerId;
  const jemandBuzzerte = !!gebuzzertVon;
  $("ww-buzzer").hidden = jemandBuzzerte;
  $("ww-buzzer").disabled = jemandBuzzerte;
  $("ww-antwort-bereich").hidden = !amZug;
  $("ww-ueberspringen").hidden = !api.istLeiter || sichtbar < gesamt;

  if (jemandBuzzerte) {
    const s = spielerListe.find((x) => x.id === gebuzzertVon);
    $("ww-frage-status").textContent = amZug
      ? "Du bist dran - in welchem Jahr war das?"
      : `${s?.name ?? "Jemand"} antwortet gerade …`;
  } else {
    $("ww-frage-status").textContent = "";
  }
}

function aktualisiereCountdown() {
  if (!el.wurzel) return;
  if (status === "gebuzzert") {
    const rest = Math.max(0, ANTWORT_ZEIT_MS - (Date.now() - gebuzzertSeit));
    $("ww-countdown").textContent = gebuzzertVon === api.spielerId
      ? `Noch ${Math.ceil(rest / 1000)}s zum Antworten`
      : `Antwortzeit: ${Math.ceil(rest / 1000)}s`;
    return;
  }
  if (status !== "frage_aktiv") { $("ww-countdown").textContent = ""; return; }
  const frage = frageAn(index);
  if (!frage) return;
  const gesamt = frage.hinweise.length;
  if (hinweisIndex >= gesamt) { $("ww-countdown").textContent = "Letzter Hinweis"; return; }
  const rest = Math.max(0, HINWEIS_DAUER_MS - (Date.now() - hinweisSeit));
  $("ww-countdown").textContent = `Nächster Hinweis in ${Math.ceil(rest / 1000)}s`;
}

async function pruefeHinweisFortschritt() {
  if (!api?.istLeiter || status !== "frage_aktiv" || hinweisFortschreibenLaeuft) return;
  const frage = frageAn(index);
  if (!frage) return;
  if (hinweisIndex >= frage.hinweise.length) return;
  if (Date.now() - hinweisSeit < HINWEIS_DAUER_MS) return;

  hinweisFortschreibenLaeuft = true;
  try {
    await updateDoc(api.raumRef(), { wwHinweisIndex: increment(1), wwHinweisSeit: Date.now() });
  } catch (e) {
    zeigeDebug("Fehler beim Aufdecken des nächsten Hinweises: " + e.message);
  }
  hinweisFortschreibenLaeuft = false;
}

// v173: Wird nur vom Spielleiter-Client ausgewertet (analog zu
// pruefeHinweisFortschritt), damit die Zeitstrafe nicht mehrfach vergeben
// wird. Laeuft die Antwortzeit nach dem Buzzern ab, ohne dass eine Antwort
// abgeschickt wurde, zaehlt das genauso wie eine falsche Antwort - inklusive
// des gestaffelten Punktabzugs (1., 2., 3. Fehlversuch derselben Person bei
// derselben Frage).
async function pruefeAntwortZeitAblauf() {
  if (!api?.istLeiter || status !== "gebuzzert" || !gebuzzertVon || antwortZeitAblaufLaeuft) return;
  if (Date.now() - gebuzzertSeit < ANTWORT_ZEIT_MS) return;

  antwortZeitAblaufLaeuft = true;
  try {
    const frage = frageAn(index);
    if (!frage) { antwortZeitAblaufLaeuft = false; return; }
    const spielerId = gebuzzertVon;
    const spielerName = spielerListe.find((s) => s.id === spielerId)?.name ?? "?";
    const naechsterHinweisIndex = Math.min(hinweisIndex + 1, frage.hinweise.length);
    const vorherigeFalscheDerPerson = falscheVersuche.filter((v) => v.spielerId === spielerId).length;
    const abzug = vorherigeFalscheDerPerson + 1;
    const neuesRundenDelta = {
      ...(raum.wwRundenDelta || {}),
      [spielerId]: (raum.wwRundenDelta?.[spielerId] ?? 0) - abzug
    };
    await updateDoc(api.raumRef(), {
      wwStatus: "frage_aktiv", wwAntwortText: "", wwAntwortKorrekt: null, wwPunkteDieserRunde: 0,
      wwGebuzzertVon: null, wwGebuzzertSeit: 0, wwHinweisIndex: naechsterHinweisIndex, wwHinweisSeit: Date.now(),
      wwFalscheVersuche: arrayUnion({ name: spielerName, text: "(keine Antwort)", spielerId, abzug }),
      wwRundenDelta: neuesRundenDelta
    });
    await updateDoc(api.spielerRef(spielerId), { punkte: increment(-abzug) });
  } catch (e) {
    zeigeDebug("Fehler bei Zeitablauf: " + e.message);
  }
  antwortZeitAblaufLaeuft = false;
}

async function buzzern() {
  if (status !== "frage_aktiv") return;
  $("ww-buzzer").disabled = true;
  try {
    await runTransaction(api.db, async (tx) => {
      const snap = await tx.get(api.raumRef());
      const daten = snap.data();
      if (!daten || daten.wwStatus !== "frage_aktiv" || daten.wwGebuzzertVon) {
        throw new Error("__ZU_SPAET__");
      }
      tx.update(api.raumRef(), { wwStatus: "gebuzzert", wwGebuzzertVon: api.spielerId, wwGebuzzertSeit: Date.now() });
    });
  } catch (e) {
    if (e.message !== "__ZU_SPAET__") {
      zeigeDebug("Fehler beim Buzzern: " + e.message);
      $("ww-buzzer").disabled = false;
    }
  }
}

async function antwortAbsenden() {
  if (gebuzzertVon !== api.spielerId) return;
  const text = $("ww-antwort-eingabe").value.trim();
  if (!text) {
    $("ww-antwort-fehler").textContent = "Bitte eine Antwort eingeben.";
    return;
  }
  $("ww-antwort-fehler").textContent = "";
  $("ww-antwort-absenden").disabled = true;
  try {
    const frage = frageAn(index);
    const richtig = istAntwortRichtig(text, frage.jahr);
    if (richtig) {
      // Richtig: Runde ist zu Ende, ganz normal auflösen und Punkte gutschreiben.
      const punkte = Math.max(1, frage.hinweise.length - hinweisIndex + 1);
      const neuesRundenDelta = {
        ...(raum.wwRundenDelta || {}),
        [api.spielerId]: (raum.wwRundenDelta?.[api.spielerId] ?? 0) + punkte
      };
      await updateDoc(api.raumRef(), {
        wwStatus: "aufgeloest", wwAntwortText: text, wwAntwortKorrekt: true, wwPunkteDieserRunde: punkte,
        wwRundenDelta: neuesRundenDelta
      });
      await updateDoc(api.spielerRef(), { punkte: increment(punkte) });
    } else {
      // Falsch: KEIN Rundenende. Gestaffelter Punktabzug für die ratende
      // Person - wie oft hat GENAU DIESE Person bei GENAU DIESER Frage schon
      // falsch getippt? 1. Fehlversuch = -1, 2. = -2, usw. Der genannte Wert
      // bleibt für alle sichtbar in der Fehlversuch-Liste, der Buzzer wird für
      // alle wieder freigegeben und der nächste Hinweis kommt sofort.
      const naechsterHinweisIndex = Math.min(hinweisIndex + 1, frage.hinweise.length);
      const vorherigeFalscheDerPerson = falscheVersuche.filter((v) => v.spielerId === api.spielerId).length;
      const abzug = vorherigeFalscheDerPerson + 1;
      const neuesRundenDelta = {
        ...(raum.wwRundenDelta || {}),
        [api.spielerId]: (raum.wwRundenDelta?.[api.spielerId] ?? 0) - abzug
      };
      $("ww-antwort-eingabe").value = "";
      await updateDoc(api.raumRef(), {
        wwStatus: "frage_aktiv", wwAntwortText: "", wwAntwortKorrekt: null, wwPunkteDieserRunde: 0,
        wwGebuzzertVon: null, wwGebuzzertSeit: 0, wwHinweisIndex: naechsterHinweisIndex, wwHinweisSeit: Date.now(),
        wwFalscheVersuche: arrayUnion({ name: api.spielerName, text, spielerId: api.spielerId, abzug }),
        wwRundenDelta: neuesRundenDelta
      });
      await updateDoc(api.spielerRef(), { punkte: increment(-abzug) });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Absenden der Antwort: " + e.message);
  }
  $("ww-antwort-absenden").disabled = false;
}

async function ueberspringen() {
  if (!api.istLeiter) return;
  try {
    await updateDoc(api.raumRef(), {
      wwStatus: "aufgeloest", wwAntwortText: "", wwAntwortKorrekt: null,
      wwPunkteDieserRunde: 0, wwGebuzzertVon: null, wwGebuzzertSeit: 0
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
  $("ww-erg-jahr").textContent = frage.jahr;

  const raterName = spielerListe.find((s) => s.id === gebuzzertVon)?.name;
  if (!gebuzzertVon) {
    $("ww-erg-status").textContent = "Niemand hat gebuzzert";
  } else if (antwortKorrekt) {
    $("ww-erg-status").textContent = `${raterName ?? "?"} hatte recht! 🎉`;
  } else {
    $("ww-erg-status").textContent = `${raterName ?? "?"} lag daneben ("${antwortText}")`;
  }

  const liste = $("ww-erg-liste");

  if (teammodus) {
    liste.innerHTML = teamGruppeHtml(spielerListe, teams, (s) => {
      return spielerKarte(
        s.name, s.farbe, s.icon,
        formatiertePunkte(raum.wwRundenDelta?.[s.id] ?? 0),
        { punkteRechts: s.punkte ?? 0 }
      );
    });
  } else {
    liste.innerHTML = "";
    [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0)).forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = spielerKarte(
        s.name, s.farbe, s.icon,
        formatiertePunkte(raum.wwRundenDelta?.[s.id] ?? 0),
        { punkteRechts: s.punkte ?? 0 }
      );
      liste.appendChild(li);
    });
  }

  $("ww-weiter").hidden = !api.istLeiter;
  $("ww-weiter").textContent = index + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
}

async function weiter() {
  $("ww-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { wwStatus: "beendet" });
      speichereWertung(api, "wann-war-es", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), {
        wwStatus: "frage_aktiv", wwFragenIndex: naechster,
        wwHinweisIndex: 1, wwHinweisSeit: Date.now(),
        wwGebuzzertVon: null, wwGebuzzertSeit: 0, wwAntwortText: "", wwAntwortKorrekt: null, wwPunkteDieserRunde: 0,
        wwFalscheVersuche: [], wwRundenDelta: {}
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("ww-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("ww-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  const teamsEl = $("ww-endstand-teams");
  teamsEl.hidden = !teammodus;
  if (teammodus) teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("ww-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { istAntwortRichtig, mischeIndizes };
