import { getGenerativeModel, InferenceMode, type AI } from '@firebase/ai';
import type { Source } from './runner.js';
import { within } from './within.js';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

export interface StreamOpts {
  /** What an earlier attempt saved (`ctx.saved`): the answer so far, to continue from. */
  saved?: unknown;
  /** Called with the whole answer so far on every chunk (`ctx.save`). */
  save?: (text: string) => void;
  /** Per call for `generate`; the longest silence between chunks for `stream`. */
  timeoutMs?: number;
}

/**
 * Binds one Firebase AI Logic model per source. Continuum picks the source per attempt; the SDK is pinned to it,
 * and three SDK behaviors (checked in @firebase/ai 3.1.0) are guarded here:
 *  - ONLY_ON_DEVICE silently runs in the cloud when `LanguageModel` is absent, so the device is refused up front;
 *  - every on-device call destroys the previous session, aborting any still running, so device calls take turns;
 *  - the on-device path has no timeout, so a turn is released after `timeoutMs`.
 * `via` is what the SDK reports actually served the call; a mismatch with the request is an error.
 * `generate.stream` streams, and can continue an answer that another attempt began.
 */
export function firebaseGenerate(ai: AI, { deviceTimeoutMs = 60_000 } = {}) {
  const models = {
    device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD }),
  };
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(source: Source, run: () => Promise<T>): Promise<T> => {
    if (source === 'cloud') return run();
    const turn = tail.then(run);
    tail = turn.catch(() => {}); // a failed or timed-out call must not block the next one
    return turn;
  };
  const guard = (source: Source) => {
    if (source === 'device' && !(globalThis as any).LanguageModel)
      throw named('DeviceUnavailable', 'No on-device LanguageModel: the SDK would silently use the cloud instead.');
  };
  const verify = (source: Source, via: unknown) => {
    if (via !== (source === 'device' ? 'on_device' : 'in_cloud')) throw named('SourceMismatch', `Requested ${source}, the SDK served ${via}.`);
    return via as string;
  };

  const ask = async (source: Source, prompt: string) => {
    guard(source);
    const { response } = await models[source].generateContent(prompt);
    return { text: response.text(), via: verify(source, response.inferenceSource) };
  };
  const generate = (source: Source, prompt: string, { timeoutMs = deviceTimeoutMs } = {}) =>
    exclusive(source, () => (source === 'device' ? within(ask(source, prompt), timeoutMs) : ask(source, prompt)));

  const stream = (source: Source, prompt: string, { saved, save, timeoutMs = deviceTimeoutMs }: StreamOpts = {}) =>
    exclusive(source, async () => {
      guard(source);
      const prefix = typeof saved === 'string' ? saved : '';
      const asked = prefix
        ? `${prompt}\n\nYour answer was cut off. This is what you had written so far:\n${prefix}\n\nContinue from exactly where it stops, without repeating anything.`
        : prompt;
      const result = await models[source].generateContentStream(asked);
      result.response.catch(() => {}); // if the stream dies, this promise rejects too, and nobody else is listening
      const chunks = result.stream[Symbol.asyncIterator]();
      let text = prefix;
      for (;;) {
        const { value, done } = await within(chunks.next(), timeoutMs);
        if (done) break;
        text += value.text();
        save?.(text);
      }
      return { text, via: verify(source, (await result.response).inferenceSource), continued: prefix !== '' };
    });

  return Object.assign(generate, { stream });
}

/** Starts and tracks the model download through Firebase's own API. `onProgress` fires on every progress event. */
export const firebaseWarm = (ai: AI) => (onProgress: () => void) =>
  getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }).initializeDeviceModel(() => onProgress());
