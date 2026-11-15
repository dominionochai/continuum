import { expect, it } from 'vitest';
import { analyze } from '../capture/analyze.mjs';
import { classify } from '../src/index.js';

const bad = (name: string, ctor = 'DOMException') => ({ ok: false, ms: 5, error: { name, ctor, message: 'x' } });

it('summarizes a report and shows how each real device error is classified', () => {
  const text = analyze({
    env: { ua: 'Chrome/150', cpus: 8, deviceMemoryGB: 8 },
    availability: { bare: { ok: true, value: 'available' }, withLanguages: { ok: true, value: 'available' } },
    baseline: { summary: { ok: 7, failed: 1, firstMs: 900, medianMs: 120 }, session: { inputQuota: 9216 } },
    probeMedianMs: 340,
    availableButFailed: true,
    forced: { oversizedPrompt: bad('QuotaExceededError'), unsupportedLanguage: bad('NotSupportedError'), parallel: { ok: true, value: ['ok', { name: 'AbortError' }] } },
  }, classify);
  expect(text).toContain('Reported available, then failed: YES');
  expect(text).toContain('session input quota 9216');
  expect(text).toContain('oversizedPrompt: QuotaExceededError [DOMException] -> quota');
  expect(text).toContain('unsupportedLanguage: NotSupportedError [DOMException] -> inference  (unmapped');
  expect(text).toContain('parallel: partial, ok, AbortError');
});

it('copes with a report from a machine that never got far', () => {
  const text = analyze({ env: { ua: 'Chrome/150' }, availability: { bare: { ok: true, value: 'unavailable' } }, baseline: {}, forced: {} }, classify);
  expect(text).toContain('bare=unavailable');
});
