// ============================================================================
//  Denk gleich!
// ----------------------------------------------------------------------------
//  Alle beantworten dieselbe offene Frage. Für jede andere Person mit derselben
//  Antwort gibt es einen Punkt. Alle spielspezifischen Raumfelder beginnen mit
//  "dg"; Antworten liegen getrennt in der Subcollection "dgAntworten".
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment, writeBatch
} from "../../kern/firebase.js";
import { spielerKarte, renderWarteAvatare, zeigeDebug, initBereitSystem } from "../../kern/ui.js";
import { speichereWertung } from "../../kern/wertung.js";
import { pooleOhneWiederholung, aktualisierterVerlauf } from "../../kern/verlauf.js";

const VORLAGE = `
  <div id="dg-setup" class="bildschirm-karte" hidden>
    <h1>🧠 Denk gleich!</h1>
    <p class="hinweis-text">Beantwortet dieselbe Frage und versucht, auf das Gleiche zu kommen. Für jede
      andere Person mit derselben Antwort bekommst du einen Punkt. Drei gleiche Antworten bringen diesen
      drei Spielern also jeweils zwei Punkte.</p>

    <div id="dg-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Fragen</span>
        <span class="anzahl-picker">
          <input id="dg-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
      <p id="dg-anzahl-max" class="hinweis-text"></p>
    </div>

    <p id="dg-setup-fehler" class="fehler-text"></p>
    <p><button id="dg-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="dg-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <div id="dg-bereit-bereich" class="bereit-bereich" hidden></div>
  </div>

  <div id="dg-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Denk gleich!</p>
    <h2 id="dg-frage-text"></h2>
    <p>
      <input id="dg-antwort" type="text" maxlength="80" autocomplete="off"
        placeholder="Deine Antwort">
      <button id="dg-absenden" class="btn-primaer">Antwort absenden</button>
    </p>
    <p id="dg-frage-fehler" class="fehler-text"></p>
    <p id="dg-eigene-antwort-status" class="hinweis-text" hidden>Deine Antwort ist gespeichert.</p>
    <div id="dg-frage-status" class="warten-block"></div>
    <p><button id="dg-andere-frage" class="btn-flach" hidden>Andere Frage</button></p>
  </div>

  <div id="dg-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Denk gleich!</p>
    <h2 id="dg-erg-frage"></h2>
    <ul id="dg-erg-liste"></ul>
    <p><button id="dg-weiter" hidden>Weiter</button></p>
  </div>

  <div id="dg-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <ul id="dg-endstand-liste"></ul>
    <p id="dg-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
    <p><button id="dg-naechstes-spiel" class="btn-primaer" type="button" hidden>Nächstes Spiel</button></p>
  </div>
`;

let api = null;
let fragen = [];
let el = {};
let spielerListe = [];
let alleAntworten = [];
let antwortenUnsub = null;

let status = null;
let index = -1;
let frageVersion = 0;
let reihenfolge = [];
let gespielt = []; // Indizes der zuletzt gespielten Fragen (fuer Wiederholungsschutz)
let anzahlFragen = 0;
let ausgewertetAusgeloest = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function frageAn(pos) {
  return fragen[reihenfolge[pos]];
}

// Gleiche Bedeutung bei typischen Schreibunterschieden: Groß-/Kleinschreibung,
// mehrere Leerzeichen, Satzzeichen, Akzente und zum Beispiel "Fußball"/"Fussball".
function normalisiereAntwort(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function mischeFragenOhneAehnlicheNachbarn(fragenListe) {
  const gruppen = new Map();
  fragenListe.forEach((frage, fragenIndex) => {
    const gruppe = frage.gruppe || `einzeln-${fragenIndex}`;
    if (!gruppen.has(gruppe)) gruppen.set(gruppe, []);
    gruppen.get(gruppe).push(fragenIndex);
  });

  // Zuerst die Fragen innerhalb jeder Gruppe mischen.
  gruppen.forEach((indizes) => {
    for (let i = indizes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indizes[i], indizes[j]] = [indizes[j], indizes[i]];
    }
  });

  const ergebnis = [];
  let letzteGruppe = null;
  while (ergebnis.length < fragenListe.length) {
    const moeglicheGruppen = [...gruppen.entries()]
      .filter(([gruppe, indizes]) => gruppe !== letzteGruppe && indizes.length > 0);
    const auswahl = moeglicheGruppen.length > 0
      ? moeglicheGruppen
      : [...gruppen.entries()].filter(([, indizes]) => indizes.length > 0);
    const groessterRest = Math.max(...auswahl.map(([, indizes]) => indizes.length));
    const kandidaten = auswahl.filter(([, indizes]) => indizes.length === groessterRest);
    const [gruppe, indizes] = kandidaten[Math.floor(Math.random() * kandidaten.length)];
    ergebnis.push(indizes.pop());
    letzteGruppe = gruppe;
  }
  return ergebnis;
}

