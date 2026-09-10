// ============================================================================
//  Reih dich ein!
// ----------------------------------------------------------------------------
//  Begriffe werden nacheinander in eine wachsende, aufsteigende Reihe gesetzt.
//  Alle Felder dieses Spiels im Raum-Dokument beginnen mit "rd".
// ============================================================================
import { updateDoc, runTransaction } from "../../kern/firebase.js";
import { escapeHtml, spielerKarte, zeigeDebug } from "../../kern/ui.js";
import {
  mischeListe, begriffNachId, richtigerEinfuegeIndex, fuegeEin, aktiveSpielerId
} from "./logik.js";

const VORLAGE = `
  <div id="rd-setup" class="bildschirm-karte" hidden>
    <h1>↕️ Reih dich ein!</h1>
    <p class="hinweis-text">Setzt jeden neuen Begriff an die richtige Stelle der Reihe.</p>
    <p class="rd-regel">Ein Startbegriff ist bereits eingeordnet. Danach ist immer ein Spieler dran.
      Eine richtige Position kostet nichts – bei einer falschen Position gibt es einen Minuspunkt.</p>

    <p id="rd-anzahl-zeile" hidden>
      <label>Anzahl Kategorien:
        <input id="rd-anzahl" type="number" inputmode="numeric" min="1" style="width:78px;">
      </label><br>
      <span id="rd-anzahl-hinweis" class="hinweis-text"></span>
    </p>

    <p id="rd-setup-fehler" class="fehler-text"></p>
    <p><button id="rd-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="rd-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
    <p><button id="rd-abbrechen" class="btn-flach" hidden>Zurück zur Spielauswahl</button></p>
  </div>

  <div id="rd-runde" class="bildschirm-karte" hidden>
    <p class="kategorie">Reih dich ein!</p>
    <p id="rd-fortschritt" class="fortschritt"></p>
    <div class="rd-kategorie-kopf">
      <h1 id="rd-titel"></h1>
      <p id="rd-frage"></p>
      <strong id="rd-richtung"></strong>
    </div>
    <p id="rd-aktiver-spieler" class="rd-aktiver-spieler"></p>
    <div class="rd-kandidat">
      <span>Neuer Begriff</span>
      <strong id="rd-kandidat"></strong>
      <small>Der Wert bleibt bis zur Auflösung geheim.</small>
    </div>
    <p id="rd-anweisung" class="hinweis-text rd-anweisung"></p>
    <div id="rd-reihe" class="rd-reihe"></div>
    <div id="rd-zwischenstand"></div>
  </div>

  <div id="rd-feedback" class="bildschirm-karte" hidden>
    <p class="kategorie">Reih dich ein!</p>
    <p id="rd-feedback-fortschritt" class="fortschritt"></p>
    <div id="rd-feedback-box" class="rd-feedback-box">
      <strong id="rd-feedback-titel"></strong>
      <span id="rd-feedback-text"></span>
    </div>
    <h2 id="rd-feedback-kategorie"></h2>
    <p id="rd-feedback-richtung" class="hinweis-text"></p>
    <div id="rd-feedback-reihe" class="rd-reihe rd-reihe-aufgeloest"></div>
    <div id="rd-feedback-punkte"></div>
    <p><button id="rd-weiter" hidden>Nächster Begriff</button></p>
    <p id="rd-feedback-warten" hidden><em>Der Spielleiter schaltet gleich weiter …</em></p>
  </div>

  <div id="rd-endstand" class="bildschirm-karte" hidden>
    <h1>🏁 Endstand</h1>
    <p class="hinweis-text">Wer die wenigsten Fehler gemacht hat, gewinnt.</p>
    <div id="rd-endstand-inhalt"></div>
    <p><button id="rd-nochmal" class="btn-primaer" hidden>Zurück zur Spielauswahl</button></p>
    <p id="rd-endstand-warten" hidden><em>Der Spielleiter wählt gleich das nächste Spiel …</em></p>
  </div>
`;

