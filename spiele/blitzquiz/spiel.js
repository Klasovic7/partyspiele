// ============================================================================
//  Blitzquiz
// ----------------------------------------------------------------------------
//  Drei verschiedene Frage-Mechaniken, gemischt in einer Runde (jede Frage
//  trägt in fragen.json ein Feld "typ") - ALLE auf Zeit, die schnellste
//  richtige Antwort bekommt jeweils die meisten Punkte:
//
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
//    "bild"  - Bild-Reveal: ein Bild startet stark unscharf, alle 10 Sekunden
//              wird es (für alle gleich) einen Schritt schärfer, bis auf den
//              letzten Schritt (der bleibt immer leicht unscharf). Wie bei
//              "wort" wird nur eine bereits richtige Lösung gespeichert -
//              Punktevergabe genauso: schnellste korrekte Lösung gewinnt.
//
//  Alle Felder dieses Spiels im Raum-Dokument beginnen mit "bz". Antworten
//  liegen (wie bei Schätzfragen) in einer eigenen Unter-Sammlung
//  "raeume/{code}/bzantworten", damit der Spielleiter live sieht, wer schon
//  geantwortet hat, ohne dass alle Geräte gleichzeitig ins Raum-Dokument
//  schreiben müssen. Jeder Eintrag trägt ein Feld "richtig" (true/false).
//  Bei "wort"/"bild" ist EIN Versuch pro Runde erlaubt - liegt man falsch,
//  ist man für den Rest der Runde gesperrt (kein erneutes Tippen), damit die
//  Runde trotzdem zuverlässig endet, sobald alle entweder gelöst haben oder
//  gesperrt sind. Es gibt keinen manuellen "Runde auswerten"-Knopf mehr -
//  als Sicherheitsnetz gegen eine hängende Runde (falls jemand gar nicht
//  reagiert) wertet der Spielleiter nach FRAGE_TIMEOUT_MS automatisch aus.
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
import { speichereWertung } from "../../kern/wertung.js";

const AUFDECK_DAUER_MS = 10000;
const STANDARD_ANZAHL = 10;
// Sicherheitsnetz: es gibt keinen manuellen "Runde auswerten"-Knopf mehr, also
// wertet der Spielleiter eine Runde spätestens nach dieser Zeit automatisch
// aus - auch wenn nicht alle geantwortet/gelöst/sich verbraucht haben (z. B.
// weil jemand gar nicht reagiert).
const FRAGE_TIMEOUT_MS = 90000;
// "bild": die Unschärfe nimmt kontinuierlich ab (nicht in Stufen) und endet
// nach BILD_SCHARF_DAUER_MS beim Originalbild in voller Schärfe.
const BILD_BLUR_START_PX = 26;
const BILD_SCHARF_DAUER_MS = 40000;

const TYP_LABEL = { speed: "Schnelligkeit", wort: "Wortrate", bild: "Bild-Reveal" };

