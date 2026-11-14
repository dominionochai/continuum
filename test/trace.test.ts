import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { format, idbStore, recoveries, runner, spans, type Entry, type Stage } from '../src/index.js';

it('traces a real run: failed device attempt, observed recovery to cloud', async () => {
  let t = 0;
  const stage: Stage<void> = ['a', async c => { if (c.source === 'device') throw new Error('nope'); }];
  await runner(idbStore('trace1'), [stage], { now: () => (t += 10) }).run('t');
  const log = (await idbStore('trace1').get('t'))!.log;

  expect(spans(log).map(({ source, outcome, basis, ms }) => ({ source, outcome, basis, ms }))).toEqual([
    { source: 'device', outcome: 'fail', basis: 'observed', ms: 10 },
    { source: 'cloud', outcome: 'done', basis: 'observed', ms: 10 },
  ]);
  expect(recoveries(log)).toEqual([
    { stage: 'a', from: 'device', to: 'cloud', cause: 'fail', basis: 'observed', gapMs: 10 },
  ]);
  expect(format(log)).toBe('a [device] fail:inference 10ms Error: nope\na [cloud] done 10ms');
});

it('labels a start with no end as inferred, never as observed', () => {
  const log: Entry[] = [
    { k: 'start', stage: 'a', source: 'device', at: 0 },
    { k: 'start', stage: 'a', source: 'cloud', at: 50 },
    { k: 'done', stage: 'a', source: 'cloud', out: 1, at: 60 },
  ];
  expect(recoveries(log)).toEqual([
    { stage: 'a', from: 'device', to: 'cloud', cause: 'interrupted', basis: 'inferred', gapMs: undefined },
  ]);
  expect(format(log)).toBe('a [device] interrupted* ?ms\na [cloud] done 10ms\n* inferred, not observed');
});
