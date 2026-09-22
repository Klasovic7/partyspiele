// Service Worker: macht die App installierbar und offline startfähig.
//
// WICHTIG bei Änderungen: die Zahl in CACHE_NAME hochzählen (z. B. v106 -> v181).
// Nur dann wirft der Browser den alten Zwischenspeicher weg und alle Spieler
// bekommen zuverlässig die neue Version. Das ist der einzige Handgriff, den man
// nach dem Bearbeiten von Dateien nicht vergessen darf.
const CACHE_NAME = "trollhouse-v184";

const DATEIEN = [
  "./",
  "index.html",
  "stil.css",
  "app.js",
  "manifest.json",
  "kern/firebase.js",
  "kern/ui.js",
  "kern/teams.js",
  "kern/wertung.js",
  "kern/verlauf.js",
  "spiele/register.js",
  "spiele/schaetzfragen/spiel.js",
  "spiele/schaetzfragen/fragen.json",
  "spiele/denk-gleich/spiel.js",
  "spiele/denk-gleich/fragen.json",
  "spiele/zehn-treffer/spiel.js",
  "spiele/zehn-treffer/logik.js",
  "spiele/zehn-treffer/fragen.json",
  "spiele/reih-dich-ein/spiel.js",
  "spiele/reih-dich-ein/logik.js",
  "spiele/reih-dich-ein/fragen.json",
  "spiele/wer-ist-es/spiel.js",
  "spiele/wer-ist-es/fragen.json",
  "spiele/wann-war-es/spiel.js",
  "spiele/wann-war-es/jahre.json",
  "spiele/finto/spiel.js",
  "spiele/finto/fragen.json",
  "spiele/imposter/spiel.js",
  "spiele/imposter/woerter.json",
  "spiele/doppelblick/spiel.js",
  "spiele/blitzquiz/spiel.js",
  "spiele/blitzquiz/fragen.json",
  "spiele/blitzquiz/bilder/lampe.jpg",
  "spiele/blitzquiz/bilder/sonnenbrille.jpg",
  "spiele/blitzquiz/bilder/regenschirm.jpg",
  "spiele/blitzquiz/bilder/anker.png",
  "spiele/blitzquiz/bilder/rakete.jpg",
  "spiele/blitzquiz/bilder/kerze.jpg",
  "spiele/blitzquiz/bilder/glocke.png",
  "spiele/blitzquiz/bilder/pizza.jpg",
  "spiele/blitzquiz/bilder/schere.jpg",
  "spiele/blitzquiz/bilder/hammer.jpg",
  "spiele/blitzquiz/bilder/leiter.jpg",
  "spiele/blitzquiz/bilder/gitarre.jpg",
  "spiele/blitzquiz/bilder/trompete.jpg",
  "spiele/blitzquiz/bilder/fahrrad.jpg",
  "spiele/blitzquiz/bilder/zahnbuerste.jpg",
  "spiele/blitzquiz/bilder/hufeisen.jpg",
  "spiele/blitzquiz/bilder/kompass.jpg",
  "spiele/blitzquiz/bilder/schluessel.jpg",
  "spiele/blitzquiz/bilder/zange.jpg",
  "spiele/blitzquiz/bilder/kaktus.jpg",
  "spiele/blitzquiz/bilder/weinglas.jpg",
  "spiele/blitzquiz/bilder/igel.jpg",
  "spiele/blitzquiz/bilder/schmetterling.jpg",
  "spiele/blitzquiz/bilder/pinguin.jpg",
  "spiele/blitzquiz/bilder/flamingo.jpg",
  "spiele/blitzquiz/bilder/elefant.jpg",
  "spiele/blitzquiz/bilder/zitrone.jpg",
  "spiele/blitzquiz/bilder/erdbeere.jpg",
  "spiele/blitzquiz/bilder/avocado.jpg",
  "spiele/blitzquiz/bilder/brokkoli.jpg",
  "spiele/blitzquiz/bilder/pilz.jpg",
  "spiele/blitzquiz/bilder/tomate.jpg",
  "spiele/blitzquiz/bilder/wuerfel.jpg",
  "spiele/blitzquiz/bilder/trommel.jpg",
  "spiele/blitzquiz/bilder/geige.jpg",
  "spiele/blitzquiz/bilder/saxophon.jpg",
  "spiele/blitzquiz/bilder/kamera.jpg",
  "spiele/blitzquiz/bilder/fernglas.jpg",
  "spiele/blitzquiz/bilder/globus.jpg",
  "spiele/blitzquiz/bilder/zahnrad.jpg",
  "spiele/blitzquiz/bilder/magnet.jpg",
  "spiele/blitzquiz/bilder/laterne.jpg",
  "spiele/blitzquiz/bilder/sanduhr.jpg",
  "spiele/blitzquiz/bilder/krone.jpg",
  "spiele/blitzquiz/bilder/muschel.jpg",
  "spiele/blitzquiz/bilder/seestern.jpg",
  "spiele/blitzquiz/bilder/qualle.jpg",
  "spiele/blitzquiz/bilder/kuerbis.jpg",
  "spiele/blitzquiz/bilder/giraffe.jpg",
  "spiele/blitzquiz/bilder/auto.jpg",
  "bilder/icon-192.png",
  "bilder/icon-512.png",
  "bilder/icon-512-maskable.png",
  "bilder/apple-touch-icon.png",
  "bilder/logo-fuchs-transparent.png",
  "bilder/brand-app-icon.svg",
  "bilder/icon-raum-verlassen.svg",
  "bilder/avatar1-hd.jpg?v=38", "bilder/avatar2-hd.jpg?v=38", "bilder/avatar3-hd.jpg?v=38", "bilder/avatar4-hd.jpg?v=38",
  "bilder/avatar5-hd.jpg?v=38", "bilder/avatar6-hd.jpg?v=38", "bilder/avatar7-hd.jpg?v=38", "bilder/avatar8-hd.jpg?v=38",
  "bilder/freund-rapper-kevin.jpg?v=178", "bilder/freund-zocker-luca.jpg?v=178", "bilder/freund-bettler-nader.jpg?v=178",
  "bilder/freund-eintracht-sinan.jpg?v=178", "bilder/freund-boxer-kevin.jpg?v=178", "bilder/freund-gay-luca.jpg?v=178",
  "bilder/freund-diktator-nader.jpg?v=178", "bilder/freund-rambo-sinan.jpg?v=178", "bilder/freund-meerjungfrau-kevin.jpg?v=178",
  "bilder/freund-baywatch-luca.jpg?v=178", "bilder/freund-baby-nader.jpg?v=178", "bilder/freund-leoparden-sinan.jpg?v=178"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Einzeln laden: fällt eine Datei aus, scheitert nicht die ganze Installation.
      .then((cache) => Promise.allSettled(DATEIEN.map((d) => cache.add(d))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(namen.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Firestore und Google Fonts niemals abfangen - die brauchen immer das echte Netz.
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;

  // "Netz zuerst, Cache als Rückfall": online sieht man immer die aktuelle Version,
  // offline startet die App trotzdem. Für Bilder umgekehrt (die ändern sich kaum).
  const istBild = /\.(png|jpg|jpeg|svg|webp)$/i.test(url.pathname);

  if (istBild) {
    event.respondWith(
      caches.match(event.request).then((treffer) => treffer || fetch(event.request).then((antwort) => {
        const kopie = antwort.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, kopie));
        return antwort;
      }))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((antwort) => {
        const kopie = antwort.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, kopie));
        return antwort;
      })
      .catch(() => caches.match(event.request).then((treffer) => treffer || caches.match("index.html")))
  );
});
