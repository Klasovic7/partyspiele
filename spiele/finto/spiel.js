// ============================================================================
//  Finto
// ----------------------------------------------------------------------------
//  Eine Frage, die kaum jemand wirklich weiß (z. B. ein kurioses Fakten-
//  Quiz) - jede*r denkt sich eine möglichst glaubwürdige (falsche) Antwort
//  aus. Danach werden alle abgegebenen Antworten PLUS die echte richtige
//  Antwort gemeinsam und gemischt gezeigt; jede*r stimmt für die Antwort ab,
//  die sie/er für die echte hält (die eigene eigene Antwort kann man dabei
//  nicht wählen). Punkte:
//    - 2 Punkte für die Person, die die richtige Antwort erkennt.
//    - 1 Punkt für die Person, deren erfundene Antwort jemand fälschlicherweise
//      gewählt hat (pro hereingelegter Person).
//
//  Alle spielspezifischen Raumfelder beginnen mit "fi". Bluff-Antworten liegen
//  in der Subcollection "fiAntworten", Stimmen in "fiStimmen" (gleiches
//  Grundmuster wie "dgAntworten" in spiele/denk-gleich/spiel.js).
//
//  Status im Raum-Dokument:
//    setup         - Spielleiter stellt die Anzahl Fragen ein
//    antwort_aktiv - jede*r denkt sich eine Bluff-Antwort aus
//    abstimmung    - alle Antworten (gemischt) + die richtige werden gezeigt,
//                    jede*r stimmt für die vermeintlich richtige ab
//    ergebnis      - Auflösung: wer lag richtig, wer hat wen hereingelegt
//    beendet       - Endstand
// ============================================================================
import {
  doc, setDoc, deleteDoc, updateDoc, collection, getDocs, onSnapshot, serverTimestamp, writeBatch, increment
} from "../../kern/firebase.js";
import { spielerKarte, escapeHtml, avatarHtml, zeigeDebug } from "../../kern/ui.js";
import { speichereWertung } from "../../kern/wertung.js";

const RICHTIG_ID = "richtig";

