# Devpost draft (not final)

Everything in [BRACKETS] needs a real measurement or link. Do not submit a bracket. Every claim below has a
source in this repo; the source is named after it.

## Private checklist against the rules
- Public repo with the Apache-2.0 license visible in the About box: [make the repo public]
- Hosted project URL: [deploy]
- Video, 3 minutes or less, YouTube, public, showing it working in Chrome: [record; shot list in docs/submission-plan.md]
- Firebase AI Logic used at runtime, imported and called: `src/firebase.ts`
- App Check: wired in `demo/setup.ts`; [verify against the real project]
- Text description (below)

## Tagline
Hybrid AI that keeps its promise: when the on-device model fails or the page reloads, the work continues.

## The problem
Hybrid inference promises on-device speed and privacy, with the cloud as a safety net. In `@firebase/ai` 3.1.0
the safety net has holes, each checked in the SDK source and reproduced with the real SDK (`test/adapter.test.ts`,
`test/firebase.test.ts`):
- `PREFER_ON_DEVICE` checks that the model is available, then calls it with no fallback. If inference fails, the
  error reaches the app.
- `ONLY_ON_DEVICE` silently runs in the cloud when `LanguageModel` is absent. The request leaves the device.
- Every on-device call destroys the previous session, so concurrent calls abort each other.
- The on-device path has no timeout, so a hung call never settles.

## What Continuum does
It sits between the app and Firebase AI Logic and makes each of those cases recoverable:
- **Probes the device** with a tiny real inference instead of trusting "available", and trusts the result for a
  limited time.
- **Falls back per attempt**, to the cloud, with bounded retries and a quota window that honors the server's retry hint.
- **Checkpoints every stage** to IndexedDB, so a reload resumes instead of starting over.
- **Continues a streamed answer on the cloud** from where the device stopped.
- **Waits offline** for cloud-only stages and finishes by itself when the network returns.
- **Resumes across devices** with Firestore: [only if verified against a real project].

**Digest** is the app built on it: paste long text, get a summary. Sections are read on the device with a cursor
saved inside the stage, the summary streams, and a polish step needs the cloud.

## How we use Firebase AI Logic
All inference goes through it: `getGenerativeModel` with `ONLY_ON_DEVICE` or `ONLY_IN_CLOUD` chosen per attempt,
`generateContent` and `generateContentStream`, `inferenceSource` to confirm which backend served each call,
`initializeDeviceModel` for the download, and App Check. [Firestore and Auth for cross-device resume: only if built
and verified.]

## What is verified, and what is not
- Verified against the real `@firebase/ai` 3.1.0: the four SDK behaviors above (tests in `test/`), with the real
  cloud when configured.
- Real cloud, real browser: reload resume, offline waiting, cross-device resume [once verified against the project].
- **Not verified on a real on-device model.** The device is simulated, and the app says so in a banner whenever it
  is. We have no measurements from Gemini Nano. Real on-device error shapes are unknown, so unknown device errors
  are treated as "inference failed": not retried, and the work moves to the cloud.

## Challenges
- Finding the SDK behaviors above, and proving each against the real SDK before relying on it.
- The SDK's Node build never wires up the on-device adapter, so a Node test of hybrid mode silently runs in the
  cloud. We test against the browser build.
- Testing honestly without a device: a simulated device is labeled as one everywhere.

## What we learned
The SDK's Node build never wires up the on-device adapter. A simulated device is only honest if it is labeled.

## What's next
[Android and iOS ports; filing the SDK findings upstream once confirmed on real hardware.]

## Built with
TypeScript, Firebase AI Logic (`@firebase/ai`), Firebase App Check, IndexedDB, Web Locks, Vite, Vitest.

## Try it
[hosted URL]  [repo URL]
