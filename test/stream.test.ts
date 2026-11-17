import 'fake-indexeddb/auto';
import { getAI, GoogleAIBackend } from '@firebase/ai';
import { initializeApp } from '@firebase/app';
import { beforeEach, expect, it } from 'vitest';
import { health, idbStore, observe, policy, quota, runner, type Stage } from '../src/index.js';
import { firebaseGenerate } from '../src/firebase.js';

// The real SDK (browser build), a simulated device that streams and then fails, and a cloud that streams back.
(globalThis as any).window = globalThis;
type Mode = 'dies' | 'stalls' | 'hangs-after-two';
let mode: Mode = 'dies';
let cloudPrompts: string[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

(globalThis as any).LanguageModel = {
  availability: async () => 'available',
  create: async () => ({
    prompt: async () => 'ok', // used by the health probe
    promptStreaming: () => new ReadableStream<string>({
      async start(c) {
        c.enqueue(mode === 'stalls' ? 'Hello ' : 'The quick ');
        if (mode === 'stalls') return;
        await sleep(5);
        c.enqueue('brown ');
        if (mode === 'dies') c.error(new DOMException('simulated crash', 'UnknownError'));
      },
    }),
    destroy() {},
  }),
};
globalThis.fetch = async (_url, init) => {
  cloudPrompts.push(JSON.parse(String((init as RequestInit).body)).contents[0].parts[0].text);
  const chunk = { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'fox jumps.' }] }, finishReason: 'STOP' }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`);
};
const ai = getAI(initializeApp({ apiKey: 'k', projectId: 'p', appId: 'a' }, 'stream'), { backend: new GoogleAIBackend() });
let n = 0;
const db = () => `st${n++}`;
beforeEach(() => ((cloudPrompts = []), (mode = 'dies')));

it('a stream that dies halfway has already saved what it said', async () => {
  const saves: string[] = [];
  const err = await firebaseGenerate(ai).stream('device', 'Write a line.', { save: t => saves.push(t) }).catch(e => e);
  expect(err).toBeInstanceOf(Error);
  expect(saves.at(-1)).toBe('The quick brown ');
});

it('the answer continues on the cloud from where the device stopped', async () => {
  const gen = firebaseGenerate(ai);
  const h = health((globalThis as any).LanguageModel, { probe: () => gen('device', 'ok'), probeMs: 200 });
  const write: Stage<void> = ['write', c => gen.stream(c.source, 'Write a line.', { saved: c.saved, save: c.save })];
  const out = await runner(idbStore(db()), [write], { route: policy(h), ...observe(h, quota()) }).run('t');

  expect(out.write).toEqual({ text: 'The quick brown fox jumps.', via: 'in_cloud', continued: true });
  expect(cloudPrompts[0]).toContain('The quick brown '); // the cloud was told what was already written
});

it('a stream that goes silent is cut off after the idle timeout, keeping what it had', async () => {
  mode = 'stalls';
  const saves: string[] = [];
  const err = await firebaseGenerate(ai).stream('device', 'Write a line.', { timeoutMs: 50, save: t => saves.push(t) }).catch(e => e);
  expect(err).toMatchObject({ name: 'TimeoutError' });
  expect(saves.at(-1)).toBe('Hello ');
});

it('if the page dies mid-stream, the next load continues the answer on the cloud', async () => {
  mode = 'hangs-after-two';
  const name = db();
  const first = firebaseGenerate(ai);
  const write = (gen: ReturnType<typeof firebaseGenerate>): Stage<void> => ['write', c => gen.stream(c.source, 'Write a line.', { saved: c.saved, save: c.save })];
  runner(idbStore(name), [write(first)], { route: () => 'device' }).run('t'); // never finishes: the page "dies"
  await sleep(60);

  const out = await runner(idbStore(name), [write(firebaseGenerate(ai))]).run('t'); // a fresh load
  expect(out.write).toMatchObject({ via: 'in_cloud', continued: true });
  expect((out.write as { text: string }).text).toMatch(/^The quick .*fox jumps\.$/);
  expect(cloudPrompts[0]).toContain('The quick');
});
