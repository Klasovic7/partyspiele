// ============================================================================
//  Imposter
// ----------------------------------------------------------------------------
//  Alle außer einer (oder bei größeren Gruppen mehreren) Person(en), den
//  "Impostern", sehen dasselbe Geheimwort. Die Imposter bekommen kein Wort,
//  sondern nur einen vagen Hinweis dazu, und müssen unauffällig mitreden,
//  ohne aufzufliegen. Jede*r deckt die eigene Karte privat auf dem eigenen
//  Gerät auf - genau wie beim eigenen Profil sieht jedes Handy nur, was die
//  eigene Person betrifft, ein Abgleich zwischen den Geräten ist nicht nötig.
//  Wer die Imposter tatsächlich waren, wird am Tisch erraten; das App-seitige
//  Auflösen übernimmt der Spielleiter über einen Knopf, sobald genug
//  diskutiert wurde.
//
//  Die Karte zeigt den eigenen Namen; zieht man sie nach oben, kommt darunter
//  der Begriff (oder eben "Imposter" + ein loser Hinweis dazu) zum Vorschein -
//  lässt man los, fällt sie wieder runter und deckt alles wieder zu (kein
//  dauerhaftes Aufdecken, damit niemand aus Versehen zu lange offen daliegt).
//  Zusätzlich wird pro Runde eine rein zufällige Person als "beginnt"
//  angezeigt (unabhängig vom Imposter - der Imposter kann das durchaus sein).
//
//  Status im Raum-Dokument (Präfix "imp"):
//    setup       - Spielleiter stellt die Anzahl Runden ein
//    runde       - aktuelle Runde läuft, jede*r kann die eigene Karte aufdecken
//    aufgeloest  - wer der Imposter war, wird für alle angezeigt
//    beendet     - Abschlussbildschirm
//
//  Bewusst OHNE Punktesystem/Wertung: Das Spiel lebt vom Gespräch am Tisch -
//  die App weiß nicht, wer im Gespräch den Imposter korrekt erraten hat, kann
//  also auch keine sinnvollen Punkte vergeben.
// ============================================================================
import { updateDoc } from "../../kern/firebase.js";
import { escapeHtml, avatarHtml, zeigeDebug, initBereitSystem } from "../../kern/ui.js";
import { pooleOhneWiederholung, aktualisierterVerlauf } from "../../kern/verlauf.js";

const STANDARD_ANZAHL = 5;
const STANDARD_ANZAHL_IMPOSTER = 1;