let api = null;
let el = {};
let karten = [];
let spielerListe = [];
let status = null;
let kategorienReihenfolge = [];
let anzahlKategorien = 0;
let kategorieIndex = 0;
let begriffeReihenfolge = [];
let begriffIndex = 0;
let sortierteIds = [];
let spielerReihenfolge = [];
let zugIndex = 0;
let aktiveId = null;
let punkte = {};
let letzteRichtig = null;
let letzterBegriffId = null;
let aktionLaeuft = false;
let anzahlManuellGesetzt = false;
let spielerwechselLaeuft = false;

const $ = (id) => el.wurzel.querySelector("#" + id);

function aktuelleKarte() {
  return karten[kategorienReihenfolge[kategorieIndex]] ?? null;
}

function aktuellerBegriff() {
  return begriffNachId(aktuelleKarte(), begriffeReihenfolge[begriffIndex]);
}

function spielerNachId(id) {
  return spielerListe.find((spieler) => spieler.id === id) ?? null;
}

function rundenFortschritt() {
  return `Kategorie ${kategorieIndex + 1} von ${anzahlKategorien} · Begriff ${begriffIndex + 1} von ${begriffeReihenfolge.length}`;
}

function neueKategorieDaten(karte) {
  const startId = begriffNachId(karte, karte.startId)
    ? karte.startId
    : [...karte.begriffe].sort((a, b) => a.wert - b.wert)[Math.floor(karte.begriffe.length / 2)].id;
  return {
    rdBegriffeReihenfolge: mischeListe(karte.begriffe.filter((begriff) => begriff.id !== startId).map((begriff) => begriff.id)),
    rdBegriffIndex: 0,
    rdSortierteIds: [startId],
    rdLetzteRichtig: null,
    rdLetzterBegriffId: null
  };
}

export async function starten(uebergebeneApi) {
  api = uebergebeneApi;
  el.wurzel = api.wurzel;
  el.wurzel.innerHTML = VORLAGE;

  if (!karten.length) {
    const antwort = await fetch(new URL("fragen.json", import.meta.url));
    if (!antwort.ok) throw new Error("fragen.json konnte nicht geladen werden");
    karten = await antwort.json();
  }

  verdrahteBedienelemente();

  if (api.istLeiter && !api.raum?.rdStatus) {
    await updateDoc(api.raumRef(), {
      rdStatus: "setup", rdKategorienReihenfolge: [], rdAnzahlKategorien: 0,
      rdKategorieIndex: 0, rdBegriffeReihenfolge: [], rdBegriffIndex: 0,
      rdSortierteIds: [], rdSpielerReihenfolge: [], rdZugIndex: 0,
      rdAktiveId: null, rdPunkte: {}, rdLetzteRichtig: null, rdLetzterBegriffId: null
    });
  }
}

function verdrahteBedienelemente() {
  $("rd-anzahl").addEventListener("input", () => { anzahlManuellGesetzt = true; });
  $("rd-starten").addEventListener("click", spielStarten);
  $("rd-abbrechen").addEventListener("click", zurueck);
  $("rd-nochmal").addEventListener("click", zurueck);
  $("rd-weiter").addEventListener("click", weiter);
}

export function beenden() {
  api = null;
  el = {};
  karten = [];
  spielerListe = [];
  status = null;
  kategorienReihenfolge = [];
  anzahlKategorien = 0;
  kategorieIndex = 0;
  begriffeReihenfolge = [];
  begriffIndex = 0;
  sortierteIds = [];
  spielerReihenfolge = [];
  zugIndex = 0;
  aktiveId = null;
  punkte = {};
  letzteRichtig = null;
  letzterBegriffId = null;
  aktionLaeuft = false;
  anzahlManuellGesetzt = false;
  spielerwechselLaeuft = false;
}

export function spieler(liste) {
  spielerListe = liste;
  if (!el.wurzel) return;
  renderAktuellenStatus();

  if (api.istLeiter && status === "runde" && aktiveId && !spielerNachId(aktiveId) &&
      !aktionLaeuft && !spielerwechselLaeuft) {
    const neueAktiveId = aktiveSpielerId(spielerReihenfolge, zugIndex, spielerListe.map((spieler) => spieler.id));
    if (neueAktiveId) {
      spielerwechselLaeuft = true;
      updateDoc(api.raumRef(), { rdAktiveId: neueAktiveId })
        .catch((e) => zeigeDebug("Aktiver Spieler konnte nicht gewechselt werden: " + e.message))
        .finally(() => { spielerwechselLaeuft = false; });
    }
  }
}

