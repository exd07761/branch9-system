// ---------------------------------------------------------------------------
// Shared constants with no dependencies of their own.
//
// Extracted here specifically to break a circular import: hearings.js
// imports docx-export.js, which imports export-data.js, which needed
// SECTIONS — importing it from hearings.js would have made that a cycle
// (hearings.js -> docx-export.js -> export-data.js -> hearings.js).
// Both hearings.js and export-data.js now import SECTIONS from here
// instead, and this file imports nothing.
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
