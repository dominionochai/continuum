import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { classify, health } from '../src/index.js';
import { firebaseGenerate } from '../src/firebase.js';

// The real SDK (browser build). Each test installs its own simulated device.
(globalThis as any).window = globalThis;
let fetches = 0;
globalThis.fetch = async () => (
  fetches++,
  new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }))
);
const ai = getAI(initializeApp({ apiKey: 'k', projectId: 'p', appId: 'a' }, 'adapter'), { backend: new GoogleAIBackend() });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const install = (lm: unknown) => ((globalThis as any).LanguageModel = lm);
beforeEach(() => ((fetches = 0), delete (globalThis as any).LanguageModel));
afterEach(() => delete (globalThis as any).LanguageModel);

/** Like the real adapter's sessions: a session dies when the SDK creates the next one. */
const mortal = (mode: { hang?: boolean } = {}) => ({
  availability: async () => 'available',
  create: async () => {
    const s = {
      dead: false,
      prompt: async () => {
        if (mode.hang) return new Promise<never>(() => {});
        await sleep(20);
        if (s.dead) throw new DOMException('session destroyed', 'InvalidStateError');
        return 'device answer';
      },
      destroy() { s.dead = true; },
    };
    return s;
  },
});

it('stock: two concurrent on-device calls abort each other', async () => {
  install(mortal());
  const stock = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  const r = await Promise.allSettled([stock.generateContent('a'), stock.generateContent('b')]);
  expect(r.map(x => x.status)).toContain('rejected');
});

it('adapter: concurrent device calls take turns, so both succeed', async () => {
  install(mortal());
  const gen = firebaseGenerate(ai);
  const r = await Promise.all([gen('device', 'a'), gen('device', 'b')]);
  expect(r.map(x => x.via)).toEqual(['on_device', 'on_device']);
});

it('stock ONLY_ON_DEVICE silently uses the cloud when LanguageModel is absent; the adapter refuses without a request', async () => {
  const stock = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  expect((await stock.generateContent('hi')).response.inferenceSource).toBe('in_cloud');
  expect(fetches).toBe(1); // the request left the device

  fetches = 0;
  const gen = firebaseGenerate(ai);
  const err = await gen('device', 'hi').catch(e => e);
  expect(err).toMatchObject({ name: 'DeviceUnavailable' });
  expect(classify(err, 'device')).toBe('availability');
  expect(fetches).toBe(0);
});

it('adapter: a hung device call times out, and does not block the next one', async () => {
  const mode = { hang: true };
  install(mortal(mode));
  const gen = firebaseGenerate(ai, { deviceTimeoutMs: 50 });
  const err = await gen('device', 'x').catch(e => e);
  expect(err).toMatchObject({ name: 'TimeoutError' });
  expect(classify(err, 'device')).toBe('timeout');
  mode.hang = false;
  expect((await gen('device', 'y')).via).toBe('on_device');
});

it('health: a probe and a download supplied by the adapter replace direct model calls', async () => {
  install(mortal());
  const gen = firebaseGenerate(ai);
  const h = health((globalThis as any).LanguageModel, { probe: () => gen('device', 'ok'), probeMs: 200 });
  expect((await h.assess()).status).toBe('healthy');

  const broken = health((globalThis as any).LanguageModel, { probe: async () => { throw new Error('boom'); } });
  expect(await broken.assess()).toMatchObject({ status: 'unhealthy', why: 'probe failed' });

  const warm = health((globalThis as any).LanguageModel, { stallMs: 30, download: async onProgress => { onProgress(); } });
  expect(await warm.warm(1)).toBe('ready');
  const stalled = health((globalThis as any).LanguageModel, { stallMs: 30, download: () => new Promise(() => {}) });
  expect(await stalled.warm(1)).toBe('stuck');
});
