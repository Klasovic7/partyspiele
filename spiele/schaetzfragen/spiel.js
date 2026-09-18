// ============================================================================
//  Schätzfragen
// ----------------------------------------------------------------------------
//  Ein Spielmodul bekommt beim Start ein "api"-Objekt von app.js und meldet sich
//  über vier Funktionen zurück:
//     starten(api)      - einmal beim Laden: DOM aufbauen, eigene Listener starten
//     raumDaten(daten)  - bei jeder Änderung am Raum-Dokument
//     spieler(liste)    - bei jeder Änderung an der Spielerliste
//     beenden()         - aufräumen (Listener abmelden), bevor das Modul entladen wird
//
//  Alle Felder dieses Spiels im Raum-Dokument beginnen mit "sf", damit sie sich
//  nicht mit denen anderer Spiele beißen.
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment, arrayUnion, arrayRemove
} from "../../kern/firebase.js";
import { escapeHtml, textMitZusatz, spielerKarte, teamEndstandHtml, teamGruppeHtml, renderWarteAvatare, avatarHtml, zeigeDebug } from "../../kern/ui.js";
import { erstelleTeams, ergaenzeFehlendeTeams } from "../../kern/teams.js";
import { speichereWertung } from "../../kern/wertung.js";

export const KATEGORIEN = [
  { id: "fussball",             name: "Fußball",                emoji: "⚽️" },
  { id: "sport",                name: "Sport",                  emoji: "🏅" },
  { id: "geografie",            name: "Geografie",              emoji: "🌍" },
  { id: "natur-tiere",          name: "Natur & Tiere",          emoji: "🐾" },
  { id: "filme-serien",         name: "Filme & Serien",         emoji: "🎬" },
  { id: "essen-trinken",        name: "Essen & Trinken",        emoji: "🍕" },
  { id: "kurioses",             name: "Kurioses",               emoji: "🤯" },
  { id: "unnuetzes-wissen",     name: "Unnützes Wissen",        emoji: "💡" },
  { id: "rekorde",              name: "Rekorde",                emoji: "🏆" },
  { id: "politik-wissenschaft", name: "Politik & Wissenschaft", emoji: "⚖️" },
  { id: "promis",               name: "Promis",                 emoji: "⭐" }
];

