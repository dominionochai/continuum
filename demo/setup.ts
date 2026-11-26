import { getAI, GoogleAIBackend } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from '@firebase/app-check';
import { fakeLanguageModel, health, idbStore, observe, policy, quota, runner, sync, type Remote, type Sim, type Stage } from '../src/index.js';
import { firebaseGenerate, firebaseWarm } from '../src/firebase.js';

// Build-time VITE_* values, which a global can override at runtime (and tests use, since Vite fixes import.meta.env when it builds).
const env = { ...(import.meta as any).env, ...(globalThis as any).__CONTINUUM_ENV__ };

const hasConfig = !!env.VITE_FIREBASE_PROJECT_ID;
/** True when this browser has no Prompt API at all (checked before any stand-in is installed). */
export const noDeviceApi = !('LanguageModel' in window);
/** The device is simulated on request (?sim), or when there is neither a device nor a Firebase project to test with. */
export const deviceSimulated = new URLSearchParams(location.search).has('sim') || (noDeviceApi && !hasConfig);
/** The cloud is stubbed only when no Firebase project is configured. Otherwise every cloud call is real. */
export const cloudSimulated = !hasConfig;
export const simulated = deviceSimulated || cloudSimulated;
export const sim: Sim = { availability: 'available', prompt: 'ok' };

export const banner = deviceSimulated && cloudSimulated ? 'SIMULATED: fake on-device model and stubbed network. This is not a Gemini Nano run.'
  : deviceSimulated ? 'SIMULATED on-device model. Cloud calls are real (Firebase AI Logic). This is not a Gemini Nano run.'
  : noDeviceApi ? 'No on-device model in this browser: everything runs on the cloud (Firebase AI Logic).'
  : cloudSimulated ? 'On-device model API present. The cloud is stubbed because no Firebase project is configured.'
  : "Using Chrome's built-in model when this device has one, with the cloud as backup.";

if (deviceSimulated) (window as any).LanguageModel = fakeLanguageModel(sim);
if (cloudSimulated) {
  const body = (text: string) => ({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] });
  window.fetch = async url =>
    String(url).includes('streamGenerateContent')
      ? new Response(['cloud ', 'answer'].map(t => `data: ${JSON.stringify(body(t))}\n\n`).join(''))
      : new Response(JSON.stringify(body('cloud answer')));
}

const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY ?? 'sim', projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'sim', appId: env.VITE_FIREBASE_APP_ID ?? 'sim' });
// App Check is required for Firebase AI Logic. Set VITE_APPCHECK_DEBUG for local development (the SDK prints a
// token to register in the console), or VITE_APPCHECK_SITE_KEY for a reCAPTCHA Enterprise key in production.
if (!cloudSimulated) {
  if (env.VITE_APPCHECK_DEBUG) (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  if (env.VITE_APPCHECK_SITE_KEY || env.VITE_APPCHECK_DEBUG)
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_APPCHECK_SITE_KEY ?? 'debug'), isTokenAutoRefreshEnabled: true });
}
export const ai = getAI(app, { backend: new GoogleAIBackend() });

/** `forcedOffline` lets a demo pretend to lose the network; the browser's own online state still counts. */
export const net = {
  forcedOffline: false,
  online: () => !net.forcedOffline && navigator.onLine !== false,
  whenOnline: () => new Promise<void>(res => { const t = setInterval(() => net.online() && (clearInterval(t), res()), 300); }),
};

export const gen = firebaseGenerate(ai, { deviceTimeoutMs: 20_000 });
export const h = health((window as any).LanguageModel, { probe: () => gen('device', 'Reply with: ok', { timeoutMs: 5000 }), download: firebaseWarm(ai) });
export const q = quota();
const local = idbStore('continuum-demo');

/**
 * Cross-device resume, off unless VITE_SYNC is set (and never in simulation). Needs Anonymous sign-in enabled in
 * Firebase Auth and the rules in docs/firestore.rules. Not yet run against a real project.
 */
export const syncOn = !cloudSimulated && !!env.VITE_SYNC;
let loaded: Promise<Remote> | undefined;
/** Firestore and Auth are only downloaded, and the user only signed in, when a task first touches the remote. */
const remote = () =>
  (loaded ??= Promise.all([import('@firebase/auth'), import('@firebase/firestore'), import('../src/firestore.js')]).then(
    async ([{ getAuth, signInAnonymously }, { getFirestore }, { firestoreRemote }]) => {
      await signInAnonymously(getAuth(app));
      return firestoreRemote(getFirestore(app));
    }));
const lazyRemote: Remote = {
  get: async id => (await remote()).get(id),
  put: async t => (await remote()).put(t),
  acquire: async (...a) => (await remote()).acquire(...a),
  release: async (...a) => (await remote()).release(...a),
};
const deviceId = localStorage.getItem('device-id') ?? (localStorage.setItem('device-id', crypto.randomUUID()), localStorage.getItem('device-id')!);
const synced = syncOn ? sync(local, lazyRemote, deviceId) : undefined;

export const store = synced?.store ?? local;
export const tasks = <I>(stages: Stage<I>[]) =>
  runner(store, stages, { route: policy(h, { quota: q, online: net.online }), network: net, lock: synced?.lock, ...observe(h, q) });
