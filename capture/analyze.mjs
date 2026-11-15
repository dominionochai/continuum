import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const val = (x) => (x?.ok ? x.value : x?.error?.name ?? 'n/a');

/** Turns a capture report into a summary, and shows what `classify` makes of every real device error. */
export function analyze(r, classify) {
  const L = [
    `Environment: ${r.env?.ua}`,
    `CPUs ${r.env?.cpus}, memory tier ${r.env?.deviceMemoryGB} GB`,
    `Availability: bare=${val(r.availability?.bare)}, with languages=${val(r.availability?.withLanguages)}`,
  ];
  if (r.download) L.push(`Download: ${r.download.outcome} in ${Math.round(r.download.totalMs / 1000)}s, ${r.download.events.length} progress events, longest gap ${r.download.maxGapMs} ms`);
  const b = r.baseline?.summary;
  if (b) L.push(`Baseline: ${b.ok} ok / ${b.failed} failed, first ${b.firstMs} ms, median ${b.medianMs} ms, session input quota ${r.baseline.session?.inputQuota ?? 'n/a'}`);
  if (r.probeMedianMs != null) L.push(`Health probe cost: median ${r.probeMedianMs} ms`);
  L.push(`Reported available, then failed: ${r.availableButFailed ? 'YES (the gap, on real hardware)' : 'no'}`);
  if (r.kitError) L.push(`Kit error: ${r.kitError.name}: ${r.kitError.message}`);
  L.push('', 'Forced failures (error name [constructor] -> our classification):');
  for (const [label, x] of Object.entries(r.forced ?? {})) {
    if (!x.ok) {
      const kind = classify(x.error, 'device');
      L.push(`  ${label}: ${x.error.name} [${x.error.ctor}] -> ${kind}${kind === 'inference' ? '  (unmapped: add a rule or accept)' : ''}`);
    } else if (Array.isArray(x.value) && x.value.some((v) => v !== 'ok')) {
      L.push(`  ${label}: partial, ${x.value.map((v) => (v === 'ok' ? 'ok' : v.name)).join(', ')}`);
    } else L.push(`  ${label}: no error`);
  }
  return L.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { classify } = await import('../dist/index.js');
  console.log(analyze(JSON.parse(readFileSync(process.argv[2], 'utf8')), classify));
}
