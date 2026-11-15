import { AIError, AIErrorCode as C } from '@firebase/ai';
import { expect, it } from 'vitest';
import { classify } from '../src/index.js';

const ai = (code: any, status?: number) => new AIError(code, 'x', status ? { status } : undefined);

it.each([
  ['429 is quota', ai(C.FETCH_ERROR, 429), 'cloud', 'quota'],
  ['5xx is transient', ai(C.FETCH_ERROR, 503), 'cloud', 'network'],
  ['other 4xx is config, not retryable', ai(C.FETCH_ERROR, 403), 'cloud', 'config'],
  ['fetch error without status is network', ai(C.FETCH_ERROR), 'cloud', 'network'],
  ['wrapped raw failure is network on cloud', ai(C.ERROR), 'cloud', 'network'],
  ['but only inference on device', ai(C.ERROR), 'device', 'inference'],
  ['unsupported is availability', ai(C.UNSUPPORTED), 'device', 'availability'],
  ['api-not-enabled on device is availability', ai(C.API_NOT_ENABLED), 'device', 'availability'],
  ['api-not-enabled on cloud is config', ai(C.API_NOT_ENABLED), 'cloud', 'config'],
  ['missing api key is config', ai(C.NO_API_KEY), 'cloud', 'config'],
  ['fetch timeout is timeout', new DOMException('x', 'AbortError'), 'cloud', 'timeout'],
  ['an adapter timeout is timeout', Object.assign(new Error('x'), { name: 'TimeoutError' }), 'device', 'timeout'],
  ['no LanguageModel (adapter guard) is availability', Object.assign(new Error('x'), { name: 'DeviceUnavailable' }), 'device', 'availability'],
  ['SDK served a different source than requested is availability', Object.assign(new Error('x'), { name: 'SourceMismatch' }), 'device', 'availability'],
  ['anything else is inference', new Error('boom'), 'device', 'inference'],
] as const)('%s', (_, e, source, kind) => expect(classify(e, source)).toBe(kind));
