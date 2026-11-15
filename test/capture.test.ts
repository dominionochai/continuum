// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

const html = readFileSync('capture/capture.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
const dom = (n: string) => document.getElementById(n) as HTMLInputElement;

/** A stand-in with the failure modes the kit provokes, using the error names the Prompt API documents. */
function fakeNano(state: string, opts: { events?: number[] } = {}) {
  const destroyed = new WeakSet<object>();
  return {
    availability: async () => state,
    params: async () => ({ defaultTopK: 3 }),
    create: async (o: any = {}) => {
      if (o.expectedInputs?.[0]?.languages?.[0] === 'xx') throw new DOMException('unsupported language', 'NotSupportedError');
      if (o.temperature > 2) throw new RangeError('bad temperature');
      if (o.monitor) {
        const m = new EventTarget();
        o.monitor(m);
        for (const loaded of opts.events ?? []) m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
      }
      const s = {
        inputQuota: 8000,
        inputUsage: 0,
        prompt: async (text: string, { signal }: { signal?: AbortSignal } = {}) => {
          if (destroyed.has(s)) throw new DOMException('session destroyed', 'InvalidStateError');
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
          if (text.length > 100_000) throw new DOMException('too large', 'QuotaExceededError');
          await new Promise((res, rej) => {
            const t = setTimeout(res, text.startsWith('Write') ? 300 : 3);
            signal?.addEventListener('abort', () => (clearTimeout(t), rej(new DOMException('aborted', 'AbortError'))));
          });
          return 'ok';
        },
        destroy: () => destroyed.add(s),
      };
      return s;
    },
  };
}

const states: string[] = []; // the label the Run button had when it was enabled
async function runKit(lm?: unknown) {
  states.length = 0;
  vi.resetModules();
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
  if (lm) (globalThis as any).LanguageModel = lm; else delete (globalThis as any).LanguageModel;
  (0, eval)(script);
  dom('check').click();
  await vi.waitFor(() => expect(dom('run').disabled === false || dom('report').value !== '').toBe(true), { timeout: 4000 });
  if (!dom('run').disabled) {
    states.push(dom('run').textContent!);
    dom('run').click();
    await vi.waitFor(() => expect(dom('report').value).not.toBe(''), { timeout: 4000 });
  }
  return JSON.parse(dom('report').value);
}


it('records real error shapes from every forced failure, and finds no gap on a healthy device', async () => {
  const r = await runKit(fakeNano('available'));
  expect(r.availability.bare.value).toBe('available');
  expect(r.baseline.summary).toMatchObject({ ok: 8, failed: 0 });
  expect(r.baseline.session).toEqual({ inputQuota: 8000, inputUsage: 0 });
  expect(r.probe.every((p: any) => p.ok)).toBe(true);
  const name = (k: string) => r.forced[k].error?.name;
  expect([name('oversizedPrompt'), name('abortBefore'), name('abortMidFlight'), name('useAfterDestroy'), name('unsupportedLanguage'), name('badTemperature')])
    .toEqual(['QuotaExceededError', 'AbortError', 'AbortError', 'InvalidStateError', 'NotSupportedError', 'RangeError']);
  expect(r.forced.oversizedPrompt.error).toMatchObject({ domException: true, ctor: 'DOMException' });
  expect(r.forced.parallel.value).toEqual(['ok', 'ok', 'ok']);
  expect(r.availableButFailed).toBe(false);
});

it('flags "available but failed" when the model reports available and then breaks', async () => {
  const lm = fakeNano('available');
  lm.create = async () => { throw new DOMException('model crashed', 'UnknownError'); };
  const r = await runKit(lm);
  expect(r.availableButFailed).toBe(true);
  expect(r.baseline.create.error.name).toBe('UnknownError');
});

it('tracks a model download, with progress events and the longest gap between them', async () => {
  const r = await runKit(fakeNano('downloadable', { events: [0.1, 0.5, 1] }));
  expect(r.download).toMatchObject({ outcome: 'ready' });
  expect(r.download.events.map((e: number[]) => e[1])).toEqual([0.1, 0.5, 1]);
  expect(r.download.maxGapMs).toBeGreaterThanOrEqual(0);
});

it('still writes a report on an ineligible machine and on a browser without the API', async () => {
  const r = await runKit(fakeNano('unavailable'));
  expect(r.availability.bare.value).toBe('unavailable');
  expect(r.baseline).toEqual({});
  const none = await runKit(undefined);
  expect(none.env.hasLanguageModel).toBe(false);
});

it('asks before downloading: the run button says so, and nothing downloads until it is pressed', async () => {
  const lm = fakeNano('downloadable', { events: [0.5, 1] });
  let created = 0;
  const create = lm.create;
  lm.create = async (o?: any) => (created++, create(o));
  vi.resetModules();
  document.body.innerHTML = html.replace(/<script>[\s\S]*<\/script>/, '');
  (globalThis as any).LanguageModel = lm;
  (0, eval)(script);
  dom('check').click();
  await vi.waitFor(() => expect(dom('run').disabled).toBe(false));
  expect(created).toBe(0);
  expect(dom('run').textContent).toBe('2. Download and run the test');
  expect(document.getElementById('verdict')!.textContent).toMatch(/about 4 GB/);
});

it('explains plainly when the API is missing or the machine cannot run it', async () => {
  await runKit(undefined);
  expect(document.getElementById('verdict')!.textContent).toMatch(/isn't switched on/);
  await runKit(fakeNano('unavailable'));
  expect(document.getElementById('verdict')!.textContent).toMatch(/can't run it/);
});
