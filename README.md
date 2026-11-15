# Continuum

Durable, resumable multi-stage execution for hybrid (on-device + cloud) AI in the browser, on top of
Firebase AI Logic.

Stock `PREFER_ON_DEVICE` checks that the on-device model is *available*, then calls it with no fallback. If
inference then throws, the error reaches your app. Continuum probes the device, falls back per attempt,
and checkpoints every stage, so a reload or a crash resumes instead of starting over.

```ts
import { runner, idbStore, health, quota, policy, observe } from 'continuum';
import { firebaseGenerate } from 'continuum/firebase'; // needs @firebase/ai >= 13

const gen = firebaseGenerate(ai);                        // `ai` from getAI(...)
const h = health(window.LanguageModel), q = quota();

const tasks = runner(idbStore(), [
  ['extract',   async c => gen(c.source, `Extract the facts: ${c.input}`)],
  ['summarize', async c => gen(c.source, `Summarize: ${c.done.extract.text}`)],
], { route: policy(h, { quota: q }), ...observe(h, q) });

await tasks.run('doc-42', text); // starts the task, or resumes it after a reload
```

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

## Guarantees

- **At-least-once per stage.** A crash between a stage finishing and its checkpoint re-runs that stage. Use
  `ctx.key` (`taskId/stage`) to make side effects idempotent.
- One run per task across tabs (Web Locks).
- One lost device attempt sends the rest of the task to the cloud. Override with `route`.

## Verification status

- Tested (41 tests) against the real `@firebase/ai` 13.3 **browser build** with a **simulated** device
  (`fakeLanguageModel`) and a stubbed network. The simulated device reports `available`, then fails: stock
  Firebase surfaces the error, Continuum completes via cloud.
- Cloud error shapes (status codes, retry hints) come from the SDK's own source.
- **Not yet verified:** real Gemini Nano. Real on-device error shapes are unknown, so device errors fall into
  `inference`, which is the safe default. Real-browser IndexedDB and Web Locks are untested.
- The SDK's Node build never wires up the on-device adapter. Test hybrid mode against the browser build.

## Demo

`npm run demo` serves a two-column page (Firebase alone vs Continuum). It simulates the device unless Chrome
exposes a real `LanguageModel`, and says so in a banner. Add `?sim` to force simulation. On a real device, tick "Force a real device failure": it sends a prompt
larger than the model's input quota, so stock Firebase fails on real Nano without any simulation. For real cloud calls
set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`.

`prototype/` holds the earlier single-file prototype, kept for reference.

License: Apache-2.0
