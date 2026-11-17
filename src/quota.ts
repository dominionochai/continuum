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
 * Pick the preferred source if usable, else the other, within what the stage `needs`. The device is usable if this
 * task hasn't lost a device attempt and it looks healthy; the cloud is usable if we are online and its quota window
 * is closed. If nothing is usable, throw instead of making an attempt that is bound to fail: `reason: 'offline'` makes
 * the runner wait for the network; anything else surfaces, and the task stays resumable.
 */
export function policy(h: Health, { quota: q, prefer = 'device', online = () => globalThis.navigator?.onLine !== false }: { quota?: Quota; prefer?: Source; online?: () => boolean } = {}): Route {
  return async (log, info) => {
    const usable = {
      device: async () => defaultRoute(log) === 'device' && (await h.assess()).status === 'healthy',
      cloud: async () => online() && !q?.exhausted(),
    };
    const order = (prefer === 'device' ? (['device', 'cloud'] as const) : (['cloud', 'device'] as const)).filter(s => !info?.needs || s === info.needs);
    for (const s of order) if (await usable[s]()) return s;
    const cloud = order.includes('cloud');
    const reason = cloud && !online() ? 'offline' : cloud && q?.exhausted() ? 'quota' : 'device';
    throw Object.assign(new Error(`no usable source (${reason})`), { name: 'AllRoutesBlocked', reason, until: q?.state().until });
  };
}
