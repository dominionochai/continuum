# Continuum

Durable, resumable multi-stage execution for hybrid (on-device + cloud) AI in the browser, on top of
Firebase AI Logic.

Stock `PREFER_ON_DEVICE` checks that the on-device model is *available*, then calls it with no fallback. If
inference then throws, the error reaches your app. Continuum probes the device, falls back per attempt,
and checkpoints every stage, so a reload or a crash resumes instead of starting over.

```ts
import { runner, idbStore, health, quota, policy, observe } from 'continuum';
import { firebaseGenerate } from 'continuum/firebase'; // needs @firebase/ai >= 2.16

const gen = firebaseGenerate(ai);                        // `ai` from getAI(...)
const h = health(window.LanguageModel), q = quota();

const tasks = runner(idbStore(), [
  ['extract',   async c => gen(c.source, `Extract the facts: ${c.input}`)],
  ['summarize', async c => gen(c.source, `Summarize: ${c.done.extract.text}`)],
], { route: policy(h, { quota: q }), ...observe(h, q) });

await tasks.run('doc-42', text); // starts the task, or resumes it after a reload
```

All inference goes through Firebase AI Logic, including Continuum's health probe and the model download
(`initializeDeviceModel`). The only code that calls Chrome's `LanguageModel` directly is `capture/`, a standalone
measurement kit that is not part of the app.

## What each part does

- **`runner`**: stages are checkpointed to IndexedDB. Finished stages are never re-run.
- **`health`**: a probe (a tiny real inference) instead of trusting `available`. Assessments expire, and a
  recurring failure is distrusted for longer each time. `warm()` detects stalled model downloads.
- **`policy`** + **`quota`**: pick the source per attempt. A cloud 429 opens a window that honors the
  server's retry hint and doubles on repeats. If neither source is usable it throws `AllRoutesBlocked`
  instead of making an attempt that is bound to fail.
- **`classify`**: errors become `quota | network | timeout | availability | config | inference`. Only
  transient kinds are retried (3 tries, backoff).
- **`spans`, `recoveries`, `format`**: a trace of every attempt, labeled `observed` or `inferred`.

## Beyond stages

```ts
// Checkpoint inside a stage, and continue an answer another attempt began (mid-stream failover):
['write', c => gen.stream(c.source, prompt, { saved: c.saved, save: c.save })],

// A stage that only the cloud can run. Offline, the runner records a wait and carries on by itself when the
// network returns. Device-only stages ({ needs: 'device' }) are never sent to the cloud.
['polish', c => gen(c.source, ...), { needs: 'cloud' }],

await tasks.resumeAll(); // on page load: finish every unfinished task

// Cross-device resume: local-first, a lease so only one device runs a task, and the log merges by length.
import { firestoreRemote } from 'continuum/firestore';
const { store, lock } = sync(idbStore(), firestoreRemote(db), deviceId);
const tasks = runner(store, stages, { lock, ... });
```

- `ctx.save(value)` is throttled (200 ms). What was saved last survives a failure, a reload, or a move to another
  device, and is dropped once the stage finishes.
- A continued answer is a new model call that is shown the answer so far. It is a continuation, not the same
  model state, and the result says `continued: true`.
- A device that dies loses its lease after `ttl` (30 s) and another device takes over. Leases assume clocks within
  a few seconds of each other.
- Offline, sync skips the remote and the device carries on alone, so two offline devices could both run a task.
- Tasks are keyed by their id. `docs/firestore.rules` treats the id as the secret (an "anyone with the link"
  model), with anonymous sign-in. Tighten it if tasks hold anything sensitive.

## Guarantees

- **At-least-once per stage.** A crash between a stage finishing and its checkpoint re-runs that stage. Use
  `ctx.key` (`taskId/stage`) to make side effects idempotent.
- One run per task across tabs (Web Locks).
- The Firebase adapter guards three SDK behaviors (checked in `@firebase/ai` 3.1.0): `ONLY_ON_DEVICE` silently uses
  the cloud when `LanguageModel` is absent, every on-device call destroys the previous session so device calls take
  turns, and the on-device path has no timeout.
- One lost device attempt sends the rest of the task to the cloud. Override with `route`.

## Verification status

- Tested (41 tests) against the real `@firebase/ai` 3.1.0 **browser build** with a **simulated** device
  (`fakeLanguageModel`) and a stubbed network. The simulated device reports `available`, then fails: stock
  Firebase surfaces the error, Continuum completes via cloud.
- Cloud error shapes (status codes, retry hints) come from the SDK's own source.
- Mid-stream failover, offline waiting, stage checkpoints and cross-device takeover are tested against the real SDK
  or an in-memory server, never against real Gemini Nano. **The Firestore adapter (`continuum/firestore`) compiles
  but has not run against a real Firestore project.**
- **Not yet verified:** real Gemini Nano. Real on-device error shapes are unknown, so device errors fall into
  `inference`, which is the safe default. Real-browser IndexedDB and Web Locks are untested.
- The SDK's Node build never wires up the on-device adapter. Test hybrid mode against the browser build.

## Demo

`npm run demo` serves **Digest** at `/`: paste long text and get a summary. It reads sections on the device (with
a cursor saved inside the stage), streams the summary (continued on the cloud if the device dies partway), and
polishes the wording on the cloud (a cloud-only stage: offline, it waits and finishes by itself). Close the page
mid-task and it picks up where it stopped. `/compare.html` runs stock Firebase and Continuum side by side.

Both pages simulate the device unless Chrome exposes a real `LanguageModel`, and say so in a banner. Add `?sim`
to force simulation. For real cloud calls set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` and
`VITE_FIREBASE_APP_ID`. Firebase AI Logic requires App Check: set `VITE_APPCHECK_DEBUG=1` for local development
(the SDK prints a token to register in the console) or `VITE_APPCHECK_SITE_KEY` for a reCAPTCHA Enterprise key.
The App Check wiring has not been run against a real project. On a real device, tick "Force a real device
failure" on the compare page: it sends a prompt larger than the model's input quota, so stock Firebase fails on
real Nano without any simulation.

## Benchmark

`bench/bench.ts` compares stock Firebase with Continuum on one two-stage task: (1) does it survive a device that
reports available and then fails on this prompt, and (2) what happens when the page dies in stage 2. The demo
has a "Run benchmark" button. A run says `SIMULATED` unless a real device was used. In the interruption scenario
the stock numbers are by construction (stock keeps no state) and are labeled that way; Continuum's are read from
its log.

`docs/upstream-issue-draft.md` is a draft issue for the missing on-device fallback in `PREFER_ON_DEVICE`. It is
not filed and must be confirmed on real hardware first.

`prototype/` holds the earlier single-file prototype, kept for reference.

License: Apache-2.0