// Bereit-System (v190) - siehe kern/ui.js
let bereitSystem = null;
// v199: verhindert, dass der Bereit-Auto-Start (siehe zeigeSetup) mehrfach feuert.
let olympiadeAutoStart = false;

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;
  bereitSystem = initBereitSystem(api, "dg");
  olympiadeAutoStart = false;

  if (fragen.length === 0) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url), { cache: "no-store" });
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();
  starteListener();

  if (api.istLeiter && !api.raum?.dgStatus) {
    await updateDoc(api.raumRef(), {
      dgStatus: "setup", dgFragenIndex: 0, dgFrageVersion: 0,
      dgReihenfolge: [], dgAnzahlFragen: 0
    });
  }

  // v196/v199: Olympiade - die Anzahl steht schon vorab fest, wird hier nur
  // vorbelegt (Tick warten, bis spielerListe gefuellt ist). Gestartet wird
  // trotzdem erst, wenn alle Mitspieler*innen "Bereit" geklickt haben - das
  // uebernimmt der Aufruf in zeigeSetup() weiter unten.
  // v201: die Anzahl wird nicht mehr hier vorbelegt, sondern bei jedem
  // Render in zeigeSetup() direkt aus api.olympiadeAnzahl gesetzt (siehe
  // dort).
}

