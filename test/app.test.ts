// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const page = readFileSync('demo/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const el = (id: string) => document.getElementById(id)!;
const load = async () => { vi.resetModules(); document.body.innerHTML = page; await import('../demo/app.js'); };
const start = async () => { el('sample').click(); el('go').click(); };

beforeEach(() => localStorage.clear());
afterEach(() => delete (globalThis as any).LanguageModel);

it('says it is simulated, and summarizes the sample end to end', async () => {
  await load();
  expect(el('mode').textContent).toMatch(/^SIMULATED/);
  await start();
  await vi.waitFor(() => expect(el('polished').textContent).toBe('cloud answer'), { timeout: 4000 });
  expect(el('steps').textContent).toContain('Reading sections (3 of 3)');
  expect(el('summary').textContent).toBe('device answer');
  expect(el('trace').textContent).toContain('polish [cloud] done');
});

it('offline, the cloud-only step waits, the summary is already usable, and it finishes by itself when back online', async () => {
  await load();
  (el('offline') as HTMLInputElement).click();
  await start();
  await vi.waitFor(() => expect(el('polished').textContent).toMatch(/^Waiting for the network/), { timeout: 4000 });
  expect(el('summary').textContent).toBe('device answer');
  expect(el('steps').textContent).toContain('waiting for the network');
  (el('offline') as HTMLInputElement).click();
  await vi.waitFor(() => expect(el('polished').textContent).toBe('cloud answer'), { timeout: 4000 });
});

it('if the device dies partway through the summary, the cloud finishes it, and the page says so', async () => {
  await load();
  const select = el('device') as HTMLSelectElement;
  select.value = 'die-midstream';
  select.dispatchEvent(new Event('change'));
  await start();
  await vi.waitFor(() => expect(el('summary-note').textContent).toMatch(/cloud finished this summary/), { timeout: 4000 });
  expect(el('summary').textContent).toBe('device cloud answer'); // the device's first word, then the cloud's continuation
});

it('after a reload, an unfinished summary is picked up where it stopped', async () => {
  await load();
  (el('offline') as HTMLInputElement).click();
  await start();
  await vi.waitFor(() => expect(el('polished').textContent).toMatch(/^Waiting/), { timeout: 4000 });
  await load(); // the page "reloads": offline is gone, the task id is still in storage
  await vi.waitFor(() => expect(el('polished').textContent).toBe('cloud answer'), { timeout: 4000 });
  expect(el('trace').textContent.match(/sections/g)).toHaveLength(1); // the finished stages were not redone
});
