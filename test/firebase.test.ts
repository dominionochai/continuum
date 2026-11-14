import 'fake-indexeddb/auto';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { expect, it } from 'vitest';
import { fakeLanguageModel, health, idbStore, observe, policy, quota, runner, type Sim } from '../src/index.js';
import { firebaseGenerate } from '../src/firebase.js';

// The REAL Firebase SDK, with a simulated device (LanguageModel) and a stubbed network.
const sim: Sim = { availability: 'available', prompt: 'throw' };
(globalThis as any).window = globalThis; // the SDK only builds its on-device adapter when `window` exists
(globalThis as any).LanguageModel = fakeLanguageModel(sim);
globalThis.fetch = async () =>
  new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }));
const ai = getAI(initializeApp({ apiKey: 'k', projectId: 'p', appId: 'a' }, 'sim'), { backend: new GoogleAIBackend() });

it('baseline: stock PREFER_ON_DEVICE passes the availability check, then the device error reaches the app', async () => {
  const model = getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE });
  await expect(model.generateContent('hi')).rejects.toThrow(/simulated crash/);
});

it('with Continuum: same failing device, the task completes via cloud', async () => {
  const gen = firebaseGenerate(ai);
  const h = health((globalThis as any).LanguageModel, { probeMs: 50 });
  const tasks = runner(idbStore('fb1'), [['answer', async c => gen(c.source, 'hi')]], {
    route: policy(h), ...observe(h, quota()),
  });
  expect(await tasks.run('t')).toEqual({ answer: { text: 'cloud answer', via: 'in_cloud' } });
});

it('and uses the device when it works', async () => {
  sim.prompt = 'ok';
  const gen = firebaseGenerate(ai);
  const h = health((globalThis as any).LanguageModel, { probeMs: 50 });
  const out = await runner(idbStore('fb2'), [['answer', async c => gen(c.source, 'hi')]], { route: policy(h) }).run('t');
  expect(out).toEqual({ answer: { text: 'device answer', via: 'on_device' } });
});

it('quota: honors the server retry hint, uses the device, and never hammers the exhausted cloud', async () => {
  sim.prompt = 'ok';
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (
    calls++,
    new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }] } }), { status: 429 })
  );
  try {
    let t = 1_000;
    const h = health((globalThis as any).LanguageModel, { probeMs: 50, now: () => t });
    const q = quota({ now: () => t });
    const gen = firebaseGenerate(ai);
    const task = (db: string) => runner(idbStore(db), [['answer', async c => gen(c.source, 'hi')]], { route: policy(h, { quota: q, prefer: 'cloud' }), ...observe(h, q) });

    expect(await task('q1').run('t')).toEqual({ answer: { text: 'device answer', via: 'on_device' } });
    expect(q.state()).toMatchObject({ exhausted: true, until: 1_000 + 34_000 }); // the server's 34s, not our 30s default
    await task('q2').run('t');
    expect(calls).toBe(1); // the second task never touched the exhausted cloud

    sim.prompt = 'throw'; t += 61_000; q.hit({});
    await expect(task('q3').run('t')).rejects.toMatchObject({ name: 'AllRoutesBlocked' });
    expect(calls).toBe(1); // blocked on both sides: no attempt made
  } finally { globalThis.fetch = real; }
});
