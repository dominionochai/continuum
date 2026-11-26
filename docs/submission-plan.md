# Submission plan, with no on-device model

Deadline: Nov 30, 2:00 pm PST (11:00 pm in Lagos). Aim to submit Nov 29.

## What is real without Nano
Real Firebase AI Logic on the cloud, real App Check, real Firestore cross-device resume, real offline waiting,
and one real SDK gap that needs no Nano: with no Prompt API, `ONLY_ON_DEVICE` silently sends the prompt to the
cloud (compare page, "Privacy" section). What stays simulated: the device, and only when `?sim` is on. The page
says so in a banner. Mid-stream failover and the "available, then fails" gap are shown against that simulated
device only, and must be described that way.

## What I need from you (about 15 minutes in the Firebase console)
1. **A Firebase project** (new or existing). Add a **Web app** and send me three values from its config:
   `apiKey`, `projectId`, `appId`.
2. **Firebase AI Logic**: Build > AI Logic > Get started, choose the **Gemini Developer API**.
3. **App Check**: register the web app with **reCAPTCHA Enterprise**, send me the **site key**. Add your hosted
   domain to the key's allowed domains. (For local runs, a debug token instead: see docs/real-run.md.)
4. **Authentication**: Sign-in method > enable **Anonymous**.
5. **Firestore**: create a database, then paste the contents of `docs/firestore.rules` into its Rules tab and publish.
6. **Say "make it public"**: I'll make the repo public with the token you gave me and deploy the demo to GitHub
   Pages (it is a public site: `https://dominionochai.github.io/continuum/`). Add that domain to the reCAPTCHA key.
   Or do it yourself: Settings > General > Change visibility, then Settings > Pages > Source: GitHub Actions.
7. **Record the video** (I cannot). The shot list below.
8. **Submit on Devpost** with the text from `docs/devpost-draft.md`.

Not needed for the hackathon: publishing to npm, a real-device run, a Firebase CLI login.

## Video, 3 minutes or less (every beat is real unless marked)
1. Problem, 20s: say the three SDK behaviors in one breath (they are verified in the SDK source).
2. The leak, 30s, real: open the compare page in a browser with no Prompt API (Firefox or Safari). Click stock
   `ONLY_ON_DEVICE`: "served by in_cloud, the prompt left this device". Click Continuum: it refuses and sends nothing.
3. Digest, 40s, real cloud: summarize the sample. Show the trace.
4. Reload mid-task, 30s, real: start a summary, reload, it resumes without redoing the finished sections.
5. Offline, 30s, real: tick "Pretend to be offline". The polish step waits, the summary is already usable. Untick.
6. Another device, 30s, real (needs steps 1-5 above and `VITE_SYNC=1`): copy the link, open it on a phone,
   it carries on.
7. Close, 10s: repo, license, link. If you show the simulated device (failover), say "simulated" out loud.

## Claims
You can say: found and reproduced three SDK behaviors; all inference goes through Firebase AI Logic; resumes after
reload, offline, and across devices; the on-device paths are tested against a simulated device.
You cannot say: measured on Gemini Nano, anything about real on-device errors, latency numbers, or "production-ready".
