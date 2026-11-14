import { classify, type Kind } from './classify.js';
import type { Store } from './store.js';

export type Source = 'device' | 'cloud';

/** The whole task state is this append-only log; everything else is derived from it. */
export type Ev =
  | { k: 'start'; stage: string; source: Source }
  | { k: 'done'; stage: string; source: Source; out: unknown }
  | { k: 'fail'; stage: string; source: Source; err: string; kind: Kind };
export type Entry = Ev & { at: number };

export interface Task { id: string; input: unknown; log: Entry[] }
export interface Ctx<I> { input: I; done: Record<string, unknown>; source: Source; key: string }
export type Stage<I> = [name: string, run: (ctx: Ctx<I>) => Promise<unknown>];
export type Route = (log: Entry[]) => Source | Promise<Source>;
/** Wait this many ms before retrying the same source, or `undefined` to give up. `n` = failures so far for this stage and source. */
export type Backoff = (kind: Kind, n: number) => number | undefined;
export type Lock = <T>(id: string, fn: () => Promise<T>) => Promise<T>;

export const doneOf = (log: Entry[]): Record<string, unknown> =>
  Object.fromEntries(log.flatMap(e => (e.k === 'done' ? [[e.stage, e.out]] : [])));

const count = (log: Entry[], k: Entry['k']) => log.filter(e => e.k === k && e.source === 'device').length;

/** Device until an attempt is lost (failed or interrupted: starts > dones), then cloud for the rest of the task. */
export const defaultRoute: Route = log => (count(log, 'start') > count(log, 'done') ? 'cloud' : 'device');

/** Transient kinds get 3 tries in total; everything else is not worth repeating. The budget lives in the log, so it survives reloads. */
export const defaultBackoff: Backoff = (kind, n) =>
  (kind === 'network' || kind === 'timeout') && n < 3 ? 250 * 2 ** (n - 1) : undefined;

/** One run per task across tabs; the lock dies with the tab, so a crashed run can't wedge the task. */
const webLock: Lock = (id, fn) =>
  globalThis.navigator?.locks ? navigator.locks.request(`continuum:${id}`, fn) : fn();

export function runner<I>(store: Store, stages: Stage<I>[], { route = defaultRoute, lock = webLock, now = Date.now, backoff = defaultBackoff, onFail = (_e: unknown, _s: Source, _k: Kind) => {}, onDone = (_s: Source) => {}, sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) } = {}) {
  return {
    /** Starts the task, or resumes it from its log. Completed stages are never re-run. */
    run: (id: string, input?: I) =>
      lock(id, async () => {
        const task: Task = (await store.get(id)) ?? { id, input, log: [] };
        const append = async (e: Ev) => (task.log.push({ ...e, at: now() }), store.put(task));

        for (const [stage, fn] of stages) {
          while (!(stage in doneOf(task.log))) {
            const source = await route(task.log);
            await append({ k: 'start', stage, source });
            try {
              const ctx = { input: task.input as I, done: doneOf(task.log), source, key: `${id}/${stage}` };
              await append({ k: 'done', stage, source, out: await fn(ctx) });
              onDone(source);
            } catch (e) {
              const kind = classify(e, source);
              await append({ k: 'fail', stage, source, err: String(e), kind });
              onFail(e, source, kind);
              if ((await route(task.log)) !== source) continue; // route moved on: go now, no waiting
              const wait = backoff(kind, task.log.filter(x => x.k === 'fail' && x.stage === stage && x.source === source).length);
              if (wait === undefined) throw e;
              await sleep(wait);
            }
          }
        }
        return doneOf(task.log);
      }),
  };
}
