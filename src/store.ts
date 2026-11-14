import type { Task } from './runner.js';

export interface Store {
  get(id: string): Promise<Task | undefined>;
  put(task: Task): Promise<void>;
}

const done = (r: IDBRequest | IDBTransaction) =>
  new Promise<any>((ok, no) => {
    r.onerror = () => no(r.error);
    if ('result' in r) r.onsuccess = () => ok(r.result);
    else (r.oncomplete = ok), (r.onabort = () => no(r.error));
  });

export function idbStore(name = 'continuum', idb: IDBFactory = indexedDB): Store {
  const open = idb.open(name);
  open.onupgradeneeded = () => open.result.createObjectStore('tasks', { keyPath: 'id' });
  const db = done(open) as Promise<IDBDatabase>;
  return {
    get: async id => done((await db).transaction('tasks').objectStore('tasks').get(id)),
    // Resolve on transaction commit, not request success: a checkpoint isn't durable before that.
    put: async task => {
      const tx = (await db).transaction('tasks', 'readwrite');
      tx.objectStore('tasks').put(task);
      await done(tx);
    },
  };
}
