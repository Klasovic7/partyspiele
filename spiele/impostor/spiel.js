// ============================================================================
//  Findet den Impostor
// ----------------------------------------------------------------------------
//  Alle außer einer Person (dem "Impostor") sehen dasselbe Geheimwort. Wer der
//  Impostor ist, bekommt kein Wort und muss unauffällig mitreden, ohne
//  aufzufliegen. Jede*r deckt die eigene Karte privat auf dem eigenen Gerät
//  auf - genau wie beim eigenen Profil sieht jedes Handy nur, was die eigene
//  Person betrifft, ein Abgleich zwischen den Geräten ist nicht nötig. Wer der
//  Impostor tatsächlich war, wird am Tisch erraten; das App-seitige Auflösen
//  übernimmt der Spielleiter über einen Knopf, sobald genug diskutiert wurde.
//
//  Status im Raum-Dokument (Präfix "imp"):
//    setup       - Spielleiter stellt die Anzahl Runden ein
//    runde       - aktuelle Runde läuft, jede*r kann die eigene Karte aufdecken
//    aufgeloest  - wer der Impostor war, wird für alle angezeigt
//    beendet     - Abschlussbildschirm
//
//  Bewusst OHNE Punktesystem/Wertung: Das Spiel lebt vom Gespräch am Tisch -
//  die App weiß nicht, wer im Gespräch den Impostor korrekt erraten hat, kann
//  also auch keine sinnvollen Punkte vergeben.
// ============================================================================
import { updateDoc } from "../../kern/firebase.js";
import { escapeHtml, avatarHtml, zeigeDebug } from "../../kern/ui.js";

const STANDARD_ANZAHL = 5;

