import type { Kind } from './classify.js';
import type { Health } from './health.js';
import { defaultRoute, type Route, type Source } from './runner.js';

/** The server's own retry hint (google.rpc.RetryInfo, e.g. "34s") in ms, if the error carries one. */
const retryDelay = (e: any): number | undefined => {
  const d = e?.customErrorData?.errorDetails?.find((x: any) => String(x?.['@type']).endsWith('RetryInfo'));
  const s = parseFloat(d?.retryDelay);
  return Number.isFinite(s) ? s * 1000 : undefined;
};

/**
 * Cloud quota is time-based and project-wide, so it gets a window. Device-side quota is not tracked here:
 * it means one prompt was too big, which says nothing about the next one.
 */
export function quota({ now = Date.now, base = 30_000, cap = 600_000 } = {}) {
  let until = 0, hits = 0;
  return {
    /** The window is never shorter than the server asked, and doubles (up to `cap`) on each consecutive hit. */
    hit(e: unknown) {
      until = now() + Math.max(retryDelay(e) ?? 0, Math.min(base * 2 ** hits, cap));
      hits++;
    },
    /** A cloud success ends the streak. */
    ok: () => void (hits = 0),
    exhausted: () => now() < until,
    state: () => ({ exhausted: now() < until, until, hits }),
  };
}

export type Quota = ReturnType<typeof quota>;

/** Wires runner hooks to the health engine and the quota tracker: `runner(store, stages, { route, ...observe(h, q) })`. */
export const observe = (h: Health, q: Quota) => ({
  onFail: (e: unknown, source: Source, kind: Kind) => {
    if (source === 'cloud' && kind === 'quota') q.hit(e);
    else if (source === 'device' && kind !== 'quota') h.record(e, source);
  },
  onDone: (source: Source) => source === 'cloud' && q.ok(),
});

/**
 * Pick the preferred source if usable, else the other. The device is usable if this task hasn't lost a device
 * attempt and it currently looks healthy; the cloud is usable unless its quota window is open.
 * If neither is usable, throw instead of making an attempt that is bound to fail: the task stays resumable.
 */
export function policy(h: Health, { quota: q, prefer = 'device' }: { quota?: Quota; prefer?: Source } = {}): Route {
  return async log => {
    const usable = {
      device: async () => defaultRoute(log) === 'device' && (await h.assess()).status === 'healthy',
      cloud: async () => !q?.exhausted(),
    };
    for (const s of prefer === 'device' ? (['device', 'cloud'] as const) : (['cloud', 'device'] as const))
      if (await usable[s]()) return s;
    throw Object.assign(new Error('device unavailable and cloud quota exhausted'), { name: 'AllRoutesBlocked', until: q?.state().until });
  };
}
