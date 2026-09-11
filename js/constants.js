// ---------------------------------------------------------------------------
// Shared constants with no dependencies of their own.
//
// Extracted here specifically to break a circular import: hearings.js
// imports docx-export.js, which imports export-data.js, which needed
// SECTIONS — importing it from hearings.js would have made that a cycle
// (hearings.js -> docx-export.js -> export-data.js -> hearings.js).
// Both hearings.js and export-data.js now import SECTIONS from here
// instead, and this file imports nothing.
//
// STATUSES (added Phase 6 completion pass) is here for a related but
// distinct reason: not a circular import, but the same "needs one
// authoritative home outside any page controller" problem — cases.js
// needs the Hearing status vocabulary for its Status filter, and
// importing it from hearings.js directly would pull in hearings.js's
// entire page-controller module (DOM wiring, its own init() call) onto
// the Cases page. Both hearings.js and cases.js now import STATUSES
// from here.
// ---------------------------------------------------------------------------

export const SECTIONS = [
  "PROMULGATION",
  "MOTIONS",
  "ARRAIGNMENT AND PRE-TRIAL CONFERENCE",
  "TRIAL",
  "DEFENSE EVIDENCE",
  "PROSECUTIONS EVIDENCE",
  "HEARING ON THE DISPOSITION PROGRAM OF THE CICL",
  "HEARING ON THE AFTERCARE SERVICES OF THE CICL",
];

// Moved here from hearings.js (Phase 6 completion pass — Case Status
// filter) for the same reason SECTIONS already lives here: it needed a
// single authoritative home two independent files could both import
// without either importing the other's page-controller module (which
// would run that module's own init()/DOM wiring). This is the exact set
// of values a Hearing's `status` field can hold — and, since a Case's
// currentStatus is always derived from its latest linked Hearing's
// status (case-status-derivation.js), it is also the complete set of
// values a Case's currentStatus can ever hold. hearings.js still owns
// the Hearing status <select> that writes this field; this file just
// holds the shared list both it and cases.js's Status filter read from,
// so the two can never drift apart.
export const STATUSES = [
  "Arraignment and Pre-Trial Conference",
  "Pre-Trial Conference",
  "Initial Presentation of Prosecution's Evidence",
  "Continuation of the Direct Examination of Prosecution's Witness",
  "Cross Examination of Prosecution's Witness",
];
