import type { Source } from './runner.js';
import { within } from './within.js';

export interface LM {
  availability(): Promise<string>;
  create(opts?: any): Promise<{ prompt(input: string): Promise<unknown>; destroy?(): void }>;
}

/** `confidence` is about the evidence, not the future: a passed probe says nothing guaranteed about the next call, hence `expires`. */
export interface Assessment {
  status: 'healthy' | 'unhealthy' | 'unknown';
  why: string;
  confidence: 'low' | 'high';
  expires: number;
  fingerprint?: string;
}

const fingerprint = (e: any) => `${e?.name}:${e?.code ?? ''}:${String(e?.message).replace(/\d+/g, '#').slice(0, 60)}`;

export interface HealthOpts {
  now?: () => number;
  ttl?: number;
  probeMs?: number;
  stallMs?: number;
  /** A tiny real inference. Default: call the model directly. Pass one that goes through your own SDK. */
  probe?: () => Promise<unknown>;
  /** Starts and tracks the model download, calling `onProgress` on every progress event. Default: `LanguageModel.create`. */
  download?: (onProgress: () => void) => Promise<unknown>;
}

export function health(lm: LM | undefined, { now = Date.now, ttl = 60_000, probeMs = 5_000, stallMs = 15_000, probe, download }: HealthOpts = {}) {
  let cur: Assessment = { status: 'unknown', why: 'not assessed', confidence: 'low', expires: 0 };
  const seen = new Map<string, number>();
  const set = (status: Assessment['status'], why: string, life: number, fp?: string): Assessment =>
    (cur = { status, why, confidence: 'high', expires: now() + life, fingerprint: fp });
  /** A fingerprint seen again is distrusted longer: 1x, 2x, 4x... of ttl, capped at 16x. */
  const fail = (e: unknown, why: string) => {
    const fp = fingerprint(e), n = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, n);
    return set('unhealthy', why, ttl * 2 ** Math.min(n - 1, 4), fp);
  };

  const check = async (): Promise<Assessment> => {
    if (!lm) return set('unhealthy', 'no LanguageModel API', Infinity);
    try {
      const a = await lm.availability();
      if (a === 'unavailable') return set('unhealthy', a, ttl * 10);
      if (a !== 'available') return set('unhealthy', a, ttl / 6); // downloadable/downloading: not ready yet
      // "available" is only what Chrome reports. Run a tiny real inference to see if it actually works.
      if (probe) await within(probe(), probeMs);
      else {
        const s = await within(lm.create(), probeMs);
        try { await within(s.prompt('ok'), probeMs); } finally { s.destroy?.(); }
      }
      return set('healthy', 'probe succeeded', ttl);
    } catch (e) {
      return fail(e, 'probe failed');
    }
  };

  type Warm = 'ready' | 'stuck' | 'failed';
  const warmOnce = (): Promise<Warm> =>
    !lm ? Promise.resolve('failed') : new Promise<Warm>(done => {
      let t: ReturnType<typeof setTimeout>;
      const arm = () => (clearTimeout(t), (t = setTimeout(() => done('stuck'), stallMs)));
      arm();
      const started = download
        ? download(arm)
        : lm.create({ monitor: (m: EventTarget) => m.addEventListener('downloadprogress', arm) }).then(s => s.destroy?.());
      started.then(
        () => (clearTimeout(t), done('ready')),
        e => (clearTimeout(t), fail(e, 'download failed'), done('failed')),
      );
    }).then(r => {
      if (r === 'stuck') fail(new Error('download stalled'), 'download stalled');
      if (r === 'ready') cur = { ...cur, expires: 0 }; // re-check next time, so work returns to the device
      return r;
    });

  return {
    /** Current assessment; re-checks only after it expires. */
    assess: async () => (now() < cur.expires ? cur : check()),
    /** Sync view for UIs and traces. */
    state: () => cur,
    /** Feed real inference failures in, so the next stage doesn't repeat a doomed device attempt. */
    record: (e: unknown, source: Source) => void (source === 'device' && fail(e, 'inference failed')),
    /** Trigger the model download and watch it, up to `tries` attempts. `stuck` = no progress event for `stallMs`. */
    warm: async (tries = 2) => {
      let r: Warm = 'failed';
      for (let i = 0; i < tries && r !== 'ready'; i++) r = await warmOnce();
      return r;
    },
  };
}

export type Health = ReturnType<typeof health>;
