// ============================================================================
//  Zeitgefühl!
// ----------------------------------------------------------------------------
//  Jede Runde bekommen alle Spieler*innen dieselbe zufällige Zielzeit (5-30
//  Sekunden) genannt. Nach einem "3, 2, 1, Los"-Countdown verschwindet die
//  Zahl und es ist nur noch ein großer roter Buzzer zu sehen - jede Person
//  zählt für sich "blind" mit und buzzert möglichst genau bei der Zielzeit.
//  Punkte gibt es nach Rang (wie bei Schätzfragen): wer am weitesten daneben
//  liegt, bekommt 0 Punkte, jeder Rang näher dran einen Punkt mehr; wer am
//  nächsten dran ist, bekommt zusätzlich einen Extrapunkt. Alle
//  spielspezifischen Raumfelder beginnen mit "zg"; die Buzzer-Zeiten liegen
//  getrennt in der Subcollection "zgAntworten".
// ============================================================================
import {
  doc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment, writeBatch
} from "../../kern/firebase.js";
import { spielerKarte, renderWarteAvatare, zeigeDebug, initBereitSystem } from "../../kern/ui.js";
import { speichereWertung } from "../../kern/wertung.js";

const ZIEL_MIN = 5;
const ZIEL_MAX = 30;
const COUNTDOWN_MS = 3000;
// Sicherheitsnetz: falls jemand nie buzzert (App im Hintergrund, Verbindung
// weg o. Ä.), wertet der Spielleiter die Runde spätestens nach dieser Zeit
// seit "Los" trotzdem aus - sonst würde die Runde für alle ewig hängen.
const TIMEOUT_SICHERHEIT_MS = 60000;
const MAX_RUNDEN = 30;
const STANDARD_ANZAHL = 5;

const VORLAGE = `
  <div id="zg-setup" class="bildschirm-karte" hidden>
    <h1>⏱️ Zeitgefühl!</h1>
    <p class="hinweis-text">Du bekommst eine Zielzeit genannt, zum Beispiel 7 Sekunden - alle im Raum
      bekommen dieselbe. Nach dem Countdown zeigt der Bildschirm nur noch einen Buzzer: zähl für dich
      lautlos mit und drück möglichst genau bei der Zielzeit. Wer am nächsten dran ist, bekommt die
      meisten Punkte - und einen Extrapunkt obendrauf.</p>

    <div id="zg-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Runden</span>
        <span class="anzahl-picker">
          <input id="zg-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
      <p id="zg-anzahl-max" class="hinweis-text"></p>
    </div>

    <p id="zg-setup-fehler" class="fehler-text"></p>
    <p><button id="zg-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="zg-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <div id="zg-bereit-bereich" class="bereit-bereich" hidden></div>
  </div>

  <div id="zg-vorbereitung-screen" class="bildschirm-karte zg-mitte" hidden>
    <p class="kategorie">Zeitgefühl!</p>
    <p class="zg-ziel-anzeige">Merke dir: <strong id="zg-ziel-wert"></strong> Sekunden</p>
    <p class="zg-countdown-ziffer" id="zg-countdown-ziffer"></p>
  </div>

  <div id="zg-buzzer-screen" class="bildschirm-karte zg-mitte" hidden>
    <div id="zg-flash" class="zg-flash-overlay" aria-hidden="true"></div>
    <p class="hinweis-text" id="zg-buzzer-hinweis">Zähl für dich mit und drück im richtigen Moment!</p>
    <p><button id="zg-buzzer" class="zg-buzzer-btn" type="button">BUZZER</button></p>
    <div id="zg-buzzer-status" class="warten-block"></div>
  </div>

  <div id="zg-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Zeitgefühl!</p>
    <h2 id="zg-erg-ziel"></h2>
    <ul id="zg-erg-liste"></ul>
    <p><button id="zg-weiter" hidden>Weiter</button></p>
  </div>

  <div id="zg-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <ul id="zg-endstand-liste"></ul>
    <p id="zg-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
    <p><button id="zg-gesamtwertung-btn" class="btn-primaer" type="button" hidden>Gesamtwertung</button></p>
  </div>
`;

let api = null;
let el = {};
let spielerListe = [];
let alleAntworten = [];
let antwortenUnsub = null;
let tickId = null;

