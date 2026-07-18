// ---------------------------------------------------------------------------
// Initializes Firebase (v9+ modular SDK) and exports shared instances for
// the rest of the app.
//
// `auth` and `db` are imported by every later milestone (login, hearings
// CRUD, search, etc.) so this file stays the single place that initializes
// Firebase — no other file calls initializeApp again.
// ---------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export let auth = null;
export let db = null;
export let firebaseInitError = null;

try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  // Caught here (rather than left to crash silently) so app.js can report
  // a clear, specific failure reason instead of a blank/broken page.
  firebaseInitError = err;
}