const VORLAGE = `
  <div id="fi-setup" class="bildschirm-karte" hidden>
    <h1>🦉 Finto</h1>
    <p class="hinweis-text">Ihr bekommt eine Frage, die kaum jemand wirklich weiß. Denkt euch eine
      möglichst glaubwürdige Antwort aus! Danach seht ihr alle Antworten (plus die echte) gemischt und
      stimmt ab, welche die richtige ist: 2 Punkte fürs Erkennen, 1 Punkt für jede Person, die auf eure
      erfundene Antwort hereingefallen ist.</p>

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
    <p class="hinweis-text">Kennst du die Antwort nicht (das ist Absicht!) - denk dir eine aus, die
      möglichst echt klingt.</p>
    <p>
      <input id="fi-antwort" type="text" maxlength="120" autocomplete="off" placeholder="Deine (erfundene) Antwort">
      <button id="fi-absenden" class="btn-primaer">Antwort absenden</button>
    </p>
    <p id="fi-frage-fehler" class="fehler-text"></p>
    <p id="fi-frage-status"></p>
    <p><button id="fi-antworten-zeigen" class="btn-flach" hidden>Antworten jetzt zeigen</button></p>
  </div>

  <div id="fi-abstimmung-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Finto</p>
    <h2 id="fi-abst-frage"></h2>
    <p class="hinweis-text">Welche Antwort ist die echte? (Deine eigene könnt ihr nicht wählen.)</p>
    <ul id="fi-abst-liste" class="fi-kachel-raster"></ul>
    <p id="fi-abst-fehler" class="fehler-text"></p>
    <p id="fi-abst-status"></p>
    <p><button id="fi-auswertung-zeigen" class="btn-flach" hidden>Auswertung jetzt zeigen</button></p>
  </div>

  <div id="fi-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie">Finto</p>
    <h2 id="fi-erg-frage"></h2>
    <ul id="fi-erg-optionen" class="fi-kachel-raster"></ul>
    <h3>Punkte diese Runde</h3>
    <ul id="fi-erg-punkte"></ul>
    <p><button id="fi-weiter" hidden></button></p>
    <p id="fi-erg-warten" hidden><em>Warte auf den Spielleiter …</em></p>
  </div>

  <div id="fi-endstand-screen" class="bildschirm-karte" hidden>
    <h1>Endstand</h1>
    <ul id="fi-endstand-liste"></ul>
    <p id="fi-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

let api = null;
let fragen = [];
let el = {};
let spielerListe = [];
let alleAntworten = [];
let alleStimmen = [];
let antwortenUnsub = null;
let stimmenUnsub = null;

let status = null;
let index = -1;
let reihenfolge = [];
let anzahlFragen = 0;
let optionen = [];
let ergebnisAusgeloest = false;
let auswertungAusgeloest = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function frageAn(pos) {
  return fragen[reihenfolge[pos]];
}

function mischeReihenfolge(liste) {
  const indizes = liste.map((_, i) => i);
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
      fiStatus: "setup", fiFragenIndex: 0, fiReihenfolge: [], fiAnzahlFragen: 0, fiOptionen: []
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
  $("fi-antworten-zeigen").addEventListener("click", () => zurAbstimmung(true));
  $("fi-auswertung-zeigen").addEventListener("click", () => auswerten(true));
  $("fi-weiter").addEventListener("click", weiter);
}

function starteListener() {
  antwortenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "fiAntworten"), (snap) => {
    alleAntworten = [];
    snap.forEach((d) => alleAntworten.push(d.data()));
    aktualisiereFrageStatus();
  });
  stimmenUnsub = onSnapshot(collection(api.db, "raeume", api.code, "fiStimmen"), (snap) => {
    alleStimmen = [];
    snap.forEach((d) => alleStimmen.push(d.data()));
    aktualisiereAbstimmungStatus();
  });
}

export function beenden() {
  if (antwortenUnsub) { antwortenUnsub(); antwortenUnsub = null; }
  if (stimmenUnsub) { stimmenUnsub(); stimmenUnsub = null; }
  el = {};
  spielerListe = [];
  alleAntworten = [];
  alleStimmen = [];
  status = null;
  index = -1;
  reihenfolge = [];
  anzahlFragen = 0;
  optionen = [];
  ergebnisAusgeloest = false;
  auswertungAusgeloest = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  if (status === "ergebnis") zeigeErgebnis(index);
  if (status === "beendet") zeigeEndstand();
  aktualisiereFrageStatus();
  aktualisiereAbstimmungStatus();
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.fiStatus ?? null;
  reihenfolge = daten.fiReihenfolge ?? [];
  anzahlFragen = daten.fiAnzahlFragen ?? 0;
  optionen = daten.fiOptionen ?? [];

  const neuerIndex = daten.fiFragenIndex ?? 0;
  if (status === "antwort_aktiv" && index !== neuerIndex) {
    index = neuerIndex;
    $("fi-antwort").value = "";
    $("fi-antwort").disabled = false;
    $("fi-absenden").disabled = false;
    $("fi-frage-fehler").textContent = "";
    ergebnisAusgeloest = false;
    auswertungAusgeloest = false;
  } else {
    index = neuerIndex;
  }

  api.fortschritt(status && status !== "setup" ? `${index + 1}/${anzahlFragen}` : "");

  alleVerstecken();
  if (status === "setup" || !status) {
    zeigeSetup();
    $("fi-setup").hidden = false;
  } else if (status === "antwort_aktiv") {
    zeigeFrage(index);
    $("fi-frage-screen").hidden = false;
    aktualisiereFrageStatus();
  } else if (status === "abstimmung") {
    zeigeAbstimmung();
    $("fi-abstimmung-screen").hidden = false;
    aktualisiereAbstimmungStatus();
  } else if (status === "ergebnis") {
    zeigeErgebnis(index);
    $("fi-ergebnis-screen").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("fi-endstand-screen").hidden = false;
  }
}

function alleVerstecken() {
  ["fi-setup", "fi-frage-screen", "fi-abstimmung-screen", "fi-ergebnis-screen", "fi-endstand-screen"]
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
  const [antwortenSnap, stimmenSnap] = await Promise.all([
    getDocs(collection(api.db, "raeume", api.code, "fiAntworten")),
    getDocs(collection(api.db, "raeume", api.code, "fiStimmen"))
  ]);
  await Promise.all([
    ...antwortenSnap.docs.map((d) => deleteDoc(d.ref)),
    ...stimmenSnap.docs.map((d) => deleteDoc(d.ref)),
    ...spielerListe.map((s) => updateDoc(api.spielerRef(s.id), { punkte: 0 }))
  ]);
  alleAntworten = [];
  alleStimmen = [];
}

async function spielStarten() {
  $("fi-setup-fehler").textContent = "";
  if (spielerListe.length < 3) {
    $("fi-setup-fehler").textContent = "Für Finto braucht ihr mindestens drei Spieler.";
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
      fiStatus: "antwort_aktiv",
      fiFragenIndex: 0,
      fiReihenfolge: gemischt.slice(0, anzahl),
      fiAnzahlFragen: anzahl,
      fiOptionen: []
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
      fiStatus: null, fiFragenIndex: 0, fiReihenfolge: [], fiAnzahlFragen: 0, fiOptionen: []
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
  if (status !== "antwort_aktiv" || index < 0) return;
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

function stimmenDieserRunde(pos) {
  const aktiveIds = new Set(spielerListe.map((s) => s.id));
  return alleStimmen.filter((s) => s.fragenIndex === pos && aktiveIds.has(s.spielerId));
}

async function aktualisiereFrageStatus() {
  if (!el.wurzel || status !== "antwort_aktiv" || index < 0) return;
  const antworten = antwortenDieserRunde(index);
  const eigeneAntwort = antworten.find((a) => a.spielerId === api.spielerId);
  if (eigeneAntwort) {
    $("fi-antwort").value = eigeneAntwort.antwort;
    $("fi-antwort").disabled = true;
    $("fi-absenden").disabled = true;
  }
  $("fi-frage-status").textContent =
    `${eigeneAntwort ? "Deine Antwort ist gespeichert. " : ""}${antworten.length} von ${spielerListe.length} haben geantwortet`;

  if (api.istLeiter && !ergebnisAusgeloest && spielerListe.length >= 2 && antworten.length >= spielerListe.length) {
    await zurAbstimmung(false);
  }
}

async function zurAbstimmung(manuell) {
  if (status !== "antwort_aktiv" || ergebnisAusgeloest) return;
  const antworten = antwortenDieserRunde(index);
  if (manuell && antworten.length === 0) return;
  ergebnisAusgeloest = true;
  try {
    const frage = frageAn(index);
    const liste = [
      { id: RICHTIG_ID, text: frage.antwort },
      ...antworten.map((a) => ({ id: a.spielerId, text: a.antwort }))
    ];
    const gemischteIndizes = mischeReihenfolge(liste);
    const gemischteOptionen = gemischteIndizes.map((i) => liste[i]);
    await updateDoc(api.raumRef(), { fiStatus: "abstimmung", fiOptionen: gemischteOptionen });
  } catch (e) {
    ergebnisAusgeloest = false;
    zeigeDebug("Fehler beim Wechsel zur Abstimmung: " + e.message);
  }
}

function zeigeAbstimmung() {
  const frage = frageAn(index);
  $("fi-abst-frage").textContent = frage?.frage ?? "";
  const eigeneStimme = stimmenDieserRunde(index).find((s) => s.spielerId === api.spielerId);

  const liste = $("fi-abst-liste");
  liste.innerHTML = "";
  optionen.forEach((option) => {
    const eigene = option.id === api.spielerId;
    const li = document.createElement("li");
    li.className = "fi-kachel-wrapper";

    const pillText = eigene ? "Deine Finte" : "";
    const pillHtml = pillText ? `<span class="fi-kachel-pill fi-kachel-pill-eigene">${escapeHtml(pillText)}</span>` : "";

    if (eigene) {
      li.innerHTML = `${pillHtml}<div class="fi-kachel fi-kachel-eigene">${escapeHtml(option.text)}</div>`;
      liste.appendChild(li);
      return;
    }

    const ausgewaehlt = eigeneStimme?.gewaehlt === option.id;
    li.innerHTML =
      `<button type="button" class="fi-kachel fi-kachel-knopf${ausgewaehlt ? " ausgewaehlt" : ""}"${eigeneStimme ? " disabled" : ""}>` +
        escapeHtml(option.text) +
      `</button>`;
    if (!eigeneStimme) li.querySelector("button").addEventListener("click", () => stimmeAbgeben(option.id));
    liste.appendChild(li);
  });
  $("fi-auswertung-zeigen").hidden = !api.istLeiter;
}

async function stimmeAbgeben(gewaehlt) {
  if (status !== "abstimmung" || index < 0) return;
  $("fi-abst-fehler").textContent = "";
  try {
    await setDoc(doc(api.db, "raeume", api.code, "fiStimmen", `${api.spielerId}_${index}`), {
      spielerId: api.spielerId,
      fragenIndex: index,
      gewaehlt,
      zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    zeigeDebug("Fehler beim Abstimmen: " + e.message);
  }
}

async function aktualisiereAbstimmungStatus() {
  if (!el.wurzel || status !== "abstimmung" || index < 0) return;
  zeigeAbstimmung();
  const stimmen = stimmenDieserRunde(index);
  $("fi-abst-status").textContent = `${stimmen.length} von ${spielerListe.length} haben abgestimmt`;

  if (api.istLeiter && !auswertungAusgeloest && spielerListe.length >= 2 && stimmen.length >= spielerListe.length) {
    await auswerten(false);
  }
}

async function auswerten(manuell) {
  if (status !== "abstimmung" || auswertungAusgeloest) return;
  const stimmen = stimmenDieserRunde(index);
  if (manuell && stimmen.length === 0) return;
  auswertungAusgeloest = true;
  try {
    const punkte = {};
    stimmen.forEach((stimme) => {
      if (stimme.gewaehlt === RICHTIG_ID) {
        punkte[stimme.spielerId] = (punkte[stimme.spielerId] ?? 0) + 2;
      } else {
        punkte[stimme.gewaehlt] = (punkte[stimme.gewaehlt] ?? 0) + 1;
      }
    });
    const batch = writeBatch(api.db);
    Object.entries(punkte).forEach(([id, wert]) => {
      batch.update(api.spielerRef(id), { punkte: increment(wert) });
    });
    batch.update(api.raumRef(), { fiStatus: "ergebnis" });
    await batch.commit();
  } catch (e) {
    auswertungAusgeloest = false;
    zeigeDebug("Fehler bei der Auswertung: " + e.message);
  }
}

function berechneRundenpunkte(pos) {
  const stimmen = stimmenDieserRunde(pos);
  const punkte = {};
  stimmen.forEach((stimme) => {
    if (stimme.gewaehlt === RICHTIG_ID) {
      punkte[stimme.spielerId] = (punkte[stimme.spielerId] ?? 0) + 2;
    } else {
      punkte[stimme.gewaehlt] = (punkte[stimme.gewaehlt] ?? 0) + 1;
    }
  });
  return punkte;
}

function formatiertePunkte(punkte) {
  return punkte > 0 ? `+${punkte}` : "0";
}

function zeigeErgebnis(pos) {
  const frage = frageAn(pos);
  if (!frage) return;
  $("fi-erg-frage").textContent = frage.frage;

  const stimmen = stimmenDieserRunde(pos);
  const liste = $("fi-erg-optionen");
  liste.innerHTML = "";
  optionen.forEach((option) => {
    const waehlerSpieler = stimmen.filter((s) => s.gewaehlt === option.id)
      .map((s) => spielerListe.find((sp) => sp.id === s.spielerId))
      .filter(Boolean);
    const istRichtig = option.id === RICHTIG_ID;
    const istEigene = option.id === api.spielerId;

    let pillText;
    let pillKlasse = "";
    if (istRichtig) { pillText = "✅ Richtig"; pillKlasse = " fi-kachel-pill-richtig"; }
    else if (istEigene) { pillText = "Deine Finte"; pillKlasse = " fi-kachel-pill-eigene"; }
    else {
      const autor = spielerListe.find((sp) => sp.id === option.id);
      pillText = autor?.name ?? "jemand, der nicht mehr dabei ist";
    }

    const avatareHtml = waehlerSpieler.length
      ? waehlerSpieler.map((sp) => avatarHtml(sp.icon, "fi-erg-avatar")).join("")
      : `<span class="fi-erg-keine-stimmen">Von niemandem gewählt</span>`;

    const li = document.createElement("li");
    li.className = "fi-kachel-wrapper";
    li.innerHTML =
      `<span class="fi-kachel-pill${pillKlasse}">${escapeHtml(pillText)}</span>` +
      `<div class="fi-kachel fi-kachel-ergebnis${istRichtig ? " fi-kachel-richtig" : ""}">` +
        `<div class="fi-kachel-text">${escapeHtml(option.text)}</div>` +
        `<div class="fi-kachel-waehler">${avatareHtml}</div>` +
      `</div>`;
    liste.appendChild(li);
  });

  const rundenpunkte = berechneRundenpunkte(pos);
  const punkteListe = $("fi-erg-punkte");
  punkteListe.innerHTML = "";
  [...spielerListe]
    .sort((a, b) => (rundenpunkte[b.id] ?? 0) - (rundenpunkte[a.id] ?? 0))
    .forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = spielerKarte(
        s.name, s.farbe, s.icon, formatiertePunkte(rundenpunkte[s.id] ?? 0), { punkteRechts: s.punkte ?? 0 }
      );
      punkteListe.appendChild(li);
    });

  const weiterKnopf = $("fi-weiter");
  weiterKnopf.hidden = !api.istLeiter;
  weiterKnopf.textContent = pos + 1 >= anzahlFragen ? "Endstand anzeigen" : "Nächste Frage";
  $("fi-erg-warten").hidden = api.istLeiter;
}

async function weiter() {
  $("fi-weiter").disabled = true;
  try {
    const naechster = index + 1;
    if (naechster >= anzahlFragen) {
      await updateDoc(api.raumRef(), { fiStatus: "beendet" });
      speichereWertung(api, "finto", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
    } else {
      await updateDoc(api.raumRef(), { fiStatus: "antwort_aktiv", fiFragenIndex: naechster, fiOptionen: [] });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
  }
  $("fi-weiter").disabled = false;
}

function zeigeEndstand() {
  if (!el.wurzel) return;
  const sortiert = [...spielerListe].sort((a, b) => (b.punkte ?? 0) - (a.punkte ?? 0));
  const liste = $("fi-endstand-liste");
  liste.innerHTML = "";
  sortiert.forEach((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = spielerKarte(s.name, s.farbe, s.icon, s.punkte ?? 0, { rang: i + 1 });
    liste.appendChild(li);
  });
  $("fi-endstand-warten").hidden = api.istLeiter;
}
