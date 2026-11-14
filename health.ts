export type Source = 'device' | 'cloud';
export type Failure = 'init' | 'quota' | 'timeout' | 'inference';
export type Assessment = { healthy: boolean; kind?: Failure; at: number; expiresAt: number; confidence: number };
export type Options = { timeoutMs?: number; now?: () => number; classify?: (e: unknown) => Failure };

// How long a device failure is trusted before one probe is allowed (ms). Doubles per repeat, capped at 32x.
const TRUST: Record<Failure, number> = { init: 30_000, quota: 300_000, timeout: 60_000, inference: 15_000 };
const HEALTHY_FOR = 60_000; // a healthy verdict only describes the recent past

class Timeout extends Error {}

// PROVISIONAL: these patterns are guesses until we capture real errors from Chrome and the SDK.
const classifyDefault = (e: unknown): Failure => {
  const x = e as any;
  const text = `${x?.code ?? ''} ${x?.message ?? e}`;
  return /quota|rate|exhaust/i.test(text) ? 'quota' : /download|initiali|not.?ready|unavailable/i.test(text) ? 'init' : 'inference';
};

const withTimeout = <T>(p: Promise<T>, ms: number) => {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => { id = setTimeout(() => reject(new Timeout()), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(id));
};

export class Continuum {
  health: Assessment | null = null;
  trace: { at: number; event: string; kind?: Failure }[] = [];
  #streak = 0;
  #timeoutMs: number;
  #now: () => number;
  #classify: (e: unknown) => Failure;

  constructor({ timeoutMs = 5_000, now = Date.now, classify = classifyDefault }: Options = {}) {
    this.#timeoutMs = timeoutMs; this.#now = now; this.#classify = classify;
  }

  // Try the device unless it recently failed; a failed device never blocks the cloud path.
  // After a verdict expires, exactly one call probes the device again.
  async run<T>(device: () => Promise<T>, cloud: () => Promise<T>): Promise<{ value: T; source: Source }> {
    const h = this.health;
    if (h && !h.healthy && this.#now() < h.expiresAt) {
      this.#log('skip-device', h.kind);
      return { value: await cloud(), source: 'cloud' };
    }
    if (h && !h.healthy) this.#log('probe', h.kind);
    try {
      const value = await withTimeout(device(), this.#timeoutMs);
      this.#record(true);
      return { value, source: 'device' };
    } catch (e) {
      this.#record(false, e instanceof Timeout ? 'timeout' : this.#classify(e));
      return { value: await cloud(), source: 'cloud' };
    }
  }

  // Confidence is 1 - 2^-n over n consecutive agreeing observations: one sample is a hint, five is a pattern.
  #record(ok: boolean, kind?: Failure) {
    const at = this.#now(), h = this.health;
    this.#streak = h && h.healthy === ok && h.kind === kind ? this.#streak + 1 : 1;
    const ttl = ok ? HEALTHY_FOR : TRUST[kind!] * 2 ** Math.min(this.#streak - 1, 5);
    this.health = { healthy: ok, kind, at, expiresAt: at + ttl, confidence: 1 - 2 ** -this.#streak };
    this.#log(ok ? 'device-ok' : 'device-failed', kind);
  }

  #log(event: string, kind?: Failure) { this.trace.push({ at: this.#now(), event, kind }); }
}
