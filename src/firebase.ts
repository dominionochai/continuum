import { getGenerativeModel, InferenceMode, type AI } from '@firebase/ai';
import type { Source } from './runner.js';
import { within } from './within.js';

const named = (name: string, message: string) => Object.assign(new Error(message), { name });

/**
 * Binds one Firebase AI Logic model per source. Continuum picks the source per attempt; the SDK is pinned to it,
 * and three SDK behaviors (checked in @firebase/ai 3.1.0) are guarded here:
 *  - ONLY_ON_DEVICE silently runs in the cloud when `LanguageModel` is absent, so the device is refused up front;
 *  - every on-device call destroys the previous session, aborting any still running, so device calls take turns;
 *  - the on-device path has no timeout, so a turn is released after `timeoutMs`.
 * `via` is what the SDK reports actually served the call; a mismatch with the request is an error.
 */
export function firebaseGenerate(ai: AI, { deviceTimeoutMs = 60_000 } = {}) {
  const models = {
    device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD }),
  };
  let tail: Promise<unknown> = Promise.resolve();

  const ask = async (source: Source, prompt: string) => {
    if (source === 'device' && !(globalThis as any).LanguageModel)
      throw named('DeviceUnavailable', 'No on-device LanguageModel: the SDK would silently use the cloud instead.');
    const { response } = await models[source].generateContent(prompt);
    const via = response.inferenceSource;
    if (via !== (source === 'device' ? 'on_device' : 'in_cloud')) throw named('SourceMismatch', `Requested ${source}, the SDK served ${via}.`);
    return { text: response.text(), via };
  };

  return (source: Source, prompt: string, { timeoutMs = deviceTimeoutMs } = {}) => {
    if (source === 'cloud') return ask('cloud', prompt);
    const turn = tail.then(() => within(ask('device', prompt), timeoutMs));
    tail = turn.catch(() => {}); // a failed or timed-out call must not block the next one
    return turn;
  };
}

/** Starts and tracks the model download through Firebase's own API. `onProgress` fires on every progress event. */
export const firebaseWarm = (ai: AI) => (onProgress: () => void) =>
  getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }).initializeDeviceModel(() => onProgress());
