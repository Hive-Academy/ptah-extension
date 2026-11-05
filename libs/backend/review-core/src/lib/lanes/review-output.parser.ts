import { LensOutputSchema, ShaSchema, VerifierVerdictSchema, type LensOutput, type VerifierVerdict } from '@ptah-extension/review-contracts';
import { z } from 'zod';

const identityRelation = z.object({ relation: z.enum(['same', 'distinct', 'uncertain']),
  priorFindingId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).nullable(),
  reason: z.string().trim().min(1).max(1000) }).strict().superRefine((value, context) => {
    if ((value.relation === 'same') !== (value.priorFindingId !== null))
      context.addIssue({ code: 'custom', message: 'Identity prior ID does not match relation' });
  });
export type VerifierIdentityRelation = z.infer<typeof identityRelation>;
const uncertainIdentity: VerifierIdentityRelation = { relation: 'uncertain', priorFindingId: null,
  reason: 'Verifier identity relation missing or invalid' };

export class ReviewOutputParser {
  parseLens(raw: string, expectedSha: string, expectedLens?: LensOutput['findings'][number]['lens']): LensOutput {
    const output = this.parse(raw, LensOutputSchema);
    if (output.headSha !== ShaSchema.parse(expectedSha)) throw new Error('Lane output head mismatch');
    if (expectedLens && output.findings.some((finding) => finding.lens !== expectedLens)) throw new Error('Lane output lens mismatch');
    return output;
  }

  parseVerdict(raw: string, expectedSha: string, expectedFamily: string): VerifierVerdict {
    const verdict = this.parse(raw, VerifierVerdictSchema);
    if (verdict.headSha !== ShaSchema.parse(expectedSha))
      throw new Error('Verifier output identity mismatch');
    // The lane cannot know which family the host selected; the host value is authoritative.
    return { ...verdict, verifierFamily: expectedFamily };
  }

  parseVerdictBatch(raw: string, expectedSha: string, expectedFamily: string): (VerifierVerdict & { identity: VerifierIdentityRelation })[] {
    const rows = this.parse(raw, z.array(z.record(z.string(), z.unknown())).max(100));
    const verdicts = rows.map((row) => {
      const { identity, ...base } = row;
      const parsed = identityRelation.safeParse(identity);
      return { ...VerifierVerdictSchema.parse(base), verifierFamily: expectedFamily,
        identity: parsed.success ? parsed.data : uncertainIdentity };
    });
    if (verdicts.some((verdict) => verdict.headSha !== ShaSchema.parse(expectedSha)))
      throw new Error('Verifier output identity mismatch');
    if (new Set(verdicts.map((verdict) => verdict.candidateId)).size !== verdicts.length)
      throw new Error('Duplicate verifier candidate ID');
    return verdicts;
  }

  private parse<T>(raw: string, schema: { parse(value: unknown): T }): T {
    if (new TextEncoder().encode(raw).length > 1_000_000) throw new Error('Lane output too large');
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch (error: unknown) { throw new Error('Malformed lane JSON', { cause: error }); }
    return schema.parse(value);
  }
}
