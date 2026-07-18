# Docket Management System — Milestone 1: Project Setup

This milestone only proves the foundation works: Firebase connects, Firestore
accepts reads/writes, and the site deploys on GitHub Pages. No login, no
hearings, no cases yet — that starts in Milestone 2 onward.

---

## 1. Create the Firebase Project

1. Go to https://console.firebase.google.com and click **Add project**.
2. Give it a name (e.g. `branch9-docket` or similar — this becomes part of
   your project ID, so pick something you're fine seeing in URLs).
3. You can disable Google Analytics for this project — it isn't needed.
4. Once the project is created, go to **Build → Firestore Database** and
   click **Create database**. Choose a region close to the Philippines
   (e.g. `asia-southeast1`). Start in **production mode** — we'll set real
   security rules in Milestone 2 alongside Authentication.
5. Go to **Build → Authentication** and click **Get started**. Enable the
   **Email/Password** sign-in method. (You won't use it yet — that's
   Milestone 2 — but enabling it now means it's ready.)

## 2. Get Your Firebase Web Config

1. In the Firebase Console, click the gear icon → **Project settings**.
2. Under **Your apps**, click the web icon (`</>`) to register a new web app.
3. Give it a nickname (e.g. `docket-web`). You do **not** need Firebase
   Hosting — you're using GitHub Pages instead.
4. Firebase will show you a `firebaseConfig` object. Copy it.
5. Open `js/firebase-config.js` in this project and replace every
   `REPLACE_WITH_...` placeholder with your actual values.

## 3. Set Temporary Firestore Rules (for this milestone only)

Since Authentication isn't wired into the app until Milestone 2, use these
**temporary, read-only rules** just to confirm the connection works. Go to
**Firestore Database → Rules** and set:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /systemStatus/{docId} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

This only opens up **read** access to the `systemStatus` collection used by
this milestone's connection check — no writes are allowed, and none are
attempted, so no test documents ever get created. Milestone 2 will replace
this with rules that require a logged-in user.

## 4. A Note on the Modular SDK and Local Testing

This project uses the Firebase v9+ **modular SDK** via ES module imports
(`import { ... } from ".../firebase-app.js"`) rather than the older compat
scripts. This means:

- `index.html` loads `js/app.js` with `type="module"`, and the imports
  cascade from there (`app.js` → `firebase-init.js` → `firebase-config.js`).
- Browsers block ES module imports over the `file://` protocol, so opening
  `index.html` by double-clicking it will show a blank page with console
  errors. To test locally before pushing to GitHub, serve the folder over
  HTTP — e.g. `npx serve .` or `python3 -m http.server` from inside the
  project folder, then open `http://localhost:<port>`.
- GitHub Pages serves everything over HTTPS by default, so no special
  configuration is needed there — this only matters for local testing.

## 5. Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `docket-management-system`) and push
   this folder's contents to it.
2. In the repo, go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**, pick your default
   branch (e.g. `main`), and folder `/ (root)`.
4. Save. GitHub will give you a URL like:
   `https://<your-username>.github.io/docket-management-system/`
5. Wait 1–2 minutes for the first deploy, then open that URL.

## 6. Testing Checklist

Open the deployed URL and confirm:

- [ ] Page loads with no visible errors (open browser DevTools → Console
      to check for red errors too)
- [ ] **Firebase config loaded** shows a green dot and your project ID
- [ ] **Firebase app initialized** shows a green dot
- [ ] **Firestore connection test (read-only)** shows a green dot with a
      response time (e.g. "Responded in 120ms (0 docs found, no data
      written)")
- [ ] The banner at the bottom reads: *"All checks passed. Firebase and
      Firestore are ready for Milestone 2."*
- [ ] In the Firebase Console, go to **Firestore Database → Data** and
      confirm the database is still empty — no `systemStatus` collection
      or any other document should have been created by this check.

If any check fails, the detail text next to that check explains why —
most commonly it's either a placeholder value left in
`js/firebase-config.js`, or the Firestore rules from step 3 not yet saved.

## 7. Expected Results After Deployment

A live, public GitHub Pages URL showing a simple status page with three
green checkmarks — and a Firestore database that remains completely empty,
since this check only reads and never writes. This confirms the full chain
(GitHub Pages → your browser → Firebase Authentication config → Firestore)
is wired correctly before any real docket data or features are built on
top of it.

---

**Next milestone (do not start yet):** Milestone 2 — Authentication. This
will replace this status page with a real login screen and tighten the
Firestore rules above to require a logged-in user.
