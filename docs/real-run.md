# Real-device run: what to do and what to bring back

Two runs. Run 1 needs only a laptop with Chrome. Run 2 also needs a Firebase project.

## Run 1: the capture kit (no Firebase)
1. Open `capture/capture.html` in Chrome. Press **1. Check this computer** (nothing downloads).
2. If it says Chrome's AI isn't switched on, do the optional flag section on the page, relaunch, press the check again.
3. If it needs a download (about 4 GB), continue only on Wi-Fi with no data limit. Press **2. Run the test**.
4. Press **Copy report** and paste it back, or **Save report.json**.
5. Bring back too: Chrome version, OS, RAM, free disk, GPU if known. If the check says "can't run it", a
   screenshot of `chrome://on-device-internals` (Model Status tab).

Then: `npm run analyze -- report.json`, fix the classifier from the real error names, lock them in with tests.

## Run 2: the app on real Nano
Needs: a Firebase project with Firebase AI Logic enabled, a web app registered, and App Check.

1. Create `.env.local` in the repo root:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_APPCHECK_DEBUG=1
   ```
2. `npm ci && npm run demo`, open the printed URL in Chrome. The banner must say "Running on this device",
   not "SIMULATED". If it says SIMULATED, Chrome has no `LanguageModel`; nothing below counts as a real run.
3. Open the browser console. The App Check SDK prints a debug token: register it in Firebase console >
   App Check > your web app > Manage debug tokens. Reload.
4. **Compare page** (`/compare.html`), tick "Force a real device failure":
   - Run on the left. Screenshot the real error and copy its exact text.
   - Run on the right. Screenshot the result and the trace.
   - **Run benchmark.** Copy the text and the JSON. It must start with "Real device."
5. **Digest** (`/`): press "Use a sample", then "Summarize". Screenshot the finished page and open "Under the
   hood" for the trace. Then repeat and reload the page mid-task: screenshot the resumed result.
6. Screen-record three moments: stock failing, Continuum recovering, a reload resuming. Rough is fine.

## Hosting (so judges can open it without installing anything)
```
npm run demo:build         # writes demo/dist
firebase init hosting      # public directory: demo/dist, single-page app: no
firebase deploy --only hosting
```
Use a reCAPTCHA Enterprise key (`VITE_APPCHECK_SITE_KEY`) for the hosted build instead of a debug token, and add
the hosted domain to the key's allowed domains.

## Bring back
Run 1: the report, specs, and any screenshot. Run 2: the screenshots, the exact error text, the benchmark text
and JSON, the Digest trace, the recordings, and the hosted URL.
