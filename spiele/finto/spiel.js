// ============================================================================
//  Finto
// ----------------------------------------------------------------------------
//  Es wird eine offene Frage gestellt, jede*r gibt dazu die eigene Antwort ab.
//  Sobald alle geantwortet haben (oder der Spielleiter das manuell auslöst),
//  werden alle Antworten gemeinsam angezeigt - diskutiert und geraten wird am
//  Tisch, die App zählt hier bewusst keine Punkte (anders als "Denk gleich!",
//  wo gleiche Antworten Punkte geben - bei Finto geht es ums Vorlesen und
//  Rätseln, nicht ums Punkten).
//
//  Alle spielspezifischen Raumfelder beginnen mit "fi"; Antworten liegen
//  getrennt in der Subcollection "fiAntworten" (gleiches Muster wie
//  "dgAntworten" in spiele/denk-gleich/spiel.js).
//
//  Hinweis: Diese erste Version wurde nach der Beschreibung "eine Frage wird
//  gestellt und jede*r gibt eine Antwort dazu ab" gebaut - ein Abgleich mit
//  der echten Finto-App war wegen einer aktuellen Störung der Websuche nicht
//  möglich. Falls das Original noch einen zusätzlichen Kniff hat (z. B. eine
//  abweichende Frage für eine Person), bitte kurz Bescheid geben.
// ============================================================================
import {
  doc, setDoc, deleteDoc, updateDoc, collection, getDocs, onSnapshot, serverTimestamp
} from "../../kern/firebase.js";
import { spielerKarte, zeigeDebug } from "../../kern/ui.js";

