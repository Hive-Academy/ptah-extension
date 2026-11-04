import { injectable } from 'tsyringe';
import { z } from 'zod';
import { IdentityVerdictSchema, ShaSchema } from '@ptah-extension/review-contracts';

const inputSchema = z.object({
  findingId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  status: z.enum(['open', 'addressed', 'reopened', 'disputed']),
  headSha: ShaSchema,
  checkedHeadSha: ShaSchema,
  verdict: z.enum(['fixed', 'still_present', 'inconclusive']),
  identity: IdentityVerdictSchema,
  failurePathEvidence: z.string().trim().min(1).max(4000),
}).strict();
export type FindingRecheckInput = z.infer<typeof inputSchema>;
export type FindingRecheckDecision = 'addressed' | 'reopened' | 'still_open' | 'uncertain';

@injectable()
export class FindingRecheckService {
  decide(inputValue: unknown): FindingRecheckDecision {
    const input = inputSchema.parse(inputValue);
    if (input.headSha !== input.checkedHeadSha || input.identity.relation !== 'same' ||
      input.identity.priorFindingId !== input.findingId) return 'uncertain';
    if (input.verdict === 'inconclusive' || input.status === 'disputed') return 'uncertain';
    if (input.verdict === 'fixed') return input.status === 'open' || input.status === 'reopened' ? 'addressed' : 'uncertain';
    if (input.status === 'addressed') return 'reopened';
    return 'still_open';
  }
}
