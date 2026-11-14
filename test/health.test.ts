import { expect, it } from 'vitest';
import { defaultRoute, fakeLanguageModel, health, policy, type Sim } from '../src/index.js';

const rig = (sim: Sim, opts = {}) => {
  let t = 0;
  const h = health(fakeLanguageModel(sim), { now: () => t, ttl: 1000, probeMs: 30, stallMs: 30, ...opts });
  return { h, sim, tick: (ms: number) => (t += ms), at: () => t };
};

it('does not trust "available": a failing probe makes the device unhealthy', async () => {
  const { h } = rig({ availability: 'available', prompt: 'throw' });
  expect(await h.assess()).toMatchObject({ status: 'unhealthy', why: 'probe failed', confidence: 'high' });
});

it('a passed probe expires, and is not re-run before then', async () => {
  const { h, sim, tick } = rig({ availability: 'available', prompt: 'ok' });
  expect((await h.assess()).status).toBe('healthy');
  await h.assess();
  expect(sim.creates).toBe(1); // cached
  tick(1001);
  sim.prompt = 'throw';
  expect((await h.assess()).status).toBe('unhealthy'); // re-probed after expiry
});

it('distrusts a recurring failure for longer each time', async () => {
  const { h, tick, at } = rig({ availability: 'available', prompt: 'throw' });
  const life = async () => ((await h.assess()), h.state().expires - at());
  const first = await life();
  tick(first + 1);
  const second = await life();
  expect([first, second]).toEqual([1000, 2000]);
});

it('treats a hanging device as unhealthy instead of hanging with it', async () => {
  const { h } = rig({ availability: 'available', prompt: 'hang' });
  expect(await h.assess()).toMatchObject({ status: 'unhealthy', fingerprint: expect.stringContaining('TimeoutError') });
});

it('unavailable is trusted long; downloadable is re-checked soon', async () => {
  const a = rig({ availability: 'unavailable', prompt: 'ok' });
  const d = rig({ availability: 'downloadable', prompt: 'ok' });
  await a.h.assess(); await d.h.assess();
  expect([a.h.state().expires, d.h.state().expires]).toEqual([10_000, 1000 / 6]);
});

it('detects a stalled download, and returns to the device once the model is ready', async () => {
  const { h, sim } = rig({ availability: 'downloadable', prompt: 'ok', download: 'stall' });
  expect(await h.warm()).toBe('stuck');
  expect(h.state().why).toBe('download stalled');
  sim.download = 'ok';
  expect(await h.warm()).toBe('ready');
  expect((await h.assess()).status).toBe('healthy');
});

it('routes to the device only while it looks healthy', async () => {
  const { h, sim, tick } = rig({ availability: 'available', prompt: 'ok' });
  const route = policy(h);
  expect(await route([])).toBe('device');
  sim.prompt = 'throw'; tick(1001);
  expect(await route([])).toBe('cloud');
  expect(defaultRoute([])).toBe('device'); // the log alone would not have known
});

it('retries a stalled download a bounded number of times', async () => {
  const { h, sim } = rig({ availability: 'downloadable', prompt: 'ok', download: 'stall' });
  setTimeout(() => (sim.download = 'ok'), 15); // the network recovers between the two attempts
  expect(await h.warm(2)).toBe('ready');
  expect(sim.creates).toBe(2);

  const gone = rig({ availability: 'downloadable', prompt: 'ok', download: 'stall' });
  expect(await gone.h.warm(1)).toBe('stuck');
  expect(gone.sim.creates).toBe(1);
});
