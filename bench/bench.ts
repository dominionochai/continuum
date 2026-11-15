import { health, idbStore, observe, policy, quota, recoveries, runner, spans, type Source, type Stage } from '../src/index.js';
import { within } from '../src/within.js';

export type Gen = (source: Source, prompt: string) => Promise<{ text: string }>;
export interface Opts {
  gen: Gen;                                   // Continuum's adapter: (source, prompt)
  stock: (prompt: string) => Promise<string>; // the same call through stock PREFER_ON_DEVICE
  lm: any;                                    // the LanguageModel the health engine probes
  prompt: string;                             // the prompt for the failure scenario
  simulated: boolean;                         // stamped on the report: never let a simulated run pass as real
  runs?: number;
  timeoutMs?: number;
}

const pct = (a: number[], p: number) => (a.length ? Math.round([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]) : null);

async function measure(runs: number, fn: (i: number) => Promise<unknown>, timeoutMs: number) {
  const ok: number[] = [], errors: Record<string, number> = {};
  let hung = 0, lostMs = 0;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    try { await within(fn(i), timeoutMs); ok.push(performance.now() - t); }
    catch (e: any) {
      lostMs += performance.now() - t; // time spent on an attempt that gave the app nothing
      const name = e?.name === 'TimeoutError' ? (hung++, 'Timeout') : e?.name ?? 'Error';
      errors[name] = (errors[name] ?? 0) + 1;
    }
  }
  return { runs, ok: ok.length, failed: runs - ok.length, hung, errors, medianMs: pct(ok, 0.5), p95Ms: pct(ok, 0.95), lostMs: Math.round(lostMs) };
}

/**
 * Two scenarios, same two-stage task, stock Firebase vs Continuum:
 *  1. failure: does the task survive a device that reports available and then fails on this prompt?
 *  2. interruption: the page dies in stage 2. Counts stage starts and finished stages that run again.
 */
export async function bench(o: Opts) {
  const { gen, stock, lm, prompt, runs = 20, timeoutMs = 30_000 } = o;
  const db = `bench-${Date.now()}`;
  const h = health(lm), q = quota();
  const hooks = { route: policy(h, { quota: q }), ...observe(h, q) };
  const two = (p: string): Stage<void>[] => [['extract', c => gen(c.source, p)], ['summarize', c => gen(c.source, p)]];

  const stockArm = await measure(runs, async () => { await stock(prompt); await stock(prompt); }, timeoutMs);
  const contArm = await measure(runs, i => runner(idbStore(db), two(prompt), hooks).run(`f${i}`), timeoutMs);
  const logs = (await Promise.all(Array.from({ length: runs }, (_, i) => idbStore(db).get(`f${i}`)))).flatMap(t => (t ? [t.log] : []));
  const continuum = {
    ...contArm,
    deviceFailures: logs.flatMap(spans).filter(s => s.source === 'device' && s.outcome !== 'done').length,
    recoveries: logs.flatMap(recoveries).length,
  };

  // Interruption: a short prompt, so the device works and only the crash is in play.
  const small = 'Reply with one short sentence.';
  const starts = { stock: 0, continuum: 0 };
  const lockless = { ...hooks, lock: <T>(_: string, fn: () => Promise<T>) => fn() }; // an abandoned run would hold the tab's Web Lock
  for (let i = 0; i < runs; i++) {
    let crashed!: () => void, first = true;
    const dead = new Promise<void>(r => (crashed = r));
    const stages: Stage<void>[] = [
      ['extract', c => (starts.continuum++, gen(c.source, small))],
      ['summarize', c => {
        starts.continuum++;
        if (first) return (first = false, crashed(), new Promise(() => {})); // the page dies here
        return gen(c.source, small);
      }],
    ];
    void runner(idbStore(db), stages, lockless).run(`i${i}`);
    await dead;
    await runner(idbStore(db), stages, lockless).run(`i${i}`); // after the "reload"
    starts.stock += 4; // by construction, no call made: stock keeps nothing, so after the crash everything restarts (extract, crashed summarize, extract, summarize)
  }
  const interrupted = (await Promise.all(Array.from({ length: runs }, (_, i) => idbStore(db).get(`i${i}`)))).flatMap(t => (t ? [t.log] : []));
  const extractStarts = interrupted.reduce((n, l) => n + l.filter(e => e.k === 'start' && e.stage === 'extract').length, 0);

  return {
    simulated: o.simulated, runs,
    failure: { stock: stockArm, continuum },
    interruption: {
      stageStartsPerRun: { stock: starts.stock / runs, continuum: starts.continuum / runs },
      finishedStageRerunPerRun: { stock: 1, continuum: extractStarts / runs - 1 }, // measured from the log; stock restarts extract by construction
    },
  };
}

export type Report = Awaited<ReturnType<typeof bench>>;

export const formatBench = (r: Report) => {
  const arm = (a: Report['failure']['stock']) =>
    `ok ${a.ok}/${a.runs}, errors ${JSON.stringify(a.errors)}, median ${a.medianMs ?? '-'} ms, p95 ${a.p95Ms ?? '-'} ms, hung ${a.hung}, lost ${a.lostMs} ms`;
  const { stock, continuum } = r.failure, i = r.interruption;
  return [
    r.simulated ? 'SIMULATED device and network. Not a Gemini Nano measurement.' : 'Real device.',
    `Task survives a failing device (${r.runs} runs, 2 stages):`,
    `  stock Firebase: ${arm(stock)}`,
    `  Continuum:      ${arm(continuum)}, device failures ${continuum.deviceFailures}, recoveries ${continuum.recoveries}`,
    `Page dies in stage 2 (${r.runs} runs):`,
    `  stage starts per run: stock ${i.stageStartsPerRun.stock} (by construction: it keeps no state), Continuum ${i.stageStartsPerRun.continuum} (counted)`,
    `  finished stage run again: stock ${i.finishedStageRerunPerRun.stock} (by construction), Continuum ${i.finishedStageRerunPerRun.continuum} (read from the log)`,
  ].join('\n');
};
