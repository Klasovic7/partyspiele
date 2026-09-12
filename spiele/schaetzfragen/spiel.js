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
import { escapeHtml, textMitZusatz, spielerKarte, zeigeDebug } from "../../kern/ui.js";

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
          <span id="sf-anzahl-rad" class="anzahl-rad" role="listbox" aria-label="Anzahl Fragen" tabindex="0"></span>
          <input id="sf-anzahl" type="hidden" value="1">
        </span>
      </div>
      <span id="sf-anzahl-hinweis" class="hinweis-text"></span>
    </div>

    <div id="sf-dummkopf-zeile" class="setup-modusblock" hidden>
      <div class="setup-moduszeile">
        <label class="schalter-zeile">
          <span class="schalter">
            <input type="checkbox" id="sf-dummkopf">
            <span class="schalter-regler"></span>
          </span>
          <span class="schalter-text">Dummkopf-Modus</span>
        </label>
        <details class="modus-info">
          <summary aria-label="Erklärung zum Dummkopf-Modus">i</summary>
          <div>Vor jeder Frage tippt jeder, wer am weitesten danebenliegt. Wer richtig tippt, bekommt einen Extrapunkt.</div>
        </details>
      </div>
    </div>

    <p id="sf-setup-fehler" class="fehler-text"></p>
    <p><button id="sf-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="sf-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <p><button id="sf-abbrechen" class="btn-flach" hidden>Zurück zur Spielauswahl</button></p>
  </div>

  <div id="sf-dummkopf-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-dk-kategorie"></p>
    <p class="fortschritt" id="sf-dk-fortschritt"></p>
    <h2>Wer liegt am weitesten daneben?</h2>
    <p class="hinweis-text">Tippe auf einen Mitspieler. Liegt er bei dieser Frage am weitesten
      daneben, bekommst du einen Extrapunkt.</p>
    <ul id="sf-dk-liste"></ul>
    <p id="sf-dk-status"></p>
  </div>

  <div id="sf-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-frage-kategorie"></p>
    <p class="fortschritt" id="sf-frage-fortschritt"></p>
    <h2 id="sf-frage-text"></h2>
    <p>
      <input id="sf-schaetzung" type="number" step="any" inputmode="decimal" placeholder="Deine Schätzung">
      <button id="sf-absenden">Absenden</button>
    </p>
    <p id="sf-frage-fehler" class="fehler-text"></p>
    <p id="sf-frage-status"></p>
    <p><button id="sf-andere-frage" class="btn-flach" hidden>Andere Frage</button></p>
  </div>

  <div id="sf-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="sf-erg-kategorie"></p>
    <p class="fortschritt" id="sf-erg-fortschritt"></p>
    <h2 id="sf-erg-frage"></h2>
    <p>Richtige Antwort: <strong id="sf-erg-antwort"></strong></p>
    <ul id="sf-erg-liste"></ul>
    <p><button id="sf-weiter" hidden>Weiter</button></p>
  </div>

  <div id="sf-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <ul id="sf-endstand-liste"></ul>
    <p><button id="sf-nochmal" class="btn-primaer" hidden>Zurück zur Spielauswahl</button></p>
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
let status = null;
let ausgewertetAusgeloest = false;
let dummkopfPhaseBeendet = false;
let anzahlManuellGesetzt = false;
let anzahlRadZug = null;
let anzahlRadHatGezogen = false;
let anzahlRadMausRest = 0;
let anzahlRadMausTimer = null;

const ANZAHL_RAD_ZEILENHOEHE = 34;

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
    const antwort = await fetch(new URL("fragen.json", import.meta.url));
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();
  starteListener();

  // Der Spielleiter legt den Startzustand an, sobald das Spiel gewählt wurde.
  if (api.istLeiter && !api.raum?.sfStatus) {
    await updateDoc(api.raumRef(), {
      sfStatus: "setup", sfKategorien: [], sfDummkopf: false,
      sfFragenIndex: 0, sfFrageVersion: 0, sfReihenfolge: [], sfAnzahlFragen: 0
    });
  }
}

