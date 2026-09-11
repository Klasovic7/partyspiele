// Service Worker: macht die App installierbar und offline startfähig.
//
// WICHTIG bei Änderungen: die Zahl in CACHE_NAME hochzählen (z. B. v40 -> v41).
// Nur dann wirft der Browser den alten Zwischenspeicher weg und alle Spieler
// bekommen zuverlässig die neue Version. Das ist der einzige Handgriff, den man
// nach dem Bearbeiten von Dateien nicht vergessen darf.
const CACHE_NAME = "partyspiele-v54";

const DATEIEN = [
  "./",
  "index.html",
  "stil.css",
  "app.js",
  "manifest.json",
  "kern/firebase.js",
  "kern/ui.js",
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
  "bilder/icon-192.png",
  "bilder/icon-512.png",
  "bilder/icon-512-maskable.png",
  "bilder/apple-touch-icon.png",
  "bilder/avatar1-hd.jpg?v=38", "bilder/avatar2-hd.jpg?v=38", "bilder/avatar3-hd.jpg?v=38", "bilder/avatar4-hd.jpg?v=38",
  "bilder/avatar5-hd.jpg?v=38", "bilder/avatar6-hd.jpg?v=38", "bilder/avatar7-hd.jpg?v=38", "bilder/avatar8-hd.jpg?v=38"
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