const VORLAGE = `
  <div id="fi-setup" class="bildschirm-karte" hidden>
    <h1>🦉 Finto</h1>
    <p class="hinweis-text">Ihr bekommt eine Frage - jede*r gibt in Ruhe die eigene Antwort ab. Sobald alle
      fertig sind, werden alle Antworten gemeinsam gezeigt: lest sie vor und ratet, wer was geschrieben hat.</p>

    <div id="fi-anzahl-zeile" class="setup-anzahlblock" hidden>
      <div class="setup-anzahl-zeile">
        <span>Anzahl Fragen</span>
        <span class="anzahl-picker">
          <input id="fi-anzahl" type="text" inputmode="numeric" pattern="[0-9]*" min="1" class="anzahl-eingabe">
        </span>
      </div>
    </div>

    <p id="fi-setup-fehler" class="fehler-text"></p>
    <p><button id="fi-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="fi-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
  </div>

  <div id="fi-frage-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Finto</p>
    <h2 id="fi-frage-text"></h2>
    <p>
      <input id="fi-antwort" type="text" maxlength="120" autocomplete="off" placeholder="Deine Antwort">
      <button id="fi-absenden" class="btn-primaer">Antwort absenden</button>
    </p>
    <p id="fi-frage-fehler" class="fehler-text"></p>
    <p id="fi-frage-status"></p>
    <p><button id="fi-antworten-zeigen" class="btn-flach" hidden>Antworten jetzt zeigen</button></p>
  </div>

  <div id="fi-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Finto</p>
    <h2 id="fi-erg-frage"></h2>
    <ul id="fi-erg-liste"></ul>
    <p><button id="fi-weiter" hidden></button></p>
    <p id="fi-erg-warten" hidden><em>Warte auf den Spielleiter …</em></p>
  </div>

  <div id="fi-endstand-screen" class="bildschirm-karte" hidden>
    <h1>🦉 Das war's!</h1>
    <p class="hinweis-text">Finto läuft ohne Punktestand - der Spaß steckt im Vorlesen und Raten.</p>
    <p id="fi-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
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
let reihenfolge = [];
let anzahlFragen = 0;
let ergebnisAusgeloest = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function frageAn(pos) {
  return fragen[reihenfolge[pos]];
}

function mischeReihenfolge(fragenListe) {
  const indizes = fragenListe.map((_, i) => i);
  for (let i = indizes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indizes[i], indizes[j]] = [indizes[j], indizes[i]];
  }
  return indizes;
}

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

  if (api.istLeiter && !api.raum?.fiStatus) {
    await updateDoc(api.raumRef(), {
      fiStatus: "setup", fiFragenIndex: 0, fiReihenfolge: [], fiAnzahlFragen: 0
    });
  }
}

function verdrahteBedienelemente() {
  $("fi-anzahl").addEventListener("input", () => {
    const feld = $("fi-anzahl");
    const bereinigt = feld.value.replace(/[^0-9]/g, "");
    if (bereinigt !== feld.value) feld.value = bereinigt;
  });
  $("fi-anzahl").addEventListener("focus", () => { $("fi-anzahl").select(); });
  $("fi-starten").addEventListener("click", spielStarten);
  $("fi-absenden").addEventListener("click", antwortAbsenden);
  $("fi-antwort").addEventListener("keydown", (e) => {
    if (e.key === "Enter") antwortAbsenden();
  });
  $("fi-antworten-zeigen").addEventListener("click", () => auswerten(true));
  $("fi-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "fiAntworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereAntworten();
  });
}

export function beenden() {
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  el = {};
  spielerListe = [];
  alleAntworten = [];
  status = null;
  index = -1;
  reihenfolge = [];
  anzahlFragen = 0;
  ergebnisAusgeloest = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "ergebnis") zeigeErgebnisListe(index);
  if (status === "beendet") zeigeEndstand();
  aktualisiereAntworten();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.fiStatus ?? null;
  reihenfolge = daten.fiReihenfolge ?? [];
  anzahlFragen = daten.fiAnzahlFragen ?? 0;

  const neuerIndex = daten.fiFragenIndex ?? 0;
  if (status === "frage_aktiv" && index !== neuerIndex) {
    index = neuerIndex;
    $("fi-antwort").value = "";
    $("fi-antwort").disabled = false;
    $("fi-absenden").disabled = false;
    $("fi-frage-fehler").textContent = "";
    ergebnisAusgeloest = false;
  } else if (status === "ergebnis") {
    index = neuerIndex;
  }

  api.fortschritt(status === "frage_aktiv" || status === "ergebnis" ? `${index + 1}/${anzahlFragen}` : "");

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("fi-setup").hidden = false;
  } else if (status === "frage_aktiv") {
    zeigeFrage(index);
    $("fi-frage-screen").hidden = false;
    aktualisiereAntworten();
  } else if (status === "ergebnis") {
    zeigeErgebnis(index);
    $("fi-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("fi-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["fi-setup", "fi-frage-screen", "fi-ergebnis-screen", "fi-endstand-screen"]
    .forEach((id) => { $(id).hidden = true; });
}

function zeigeSetup() {
  const anzahlFeld = $("fi-anzahl");
  anzahlFeld.max = fragen.length;
  if (!anzahlFeld.value) anzahlFeld.value = fragen.length;
  $("fi-anzahl-zeile").hidden = false;
  anzahlFeld.disabled = !api.istLeiter;
  $("fi-starten").hidden = !api.istLeiter;
  $("fi-setup-warten").hidden = api.istLeiter;
}

async function raeumeSpieldatenAuf() {
  const snap = await getDocs(collection(api.db, "raeume", api.code, "fiAntworten"));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  alleAntworten = [];
}

async function spielStarten() {
  $("fi-setup-fehler").textContent = "";
  if (spielerListe.length < 2) {
    $("fi-setup-fehler").textContent = "Für Finto braucht ihr mindestens zwei Spieler.";
    return;
  }

  let anzahl = parseInt($("fi-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > fragen.length) anzahl = fragen.length;

  const gemischt = mischeReihenfolge(fragen);

  $("fi-starten").disabled = true;
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      fiStatus: "frage_aktiv",
      fiFragenIndex: 0,
      fiReihenfolge: gemischt.slice(0, anzahl),
      fiAnzahlFragen: anzahl
    });
  } catch (e) {
    zeigeDebug("Fehler beim Start: " + e.message);
  }
  $("fi-starten").disabled = false;
}

export async function vorZurueck() {
  try {
    await raeumeSpieldatenAuf();
    await updateDoc(api.raumRef(), {
      fiStatus: null, fiFragenIndex: 0, fiReihenfolge: [], fiAnzahlFragen: 0
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
  }
}

function zeigeFrage(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("fi-frage-text").textContent = frage.frage;
  $("fi-antworten-zeigen").hidden = !api.istLeiter;
}

async function antwortAbsenden() {
  if (status !== "frage_aktiv" || index < 0) return;
  const feld = $("fi-antwort");
  const antwort = feld.value.trim();
  if (!antwort) {
    $("fi-frage-fehler").textContent = "Bitte gib zuerst eine Antwort ein.";
    return;
  }

  $("fi-frage-fehler").textContent = "";
  feld.disabled = true;
  $("fi-absenden").disabled = true;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "fiAntworten", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId,
      spielerName: api.spielerName,
      fragenIndex: index,
      antwort,
      zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    feld.disabled = false;
    $("fi-absenden").disabled = false;
    zeigeDebug("Fehler beim Absenden: " + e.message);
  }
}

function antwortenDieserRunde(pos) {
  const aktiveIds = new Set(spielerListe.map((s) => s.id));
  return alleAntworten.filter((a) => a.fragenIndex === pos && aktiveIds.has(a.spielerId));
}

async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const antworten = antwortenDieserRunde(index);
  const eigeneAntwort = antworten.find((a) => a.spielerId === api.spielerId);
  if (status === "frage_aktiv" && eigeneAntwort) {
    $("fi-antwort").value = eigeneAntwort.antwort;
    $("fi-antwort").disabled = true;
    $("fi-absenden").disabled = true;
  }
  $("fi-frage-status").textContent =
    `${eigeneAntwort ? "Deine Antwort ist gespeichert. " : ""}${antworten.length} von ${spielerListe.length} haben geantwortet`;
  if (status === "ergebnis") zeigeErgebnisListe(index);

  if (api.istLeiter && status === "frage_aktiv" && !ergebnisAusgeloest &&
      spielerListe.length >= 2 && antworten.length >= spielerListe.length) {
    await auswerten(false);
  }
}

async function auswerten(manuell) {
  if (status !== "frage_aktiv" || ergebnisAusgeloest) return;
  if (manuell && antwortenDieserRunde(index).length === 0) return;
  ergebnisAusgeloest = true;
  try {
    await updateDoc(api.raumRef(), { fiStatus: "ergebnis" });
  } catch (e) {
    ergebnisAusgeloest = false;
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
}

function zeigeErgebnisListe(pos) {
  if (!el.wurzel) return;
  const antworten = [...antwortenDieserRunde(pos)].sort((a, b) => a.spielerName.localeCompare(b.spielerName, "de"));
  const liste = $("fi-erg-liste");
  liste.innerHTML = "";
  antworten.forEach((antwort) => {
    const s = spielerListe.find((x) => x.id === antwort.spielerId);
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(
      antwort.spielerName, s?.farbe, s?.icon, "", { extra: `Antwort: ${antwort.antwort}`, punkteLinks: false }
    );
    liste.appendChild(li);
  });
}

function zeigeErgebnis(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("fi-erg-frage").textContent = frage.frage;
  zeigeErgebnisListe(pos);
  const weiterKnopf = $("fi-weiter");
  weiterKnopf.hidden = !api.istLeiter;
  weiterKnopf.textContent = pos + 1 >= anzahlFragen ? "Beenden" : "Nächste Frage";
  $("fi-erg-warten").hidden = api.istLeiter;
}

async function weiter() {
  $("fi-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { fiStatus: "beendet" });
    } else {
      await updateDoc(api.raumRef(), { fiStatus: "frage_aktiv", fiFragenIndex: naechster });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("fi-weiter").disabled = false;
}

function zeigeEndstand() {
  $("fi-endstand-warten").hidden = api.istLeiter;
}
