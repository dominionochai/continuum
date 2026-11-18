import { doneOf, format, type Sim } from '../src/index.js';
import { chunks, digest, SAMPLE, type Part } from './pipeline.js';
import { gen, h, net, q, sim, simulated, store, tasks } from './setup.js';

const $ = (id: string) => document.getElementById(id)!;
const run = tasks(digest(gen));
const where = (via: string) => (via === 'on_device' ? 'on device' : 'in cloud');

$('mode').textContent = simulated
  ? 'SIMULATED: fake on-device model and stubbed network. This is not a Gemini Nano run.'
  : 'Running on this device with Chrome\'s built-in model, with the cloud as backup.';
if (simulated) {
  $('sim-controls').hidden = false;
  $('device').onchange = e => (sim.prompt = (e.target as HTMLSelectElement).value as Sim['prompt']);
}
$('offline').onchange = e => (net.forcedOffline = (e.target as HTMLInputElement).checked);
$('sample').onclick = () => (($('doc') as HTMLTextAreaElement).value = SAMPLE);

/** Everything on screen comes from the task's log and its saved state, so a reload shows the same thing. */
async function render(id: string) {
  const t = await store.get(id);
  if (!t) return;
  const done = doneOf(t.log), saved = t.saved ?? {};
  const parts = ((done.sections ?? saved.sections) as Part[] | undefined) ?? [];
  const total = chunks(String(t.input)).length;
  const summary = (done.summary as { text: string; continued: boolean } | undefined) ?? { text: String(saved.summary ?? ''), continued: false };
  const polished = done.polish as { text: string } | undefined;
  const last = t.log.at(-1);
  const waiting = last?.k === 'wait';

  const status = (stage: string, working: string) =>
    stage in done ? 'done' : last?.stage === stage ? (waiting ? 'waiting for the network' : working) : '';
  const used = [...new Set(parts.map(p => where(p.via)))].join(' and ');
  const rows: [string, string][] = [
    [`Reading sections (${parts.length} of ${total})`, [status('sections', 'working'), used].filter(Boolean).join(', ')],
    ['Writing the summary', status('summary', 'writing')],
    ['Polishing wording (needs the cloud)', status('polish', 'working')],
  ];
  $('steps').innerHTML = rows.map(([a, b]) => `<li><span>${a}</span><span class="state">${b}</span></li>`).join('');
  $('summary').textContent = summary.text;
  $('summary-note').textContent = summary.continued ? 'The device stopped partway, so the cloud finished this summary from where it left off.' : '';
  $('polished').textContent = polished?.text ?? (waiting ? 'Waiting for the network. The summary above is ready to use now.' : '');
  $('trace').textContent = format(t.log);
  $('out').hidden = false;
  const d = h.state();
  $('chips').innerHTML = [`Device: ${d.status === 'healthy' ? 'ready' : d.status === 'unhealthy' ? 'not used (' + d.why + ')' : 'not checked yet'}`, `Cloud: ${!net.online() ? 'offline' : q.exhausted() ? 'paused (quota)' : 'available'}`].map(c => `<span>${c}</span>`).join('');
}

async function go(id: string, input?: string) {
  const button = $('go') as HTMLButtonElement;
  button.disabled = true;
  const poll = setInterval(() => void render(id), 250);
  try {
    await run.run(id, input);
    localStorage.removeItem('digest-task');
  } catch (e: any) {
    $('summary-note').textContent = `Stopped: ${e.message}`;
  } finally {
    clearInterval(poll);
    await render(id);
    button.disabled = false;
  }
}

$('go').onclick = () => {
  const text = ($('doc') as HTMLTextAreaElement).value.trim();
  if (!text) return;
  const id = crypto.randomUUID();
  localStorage.setItem('digest-task', id);
  void go(id, text);
};

// A reload or a closed tab leaves an unfinished task behind: pick it up where it stopped.
const pending = localStorage.getItem('digest-task');
if (pending) void go(pending);