const VORLAGE = `
  <div id="imp-setup" class="bildschirm-karte" hidden>
    <h1>🎭 Findet den Impostor!</h1>
    <p class="hinweis-text">Alle außer einer Person bekommen dasselbe Geheimwort zu sehen. Der Impostor
      bekommt kein Wort und muss unauffällig mitreden, ohne aufzufliegen. Deckt eure Karte privat auf
      eurem eigenen Handy auf und diskutiert danach gemeinsam, wer der Impostor war.</p>

    <div id="imp-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="imp-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <p id="imp-setup-fehler" class="fehler-text"></p>
    <p><button id="imp-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="imp-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="imp-runde-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Findet den Impostor</p>
    <div class="imp-karten-buehne">
      <div id="imp-karte" class="imp-karte">
        <div id="imp-karte-vorderseite" class="imp-karte-seite imp-karte-vorne">
          <span id="imp-karte-name" class="imp-karte-name"></span>
          <div class="imp-karte-figur" aria-hidden="true">🕵️</div>
          <div class="imp-karte-pfeil" aria-hidden="true">↑</div>
          <span class="imp-karte-hinweis">Karte aufdecken</span>
        </div>
        <div id="imp-karte-rueckseite" class="imp-karte-seite imp-karte-hinten"></div>
      </div>
    </div>
    <p class="hinweis-text imp-runde-hinweis">Zieht die Karte nach oben (oder tippt sie an), um euer Wort
      (oder "Impostor") zu sehen. Niemand sonst sieht, was auf eurem Handy steht.</p>
    <p><button id="imp-aufloesen" class="btn-primaer" hidden>Auflösen: Wer war der Impostor?</button></p>
    <p id="imp-runde-warten" hidden><em>Der Spielleiter löst die Runde auf, sobald alle bereit sind …</em></p>
  </div>

  <div id="imp-aufloesung-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Findet den Impostor</p>
    <h2>🎭 Der Impostor war:</h2>
    <div id="imp-aufloesung-karte"></div>
    <p class="hinweis-text">Das Geheimwort war "<strong id="imp-aufloesung-wort"></strong>"
      (<span id="imp-aufloesung-thema"></span>).</p>
    <p><button id="imp-weiter" hidden></button></p>
    <p id="imp-aufloesung-warten" hidden><em>Warte auf den Spielleiter …</em></p>
  </div>

  <div id="imp-endstand-screen" class="bildschirm-karte" hidden>
    <h1>🎉 Danke fürs Mitspielen!</h1>
    <p class="hinweis-text">Findet den Impostor läuft ohne Punktestand - die Runden entscheidet ihr am Tisch.</p>
    <p id="imp-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

let api = null;
let woerter = [];
let el = {};
let spielerListe = [];

let status = null;
let anzahlRunden = 0;
let rundenIndex = -1;
let wortIndex = -1;
let impostorId = null;
let karteAufgedeckt = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  if (woerter.length === 0) {
    const antwort = await fetch(new URL("woerter.json", import.meta.url));
    if (!antwort.ok) throw new Error("woerter.json konnte nicht geladen werden");
    woerter = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.impStatus) {
    await updateDoc(api.raumRef(), {
      impStatus: "setup", impRundenIndex: 0, impAnzahlRunden: 0,
      impWortIndex: -1, impImpostorId: null
    });
  }
}

function verdrahteBedienelemente() {
  $("imp-anzahl").addEventListener("input", () => {
    const feld = $("imp-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  // Wie bei den anderen Spielen: type="number" ließ sich beim Fokussieren nicht
  // markieren - deshalb ein Textfeld mit numerischer Tastatur.
  $("imp-anzahl").addEventListener("focus", () => { $("imp-anzahl").select(); });
  $("imp-starten").addEventListener("click", spielStarten);
  $("imp-aufloesen").addEventListener("click", aufloesen);
  $("imp-weiter").addEventListener("click", weiter);
  verdrahteKarte();
}

export function beenden() {
  el = {};
  spielerListe = [];
  status = null;
  anzahlRunden = 0;
  rundenIndex = -1;
  wortIndex = -1;
  impostorId = null;
  karteAufgedeckt = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "aufgeloest") zeigeAufloesung();
  if (status === "beendet") zeigeEndstand();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  const neuerStatus = daten.impStatus ?? null;
  const neueAnzahlRunden = daten.impAnzahlRunden ?? 0;
  const neueRundenIndex = daten.impRundenIndex ?? 0;
  const neuerWortIndex = daten.impWortIndex ?? -1;

  // Neue Runde (Status wechselt zu "runde" oder Runde/Wort ändert sich) -
  // die Karte muss wieder verdeckt starten, damit niemand versehentlich das
  // alte, schon aufgedeckte Wort weiterhin sieht.
  if (neuerStatus === "runde" && (status !== "runde" || rundenIndex !== neueRundenIndex || wortIndex !== neuerWortIndex)) {
    karteAufgedeckt = false;
  }

  status = neuerStatus;
  anzahlRunden = neueAnzahlRunden;
  rundenIndex = neueRundenIndex;
  wortIndex = neuerWortIndex;
  impostorId = daten.impImpostorId ?? null;

  api.fortschritt(status === "runde" || status === "aufgeloest" ? `${rundenIndex + 1}/${anzahlRunden}` : "");

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("imp-setup").hidden = false;
  } else if (status === "runde") {
    zeigeRunde();
    $("imp-runde-screen").hidden = false;
  } else if (status === "aufgeloest") {
    zeigeAufloesung();
    $("imp-aufloesung-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("imp-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["imp-setup", "imp-runde-screen", "imp-aufloesung-screen", "imp-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

function zeigeSetup() {
  const anzahlFeld = $("imp-anzahl");
  if (!anzahlFeld.value) anzahlFeld.value = STANDARD_ANZAHL;
  $("imp-anzahl-zeile").hidden = false;
  anzahlFeld.disabled = !api.istLeiter;
  $("imp-starten").hidden = !api.istLeiter;
  $("imp-setup-warten").hidden = api.istLeiter;
}

// Zufälliger Index 0..anzahl-1, der (wenn möglich) vom zuletzt gezogenen
// abweicht - so kommt nicht zweimal hintereinander dasselbe Wort/dieselbe
// Person dran.
function zufallsIndexOhneWiederholung(anzahl, ausschluss) {
  if (anzahl <= 1) return 0;
  let wahl;
  do { wahl = Math.floor(Math.random() * anzahl); } while (wahl === ausschluss);
  return wahl;
}

async function spielStarten() {
  $("imp-setup-fehler").textContent = "";
  if (spielerListe.length < 3) {
    $("imp-setup-fehler").textContent = "Für Findet den Impostor braucht ihr mindestens drei Spieler.";
    return;
  }

  let anzahl = parseInt($("imp-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;

  $("imp-starten").disabled = true;
  try {
    await naechsteRundeSchreiben(0, anzahl, -1, null);
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("imp-starten").disabled = false;
}

async function naechsteRundeSchreiben(neueRundenIndex, neueAnzahlRunden, letzterWortIndex, letzterImpostorId) {
  const neuerWortIndex = zufallsIndexOhneWiederholung(woerter.length, letzterWortIndex);
  const kandidaten = spielerListe.filter((s) => s.id !== letzterImpostorId);
  const auswahlliste = kandidaten.length > 0 ? kandidaten : spielerListe;
  const gewaehlt = auswahlliste[Math.floor(Math.random() * auswahlliste.length)];
  await updateDoc(api.raumRef(), {
    impStatus: "runde",
    impRundenIndex: neueRundenIndex,
    impAnzahlRunden: neueAnzahlRunden,
    impWortIndex: neuerWortIndex,
    impImpostorId: gewaehlt.id
  });
}

export async function vorZurueck() {
  try {
    await updateDoc(api.raumRef(), {
      impStatus: null, impRundenIndex: 0, impAnzahlRunden: 0,
      impWortIndex: -1, impImpostorId: null
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

function zeigeRunde() {
  $("imp-karte-name").textContent = api.spielerName;
  aktualisiereKarte();
  $("imp-aufloesen").hidden = !api.istLeiter;
  $("imp-runde-warten").hidden = api.istLeiter;
}

function aktualisiereKarte() {
  const karte = $("imp-karte");
  karte.classList.toggle("aufgedeckt", karteAufgedeckt);
  const istImpostor = api.spielerId === impostorId;
  const wort = woerter[wortIndex];
  $("imp-karte-rueckseite").innerHTML = istImpostor
    ? `<span class="imp-rueckseite-symbol">❌</span><strong>Impostor</strong>
       <span class="imp-rueckseite-zusatz">Du kennst das Wort nicht - hör gut zu und misch dich unauffällig ein!</span>`
    : `<span class="imp-rueckseite-symbol">✅</span><strong>${escapeHtml(wort?.wort ?? "")}</strong>
       <span class="imp-rueckseite-zusatz">Kategorie: ${escapeHtml(wort?.thema ?? "")}</span>`;
}

// Karte per Ziehen (Maus/Touch über Pointer Events) oder einfachem Antippen
// aufdecken - Antippen als robuster Fallback, falls das Ziehen auf einem
// Gerät nicht sauber erkannt wird.
function verdrahteKarte() {
  const karte = $("imp-karte");
  let start = null;
  let versatz = 0;
  const hoehe = () => karte.getBoundingClientRect().height || 1;

  function anfassen(e) {
    if (status !== "runde" || karteAufgedeckt) return;
    start = e.clientY;
    karte.classList.add("wird-gezogen");
  }
  function bewegen(e) {
    if (start === null) return;
    versatz = Math.min(0, e.clientY - start);
    karte.style.setProperty("--verschiebung", versatz + "px");
  }
  function loslassen() {
    if (start === null) return;
    karte.classList.remove("wird-gezogen");
    karte.style.removeProperty("--verschiebung");
    if (versatz < -hoehe() * 0.28) {
      karteAufgedeckt = true;
      aktualisiereKarte();
    }
    start = null;
    versatz = 0;
  }

  karte.addEventListener("pointerdown", anfassen);
  karte.addEventListener("pointermove", bewegen);
  karte.addEventListener("pointerup", loslassen);
  karte.addEventListener("pointercancel", loslassen);
  karte.addEventListener("click", () => {
    if (status === "runde" && !karteAufgedeckt) { karteAufgedeckt = true; aktualisiereKarte(); }
  });
}

async function aufloesen() {
  if (!api.istLeiter || status !== "runde") return;
  $("imp-aufloesen").disabled = true;
  try {
    await updateDoc(api.raumRef(), { impStatus: "aufgeloest" });
  } catch (e) {
    zeigeDebug("Fehler beim Auflösen: " + e.message);
  }
  $("imp-aufloesen").disabled = false;
}

function zeigeAufloesung() {
  const impostor = spielerListe.find((s) => s.id === impostorId);
  const wort = woerter[wortIndex];
  $("imp-aufloesung-karte").innerHTML = impostor
    ? `<div class="spieler-karte spieler-identitaet" style="--spieler-farbe:${impostor.farbe || "#7f8c8d"}">
        <div class="spieler-info">${avatarHtml(impostor.icon, "spieler-icon")}
          <div class="spieler-text"><span class="spieler-name">${escapeHtml(impostor.name)}</span></div>
        </div>
      </div>`
    : "";
  $("imp-aufloesung-wort").textContent = wort?.wort ?? "";
  $("imp-aufloesung-thema").textContent = wort?.thema ?? "";
  const weiterKnopf = $("imp-weiter");
  const letzteRunde = rundenIndex + 1 >= anzahlRunden;
  weiterKnopf.hidden = !api.istLeiter;
  weiterKnopf.textContent = letzteRunde ? "Beenden" : "Nächste Runde";
  $("imp-aufloesung-warten").hidden = api.istLeiter;
}

async function weiter() {
  $("imp-weiter").disabled = true;
  try {
    const naechsterIndex = rundenIndex + 1;
    if (naechsterIndex >= anzahlRunden) {
      await updateDoc(api.raumRef(), { impStatus: "beendet" });
    } else {
      await naechsteRundeSchreiben(naechsterIndex, anzahlRunden, wortIndex, impostorId);
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("imp-weiter").disabled = false;
}

function zeigeEndstand() {
  $("imp-endstand-warten").hidden = api.istLeiter;
}