function verdrahteBedienelemente() {
  $("dg-anzahl").addEventListener("input", () => {
    const feld = $("dg-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  // v197: type="text" (fuer verlaessliches select() bei Fokus, siehe unten)
  // ignoriert das max-Attribut - ohne diese eigene Begrenzung beim Verlassen
  // des Feldes liesse sich hier z. B. "999999" eintippen, was stehen bliebe,
  // bis das Spiel (unsichtbar fuer die Person) beim Start still auf die
  // tatsaechlich verfuegbare Anzahl zurueckgestutzt wird.
  $("dg-anzahl").addEventListener("change", () => {
    const feld = $("dg-anzahl");
    let wert = parseInt(feld.value, 10);
    if (!Number.isFinite(wert) || wert < 1) wert = 1;
    if (wert > fragen.length) wert = fragen.length;
    feld.value = String(wert);
  });
  // v105: als type="number" ließ sich der vorhandene Wert beim Fokussieren nicht
  // markieren - jetzt ein Textfeld mit numerischer Tastatur, select() funktioniert.
  $("dg-anzahl").addEventListener("focus", () => { $("dg-anzahl").select(); });
  $("dg-starten").addEventListener("click", spielStarten);
  $("dg-absenden").addEventListener("click", antwortAbsenden);
  $("dg-antwort").addEventListener("keydown", (e) => {
    if (e.key === "Enter") antwortAbsenden();
  });
  $("dg-andere-frage").addEventListener("click", andereFrage);
  $("dg-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "dgAntworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereAntworten();
  });
}

export function beenden() {
  bereitSystem = null;
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  el = {};
  spielerListe = [];
  alleAntworten = [];
  status = null;
  index = -1;
  frageVersion = 0;
  reihenfolge = [];
  anzahlFragen = 0;
  ausgewertetAusgeloest = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "ausgewertet" && index >= 0) zeigeErgebnisListe(index);
  if (status === "beendet") zeigeEndstand();
  aktualisiereAntworten();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.dgStatus ?? null;
  reihenfolge = daten.dgReihenfolge ?? [];
  gespielt = daten.dgGespielt ?? [];
  anzahlFragen = daten.dgAnzahlFragen ?? 0;

  const neuerIndex = daten.dgFragenIndex ?? 0;
  const neueVersion = daten.dgFrageVersion ?? 0;
  if (status === "frage_aktiv" && (index !== neuerIndex || frageVersion !== neueVersion)) {
    index = neuerIndex;
    frageVersion = neueVersion;
    $("dg-antwort").value = "";
    $("dg-antwort").disabled = false;
    $("dg-absenden").disabled = false;
    $("dg-frage-fehler").textContent = "";
    ausgewertetAusgeloest = false;
  } else if (status === "ausgewertet") {
    index = neuerIndex;
    frageVersion = neueVersion;
  }

  // v112: "Frage X von Y" steht jetzt oben im Spielkopf statt auf jedem
  // einzelnen Bildschirm separat (siehe api.fortschritt).
  api.fortschritt(
    status === "frage_aktiv" || status === "ausgewertet" ? `${index + 1}/${anzahlFragen}` : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("dg-setup").hidden = false;
  } else if (status === "frage_aktiv") {
    zeigeFrage(index);
    $("dg-frage-screen").hidden = false;
    aktualisiereAntworten();
  } else if (status === "ausgewertet") {
    zeigeErgebnis(index);
    $("dg-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("dg-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["dg-setup", "dg-frage-screen", "dg-ergebnis-screen", "dg-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

function zeigeSetup() {
  const anzahlFeld = $("dg-anzahl");
  anzahlFeld.max = fragen.length;
  const inOlympiade = Boolean(api.olympiadeAnzahl);
  if (inOlympiade) {
    // v201-Fix: der bisherige "nur setzen, wenn das Feld noch leer ist"-
    // Trick hat zwar zufaellig beim Leiter funktioniert (das Feld startet
    // leer, der setTimeout in starten() kam als erstes zum Zug), aber bei
    // Mitspieler*innen NIE (deren Feld wird direkt beim ersten Render mit
    // der Obergrenze befuellt und blieb danach dabei). api.olympiadeAnzahl
    // ist bei allen Clients gleichermaßen verfuegbar - bei jedem Render
    // fest darauf setzen und das Feld komplett sperren.
    const festgelegt = Math.min(Math.max(1, api.olympiadeAnzahl), fragen.length);
    anzahlFeld.value = String(festgelegt);
    $("dg-anzahl-max").textContent = `In der Olympiade festgelegt: ${festgelegt} ${festgelegt === 1 ? "Frage" : "Fragen"}.`;
    anzahlFeld.disabled = true;
  } else {
    if (!anzahlFeld.value) anzahlFeld.value = fragen.length;
    $("dg-anzahl-max").textContent = `Insgesamt ${fragen.length} Fragen verfügbar.`;
    anzahlFeld.disabled = !api.istLeiter;
  }
  $("dg-anzahl-zeile").hidden = false;
  $("dg-starten").hidden = !api.istLeiter;
  $("dg-setup-warten").hidden = api.istLeiter;
  bereitSystem?.render();

  // v199: In der Olympiade ist die Anzahl schon vorab festgelegt, aber es
  // soll trotzdem ganz normal erst "Bereit" geklickt werden muessen - sobald
  // alle Mitspieler*innen bereit sind, startet das Spiel automatisch, ohne
  // dass der Leiter selbst noch auf "Spiel starten" tippen muss.
  if (api.istLeiter && api.olympiadeAnzahl && !olympiadeAutoStart && bereitSystem?.alleBereit()) {
    olympiadeAutoStart = true;
    spielStarten();
  }
}

async function spielStarten() {
  $("dg-setup-fehler").textContent = "";
  if (spielerListe.length < 2) {
    $("dg-setup-fehler").textContent = "Für Denk gleich! braucht ihr mindestens zwei Spieler.";
    return;
  }

  let anzahl = parseInt($("dg-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > fragen.length) anzahl = fragen.length;

  // Wiederholungsschutz: bevorzugt Fragen ziehen, die in diesem Raum noch
  // nicht drankamen (siehe kern/verlauf.js). mischeFragenOhneAehnlicheNachbarn
  // arbeitet mit den Indizes der ihr übergebenen Liste - deshalb erst auf die
  // erlaubten Kandidaten einschränken und die zurückgegebenen Positionen
  // danach wieder auf die echten Indizes in "fragen" zurückrechnen.
  const alleIndizes = fragen.map((_, i) => i);
  const { kandidaten, wurdeZurueckgesetzt } = pooleOhneWiederholung(alleIndizes, gespielt, anzahl);
  const kandidatenFragen = kandidaten.map((i) => fragen[i]);
  const gemischtePositionen = mischeFragenOhneAehnlicheNachbarn(kandidatenFragen);
  const gemischt = gemischtePositionen.map((position) => kandidaten[position]).slice(0, anzahl);
  const neuerGespielt = aktualisierterVerlauf(gespielt, gemischt, wurdeZurueckgesetzt);

  $("dg-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      dgStatus: "frage_aktiv",
      dgFragenIndex: 0,
      dgFrageVersion: 0,
      dgReihenfolge: gemischt,
      dgGespielt: neuerGespielt,
      dgAnzahlFragen: anzahl
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("dg-starten").disabled = false;
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "dgAntworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  alleAntworten = [];
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

// v104: der eigene "Zurück zur Spielauswahl"-Button (Setup- und Endstand-
// Bildschirm) ist entfernt, weil oben in der Kopfzeile bereits derselbe
// Button existiert (gleiches Muster wie in spiele/schaetzfragen/spiel.js,
// siehe dessen "vorZurueck"-Kommentar).
export async function vorZurueck() {
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      dgStatus: null, dgFragenIndex: 0, dgFrageVersion: 0,
      dgReihenfolge: [], dgAnzahlFragen: 0
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

function zeigeFrage(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("dg-frage-text").textContent = frage.frage;
  $("dg-andere-frage").hidden = !api.istLeiter;
}

async function antwortAbsenden() {
  if (status !== "frage_aktiv" || index < 0) return;
  const feld = $("dg-antwort");
  const antwort = feld.value.trim();
  const normalisiert = normalisiereAntwort(antwort);
  if (!normalisiert) {
    $("dg-frage-fehler").textContent = "Bitte gib zuerst eine Antwort ein.";
    return;
  }

  $("dg-frage-fehler").textContent = "";
  feld.disabled = true;
  $("dg-absenden").disabled = true;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "dgAntworten", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId,
      spielerName: api.spielerName,
      fragenIndex: index,
      frageVersion,
      antwort,
      normalisiert,
      zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    feld.disabled = false;
    $("dg-absenden").disabled = false;
    zeigeDebug("Fehler beim Absenden: " + e.message);
  }
}

function mischeZahlen(werte) {
  const gemischt = [...werte];
  for (let i = gemischt.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [gemischt[i], gemischt[j]] = [gemischt[j], gemischt[i]];
  }
  return gemischt;
}

function hatKeineAehnlichenNachbarn(fragenListe, indizes) {
  for (let i = 1; i < indizes.length; i++) {
    if (fragenListe[indizes[i - 1]]?.gruppe === fragenListe[indizes[i]]?.gruppe) return false;
  }
  return true;
}

function findeAndereFragenReihenfolge(fragenListe, aktuelleReihenfolge, aktuellePosition) {
  const verwendet = new Set(aktuelleReihenfolge);
  const unbenutzt = mischeZahlen(
    fragenListe.map((_, fragenIndex) => fragenIndex)
      .filter((fragenIndex) => !verwendet.has(fragenIndex))
  );

  for (const neuerFragenIndex of unbenutzt) {
    const versuch = [...aktuelleReihenfolge];
    versuch[aktuellePosition] = neuerFragenIndex;
    if (hatKeineAehnlichenNachbarn(fragenListe, versuch)) return versuch;
  }

  const spaeterePositionen = mischeZahlen(
    aktuelleReihenfolge.map((_, position) => position)
      .filter((position) => position > aktuellePosition)
  );
  for (const ziel of spaeterePositionen) {
    const versuch = [...aktuelleReihenfolge];
    [versuch[aktuellePosition], versuch[ziel]] = [versuch[ziel], versuch[aktuellePosition]];
    if (hatKeineAehnlichenNachbarn(fragenListe, versuch)) return versuch;
  }
  return null;
}

// Tauscht die aktuelle Frage aus. Bevorzugt wird eine noch nicht eingeplante
// Frage; wenn alle 250 Fragen gespielt werden, wird mit einer späteren Position
// getauscht. In beiden Fällen bleibt die Trennung ähnlicher Fragegruppen erhalten.
async function andereFrage() {
  if (!api.istLeiter || status !== "frage_aktiv" || index < 0) return;
  const knopf = $("dg-andere-frage");
  knopf.disabled = true;
  $("dg-frage-fehler").textContent = "";

  try {
    const neueReihenfolge = findeAndereFragenReihenfolge(fragen, reihenfolge, index);

    if (!neueReihenfolge) {
      $("dg-frage-fehler").textContent =
        "Es ist keine passende andere Frage mehr verfügbar.";
      knopf.disabled = false;
      return;
    }

    const alteAntworten = alleAntworten.filter((a) =>
      a.fragenIndex === index && (a.frageVersion ?? 0) === frageVersion
    );
    await Promise.all(alteAntworten.map((antwort) =>
      deleteDoc(doc(api.db, "raeume", api.code, "dgAntworten", `${antwort.spielerId}_${index}`))
    ));
    alleAntworten = alleAntworten.filter((a) =>
      a.fragenIndex !== index || (a.frageVersion ?? 0) !== frageVersion
    );

    await updateDoc(api.raumRef(), {
      dgReihenfolge: neueReihenfolge,
      dgFrageVersion: increment(1)
    });
  } catch (e) {
    zeigeDebug("Fehler beim Wechseln der Frage: " + e.message);
  }
  knopf.disabled = false;
}

function antwortenDieserRunde(pos) {
  const aktiveIds = new Set(spielerListe.map((s) => s.id));
  return alleAntworten.filter((a) =>
    a.fragenIndex === pos && (a.frageVersion ?? 0) === frageVersion && aktiveIds.has(a.spielerId)
  );
}

function berechneRundenpunkte(pos) {
  return berechnePunkteFuerAntworten(antwortenDieserRunde(pos));
}

function editierAbstand(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let vorherigeZeile = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const aktuelleZeile = [i];
    for (let j = 1; j <= b.length; j++) {
      aktuelleZeile[j] = Math.min(
        aktuelleZeile[j - 1] + 1,
        vorherigeZeile[j] + 1,
        vorherigeZeile[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    vorherigeZeile = aktuelleZeile;
  }
  return vorherigeZeile[b.length];
}

function antwortenPassenZusammen(a, b) {
  const normalA = normalisiereAntwort(a);
  const normalB = normalisiereAntwort(b);
  if (!normalA || !normalB) return false;
  if (normalA === normalB) return true;

  const woerterA = normalA.split(" ");
  const woerterB = normalB.split(" ");
  const [kurz, lang] = woerterA.length <= woerterB.length
    ? [woerterA, woerterB]
    : [woerterB, woerterA];

  // Eine vollständige Kurzform zählt: "Cola" passt zu "Coca Cola" und
  // "Pate" zu "Der Pate". Verglichen werden ganze Wörter, damit zum Beispiel
  // "Rot" nicht versehentlich zu "Brot" passt.
  if (kurz.every((wort) => lang.includes(wort))) return true;

  // Getrennt- und Zusammenschreibung sowie kleine Tippfehler bei längeren
  // Antworten ausgleichen, ohne sehr kurze Wörter zu großzügig zu behandeln.
  const kompaktA = woerterA.join("");
  const kompaktB = woerterB.join("");
  if (kompaktA === kompaktB) return true;

  const laenge = Math.max(kompaktA.length, kompaktB.length);
  const erlaubterAbstand = laenge >= 10 ? 2 : laenge >= 5 ? 1 : 0;
  return erlaubterAbstand > 0 && editierAbstand(kompaktA, kompaktB) <= erlaubterAbstand;
}

function berechnePunkteFuerAntworten(antworten) {
  const ergebnis = {};
  antworten.forEach((antwort) => { ergebnis[antwort.spielerId] = 0; });

  // Jede passende Paarung zählt für beide Beteiligten genau einen Punkt.
  for (let i = 0; i < antworten.length; i++) {
    for (let j = i + 1; j < antworten.length; j++) {
      if (antwortenPassenZusammen(antworten[i].antwort, antworten[j].antwort)) {
        ergebnis[antworten[i].spielerId] += 1;
        ergebnis[antworten[j].spielerId] += 1;
      }
    }
  }
  return ergebnis;
}

async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const antworten = antwortenDieserRunde(index);
  const eigeneAntwort = antworten.find((a) => a.spielerId === api.spielerId);
  if (status === "frage_aktiv" && eigeneAntwort) {
    $("dg-antwort").value = eigeneAntwort.antwort;
    $("dg-antwort").disabled = true;
    $("dg-absenden").disabled = true;
  }
  $("dg-eigene-antwort-status").hidden = !eigeneAntwort;
  const beantwortetIds = new Set(antworten.map((a) => a.spielerId));
  renderWarteAvatare($("dg-frage-status"), spielerListe.filter((sp) => !beantwortetIds.has(sp.id)));
  if (status === "ausgewertet") zeigeErgebnisListe(index);

  if (api.istLeiter && status === "frage_aktiv" && !ausgewertetAusgeloest &&
      spielerListe.length >= 2 && antworten.length >= spielerListe.length) {
    ausgewertetAusgeloest = true;
    try {
      const punkte = berechneRundenpunkte(index);
      const batch = writeBatch(api.db);
      Object.entries(punkte).forEach(([id, wert]) => {
        batch.update(api.spielerRef(id), { punkte: increment(wert) });
      });
      batch.update(api.raumRef(), { dgStatus: "ausgewertet" });
      await batch.commit();
    } catch (e) {
      ausgewertetAusgeloest = false;
      zeigeDebug("Fehler bei der Auswertung: " + e.message);
    }
  }
}

function formatiertePunkte(punkte) {
  return punkte > 0 ? `+${punkte}` : "0";
}

function zeigeErgebnisListe(pos) {
  if (!el.wurzel) return;
  const rundenpunkte = berechneRundenpunkte(pos);
  const sortiert = [...antwortenDieserRunde(pos)].sort((a, b) => {
    const punkteDifferenz = (rundenpunkte[b.spielerId] ?? 0) - (rundenpunkte[a.spielerId] ?? 0);
    if (punkteDifferenz !== 0) return punkteDifferenz;
    const antwortDifferenz = (a.normalisiert || "").localeCompare(b.normalisiert || "", "de");
    if (antwortDifferenz !== 0) return antwortDifferenz;
    return a.spielerName.localeCompare(b.spielerName, "de");
  });

  const liste = $("dg-erg-liste");
  liste.innerHTML = "";
  sortiert.forEach((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      antwort.spielerName,
      s?.farbe,
      s?.icon,
      formatiertePunkte(rundenpunkte[antwort.spielerId] ?? 0),
      { extra: `Antwort: ${antwort.antwort}`, punkteRechts: s ? (s.punkte ?? 0) : "?" }
    );
    liste.appendChild(li);
  });
}

function zeigeErgebnis(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("dg-erg-frage").textContent = frage.frage;
  zeigeErgebnisListe(pos);
  $("dg-weiter").hidden = !api.istLeiter;
  $("dg-weiter").textContent = pos + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
}

async function weiter() {
  $("dg-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { dgStatus: "beendet" });
      speichereWertung(api, "denk-gleich", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), { dgStatus: "frage_aktiv", dgFragenIndex: naechster });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("dg-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("dg-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, index) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: index + 1 });
    liste.appendChild(li);
  });
  $("dg-endstand-warten").hidden = api.istLeiter;
  // v200: in einer laufenden Olympiade muss der Spielleiter nicht mehr
  // extra oben links auf "Spielauswahl" tippen, um weiterzukommen - hier
  // direkt ein Button zum naechsten Olympiade-Spiel.
  const dgNaechstesBtn = $("dg-naechstes-spiel");
  if (dgNaechstesBtn) {
    dgNaechstesBtn.hidden = !(api.istLeiter && Boolean(api.olympiadeAnzahl));
    dgNaechstesBtn.disabled = false;
    dgNaechstesBtn.onclick = () => { dgNaechstesBtn.disabled = true; vorZurueck(); };
  }
}

// Für kleine lokale Tests exportiert; die Spiellogik nutzt dieselben Funktionen.
export {
  normalisiereAntwort, antwortenPassenZusammen, berechnePunkteFuerAntworten,
  mischeFragenOhneAehnlicheNachbarn, findeAndereFragenReihenfolge
};