const VORLAGE = `
  <div id="bz-setup" class="bildschirm-karte" hidden>
    <p class="hinweis-text">Drei Frage-Typen im Wechsel, alle auf Zeit: Mehrfachauswahl
      auf Schnelligkeit, ein Buchstaben-Rätsel und ein Bild, das sich langsam
      schärfer zeigt. Überall bekommt die schnellste richtige Antwort die
      meisten Punkte.</p>

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
      <div id="bz-buchstaben-reihe" class="bz-buchstaben-reihe" hidden></div>
      <div id="bz-bild-anzeige" class="bz-bild-anzeige" hidden></div>
      <p class="bz-countdown" id="bz-countdown"></p>
      <p class="bz-antwort-zeile">
        <input id="bz-wort-eingabe" type="text" placeholder="Deine Lösung" autocomplete="off">
        <button id="bz-wort-absenden">Absenden</button>
      </p>
      <p id="bz-wort-fehler" class="fehler-text"></p>
      <p id="bz-wort-status-eigenes" class="hinweis-text" hidden>✅ Du hast es gelöst - warte auf die anderen.</p>
      <p id="bz-wort-status-falsch" class="hinweis-text" hidden>❌ Leider falsch - du bist für diese Runde raus. Warte auf die anderen.</p>
    </div>

    <p id="bz-frage-status" class="hinweis-text"></p>
  </div>

  <div id="bz-ergebnis-screen" class="bildschirm-karte" hidden>
    <p class="kategorie" id="bz-erg-typ"></p>
    <h2 id="bz-erg-frage"></h2>
    <p id="bz-erg-antwort-zeile">Richtige Antwort: <strong id="bz-erg-antwort"></strong></p>
    <div id="bz-erg-bild" class="bz-bild-anzeige" hidden></div>
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
// Merkt sich die eigene Antwort sofort beim Absenden, unabhängig vom
// Firestore-Listener. Der Mock (und in seltenen Fällen auch das echte
// Firestore) kann den Raum-Listener neu auslösen, bevor die eigene
// Antwort in alleAntworten angekommen ist - ohne dieses lokale Gedächtnis
// würde ein zwischenzeitliches zeigeFrage() den gerade gesetzten
// "gesperrt/hervorgehoben"-Zustand wieder zurücksetzen.
let eigeneAntwortenLokal = {};

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

// Wie eigeneAntwort(), aber fällt auf den lokal-optimistisch gemerkten Wert
// zurück, solange der Listener die eigene Antwort noch nicht bestätigt hat.
function eigeneAntwortAnzeige(pos) {
  return eigeneAntwort(pos) || eigeneAntwortenLokal[pos] || null;
}

// ============================================================================
//  Start
// ============================================================================
export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  if (fragen.length === 0) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url), { cache: "no-store" });
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    fragen = await antwort.json();
  }

  verdrahteBedienelemente();
  starteListener();

  if (api.istLeiter && !api.raum?.bzStatus) {
    await setzeGrundzustand("setup");
  }

  timerId = setInterval(() => { aktualisiereCountdown(); pruefeAufdeckFortschritt(); pruefeZeitlimit(); aktualisiereBildSchaerfe(); }, 300);
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
  // Firestore erlaubt keine verschachtelten Arrays - pro Frage wird die
  // Buchstaben-Reihenfolge deshalb als kommagetrennte Zeichenkette abgelegt
  // und hier wieder in ein Zahlen-Array zurückverwandelt.
  buchstabenReihenfolgen = (daten.bzBuchstabenReihenfolgen ?? []).map((eintrag) =>
    eintrag ? eintrag.split(",").map(Number) : []
  );
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
    eigeneAntwortenLokal = {};
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
  $("bz-anzahl-zeile").hidden = false;
  $("bz-anzahl").disabled = !api.istLeiter;
  $("bz-teammodus-zeile").hidden = false;
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
    // Als kommagetrennte Zeichenkette statt verschachteltem Array speichern -
    // Firestore-Dokumente dürfen kein Array-im-Array enthalten (siehe raumDaten()).
    const neueBuchstabenReihenfolgen = neueReihenfolge.map((frageIndex) => {
      const frage = fragen[frageIndex];
      return frage.typ === "wort" ? mischeIndizes(buchstabenIndizes(frage.loesung)).join(",") : "";
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
  const frage = frageAn(pos);
  if (!frage) return 0;
  const anzahl = (buchstabenReihenfolgen[pos] ?? []).length;
  // Der letzte Buchstabe bleibt immer verdeckt, damit das Rätsel nicht von
  // allein "fertig aufgedeckt" wird. (Gilt nur für "wort" - bei "bild" läuft
  // die Schärfe kontinuierlich über die Zeit, siehe aktualisiereBildSchaerfe().)
  return Math.max(0, anzahl - 1);
}

function zeigeFrage() {
  const frage = frageAn(index);
  if (!frage) return;

  $("bz-frage-typ").textContent = TYP_LABEL[frage.typ] ?? "";
  $("bz-frage-text").innerHTML = textMitZusatz(frage.frage);

  const istWort = frage.typ === "wort";
  const istBild = frage.typ === "bild";
  const istTextEingabe = istWort || istBild;
  $("bz-mc-bereich").hidden = istTextEingabe;
  $("bz-wort-bereich").hidden = !istTextEingabe;
  $("bz-buchstaben-reihe").hidden = !istWort;
  $("bz-bild-anzeige").hidden = !istBild;

  const eigene = eigeneAntwortAnzeige(index);
  if (istTextEingabe) {
    if (istWort) rendereBuchstabenReihe(frage, index);
    else rendereBildAnzeige(frage);
    $("bz-wort-eingabe").disabled = !!eigene;
    $("bz-wort-absenden").disabled = !!eigene;
    $("bz-wort-status-eigenes").hidden = !(eigene && eigene.richtig);
    $("bz-wort-status-falsch").hidden = !(eigene && !eigene.richtig);
  } else {
    rendereMcGrid(frage, eigene);
  }

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

// Zeichnet das Bild nur einmal pro Frage neu (nicht bei jedem Aufruf) - sonst
// würde die CSS-Übergangsanimation der Unschärfe bei jedem Re-Render (z. B.
// durch den unten beschriebenen Listener-Trigger) neu anspringen bzw. gar
// nicht sichtbar sein, weil das SVG jedes Mal frisch eingefügt würde.
function bildUrl(pfad) {
  return new URL(pfad, import.meta.url).href;
}

function rendereBildAnzeige(frage) {
  const wrapper = $("bz-bild-anzeige");
  if (wrapper.dataset.loesung !== frage.loesung) {
    wrapper.innerHTML = `<img src="${bildUrl(frage.bild)}" alt="" loading="lazy">`;
    wrapper.dataset.loesung = frage.loesung;
  }
  // Sofort die aktuell passende Schärfe setzen - sonst wäre das Bild für den
  // ersten Tick (bis zu 300ms, siehe timerId-Intervall) noch komplett scharf
  // zu sehen, bevor aktualisiereBildSchaerfe() zum ersten Mal läuft.
  aktualisiereBildSchaerfe();
}

// Läuft alle 300ms mit (siehe timerId-Intervall) und blendet die Unschärfe
// stetig aus - rein zeitbasiert über frageSeit, ohne Netzwerk-Zwischenschritte
// (im Unterschied zum Buchstaben-Aufdecken bei "wort", das über Firestore
// synchronisiert wird). Nach BILD_SCHARF_DAUER_MS ist das Bild komplett scharf
// und bleibt es auch, falls die Frage noch länger offen ist.
function aktualisiereBildSchaerfe() {
  if (!el.wurzel || status !== "frage_aktiv") return;
  const frage = frageAn(index);
  if (!frage || frage.typ !== "bild") return;
  const img = $("bz-bild-anzeige").querySelector("img");
  if (!img) return;
  const fortschritt = Math.min(1, Math.max(0, (Date.now() - frageSeit) / BILD_SCHARF_DAUER_MS));
  img.style.filter = `blur(${BILD_BLUR_START_PX * (1 - fortschritt)}px)`;
}

function aktualisiereCountdown() {
  if (!el.wurzel || status !== "frage_aktiv") return;
  const frage = frageAn(index);
  if (!frage || (frage.typ !== "wort" && frage.typ !== "bild")) { $("bz-countdown").textContent = ""; return; }

  if (frage.typ === "bild") {
    const rest = Math.max(0, frageSeit + BILD_SCHARF_DAUER_MS - Date.now());
    $("bz-countdown").textContent = rest > 0
      ? `Bild wird in ${Math.ceil(rest / 1000)}s ganz scharf`
      : "Bild ist jetzt ganz scharf";
    return;
  }

  const maximal = maxAufdeckAnzahl(index);
  if (aufdeckAnzahl >= maximal) {
    $("bz-countdown").textContent = "Kein weiterer Buchstabe mehr";
    return;
  }
  const naechsteAufdeckungBei = frageSeit + (aufdeckAnzahl + 1) * AUFDECK_DAUER_MS;
  const rest = Math.max(0, naechsteAufdeckungBei - Date.now());
  $("bz-countdown").textContent = `Nächster Buchstabe in ${Math.ceil(rest / 1000)}s`;
}

// Nur der Spielleiter-Client schreibt das Aufdecken in den Raum - sonst
// würden mehrere Geräte gleichzeitig denselben nächsten Schritt aufdecken.
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
    zeigeDebug("Fehler beim Aufdecken: " + e.message);
  }
  aufdeckFortschreibenLaeuft = false;
}

// Sicherheitsnetz gegen eine hängende Runde: läuft unabhängig davon, ob
// überhaupt neue Firestore-Einträge geschrieben werden (z. B. weil jemand
// bei der Schnelligkeits-Frage gar nicht tippt) - läuft alle 300ms mit,
// siehe starten().
async function pruefeZeitlimit() {
  if (!api?.istLeiter || status !== "frage_aktiv" || ausgewertetAusgeloest) return;
  if (Date.now() - frageSeit >= FRAGE_TIMEOUT_MS) await loeseRundeAuf();
}

async function antworteMC(antwortIndex) {
  if (status !== "frage_aktiv" || eigeneAntwortAnzeige(index)) return;
  const frage = frageAn(index);
  if (!frage) return;
  const millisekunden = Date.now() - frageSeit;
  const eintrag = {
    spielerId: api.spielerId, spielerName: api.spielerName, fragenIndex: index,
    antwortIndex, millisekunden, richtig: antwortIndex === frage.richtig
  };
  // Sofort lokal merken und die Kacheln neu zeichnen, damit die eigene Wahl
  // ohne Wartezeit auf den Listener hervorgehoben/gesperrt erscheint - siehe
  // eigeneAntwortenLokal weiter oben.
  eigeneAntwortenLokal[index] = eintrag;
  rendereMcGrid(frage, eintrag);
  try {
    await setDoc(doc(api.db, "raeume", api.code, "bzantworten", `${api.spielerId}_${index}`), {
      ...eintrag, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    delete eigeneAntwortenLokal[index];
    rendereMcGrid(frage, eigeneAntwortAnzeige(index));
    zeigeDebug("Fehler beim Absenden der Antwort: " + e.message);
  }
}

// Nur EIN Versuch pro Runde: wer falsch liegt, ist für den Rest der Runde
// gesperrt (kein erneutes Tippen) - der Versuch wird trotzdem gespeichert
// (mit "richtig: false"), damit die Runde zuverlässig endet, sobald alle
// entweder gelöst haben oder verbraucht sind (siehe aktualisiereAntworten()).
async function wortAbsenden() {
  if (status !== "frage_aktiv" || eigeneAntwortAnzeige(index)) return;
  const eingabe = $("bz-wort-eingabe").value.trim();
  if (!eingabe) {
    $("bz-wort-fehler").textContent = "Bitte eine Antwort eingeben.";
    return;
  }
  const frage = frageAn(index);
  if (!frage) return;
  const richtig = normalisiere(eingabe) === normalisiere(frage.loesung);
  $("bz-wort-fehler").textContent = "";
  $("bz-wort-eingabe").disabled = true;
  $("bz-wort-absenden").disabled = true;
  $("bz-wort-status-eigenes").hidden = !richtig;
  $("bz-wort-status-falsch").hidden = richtig;
  const millisekunden = Date.now() - frageSeit;
  const eintrag = { spielerId: api.spielerId, spielerName: api.spielerName, fragenIndex: index, millisekunden, richtig };
  // Wie bei antworteMC: sofort lokal merken, damit ein zwischenzeitlicher
  // Raum-Listener-Trigger den gerade gesetzten Sperr-Zustand nicht zurücksetzt.
  eigeneAntwortenLokal[index] = eintrag;
  try {
    await setDoc(doc(api.db, "raeume", api.code, "bzantworten", `${api.spielerId}_${index}`), {
      ...eintrag, zeitpunkt: serverTimestamp()
    });
  } catch (e) {
    delete eigeneAntwortenLokal[index];
    $("bz-wort-eingabe").disabled = false;
    $("bz-wort-absenden").disabled = false;
    $("bz-wort-status-eigenes").hidden = true;
    $("bz-wort-status-falsch").hidden = true;
    zeigeDebug("Fehler beim Absenden der Lösung: " + e.message);
  }
}

async function aktualisiereAntworten() {
  if (!el.wurzel || index < 0) return;
  const frage = frageAn(index);
  if (!frage) return;
  const dieserRunde = alleAntworten.filter((a) => a.fragenIndex === index);
  if (status === "frage_aktiv") {
    if (frage.typ === "wort" || frage.typ === "bild") {
      const geloest = dieserRunde.filter((a) => a.richtig).length;
      $("bz-frage-status").textContent = `${geloest} von ${spielerListe.length} haben es schon gelöst`;
    } else {
      $("bz-frage-status").textContent = `${dieserRunde.length} von ${spielerListe.length} haben geantwortet`;
    }

    // Jeder Eintrag zählt hier mit, ob richtig oder falsch (bei "wort"/"bild"
    // ist ein falscher Versuch der einzige, den man je bekommt - siehe
    // wortAbsenden()) - sobald also wirklich alle entweder gelöst haben oder
    // verbraucht sind, wertet nur der Spielleiter automatisch aus. Reagiert
    // jemand gar nicht (kein einziger Klick/Tipp, also auch kein neuer
    // Firestore-Eintrag), greift stattdessen pruefeZeitlimit() unten.
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
// Jeder gespeicherte Eintrag trägt ein Feld "richtig" (siehe antworteMC()/
// wortAbsenden()). Unter allen RICHTIGEN Antworten bekommt die schnellste so
// viele Punkte wie Mitspieler mitmachen, jede weitere einen Punkt weniger -
// bei allen drei Frage-Typen gleich.
function berechneRundenpunkte(pos) {
  const frage = frageAn(pos);
  if (!frage) return {};
  const antworten = alleAntworten.filter((a) => a.fragenIndex === pos);
  const ergebnis = {};

  const richtige = antworten.filter((a) => a.richtig);
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
    const istTextRaetsel = frage.typ === "wort" || frage.typ === "bild";
    let extra;
    if (!antwort) {
      extra = istTextRaetsel ? "nicht gelöst" : "nicht geantwortet";
    } else if (istTextRaetsel) {
      extra = antwort.richtig ? zeitText(antwort.millisekunden) : "falsch";
    } else {
      extra = zeitText(antwort.millisekunden);
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
  $("bz-erg-antwort-zeile").hidden = false;
  $("bz-erg-antwort").textContent = (frage.typ === "wort" || frage.typ === "bild")
    ? frage.loesung.toUpperCase()
    : frage.antworten[frage.richtig];
  const bildEl = $("bz-erg-bild");
  bildEl.hidden = frage.typ !== "bild";
  if (frage.typ === "bild") bildEl.innerHTML = `<img src="${bildUrl(frage.bild)}" alt="" loading="lazy">`;
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
      speichereWertung(api, "blitzquiz", Object.fromEntries(spielerListe.map((s) => [s.id, s.punkte ?? 0])));
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
  const richtige = antworten.filter((a) => a.richtig);
  const sortiert = [...richtige].sort((a, b) => (a.millisekunden ?? 0) - (b.millisekunden ?? 0));
  sortiert.forEach((a, i) => {
    const punkte = spielerAnzahl - i;
    if (punkte > 0) ergebnis[a.spielerId] = punkte;
  });
  return ergebnis;
}
