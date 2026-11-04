import { LensOutputSchema, ShaSchema, VerifierVerdictSchema, type LensOutput, type VerifierVerdict } from '@ptah-extension/review-contracts';
import { z } from 'zod';

export class ReviewOutputParser {
  parseLens(raw: string, expectedSha: string, expectedLens?: LensOutput['findings'][number]['lens']): LensOutput {
    const output = this.parse(raw, LensOutputSchema);
    if (output.headSha !== ShaSchema.parse(expectedSha)) throw new Error('Lane output head mismatch');
    if (expectedLens && output.findings.some((finding) => finding.lens !== expectedLens)) throw new Error('Lane output lens mismatch');
    return output;
  }

  parseVerdict(raw: string, expectedSha: string, expectedFamily: string): VerifierVerdict {
    const verdict = this.parse(raw, VerifierVerdictSchema);
    if (verdict.headSha !== ShaSchema.parse(expectedSha) || verdict.verifierFamily !== expectedFamily)
      throw new Error('Verifier output identity mismatch');
    return verdict;
  }

  parseVerdictBatch(raw: string, expectedSha: string, expectedFamily: string): VerifierVerdict[] {
    const verdicts = this.parse(raw, z.array(VerifierVerdictSchema).max(100));
    if (verdicts.some((verdict) => verdict.headSha !== ShaSchema.parse(expectedSha) || verdict.verifierFamily !== expectedFamily))
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
