import type { Stage } from '../src/index.js';
import type { firebaseGenerate } from '../src/firebase.js';

export interface Part { text: string; via: string }
type Gen = ReturnType<typeof firebaseGenerate>;

/** Packs paragraphs into pieces of about `size` characters. */
export const chunks = (text: string, size = 300) => {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)) {
    const last = out.length - 1;
    if (last >= 0 && out[last].length + para.length < size) out[last] += `\n\n${para}`;
    else out.push(para);
  }
  return out;
};

/**
 * Summarize a long text in three stages, each showing a different part of Continuum:
 *  - sections: one short summary per piece, with a cursor saved inside the stage, so a failure or a reload
 *    carries on at the next piece instead of starting over;
 *  - summary: streamed, and continued on the cloud if the device dies partway;
 *  - polish: needs the cloud, so offline it waits and finishes by itself when the network returns.
 */
export function digest(gen: Gen, pause: () => Promise<void> = async () => {}): Stage<string>[] {
  const text = (v: unknown) => (v as { text: string }).text;
  return [
    ['sections', async c => {
      const parts = [...((c.saved as Part[] | undefined) ?? [])];
      for (const piece of chunks(c.input).slice(parts.length)) {
        const { text, via } = await gen(c.source, `Summarize this section in one sentence:\n\n${piece}`);
        parts.push({ text, via });
        c.save([...parts]);
        await pause(); // lets a demo slow things down enough to reload mid-task
      }
      return parts;
    }],
    ['summary', c => gen.stream(c.source, `Combine these section summaries into a short summary:\n\n${(c.done.sections as Part[]).map(p => p.text).join('\n')}`, { saved: c.saved, save: c.save })],
    ['polish', c => gen(c.source, `Improve the wording of this summary without adding facts:\n\n${text(c.done.summary)}`), { needs: 'cloud' }],
  ];
}

export const SAMPLE = `The launch meeting moved from Tuesday to Thursday so the design team could finish the onboarding flow. Ana will own the launch checklist, and Kemi will handle the support rota for the first week. The team agreed that nothing ships on Friday afternoon.

Budget for the campaign was approved at the lower of the two proposed figures. Most of it goes to a small paid trial in two cities, with the rest held back until the first results arrive. If sign-ups beat the target by the end of the second week, the held-back amount is released.

The main risk is the payment provider's new verification step, which has slowed test transactions. Tunde will confirm a fallback provider by Monday. Until then the public date stays unannounced, and customers who joined the waiting list will get a short note rather than a promise.`;