function verdrahteBedienelemente() {
  $("sf-alle").addEventListener("click", () => setzeAlleKategorien(true));
  $("sf-keine").addEventListener("click", () => setzeAlleKategorien(false));
  $("sf-anzahl-rad").addEventListener("click", (event) => {
    if (anzahlRadHatGezogen) {
      anzahlRadHatGezogen = false;
      event.preventDefault();
      return;
    }
    const option = event.target.closest(".anzahl-rad-option");
    if (!option) return;
    setzeAnzahlRadWert(parseInt(option.dataset.wert, 10), true, true);
  });
  $("sf-anzahl-rad").addEventListener("pointerdown", starteAnzahlRadZug);
  $("sf-anzahl-rad").addEventListener("pointermove", bewegeAnzahlRadZug);
  $("sf-anzahl-rad").addEventListener("pointerup", beendeAnzahlRadZug);
  $("sf-anzahl-rad").addEventListener("pointercancel", beendeAnzahlRadZug);
  $("sf-anzahl-rad").addEventListener("wheel", dreheAnzahlRadMitMaus, { passive: false });
  $("sf-anzahl-rad").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const richtung = event.key === "ArrowUp" ? -1 : 1;
    setzeAnzahlRadWert(parseInt($("sf-anzahl").value, 10) + richtung, true, true);
  });
  $("sf-dummkopf").addEventListener("change", async () => {
    if (!api.istLeiter) return;
    try { await updateDoc(api.raumRef(), { sfDummkopf: $("sf-dummkopf").checked }); }
    catch (e) { zeigeDebug("Fehler beim Umschalten des Dummkopf-Modus: " + e.message); }
  });
  $("sf-starten").addEventListener("click", spielStarten);
  $("sf-abbrechen").addEventListener("click", zurueck);
  $("sf-nochmal").addEventListener("click", zurueck);
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
  clearTimeout(anzahlRadMausTimer);
  anzahlRadMausTimer = null;
  anzahlRadZug = null;
  anzahlRadHatGezogen = false;
  anzahlRadMausRest = 0;
  el = {};
  index = -1; frageVersion = 0; reihenfolge = []; anzahlFragen = 0;
  kategorien = []; dummkopfModus = false; status = null;
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

  if ($("sf-dummkopf").checked !== dummkopfModus) $("sf-dummkopf").checked = dummkopfModus;

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

async function setzeAlleKategorien(alle) {
  const werte = alle ? KATEGORIEN.map((k) => k.id) : [];
  try {
    if (api.istLeiter) await updateDoc(api.raumRef(), { sfKategorien: werte });
    else await updateDoc(api.spielerRef(), { kategorieStimmen: werte });
  } catch (e) { zeigeDebug("Fehler bei der Kategorie-Auswahl: " + e.message); }
}

function verfuegbareFragenAnzahl() {
  return fragen.filter((f) => kategorien.includes(f.kategorie)).length;
}

function markiereAnzahlRadWert(wert) {
  const rad = $("sf-anzahl-rad");
  rad.querySelectorAll(".anzahl-rad-option").forEach((option) => {
    const aktiv = parseInt(option.dataset.wert, 10) === wert;
    option.classList.toggle("aktiv", aktiv);
    option.setAttribute("aria-selected", String(aktiv));
  });
  rad.setAttribute("aria-activedescendant", `sf-anzahl-${wert}`);
}

