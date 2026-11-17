import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { idbStore, runner, sync, type Remote, type Stage, type Task } from '../src/index.js';

/** An in-memory server with real lease semantics. */
function server(): Remote {
  const tasks = new Map<string, Task>(), leases = new Map<string, { owner: string; until: number }>();
  return {
    get: async id => structuredClone(tasks.get(id)),
    put: async t => void tasks.set(t.id, structuredClone(t)),
    acquire: async (id, owner, until) => {
      const l = leases.get(id);
      if (l && l.until > Date.now() && l.owner !== owner) return false;
      leases.set(id, { owner, until });
      return true;
    },
    release: async (id, owner) => { if (leases.get(id)?.owner === owner) leases.set(id, { owner, until: 0 }); },
  };
}
/** A device that can be killed: afterwards it neither writes nor renews its lease, like a closed tab. */
function device(srv: Remote) {
  let dead = false;
  const remote: Remote = {
    get: id => srv.get(id),
    put: t => (dead ? Promise.resolve() : srv.put(t)),
    acquire: (...a) => (dead ? Promise.resolve(false) : srv.acquire(...a)),
    release: (...a) => (dead ? Promise.resolve() : srv.release(...a)),
  };
  return { remote, kill: () => (dead = true) };
}
let n = 0;
const local = () => idbStore(`sy${n++}`);
const fast = { ttl: 60, poll: 10 };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

it('another device takes over a task whose device died, without redoing finished stages', async () => {
  const srv = server(), A = device(srv), ran: string[] = [];
  const stages = (who: string, hang = false): Stage<void>[] => [
    ['extract', async () => (ran.push(`${who}:extract`), 'E')],
    ['summarize', async c => (ran.push(`${who}:summarize`), hang ? new Promise(() => {}) : `S@${c.source}`)],
  ];
  const a = sync(local(), A.remote, 'A', fast);
  runner(a.store, stages('A', true), { lock: a.lock }).run('t'); // hangs in stage 2
  await vi.waitFor(() => expect(ran).toContain('A:summarize'));
  A.kill();

  const b = sync(local(), srv, 'B', fast);
  expect(await runner(b.store, stages('B'), { lock: b.lock }).run('t')).toEqual({ extract: 'E', summarize: 'S@cloud' });
  expect(ran).toEqual(['A:extract', 'A:summarize', 'B:summarize']); // extract ran once, on A
});

it('a second device that opens a running task waits for it and returns its result without redoing anything', async () => {
  const srv = server(), ran: string[] = [];
  const stages = (who: string): Stage<void>[] => [
    ['extract', async () => (ran.push(`${who}:extract`), await sleep(40), 'E')],
    ['summarize', async () => (ran.push(`${who}:summarize`), 'S')],
  ];
  const a = sync(local(), srv, 'A', fast), b = sync(local(), srv, 'B', fast);
  const first = runner(a.store, stages('A'), { lock: a.lock }).run('t');
  await vi.waitFor(() => expect(ran).toContain('A:extract'));
  const second = runner(b.store, stages('B'), { lock: b.lock }).run('t');
  expect(await Promise.all([first, second])).toEqual([{ extract: 'E', summarize: 'S' }, { extract: 'E', summarize: 'S' }]);
  expect(ran).toEqual(['A:extract', 'A:summarize']);
});

it('what a stage saved moves with the task: the second device continues the sentence', async () => {
  const srv = server(), A = device(srv);
  const stage = (who: string): Stage<void> => ['write', async c => {
    if (who === 'A') { c.save('The quick '); return new Promise(() => {}); }
    return `${c.saved}fox`;
  }];
  const a = sync(local(), A.remote, 'A', fast);
  runner(a.store, [stage('A')], { lock: a.lock }).run('t');
  await sleep(30);
  A.kill();
  const b = sync(local(), srv, 'B', fast);
  expect(await runner(b.store, [stage('B')], { lock: b.lock }).run('t')).toEqual({ write: 'The quick fox' });
});

it('offline, the device carries on alone', async () => {
  const down = async (): Promise<never> => { throw new Error('offline'); };
  const broken: Remote = { get: down, put: down, acquire: down, release: down };
  const s = sync(local(), broken, 'A', fast);
  expect(await runner(s.store, [['a', async () => 1]], { lock: s.lock }).run('t')).toEqual({ a: 1 });
  expect((await s.store.get('t'))!.log.length).toBeGreaterThan(0);
});
