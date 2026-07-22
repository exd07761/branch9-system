// ---------------------------------------------------------------------------
// Firestore data access layer for the "users" collection (role storage).
//
// This is the ONLY file that reads or writes the "users" collection — same
// split as hearings-data.js, activity-data.js, etc. auth-guard.js imports
// getOrCreateUserRole() from here rather than calling Firestore itself.
//
// Document shape, keyed by Firebase Auth uid (users/{uid}):
//   email, role, createdAt
//
// No migration: an existing account's document (or the whole collection)
// may not exist yet. getOrCreateUserRole() creates a document with the
// default role the first time that account is ever seen, and treats a
// document with no `role` field as DEFAULT_ROLE without rewriting it —
// see permissions.js for why branch_clerk is the safe default.
// ---------------------------------------------------------------------------

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-init.js";
import { DEFAULT_ROLE } from "./permissions.js";

const usersCol = collection(db, "users");

/**
 * Resolves `user`'s role, creating their users/{uid} document with the
 * default role the first time this account is seen (so every account
 * that has ever signed in eventually shows up in User Management,
 * without any separate account-creation step). Never throws — a
 * Firestore failure here must not block sign-in on every other page,
 * so callers get DEFAULT_ROLE and a console warning instead.
 */
export async function getOrCreateUserRole(user) {
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return data.role || DEFAULT_ROLE;
    }
    await setDoc(ref, { email: user.email || "", role: DEFAULT_ROLE, createdAt: serverTimestamp() });
    return DEFAULT_ROLE;
  } catch (err) {
    console.warn("[users-data] Could not resolve role, defaulting to", DEFAULT_ROLE, err);
    return DEFAULT_ROLE;
  }
}

/** Live list of every known user document, for the User Management page
 * (Administrator only). Sourced from the "users" collection itself — this
 * app has no Admin SDK access, so it cannot enumerate Firebase
 * Authentication accounts directly; an account appears here once it has
 * signed in at least once (see getOrCreateUserRole above). */
export function subscribeToAllUsers(onChange) {
  const q = query(usersCol, orderBy("email"));
  return onSnapshot(q, (snapshot) => {
    onChange(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/** Changes one user's role. Activity logging happens at the call site in
 * users.js, same convention as saveHearing()/deleteHearing() not logging
 * themselves. */
export async function updateUserRole(uid, role) {
  await updateDoc(doc(db, "users", uid), { role });
}