function starteAnzahlRadZug(event) {
  if (!api.istLeiter || event.button > 0) return;
  const rad = $("sf-anzahl-rad");
  anzahlRadHatGezogen = false;
  anzahlRadZug = { pointerId: event.pointerId, letzteY: event.clientY, rest: 0 };
  rad.classList.add("wird-gedreht");
  rad.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function bewegeAnzahlRadZug(event) {
  if (!anzahlRadZug || event.pointerId !== anzahlRadZug.pointerId) return;
  const delta = anzahlRadZug.letzteY - event.clientY;
  anzahlRadZug.letzteY = event.clientY;
  anzahlRadZug.rest += delta;
  if (Math.abs(anzahlRadZug.rest) >= 18) {
    const schritte = anzahlRadZug.rest > 0
      ? Math.floor(anzahlRadZug.rest / 18)
      : Math.ceil(anzahlRadZug.rest / 18);
    anzahlRadZug.rest -= schritte * 18;
    const aktuell = parseInt($("sf-anzahl").value, 10) || 1;
    setzeAnzahlRadWert(aktuell + schritte, true, false);
    anzahlRadHatGezogen = true;
  }
  event.preventDefault();
}

function beendeAnzahlRadZug(event) {
  if (!anzahlRadZug || event.pointerId !== anzahlRadZug.pointerId) return;
  const rad = $("sf-anzahl-rad");
  rad.classList.remove("wird-gedreht");
  if (rad.hasPointerCapture?.(event.pointerId)) rad.releasePointerCapture(event.pointerId);
  anzahlRadZug = null;
  setTimeout(() => { anzahlRadHatGezogen = false; }, 0);
  event.preventDefault();
}

function dreheAnzahlRadMitMaus(event) {
  if (!api.istLeiter || event.deltaY === 0) return;
  event.preventDefault();
  clearTimeout(anzahlRadMausTimer);
  anzahlRadMausRest += event.deltaY;
  const schritte = anzahlRadMausRest > 0
    ? Math.floor(anzahlRadMausRest / 28)
    : Math.ceil(anzahlRadMausRest / 28);
  if (schritte !== 0) {
    anzahlRadMausRest -= schritte * 28;
    const aktuell = parseInt($("sf-anzahl").value, 10) || 1;
    setzeAnzahlRadWert(aktuell + schritte, true, false);
  }
  anzahlRadMausTimer = setTimeout(() => { anzahlRadMausRest = 0; }, 140);
}

function setzeAnzahlRadWert(rohwert, manuell = false, sanft = false) {
  const rad = $("sf-anzahl-rad");
  const maximum = Math.max(1, parseInt(rad.dataset.maximum || "1", 10));
  const wert = Math.min(Math.max(1, Number.isFinite(rohwert) ? rohwert : 1), maximum);
  $("sf-anzahl").value = String(wert);
  if (manuell) anzahlManuellGesetzt = true;
  markiereAnzahlRadWert(wert);

  const ziel = (wert - 1) * ANZAHL_RAD_ZEILENHOEHE;
  if (Math.abs(rad.scrollTop - ziel) > 1) {
    rad.scrollTo({ top: ziel, behavior: sanft ? "smooth" : "auto" });
  }
}

function fuelleAnzahlRad(maximum, wert) {
  const rad = $("sf-anzahl-rad");
  if (parseInt(rad.dataset.maximum || "0", 10) !== maximum) {
    rad.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (let zahl = 1; zahl <= maximum; zahl += 1) {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `sf-anzahl-${zahl}`;
      option.className = "anzahl-rad-option";
      option.dataset.wert = String(zahl);
      option.setAttribute("role", "option");
      option.textContent = String(zahl);
      fragment.appendChild(option);
    }
    rad.appendChild(fragment);
    rad.dataset.maximum = String(maximum);
  }
  requestAnimationFrame(() => setzeAnzahlRadWert(wert, false, false));
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

  const verfuegbar = verfuegbareFragenAnzahl();
  const maximalSpielbar = maximaleFragenOhneKategorieNachbarn(fragen, kategorien);
  const anzahlFeld = $("sf-anzahl");
  const obergrenze = Math.max(1, maximalSpielbar);
  const bisher = parseInt(anzahlFeld.value, 10);
  const auswahl = anzahlManuellGesetzt && Number.isFinite(bisher)
    ? Math.min(Math.max(1, bisher), obergrenze)
    : obergrenze;
  fuelleAnzahlRad(obergrenze, auswahl);

  $("sf-anzahl-hinweis").textContent = verfuegbar === 0
    ? "Noch keine Kategorie ausgewählt."
    : maximalSpielbar < verfuegbar
      ? `${verfuegbar} Fragen verfügbar. Ohne gleiche Kategorien direkt hintereinander können davon höchstens ${maximalSpielbar} gespielt werden.`
      : `${verfuegbar} Frage${verfuegbar === 1 ? "" : "n"} insgesamt in den ausgewählten Kategorien verfügbar.`;

  $("sf-anzahl-zeile").hidden = !api.istLeiter;
  $("sf-dummkopf-zeile").hidden = !api.istLeiter;
  $("sf-starten").hidden = !api.istLeiter;
  $("sf-abbrechen").hidden = !api.istLeiter;
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

    await updateDoc(api.raumRef(), {
      sfStatus: dummkopfModus ? "dummkopf_wahl" : "frage_aktiv",
      sfFragenIndex: 0,
      sfAnzahlFragen: anzahl,
      sfReihenfolge: gemischt,
      sfFrageVersion: 0
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

async function zurueck() {
  const knopf = status === "beendet" ? $("sf-nochmal") : $("sf-abbrechen");
  knopf.disabled = true;
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      sfStatus: null, sfKategorien: [], sfReihenfolge: [],
      sfFragenIndex: 0, sfAnzahlFragen: 0, sfFrageVersion: 0
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
    knopf.disabled = false;
  }
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
  $("sf-dk-fortschritt").textContent = `Frage ${pos + 1} von ${anzahlFragen}`;

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
  $("sf-frage-fortschritt").textContent = `Frage ${pos + 1} von ${anzahlFragen}`;
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
  $("sf-frage-status").textContent = `${dieserRunde.length} von ${spielerListe.length} haben geantwortet`;
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
  const sortiert = alleAntworten.filter((a) => a.fragenIndex === pos)
    .sort((a, b) => Math.abs(a.schaetzung - richtig) - Math.abs(b.schaetzung - richtig));

  const liste = $("sf-erg-liste");
  liste.innerHTML = "";
  sortiert.forEach((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    let extra = `Schätzung ${antwort.schaetzung}`;
    if (dummkopfModus) {
      if (dummkoepfe.includes(antwort.spielerId)) extra += " · 🤡 Dummkopf";
      const tipp = tipps.find((t) => t.spielerId === antwort.spielerId);
      if (tipp && dummkoepfe.includes(tipp.zielSpielerId)) extra += " · Tipp richtig +1";
    }
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      antwort.spielerName, s?.farbe, s?.icon,
      formatiertePunkte(rundenpunkte[antwort.spielerId] ?? 0),
      { extra, punkteRechts: s ? (s.punkte ?? 0) : "?" }
    );
    liste.appendChild(li);
  });
}

function zeigeErgebnis(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("sf-erg-kategorie").textContent = kategorieName(frage.kategorie);
  $("sf-erg-fortschritt").textContent = `Frage ${pos + 1} von ${anzahlFragen}`;
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
  $("sf-nochmal").hidden = !api.istLeiter;
  $("sf-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { maximaleFragenOhneKategorieNachbarn, baueReihenfolgeOhneKategorieNachbarn };
