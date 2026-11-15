import 'fake-indexeddb/auto';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { expect, it } from 'vitest';
import { bench, formatBench } from '../bench/bench.js';
import { firebaseGenerate } from '../src/firebase.js';

// Real SDK, stand-in device: small prompts work, big ones fail with the device's quota error.
(globalThis as any).window = globalThis;
const lm = {
  availability: async () => 'available',
  create: async () => ({
    inputQuota: 50,
    prompt: async (input: unknown) => {
      if (JSON.stringify(input).length > 500) throw new DOMException('input too large', 'QuotaExceededError');
      return 'device answer';
    },
    destroy() {},
  }),
};
(globalThis as any).LanguageModel = lm;
globalThis.fetch = async () =>
  new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }));
const ai = getAI(initializeApp({ apiKey: 'k', projectId: 'p', appId: 'a' }, 'bench'), { backend: new GoogleAIBackend() });
const stock = async (p: string) => (await getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }).generateContent(p)).response.text();

it('measures stock Firebase against Continuum, and labels a simulated run as simulated', async () => {
  const r = await bench({ gen: firebaseGenerate(ai), stock, lm, prompt: 'x'.repeat(2000), runs: 4, simulated: true });
  expect(r.failure.stock).toMatchObject({ ok: 0, failed: 4, errors: { QuotaExceededError: 4 } });
  expect(r.failure.continuum).toMatchObject({ ok: 4, failed: 0, deviceFailures: 4, recoveries: 4 });
  expect(r.interruption.stageStartsPerRun).toEqual({ stock: 4, continuum: 3 });
  expect(r.interruption.finishedStageRerunPerRun).toEqual({ stock: 1, continuum: 0 });
  expect(formatBench(r)).toMatch(/^SIMULATED/);
});
