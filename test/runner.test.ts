import 'fake-indexeddb/auto';
import { AIError, AIErrorCode } from '@firebase/ai';
import { expect, it } from 'vitest';
import { idbStore, runner, type Lock, type Stage } from '../src/index.js';

let n = 0;
const db = () => `db${n++}`;
const calls: string[] = [];
const stage = (name: string, f: (src: string) => Promise<unknown> = async () => name.toUpperCase()): Stage<string> =>
  [name, async c => (calls.push(`${name}:${c.source}`), f(c.source))];
const reset = () => (calls.length = 0);

it('runs stages in order, each seeing earlier outputs', async () => {
  reset();
  const r = runner(idbStore(db()), [
    stage('a'),
    ['b', async c => `${c.done.a}+${c.input}`],
  ]);
  expect(await r.run('t', 'in')).toEqual({ a: 'A', b: 'A+in' });
});

it('after a reload, resumes without re-running completed stages, finishing via cloud', async () => {
  reset();
  const name = db();
  let started!: () => void;
  const hung = new Promise<void>(r => (started = r));
  // First "tab": b hangs forever, as if the page died mid-stage.
  runner(idbStore(name), [stage('a'), stage('b', () => (started(), new Promise(() => {})))]).run('t', 'in');
  await hung;
  // Second "tab": fresh store handle, fresh runner, same database.
  const out = await runner(idbStore(name), [stage('a'), stage('b')]).run('t');
  expect(out).toEqual({ a: 'A', b: 'B' });
  expect(calls).toEqual(['a:device', 'b:device', 'b:cloud']);
});

it('falls back to cloud once, and gives up if cloud fails too', async () => {
  reset();
  const boom = async (src: string) => { throw new Error(src); };
  await expect(runner(idbStore(db()), [stage('x', boom)]).run('t')).rejects.toThrow('cloud');
  expect(calls).toEqual(['x:device', 'x:cloud']);
});

it('stops attempting the device for later stages after it fails once', async () => {
  reset();
  const flaky = async (src: string) => { if (src === 'device') throw new Error('nope'); return 1; };
  await runner(idbStore(db()), [stage('a', flaky), stage('b')]).run('t');
  expect(calls).toEqual(['a:device', 'a:cloud', 'b:cloud']);
});

it('concurrent runs of one task execute each stage once', async () => {
  reset();
  const chain: Record<string, Promise<unknown>> = {};
  const mutex: Lock = (id, fn) => {
    const p = (chain[id] ?? Promise.resolve()).then(fn);
    chain[id] = p.catch(() => {});
    return p;
  };
  const r = runner(idbStore(db()), [stage('a'), stage('b')], { lock: mutex });
  await Promise.all([r.run('t', 'in'), r.run('t', 'in')]);
  expect(calls).toEqual(['a:device', 'b:device']);
});

const net = () => new AIError(AIErrorCode.FETCH_ERROR, 'x', { status: 503 });
const cloudOnly = { route: () => 'cloud' as const };

it('retries transient cloud failures with backoff, within a budget', async () => {
  const waits: number[] = [], sleep = async (ms: number) => void waits.push(ms);
  let tries = 0;
  const flaky: Stage<string> = ['x', async () => { if (++tries < 3) throw net(); return 'ok'; }];
  expect(await runner(idbStore(db()), [flaky], { ...cloudOnly, sleep }).run('t')).toEqual({ x: 'ok' });
  expect(waits).toEqual([250, 500]);

  tries = -99; waits.length = 0;
  await expect(runner(idbStore(db()), [flaky], { ...cloudOnly, sleep }).run('t')).rejects.toThrow();
  expect(tries).toBe(-96); // 3 attempts, then gives up
});

it('never retries quota: one attempt, no waiting', async () => {
  let tries = 0;
  const waits: number[] = [];
  const quota: Stage<string> = ['x', async () => { tries++; throw new AIError(AIErrorCode.FETCH_ERROR, 'x', { status: 429 }); }];
  await expect(runner(idbStore(db()), [quota], { ...cloudOnly, sleep: async ms => void waits.push(ms) }).run('t')).rejects.toThrow();
  expect([tries, waits]).toEqual([1, []]);
});
