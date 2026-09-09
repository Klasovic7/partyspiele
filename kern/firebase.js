// Zentrale Firebase-Anbindung. Alle anderen Dateien holen sich "db" und die
// Firestore-Funktionen von hier, damit die Verbindung nur EINMAL aufgebaut wird.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  initializeFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs,
  onSnapshot, serverTimestamp, increment, runTransaction, arrayUnion, arrayRemove, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIOL15RHsuT4pZnjp6MjfWUGIpafTnZ1g",
  authDomain: "partyspiele-e4b81.firebaseapp.com",
  projectId: "partyspiele-e4b81",
  storageBucket: "partyspiele-e4b81.firebasestorage.app",
  messagingSenderId: "861324250447",
  appId: "1:861324250447:web:bc3f4f2f755ecedd36493a"
};

const app = initializeApp(firebaseConfig);

// Erzwingt Long-Polling statt der (bei Safari manchmal hakenden) Streaming-Verbindung.
export const db = initializeFirestore(app, { experimentalForceLongPolling: true });

// Anonyme Anmeldung: jeder Besucher bekommt automatisch, ohne Login-Formular,
// eine eigene, feste Nutzer-Id von Firebase. Damit lassen sich die Firestore-Regeln
// von "für jeden offen" auf "nur für angemeldete Nutzer" umstellen (siehe
// ANLEITUNG.md) - spürbar ändert sich für die Spieler dadurch nichts.
const auth = getAuth(app);

// "authBereit" wird erst erfüllt, wenn wirklich ein Nutzer angemeldet ist - alle
// Firestore-Zugriffe warten darauf, sonst würden sie auf den (noch geschützten)
// Regeln abprallen, bevor die Anmeldung durch ist.
export const authBereit = new Promise((resolve, reject) => {
  const beenden = onAuthStateChanged(auth, (nutzer) => {
    if (nutzer) { beenden(); resolve(nutzer); }
  }, reject);
  signInAnonymously(auth).catch(reject);
});

// Name der obersten Sammlung in Firestore. Ein "Raum" gilt für den ganzen Abend,
// unabhängig davon, welches Spiel gerade läuft.
export const RAEUME = "raeume";

export {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot,
  serverTimestamp, increment, runTransaction, arrayUnion, arrayRemove, writeBatch
};
