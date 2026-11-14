# Continuum

Durable, resumable multi-stage execution for hybrid (on-device + cloud) AI in the browser.

A task is a list of stages. Each stage's result is checkpointed to IndexedDB. If the page reloads or the
device model fails mid-task, `run` picks up where it stopped: finished stages are never re-run, and the
remaining work goes to the cloud.

```ts
import { runner, idbStore } from 'continuum';

const tasks = runner(idbStore(), [
  ['extract',   async ({ input, source }) => /* call your model; `source` is 'device' | 'cloud' */ ],
  ['summarize', async ({ done })          => /* `done.extract` is the earlier result */ ],
]);

await tasks.run('doc-42', input); // starts the task, or resumes it after a reload
```

## Guarantees

- **At-least-once per stage.** A crash between a stage finishing and its checkpoint re-runs that stage.
  Make side effects idempotent using `ctx.key` (`taskId/stage`), which is stable across attempts.
- **One run per task across tabs** (Web Locks). Pass `lock` to override.
- **One lost device attempt moves the rest of the task to cloud.** Pass `route` to change the policy.

## Traces

`spans(log)`, `recoveries(log)` and `format(log)` derive a timeline from the task log. Each span is labeled
`observed` or `inferred`. `source` is the route requested, not confirmed by Firebase.

## Status

Not yet implemented: the Firebase AI Logic adapter, health probes, and error classification.

`prototype/` is the earlier single-file prototype, kept for reference.

License: Apache-2.0