const VORLAGE = `
  <div id="sf-setup" class="bildschirm-karte" hidden>
    <h1>🎯 Schätzfragen</h1>
    <p class="hinweis-text">Jeder kann abstimmen, welche Kategorien dabei sein sollen.</p>
    <p class="kategorien-aktionen">
      <button id="sf-alle" class="btn-flach">Alle auswählen</button>
      <button id="sf-keine" class="btn-flach">Alle abwählen</button>
    </p>
    <div id="sf-kategorien" class="kategorien-grid"></div>

    <div id="sf-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Fragen</span>
        <span class="anzahl-picker">
          <input id="sf-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" value="1" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="sf-dummkopf-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Dummkopf-Modus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Dummkopf-Modus">i</summary>
            <div>Vor jeder Frage tippt jeder, wer am weitesten danebenliegt. Wer richtig tippt, bekommt einen Extrapunkt.</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="sf-dummkopf">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="sf-teammodus-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <span class="modus-text-zeile">
          <span class="schalter-text">Teammodus</span>
          <details class="modus-info">
            <summary aria-label="Erklärung zum Teammodus">i</summary>
            <div>Jeder entscheidet sich für ein Team. Die Punkte werden weiterhin einzeln vergeben, zusätzlich seht ihr die Summe pro Team.</div>
          </details>
        </span>
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="sf-teammodus">
            <span class="schalter-regler"></span>
          </span>
        </label>
      </div>
    </div>

    <div id="sf-teams" hidden>
      <div class="zt-team-grid">
        <button type="button" id="sf-team-wahl-blau" class="zt-team zt-team-blau zt-team-waehlbar">
          <h3>🔵 Team Blau</h3>
          <ul id="sf-team-blau"></ul>
        </button>
        <button type="button" id="sf-team-wahl-rot" class="zt-team zt-team-rot zt-team-waehlbar">
          <h3>🔴 Team Rot</h3>
          <ul id="sf-team-rot"></ul>
        </button>
      </div>
      <p><button id="sf-teams-zufall" class="btn-flach" hidden>Zufällige Teams</button></p>
    </div>

    <p id="sf-setup-fehler" class="fehler-text"></p>
    <p><button id="sf-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="sf-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="sf-dummkopf-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-dk-kategorie"></p>
    <h2>Wer liegt am weitesten daneben?</h2>
    <p class="hinweis-text">Tippe auf einen Mitspieler. Liegt er bei dieser Frage am weitesten
      daneben, bekommst du einen Extrapunkt.</p>
    <ul id="sf-dk-liste"></ul>
    <p id="sf-dk-status"></p>
  </div>

  <div id="sf-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-frage-kategorie"></p>
    <h2 id="sf-frage-text"></h2>
    <p>
      <input id="sf-schaetzung" type="number" step="any" inputmode="decimal" placeholder="Deine Schätzung">
      <button id="sf-absenden">Absenden</button>
    </p>
    <p id="sf-frage-fehler" class="fehler-text"></p>
    <div id="sf-frage-status" class="warten-block"></div>
    <p><button id="sf-andere-frage" class="btn-flach" hidden>Andere Frage</button></p>
  </div>

  <div id="sf-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-erg-kategorie"></p>
    <h2 id="sf-erg-frage"></h2>
    <p>Richtige Antwort: <strong id="sf-erg-antwort"></strong></p>
    <div id="sf-erg-liste"></div>
    <p><button id="sf-weiter" hidden>Weiter</button></p>
  </div>

  <div id="sf-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <div id="sf-endstand-teams" hidden></div>
    <ul id="sf-endstand-liste"></ul>
    <p id="sf-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

// ---------- Modulzustand ----------
let api = null;
let fragen = [];
let el = {};                       // die DOM-Elemente dieses Spiels
let raum = {};
let spielerListe = [];
let alleAntworten = [];
let alleDummkoepfe = [];
let antwortenUnsub = null;
let dummkoepfeUnsub = null;

let index = -1;                    // aktuelle Frageposition
let frageVersion = 0;
let reihenfolge = [];
let anzahlFragen = 0;
let kategorien = [];
let dummkopfModus = false;
let teammodus = false;
let teams = {};
let status = null;
let ausgewertetAusgeloest = false;
let dummkopfPhaseBeendet = false;
let anzahlManuellGesetzt = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function kategorieName(id) {
  return KATEGORIEN.find((k) => k.id === id)?.name ?? id;
}
function frageAn(pos) {
  return fragen[reihenfolge[pos]];
}
function fragenAnzahlFuerKategorie(id) {
  return fragen.filter((f) => f.kategorie === id).length;
}

// ============================================================================
//  Start
// ============================================================================
export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  // Fragen liegen als eigene Datei daneben - so bleibt die App klein und der
  // Katalog lässt sich bearbeiten, ohne Programmcode anzufassen.
  if (fragen.length === 0) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url), { cache: "no-store" });
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();
  starteListener();

  // Der Spielleiter legt den Startzustand an, sobald das Spiel gewählt wurde.
  if (api.istLeiter && !api.raum?.sfStatus) {
    await updateDoc(api.raumRef(), {
      sfStatus: "setup", sfKategorien: [], sfDummkopf: false,
      sfTeammodus: false, sfTeams: {},
      sfFragenIndex: 0, sfFrageVersion: 0, sfReihenfolge: [], sfAnzahlFragen: 0
    });
  }
}

function verdrahteBedienelemente() {
  $("sf-alle").addEventListener("click", () => setzeAlleKategorien(true));
  $("sf-keine").addEventListener("click", () => setzeAlleKategorien(false));
  $("sf-anzahl").addEventListener("input", () => {
    const feld = $("sf-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
    anzahlManuellGesetzt = true;
  });
  $("sf-anzahl").addEventListener("change", () => { begrenzeAnzahlFeld(); anzahlManuellGesetzt = true; });
  // v105: als type="number" ließ sich der vorhandene Wert beim Fokussieren nicht
  // markieren (Browser unterstützen bei diesem Feldtyp keine Textauswahl) - daher
  // jetzt ein normales Textfeld mit numerischer Tastatur, dessen Inhalt select()
  // zuverlässig markiert.
  $("sf-anzahl").addEventListener("focus", () => { $("sf-anzahl").select(); });
  $("sf-dummkopf").addEventListener("change", async () => {
    if (!api.istLeiter) return;
    try { await updateDoc(api.raumRef(), { sfDummkopf: $("sf-dummkopf").checked }); }
    catch (e) { zeigeDebug("Fehler beim Umschalten des Dummkopf-Modus: " + e.message); }
  });
  $("sf-teammodus").addEventListener("change", teammodusUmschalten);
  $("sf-team-wahl-blau").addEventListener("click", () => waehleEigenesTeam("blau"));
  $("sf-team-wahl-rot").addEventListener("click", () => waehleEigenesTeam("rot"));
  $("sf-teams-zufall").addEventListener("click", zufaelligeTeams);
  $("sf-starten").addEventListener("click", spielStarten);
  $("sf-absenden").addEventListener("click", schaetzungAbsenden);
  $("sf-schaetzung").addEventListener("keydown", (e) => { if (e.key === "Enter") schaetzungAbsenden(); });
  $("sf-andere-frage").addEventListener("click", andereFrage);
  $("sf-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "antworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereAntworten();
  });
  dummkoepfeUnsub = onSnapshot(collection(api.db, "raeume", api.code, "dummkoepfe"), (snap) => {
    alleDummkoepfe = [];
    snap.forEach((d) => alleDummkoepfe.push(d.data()));
    if (status === "dummkopf_wahl") zeigeDummkopfWahl(index);
    if (status === "ausgewertet" && index >= 0) zeigeErgebnisListe(index);
    pruefeDummkopfPhase();
  });
}

export function beenden() {
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  if (dummkoepfeUnsub) { dummkoepfeUnsub(); dummkoepfeUnsub = null; }
  el = {};
  index = -1; frageVersion = 0; reihenfolge = []; anzahlFragen = 0;
  kategorien = []; dummkopfModus = false; status = null;
  teammodus = false; teams = {};
  alleAntworten = []; alleDummkoepfe = [];
  ausgewertetAusgeloest = false; dummkopfPhaseBeendet = false; anzahlManuellGesetzt = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "setup") zeigeSetup();
  if (status === "dummkopf_wahl") zeigeDummkopfWahl(index);
  if (status === "ausgewertet" && index >= 0) zeigeErgebnisListe(index);
  if (status === "beendet") zeigeEndstand();
  aktualisiereAntworten();
}

// ============================================================================
//  Reaktion auf das Raum-Dokument
// ============================================================================
export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  raum = daten;
  status = daten.sfStatus ?? null;
  anzahlFragen = daten.sfAnzahlFragen ?? 0;
  reihenfolge = daten.sfReihenfolge ?? [];
  dummkopfModus = !!daten.sfDummkopf;
  kategorien = daten.sfKategorien ?? [];
  teammodus = !!daten.sfTeammodus;
  teams = daten.sfTeams ?? {};

  if ($("sf-dummkopf").checked !== dummkopfModus) $("sf-dummkopf").checked = dummkopfModus;
  if ($("sf-teammodus").checked !== teammodus) $("sf-teammodus").checked = teammodus;

  const neueVersion = daten.sfFrageVersion ?? 0;
  const neuerIndex = daten.sfFragenIndex ?? 0;

  if (status === "dummkopf_wahl" || status === "frage_aktiv") {
    // Eingabe zurücksetzen, wenn eine neue Frage dran ist ODER die Frage an
    // derselben Stelle ausgetauscht wurde (sfFrageVersion).
    if (index !== neuerIndex || frageVersion !== neueVersion) {
      index = neuerIndex;
      frageVersion = neueVersion;
      $("sf-schaetzung").value = "";
      $("sf-schaetzung").disabled = false;
      $("sf-absenden").disabled = false;
      $("sf-frage-fehler").textContent = "";
      ausgewertetAusgeloest = false;
      dummkopfPhaseBeendet = false;
      aktualisiereAntworten();
    }
  } else if (status === "ausgewertet") {
    index = neuerIndex;
  }

  // v112: "Frage X von Y" steht jetzt oben im Spielkopf statt auf jedem
  // einzelnen Bildschirm separat (siehe api.fortschritt).
  api.fortschritt(
    status === "dummkopf_wahl" || status === "frage_aktiv" || status === "ausgewertet"
      ? `${index + 1}/${anzahlFragen}`
      : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("sf-setup").hidden = false;
  } else if (status === "dummkopf_wahl") {
    zeigeDummkopfWahl(index);
    $("sf-dummkopf-screen").hidden = false;
    pruefeDummkopfPhase();
  } else if (status === "frage_aktiv") {
    zeigeFrage(index);
    $("sf-andere-frage").hidden = !api.istLeiter;
    $("sf-frage-screen").hidden = false;
  } else if (status === "ausgewertet") {
    zeigeErgebnis(index);
    $("sf-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("sf-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["sf-setup", "sf-dummkopf-screen", "sf-frage-screen", "sf-ergebnis-screen", "sf-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

// ============================================================================
//  Setup: Kategorien, Anzahl, Dummkopf
// ============================================================================
async function stimmeFuerKategorie(katId) {
  const eigener = spielerListe.find((s) => s.id === api.spielerId);
  const dabei = (eigener?.kategorieStimmen || []).includes(katId);
  try {
    await updateDoc(api.spielerRef(), {
      kategorieStimmen: dabei ? arrayRemove(katId) : arrayUnion(katId)
    });
  } catch (e) { zeigeDebug("Fehler bei der Abstimmung: " + e.message); }
}

async function schalteKategorieFuerSpiel(katId) {
  const dabei = kategorien.includes(katId);
  try {
    await updateDoc(api.raumRef(), {
      sfKategorien: dabei ? arrayRemove(katId) : arrayUnion(katId)
    });
  } catch (e) { zeigeDebug("Fehler bei der Kategorie-Auswahl: " + e.message); }
}

// v109: Teammodus - die Punktevergabe bleibt komplett unverändert (jeder tippt und
// bekommt seine Punkte einzeln), die Teams dienen hier nur der zusätzlichen
// Summenanzeige im Endstand. Jeder Spieler wählt sich selbst ein Team; nur der
// Spielleiter darf über "Zufällige Teams" alle Zuordnungen neu auswürfeln.
async function teammodusUmschalten() {
  if (!api.istLeiter) return;
  const aktiviert = $("sf-teammodus").checked;
  const neueTeams = aktiviert ? teams : {};
  try {
    await updateDoc(api.raumRef(), { sfTeammodus: aktiviert, sfTeams: neueTeams });
  } catch (e) {
    $("sf-teammodus").checked = teammodus;
    zeigeDebug("Teammodus konnte nicht geändert werden: " + e.message);
  }
}

async function waehleEigenesTeam(team) {
  if (!teammodus) return;
  try {
    await updateDoc(api.raumRef(), { sfTeams: { ...teams, [api.spielerId]: team } });
  } catch (e) {
    zeigeDebug("Team konnte nicht gewählt werden: " + e.message);
  }
}

async function zufaelligeTeams() {
  if (!api.istLeiter || !teammodus) return;
  $("sf-teams-zufall").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      sfTeams: erstelleTeams(spielerListe.map((spieler) => spieler.id))
    });
  } catch (e) {
    zeigeDebug("Teams konnten nicht neu gemischt werden: " + e.message);
  }
  $("sf-teams-zufall").disabled = false;
}

function rendereTeamListe(team) {
  const liste = $("sf-team-" + team);
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
  $("sf-team-wahl-" + team).classList.toggle("zt-team-eigenes", teams[api.spielerId] === team);
}

async function setzeAlleKategorien(alle) {
  const werte = alle ? KATEGORIEN.map((k) => k.id) : [];
  try {
    if (api.istLeiter) await updateDoc(api.raumRef(), { sfKategorien: werte });
    else await updateDoc(api.spielerRef(), { kategorieStimmen: werte });
  } catch (e) { zeigeDebug("Fehler bei der Kategorie-Auswahl: " + e.message); }
}

// v104: das frühere per Wischgeste bedienbare "Zahlenrad" wurde durch ein
// gewöhnliches Zahlenfeld ersetzt (auf Wunsch - einheitlich mit den anderen
// Spielen, siehe stil.css .anzahl-eingabe). "begrenzeAnzahlFeld" sorgt nur
// noch dafür, dass eine manuelle Eingabe innerhalb von [1, Maximum] bleibt.
function begrenzeAnzahlFeld() {
  const feld = $("sf-anzahl");
  const maximum = Math.max(1, parseInt(feld.max, 10) || 1);
  let wert = parseInt(feld.value, 10);
  if (!Number.isFinite(wert) || wert < 1) wert = 1;
  if (wert > maximum) wert = maximum;
  feld.value = String(wert);
}

function mischeIndizes(werte) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

function maximaleFragenOhneKategorieNachbarn(fragenListe, kategorieIds) {
  const anzahlen = kategorieIds
    .map((kategorie) => fragenListe.filter((frage) => frage.kategorie === kategorie).length)
    .filter((anzahl) => anzahl > 0);
  const gesamt = anzahlen.reduce((summe, anzahl) => summe + anzahl, 0);
  if (anzahlen.length <= 1) return gesamt;

  const groessteKategorie = Math.max(...anzahlen);
  const andereFragen = gesamt - groessteKategorie;
  return andereFragen + Math.min(groessteKategorie, andereFragen + 1);
}

function baueReihenfolgeOhneKategorieNachbarn(fragenListe, passendeIndizes, gewuenschteAnzahl) {
  const gruppen = new Map();
  passendeIndizes.forEach((fragenIndex) => {
    const kategorie = fragenListe[fragenIndex].kategorie;
    if (!gruppen.has(kategorie)) gruppen.set(kategorie, []);
    gruppen.get(kategorie).push(fragenIndex);
  });
  gruppen.forEach((indizes, kategorie) => gruppen.set(kategorie, mischeIndizes(indizes)));

  const zielAnzahl = Math.min(gewuenschteAnzahl, passendeIndizes.length);
  const ergebnis = [];
  let letzteKategorie = null;
  while (ergebnis.length < zielAnzahl) {
    let auswahl = [...gruppen.entries()]
      .filter(([kategorie, indizes]) => kategorie !== letzteKategorie && indizes.length > 0);
    // Nur bei genau einer gewählten Kategorie darf dieselbe Kategorie erneut folgen.
    if (auswahl.length === 0 && gruppen.size === 1) {
      auswahl = [...gruppen.entries()].filter(([, indizes]) => indizes.length > 0);
    }
    if (auswahl.length === 0) break;

    const groessterRest = Math.max(...auswahl.map(([, indizes]) => indizes.length));
    const kandidaten = auswahl.filter(([, indizes]) => indizes.length === groessterRest);
    const [kategorie, indizes] = kandidaten[Math.floor(Math.random() * kandidaten.length)];
    ergebnis.push(indizes.pop());
    letzteKategorie = kategorie;
  }
  return ergebnis;
}

function zeigeSetup() {
  const eigener = spielerListe.find((s) => s.id === api.spielerId);
  const eigeneStimmen = eigener?.kategorieStimmen || [];
  const grid = $("sf-kategorien");

  grid.innerHTML = "";
  KATEGORIEN.forEach((kat) => {
    const verfuegbar = fragenAnzahlFuerKategorie(kat.id);
    const stimmen = spielerListe.filter((s) => (s.kategorieStimmen || []).includes(kat.id)).length;
    const gewaehlt = api.istLeiter ? kategorien.includes(kat.id) : eigeneStimmen.includes(kat.id);

    const div = document.createElement("div");
    div.className = "kategorie-kachel" + (gewaehlt ? " ausgewaehlt" : "");
    div.innerHTML =
      (api.istLeiter ? `<span class="kategorie-stimmen">${stimmen}</span>` : "") +
      `<span class="kategorie-emoji">${kat.emoji}</span>` +
      `<span class="kategorie-kachel-name">${escapeHtml(kat.name)}</span>` +
      `<span class="kategorie-kachel-anzahl">${verfuegbar} Frage${verfuegbar === 1 ? "" : "n"}</span>`;
    div.addEventListener("click", () => {
      if (api.istLeiter) schalteKategorieFuerSpiel(kat.id);
      else stimmeFuerKategorie(kat.id);
    });
    grid.appendChild(div);
  });

  const maximalSpielbar = maximaleFragenOhneKategorieNachbarn(fragen, kategorien);
  const anzahlFeld = $("sf-anzahl");
  const obergrenze = Math.max(1, maximalSpielbar);
  const bisher = parseInt(anzahlFeld.value, 10);
  const auswahl = anzahlManuellGesetzt && Number.isFinite(bisher)
    ? Math.min(Math.max(1, bisher), obergrenze)
    : obergrenze;
  anzahlFeld.max = String(obergrenze);
  anzahlFeld.value = String(auswahl);

  $("sf-anzahl-zeile").hidden = false;
  anzahlFeld.disabled = !api.istLeiter;
  $("sf-dummkopf-zeile").hidden = false;
  $("sf-dummkopf").disabled = !api.istLeiter;
  $("sf-teammodus-zeile").hidden = false;
  const teamSchalter = $("sf-teammodus");
  teamSchalter.checked = teammodus;
  teamSchalter.disabled = !api.istLeiter;
  $("sf-teams").hidden = !teammodus;
  $("sf-teams-zufall").hidden = !api.istLeiter;
  if (teammodus) {
    rendereTeamListe("blau");
    rendereTeamListe("rot");
  }
  $("sf-starten").hidden = !api.istLeiter;
  $("sf-setup-warten").hidden = api.istLeiter;
}

async function spielStarten() {
  $("sf-setup-fehler").textContent = "";

  const passende = fragen.map((f, i) => i).filter((i) => kategorien.includes(fragen[i].kategorie));
  if (passende.length === 0) {
    $("sf-setup-fehler").textContent =
      "Für die ausgewählten Kategorien gibt es noch keine Fragen. Bitte mindestens eine Kategorie mit Fragen auswählen.";
    return;
  }

  $("sf-starten").disabled = true;
  try {
    let anzahl = parseInt($("sf-anzahl").value, 10);
    if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
    const maximalSpielbar = maximaleFragenOhneKategorieNachbarn(fragen, kategorien);
    if (anzahl > maximalSpielbar) anzahl = maximalSpielbar;
    const gemischt = baueReihenfolgeOhneKategorieNachbarn(fragen, passende, anzahl);

    // Reste einer vorherigen Runde entfernen und Punkte auf 0 setzen.
    await raeumeSpieldatenAuf();

    const neueTeams = teammodus
      ? ergaenzeFehlendeTeams(teams, spielerListe.map((spieler) => spieler.id))
      : teams;

    await updateDoc(api.raumRef(), {
      sfStatus: dummkopfModus ? "dummkopf_wahl" : "frage_aktiv",
      sfFragenIndex: 0,
      sfAnzahlFragen: anzahl,
      sfReihenfolge: gemischt,
      sfFrageVersion: 0,
      sfTeams: neueTeams
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("sf-starten").disabled = false;
}

// Löscht Antworten und Dummkopf-Tipps und setzt alle Punktestände zurück.
async function raeumeSpieldatenAuf() {
  for (const name of ["antworten", "dummkoepfe"]) {
    const snap = await getDocs(collection(api.db, "raeume", api.code, name));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  }
  await Promise.all(spielerListe.map((s) =>
    updateDoc(api.spielerRef(s.id), { punkte: 0 })
  ));
}

// v87: Die eigenen "Zurück zur Spielauswahl"-Buttons (Setup- und Endstand-Bildschirm)
// wurden entfernt, weil oben in der Kopfzeile bereits derselbe Button existiert.
// Damit beim Zurückgehen trotzdem die Rundendaten aufgeräumt werden (Punkte,
// Antworten, sfStatus etc.), ruft app.js diesen exportierten Hook auf, statt den
// Raum selbst direkt zurückzusetzen.
export async function vorZurueck() {
  await raeumeSpieldatenAuf();
  await updateDoc(api.raumRef(), {
    sfStatus: null, sfKategorien: [], sfReihenfolge: [],
    sfFragenIndex: 0, sfAnzahlFragen: 0, sfFrageVersion: 0,
    sfTeammodus: false, sfTeams: {}
  });
  await api.zurueckZurAuswahl();
}

// ============================================================================
//  Dummkopf-Phase
// ============================================================================
function benoetigteDummkopfTipps() {
  return spielerListe.length < 2 ? 0 : spielerListe.length;
}
function dummkopfTippsDieserRunde(pos) {
  return alleDummkoepfe.filter((d) => d.fragenIndex === pos);
}
function eigenerDummkopfTipp(pos) {
  return dummkopfTippsDieserRunde(pos).find((d) => d.spielerId === api.spielerId)?.zielSpielerId ?? null;
}

// Wer lag bei dieser Frage am weitesten daneben? Bei Gleichstand gelten mehrere.
function dummkoepfeDerRunde(pos) {
  const antworten = alleAntworten.filter((a) => a.fragenIndex === pos);
  if (antworten.length === 0) return [];
  const richtig = frageAn(pos).antwort;
  const maxAbstand = Math.max(...antworten.map((a) => Math.abs(a.schaetzung - richtig)));
  return antworten.filter((a) => Math.abs(a.schaetzung - richtig) === maxAbstand).map((a) => a.spielerId);
}

async function waehleDummkopf(zielSpielerId) {
  if (index < 0) return;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "dummkoepfe", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId, zielSpielerId, fragenIndex: index
    });
  } catch (e) { zeigeDebug("Fehler beim Dummkopf-Tipp: " + e.message); }
}

function zeigeDummkopfWahl(pos) {
  if (pos < 0 || !el.wurzel) return;
  const frage = frageAn(pos);
  if (frage) $("sf-dk-kategorie").textContent = kategorieName(frage.kategorie);

  const eigenerTipp = eigenerDummkopfTipp(pos);
  const liste = $("sf-dk-liste");
  liste.innerHTML = "";
  spielerListe.filter((s) => s.id !== api.spielerId).forEach((s) => {
    const li = document.createElement("li");
    li.className = "dummkopf-wahl" + (eigenerTipp === s.id ? " gewaehlt" : "");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0);
    li.addEventListener("click", () => waehleDummkopf(s.id));
    liste.appendChild(li);
  });

  const benoetigt = benoetigteDummkopfTipps();
  $("sf-dk-status").textContent = benoetigt === 0
    ? "Zu wenige Mitspieler für den Dummkopf-Modus - es geht gleich weiter."
    : `${dummkopfTippsDieserRunde(pos).length} von ${benoetigt} haben getippt`;
}

// Sobald alle getippt haben, schaltet der Spielleiter auf die Frage um.
async function pruefeDummkopfPhase() {
  if (!api?.istLeiter || status !== "dummkopf_wahl" || dummkopfPhaseBeendet) return;
  if (dummkopfTippsDieserRunde(index).length < benoetigteDummkopfTipps()) return;

  dummkopfPhaseBeendet = true;
  try { await updateDoc(api.raumRef(), { sfStatus: "frage_aktiv" }); }
  catch (e) { dummkopfPhaseBeendet = false; zeigeDebug("Fehler beim Start der Frage: " + e.message); }
}

// ============================================================================
//  Frage
// ============================================================================
function zeigeFrage(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("sf-frage-kategorie").textContent = kategorieName(frage.kategorie);
  $("sf-frage-text").innerHTML = textMitZusatz(frage.frage);
}

async function schaetzungAbsenden() {
  const feld = $("sf-schaetzung");
  const wert = Number(feld.value);
  if (feld.value.trim() === "" || Number.isNaN(wert)) {
    $("sf-frage-fehler").textContent = "Bitte eine Zahl eingeben.";
    return;
  }
  $("sf-frage-fehler").textContent = "";
  feld.disabled = true;
  $("sf-absenden").disabled = true;

  try {
    await setDoc(doc(api.db, "raeume", api.code, "antworten", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId, spielerName: api.spielerName,
      fragenIndex: index, schaetzung: wert, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    feld.disabled = false;
    $("sf-absenden").disabled = false;
    zeigeDebug("Fehler beim Absenden: " + e.message);
  }
}

// Tauscht die aktuelle Frage gegen eine andere aus (z. B. wenn die Runde sie kannte).
function hatKeineKategorieNachbarn(indizes) {
  if (kategorien.length <= 1) return true;
  for (let i = 1; i < indizes.length; i++) {
    if (fragen[indizes[i - 1]].kategorie === fragen[indizes[i]].kategorie) return false;
  }
  return true;
}

async function andereFrage() {
  if (!api.istLeiter) return;
  $("sf-andere-frage").disabled = true;
  $("sf-frage-fehler").textContent = "";

  try {
    let neue = null;

    // Fall 1: Es gibt Fragen der gewählten Kategorien, die diese Runde gar nicht vorkommen.
    const verwendet = new Set(reihenfolge);
    const unbenutzt = mischeIndizes(
      fragen.map((f, i) => i)
        .filter((i) => kategorien.includes(fragen[i].kategorie) && !verwendet.has(i))
    );

    for (const neuerFragenIndex of unbenutzt) {
      const versuch = [...reihenfolge];
      versuch[index] = neuerFragenIndex;
      if (hatKeineKategorieNachbarn(versuch)) {
        neue = versuch;
        break;
      }
    }

    // Fall 2: Mit einer noch nicht gespielten Position tauschen. Der Tausch wird
    // nur übernommen, wenn auch danach keine gleichen Kategorien nebeneinanderliegen.
    if (!neue) {
      const spaeter = mischeIndizes(
        reihenfolge.map((_, position) => position).filter((position) => position > index)
      );
      for (const ziel of spaeter) {
        const versuch = [...reihenfolge];
        [versuch[index], versuch[ziel]] = [versuch[ziel], versuch[index]];
        if (hatKeineKategorieNachbarn(versuch)) {
          neue = versuch;
          break;
        }
      }
    }

    if (!neue) {
      $("sf-frage-fehler").textContent =
        "Es ist keine passende andere Frage mehr verfügbar.";
      $("sf-andere-frage").disabled = false;
      return;
    }

    for (const a of alleAntworten.filter((a) => a.fragenIndex === index)) {
      await deleteDoc(doc(api.db, "raeume", api.code, "antworten", `${a.spielerId}_${index}`));
    }

    await updateDoc(api.raumRef(), { sfReihenfolge: neue, sfFrageVersion: increment(1) });
  } catch (e) {
    zeigeDebug("Fehler beim Wechseln der Frage: " + e.message);
  }
  $("sf-andere-frage").disabled = false;
}

// ============================================================================
//  Auswertung
// ============================================================================
// Platzierung nach Nähe zur richtigen Antwort (Bester bekommt so viele Punkte wie
// Spieler mitgemacht haben, jeder Platz danach einen weniger; gleich weit entfernte
// Spieler teilen sich den Rang) plus 1 Bonuspunkt für exakt richtig.
function berechneRundenpunkte(pos) {
  const richtig = frageAn(pos).antwort;
  const antworten = alleAntworten.filter((a) => a.fragenIndex === pos);
  const sortiert = [...antworten].sort(
    (a, b) => Math.abs(a.schaetzung - richtig) - Math.abs(b.schaetzung - richtig)
  );
  const ergebnis = {};
  let vorherigerAbstand = null;
  let vorherigeRangpunkte = null;

  sortiert.forEach((antwort, i) => {
    const abstand = Math.abs(antwort.schaetzung - richtig);
    const rangpunkte = (vorherigerAbstand !== null && abstand === vorherigerAbstand)
      ? vorherigeRangpunkte
      : sortiert.length - i;
    ergebnis[antwort.spielerId] = rangpunkte + (abstand === 0 ? 1 : 0);
    vorherigerAbstand = abstand;
    vorherigeRangpunkte = rangpunkte;
  });

  // Dummkopf-Bonus: Wer richtig getippt hat, wer am weitesten danebenliegt, bekommt +1.
  if (dummkopfModus) {
    const dummkoepfe = dummkoepfeDerRunde(pos);
    dummkopfTippsDieserRunde(pos).forEach((tipp) => {
      if (dummkoepfe.includes(tipp.zielSpielerId) && ergebnis[tipp.spielerId] !== undefined) {
        ergebnis[tipp.spielerId] += 1;
      }
    });
  }
  return ergebnis;
}

// Wertet die Antworten der aktuellen Frage aus den bereits geladenen Daten neu aus -
// dabei entsteht KEIN neuer Firestore-Listener (das war früher die Bremse).
async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const dieserRunde = alleAntworten.filter((a) => a.fragenIndex === index);
  const geantwortetIds = new Set(dieserRunde.map((a) => a.spielerId));
  renderWarteAvatare($("sf-frage-status"), spielerListe.filter((sp) => !geantwortetIds.has(sp.id)));
  if (status === "ausgewertet") zeigeErgebnisListe(index);

  // Sobald alle geantwortet haben, wertet nur der Spielleiter aus, damit die
  // Punkte nicht mehrfach vergeben werden.
  if (api.istLeiter && status === "frage_aktiv" && !ausgewertetAusgeloest &&
      spielerListe.length > 0 && dieserRunde.length >= spielerListe.length) {
    ausgewertetAusgeloest = true;
    try {
      const punkte = berechneRundenpunkte(index);
      for (const [id, wert] of Object.entries(punkte)) {
        await updateDoc(api.spielerRef(id), { punkte: increment(wert) });
      }
      await updateDoc(api.raumRef(), { sfStatus: "ausgewertet" });
    } catch (e) {
      ausgewertetAusgeloest = false;
      zeigeDebug("Fehler bei der Auswertung: " + e.message);
    }
  }
}

function formatiertePunkte(p) {
  return p > 0 ? `+${p}` : `${p}`;
}

function zeigeErgebnisListe(pos) {
  if (!el.wurzel || !frageAn(pos)) return;
  const richtig = frageAn(pos).antwort;
  const rundenpunkte = berechneRundenpunkte(pos);
  const dummkoepfe = dummkopfModus ? dummkoepfeDerRunde(pos) : [];
  const tipps = dummkopfModus ? dummkopfTippsDieserRunde(pos) : [];
  const antwortenDieserRunde = alleAntworten.filter((a) => a.fragenIndex === pos);
  const sortiert = [...antwortenDieserRunde]
    .sort((a, b) => Math.abs(a.schaetzung - richtig) - Math.abs(b.schaetzung - richtig));

  const kartenFuerAntwort = (antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    let extra = `Schätzung ${antwort.schaetzung}`;
    if (dummkopfModus) {
      if (dummkoepfe.includes(antwort.spielerId)) extra += " · 🤡 Dummkopf";
      const tipp = tipps.find((t) => t.spielerId === antwort.spielerId);
      if (tipp && dummkoepfe.includes(tipp.zielSpielerId)) extra += " · Tipp richtig +1";
    }
    return spielerKarte(
      antwort.spielerName, s?.farbe, s?.icon,
      formatiertePunkte(rundenpunkte[antwort.spielerId] ?? 0),
      { extra, punkteRechts: s ? (s.punkte ?? 0) : "?" }
    );
  };

  const liste = $("sf-erg-liste");
  liste.classList.toggle("sf-erg-liste-balken", !teammodus);

  // v110: Im Teammodus nach Team gruppiert (Kachel mit Gesamtpunktzahl oben,
  // einzelne Spieler mit eigener Schätzung/Punkten darunter) statt einer
  // gemeinsamen, nach Nähe zur richtigen Antwort sortierten Liste.
  if (teammodus) {
    liste.innerHTML = teamGruppeHtml(spielerListe, teams, (s) => {
      const antwort = antwortenDieserRunde.find((a) => a.spielerId === s.id);
      return antwort
        ? kartenFuerAntwort(antwort)
        : spielerKarte(s.name, s.farbe, s.icon, formatiertePunkte(0), { punkteRechts: s.punkte ?? 0 });
    });
  } else {
    renderBalkenErgebnis(liste, richtig, sortiert, rundenpunkte, dummkoepfe, tipps);
  }
}

// Balken-Auswertung (v155): Statt einer Liste mit Gesamtpunktestand zeigt diese
// Ansicht pro Person einen Balken von 0 bis zur eigenen Schätzung, plus eine
// durchgehende, gestrichelte Ziellinie bei der richtigen Antwort. Die Skala
// (und damit die Position der Ziellinie) passt sich jede Runde neu an - je
// nachdem, ob alle unter der Antwort liegen, jemand drüber tippt oder es um
// negative Werte geht (z. B. "wie kalt war es?"). Der Gesamtpunktestand steht
// hier bewusst NICHT mehr - der ist erst wieder im Endstand zu sehen.
function renderBalkenErgebnis(container, richtig, sortiert, rundenpunkte, dummkoepfe, tipps) {
  const werte = [richtig, 0, ...sortiert.map((a) => a.schaetzung)];
  const minWert = Math.min(...werte);
  const maxWert = Math.max(...werte);
  const spanne = Math.max(maxWert - minWert, 1);
  const minSkala = minWert - spanne * 0.06;
  const maxSkala = maxWert + spanne * 0.06;
  const spanneSkala = Math.max(maxSkala - minSkala, 1);
  const prozent = (wert) => ((wert - minSkala) / spanneSkala) * 100;
  const nullPos = prozent(0);
  const zielPos = prozent(richtig);

  const zeilenHtml = sortiert.map((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    const farbe = s?.farbe || "#7f8c8d";
    const wertPos = prozent(antwort.schaetzung);
    const links = Math.min(nullPos, wertPos);
    const breite = Math.max(Math.abs(wertPos - nullPos), 0.6);
    const wertPositiv = wertPos >= nullPos;

    let punkteHtml = `<span>${formatiertePunkte(rundenpunkte[antwort.spielerId] ?? 0)}</span>`;
    let lang = false;
    if (dummkopfModus) {
      if (dummkoepfe.includes(antwort.spielerId)) { punkteHtml += `<span class="sf-erg-punkte-dk">🤡</span>`; lang = true; }
      const tipp = tipps.find((t) => t.spielerId === antwort.spielerId);
      if (tipp && dummkoepfe.includes(tipp.zielSpielerId)) { punkteHtml += `<span class="sf-erg-punkte-dk">🎯+1</span>`; lang = true; }
    }
    const kurz = breite < (lang ? 26 : 14);

    const aussenHtml = kurz
      ? `<span class="sf-erg-punkte-aussen${wertPositiv ? "" : " links"}" style="left:${wertPositiv ? links + breite : links}%;">${punkteHtml}</span>`
      : "";

    return (
      `<div class="sf-erg-spieler">` +
        `${avatarHtml(s?.icon, "sf-erg-avatar")}` +
        `<span class="sf-erg-name">${escapeHtml(antwort.spielerName)}</span>` +
      `</div>` +
      `<div class="sf-erg-spur">` +
        `<div class="sf-erg-balken" style="left:${links}%; width:${breite}%; background:${farbe};">` +
          (kurz ? "" : `<span class="sf-erg-balken-punkte">${punkteHtml}</span>`) +
        `</div>` +
        aussenHtml +
      `</div>`
    );
  }).join("");

  container.innerHTML =
    zeilenHtml +
    `<div class="sf-erg-ziel-ueberlagerung">` +
      `<div class="sf-erg-ziel-linie" style="left:${zielPos}%;"></div>` +
      `<span class="sf-erg-ziel-tag" style="left:${zielPos}%;">${escapeHtml(String(richtig))}</span>` +
    `</div>`;
}

function zeigeErgebnis(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("sf-erg-kategorie").textContent = kategorieName(frage.kategorie);
  $("sf-erg-frage").innerHTML = textMitZusatz(frage.frage);
  $("sf-erg-antwort").textContent = frage.antwort;
  zeigeErgebnisListe(pos);
  $("sf-weiter").hidden = !api.istLeiter;
  $("sf-weiter").textContent = pos + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
}

async function weiter() {
  $("sf-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { sfStatus: "beendet" });
      speichereWertung(api, "schaetzfragen", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), {
        sfStatus: dummkopfModus ? "dummkopf_wahl" : "frage_aktiv",
        sfFragenIndex: naechster
      });
    }
  } catch (e) { zeigeDebug("Fehler beim Weiterschalten: " + e.message); }
  $("sf-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("sf-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, index) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: index + 1 });
    liste.appendChild(li);
  });
  const teamsEl = $("sf-endstand-teams");
  teamsEl.hidden = !teammodus;
  if (teammodus) teamsEl.innerHTML = teamEndstandHtml(spielerListe, teams);
  $("sf-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { maximaleFragenOhneKategorieNachbarn, baueReihenfolgeOhneKategorieNachbarn };
