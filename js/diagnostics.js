// ---------------------------------------------------------------------------
// Developer diagnostics page connection check (v9+ modular SDK).
//
// Originally the Milestone 1 landing page; moved to diagnostics.html so the
// real application entry point (index.html) can redirect to login/home
// instead. This file's logic is unchanged — it still only verifies:
//   1. A real Firebase config has been pasted in (not left as placeholders)
//   2. The Firebase app initialized without error
//   3. Firestore responds to a read request
//
// This is a READ-ONLY check — it queries for up to 1 document in a
// "systemStatus" collection and simply confirms Firestore responds (empty
// results still count as success). It does not write any document, so no
// throwaway test data is ever created in the database.
// ---------------------------------------------------------------------------

import { firebaseConfig } from "./firebase-config.js";
import { auth, db, firebaseInitError } from "./firebase-init.js";
import { collection, query, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

function setStatus(id, state, detailText) {
  const item = document.getElementById(`status-${id}`);
  const dot = item.querySelector('.dot');
  const detail = document.getElementById(`detail-${id}`);
  dot.classList.remove('pending', 'pass', 'fail');
  dot.classList.add(state);
  detail.textContent = detailText;
}

function setOverall(state, text) {
  const el = document.getElementById('overall');
  el.classList.remove('pass', 'fail');
  if (state) el.classList.add(state);
  el.textContent = text;
}

async function runChecks() {
  // --- Check 1: config looks like it was actually filled in ---
  const looksLikePlaceholder =
    !firebaseConfig ||
    firebaseConfig.apiKey === "REPLACE_WITH_YOUR_API_KEY" ||
    !firebaseConfig.projectId ||
    firebaseConfig.projectId.startsWith("REPLACE_WITH");

  if (looksLikePlaceholder) {
    setStatus('config', 'fail', 'Still using placeholder values');
    setStatus('app', 'fail', 'Skipped — fix config first');
    setStatus('firestore', 'fail', 'Skipped — fix config first');
    setOverall('fail', 'Paste your real Firebase project config into js/firebase-config.js, then reload this page.');
    return;
  }
  setStatus('config', 'pass', `Project: ${firebaseConfig.projectId}`);

  // --- Check 2: Firebase app initialized ---
  if (firebaseInitError || !db || !auth) {
    setStatus('app', 'fail', (firebaseInitError && firebaseInitError.message) || 'Unknown error');
    setStatus('firestore', 'fail', 'Skipped — app failed to initialize');
    setOverall('fail', 'Firebase failed to initialize. Check the config values and the browser console for details.');
    return;
  }
  setStatus('app', 'pass', 'Initialized successfully');

  // --- Check 3: lightweight, read-only Firestore connectivity check ---
  // No document is written. An empty result is a pass — it only proves
  // Firestore accepted and answered the request.
  try {
    const startedAt = performance.now();
    const probeQuery = query(collection(db, 'systemStatus'), limit(1));
    const snapshot = await getDocs(probeQuery);
    const elapsedMs = Math.round(performance.now() - startedAt);

    setStatus(
      'firestore',
      'pass',
      `Responded in ${elapsedMs}ms (${snapshot.size} doc${snapshot.size === 1 ? '' : 's'} found, no data written)`
    );
    setOverall('pass', 'All checks passed. Firebase and Firestore are working correctly.');
  } catch (err) {
    setStatus('firestore', 'fail', err.message || 'Unknown error');
    setOverall(
      'fail',
      'Firestore read failed. This is usually a Firestore Security Rules issue — see README "Testing Checklist".'
    );
  }
}

document.addEventListener('DOMContentLoaded', runChecks);
