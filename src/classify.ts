import type { Source } from './runner.js';

export type Kind = 'quota' | 'network' | 'timeout' | 'availability' | 'config' | 'inference';

/**
 * Maps an error to what it means for recovery. Shapes come from @firebase/ai 3.1.0's own source:
 * cloud failures are `AIError` with `customErrorData.status`; fetch timeouts surface as `AbortError`.
 * `source` matters: the SDK reuses `api-not-enabled` for "no on-device LanguageModel" as well.
 */
export function classify(e: any, source: Source): Kind {
  const status: number | undefined = e?.customErrorData?.status;
  if (e?.name === 'AbortError') return 'timeout';
  // Cloud 429, or on-device QuotaExceededError (the Prompt API's "input too large"; unverified on a real device).
  if (status === 429 || e?.name === 'QuotaExceededError') return 'quota';
  if (status !== undefined && status >= 500) return 'network';
  switch (e?.code) {
    case 'fetch-error': return status === undefined ? 'network' : 'config'; // other 4xx: our request or credentials
    case 'error': return source === 'cloud' ? 'network' : 'inference'; // SDK wraps raw fetch failures in this
    case 'unsupported': return 'availability';
    case 'api-not-enabled': return source === 'device' ? 'availability' : 'config';
    case 'no-api-key': case 'no-app-id': case 'no-project-id': case 'no-model': return 'config';
    default: return 'inference';
  }
}
