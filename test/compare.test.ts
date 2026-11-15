import 'fake-indexeddb/auto';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { expect, it } from 'vitest';
import { bench, formatBench } from '../bench/bench.js';
import { firebaseGenerate } from '../src/firebase.js';

// Stock Firebase (real SDK, browser build) vs Continuum, against four behaviors of a SIMULATED device.
type Mode = 'healthy' | 'rejects-this-prompt' | 'crashes-every-call' | 'hangs';
let mode: Mode = 'healthy';
(globalThis as any).window = globalThis;
const lm = {
  availability: async () => 'available', // in every mode the device reports available
  create: async () => ({
    inputQuota: 50,
    prompt: async (input: unknown) => {
      if (mode === 'hangs') return new Promise<never>(() => {});
      if (mode === 'crashes-every-call') throw new DOMException('simulated crash', 'UnknownError');
      if (mode === 'rejects-this-prompt' && JSON.stringify(input).length > 500) throw new DOMException('input too large', 'QuotaExceededError');
      return 'device answer';
    },
    destroy() {},
  }),
};
(globalThis as any).LanguageModel = lm;
globalThis.fetch = async () =>
  new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }));
const ai = getAI(initializeApp({ apiKey: 'k', projectId: 'p', appId: 'a' }, 'compare'), { backend: new GoogleAIBackend() });
const stock = async (p: string) => (await getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }).generateContent(p)).response.text();
const run = (m: Mode) => ((mode = m), bench({ gen: firebaseGenerate(ai), stock, lm, prompt: 'x'.repeat(2000), runs: 5, timeoutMs: 400, probeMs: 100, simulated: true }));

it('control: a healthy device works the same either way', async () => {
  const r = await run('healthy');
  console.log('\n=== healthy device ===\n' + formatBench(r));
  expect([r.failure.stock.ok, r.failure.continuum.ok]).toEqual([5, 5]);
});

it('device rejects this prompt after reporting available', async () => {
  const r = await run('rejects-this-prompt');
  console.log('\n=== device rejects this prompt ===\n' + formatBench(r));
  expect(r.failure.stock).toMatchObject({ ok: 0, errors: { QuotaExceededError: 5 } });
  expect(r.failure.continuum).toMatchObject({ ok: 5, deviceFailures: 5, recoveries: 5 });
});

it('device crashes on every call after reporting available', async () => {
  const r = await run('crashes-every-call');
  console.log('\n=== device crashes every call ===\n' + formatBench(r));
  expect(r.failure.stock).toMatchObject({ ok: 0, errors: { UnknownError: 5 } });
  expect(r.failure.continuum).toMatchObject({ ok: 5, deviceFailures: 0 }); // the probe sees it first, so no attempt is wasted
});

it('device hangs after reporting available', async () => {
  const r = await run('hangs');
  console.log('\n=== device hangs ===\n' + formatBench(r));
  expect(r.failure.stock).toMatchObject({ ok: 0, hung: 5 });
  expect(r.failure.continuum).toMatchObject({ ok: 5, hung: 0 });
}, 20_000);