const VORLAGE = `
  <div id="imp-setup" class="bildschirm-karte" hidden>
    <h1>🎭 Imposter</h1>
    <p class="hinweis-text">Alle außer den Impostern bekommen denselben Begriff zu sehen. Die Imposter
      bekommen den Begriff nicht - nur einen vagen Hinweis dazu - und müssen unauffällig mitreden, ohne
      aufzufliegen. Zieht eure Karte privat auf und diskutiert danach gemeinsam, wer die Imposter waren.</p>

    <div id="imp-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="imp-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <div id="imp-anzahl-imposter-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Imposter</span>
        <span class="anzahl-picker">
          <input id="imp-anzahl-imposter" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <p id="imp-setup-fehler" class="fehler-text"></p>
    <p><button id="imp-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="imp-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <div id="imp-bereit-bereich" class="bereit-bereich" hidden></div>
  </div>

  <div id="imp-runde-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Imposter</p>
    <p id="imp-runde-start" class="imp-start-anzeige"></p>
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
    <p class="hinweis-text imp-runde-hinweis">Zieht die Karte nach oben (oder tippt sie kurz an), um euer
      Wort zu sehen - beim Loslassen fällt sie automatisch wieder runter. Niemand sonst sieht, was auf
      eurem Handy steht.</p>
    <p><button id="imp-aufloesen" class="btn-primaer" hidden>Auflösen: Wer war der Imposter?</button></p>
    <p id="imp-runde-warten" hidden><em>Der Spielleiter löst die Runde auf, sobald alle bereit sind …</em></p>
  </div>

  <div id="imp-aufloesen-dialog" class="raum-verlassen-dialog" role="dialog" aria-modal="true"
       aria-labelledby="imp-aufloesen-titel" hidden>
    <div class="raum-verlassen-dialog-inhalt">
      <h2 id="imp-aufloesen-titel">Wirklich auflösen?</h2>
      <p class="hinweis-text">Der Imposter wird für alle aufgedeckt - das könnt ihr danach nicht mehr rückgängig machen.</p>
      <div class="raum-verlassen-aktionen">
        <button id="imp-aufloesen-abbrechen" class="btn-sekundaer" type="button">Abbrechen</button>
        <button id="imp-aufloesen-bestaetigen" class="btn-gefahr" type="button">Ja, auflösen</button>
      </div>
    </div>
  </div>

  <div id="imp-aufloesung-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Imposter</p>
    <h2 id="imp-aufloesung-titel">🎭 Der Imposter war:</h2>
    <div id="imp-aufloesung-karte"></div>
    <p class="hinweis-text">Der Begriff war "<strong id="imp-aufloesung-wort"></strong>".</p>
    <p><button id="imp-weiter" hidden></button></p>
    <p id="imp-aufloesung-warten" hidden><em>Warte auf den Spielleiter …</em></p>
  </div>

  <div id="imp-endstand-screen" class="bildschirm-karte" hidden>
    <h1>🎉 Danke fürs Mitspielen!</h1>
    <p class="hinweis-text">Imposter läuft ohne Punktestand - die Runden entscheidet ihr am Tisch.</p>
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
let imposterIds = [];
let anzahlImposter = 1;
let starterId = null;
let gespielt = []; // Indizes der zuletzt gespielten Woerter (fuer Wiederholungsschutz)

const $ = (id) => el.wurzel.querySelector("#" + id);

// Bereit-System (v190) - siehe kern/ui.js
let bereitSystem = null;

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;
  bereitSystem = initBereitSystem(api, "imp");

  if (woerter.length === 0) {
    const antwort = await fetch(new URL("woerter.json", import.meta.url), { cache: "no-store" });
    if (!antwort.ok) throw new Error("woerter.json konnte nicht geladen werden");
    woerter = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.impStatus) {
    await updateDoc(api.raumRef(), {
      impStatus: "setup", impRundenIndex: 0, impAnzahlRunden: 0,
      impWortIndex: -1, impImposterIds: [], impAnzahlImposter: 1, impStarterId: null
    });
  }
}

function verdrahteBedienelemente() {
  ["imp-anzahl", "imp-anzahl-imposter"].forEach((id) => {
    $(id).addEventListener("input", () => {
      const feld = $(id);
      const bereinigt = feld.value.replace(/[^0-9]/g, "");
      if (bereinigt !== feld.value) feld.value = bereinigt;
    });
    // Wie bei den anderen Spielen: type="number" ließ sich beim Fokussieren nicht
    // markieren - deshalb ein Textfeld mit numerischer Tastatur.
    $(id).addEventListener("focus", () => { $(id).select(); });
  });
  $("imp-starten").addEventListener("click", spielStarten);
  $("imp-aufloesen").addEventListener("click", () => { $("imp-aufloesen-dialog").hidden = false; });
  $("imp-aufloesen-abbrechen").addEventListener("click", () => { $("imp-aufloesen-dialog").hidden = true; });
  $("imp-aufloesen-bestaetigen").addEventListener("click", () => {
    $("imp-aufloesen-dialog").hidden = true;
    aufloesen();
  });
  $("imp-weiter").addEventListener("click", weiter);
  verdrahteKarte();
}

export function beenden() {
  bereitSystem = null;
  el = {};
  spielerListe = [];
  status = null;
  anzahlRunden = 0;
  rundenIndex = -1;
  wortIndex = -1;
  imposterIds = [];
  anzahlImposter = 1;
  starterId = null;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  // Der Spielername des Startspielers braucht die Spielerliste - die kommt
  // ueber einen eigenen Firestore-Listener und kann nach den Raumdaten
  // eintreffen. Deshalb hier erneut anzeigen, sobald die Liste (nach)kommt.
  if (status === "runde") zeigeRundenStart();
  if (status === "aufgeloest") zeigeAufloesung();
  if (status === "beendet") zeigeEndstand();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.impStatus ?? null;
  anzahlRunden = daten.impAnzahlRunden ?? 0;
  rundenIndex = daten.impRundenIndex ?? 0;
  wortIndex = daten.impWortIndex ?? -1;
  imposterIds = daten.impImposterIds ?? [];
  anzahlImposter = daten.impAnzahlImposter ?? 1;
  starterId = daten.impStarterId ?? null;
  gespielt = daten.impGespielt ?? [];

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
  // Falls sich der Status waehrenddessen aendert (z. B. ein anderes Geraet loest
  // parallel auf), soll die Bestaetigungsabfrage nicht offen haengen bleiben.
  $("imp-aufloesen-dialog").hidden = true;
}

function zeigeSetup() {
  const anzahlFeld = $("imp-anzahl");
  if (!anzahlFeld.value) anzahlFeld.value = STANDARD_ANZAHL;
  $("imp-anzahl-zeile").hidden = false;
  anzahlFeld.disabled = !api.istLeiter;

  const anzahlImposterFeld = $("imp-anzahl-imposter");
  if (!anzahlImposterFeld.value) anzahlImposterFeld.value = STANDARD_ANZAHL_IMPOSTER;
  $("imp-anzahl-imposter-zeile").hidden = false;
  anzahlImposterFeld.disabled = !api.istLeiter;

  $("imp-starten").hidden = !api.istLeiter;
  $("imp-setup-warten").hidden = api.istLeiter;
  bereitSystem?.render();
}

async function spielStarten() {
  $("imp-setup-fehler").textContent = "";
  if (spielerListe.length < 3) {
    $("imp-setup-fehler").textContent = "Für Imposter braucht ihr mindestens drei Spieler.";
    return;
  }

  let anzahl = parseInt($("imp-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;

  let anzahlImp = parseInt($("imp-anzahl-imposter").value, 10);
  if (!Number.isFinite(anzahlImp) || anzahlImp < 1) anzahlImp = 1;
  const maxImposter = spielerListe.length - 2;
  if (anzahlImp > maxImposter) {
    $("imp-setup-fehler").textContent =
      `Bei ${spielerListe.length} Spielern bleiben bei so vielen Impostern zu wenige Mitwisser übrig - wählt höchstens ${maxImposter}.`;
    return;
  }

  $("imp-starten").disabled = true;
  try {
    await naechsteRundeSchreiben(0, anzahl, -1, [], anzahlImp);
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("imp-starten").disabled = false;
}

function mischeSpieler(liste) {
  const gemischt = [...liste];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

async function naechsteRundeSchreiben(neueRundenIndex, neueAnzahlRunden, letzterWortIndex, letzteImposterIds, neueAnzahlImposter) {
  // Wiederholungsschutz: bevorzugt Wörter ziehen, die in diesem Raum noch
  // nicht drankamen (siehe kern/verlauf.js) - vorher wurde nur die direkte
  // Wiederholung des allerletzten Worts verhindert, wodurch dieselben Wörter
  // sonst schon nach wenigen Runden wieder auftauchen konnten.
  const { kandidaten, wurdeZurueckgesetzt } = pooleOhneWiederholung(woerter.map((_, i) => i), gespielt, 1);
  const neuerWortIndex = kandidaten[Math.floor(Math.random() * kandidaten.length)];
  const neuerGespielt = aktualisierterVerlauf(gespielt, [neuerWortIndex], wurdeZurueckgesetzt);
  // Nie mehr Imposter als Spieler minus zwei - sonst blieben zu wenige (oder
  // gar keine) Mitwisser uebrig, die den Begriff ueberhaupt kennen.
  const anzahlImp = Math.max(1, Math.min(neueAnzahlImposter, spielerListe.length - 2));
  const kandidatenSpieler = spielerListe.filter((s) => !letzteImposterIds.includes(s.id));
  const auswahlliste = kandidatenSpieler.length >= anzahlImp ? kandidatenSpieler : spielerListe;
  const gemischt = mischeSpieler(auswahlliste);
  const gewaehlte = gemischt.slice(0, anzahlImp);
  // Wer beginnt, wird komplett unabhaengig von den Impostern gewuerfelt - das
  // kann also durchaus eine der Imposter-Personen sein.
  const startet = spielerListe[Math.floor(Math.random() * spielerListe.length)];
  await updateDoc(api.raumRef(), {
    impStatus: "runde",
    impRundenIndex: neueRundenIndex,
    impAnzahlRunden: neueAnzahlRunden,
    impWortIndex: neuerWortIndex,
    impGespielt: neuerGespielt,
    impImposterIds: gewaehlte.map((s) => s.id),
    impAnzahlImposter: anzahlImp,
    impStarterId: startet.id
  });
}

export async function vorZurueck() {
  try {
    await updateDoc(api.raumRef(), {
      impStatus: null, impRundenIndex: 0, impAnzahlRunden: 0,
      impWortIndex: -1, impImposterIds: [], impAnzahlImposter: 1, impStarterId: null
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

function zeigeRundenStart() {
  const startSpieler = spielerListe.find((s) => s.id === starterId);
  $("imp-runde-start").textContent = startSpieler ? `🎲 ${startSpieler.name} beginnt` : "";
}

function zeigeRunde() {
  $("imp-karte-name").textContent = api.spielerName;
  zeigeRundenStart();
  // Neue Runde: Karte immer verdeckt/an der Ausgangsposition zeigen - falls
  // noch eine alte Verschiebung vom vorherigen Zug in den Inline-Styles
  // hängt (sollte durch das Loslassen eigentlich nie passieren, aber sicher
  // ist sicher), wird sie hier zurückgesetzt.
  const karte = $("imp-karte");
  karte.classList.remove("wird-gezogen");
  karte.style.removeProperty("--verschiebung");
  aktualisiereKarteninhalt();
  $("imp-aufloesen").hidden = !api.istLeiter;
  $("imp-runde-warten").hidden = api.istLeiter;
}

function aktualisiereKarteninhalt() {
  const istImposter = imposterIds.includes(api.spielerId);
  const eintrag = woerter[wortIndex];
  $("imp-karte-rueckseite").innerHTML = istImposter
    ? `<span class="imp-rueckseite-symbol">❌</span><strong>Imposter</strong>
       <span class="imp-rueckseite-zusatz">Hinweis: ${escapeHtml(eintrag?.hinweis ?? "")}</span>
       <span class="imp-rueckseite-zusatz">Du kennst den Begriff nicht - hör gut zu und misch dich unauffällig ein!</span>`
    : `<span class="imp-rueckseite-symbol">✅</span><strong>${escapeHtml(eintrag?.begriff ?? "")}</strong>`;
}

// Karte per Ziehen (Maus/Touch über Pointer Events) oder kurzem Antippen
// aufdecken - beim Loslassen fällt sie immer wieder zurück (kein
// dauerhaftes Aufdecken), damit niemand aus Versehen das Wort offen liegen
// lässt. Antippen simuliert dafür ein kurzes automatisches Hochziehen und
// Zurückfallen, als robuster Fallback für Geräte, bei denen das Ziehen nicht
// sauber ankommt.
function verdrahteKarte() {
  const karte = $("imp-karte");
  let start = null;
  let versatz = 0;
  let getippt = false;
  const hoehe = () => karte.getBoundingClientRect().height || 1;

  function faelltZurueck() {
    karte.classList.remove("wird-gezogen");
    karte.classList.add("faellt-zurueck");
    karte.style.setProperty("--verschiebung", "0px");
    setTimeout(() => karte.classList.remove("faellt-zurueck"), 320);
  }

  function anfassen(e) {
    if (status !== "runde") return;
    getippt = false;
    start = e.clientY;
    karte.classList.remove("faellt-zurueck");
    karte.classList.add("wird-gezogen");
  }
  function bewegen(e) {
    if (start === null) return;
    versatz = Math.min(0, e.clientY - start);
    if (-versatz > 6) getippt = false;
    karte.style.setProperty("--verschiebung", versatz + "px");
  }
  function loslassen() {
    if (start === null) return;
    faelltZurueck();
    start = null;
    versatz = 0;
  }

  karte.addEventListener("pointerdown", (e) => { getippt = true; anfassen(e); });
  karte.addEventListener("pointermove", bewegen);
  karte.addEventListener("pointerup", loslassen);
  karte.addEventListener("pointercancel", loslassen);

  // Klick als Fallback (z. B. Tastatur/Screenreader oder falls Pointer Events
  // aus irgendeinem Grund nicht greifen): kurz automatisch hochziehen, kurz
  // halten, dann von selbst wieder runterfallen lassen.
  karte.addEventListener("click", () => {
    if (status !== "runde" || getippt) { getippt = false; return; }
    karte.classList.remove("faellt-zurueck");
    karte.classList.add("wird-gezogen");
    karte.style.setProperty("--verschiebung", (-hoehe() * 0.7) + "px");
    setTimeout(() => faelltZurueck(), 1100);
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
  const imposter = spielerListe.filter((s) => imposterIds.includes(s.id));
  const eintrag = woerter[wortIndex];
  $("imp-aufloesung-titel").textContent =
    imposter.length > 1 ? "🎭 Die Imposter waren:" : "🎭 Der Imposter war:";
  $("imp-aufloesung-karte").innerHTML = imposter
    .map((sp) => `
      <div class="spieler-karte spieler-identitaet" style="--spieler-farbe:${sp.farbe || "#7f8c8d"}">
        <div class="spieler-info">${avatarHtml(sp.icon, "spieler-icon")}
          <div class="spieler-text"><span class="spieler-name">${escapeHtml(sp.name)}</span></div>
        </div>
      </div>`)
    .join("");
  $("imp-aufloesung-wort").textContent = eintrag?.begriff ?? "";
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
      await naechsteRundeSchreiben(naechsterIndex, anzahlRunden, wortIndex, imposterIds, anzahlImposter);
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("imp-weiter").disabled = false;
}

function zeigeEndstand() {
  $("imp-endstand-warten").hidden = api.istLeiter;
}