export function raumDaten(daten) {
  if (!daten || !el.wurzel) return;
  status = daten.rdStatus ?? null;
  kategorienReihenfolge = daten.rdKategorienReihenfolge ?? [];
  anzahlKategorien = daten.rdAnzahlKategorien ?? 0;
  kategorieIndex = daten.rdKategorieIndex ?? 0;
  begriffeReihenfolge = daten.rdBegriffeReihenfolge ?? [];
  begriffIndex = daten.rdBegriffIndex ?? 0;
  sortierteIds = daten.rdSortierteIds ?? [];
  spielerReihenfolge = daten.rdSpielerReihenfolge ?? [];
  zugIndex = daten.rdZugIndex ?? 0;
  aktiveId = daten.rdAktiveId ?? null;
  punkte = daten.rdPunkte ?? {};
  letzteRichtig = typeof daten.rdLetzteRichtig === "boolean" ? daten.rdLetzteRichtig : null;
  letzterBegriffId = daten.rdLetzterBegriffId ?? null;
  renderAktuellenStatus();
}

function renderAktuellenStatus() {
  if (!el.wurzel) return;
  ["rd-setup", "rd-runde", "rd-feedback", "rd-endstand"]
    .forEach((id) => { $(id).hidden = true; });

  if (status === "setup" || !status) {
    zeigeSetup();
    $("rd-setup").hidden = false;
  } else if (status === "runde") {
    zeigeRunde();
    $("rd-runde").hidden = false;
  } else if (status === "feedback") {
    zeigeFeedback();
    $("rd-feedback").hidden = false;
  } else if (status === "beendet") {
    zeigeEndstand();
    $("rd-endstand").hidden = false;
  }
}

function zeigeSetup() {
  const anzahlFeld = $("rd-anzahl");
  anzahlFeld.max = karten.length;
  if (!anzahlManuellGesetzt || !anzahlFeld.value) anzahlFeld.value = Math.min(3, karten.length);
  $("rd-anzahl-hinweis").textContent = `${karten.length} Kategorien stehen zur Verfügung.`;
  $("rd-anzahl-zeile").hidden = !api.istLeiter;
  $("rd-starten").hidden = !api.istLeiter;
  $("rd-abbrechen").hidden = !api.istLeiter;
  $("rd-setup-warten").hidden = api.istLeiter;
}

async function spielStarten() {
  $("rd-setup-fehler").textContent = "";
  if (spielerListe.length < 2) {
    $("rd-setup-fehler").textContent = "Für Reih dich ein! braucht ihr mindestens zwei Spieler.";
    return;
  }

  let anzahl = parseInt($("rd-anzahl").value, 10);
  if (!Number.isFinite(anzahl) || anzahl < 1) anzahl = 1;
  if (anzahl > karten.length) anzahl = karten.length;

  const kategorien = mischeListe(karten.map((_, index) => index)).slice(0, anzahl);
  const reihenfolge = mischeListe(spielerListe.map((spieler) => spieler.id));
  const ersteKategorie = neueKategorieDaten(karten[kategorien[0]]);
  $("rd-starten").disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      rdStatus: "runde",
      rdKategorienReihenfolge: kategorien,
      rdAnzahlKategorien: anzahl,
      rdKategorieIndex: 0,
      ...ersteKategorie,
      rdSpielerReihenfolge: reihenfolge,
      rdZugIndex: 0,
      rdAktiveId: aktiveSpielerId(reihenfolge, 0, spielerListe.map((spieler) => spieler.id)),
      rdPunkte: Object.fromEntries(spielerListe.map((spieler) => [spieler.id, 0]))
    });
  } catch (e) {
    zeigeDebug("Spiel konnte nicht gestartet werden: " + e.message);
    $("rd-starten").disabled = false;
  }
}

function punktestandHtml() {
  const sortiert = [...spielerListe].sort((a, b) =>
    (punkte[b.id] ?? 0) - (punkte[a.id] ?? 0)
  );
  return `<ul class="rd-punkteliste">${sortiert.map((spieler) =>
    `<li>${spielerKarte(spieler.name, spieler.farbe, spieler.icon, punkte[spieler.id] ?? 0)}</li>`
  ).join("")}</ul>`;
}

