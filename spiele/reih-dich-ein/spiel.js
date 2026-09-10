// ============================================================================
//  Reih dich ein!
// ----------------------------------------------------------------------------
//  Begriffe werden nacheinander in eine wachsende, aufsteigende Reihe gesetzt.
//  Alle Felder dieses Spiels im Raum-Dokument beginnen mit "rd".
// ============================================================================
import { updateDoc, runTransaction } from "../../kern/firebase.js";
import { escapeHtml, spielerKarte, zeigeDebug } from "../../kern/ui.js";
import {
  mischeListe, begriffNachId, richtigerEinfuegeIndex, fuegeEin, aktiveSpielerId,
  punkteNachAntwort
} from "./logik.js";

const VORLAGE = `
  <div id="rd-setup" class="bildschirm-karte" hidden>
    <button id="rd-abbrechen" class="btn-flach rd-zurueck" hidden>← Spielauswahl</button>
    <h1>↕️ Reih dich ein!</h1>
    <p class="hinweis-text">Setzt jeden neuen Begriff an die richtige Stelle der Reihe.</p>
    <p class="rd-regel">Ein Startbegriff ist bereits eingeordnet. Danach ist immer ein Spieler dran.
      Eine richtige Position gibt einen Pluspunkt – bei einer falschen Position gibt es einen Minuspunkt.</p>

    <p id="rd-anzahl-zeile" hidden>
      <label>Anzahl Kategorien:
        <input id="rd-anzahl" type="number" inputmode="numeric" min="1" style="width:78px;">
      </label><br>
      <span id="rd-anzahl-hinweis" class="hinweis-text"></span>
    </p>

    <p id="rd-setup-fehler" class="fehler-text"></p>
    <p><button id="rd-starten" class="btn-primaer" hidden>Spiel starten</button></p>
    <p id="rd-setup-warten" hidden><em>Warte, bis der Spielleiter das Spiel startet …</em></p>
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
    <div id="rd-letztes-ergebnis" class="rd-letztes-ergebnis" hidden>
      <strong id="rd-letztes-ergebnis-titel"></strong>
      <span id="rd-letztes-ergebnis-text"></span>
    </div>
    <div class="rd-kandidat">
      <span>Neuer Begriff</span>
      <strong id="rd-kandidat"></strong>
      <small>Der Wert bleibt bis zur Auflösung geheim.</small>
    </div>
    <p id="rd-anweisung" class="hinweis-text rd-anweisung"></p>
    <p class="rd-kategorie-wechsel">
      <button id="rd-andere-kategorie" class="btn-flach" hidden>Andere Kategorie</button>
    </p>
    <p id="rd-runde-fehler" class="fehler-text"></p>
    <div class="rd-sortierbereich">
      <aside class="rd-skala" aria-label="Sortierrichtung">
        <span id="rd-skala-oben"></span><i></i><span id="rd-skala-unten"></span>
      </aside>
      <div id="rd-reihe" class="rd-reihe"></div>
    </div>
    <div id="rd-zwischenstand"></div>
  </div>

  <div id="rd-feedback" class="bildschirm-karte" hidden>
    <p class="kategorie">Reih dich ein!</p>
    <p id="rd-feedback-fortschritt" class="fortschritt"></p>
    <div class="rd-kategorie-ergebnis-kopf">
      <strong>Kategorie abgeschlossen!</strong>
      <span>So wurden die Begriffe eingeordnet:</span>
    </div>
    <h2 id="rd-feedback-kategorie"></h2>
    <p id="rd-feedback-richtung" class="hinweis-text"></p>
    <div id="rd-feedback-reihe" class="rd-ergebnis-reihe"></div>
    <div id="rd-feedback-punkte"></div>
    <p><button id="rd-naechste-kategorie" class="btn-primaer" hidden>Nächste Kategorie</button></p>
    <p id="rd-feedback-warten" hidden><em>Der Spielleiter startet gleich die nächste Kategorie …</em></p>
  </div>

  <div id="rd-endstand" class="bildschirm-karte" hidden>
    <h1>🏁 Endstand</h1>
    <p class="hinweis-text">Wer die meisten Punkte gesammelt hat, gewinnt.</p>
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
let ergebnisse = {};
let letzteRichtig = null;
let letzterBegriffId = null;
let letzterSpielerId = null;
let verworfeneKategorien = [];
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

function skalenBeschriftung(karte) {
  return Array.isArray(karte?.skala) && karte.skala.length === 2
    ? karte.skala
    : ["ANFANG", "ENDE"];
}

function neueKategorieDaten(karte) {
  const startId = begriffNachId(karte, karte.startId)
    ? karte.startId
    : [...karte.begriffe].sort((a, b) => a.wert - b.wert)[Math.floor(karte.begriffe.length / 2)].id;
  return {
    rdBegriffeReihenfolge: mischeListe(karte.begriffe.filter((begriff) => begriff.id !== startId).map((begriff) => begriff.id)),
    rdBegriffIndex: 0,
    rdSortierteIds: [startId],
    rdErgebnisse: {},
    rdLetzteRichtig: null,
    rdLetzterBegriffId: null,
    rdLetzterSpielerId: null
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
      rdAktiveId: null, rdPunkte: {}, rdErgebnisse: {}, rdLetzteRichtig: null, rdLetzterBegriffId: null,
      rdLetzterSpielerId: null,
      rdVerworfeneKategorien: []
    });
  }
}

function verdrahteBedienelemente() {
  $("rd-anzahl").addEventListener("input", () => { anzahlManuellGesetzt = true; });
  $("rd-starten").addEventListener("click", spielStarten);
  $("rd-abbrechen").addEventListener("click", zurueck);
  $("rd-nochmal").addEventListener("click", zurueck);
  $("rd-naechste-kategorie").addEventListener("click", naechsteKategorie);
  $("rd-andere-kategorie").addEventListener("click", andereKategorie);
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
  ergebnisse = {};
  letzteRichtig = null;
  letzterBegriffId = null;
  letzterSpielerId = null;
  verworfeneKategorien = [];
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
  ergebnisse = daten.rdErgebnisse ?? {};
  letzteRichtig = typeof daten.rdLetzteRichtig === "boolean" ? daten.rdLetzteRichtig : null;
  letzterBegriffId = daten.rdLetzterBegriffId ?? null;
  letzterSpielerId = daten.rdLetzterSpielerId ?? null;
  verworfeneKategorien = daten.rdVerworfeneKategorien ?? [];
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
      rdPunkte: Object.fromEntries(spielerListe.map((spieler) => [spieler.id, 0])),
      rdVerworfeneKategorien: []
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
      wrapper.innerHTML = begriffKarteHtml(begriff, begriff?.id === letzterBegriffId);
      container.appendChild(wrapper.firstElementChild);
    }
  }
}

function rendereKategorieErgebnis(container) {
  const karte = aktuelleKarte();
  container.innerHTML = "";
  if (!karte) return;

  for (const begriffId of sortierteIds) {
    const begriff = begriffNachId(karte, begriffId);
    if (!begriff) continue;
    const ergebnis = ergebnisse[begriffId] ?? null;
    const zeile = document.createElement("div");
    zeile.className = "rd-ergebnis-begriff";

    const kopf = document.createElement("div");
    kopf.className = "rd-ergebnis-begriff-kopf";
    const name = document.createElement("strong");
    name.textContent = begriff.name;
    const wert = document.createElement("span");
    wert.textContent = begriff.wertText;
    kopf.append(name, wert);

    const meta = document.createElement("div");
    meta.className = "rd-ergebnis-meta";
    const spielerName = document.createElement("span");
    const wertung = document.createElement("strong");
    if (ergebnis) {
      spielerName.textContent = ergebnis.spielerName || spielerNachId(ergebnis.spielerId)?.name || "Spieler";
      wertung.className = ergebnis.richtig ? "richtig" : "falsch";
      wertung.textContent = ergebnis.richtig ? "+1" : "−1";
    } else {
      spielerName.textContent = begriffId === karte.startId ? "Startbegriff" : "Nicht erfasst";
      wertung.className = "neutral";
      wertung.textContent = "–";
    }
    meta.append(spielerName, wertung);
    zeile.append(kopf, meta);
    container.appendChild(zeile);
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
  const [oben, unten] = skalenBeschriftung(karte);
  $("rd-skala-oben").textContent = oben;
  $("rd-skala-unten").textContent = unten;
  $("rd-aktiver-spieler").textContent = `${aktiverSpieler?.name ?? "Ein Spieler"} ist dran`;
  const ergebnisBox = $("rd-letztes-ergebnis");
  if (typeof letzteRichtig === "boolean") {
    const letzterSpieler = spielerNachId(letzterSpielerId);
    const letzterName = ergebnisse[letzterBegriffId]?.spielerName || letzterSpieler?.name || "Der vorherige Spieler";
    ergebnisBox.hidden = false;
    ergebnisBox.className = `rd-letztes-ergebnis ${letzteRichtig ? "richtig" : "falsch"}`;
    $("rd-letztes-ergebnis-titel").textContent = letzteRichtig ? "Richtig: +1" : "Falsch: −1";
    $("rd-letztes-ergebnis-text").textContent =
      `${letzterName} hat ${letzteRichtig ? "richtig" : "falsch"} eingeordnet.`;
  } else {
    ergebnisBox.hidden = true;
  }
  $("rd-kandidat").textContent = kandidat.name;
  $("rd-anweisung").textContent = istAktiv
    ? "Tippe auf die Stelle, an die der neue Begriff gehört."
    : `Warte auf die Entscheidung von ${aktiverSpieler?.name ?? "dem aktiven Spieler"}.`;
  rendereReihe($("rd-reihe"), true);
  $("rd-andere-kategorie").hidden = !api.istLeiter;
  $("rd-andere-kategorie").disabled = aktionLaeuft;
  $("rd-zwischenstand").innerHTML = `<h3>Zwischenstand</h3>${punktestandHtml()}`;
}

async function andereKategorie() {
  if (!api.istLeiter || status !== "runde" || aktionLaeuft) return;
  const knopf = $("rd-andere-kategorie");
  knopf.disabled = true;
  $("rd-runde-fehler").textContent = "";
  const erwarteteKategorie = kategorienReihenfolge[kategorieIndex];
  aktionLaeuft = true;
  let keinErsatz = false;
  try {
    await runTransaction(api.db, async (transaktion) => {
      keinErsatz = false;
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.rdStatus !== "runde") return;

      const katIndex = daten.rdKategorieIndex ?? 0;
      const aktuelleReihenfolge = daten.rdKategorienReihenfolge ?? [];
      if (aktuelleReihenfolge[katIndex] !== erwarteteKategorie) return;

      const verwendet = new Set(aktuelleReihenfolge);
      const bisherVerworfen = daten.rdVerworfeneKategorien ?? [];
      const verworfen = new Set(bisherVerworfen);
      const moegliche = mischeListe(karten.map((_, index) => index).filter((index) =>
        !verwendet.has(index) && !verworfen.has(index)
      ));
      if (!moegliche.length) {
        keinErsatz = true;
        return;
      }

      const neueReihenfolge = [...aktuelleReihenfolge];
      neueReihenfolge[katIndex] = moegliche[0];
      transaktion.update(ref, {
        rdKategorienReihenfolge: neueReihenfolge,
        rdVerworfeneKategorien: [...bisherVerworfen, erwarteteKategorie],
        ...neueKategorieDaten(karten[moegliche[0]])
      });
    });
    if (keinErsatz) {
      $("rd-runde-fehler").textContent = "Es ist keine andere ungespielte Kategorie mehr verfügbar.";
    }
  } catch (e) {
    zeigeDebug("Kategorie konnte nicht gewechselt werden: " + e.message);
  }
  aktionLaeuft = false;
  renderAktuellenStatus();
}

async function waehlePosition(index) {
  if (status !== "runde" || api.spielerId !== aktiveId || aktionLaeuft) return;
  const erwarteteKategorie = kategorienReihenfolge[kategorieIndex];
  const erwarteterBegriff = begriffeReihenfolge[begriffIndex];
  aktionLaeuft = true;
  renderAktuellenStatus();
  try {
    await runTransaction(api.db, async (transaktion) => {
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.rdStatus !== "runde" || daten.rdAktiveId !== api.spielerId) return;

      const katIndex = daten.rdKategorieIndex ?? 0;
      const kartenIndex = (daten.rdKategorienReihenfolge ?? [])[katIndex];
      const karte = karten[kartenIndex];
      const begriffId = (daten.rdBegriffeReihenfolge ?? [])[daten.rdBegriffIndex ?? 0];
      const aktuelleReihe = daten.rdSortierteIds ?? [];
      if (kartenIndex !== erwarteteKategorie || begriffId !== erwarteterBegriff || !karte ||
          !Number.isInteger(index) || index < 0 || index > aktuelleReihe.length) return;

      const richtigerIndex = richtigerEinfuegeIndex(karte, aktuelleReihe, begriffId);
      const richtig = index === richtigerIndex;
      const neuePunkte = { ...(daten.rdPunkte ?? {}) };
      neuePunkte[api.spielerId] = punkteNachAntwort(neuePunkte[api.spielerId], richtig);
      const neueReihe = fuegeEin(aktuelleReihe, begriffId, richtigerIndex);
      const aktuellerBegriffIndex = daten.rdBegriffIndex ?? 0;
      const begriffsReihenfolge = daten.rdBegriffeReihenfolge ?? [];
      const naechsterZug = (daten.rdZugIndex ?? 0) + 1;
      const spielReihenfolge = daten.rdSpielerReihenfolge ?? [];
      const geladeneSpielerIds = spielerListe.map((spieler) => spieler.id);
      const naechsteAktiveId = aktiveSpielerId(
        spielReihenfolge,
        naechsterZug,
        geladeneSpielerIds.length ? geladeneSpielerIds : spielReihenfolge
      );
      const ergebnis = {
        rdPunkte: neuePunkte,
        rdErgebnisse: {
          ...(daten.rdErgebnisse ?? {}),
          [begriffId]: {
            spielerId: api.spielerId,
            spielerName: api.spielerName || spielerNachId(api.spielerId)?.name || "Spieler",
            richtig
          }
        },
        rdLetzteRichtig: richtig,
        rdLetzterBegriffId: begriffId,
        rdLetzterSpielerId: api.spielerId
      };

      if (aktuellerBegriffIndex + 1 < begriffsReihenfolge.length) {
        transaktion.update(ref, {
          ...ergebnis,
          rdStatus: "runde",
          rdSortierteIds: neueReihe,
          rdBegriffIndex: aktuellerBegriffIndex + 1,
          rdZugIndex: naechsterZug,
          rdAktiveId: naechsteAktiveId
        });
      } else {
        transaktion.update(ref, {
          ...ergebnis,
          rdStatus: "feedback",
          rdSortierteIds: neueReihe,
          rdZugIndex: naechsterZug,
          rdAktiveId: null
        });
      }
    });
  } catch (e) {
    zeigeDebug("Position konnte nicht gespeichert werden: " + e.message);
  }
  aktionLaeuft = false;
  renderAktuellenStatus();
}

function zeigeFeedback() {
  const karte = aktuelleKarte();
  if (!karte) return;
  $("rd-feedback-fortschritt").textContent = rundenFortschritt();
  $("rd-feedback-kategorie").textContent = karte.titel;
  $("rd-feedback-richtung").textContent = `${karte.frage} · ${karte.richtung}`;
  rendereKategorieErgebnis($("rd-feedback-reihe"));
  $("rd-feedback-punkte").innerHTML = `<h3>Zwischenstand</h3>${punktestandHtml()}`;
  $("rd-naechste-kategorie").hidden = !api.istLeiter;
  $("rd-naechste-kategorie").disabled = aktionLaeuft;
  $("rd-naechste-kategorie").textContent = kategorieIndex + 1 < anzahlKategorien
    ? "Nächste Kategorie"
    : "Endstand anzeigen";
  $("rd-feedback-warten").hidden = api.istLeiter;
  $("rd-feedback-warten").innerHTML = kategorieIndex + 1 < anzahlKategorien
    ? "<em>Der Spielleiter startet gleich die nächste Kategorie …</em>"
    : "<em>Der Spielleiter zeigt gleich den Endstand …</em>";
}

async function naechsteKategorie() {
  if (!api.istLeiter || status !== "feedback" || aktionLaeuft) return;
  aktionLaeuft = true;
  $("rd-naechste-kategorie").disabled = true;
  const erwarteteKategorie = kategorienReihenfolge[kategorieIndex];
  try {
    await runTransaction(api.db, async (transaktion) => {
      const ref = api.raumRef();
      const snap = await transaktion.get(ref);
      const daten = snap.data();
      if (!daten || daten.rdStatus !== "feedback") return;

      const katIndex = daten.rdKategorieIndex ?? 0;
      const kategorien = daten.rdKategorienReihenfolge ?? [];
      if (kategorien[katIndex] !== erwarteteKategorie) return;

      if (katIndex + 1 >= (daten.rdAnzahlKategorien ?? 0)) {
        transaktion.update(ref, { rdStatus: "beendet", rdAktiveId: null });
        return;
      }

      const naechsterKategorieIndex = katIndex + 1;
      const naechsteKarte = karten[kategorien[naechsterKategorieIndex]];
      const spielReihenfolge = daten.rdSpielerReihenfolge ?? [];
      const geladeneSpielerIds = spielerListe.map((spieler) => spieler.id);
      const naechsteAktiveId = aktiveSpielerId(
        spielReihenfolge,
        daten.rdZugIndex ?? 0,
        geladeneSpielerIds.length ? geladeneSpielerIds : spielReihenfolge
      );
      transaktion.update(ref, {
        ...neueKategorieDaten(naechsteKarte),
        rdStatus: "runde",
        rdKategorieIndex: naechsterKategorieIndex,
        rdAktiveId: naechsteAktiveId
      });
    });
  } catch (e) {
    zeigeDebug("Nächste Kategorie konnte nicht gestartet werden: " + e.message);
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
      rdAktiveId: null, rdPunkte: {}, rdErgebnisse: {}, rdLetzteRichtig: null, rdLetzterBegriffId: null,
      rdLetzterSpielerId: null,
      rdVerworfeneKategorien: []
    });
    await api.zurueckZurAuswahl();
  } catch (e) {
    zeigeDebug("Fehler beim Zurückkehren: " + e.message);
    knopf.disabled = false;
  }
}
