import { expect, it } from 'vitest';
import { classify, fakeLanguageModel, health, observe, policy, quota } from '../src/index.js';

const hint = (s: string) => ({ customErrorData: { errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: s }] } });
const clock = () => { let t = 0; return { now: () => t, to: (ms: number) => (t = ms) }; };

it('uses the server hint, else a base window that doubles per consecutive hit, capped', () => {
  const c = clock(), q = quota({ now: c.now, base: 1000, cap: 3000 });
  q.hit({});          expect(q.state().until).toBe(1000);
  c.to(1001); q.hit({}); expect(q.state().until).toBe(1001 + 2000);
  c.to(4000); q.hit({}); expect(q.state().until).toBe(4000 + 3000);   // capped
  c.to(8000); q.hit(hint('34.5s')); expect(q.state().until).toBe(8000 + 34_500); // never shorter than the server asked
});

it('a cloud success ends the streak; the window closes by itself', () => {
  const c = clock(), q = quota({ now: c.now, base: 1000 });
  q.hit({}); q.hit({});
  expect(q.state()).toMatchObject({ exhausted: true, hits: 2 });
  c.to(5000);
  expect(q.exhausted()).toBe(false);
  q.ok(); q.hit({});
  expect(q.state().until).toBe(5000 + 1000);
});

const lm = (prompt: 'ok' | 'throw') => health(fakeLanguageModel({ availability: 'available', prompt }), { probeMs: 20 });

it('prefers the configured source, falls to the other when it is unusable', async () => {
  const q = quota();
  expect(await policy(lm('ok'), { quota: q })([])).toBe('device');
  expect(await policy(lm('ok'), { quota: q, prefer: 'cloud' })([])).toBe('cloud');
  q.hit({});
  expect(await policy(lm('ok'), { quota: q, prefer: 'cloud' })([])).toBe('device');
  expect(await policy(lm('throw'), { quota: quota() })([])).toBe('cloud');
});

it('throws, with the reopening time, when neither source is usable', async () => {
  const c = clock(), q = quota({ now: c.now, base: 1000 });
  q.hit({});
  await expect(policy(lm('throw'), { quota: q })([])).rejects.toMatchObject({ name: 'AllRoutesBlocked', until: 1000 });
});

it('observe: device quota (one oversized prompt) does not mark the whole device unhealthy', async () => {
  const h = lm('ok'), q = quota();
  await h.assess();
  const { onFail, onDone } = observe(h, q);
  const tooBig = new DOMException('input too large', 'QuotaExceededError');
  onFail(tooBig, 'device', classify(tooBig, 'device'));
  expect(h.state().status).toBe('healthy');
  onFail(hint('5s'), 'cloud', 'quota');
  expect(q.exhausted()).toBe(true);
  onDone('cloud');
  expect(q.state().hits).toBe(0);
});