function begriffKarteHtml(begriff, hervorgehoben = false) {
  if (!begriff) return "";
  return `<div class="rd-reihen-begriff${hervorgehoben ? " neu" : ""}">` +
    `<strong>${escapeHtml(begriff.name)}</strong><span>${escapeHtml(begriff.wertText)}</span></div>`;
}

function rendereReihe(container, mitPositionen) {
  const karte = aktuelleKarte();
  container.innerHTML = "";
  if (!karte) return;
  const darfWaehlen = mitPositionen && api.spielerId === aktiveId;

  for (let index = 0; index <= sortierteIds.length; index++) {
    if (mitPositionen) {
      const position = document.createElement("button");
      position.type = "button";
      position.className = "rd-position";
      position.disabled = !darfWaehlen || aktionLaeuft;
      position.textContent = darfWaehlen ? "Hier einordnen" : "•";
      position.setAttribute("aria-label", `An Position ${index + 1} einordnen`);
      if (darfWaehlen) position.addEventListener("click", () => waehlePosition(index));
      container.appendChild(position);
    }
    if (index < sortierteIds.length) {
      const begriff = begriffNachId(karte, sortierteIds[index]);
      const wrapper = document.createElement("div");
      wrapper.innerHTML = begriffKarteHtml(begriff, !mitPositionen && begriff?.id === letzterBegriffId);
      container.appendChild(wrapper.firstElementChild);
    }
  }
}

function zeigeRunde() {
  const karte = aktuelleKarte();
  const kandidat = aktuellerBegriff();
  if (!karte || !kandidat) return;
  const istAktiv = api.spielerId === aktiveId;
  const aktiverSpieler = spielerNachId(aktiveId);
  $("rd-fortschritt").textContent = rundenFortschritt();
  $("rd-titel").textContent = karte.titel;
  $("rd-frage").textContent = karte.frage;
  $("rd-richtung").textContent = karte.richtung;
  $("rd-aktiver-spieler").textContent = `${aktiverSpieler?.name ?? "Ein Spieler"} ist dran`;
  $("rd-kandidat").textContent = kandidat.name;
  $("rd-anweisung").textContent = istAktiv
    ? "Tippe auf die Stelle, an die der neue Begriff gehört."
    : `Warte auf die Entscheidung von ${aktiverSpieler?.name ?? "dem aktiven Spieler"}.`;
  rendereReihe($("rd-reihe"), true);
  $("rd-zwischenstand").innerHTML = `<h3>Zwischenstand</h3>${punktestandHtml()}`;
}

async function waehlePosition(index) {
  if (status !== "runde" || api.spielerId !== aktiveId || aktionLaeuft) return;
  aktionLaeuft = true;
  renderAktuellenStatus();
  try {
    await runTransaction(api.db, async (transaktion) => {
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.rdStatus !== "runde" || daten.rdAktiveId !== api.spielerId) return;

      const katIndex = daten.rdKategorieIndex ?? 0;
      const karte = karten[(daten.rdKategorienReihenfolge ?? [])[katIndex]];
      const begriffId = (daten.rdBegriffeReihenfolge ?? [])[daten.rdBegriffIndex ?? 0];
      const aktuelleReihe = daten.rdSortierteIds ?? [];
      if (!karte || !begriffId || !Number.isInteger(index) || index < 0 || index > aktuelleReihe.length) return;

      const richtigerIndex = richtigerEinfuegeIndex(karte, aktuelleReihe, begriffId);
      const richtig = index === richtigerIndex;
      const neuePunkte = { ...(daten.rdPunkte ?? {}) };
      if (!richtig) neuePunkte[api.spielerId] = (neuePunkte[api.spielerId] ?? 0) - 1;

      transaktion.update(ref, {
        rdStatus: "feedback",
        rdSortierteIds: fuegeEin(aktuelleReihe, begriffId, richtigerIndex),
        rdPunkte: neuePunkte,
        rdLetzteRichtig: richtig,
        rdLetzterBegriffId: begriffId
      });
    });
  } catch (e) {
    zeigeDebug("Position konnte nicht gespeichert werden: " + e.message);
  }
  aktionLaeuft = false;
  renderAktuellenStatus();
}