let status = null;
let rundenIndex = -1;
let anzahlRunden = 0;
let zielSekunden = 0;
let vorbereitungSeit = 0;
let eigenerBuzzerGedrueckt = false;
let buzzerPhaseGezeigt = false;
let auswertungLaeuft = false;

// Bereit-System (siehe kern/ui.js) und Olympiade-Auto-Start wie bei allen
// anderen Spielen (siehe deren "olympiadeAutoStart"-Kommentare).
let bereitSystem = null;
let olympiadeAutoStart = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function zufaelligesZiel() {
  return Math.floor(Math.random() * (ZIEL_MAX - ZIEL_MIN + 1)) + ZIEL_MIN;
}

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;
  bereitSystem = initBereitSystem(api, "zg");
  olympiadeAutoStart = false;

  verdrahteBedienelemente();
  starteListener();

  if (api.istLeiter && !api.raum?.zgStatus) {
    await updateDoc(api.raumRef(), {
      zgStatus: "setup", zgRundenIndex: 0, zgAnzahlRunden: 0,
      zgZielSekunden: 0, zgVorbereitungSeit: 0
    });
  }

  // Treibt den Countdown ("3, 2, 1, Los") und den Übergang zur reinen
  // Buzzer-Ansicht rein lokal anhand von zgVorbereitungSeit voran - dadurch
  // funktioniert das auch bei einem verspäteten Beitritt/Reconnect sofort
  // richtig, ohne auf einen extra Statuswechsel vom Spielleiter zu warten.
  tickId = setInterval(rundenTick, 150);
}

function verdrahteBedienelemente() {
  $("zg-anzahl").addEventListener("input", () => {
    const feld = $("zg-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("zg-anzahl").addEventListener("change", () => {
    const feld = $("zg-anzahl");
    let wert = parseInt(feld.value, 10);
    if (!Number.isFinite(wert) || wert < 1) wert = 1;
    if (wert > MAX_RUNDEN) wert = MAX_RUNDEN;
    feld.value = String(wert);
  });
  $("zg-anzahl").addEventListener("focus", () => { $("zg-anzahl").select(); });
  $("zg-starten").addEventListener("click", spielStarten);
  $("zg-buzzer").addEventListener("click", buzzerGedrueckt);
  $("zg-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "zgAntworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    if (status === "runde_aktiv") aktualisiereBuzzerStatus();
    if (status === "ausgewertet") zeigeErgebnisListe(rundenIndex);
  });
}

