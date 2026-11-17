import { webLock, type Lock, type Task } from './runner.js';
import type { Store } from './store.js';

/** The shared end of a synced task: a server several devices can reach. */
export interface Remote {
  get(id: string): Promise<Task | undefined>;
  put(task: Task): Promise<void>;
  /** Take or renew the lease on a task until `until`. False if another owner holds it. */
  acquire(id: string, owner: string, until: number): Promise<boolean>;
  release(id: string, owner: string): Promise<void>;
}

/** Only one device runs a task at a time, so its log extends the others' logs: the longer one is the newer one. */
const longer = (a?: Task, b?: Task) => ((b?.log.length ?? -1) > (a?.log.length ?? -1) ? b : a);

/**
 * Local-first sync. Writes go to the device first, then to the remote; reads take whichever log is longer; a lease
 * keeps two devices from running the same task. Offline, the remote is skipped: the device keeps going alone, and
 * the next write brings the remote up to date. A device that dies loses its lease after `ttl`, and another takes over.
 */
export function sync(local: Store, remote: Remote, owner: string, { ttl = 30_000, poll = 2_000, now = Date.now } = {}) {
  const store: Store = {
    get: async id => longer(await local.get(id), await remote.get(id).catch(() => undefined)),
    put: async task => { await local.put(task); await remote.put(task).catch(() => {}); },
    ids: local.ids,
  };
  const lock: Lock = (id, fn) =>
    webLock(id, async () => {
      while (!(await remote.acquire(id, owner, now() + ttl).catch(() => true))) await new Promise(r => setTimeout(r, poll));
      const beat = setInterval(() => void remote.acquire(id, owner, now() + ttl).catch(() => {}), ttl / 3);
      try { return await fn(); } finally { clearInterval(beat); await remote.release(id, owner).catch(() => {}); }
    });
  return { store, lock };
}