function zeigeFeedback() {
  const karte = aktuelleKarte();
  const spieler = spielerNachId(aktiveId);
  if (!karte) return;
  $("rd-feedback-fortschritt").textContent = rundenFortschritt();
  $("rd-feedback-box").className = `rd-feedback-box ${letzteRichtig ? "richtig" : "falsch"}`;
  $("rd-feedback-titel").textContent = letzteRichtig ? "Richtig eingeordnet!" : "Leider falsch eingeordnet";
  $("rd-feedback-text").textContent = letzteRichtig
    ? `${spieler?.name ?? "Der Spieler"} bleibt ohne Minuspunkt.`
    : `${spieler?.name ?? "Der Spieler"} erhält einen Minuspunkt. Die richtige Position ist markiert.`;
  $("rd-feedback-kategorie").textContent = karte.titel;
  $("rd-feedback-richtung").textContent = `${karte.frage} · ${karte.richtung}`;
  rendereReihe($("rd-feedback-reihe"), false);
  $("rd-feedback-punkte").innerHTML = `<h3>Zwischenstand</h3>${punktestandHtml()}`;
  $("rd-weiter").hidden = !api.istLeiter;
  $("rd-feedback-warten").hidden = api.istLeiter;
  $("rd-weiter").textContent = begriffIndex + 1 < begriffeReihenfolge.length
    ? "Nächster Begriff"
    : (kategorieIndex + 1 < anzahlKategorien ? "Nächste Kategorie" : "Endstand anzeigen");
}

async function weiter() {
  if (!api.istLeiter || status !== "feedback" || aktionLaeuft) return;
  aktionLaeuft = true;
  $("rd-weiter").disabled = true;
  const naechsterZug = zugIndex + 1;
  const vorhandeneIds = spielerListe.map((spieler) => spieler.id);
  try {
    if (begriffIndex + 1 < begriffeReihenfolge.length) {
      await updateDoc(api.raumRef(), {
        rdStatus: "runde",
        rdBegriffIndex: begriffIndex + 1,
        rdZugIndex: naechsterZug,
        rdAktiveId: aktiveSpielerId(spielerReihenfolge, naechsterZug, vorhandeneIds),
        rdLetzteRichtig: null,
        rdLetzterBegriffId: null
      });
    } else if (kategorieIndex + 1 < anzahlKategorien) {
      const naechsteKategorie = kategorieIndex + 1;
      await updateDoc(api.raumRef(), {
        rdStatus: "runde",
        rdKategorieIndex: naechsteKategorie,
        ...neueKategorieDaten(karten[kategorienReihenfolge[naechsteKategorie]]),
        rdZugIndex: naechsterZug,
        rdAktiveId: aktiveSpielerId(spielerReihenfolge, naechsterZug, vorhandeneIds)
      });
    } else {
      await updateDoc(api.raumRef(), { rdStatus: "beendet", rdAktiveId: null });
    }
  } catch (e) {
    zeigeDebug("Fehler beim Weiterschalten: " + e.message);
    $("rd-weiter").disabled = false;
  }
  aktionLaeuft = false;
  renderAktuellenStatus();
}

function zeigeEndstand() {
  $("rd-endstand-inhalt").innerHTML = punktestandHtml();
  $("rd-nochmal").hidden = !api.istLeiter;
  $("rd-endstand-warten").hidden = api.istLeiter;
}

async function zurueck() {
  const knopf = status === "beendet" ? $("rd-nochmal") : $("rd-abbrechen");
  knopf.disabled = true;
  try {
    await updateDoc(api.raumRef(), {
      rdStatus: null, rdKategorienReihenfolge: [], rdAnzahlKategorien: 0,
      rdKategorieIndex: 0, rdBegriffeReihenfolge: [], rdBegriffIndex: 0,
      rdSortierteIds: [], rdSpielerReihenfolge: [], rdZugIndex: 0,
      rdAktiveId: null, rdPunkte: {}, rdLetzteRichtig: null, rdLetzterBegriffId: null
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
    knopf.disabled = false;
  }
}
