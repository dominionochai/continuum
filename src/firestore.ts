import { doc, getDoc, runTransaction, setDoc, type Firestore } from '@firebase/firestore';
import type { Remote } from './sync.js';

/**
 * A task lives at `continuum-tasks/{id}` as one JSON string (which sidesteps Firestore's type limits), next to its
 * lease. Pair it with security rules that let signed-in users reach `continuum-tasks/{id}`: the task id is the
 * secret, so keep it unguessable (a UUID) and share it only by link.
 */
export const firestoreRemote = (db: Firestore, now = Date.now): Remote => {
  const ref = (id: string) => doc(db, 'continuum-tasks', id);
  return {
    get: async id => {
      const json = (await getDoc(ref(id))).data()?.json;
      return json ? JSON.parse(json) : undefined;
    },
    put: task => setDoc(ref(task.id), { json: JSON.stringify(task) }, { merge: true }),
    acquire: (id, owner, until) =>
      runTransaction(db, async tx => {
        const lease = (await tx.get(ref(id))).data()?.lease;
        if (lease && lease.until > now() && lease.owner !== owner) return false;
        tx.set(ref(id), { lease: { owner, until } }, { merge: true });
        return true;
      }),
    release: (id, owner) =>
      runTransaction(db, async tx => {
        if ((await tx.get(ref(id))).data()?.lease?.owner === owner) tx.set(ref(id), { lease: { owner, until: 0 } }, { merge: true });
      }),
  };
};
