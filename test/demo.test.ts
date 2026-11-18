// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { idbStore } from '../src/index.js';

const page = readFileSync('demo/compare.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const el = (id: string) => document.getElementById(id)!;
const load = async () => { vi.resetModules(); document.body.innerHTML = page; await import('../demo/compare.js'); };

beforeEach(() => localStorage.clear());
afterEach(() => delete (globalThis as any).LanguageModel); // each test decides for itself whether the device is simulated

it('says plainly that the device is simulated', async () => {
  await load();
  expect(el('mode').textContent).toMatch(/^SIMULATED/);
});

it('stock Firebase shows the device error; Continuum completes the same task', async () => {
  await load();
  el('run-stock').click();
  await vi.waitFor(() => expect(el('stock-out').textContent).toMatch(/^ERROR[\s\S]*simulated crash/));
  el('run-cont').click();
  await vi.waitFor(() => expect(el('cont-out').textContent).toMatch(/^OK via in_cloud\ncloud answer/));
  expect(el('trace').textContent).toContain('summarize [cloud] done');
});

it('after a reload mid-task, resumes without re-running the finished stage', async () => {
  const store = idbStore('continuum-demo');
  await store.put({
    id: 'x', input: undefined,
    log: [
      { k: 'start', stage: 'extract', source: 'device', at: 1 },
      { k: 'done', stage: 'extract', source: 'device', out: { text: 'facts', via: 'on_device' }, at: 2 },
      { k: 'start', stage: 'summarize', source: 'device', at: 3 }, // the page died here
    ],
  });
  localStorage.setItem('task', 'x');
  await load();
  await vi.waitFor(() => expect(el('cont-out').textContent).toMatch(/^OK via in_cloud/));
  const trace = el('trace').textContent!;
  expect(trace.match(/extract/g)).toHaveLength(1);
  expect(trace).toContain('summarize [device] interrupted*');
  expect(trace).toContain('summarize [cloud] done');
});

it('real mode: an oversized prompt breaks stock Firebase on the device; Continuum recovers via cloud', async () => {
  // Stands in for real Nano: it reports available, then rejects what exceeds its input quota.
  (globalThis as any).LanguageModel = {
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
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }));
  await load();
  expect(el('mode').textContent).toMatch(/^Real/);
  expect(el('force-wrap').hidden).toBe(false);
  (el('force') as HTMLInputElement).checked = true;

  el('run-stock').click();
  await vi.waitFor(() => expect(el('stock-out').textContent).toMatch(/^ERROR[\s\S]*input too large/));
  el('run-cont').click();
  await vi.waitFor(() => expect(el('cont-out').textContent).toMatch(/^OK via in_cloud/));
  expect(el('trace').textContent).toContain('extract [device] fail:quota');
  expect(el('trace').textContent).toContain('extract [cloud] done');
});

it('runs the benchmark from the page and says whether it was simulated', async () => {
  await load();
  el('run-bench').click();
  await vi.waitFor(() => expect(el('bench-out').textContent).toMatch(/^SIMULATED[\s\S]*stock Firebase:[\s\S]*Continuum:/), { timeout: 4500 });
});
