import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { idbStore, runner } from '../src/index.js';
import { chunks, digest, SAMPLE } from '../demo/pipeline.js';

let n = 0;
const db = () => `pl${n++}`;

/** A gen whose device fails on its Nth call. Records every call. */
function fakeGen(deviceFailsOn = Infinity) {
  const calls: string[] = [];
  let deviceCalls = 0;
  const gen = async (source: string, prompt: string) => {
    calls.push(`${source}|${prompt.slice(0, 40)}`);
    if (source === 'device' && ++deviceCalls === deviceFailsOn) throw new Error('device died');
    return { text: `${source} line`, via: source === 'device' ? 'on_device' : 'in_cloud' };
  };
  const stream = async (source: string, _p: string, o: { saved?: unknown }) => ({ text: `${o.saved ?? ''}${source} summary`, via: source === 'device' ? 'on_device' : 'in_cloud', continued: !!o.saved });
  return { gen: Object.assign(gen, { stream }) as any, calls };
}

it('packs paragraphs into pieces', () => {
  expect(chunks(SAMPLE)).toHaveLength(3);
  expect(chunks('a\n\nb\n\nc')).toEqual(['a\n\nb\n\nc']);
  expect(chunks('   ')).toEqual([]);
});

it('runs the three stages in order, the last on the cloud', async () => {
  const { gen } = fakeGen();
  const out = await runner(idbStore(db()), digest(gen)).run('t', SAMPLE);
  expect((out.sections as unknown[]).length).toBe(3);
  expect(out.summary).toMatchObject({ via: 'on_device' });
  expect(out.polish).toMatchObject({ via: 'in_cloud' }); // needs the cloud, and was routed there
});

it('a failure in the middle of the sections carries on at the next piece, not from the start', async () => {
  const { gen, calls } = fakeGen(2); // the device dies on its second section
  const out = await runner(idbStore(db()), digest(gen)).run('t', SAMPLE);
  const sections = calls.filter(c => c.includes('Summarize this section'));
  expect(sections).toHaveLength(4); // 3 pieces + the one failed attempt; the first piece was not redone
  expect((out.sections as { via: string }[]).map(p => p.via)).toEqual(['on_device', 'in_cloud', 'in_cloud']);
});
