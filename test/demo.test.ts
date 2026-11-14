// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { idbStore } from '../src/index.js';

const page = readFileSync('demo/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const el = (id: string) => document.getElementById(id)!;
const load = async () => { vi.resetModules(); document.body.innerHTML = page; await import('../demo/main.js'); };

beforeEach(() => localStorage.clear());

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
