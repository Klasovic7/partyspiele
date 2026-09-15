// ============================================================================
//  Blitzquiz
// ----------------------------------------------------------------------------
//  Drei verschiedene Frage-Mechaniken, gemischt in einer Runde (jede Frage
//  trägt in fragen.json ein Feld "typ"):
//
//    "mc"    - Mehrfachauswahl: 4 Antworten, JEDER der richtig liegt bekommt
//              1 Punkt. Keine Zeitkomponente.
//    "speed" - Mehrfachauswahl auf Schnelligkeit: unter allen RICHTIGEN
//              Antworten bekommt die schnellste so viele Punkte wie Mitspieler
//              mitspielen, die zweitschnellste einen weniger, usw. Falsche
//              Antworten bekommen 0 Punkte und zählen nicht mit (auch nicht
//              als "vor mir, aber falsch"). Die Zeit wird mit 2 Nachkomma-
//              stellen angezeigt.
//    "wort"  - Buchstaben-Rätsel: für jeden Buchstaben der Lösung ein leeres
//              Kästchen. Alle 10 Sekunden wird - für alle gleich, aber in
//              zufälliger Reihenfolge - ein weiterer Buchstabe aufgedeckt,
//              bis auf den letzten (der bleibt immer verdeckt). Punktevergabe
//              wie bei "speed": schnellste korrekte Lösung bekommt die
//              meisten Punkte.
//
//  Alle Felder dieses Spiels im Raum-Dokument beginnen mit "bz". Antworten
//  liegen (wie bei Schätzfragen) in einer eigenen Unter-Sammlung
//  "raeume/{code}/bzantworten", damit der Spielleiter live sieht, wer schon
//  geantwortet hat, ohne dass alle Geräte gleichzeitig ins Raum-Dokument
//  schreiben müssen. Bei "wort" landet dort NUR eine bereits richtige Lösung -
//  falsche Versuche bleiben rein lokal (kein Rundenende, einfach nochmal).
//
//  Wie bei den anderen Spielen meldet sich dieses Modul über
//  starten/raumDaten/spieler/beenden zurück (siehe schaetzfragen/spiel.js).
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment
} from "../../kern/firebase.js";
import { escapeHtml, textMitZusatz, spielerKarte, teamEndstandHtml, teamGruppeHtml, zeigeDebug } from "../../kern/ui.js";
import { erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";

const AUFDECK_DAUER_MS = 10000;
const STANDARD_ANZAHL = 10;

const TYP_LABEL = { mc: "Mehrfachauswahl", speed: "Schnelligkeit", wort: "Wortrate" };

const VORLAGE = `
  <div id="bz-setup" class="bildschirm-karte" hidden>
    <h1>⚡ Blitzquiz</h1>
    <p class="hinweis-text">Drei Frage-Typen im Wechsel: normale Mehrfachauswahl,
      Mehrfachauswahl auf Schnelligkeit und ein Buchstaben-Rätsel. Bei den
      schnelligkeitsbasierten Fragen bekommt die schnellste richtige Antwort
      die meisten Punkte.</p>

    <div id="bz-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Fragen</span>
        <span class="anzahl-picker">
          <input id="bz-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="10" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="bz-teammodus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Teammodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Teammodus">i</summary>
            <div>Jeder entscheidet sich für ein Team und beantwortet weiterhin selbst - die Punkte bekommt bzw. verliert immer nur die einzelne Person, zusätzlich seht ihr die Summe pro Team.</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="bz-teammodus">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="bz-teams" hidden>
      <div class="zt-team-grid">
        <button type="button" id="bz-team-wahl-blau" class="zt-team zt-team-blau zt-team-waehlbar">
          <h3>🔵 Team Blau</h3>
          <ul id="bz-team-blau"></ul>
        </button>
        <button type="button" id="bz-team-wahl-rot" class="zt-team zt-team-rot zt-team-waehlbar">
          <h3>🔴 Team Rot</h3>
          <ul id="bz-team-rot"></ul>
        </button>
      </div>
      <p><button id="bz-teams-zufall" class="btn-flach" hidden>Zufällige Teams</button></p>
    </div>

    <p id="bz-setup-fehler" class="fehler-text"></p>
    <p><button id="bz-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="bz-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="bz-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="bz-frage-typ"></p>
    <h2 id="bz-frage-text"></h2>

    <div id="bz-mc-bereich" hidden>
      <div id="bz-mc-grid" class="bz-antwort-grid"></div>
    </div>

    <div id="bz-wort-bereich" hidden>
      <div id="bz-buchstaben-reihe" class="bz-buchstaben-reihe"></div>
      <p class="bz-countdown" id="bz-countdown"></p>
      <p class="bz-antwort-zeile">
        <input id="bz-wort-eingabe" type="text" placeholder="Deine Lösung" autocomplete="off">
        <button id="bz-wort-absenden">Absenden</button>
      </p>
      <p id="bz-wort-fehler" class="fehler-text"></p>
      <p id="bz-wort-status-eigenes" class="hinweis-text" hidden>✅ Du hast es gelöst - warte auf die anderen.</p>
    </div>

    <p id="bz-frage-status" class="hinweis-text"></p>
    <p><button id="bz-ueberspringen" class="btn-flach" hidden>Runde jetzt auswerten</button></p>
  </div>

  <div id="bz-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="bz-erg-typ"></p>
    <h2 id="bz-erg-frage"></h2>
    <p id="bz-erg-antwort-zeile">Richtige Antwort: <strong id="bz-erg-antwort"></strong></p>
    <div id="bz-erg-liste"></div>
    <p><button id="bz-weiter" hidden>Weiter</button></p>
  </div>

  <div id="bz-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="bz-endstand-teams" hidden></div>
    <ul id="bz-endstand-liste"></ul>
    <p id="bz-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

// ---------- Modulzustand ----------
let api = null;
let fragen = [];
let el = {};
let raum = {};
let spielerListe = [];
let alleAntworten = [];
let antwortenUnsub = null;

let index = -1;
let reihenfolge = [];
// Nur für Fragen vom Typ "wort" befüllt: parallel zu "reihenfolge" eine
// Permutation der (nur Buchstaben-)Indizes der Lösung, in Aufdeck-Reihenfolge.
let buchstabenReihenfolgen = [];
let anzahlFragen = 0;
let status = null;
let frageSeit = 0;
let aufdeckAnzahl = 0;
let gewuenschteAnzahl = 0;
let teammodus = false;
let teams = {};
let ausgewertetAusgeloest = false;
let aufdeckFortschreibenLaeuft = false;
let timerId = null;

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

// Nur echte Buchstaben (inkl. Umlaute) gelten als "aufdeckbar" - Leerzeichen,
// Bindestriche o. Ä. werden immer direkt angezeigt.
function istBuchstabe(zeichen) {
  return /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(zeichen);
}

function buchstabenIndizes(loesung) {
  const indizes = [];
  for (let i = 0; i < loesung.length; i++) {
    if (istBuchstabe(loesung[i])) indizes.push(i);
  }
  return indizes;
}

function normalisiere(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function formatiertePunkte(p) {
  return p > 0 ? `+${p}` : `${p}`;
}

function eigeneAntwort(pos) {
  return alleAntworten.find((a) => a.spielerId === api.spielerId && a.fragenIndex === pos);
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
  starteListener();

  if (api.istLeiter && !api.raum?.bzStatus) {
    await setzeGrundzustand("setup");
  }

  timerId = setInterval(() => { aktualisiereCountdown(); pruefeAufdeckFortschritt(); }, 300);
}

function verdrahteBedienelemente() {
  $("bz-anzahl").addEventListener("input", () => {
    const feld = $("bz-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("bz-anzahl").addEventListener("change", () => anzahlUebernehmen());
  $("bz-anzahl").addEventListener("focus", () => { $("bz-anzahl").select(); });
  $("bz-teammodus").addEventListener("change", teammodusUmschalten);
  $("bz-team-wahl-blau").addEventListener("click", () => waehleEigenesTeam("blau"));
  $("bz-team-wahl-rot").addEventListener("click", () => waehleEigenesTeam("rot"));
  $("bz-teams-zufall").addEventListener("click", zufaelligeTeams);
  $("bz-starten").addEventListener("click", spielStarten);
  $("bz-wort-absenden").addEventListener("click", wortAbsenden);
  $("bz-wort-eingabe").addEventListener("keydown", (e) => { if (e.key === "Enter") wortAbsenden(); });
  $("bz-ueberspringen").addEventListener("click", ueberspringen);
  $("bz-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "bzantworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereAntworten();
  });
}

export function beenden() {
  if (timerId) { clearInterval(timerId); timerId = null; }
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  el = {}; raum = {}; spielerListe = []; alleAntworten = [];
  index = -1; reihenfolge = []; buchstabenReihenfolgen = []; anzahlFragen = 0; status = null;
  frageSeit = 0; aufdeckAnzahl = 0; gewuenschteAnzahl = 0;
  teammodus = false; teams = {};
  ausgewertetAusgeloest = false; aufdeckFortschreibenLaeuft = false;
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
  status = daten.bzStatus ?? null;
  reihenfolge = daten.bzReihenfolge ?? [];
  buchstabenReihenfolgen = daten.bzBuchstabenReihenfolgen ?? [];
  anzahlFragen = daten.bzAnzahlFragen ?? 0;
  frageSeit = daten.bzFrageSeit ?? 0;
  aufdeckAnzahl = daten.bzAufdeckAnzahl ?? 0;
  teammodus = !!daten.bzTeammodus;
  teams = daten.bzTeams ?? {};

  if ($("bz-teammodus").checked !== teammodus) $("bz-teammodus").checked = teammodus;

  const neuerIndex = daten.bzFragenIndex ?? 0;
  if (status === "frage_aktiv" && index !== neuerIndex) {
    index = neuerIndex;
    $("bz-wort-eingabe").value = "";
    $("bz-wort-fehler").textContent = "";
    ausgewertetAusgeloest = false;
  } else if (status === "ausgewertet") {
    index = neuerIndex;
  }

  api.fortschritt(
    status === "frage_aktiv" || status === "ausgewertet" ? `${index + 1}/${anzahlFragen}` : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("bz-setup").hidden = false;
  } else if (status === "frage_aktiv") {
    zeigeFrage();
    $("bz-frage-screen").hidden = false;
  } else if (status === "ausgewertet") {
    zeigeErgebnis();
    $("bz-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("bz-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["bz-setup", "bz-frage-screen", "bz-ergebnis-screen", "bz-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup
// ============================================================================
function zeigeSetup() {
  if (gewuenschteAnzahl === 0) gewuenschteAnzahl = Math.min(STANDARD_ANZAHL, fragen.length);
  $("bz-anzahl").max = String(Math.max(1, fragen.length));
  $("bz-anzahl").value = String(gewuenschteAnzahl);
  $("bz-anzahl-zeile").hidden = !api.istLeiter;
  $("bz-teammodus-zeile").hidden = !api.istLeiter;
  const teamSchalter = $("bz-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("bz-teams").hidden = !teammodus;
  $("bz-teams-zufall").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("bz-starten").hidden = !api.istLeiter;
  $("bz-setup-warten").hidden = api.istLeiter;
}

async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("bz-teammodus").checked;
  const neueTeams = aktiviert ? teams : {};
  try {
    await updateDoc(api.raumRef(), { bzTeammodus: aktiviert, bzTeams: neueTeams });
  } catch (e) {
    $("bz-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function waehleEigenesTeam(team) {
  if (!teammodus) return;
  try {
    await updateDoc(api.raumRef(), { bzTeams: { ...teams, [api.spielerId]: team } });
  } catch (e) {
    zeigeDebug("Team konnte nicht gewählt werden: " + e.message);
  }
}

async function zufaelligeTeams() {
  if (!api.istLeiter || !teammodus) return;
  $("bz-teams-zufall").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      bzTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("bz-teams-zufall").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("bz-team-" + team);
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
  $("bz-team-wahl-" + team).classList.toggle("zt-team-eigenes", teams[api.spielerId] === team);
}

function anzahlUebernehmen() {
  if (!api.istLeiter) return;
  let wert = parseInt($("bz-anzahl").value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > fragen.length) wert = fragen.length;
  gewuenschteAnzahl = wert;
  $("bz-anzahl").value = String(wert);
}

async function setzeGrundzustand(bzStatus) {
  await updateDoc(api.raumRef(), {
    bzStatus, bzReihenfolge: [], bzBuchstabenReihenfolgen: [], bzFragenIndex: 0, bzAnzahlFragen: 0,
    bzFrageSeit: 0, bzAufdeckAnzahl: 0, bzTeammodus: false, bzTeams: {}
  });
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "bzantworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

async function spielStarten() {
  $("bz-setup-fehler").textContent = "";
  if (fragen.length === 0) {
    $("bz-setup-fehler").textContent = "Es sind noch keine Fragen hinterlegt.";
    return;
  }
  anzahlUebernehmen();
  $("bz-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahl = Math.min(gewuenschteAnzahl || fragen.length, fragen.length);
    const neueReihenfolge = mischeIndizes(fragen.map((_, i) => i)).slice(0, anzahl);
    const neueBuchstabenReihenfolgen = neueReihenfolge.map((frageIndex) => {
      const frage = fragen[frageIndex];
      return frage.typ === "wort" ? mischeIndizes(buchstabenIndizes(frage.loesung)) : [];
    });
    const neueTeams = teammodus
      ? ergaenzeFehlendeTeams(teams, spielerListe.map((spieler) => spieler.id))
      : teams;
    await updateDoc(api.raumRef(), {
      bzStatus: "frage_aktiv", bzFragenIndex: 0, bzAnzahlFragen: anzahl,
      bzReihenfolge: neueReihenfolge, bzBuchstabenReihenfolgen: neueBuchstabenReihenfolgen,
      bzFrageSeit: Date.now(), bzAufdeckAnzahl: 0,
      bzTeammodus: teammodus, bzTeams: neueTeams
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("bz-starten").disabled = false;
}

export async function vorZurueck() {
  await raeumeSpieldatenAuf();
  await setzeGrundzustand(null);
  await api.zurueckZurAuswahl();
}

// ============================================================================
//  Frage
// ============================================================================
function maxAufdeckAnzahl(pos) {
  const anzahl = (buchstabenReihenfolgen[pos] ?? []).length;
  // Der letzte Buchstabe bleibt immer verdeckt, damit das Rätsel nicht von
  // allein "fertig aufgedeckt" wird.
  return Math.max(0, anzahl - 1);
}

function zeigeFrage() {
  const frage = frageAn(index);
  if (!frage) return;

  $("bz-frage-typ").textContent = TYP_LABEL[frage.typ] ?? "";
  $("bz-frage-text").innerHTML = textMitZusatz(frage.frage);

  const istWort = frage.typ === "wort";
  $("bz-mc-bereich").hidden = istWort;
  $("bz-wort-bereich").hidden = !istWort;

  const eigene = eigeneAntwort(index);
  if (istWort) {
    rendereBuchstabenReihe(frage, index);
    $("bz-wort-eingabe").disabled = !!eigene;
    $("bz-wort-absenden").disabled = !!eigene;
    $("bz-wort-status-eigenes").hidden = !eigene;
  } else {
    rendereMcGrid(frage, eigene);
  }

  $("bz-ueberspringen").hidden = !api.istLeiter;
  aktualisiereAntworten();
}

function rendereMcGrid(frage, eigene) {
  const grid = $("bz-mc-grid");
  grid.innerHTML = "";
  frage.antworten.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bz-antwort-btn";
    btn.textContent = text;
    if (eigene) {
      btn.disabled = true;
      if (i === eigene.antwortIndex) btn.classList.add("bz-eigene-wahl");
    }
    btn.addEventListener("click", () => antworteMC(i));
    grid.appendChild(btn);
  });
}

function rendereBuchstabenReihe(frage, pos) {
  const reihenfolgeBuchstaben = buchstabenReihenfolgen[pos] ?? [];
  const aufgedeckt = new Set(reihenfolgeBuchstaben.slice(0, aufdeckAnzahl));
  const reihe = $("bz-buchstaben-reihe");
  reihe.innerHTML = "";
  for (let i = 0; i < frage.loesung.length; i++) {
    const zeichen = frage.loesung[i];
    const span = document.createElement("span");
    if (!istBuchstabe(zeichen)) {
      span.className = "bz-buchstabe-luecke";
      span.textContent = zeichen;
    } else {
      span.className = "bz-buchstabe-kasten" + (aufgedeckt.has(i) ? " bz-aufgedeckt" : "");
      span.textContent = aufgedeckt.has(i) ? zeichen.toUpperCase() : "";
    }
    reihe.appendChild(span);
  }
}

function aktualisiereCountdown() {
  if (!el.wurzel || status !== "frage_aktiv") return;
  const frage = frageAn(index);
  if (!frage || frage.typ !== "wort") { $("bz-countdown").textContent = ""; return; }
  const maximal = maxAufdeckAnzahl(index);
  if (aufdeckAnzahl >= maximal) { $("bz-countdown").textContent = "Kein weiterer Buchstabe mehr"; return; }
  const naechsteAufdeckungBei = frageSeit + (aufdeckAnzahl + 1) * AUFDECK_DAUER_MS;
  const rest = Math.max(0, naechsteAufdeckungBei - Date.now());
  $("bz-countdown").textContent = `Nächster Buchstabe in ${Math.ceil(rest / 1000)}s`;
}

// Nur der Spielleiter-Client schreibt das Aufdecken in den Raum - sonst
// würden mehrere Geräte gleichzeitig denselben nächsten Buchstaben aufdecken.
async function pruefeAufdeckFortschritt() {
  if (!api?.istLeiter || status !== "frage_aktiv" || aufdeckFortschreibenLaeuft) return;
  const frage = frageAn(index);
  if (!frage || frage.typ !== "wort") return;
  const maximal = maxAufdeckAnzahl(index);
  if (aufdeckAnzahl >= maximal) return;
  const gewuenscht = Math.min(maximal, Math.floor((Date.now() - frageSeit) / AUFDECK_DAUER_MS));
  if (gewuenscht <= aufdeckAnzahl) return;

  aufdeckFortschreibenLaeuft = true;
  try {
    await updateDoc(api.raumRef(), { bzAufdeckAnzahl: gewuenscht });
  } catch (e) {
    zeigeDebug("Fehler beim Aufdecken des nächsten Buchstabens: " + e.message);
  }
  aufdeckFortschreibenLaeuft = false;
}

async function antworteMC(antwortIndex) {
  if (status !== "frage_aktiv" || eigeneAntwort(index)) return;
  const frage = frageAn(index);
  if (!frage) return;
  const millisekunden = Date.now() - frageSeit;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "bzantworten", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId, spielerName: api.spielerName, fragenIndex: index,
      antwortIndex, millisekunden, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    zeigeDebug("Fehler beim Absenden der Antwort: " + e.message);
  }
}

// v121: falsche Versuche beim Wortrate-Rätsel beenden die Runde NICHT - es wird
// einfach nichts gespeichert und man kann sofort nochmal tippen. Nur eine
// RICHTIGE Lösung landet in "bzantworten" (mit der bis dahin verstrichenen Zeit).
async function wortAbsenden() {
  if (status !== "frage_aktiv" || eigeneAntwort(index)) return;
  const eingabe = $("bz-wort-eingabe").value.trim();
  if (!eingabe) {
    $("bz-wort-fehler").textContent = "Bitte eine Antwort eingeben.";
    return;
  }
  const frage = frageAn(index);
  if (!frage) return;
  if (normalisiere(eingabe) !== normalisiere(frage.loesung)) {
    $("bz-wort-fehler").textContent = "Leider falsch - versuch's nochmal.";
    return;
  }
  $("bz-wort-fehler").textContent = "";
  $("bz-wort-eingabe").disabled = true;
  $("bz-wort-absenden").disabled = true;
  const millisekunden = Date.now() - frageSeit;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "bzantworten", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId, spielerName: api.spielerName, fragenIndex: index,
      millisekunden, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    $("bz-wort-eingabe").disabled = false;
    $("bz-wort-absenden").disabled = false;
    zeigeDebug("Fehler beim Absenden der Lösung: " + e.message);
  }
}

// Spielleiter kann jederzeit auswerten - z. B. wenn jemand gar nicht antwortet
// oder beim Wortrate-Rätsel steckenbleibt.
async function ueberspringen() {
  if (!api.istLeiter) return;
  await loeseRundeAuf();
}

async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const frage = frageAn(index);
  if (!frage) return;
  const dieserRunde = alleAntworten.filter((a) => a.fragenIndex === index);
  if (status === "frage_aktiv") {
    $("bz-frage-status").textContent = frage.typ === "wort"
      ? `${dieserRunde.length} von ${spielerListe.length} haben es schon gelöst`
      : `${dieserRunde.length} von ${spielerListe.length} haben geantwortet`;

    // Sobald wirklich alle geantwortet bzw. gelöst haben, wertet nur der
    // Spielleiter automatisch aus - beim Wortrate-Rätsel klappt das nur, wenn
    // niemand aufgibt; sonst greift der manuelle "Runde jetzt auswerten"-Button.
    if (api.istLeiter && !ausgewertetAusgeloest &&
        spielerListe.length > 0 && dieserRunde.length >= spielerListe.length) {
      await loeseRundeAuf();
    }
  } else if (status === "ausgewertet") {
    zeigeErgebnisListe(index);
  }
}

// ============================================================================
//  Auswertung
// ============================================================================
// "mc": jeder mit der richtigen antwortIndex bekommt 1 Punkt.
// "speed"/"wort": unter den RICHTIGEN Antworten (bei "wort" sind das automatisch
// alle, da falsche Versuche gar nicht gespeichert werden) bekommt die schnellste
// so viele Punkte wie Mitspieler mitmachen, jede weitere einen Punkt weniger.
function berechneRundenpunkte(pos) {
  const frage = frageAn(pos);
  if (!frage) return {};
  const antworten = alleAntworten.filter((a) => a.fragenIndex === pos);
  const ergebnis = {};

  if (frage.typ === "mc") {
    antworten.forEach((a) => {
      if (a.antwortIndex === frage.richtig) ergebnis[a.spielerId] = 1;
    });
    return ergebnis;
  }

  const richtige = frage.typ === "speed"
    ? antworten.filter((a) => a.antwortIndex === frage.richtig)
    : antworten;
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
    await updateDoc(api.raumRef(), { bzStatus: "ausgewertet" });
  } catch (e) {
    ausgewertetAusgeloest = false;
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
}

function zeitText(millisekunden) {
  return `${(millisekunden / 1000).toFixed(2)}s`;
}

function zeigeErgebnisListe(pos) {
  const frage = frageAn(pos);
  if (!el.wurzel || !frage) return;
  const dieserRunde = alleAntworten.filter((a) => a.fragenIndex === pos);
  const rundenpunkte = berechneRundenpunkte(pos);

  const kartenFuerSpieler = (s) => {
    const antwort = dieserRunde.find((a) => a.spielerId === s.id);
    let extra;
    if (frage.typ === "mc") {
      extra = antwort ? (antwort.antwortIndex === frage.richtig ? "richtig" : "falsch") : "nicht geantwortet";
    } else if (antwort) {
      extra = zeitText(antwort.millisekunden);
    } else {
      extra = frage.typ === "wort" ? "nicht gelöst" : "nicht geantwortet";
    }
    return spielerKarte(
      s.name, s.farbe, s.icon,
      formatiertePunkte(rundenpunkte[s.id] ?? 0),
      { extra, punkteRechts: s.punkte ?? 0 }
    );
  };

  const liste = $("bz-erg-liste");
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
  const frage = frageAn(index);
  if (!frage) return;
  $("bz-erg-typ").textContent = TYP_LABEL[frage.typ] ?? "";
  $("bz-erg-frage").innerHTML = textMitZusatz(frage.frage);
  if (frage.typ === "wort") {
    $("bz-erg-antwort-zeile").hidden = false;
    $("bz-erg-antwort").textContent = frage.loesung.toUpperCase();
  } else {
    $("bz-erg-antwort-zeile").hidden = false;
    $("bz-erg-antwort").textContent = frage.antworten[frage.richtig];
  }
  zeigeErgebnisListe(index);
  $("bz-weiter").hidden = !api.istLeiter;
  $("bz-weiter").textContent = index + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
}

async function weiter() {
  $("bz-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { bzStatus: "beendet" });
    } else {
      await updateDoc(api.raumRef(), {
        bzStatus: "frage_aktiv", bzFragenIndex: naechster,
        bzFrageSeit: Date.now(), bzAufdeckAnzahl: 0
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("bz-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("bz-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  const teamsEl = $("bz-endstand-teams");
  teamsEl.hidden = !teammodus;
  if (teammodus) teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("bz-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { normalisiere, mischeIndizes, buchstabenIndizes, istBuchstabe };
export function _berechneRundenpunkteFuerTest(frage, antworten, spielerAnzahl) {
  // Reine Testschnittstelle: dieselbe Logik wie berechneRundenpunkte(), aber
  // ohne die Modul-internen Variablen (fragen/reihenfolge/alleAntworten/
  // spielerListe) - so lässt sie sich isoliert mit erfundenen Daten prüfen.
  const ergebnis = {};
  if (frage.typ === "mc") {
    antworten.forEach((a) => {
      if (a.antwortIndex === frage.richtig) ergebnis[a.spielerId] = 1;
    });
    return ergebnis;
  }
  const richtige = frage.typ === "speed"
    ? antworten.filter((a) => a.antwortIndex === frage.richtig)
    : antworten;
  const sortiert = [...richtige].sort((a, b) => (a.millisekunden ?? 0) - (b.millisekunden ?? 0));
  sortiert.forEach((a, i) => {
    const punkte = spielerAnzahl - i;
    if (punkte > 0) ergebnis[a.spielerId] = punkte;
  });
  return ergebnis;
}
