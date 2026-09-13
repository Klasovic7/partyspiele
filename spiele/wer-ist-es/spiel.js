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
//  Wie bei Schätzfragen meldet sich dieses Modul über starten/raumDaten/spieler/
//  beenden zurück (siehe Kommentar in spiele/schaetzfragen/spiel.js).
// ============================================================================
import { updateDoc, increment, runTransaction } from "../../kern/firebase.js";
import { spielerKarte, zeigeDebug } from "../../kern/ui.js";

const HINWEIS_DAUER_MS = 10000;
const STANDARD_ANZAHL = 8;

const VORLAGE = `
  <div id="wi-setup" class="bildschirm-karte" hidden>
    <h1>🕵️ Wer ist es?</h1>
    <p class="hinweis-text">Ihr bekommt nacheinander Hinweise zu einem Fußballer - vom
      schwersten zum leichtesten. Wer zuerst buzzert, darf raten. Je weniger Hinweise
      es bis dahin gab, desto mehr Punkte gibt es.</p>

    <div class="wi-anzahl-zeile" id="wi-anzahl-zeile" hidden>
      <span>Anzahl Runden</span>
      <span class="wi-anzahl-stepper">
        <button id="wi-anzahl-minus" type="button" class="btn-flach" aria-label="Weniger Runden">−</button>
        <strong id="wi-anzahl-wert">8</strong>
        <button id="wi-anzahl-plus" type="button" class="btn-flach" aria-label="Mehr Runden">+</button>
      </span>
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
let gewuenschteAnzahl = 0;
let hinweisFortschreibenLaeuft = false;
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

// Nachname reicht auch - Groß-/Kleinschreibung und Akzente spielen keine Rolle.
// Bewusst einfach gehalten fürs Grundgerüst; Tippfehler-Toleranz kann später
// noch ergänzt werden.
function normalisiere(text) {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}
function istAntwortRichtig(eingabe, name) {
  const a = normalisiere(eingabe);
  if (!a) return false;
  if (a === normalisiere(name)) return true;
  const nachname = normalisiere(name.split(" ").slice(-1)[0]);
  return a === nachname;
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
  $("wi-anzahl-minus").addEventListener("click", () => anzahlAendern(-1));
  $("wi-anzahl-plus").addEventListener("click", () => anzahlAendern(1));
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
  antwortText = ""; antwortKorrekt = null; gewuenschteAnzahl = 0;
  hinweisFortschreibenLaeuft = false;
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
  $("wi-anzahl-wert").textContent = String(gewuenschteAnzahl);
  $("wi-anzahl-minus").disabled = gewuenschteAnzahl <= 1;
  $("wi-anzahl-plus").disabled = gewuenschteAnzahl >= fragen.length;
  $("wi-anzahl-zeile").hidden = !api.istLeiter;
  $("wi-starten").hidden = !api.istLeiter;
  $("wi-setup-warten").hidden = api.istLeiter;
}

function anzahlAendern(delta) {
  if (!api.istLeiter) return;
  gewuenschteAnzahl = Math.min(fragen.length, Math.max(1, gewuenschteAnzahl + delta));
  $("wi-anzahl-wert").textContent = String(gewuenschteAnzahl);
  $("wi-anzahl-minus").disabled = gewuenschteAnzahl <= 1;
  $("wi-anzahl-plus").disabled = gewuenschteAnzahl >= fragen.length;
}

async function setzeGrundzustand(wiStatus) {
  await updateDoc(api.raumRef(), {
    wiStatus, wiReihenfolge: [], wiFragenIndex: 0, wiAnzahlFragen: 0,
    wiHinweisIndex: 1, wiHinweisSeit: 0, wiGebuzzertVon: null,
    wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0
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
  $("wi-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    const anzahl = Math.min(gewuenschteAnzahl || fragen.length, fragen.length);
    const neueReihenfolge = mischeIndizes(fragen.map((_, i) => i)).slice(0, anzahl);
    await updateDoc(api.raumRef(), {
      wiStatus: "frage_aktiv", wiFragenIndex: 0, wiAnzahlFragen: anzahl,
      wiReihenfolge: neueReihenfolge, wiHinweisIndex: 1, wiHinweisSeit: Date.now(),
      wiGebuzzertVon: null, wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0
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

  const amZug = gebuzzertVon === api.spielerId;
  const jemandBuzzerte = !!gebuzzertVon;
  $("wi-buzzer").hidden = jemandBuzzerte;
  $("wi-buzzer").disabled = jemandBuzzerte;
  $("wi-antwort-bereich").hidden = !amZug;
  $("wi-ueberspringen").hidden = !api.istLeiter;

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
    const punkte = richtig ? Math.max(1, frage.hinweise.length - hinweisIndex + 1) : 0;
    await updateDoc(api.raumRef(), {
      wiStatus: "aufgeloest", wiAntwortText: text, wiAntwortKorrekt: richtig, wiPunkteDieserRunde: punkte
    });
    if (richtig) await updateDoc(api.spielerRef(), { punkte: increment(punkte) });
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
  [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0)).forEach((s) => {
    const hatGewonnen = s.id === gebuzzertVon && antwortKorrekt;
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
        wiGebuzzertVon: null, wiAntwortText: "", wiAntwortKorrekt: null, wiPunkteDieserRunde: 0
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
  $("wi-endstand-warten").hidden = api.istLeiter;
}

// Für lokale Logiktests exportiert; das Spiel selbst verwendet dieselben Funktionen.
export { istAntwortRichtig, mischeIndizes };
