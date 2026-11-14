export interface Sim {
  availability: string;
  prompt: 'ok' | 'throw' | 'hang';
  download?: 'ok' | 'stall';
  creates?: number;
}

const never = () => new Promise<never>(() => {});

/**
 * Stand-in for Chrome's Prompt API `LanguageModel`, driven by a mutable `sim` so behavior can flip mid-run.
 * SIMULATED: the error shape is a guess, since real Gemini Nano's failures haven't been captured.
 */
export function fakeLanguageModel(sim: Sim) {
  return {
    availability: async () => sim.availability,
    async create(opts?: { monitor?: (m: EventTarget) => void }) {
      sim.creates = (sim.creates ?? 0) + 1;
      if (opts?.monitor) {
        const m = new EventTarget();
        opts.monitor(m);
        const tick = (loaded: number) => m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded }));
        tick(0.1), tick(0.5);
        if (sim.download === 'stall') await never();
        tick(1);
        sim.availability = 'available';
      }
      return {
        prompt: async (_: unknown) =>
          sim.prompt === 'throw' ? Promise.reject(new DOMException('simulated crash', 'UnknownError'))
          : sim.prompt === 'hang' ? never()
          : 'device answer',
        destroy() {},
      };
    },
  };
}
