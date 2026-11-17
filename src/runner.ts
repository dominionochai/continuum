import { classify, type Kind } from './classify.js';
import type { Store } from './store.js';

export type Source = 'device' | 'cloud';

/** The whole task state is this append-only log; everything else is derived from it. */
export type Ev =
  | { k: 'start'; stage: string; source: Source }
  | { k: 'done'; stage: string; source: Source; out: unknown }
  | { k: 'fail'; stage: string; source: Source; err: string; kind: Kind }
  | { k: 'wait'; stage: string; source: Source; reason: 'offline' };
export type Entry = Ev & { at: number };

/** `saved` is scratch space for stages still in progress. It lives outside the log and is dropped when the stage finishes. */
export interface Task { id: string; input: unknown; log: Entry[]; saved?: Record<string, unknown> }
export interface Ctx<I> {
  input: I;
  done: Record<string, unknown>;
  source: Source;
  key: string;
  /** What an earlier attempt of this stage saved (a partial answer, a cursor), if it did not finish. */
  saved: unknown;
  /** Checkpoint inside the stage. Throttled; whatever was last saved survives a failure, a reload, or a move to another device. */
  save(value: unknown): void;
}
export interface StageOpts { needs?: Source }
export type Stage<I> = [name: string, run: (ctx: Ctx<I>) => Promise<unknown>, opts?: StageOpts];
export type Route = (log: Entry[], info?: { stage: string; needs?: Source }) => Source | Promise<Source>;
/** Wait this many ms before retrying the same source, or `undefined` to give up. `n` = failures so far for this stage and source. */
export type Backoff = (kind: Kind, n: number) => number | undefined;
export type Lock = <T>(id: string, fn: () => Promise<T>) => Promise<T>;
export interface Network { online(): boolean; whenOnline(): Promise<void> }

export const doneOf = (log: Entry[]): Record<string, unknown> =>
  Object.fromEntries(log.flatMap(e => (e.k === 'done' ? [[e.stage, e.out]] : [])));

const count = (log: Entry[], k: Entry['k']) => log.filter(e => e.k === k && e.source === 'device').length;

/** A stage's `needs` wins. Otherwise: device until an attempt is lost (starts > dones), then cloud for the rest of the task. */
export const defaultRoute: Route = (log, info) => info?.needs ?? (count(log, 'start') > count(log, 'done') ? 'cloud' : 'device');

/** Transient kinds get 3 tries in total; everything else is not worth repeating. The budget lives in the log, so it survives reloads. */
export const defaultBackoff: Backoff = (kind, n) =>
  (kind === 'network' || kind === 'timeout') && n < 3 ? 250 * 2 ** (n - 1) : undefined;

/** One run per task across tabs; the lock dies with the tab, so a crashed run can't wedge the task. */
export const webLock: Lock = (id, fn) =>
  globalThis.navigator?.locks ? navigator.locks.request(`continuum:${id}`, fn) : fn();

const browserNetwork: Network = {
  online: () => globalThis.navigator?.onLine !== false,
  whenOnline: () => new Promise(res => addEventListener('online', () => res(), { once: true })),
};

export function runner<I>(store: Store, stages: Stage<I>[], { route = defaultRoute, lock = webLock, network = browserNetwork, now = Date.now, saveEveryMs = 200, backoff = defaultBackoff, onFail = (_e: unknown, _s: Source, _k: Kind) => {}, onDone = (_s: Source) => {}, sleep = (ms: number) => new Promise(r => setTimeout(r, ms)) } = {}) {
  /** Starts the task, or resumes it from its log. Completed stages are never re-run. */
  const run = (id: string, input?: I) =>
    lock(id, async () => {
      const task: Task = (await store.get(id)) ?? { id, input, log: [] };
      const append = async (e: Ev) => (task.log.push({ ...e, at: now() }), store.put(task));

      for (const [stage, fn, opts] of stages) {
        /** Ask the route. If only the network is missing, record the wait and sit it out. */
        const pick = async (): Promise<Source> => {
          for (;;) {
            try { return await route(task.log, { stage, needs: opts?.needs }); }
            catch (e: any) {
              if (e?.reason !== 'offline') throw e;
              await append({ k: 'wait', stage, source: 'cloud', reason: 'offline' });
              await network.whenOnline();
            }
          }
        };

        while (!(stage in doneOf(task.log))) {
          const source = await pick();
          await append({ k: 'start', stage, source });

          let pending: unknown, dirty = false, last = -Infinity;
          const flush = async () => {
            if (!dirty) return;
            dirty = false;
            (task.saved ??= {})[stage] = pending;
            last = now();
            await store.put(task);
          };
          const save = (value: unknown) => {
            pending = value; dirty = true;
            if (now() - last >= saveEveryMs) void flush().catch(() => {});
          };

          try {
            const out = await fn({ input: task.input as I, done: doneOf(task.log), source, key: `${id}/${stage}`, saved: task.saved?.[stage], save });
            dirty = false;
            if (task.saved) delete task.saved[stage];
            await append({ k: 'done', stage, source, out });
            onDone(source);
          } catch (e) {
            await flush();
            const kind = classify(e, source);
            await append({ k: 'fail', stage, source, err: String(e), kind });
            onFail(e, source, kind);
            if ((await pick()) !== source) continue; // route moved on: go now, no waiting
            const wait = backoff(kind, task.log.filter(x => x.k === 'fail' && x.stage === stage && x.source === source).length);
            if (wait === undefined) throw e;
            await sleep(wait);
          }
        }
      }
      return doneOf(task.log);
    });

  return {
    run,
    /** Picks up every unfinished task in the store: call it on page load. */
    resumeAll: async () => {
      for (const id of (await store.ids?.()) ?? []) {
        const t = await store.get(id);
        if (t && !stages.every(([s]) => s in doneOf(t.log))) await run(id).catch(() => {});
      }
    },
  };
}
