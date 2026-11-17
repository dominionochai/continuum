import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { doneOf, fakeLanguageModel, format, health, idbStore, policy, runner, type Entry, type Stage } from '../src/index.js';

let n = 0;
const db = () => `ss${n++}`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

it('a stage can checkpoint inside itself: what it saved reaches the next attempt, and is dropped once the stage is done', async () => {
  const seen: unknown[] = [];
  const x: Stage<void> = ['x', async c => {
    seen.push([c.source, c.saved]);
    if (c.source === 'device') { c.save('ab'); c.save('abc'); throw new Error('boom'); }
    return `${c.saved}d`;
  }];
  const store = idbStore(db());
  expect(await runner(store, [x]).run('t')).toEqual({ x: 'abcd' });
  expect(seen).toEqual([['device', undefined], ['cloud', 'abc']]); // the latest save wins, even though it was throttled
  expect((await store.get('t'))!.saved?.x).toBeUndefined();
});

it('what a stage saved survives the page dying in the middle of it', async () => {
  const name = db();
  runner(idbStore(name), [['x', async c => { c.save('partial'); return new Promise(() => {}); }]]).run('t');
  await sleep(30);
  expect(await runner(idbStore(name), [['x', async c => c.saved]]).run('t')).toEqual({ x: 'partial' });
});

it('resumeAll finishes every unfinished task and leaves finished ones alone', async () => {
  const calls: string[] = [];
  const stages: Stage<void>[] = [['a', async () => (calls.push('a'), 1)], ['b', async () => (calls.push('b'), 2)]];
  const store = idbStore(db());
  const e = (k: any, stage: string, extra = {}): Entry => ({ k, stage, source: 'device', at: 1, ...extra });
  await store.put({ id: 'finished', input: undefined, log: [e('start', 'a'), e('done', 'a', { out: 1 }), e('start', 'b'), e('done', 'b', { out: 2 })] });
  await store.put({ id: 'half', input: undefined, log: [e('start', 'a'), e('done', 'a', { out: 1 })] });
  await runner(store, stages).resumeAll();
  expect(calls).toEqual(['b']);
  expect(Object.keys(doneOf((await store.get('half'))!.log))).toEqual(['a', 'b']);
});

const healthy = () => health(fakeLanguageModel({ availability: 'available', prompt: 'ok' }), { probeMs: 50 });

it('offline: device stages carry on, a cloud-only stage waits and finishes by itself when the network returns', async () => {
  let online = false, back!: () => void;
  const gate = new Promise<void>(r => (back = r));
  const ran: string[] = [];
  const stages: Stage<void>[] = [
    ['draft', async c => (ran.push(`draft:${c.source}`), 'D')],
    ['polish', async c => (ran.push(`polish:${c.source}`), 'P'), { needs: 'cloud' }],
  ];
  const store = idbStore(db());
  const p = runner(store, stages, { route: policy(healthy(), { online: () => online }), network: { online: () => online, whenOnline: () => gate } }).run('t');

  await vi.waitFor(async () => expect((await store.get('t'))!.log.some(e => e.k === 'wait')).toBe(true));
  expect(ran).toEqual(['draft:device']); // nothing was sent while offline
  online = true; back();
  expect(await p).toEqual({ draft: 'D', polish: 'P' });
  expect(ran).toEqual(['draft:device', 'polish:cloud']);
  expect(format((await store.get('t'))!.log)).toContain('polish waited for the network');
});

it('offline with a working device: no waiting at all', async () => {
  const store = idbStore(db());
  await runner(store, [['a', async c => c.source]], { route: policy(healthy(), { online: () => false }) }).run('t');
  expect((await store.get('t'))!.log.some(e => e.k === 'wait')).toBe(false);
});

it('a device-only stage is never sent to the cloud, even when the device is unusable', async () => {
  const h = health(fakeLanguageModel({ availability: 'unavailable', prompt: 'ok' }));
  const r = runner(idbStore(db()), [['secret', async () => 1, { needs: 'device' }]], { route: policy(h) });
  await expect(r.run('t')).rejects.toMatchObject({ name: 'AllRoutesBlocked', reason: 'device' });
});
