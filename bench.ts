import { Continuum } from './health.ts';

const N = 50;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let attempts = 0;
const device = async () => { attempts++; await sleep(20); throw new Error('inference failed'); };
const cloud = async () => { await sleep(5); return 'ok'; };

const measure = async (call: () => Promise<unknown>) => {
  attempts = 0;
  const start = performance.now();
  for (let i = 0; i < N; i++) await call();
  return { failedDeviceAttempts: attempts, totalMs: Math.round(performance.now() - start) };
};

const continuum = new Continuum({ timeoutMs: 1000 });
console.table({
  'SDK-style fallback': await measure(() => device().catch(cloud)),
  Continuum: await measure(() => continuum.run(device, cloud)),
});
