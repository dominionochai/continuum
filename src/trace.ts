import type { Kind } from './classify.js';
import type { Entry, Source } from './runner.js';

/** `observed`: the log recorded it happening. `inferred`: we only know a start with no end, and conclude the page died. */
export interface Span {
  stage: string;
  /** The route Continuum requested. Firebase may not expose which backend actually served the call. */
  source: Source;
  at: number;
  outcome: 'done' | 'fail' | 'interrupted';
  basis: 'observed' | 'inferred';
  ms?: number;
  error?: string;
  kind?: Kind;
}

export const spans = (log: Entry[]): Span[] =>
  log.flatMap((e, i): Span[] => {
    const next = log[i + 1];
    if (e.k !== 'start') return [];
    if (!next || next.k === 'start')
      return [{ stage: e.stage, source: e.source, at: e.at, outcome: 'interrupted', basis: 'inferred' }];
    return [{
      stage: e.stage, source: e.source, at: e.at, outcome: next.k, basis: 'observed',
      ms: next.at - e.at, error: next.k === 'fail' ? next.err : undefined, kind: next.k === 'fail' ? next.kind : undefined,
    }];
  });

/** Every time work moved to the other source after a lost attempt. `gapMs` (failures only) is the observed time to the next start. */
export const recoveries = (log: Entry[]) => {
  const s = spans(log);
  return s.flatMap((a, i) => {
    const b = s[i + 1];
    if (a.outcome === 'done' || !b || b.source === a.source) return [];
    return [{
      stage: a.stage, from: a.source, to: b.source, cause: a.outcome, basis: a.basis,
      gapMs: a.ms === undefined ? undefined : b.at - (a.at + a.ms),
    }];
  });
};

export const format = (log: Entry[]) => {
  const s = spans(log);
  const lines = s.map(x =>
    `${x.stage} [${x.source}] ${x.outcome}${x.kind ? ':' + x.kind : ''}${x.basis === 'inferred' ? '*' : ''} ${x.ms ?? '?'}ms${x.error ? ' ' + x.error : ''}`);
  return [...lines, ...(s.some(x => x.basis === 'inferred') ? ['* inferred, not observed'] : [])].join('\n');
};
