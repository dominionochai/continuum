import { getAI, GoogleAIBackend } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from '@firebase/app-check';
import { fakeLanguageModel, health, idbStore, observe, policy, quota, runner, type Sim, type Stage } from '../src/index.js';
import { firebaseGenerate, firebaseWarm } from '../src/firebase.js';

const env = (import.meta as any).env ?? {};

// Simulate only when there is no real Prompt API, or when asked (?sim).
export const simulated = new URLSearchParams(location.search).has('sim') || !('LanguageModel' in window);
export const sim: Sim = { availability: 'available', prompt: 'ok' };
if (simulated) {
  const body = (text: string) => ({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }] });
  (window as any).LanguageModel = fakeLanguageModel(sim);
  window.fetch = async url =>
    String(url).includes('streamGenerateContent')
      ? new Response(['cloud ', 'answer'].map(t => `data: ${JSON.stringify(body(t))}\n\n`).join(''))
      : new Response(JSON.stringify(body('cloud answer')));
}

const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY ?? 'sim', projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'sim', appId: env.VITE_FIREBASE_APP_ID ?? 'sim' });
// App Check is required for Firebase AI Logic. Set VITE_APPCHECK_DEBUG for local development (the SDK prints a
// token to register in the console), or VITE_APPCHECK_SITE_KEY for a reCAPTCHA Enterprise key in production.
if (!simulated) {
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
export const store = idbStore('continuum-demo');
export const tasks = <I>(stages: Stage<I>[]) =>
  runner(store, stages, { route: policy(h, { quota: q, online: net.online }), network: net, ...observe(h, q) });
