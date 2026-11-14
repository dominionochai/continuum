import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { fakeLanguageModel, format, health, idbStore, observe, policy, quota, runner, type Sim } from '../src/index.js';
import { firebaseGenerate } from '../src/firebase.js';

const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DOC = 'The meeting moved to Thursday. Budget is approved. Ana owns the launch.';
const env = (import.meta as any).env ?? {};

// Simulate only when there is no real Prompt API, or when asked (?sim).
const simulated = new URLSearchParams(location.search).has('sim') || !('LanguageModel' in window);
const sim: Sim = { availability: 'available', prompt: 'throw' };
if (simulated) {
  (window as any).LanguageModel = fakeLanguageModel(sim);
  window.fetch = async () =>
    new Response(JSON.stringify({ candidates: [{ index: 0, finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'cloud answer' }] } }] }));
  $('controls').hidden = false;
  $('device').onchange = e => (sim.prompt = (e.target as HTMLSelectElement).value as Sim['prompt']);
}
$('mode').textContent = simulated
  ? 'SIMULATED: fake on-device model and stubbed network. This is not a Gemini Nano run.'
  : 'Real on-device model (Chrome LanguageModel).';

const ai = getAI(
  initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY ?? 'sim', projectId: env.VITE_FIREBASE_PROJECT_ID ?? 'sim', appId: env.VITE_FIREBASE_APP_ID ?? 'sim' }),
  { backend: new GoogleAIBackend() },
);
const out = (id: string, text: string) => ($(id).textContent = text);

$('run-stock').onclick = async () => {
  out('stock-out', 'running...');
  try {
    const { response } = await getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }).generateContent(`Extract the key facts: ${DOC}`);
    out('stock-out', `OK via ${response.inferenceSource}\n${response.text()}`);
  } catch (e: any) {
    out('stock-out', `ERROR\n${e.message}`);
  }
};

const gen = firebaseGenerate(ai);
const h = health((window as any).LanguageModel), q = quota();
const store = idbStore('continuum-demo');
const tasks = runner(
  store,
  [
    ['extract', async c => gen(c.source, `Extract the key facts: ${DOC}`)],
    ['summarize', async c => {
      if ((($('slow')) as HTMLInputElement).checked) await sleep(3000); // time to reload mid-task
      return gen(c.source, `Summarize: ${(c.done.extract as { text: string }).text}`);
    }],
  ],
  { route: policy(h, { quota: q }), ...observe(h, q) },
);

async function go(id: string) {
  out('cont-out', 'running...');
  try {
    const r = (await tasks.run(id)).summarize as { text: string; via: string };
    out('cont-out', `OK via ${r.via}\n${r.text}`);
    localStorage.removeItem('task');
  } catch (e: any) {
    out('cont-out', `ERROR\n${e.message}`);
  }
  out('trace', format((await store.get(id))?.log ?? []));
  const d = h.state();
  out('status', `Device: ${d.status} (${d.why}). Cloud quota: ${q.exhausted() ? 'exhausted' : 'ok'}.`);
}

$('run-cont').onclick = () => {
  const id = crypto.randomUUID();
  localStorage.setItem('task', id);
  void go(id);
};

// A reload mid-task leaves an unfinished task behind: pick it up where it stopped.
const pending = localStorage.getItem('task');
if (pending) void go(pending);
