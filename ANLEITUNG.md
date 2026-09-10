# Partyspiele – Anleitung

## 1. Was in diesem Ordner liegt

```
index.html                       Grundgerüst der Seite
app.js                           Raum erstellen/beitreten, Lobby, Spielauswahl
stil.css                         das komplette Aussehen
manifest.json                    macht die Seite als App installierbar
sw.js                            Service Worker (Offline-Start + Update-Steuerung)
kern/firebase.js                 Verbindung zu Firestore
kern/ui.js                       Spielerkacheln, Farben, Profilbilder, Hilfsfunktionen
spiele/register.js               Verzeichnis aller Spiele
spiele/schaetzfragen/spiel.js    das Spiel Schätzfragen
spiele/schaetzfragen/fragen.json 610 Fragen
spiele/denk-gleich/spiel.js       das Spiel Denk gleich!
spiele/denk-gleich/fragen.json    250 Fragen
bilder/                          Profilbilder und App-Icons
```

---

## 2. Auf GitHub Pages hochladen

**Einmalig:**

1. Auf [github.com](https://github.com) anmelden (kostenloser Account reicht).
2. Oben rechts **+ → New repository**.
   - Name: `partyspiele`
   - **Public** auswählen (Pages funktioniert bei privaten Repos nur im Bezahltarif).
   - **Create repository**.
3. Auf der leeren Repo-Seite: **uploading an existing file** anklicken.
4. Den **Inhalt** des Ordners `partyspiele` hineinziehen – also `index.html`, `app.js`,
   `stil.css`, `manifest.json`, `sw.js` und die Ordner `kern`, `spiele`, `bilder`.
   Wichtig: nicht den Ordner `partyspiele` selbst, sondern das, was drin ist –
   `index.html` muss ganz oben im Repo liegen.
5. Unten **Commit changes**.
6. **Settings → Pages** (linke Spalte).
   - Source: **Deploy from a branch**
   - Branch: **main**, Ordner: **/ (root)** → **Save**.
7. Nach ein bis zwei Minuten steht dort die Adresse:
   `https://<dein-benutzername>.github.io/partyspiele/`

Diesen Link schickst du deinen Kumpels.

**Bei jeder späteren Änderung:**

1. In `sw.js` die Zeile `const CACHE_NAME = "partyspiele-v34";` hochzählen
   (`v35`, `v36` …) und in `app.js` `APP_VERSION` entsprechend anpassen.
   Ohne diesen Schritt sehen die anderen unter Umständen noch die alte Version.
2. Die geänderten Dateien im Repo hochladen (**Add file → Upload files**,
   gleichnamige Dateien werden ersetzt) und **Commit changes**.
3. Nach ein bis zwei Minuten ist die neue Version live.

---

## 3. Als App aufs Handy legen

**iPhone (nur Safari, nicht Chrome):** Link öffnen → Teilen-Symbol unten →
*Zum Home-Bildschirm* → *Hinzufügen*.

**Android (Chrome):** Link öffnen → Chrome bietet *App installieren* an, sonst
über das Drei-Punkte-Menü → *Zum Startbildschirm hinzufügen*.

Danach startet die App mit eigenem Icon und ohne Browser-Leiste.

Zwei Dinge, die man dazu wissen sollte:

- **iOS löscht den lokalen Speicher, wenn die App rund 7 Tage nicht geöffnet wird.**
  Betroffen ist nur die gemerkte Sitzung – man muss dann Namen und Raumcode neu
  eingeben. Die Spielstände selbst liegen in Firestore und sind davon nicht betroffen.
- **Ohne Internet startet die App zwar, aber Mitspielen geht nicht** – die
  Synchronisation läuft komplett über Firestore.

---

## 4. Ein neues Spiel hinzufügen

1. Ordner `spiele/<meinspiel>/` anlegen, darin eine `spiel.js`.
   Vorlage ist `spiele/schaetzfragen/spiel.js`. Ein Spielmodul muss vier
   Funktionen exportieren:

   ```js
   export async function starten(api) { }  // einmal beim Laden: DOM bauen, Listener starten
   export function raumDaten(daten)  { }   // Raum-Dokument hat sich geändert
   export function spieler(liste)    { }   // Spielerliste hat sich geändert
   export function beenden()         { }   // aufräumen vor dem Entladen
   ```

   Über `api` kommen `code`, `spielerId`, `spielerName`, `istLeiter`, `spieler`,
   `raum`, `raumRef()`, `spielerRef(id)` und `zurueckZurAuswahl()`.

   Eigene Felder im Raum-Dokument bitte mit einem kurzen Kürzel beginnen lassen
   (Schätzfragen nutzt `sf…`), damit sich zwei Spiele nicht in die Quere kommen.

2. In `spiele/register.js` einen Eintrag ergänzen.
3. In `sw.js` die neuen Dateien in die Liste `DATEIEN` aufnehmen und `CACHE_NAME` hochzählen.

Lobby, Profilbilder, Farben, Raumcode und Spielerliste sind bereits erledigt –
ein neues Spiel muss sich darum nicht mehr kümmern.

---

## 5. Datenbank absichern (anonyme Anmeldung) – zwei Schritte in der Firebase-Konsole

Die App meldet jeden Besucher jetzt automatisch anonym an (kein Login-Formular,
kein Passwort – passiert unsichtbar im Hintergrund, `kern/firebase.js` ruft dafür
`signInAnonymously` auf, bevor irgendetwas mit Firestore passiert). Das ist die
Voraussetzung dafür, dass die Datenbank-Regeln nicht mehr komplett offen sein müssen.
**Damit das wirklich schützt, fehlen noch zwei Klicks in der Firebase-Konsole:**

**Schritt 1 – Anonyme Anmeldung aktivieren:**
[console.firebase.google.com](https://console.firebase.google.com) → Projekt
`partyspiele-e4b81` → *Authentication* → *Sign-in method* → **Anonym** anklicken
und aktivieren.

**Schritt 2 – Regeln einschränken:**
*Firestore Database → Regeln* → den bisherigen Inhalt ersetzen durch:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Nur wer angemeldet ist (auch anonym zählt) UND nur innerhalb der
    // Raum-Struktur mit einem vierstelligen Code darf lesen/schreiben.
    match /raeume/{code} {
      allow read, write: if request.auth != null && code.matches('^[0-9]{4}$');
      match /{unterpfad=**} {
        allow read, write: if request.auth != null && code.matches('^[0-9]{4}$');
      }
    }
  }
}
```

→ **Publish** klicken.

Ohne Schritt 1 würde die App nach dem Umstellen der Regeln nicht mehr
funktionieren (die Anmeldung würde fehlschlagen) – deshalb unbedingt zuerst
die anonyme Anmeldung aktivieren, dann erst die Regeln veröffentlichen.

Was das bringt: Jeder Besucher bekommt eine feste, aber anonyme Nutzer-Id von
Firebase – ohne dass er etwas eingeben muss. Die Regeln verlangen diese Anmeldung
und lassen nur noch Zugriffe auf den eigentlichen Spielbereich (`raeume/…`) zu,
mit einem vierstelligen Code. Der Firebase-Schlüssel in `kern/firebase.js` bleibt
weiterhin öffentlich sichtbar – das ist bei Firebase normal, geschützt wird nicht
über den Schlüssel, sondern über die Regeln.

Was das **nicht** verhindert: Wer euren vierstelligen Raum-Code kennt oder errät,
kann diesem Raum weiterhin beitreten und mitspielen – das ist so gewollt, genau
dafür ist der Code da. Was es verhindert, ist das wahllose Mitlesen oder Löschen
fremder Räume ohne den Code.

**Nebenbei:** Die alte Sammlung `spiele` in Firestore wird nicht mehr benutzt
(die App schreibt jetzt nach `raeume`) und kann in der Konsole gelöscht werden.