export function beenden() {
  bereitSystem = null;
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  if (tickId) { clearInterval(tickId); tickId = null; }
  el = {};
  spielerListe = [];
  alleAntworten = [];
  status = null;
  rundenIndex = -1;
  anzahlRunden = 0;
  zielSekunden = 0;
  vorbereitungSeit = 0;
  eigenerBuzzerGedrueckt = false;
  buzzerPhaseGezeigt = false;
  auswertungLaeuft = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "runde_aktiv") aktualisiereBuzzerStatus();
  if (status === "ausgewertet" && rundenIndex >= 0) zeigeErgebnisListe(rundenIndex);
  if (status === "beendet") zeigeEndstand();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.zgStatus ?? null;
  anzahlRunden = daten.zgAnzahlRunden ?? 0;

  const neuerIndex = daten.zgRundenIndex ?? 0;
  const neuesZiel = daten.zgZielSekunden ?? 0;
  const neuerStart = daten.zgVorbereitungSeit ?? 0;
  if (status === "runde_aktiv" && (rundenIndex !== neuerIndex || vorbereitungSeit !== neuerStart)) {
    rundenIndex = neuerIndex;
    zielSekunden = neuesZiel;
    vorbereitungSeit = neuerStart;
    eigenerBuzzerGedrueckt = false;
    buzzerPhaseGezeigt = false;
    auswertungLaeuft = false;
    $("zg-buzzer").disabled = false;
    $("zg-buzzer-hinweis").textContent = "Zähl für dich mit und drück im richtigen Moment!";
  } else if (status === "ausgewertet") {
    rundenIndex = neuerIndex;
    zielSekunden = neuesZiel;
  }

  api.fortschritt(
    status === "runde_aktiv" || status === "ausgewertet" ? `${rundenIndex + 1}/${anzahlRunden}` : ""
  );

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("zg-setup").hidden = false;
  } else if (status === "runde_aktiv") {
    rundenTick();
  } else if (status === "ausgewertet") {
    zeigeErgebnis(rundenIndex);
    $("zg-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("zg-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["zg-setup", "zg-vorbereitung-screen", "zg-buzzer-screen", "zg-ergebnis-screen", "zg-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

function zeigeSetup() {
  const anzahlFeld = $("zg-anzahl");
  anzahlFeld.max = MAX_RUNDEN;
  const inOlympiade = Boolean(api.olympiadeAnzahl);
  if (inOlympiade) {
    // Gleiches Muster wie bei allen anderen Spielen (siehe deren "v201/v202-
    // Fix"-Kommentare): bei jedem Render fest aus api.olympiadeAnzahl setzen
    // und komplett sperren, statt sich auf einen einmaligen Prefill zu
    // verlassen - sonst kann ein erneutes Rendern (z. B. durch einen
    // weiteren Bereit-Klick) das Feld wieder zurücksetzen.
    const festgelegt = Math.min(Math.max(1, api.olympiadeAnzahl), MAX_RUNDEN);
    anzahlFeld.value = String(festgelegt);
    $("zg-anzahl-max").textContent =
      `In der Olympiade festgelegt: ${festgelegt} ${festgelegt === 1 ? "Runde" : "Runden"}.`;
    anzahlFeld.disabled = true;
  } else {
    if (!anzahlFeld.value) anzahlFeld.value = String(STANDARD_ANZAHL);
    $("zg-anzahl-max").textContent =
      `Zielzeiten zwischen ${ZIEL_MIN} und ${ZIEL_MAX} Sekunden, bis zu ${MAX_RUNDEN} Runden.`;
    anzahlFeld.disabled = !api.istLeiter;
  }
  $("zg-anzahl-zeile").hidden = false;
  $("zg-starten").hidden = !api.istLeiter;
  $("zg-setup-warten").hidden = api.istLeiter;
  bereitSystem?.render();

  if (api.istLeiter && api.olympiadeAnzahl && !olympiadeAutoStart && bereitSystem?.alleBereit()) {
    olympiadeAutoStart = true;
    spielStarten();
  }
}

async function spielStarten() {
  $("zg-setup-fehler").textContent = "";
  if (spielerListe.length < 1) {
    $("zg-setup-fehler").textContent = "Für Zeitgefühl! braucht ihr mindestens einen Spieler.";
    return;
  }

  let anzahl = parseInt($("zg-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > MAX_RUNDEN) anzahl = MAX_RUNDEN;

  $("zg-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      zgStatus: "runde_aktiv",
      zgRundenIndex: 0,
      zgAnzahlRunden: anzahl,
      zgZielSekunden: zufaelligesZiel(),
      zgVorbereitungSeit: Date.now()
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("zg-starten").disabled = false;
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "zgAntworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  alleAntworten = [];
  await Promise.all(spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 })));
}

export async function vorZurueck() {
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      zgStatus: null, zgRundenIndex: 0, zgAnzahlRunden: 0,
      zgZielSekunden: 0, zgVorbereitungSeit: 0
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

// Wird alle 150ms aufgerufen, solange eine Runde läuft ("runde_aktiv") -
// zeigt je nach vergangener Zeit seit zgVorbereitungSeit entweder den
// Countdown mit Zielzeit (die ersten COUNTDOWN_MS) oder danach ausschließlich
// den Buzzer (die Zahl bleibt dann bewusst verborgen - "blind" schätzen).
function rundenTick() {
  if (!el.wurzel || status !== "runde_aktiv") return;
  const elapsedGesamt = Date.now() - vorbereitungSeit;

  if (elapsedGesamt < COUNTDOWN_MS) {
    $("zg-buzzer-screen").hidden = true;
    $("zg-vorbereitung-screen").hidden = false;
    $("zg-ziel-wert").textContent = String(zielSekunden);
    const schritt = Math.min(2, Math.floor(elapsedGesamt / (COUNTDOWN_MS / 3)));
    $("zg-countdown-ziffer").textContent = ["3", "2", "1"][schritt];
  } else {
    $("zg-vorbereitung-screen").hidden = true;
    $("zg-buzzer-screen").hidden = false;
    if (!buzzerPhaseGezeigt) {
      buzzerPhaseGezeigt = true;
      aktualisiereBuzzerStatus();
    }
  }

  if (api.istLeiter) pruefeAuswertung(elapsedGesamt);
}

function antwortenDieserRunde(pos) {
  const aktiveIds = new Set(spielerListe.map((s) => s.id));
  return alleAntworten.filter((a) => a.rundenIndex === pos && aktiveIds.has(a.spielerId));
}

function aktualisiereBuzzerStatus() {
  if (!el.wurzel) return;
  const antworten = antwortenDieserRunde(rundenIndex);
  const geantwortetIds = new Set(antworten.map((a) => a.spielerId));
  eigenerBuzzerGedrueckt = geantwortetIds.has(api.spielerId);
  $("zg-buzzer").disabled = eigenerBuzzerGedrueckt;
  $("zg-buzzer-hinweis").textContent = eigenerBuzzerGedrueckt
    ? "Gebuzzert! Warte auf die anderen …"
    : "Zähl für dich mit und drück im richtigen Moment!";
  renderWarteAvatare($("zg-buzzer-status"), spielerListe.filter((sp) => !geantwortetIds.has(sp.id)));
}

async function buzzerGedrueckt() {
  if (status !== "runde_aktiv" || eigenerBuzzerGedrueckt) return;
  const elapsedGesamt = Date.now() - vorbereitungSeit;
  if (elapsedGesamt < COUNTDOWN_MS) return;
  const elapsedMs = elapsedGesamt - COUNTDOWN_MS;

  eigenerBuzzerGedrueckt = true;
  $("zg-buzzer").disabled = true;
  $("zg-buzzer-hinweis").textContent = "Gebuzzert! Warte auf die anderen …";
  try {
    await setDoc(doc(api.db, "raeume", api.code, "zgAntworten", `${api.spielerId}_${rundenIndex}`), {
      spielerId: api.spielerId,
      spielerName: api.spielerName,
      rundenIndex,
      elapsedMs,
      zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    eigenerBuzzerGedrueckt = false;
    $("zg-buzzer").disabled = false;
    zeigeDebug("Fehler beim Buzzern: " + e.message);
  }
}

function abstandVon(antwort, zielMs) {
  return antwort.elapsedMs == null ? Infinity : Math.abs(antwort.elapsedMs - zielMs);
}

// Rang-Punkte wie bei Schätzfragen (wer am weitesten weg ist, bekommt 0
// Punkte; jeder Rang näher dran +1; Gleichstand teilt sich denselben Wert) -
// abweichend davon gibt es den Extrapunkt hier nicht nur bei exaktem Treffer,
// sondern für den/die Spieler*in mit dem kleinsten Abstand insgesamt (ein
// exakter Treffer auf die Millisekunde ist bei "blindem" Zeitschätzen
// praktisch nicht erreichbar). Wer gar nicht gebuzzert hat (Timeout), gilt
// als unendlich weit weg und bekommt nie den Extrapunkt.
function berechnePunkteFuerAntworten(antwortenListe, zielSekundenWert) {
  const zielMs = zielSekundenWert * 1000;
  const sortiert = [...antwortenListe].sort((a, b) => abstandVon(a, zielMs) - abstandVon(b, zielMs));
  const ergebnis = {};
  let vorherigerAbstand = null;
  let vorherigeRangpunkte = null;
  const kleinsterAbstand = sortiert.length ? abstandVon(sortiert[0], zielMs) : Infinity;

  sortiert.forEach((antwort, i) => {
    const abstand = abstandVon(antwort, zielMs);
    const rangpunkte = (vorherigerAbstand !== null && abstand === vorherigerAbstand)
      ? vorherigeRangpunkte
      : sortiert.length - 1 - i;
    const siegerBonus = Number.isFinite(kleinsterAbstand) && abstand === kleinsterAbstand ? 1 : 0;
    ergebnis[antwort.spielerId] = rangpunkte + siegerBonus;
    vorherigerAbstand = abstand;
    vorherigeRangpunkte = rangpunkte;
  });
  return ergebnis;
}

function berechneRundenpunkte(pos) {
  return berechnePunkteFuerAntworten(antwortenDieserRunde(pos), zielSekunden);
}

async function pruefeAuswertung(elapsedGesamt) {
  if (!api.istLeiter || status !== "runde_aktiv" || auswertungLaeuft) return;
  if (elapsedGesamt < COUNTDOWN_MS || spielerListe.length === 0) return;

  const elapsedBuzzer = elapsedGesamt - COUNTDOWN_MS;
  const antworten = antwortenDieserRunde(rundenIndex);
  const geantwortetIds = new Set(antworten.map((a) => a.spielerId));
  const fehlend = spielerListe.filter((sp) => !geantwortetIds.has(sp.id));
  const zeitAbgelaufen = elapsedBuzzer >= TIMEOUT_SICHERHEIT_MS;
  if (fehlend.length > 0 && !zeitAbgelaufen) return;

  auswertungLaeuft = true;
  try {
    if (fehlend.length > 0) {
      await Promise.all(fehlend.map((sp) =>
        setDoc(doc(api.db, "raeume", api.code, "zgAntworten", `${sp.id}_${rundenIndex}`), {
          spielerId: sp.id, spielerName: sp.name, rundenIndex, elapsedMs: null, zeitpunkt: serverTimestamp()
        })
      ));
    }
    // Nicht auf den lokalen Cache (alleAntworten) warten, ob die gerade
    // geschriebenen "fehlend"-Dokumente schon per Snapshot angekommen sind -
    // direkt mit der kombinierten Liste rechnen, um keinen Race entstehen
    // zu lassen (gleiches Prinzip wie speichereWertung: einmalig, verlässlich).
    const kombiniert = [...antworten, ...fehlend.map((sp) => ({ spielerId: sp.id, elapsedMs: null }))];
    const punkte = berechnePunkteFuerAntworten(kombiniert, zielSekunden);
    const batch = writeBatch(api.db);
    Object.entries(punkte).forEach(([id, wert]) => {
      batch.update(api.spielerRef(id), { punkte: increment(wert) });
    });
    batch.update(api.raumRef(), { zgStatus: "ausgewertet" });
    await batch.commit();
  } catch (e) {
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
  auswertungLaeuft = false;
}

function formatiertePunkte(punkte) {
  return punkte > 0 ? `+${punkte}` : "0";
}

function formatZeit(elapsedMs) {
  if (elapsedMs == null) return "Nicht gebuzzert";
  return `${(elapsedMs / 1000).toFixed(2)} s`;
}

function zeigeErgebnisListe(pos) {
  if (!el.wurzel) return;
  const rundenpunkte = berechneRundenpunkte(pos);
  const sortiert = [...antwortenDieserRunde(pos)].sort((a, b) => {
    const punkteDifferenz = (rundenpunkte[b.spielerId] ?? 0) - (rundenpunkte[a.spielerId] ?? 0);
    if (punkteDifferenz !== 0) return punkteDifferenz;
    return (a.spielerName || "").localeCompare(b.spielerName || "", "de");
  });

  const liste = $("zg-erg-liste");
  liste.innerHTML = "";
  sortiert.forEach((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      antwort.spielerName,
      s?.farbe,
      s?.icon,
      formatiertePunkte(rundenpunkte[antwort.spielerId] ?? 0),
      { extra: `Zeit: ${formatZeit(antwort.elapsedMs)}`, punkteRechts: s ? (s.punkte ?? 0) : "?" }
    );
    liste.appendChild(li);
  });
}

function zeigeErgebnis(pos) {
  $("zg-erg-ziel").textContent = `Ziel: ${zielSekunden} Sekunden`;
  zeigeErgebnisListe(pos);
  $("zg-weiter").hidden = !api.istLeiter;
  $("zg-weiter").textContent = pos + 1 >= anzahlRunden ? "Endstand anzeigen" : "Nächste Runde";
}

async function weiter() {
  $("zg-weiter").disabled = true;
  try {
    const naechster = rundenIndex + 1;
    if (naechster >= anzahlRunden) {
      await updateDoc(api.raumRef(), { zgStatus: "beendet" });
      speichereWertung(api, "zeitgefuehl", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), {
        zgStatus: "runde_aktiv",
        zgRundenIndex: naechster,
        zgZielSekunden: zufaelligesZiel(),
        zgVorbereitungSeit: Date.now()
      });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("zg-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("zg-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  $("zg-endstand-warten").hidden = api.istLeiter;
  const zgGesamtwertungBtn = $("zg-gesamtwertung-btn");
  if (zgGesamtwertungBtn) {
    zgGesamtwertungBtn.hidden = !(api.istLeiter && Boolean(api.olympiadeAnzahl));
    zgGesamtwertungBtn.onclick = () => api.zeigeGesamtwertung();
  }
}

// Für kleine lokale Tests exportiert; die Spiellogik nutzt dieselben Funktionen.
export { berechnePunkteFuerAntworten };
