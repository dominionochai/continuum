import { getGenerativeModel, InferenceMode } from '@firebase/ai';
import { format, type Sim } from '../src/index.js';
import { bench, formatBench } from '../bench/bench.js';
import { ai, gen, h, q, sim, simulated, store, tasks } from './setup.js';

const $ = (id: string) => document.getElementById(id)!;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const out = (id: string, text: string) => ($(id).textContent = text);
const DOC = 'The meeting moved to Thursday. Budget is approved. Ana owns the launch.';

if (simulated) {
  sim.prompt = 'throw'; // this page is about a device that reports available and then fails
  $('controls').hidden = false;
  $('device').onchange = e => (sim.prompt = (e.target as HTMLSelectElement).value as Sim['prompt']);
} else $('force-wrap').hidden = false;
$('mode').textContent = simulated
  ? 'SIMULATED: fake on-device model and stubbed network. This is not a Gemini Nano run.'
  : 'Real on-device model (Chrome LanguageModel).';

// With "force" on, the document is bigger than the on-device input quota: a real failure, no simulation.
// It stays small for the cloud (tens of thousands of tokens).
let big: Promise<string> | undefined;
const sized = async () => {
  const s = await (window as any).LanguageModel.create().catch(() => undefined);
  const quota: number = s?.contextWindow ?? s?.inputQuota ?? 8000; // newer Chrome renamed the property
  s?.destroy?.();
  return 'word '.repeat(quota * 2);
};
const doc = async () => (($('force') as HTMLInputElement).checked ? await (big ??= sized()) : DOC);
const stock = async (p: string) => (await getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }).generateContent(p)).response.text();

$('run-stock').onclick = async () => {
  out('stock-out', 'running...');
  try {
    const { response } = await getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE }).generateContent(`Extract the key facts: ${await doc()}`);
    out('stock-out', `OK via ${response.inferenceSource}\n${response.text()}`);
  } catch (e: any) {
    out('stock-out', `ERROR\n${e.message}`);
  }
};

const run = tasks([
  ['extract', async c => gen(c.source, `Extract the key facts: ${await doc()}`)],
  ['summarize', async c => {
    if ((($('slow')) as HTMLInputElement).checked) await sleep(3000); // time to reload mid-task
    return gen(c.source, `Summarize: ${(c.done.extract as { text: string }).text}`);
  }],
]);

async function go(id: string) {
  out('cont-out', 'running...');
  try {
    const r = (await run.run(id)).summarize as { text: string; via: string };
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

$('run-bench').onclick = async () => {
  out('bench-out', 'running...');
  try {
    const r = await bench({ gen, stock, lm: (window as any).LanguageModel, prompt: `Extract the key facts: ${await doc()}`, runs: 10, simulated });
    out('bench-out', `${formatBench(r)}\n\n${JSON.stringify(r, null, 1)}`);
  } catch (e: any) {
    out('bench-out', `ERROR\n${e.message}`);
  }
};

// A reload mid-task leaves an unfinished task behind: pick it up where it stopped.
const pending = localStorage.getItem('task');
if (pending) void go(pending);
