// ============================================================================
//  10 Treffer!
// ----------------------------------------------------------------------------
//  Eine Person oder ein Team sieht nur den Oberbegriff und nennt passende
//  Assoziationen. Die Gegenseite sieht die zehn gesuchten Treffer und markiert
//  sie live. Alle Felder dieses Spiels im Raum-Dokument beginnen mit "zt".
// ============================================================================
import { updateDoc, runTransaction, serverTimestamp } from "../../kern/firebase.js";
import { escapeHtml, avatarHtml, spielerKarte, zeigeDebug } from "../../kern/ui.js";
import {
  mischeListe, erstelleTeams, bereinigeTreffer, aktiveSpielerId, aktivesTeam
} from "./logik.js";

const TEAMS = {
  blau: { name: "Team Blau", emoji: "🔵" },
  rot: { name: "Team Rot", emoji: "🔴" }
};

const RUNDEN_DAUER_SEKUNDEN = 40;

const VORLAGE = `
  <div id="zt-setup" class="bildschirm-karte" hidden>
    <h1>💥 10 Treffer!</h1>
    <p class="hinweis-text">Ein Begriff wird angezeigt. Findet die zehn Antworten, die wir suchen.</p>
    <p class="zt-regel">Eine Person oder ein Team rät. Alle anderen sehen die Trefferliste und
      tippen einen Begriff an, sobald er genannt wurde. Jeder Treffer gibt einen Punkt.</p>

    <p id="zt-teammodus-zeile">
      <label class="schalter-zeile">
        <span class="schalter">
          <input type="checkbox" id="zt-teammodus">
          <span class="schalter-regler"></span>
        </span>
        <span class="schalter-text">Teammodus</span>
      </label>
      <span class="schalter-hinweis">Zwei automatisch ausgeglichene Teams treten abwechselnd an.</span>
    </p>

    <div id="zt-teams" hidden>
      <div class="zt-team-grid">
        <section class="zt-team zt-team-blau">
          <h3>🔵 Team Blau</h3>
          <ul id="zt-team-blau"></ul>
        </section>
        <section class="zt-team zt-team-rot">
          <h3>🔴 Team Rot</h3>
          <ul id="zt-team-rot"></ul>
        </section>
      </div>
      <p><button id="zt-teams-mischen" class="btn-flach" hidden>Teams neu mischen</button></p>
    </div>

    <p id="zt-anzahl-zeile" hidden>
      <label>Anzahl Begriffe:
        <input id="zt-anzahl" type="number" inputmode="numeric" min="1" style="width:78px;">
      </label><br>
      <span id="zt-anzahl-hinweis" class="hinweis-text"></span>
    </p>

    <p id="zt-setup-fehler" class="fehler-text"></p>
    <p><button id="zt-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="zt-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <p><button id="zt-abbrechen" class="btn-flach" hidden>Zurück zur Spielauswahl</button></p>
  </div>

  <div id="zt-runde" class="bildschirm-karte" hidden>
    <p class="kategorie">10 Treffer!</p>
    <p class="fortschritt" id="zt-fortschritt"></p>
    <h1 id="zt-begriff" class="zt-begriff"></h1>
    <p id="zt-aktive-einheit" class="zt-aktive-einheit"></p>
    <div id="zt-timer" class="zt-timer" role="timer" aria-label="40 Sekunden verbleiben">
      <strong id="zt-timer-zahl">40</strong>
      <span>Sekunden</span>
    </div>

    <div id="zt-rater-ansicht" class="zt-rater-ansicht" hidden>
      <div class="zt-treffer-zaehler"><strong id="zt-rater-anzahl">0</strong><span>von 10</span></div>
      <p>Nennt möglichst viele Begriffe, Namen oder Dinge, die dazu passen.</p>
      <p class="hinweis-text">Die andere Seite markiert eure Treffer.</p>
    </div>

    <div id="zt-jury-ansicht" hidden>
      <p class="hinweis-text">Tippe einen Treffer an, sobald er gesagt wurde. Ein zweiter Tipp macht ihn wieder rückgängig.</p>
      <div id="zt-treffer-grid" class="zt-treffer-grid"></div>
    </div>

    <p id="zt-zuschauer-hinweis" class="zt-regel" hidden></p>
    <p id="zt-runden-status" class="zt-runden-status"></p>
    <p><button id="zt-runde-beenden" class="btn-flach" hidden>Runde beenden</button></p>
  </div>

  <div id="zt-auswertung" class="bildschirm-karte" hidden>
    <p class="kategorie">10 Treffer!</p>
    <p class="fortschritt" id="zt-auswertung-fortschritt"></p>
    <h1 id="zt-auswertung-begriff" class="zt-begriff"></h1>
    <p id="zt-runden-ergebnis" class="zt-runden-ergebnis"></p>
    <div id="zt-auswertung-grid" class="zt-treffer-grid"></div>
    <div id="zt-zwischenstand"></div>
    <p><button id="zt-weiter" hidden>Nächste Runde</button></p>
  </div>

  <div id="zt-endstand" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="zt-endstand-inhalt"></div>
    <p><button id="zt-nochmal" class="btn-primaer" hidden>Zurück zur Spielauswahl</button></p>
    <p id="zt-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

let api = null;
let el = {};
let karten = [];
let spielerListe = [];
let raum = {};
let status = null;
let teammodus = false;
let teams = {};
let reihenfolge = [];
let spielerReihenfolge = [];
let startTeam = "blau";
let rundenIndex = 0;
let anzahlRunden = 0;
let aktiveId = null;
let aktivesTeamId = null;
let getroffen = [];
let punkte = {};
let teamPunkte = { blau: 0, rot: 0 };
let rundenpunkte = 0;
let rundeBeendenLaeuft = false;
let weiterLaeuft = false;
let anzahlManuellGesetzt = false;
let rundenStartMs = null;
let timerIntervall = null;
let timerRundenSchluessel = null;
let letzterSignalton = null;
let audioKontext = null;
let audioFreischaltListener = null;

const $ = (id) => el.wurzel.querySelector("#" + id);

function karteAn(pos) {
  return karten[reihenfolge[pos]];
}

function spielerNachId(id) {
  return spielerListe.find((spieler) => spieler.id === id) ?? null;
}

function teamInfo(id) {
  return TEAMS[id] ?? { name: "Unbekanntes Team", emoji: "" };
}

function normalisiereTeam(team) {
  return team === "orange" ? "rot" : team;
}

function normalisiereTeams(werte) {
  return Object.fromEntries(
    Object.entries(werte || {}).map(([spielerId, team]) => [spielerId, normalisiereTeam(team)])
  );
}

function normalisiereTeamPunkte(werte) {
  return {
    blau: werte?.blau ?? 0,
    rot: werte?.rot ?? werte?.orange ?? 0
  };
}

function zeitpunktInMillis(wert) {
  if (Number.isFinite(wert)) return wert;
  if (typeof wert?.toMillis === "function") return wert.toMillis();
  if (Number.isFinite(wert?.seconds)) {
    return wert.seconds * 1000 + Math.floor((wert.nanoseconds ?? 0) / 1e6);
  }
  return null;
}

function audioAktivieren() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    if (!audioKontext) audioKontext = new AudioContext();
    if (audioKontext.state === "suspended") audioKontext.resume().catch(() => {});
  } catch { /* Der visuelle Countdown bleibt als Rückfall aktiv. */ }
}

function spieleSignalton(restsekunden) {
  audioAktivieren();
  if (!audioKontext || audioKontext.state !== "running") return;
  try {
    const jetzt = audioKontext.currentTime;
    const oscillator = audioKontext.createOscillator();
    const lautstaerke = audioKontext.createGain();
    const istSchlusston = restsekunden === 0;
    oscillator.type = istSchlusston ? "square" : "sine";
    oscillator.frequency.setValueAtTime(istSchlusston ? 420 : 880, jetzt);
    if (istSchlusston) oscillator.frequency.exponentialRampToValueAtTime(180, jetzt + 0.48);
    lautstaerke.gain.setValueAtTime(0.0001, jetzt);
    lautstaerke.gain.exponentialRampToValueAtTime(0.18, jetzt + 0.02);
    lautstaerke.gain.exponentialRampToValueAtTime(0.0001, jetzt + (istSchlusston ? 0.52 : 0.13));
    oscillator.connect(lautstaerke);
    lautstaerke.connect(audioKontext.destination);
    oscillator.start(jetzt);
    oscillator.stop(jetzt + (istSchlusston ? 0.54 : 0.15));
  } catch { /* Der visuelle Countdown bleibt als Rückfall aktiv. */ }
}

function verbleibendeSekunden() {
  if (!rundenStartMs) return RUNDEN_DAUER_SEKUNDEN;
  const ende = rundenStartMs + RUNDEN_DAUER_SEKUNDEN * 1000;
  return Math.max(0, Math.ceil((ende - Date.now()) / 1000));
}

function aktualisiereTimer() {
  if (!el.wurzel || status !== "runde") return;
  const timer = $("zt-timer");
  const anzeige = $("zt-timer-zahl");
  const rundenKarte = $("zt-runde");
  if (!timer || !anzeige || !rundenKarte) return;

  const restsekunden = verbleibendeSekunden();
  anzeige.textContent = restsekunden;
  timer.setAttribute("aria-label", `${restsekunden} Sekunden verbleiben`);
  timer.classList.toggle("warnung", restsekunden > 0 && restsekunden <= 5);
  timer.classList.toggle("abgelaufen", restsekunden === 0);
  rundenKarte.classList.toggle("zt-countdown-warnung", restsekunden <= 5);

  if (restsekunden <= 5 && restsekunden !== letzterSignalton) {
    letzterSignalton = restsekunden;
    spieleSignalton(restsekunden);
    if (restsekunden > 0) navigator.vibrate?.(55);
  }

  if (restsekunden === 0) {
    el.wurzel.querySelectorAll("#zt-treffer-grid .zt-treffer")
      .forEach((knopf) => { knopf.disabled = true; });
    if (api.istLeiter) rundeBeenden();
  }
}

function starteRundenTimer() {
  const schluessel = `${rundenIndex}:${rundenStartMs ?? "wartet"}`;
  if (timerRundenSchluessel !== schluessel) {
    timerRundenSchluessel = schluessel;
    letzterSignalton = null;
  }
  if (!timerIntervall) timerIntervall = window.setInterval(aktualisiereTimer, 100);
  aktualisiereTimer();
}

function stoppeRundenTimer() {
  if (timerIntervall) window.clearInterval(timerIntervall);
  timerIntervall = null;
  $("zt-runde")?.classList.remove("zt-countdown-warnung");
}

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  if (karten.length === 0) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url));
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    karten = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.ztStatus) {
    await updateDoc(api.raumRef(), {
      ztStatus: "setup", ztTeammodus: false, ztTeams: {},
      ztReihenfolge: [], ztSpielerReihenfolge: [], ztStartTeam: "blau",
      ztRundenIndex: 0, ztAnzahlRunden: 0, ztAktiveId: null, ztAktivesTeam: null,
      ztGetroffen: [], ztPunkte: {}, ztTeamPunkte: { blau: 0, rot: 0 },
      ztRundenpunkte: 0, ztRundenStart: null
    });
  }
}

function verdrahteBedienelemente() {
  audioFreischaltListener = audioAktivieren;
  el.wurzel.addEventListener("pointerdown", audioFreischaltListener);
  $("zt-teammodus").addEventListener("change", teammodusUmschalten);
  $("zt-teams-mischen").addEventListener("click", teamsNeuMischen);
  $("zt-anzahl").addEventListener("input", () => { anzahlManuellGesetzt = true; });
  $("zt-starten").addEventListener("click", spielStarten);
  $("zt-abbrechen").addEventListener("click", zurueck);
  $("zt-nochmal").addEventListener("click", zurueck);
  $("zt-runde-beenden").addEventListener("click", rundeBeenden);
  $("zt-weiter").addEventListener("click", weiter);
}

export function beenden() {
  stoppeRundenTimer();
  if (audioFreischaltListener && el.wurzel) {
    el.wurzel.removeEventListener("pointerdown", audioFreischaltListener);
  }
  audioFreischaltListener = null;
  audioKontext?.close?.().catch(() => {});
  audioKontext = null;
  el = {};
  karten = [];
  spielerListe = [];
  raum = {};
  status = null;
  teammodus = false;
  teams = {};
  reihenfolge = [];
  spielerReihenfolge = [];
  startTeam = "blau";
  rundenIndex = 0;
  anzahlRunden = 0;
  aktiveId = null;
  aktivesTeamId = null;
  getroffen = [];
  punkte = {};
  teamPunkte = { blau: 0, rot: 0 };
  rundenpunkte = 0;
  rundeBeendenLaeuft = false;
  weiterLaeuft = false;
  anzahlManuellGesetzt = false;
  rundenStartMs = null;
  timerRundenSchluessel = null;
  letzterSignalton = null;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  renderAktuellenStatus();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  raum = daten;
  status = daten.ztStatus ?? null;
  teammodus = !!daten.ztTeammodus;
  teams = normalisiereTeams(daten.ztTeams);
  reihenfolge = daten.ztReihenfolge ?? [];
  spielerReihenfolge = daten.ztSpielerReihenfolge ?? [];
  startTeam = normalisiereTeam(daten.ztStartTeam) ?? "blau";
  rundenIndex = daten.ztRundenIndex ?? 0;
  anzahlRunden = daten.ztAnzahlRunden ?? 0;
  aktiveId = daten.ztAktiveId ?? null;
  aktivesTeamId = normalisiereTeam(daten.ztAktivesTeam) ?? null;
  getroffen = bereinigeTreffer(daten.ztGetroffen, 10);
  punkte = daten.ztPunkte ?? {};
  teamPunkte = normalisiereTeamPunkte(daten.ztTeamPunkte);
  rundenpunkte = daten.ztRundenpunkte ?? 0;
  rundenStartMs = zeitpunktInMillis(daten.ztRundenStart);

  renderAktuellenStatus();

  if (api.istLeiter && status === "runde" && getroffen.length === 10) {
    rundeBeenden();
  }
}

function renderAktuellenStatus() {
  if (!el.wurzel) return;
  if (status !== "runde") stoppeRundenTimer();
  ["zt-setup", "zt-runde", "zt-auswertung", "zt-endstand"]
    .forEach((id) => { $(id).hidden = true; });

  if (status === "setup" || !status) {
    zeigeSetup();
    $("zt-setup").hidden = false;
  } else if (status === "runde") {
    zeigeRunde();
    $("zt-runde").hidden = false;
  } else if (status === "auswertung") {
    zeigeAuswertung();
    $("zt-auswertung").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("zt-endstand").hidden = false;
  }
}

function aktuelleTeamsVollstaendig() {
  if (spielerListe.length < 2) return false;
  const ids = new Set(spielerListe.map((spieler) => spieler.id));
  const eingeteilt = Object.entries(teams)
    .filter(([id, team]) => ids.has(id) && (team === "blau" || team === "rot"));
  return eingeteilt.length === spielerListe.length &&
    eingeteilt.some(([, team]) => team === "blau") &&
    eingeteilt.some(([, team]) => team === "rot");
}

async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("zt-teammodus").checked;
  const neueTeams = aktiviert
    ? erstelleTeams(spielerListe.map((spieler) => spieler.id))
    : {};
  try {
    await updateDoc(api.raumRef(), { ztTeammodus: aktiviert, ztTeams: neueTeams });
  } catch (e) {
    $("zt-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function teamsNeuMischen() {
  if (!api.istLeiter || !teammodus) return;
  $("zt-teams-mischen").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      ztTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("zt-teams-mischen").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("zt-team-" + team);
  liste.innerHTML = "";
  spielerListe.filter((spieler) => teams[spieler.id] === team).forEach((spieler) => {
    const li = document.createElement("li");
    li.textContent = spieler.name;
    liste.appendChild(li);
  });
  if (!liste.children.length) {
    const li = document.createElement("li");
    li.textContent = "Noch niemand";
    liste.appendChild(li);
  }
}

function zeigeSetup() {
  const teamSchalter = $("zt-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("zt-teams").hidden = !teammodus;
  $("zt-teams-mischen").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }

  const anzahlFeld = $("zt-anzahl");
  anzahlFeld.max = karten.length;
  if (!anzahlManuellGesetzt || !anzahlFeld.value) anzahlFeld.value = karten.length;
  $("zt-anzahl-hinweis").textContent = `${karten.length} Begriffe stehen zur Verfügung.`;
  $("zt-anzahl-zeile").hidden = !api.istLeiter;
  $("zt-starten").hidden = !api.istLeiter;
  $("zt-abbrechen").hidden = !api.istLeiter;
  $("zt-setup-warten").hidden = api.istLeiter;
}

async function spielStarten() {
  $("zt-setup-fehler").textContent = "";
  if (spielerListe.length < 2) {
    $("zt-setup-fehler").textContent = "Für 10 Treffer! braucht ihr mindestens zwei Spieler.";
    return;
  }

  let anzahl = parseInt($("zt-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > karten.length) anzahl = karten.length;

  const neueTeams = teammodus && !aktuelleTeamsVollstaendig()
    ? erstelleTeams(spielerListe.map((spieler) => spieler.id))
    : teams;
  const neueSpielerReihenfolge = mischeListe(spielerListe.map((spieler) => spieler.id));
  const neuerStart = Math.random() < 0.5 ? "blau" : "rot";
  const ersteAktiveId = teammodus ? null : neueSpielerReihenfolge[0];
  const erstesAktivesTeam = teammodus ? aktivesTeam(
    neuerStart, 0, neueTeams, spielerListe.map((spieler) => spieler.id)
  ) : null;

  $("zt-starten").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      ztStatus: "runde",
      ztTeammodus: teammodus,
      ztTeams: neueTeams,
      ztReihenfolge: mischeListe(karten.map((_, index) => index)).slice(0, anzahl),
      ztSpielerReihenfolge: neueSpielerReihenfolge,
      ztStartTeam: neuerStart,
      ztRundenIndex: 0,
      ztAnzahlRunden: anzahl,
      ztAktiveId: ersteAktiveId,
      ztAktivesTeam: erstesAktivesTeam,
      ztGetroffen: [],
      ztPunkte: Object.fromEntries(spielerListe.map((spieler) => [spieler.id, 0])),
      ztTeamPunkte: { blau: 0, rot: 0 },
      ztRundenpunkte: 0,
      ztRundenStart: serverTimestamp()
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
    $("zt-starten").disabled = false;
  }
}

function eigeneRolle() {
  if (teammodus) {
    const eigenesTeam = teams[api.spielerId] ?? null;
    if (!eigenesTeam) return "zuschauer";
    return eigenesTeam === aktivesTeamId ? "rater" : "jury";
  }
  return api.spielerId === aktiveId ? "rater" : "jury";
}

function aktiveEinheitText() {
  if (teammodus) {
    const info = teamInfo(aktivesTeamId);
    return `${info.emoji} ${info.name} rät`;
  }
  return `${spielerNachId(aktiveId)?.name ?? "Ein Spieler"} rät`;
}

function rendereTreffer(container, klickbar) {
  const karte = karteAn(rundenIndex);
  container.innerHTML = "";
  if (!karte) return;
  const markiert = new Set(getroffen);

  karte.treffer.forEach((treffer, trefferIndex) => {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.className = "zt-treffer" + (markiert.has(trefferIndex) ? " getroffen" : "");
    knopf.disabled = !klickbar;
    knopf.setAttribute("aria-pressed", markiert.has(trefferIndex) ? "true" : "false");
    knopf.innerHTML = `<span class="zt-haken">${markiert.has(trefferIndex) ? "✓" : ""}</span>` +
      `<span>${escapeHtml(treffer)}</span>`;
    if (klickbar) {
      knopf.addEventListener("click", () =>
        setzeTreffer(trefferIndex, !markiert.has(trefferIndex))
      );
    }
    container.appendChild(knopf);
  });
}

function zeigeRunde() {
  const karte = karteAn(rundenIndex);
  if (!karte) return;
  const rolle = eigeneRolle();
  $("zt-fortschritt").textContent = `Begriff ${rundenIndex + 1} von ${anzahlRunden}`;
  $("zt-begriff").textContent = karte.begriff;
  $("zt-aktive-einheit").textContent = aktiveEinheitText();
  $("zt-rater-ansicht").hidden = rolle !== "rater";
  $("zt-jury-ansicht").hidden = rolle !== "jury";
  $("zt-zuschauer-hinweis").hidden = rolle !== "zuschauer";
  $("zt-zuschauer-hinweis").textContent = rolle === "zuschauer"
    ? "Du bist nach dem Spielstart beigetreten und kannst diese Runde nur zuschauen."
    : "";
  $("zt-rater-anzahl").textContent = getroffen.length;
  $("zt-runden-status").textContent = `${getroffen.length} von 10 Treffern`;
  $("zt-runde-beenden").hidden = !api.istLeiter;
  rendereTreffer($("zt-treffer-grid"), rolle === "jury");
  starteRundenTimer();
}

async function setzeTreffer(trefferIndex, sollGetroffenSein) {
  if (status !== "runde" || eigeneRolle() !== "jury" || verbleibendeSekunden() === 0) return;
  try {
    await runTransaction(api.db, async (transaktion) => {
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.ztStatus !== "runde" || (daten.ztRundenIndex ?? 0) !== rundenIndex) return;
      const startMs = zeitpunktInMillis(daten.ztRundenStart);
      if (startMs && Date.now() >= startMs + RUNDEN_DAUER_SEKUNDEN * 1000) return;
      const aktuelle = bereinigeTreffer(daten.ztGetroffen, 10);
      const bereitsDabei = aktuelle.includes(trefferIndex);
      if (sollGetroffenSein === bereitsDabei) return;
      const neueTreffer = sollGetroffenSein
        ? bereinigeTreffer([...aktuelle, trefferIndex], 10)
        : aktuelle.filter((index) => index !== trefferIndex);
      transaktion.update(ref, { ztGetroffen: neueTreffer });
    });
  } catch (e) {
    zeigeDebug("Treffer konnte nicht gespeichert werden: " + e.message);
  }
}

async function rundeBeenden() {
  if (!api.istLeiter || status !== "runde" || rundeBeendenLaeuft) return;
  rundeBeendenLaeuft = true;
  $("zt-runde-beenden").disabled = true;
  try {
    await runTransaction(api.db, async (transaktion) => {
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.ztStatus !== "runde" || (daten.ztRundenIndex ?? 0) !== rundenIndex) return;

      const anzahlTreffer = bereinigeTreffer(daten.ztGetroffen, 10).length;
      const neuePunkte = { ...(daten.ztPunkte ?? {}) };
      const neueTeamPunkte = normalisiereTeamPunkte(daten.ztTeamPunkte);
      if (daten.ztTeammodus) {
        const team = normalisiereTeam(daten.ztAktivesTeam);
        if (team === "blau" || team === "rot") {
          neueTeamPunkte[team] = (neueTeamPunkte[team] ?? 0) + anzahlTreffer;
        }
      } else if (daten.ztAktiveId) {
        neuePunkte[daten.ztAktiveId] = (neuePunkte[daten.ztAktiveId] ?? 0) + anzahlTreffer;
      }

      transaktion.update(ref, {
        ztStatus: "auswertung",
        ztRundenpunkte: anzahlTreffer,
        ztPunkte: neuePunkte,
        ztTeamPunkte: neueTeamPunkte,
        ztRundenStart: null
      });
    });
  } catch (e) {
    zeigeDebug("Runde konnte nicht beendet werden: " + e.message);
  }
  rundeBeendenLaeuft = false;
  if ($("zt-runde-beenden")) $("zt-runde-beenden").disabled = false;
}

function formatiertePunkte(wert) {
  const punktewert = Number(wert) || 0;
  return punktewert > 0 ? `+${punktewert}` : `${punktewert}`;
}

function zwischenstandHtml(mitRundenpunkten = true) {
  if (teammodus) {
    return `<div class="zt-punkte-grid">` +
      Object.keys(TEAMS).map((team) => {
        const mitglieder = spielerListe.filter((spieler) => teams[spieler.id] === team);
        const hinzugekommen = mitRundenpunkten && team === aktivesTeamId ? rundenpunkte : 0;
        return (
        `<div class="zt-punkte-team zt-team-${team}">` +
          `<strong class="zt-team-rundenpunkte">${formatiertePunkte(hinzugekommen)}</strong>` +
          `<div class="zt-punkte-team-info">` +
            `<span>${TEAMS[team].emoji} ${TEAMS[team].name}</span>` +
            `<div class="zt-team-avatare">${mitglieder.map((spieler) => avatarHtml(spieler.icon, "zt-team-avatar")).join("")}</div>` +
          `</div>` +
          `<strong class="zt-team-gesamtpunkte">${teamPunkte[team] ?? 0}</strong>` +
        `</div>`
        );
      }).join("") +
    `</div>`;
  }

  const sortiert = [...spielerListe].sort((a, b) =>
    (punkte[b.id] ?? 0) - (punkte[a.id] ?? 0)
  );
  return `<ul class="zt-punkteliste">` + sortiert.map((spieler, index) => {
    const gesamt = punkte[spieler.id] ?? 0;
    if (!mitRundenpunkten) {
      return `<li>${spielerKarte(spieler.name, spieler.farbe, spieler.icon, gesamt, { rang: index + 1 })}</li>`;
    }
    const hinzugekommen = spieler.id === aktiveId ? rundenpunkte : 0;
    return `<li>${spielerKarte(
      spieler.name, spieler.farbe, spieler.icon,
      formatiertePunkte(hinzugekommen),
      { punkteRechts: gesamt }
    )}</li>`;
  }).join("") + `</ul>`;
}

function zeigeAuswertung() {
  const karte = karteAn(rundenIndex);
  if (!karte) return;
  $("zt-auswertung-fortschritt").textContent = `Begriff ${rundenIndex + 1} von ${anzahlRunden}`;
  $("zt-auswertung-begriff").textContent = karte.begriff;
  $("zt-runden-ergebnis").textContent = `${aktiveEinheitText()}: ${rundenpunkte} von 10 Treffern`;
  rendereTreffer($("zt-auswertung-grid"), false);
  $("zt-zwischenstand").innerHTML = `<h3>Zwischenstand</h3>${zwischenstandHtml()}`;
  $("zt-weiter").hidden = !api.istLeiter;
  $("zt-weiter").disabled = weiterLaeuft;
  $("zt-weiter").textContent = rundenIndex + 1 >= anzahlRunden ? "Endstand anzeigen" : "Nächste Runde";
}

async function weiter() {
  if (!api.istLeiter || status !== "auswertung" || weiterLaeuft) return;
  weiterLaeuft = true;
  $("zt-weiter").disabled = true;
  const naechsterIndex = rundenIndex + 1;
  let erfolgreich = false;
  try {
    if (naechsterIndex >= anzahlRunden) {
      await updateDoc(api.raumRef(), { ztStatus: "beendet" });
    } else {
      const ids = spielerListe.map((spieler) => spieler.id);
      await updateDoc(api.raumRef(), {
        ztStatus: "runde",
        ztRundenIndex: naechsterIndex,
        ztAktiveId: teammodus
          ? null
          : aktiveSpielerId(spielerReihenfolge, naechsterIndex, ids),
        ztAktivesTeam: teammodus
          ? aktivesTeam(startTeam, naechsterIndex, teams, ids)
          : null,
        ztGetroffen: [],
        ztRundenpunkte: 0,
        ztRundenStart: serverTimestamp()
      });
    }
    erfolgreich = true;
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  weiterLaeuft = false;
  if (!erfolgreich && $("zt-weiter")) $("zt-weiter").disabled = false;
}

function teamEndstandHtml() {
  const sortiert = Object.keys(TEAMS).sort((a, b) =>
    (teamPunkte[b] ?? 0) - (teamPunkte[a] ?? 0)
  );
  const gleichstand = (teamPunkte.blau ?? 0) === (teamPunkte.rot ?? 0);
  return `<div class="zt-team-endstand">` + sortiert.map((team, index) => {
    const mitglieder = spielerListe.filter((spieler) => teams[spieler.id] === team);
    return `<section class="zt-team zt-team-${team} ${!gleichstand && index === 0 ? "gewinner" : ""}">` +
      `<h2>${!gleichstand && index === 0 ? "🏆 " : ""}${TEAMS[team].emoji} ${TEAMS[team].name}</h2>` +
      `<strong class="zt-team-punkte">${teamPunkte[team] ?? 0}</strong>` +
      `<p>${mitglieder.map((spieler) => escapeHtml(spieler.name)).join(", ")}</p>` +
    `</section>`;
  }).join("") + `</div>`;
}

function zeigeEndstand() {
  $("zt-endstand-inhalt").innerHTML = teammodus
    ? teamEndstandHtml()
    : zwischenstandHtml(false);
  $("zt-nochmal").hidden = !api.istLeiter;
  $("zt-endstand-warten").hidden = api.istLeiter;
}

async function zurueck() {
  const knopf = status === "beendet" ? $("zt-nochmal") : $("zt-abbrechen");
  knopf.disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      ztStatus: null, ztTeammodus: false, ztTeams: {}, ztReihenfolge: [],
      ztSpielerReihenfolge: [], ztRundenIndex: 0, ztAnzahlRunden: 0,
      ztAktiveId: null, ztAktivesTeam: null, ztGetroffen: [],
      ztPunkte: {}, ztTeamPunkte: { blau: 0, rot: 0 }, ztRundenpunkte: 0,
      ztRundenStart: null
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
    knopf.disabled = false;
  }
}
