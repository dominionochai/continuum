import { getGenerativeModel, InferenceMode, type AI } from '@firebase/ai';
import type { Source } from './runner.js';

/**
 * Binds one Firebase AI Logic model per source. Continuum picks the source per attempt;
 * the SDK is pinned to it, so a device failure surfaces here instead of being hidden.
 * `via` is what the SDK reports actually served the call, not what we requested.
 */
export function firebaseGenerate(ai: AI) {
  const models = {
    device: getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE }),
    cloud: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD }),
  };
  return async (source: Source, prompt: string) => {
    const { response } = await models[source].generateContent(prompt);
    return { text: response.text(), via: response.inferenceSource };
  };
}
