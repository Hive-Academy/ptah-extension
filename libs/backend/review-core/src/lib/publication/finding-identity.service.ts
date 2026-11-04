import { injectable } from 'tsyringe';
import { ulid } from 'ulid';
import { z } from 'zod';
import { CandidateFindingSchema, IdentityVerdictSchema, ReviewPathSchema } from '@ptah-extension/review-contracts';

const priorSchema = z.object({
  findingId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  path: ReviewPathSchema,
  symbol: z.string().trim().min(1).max(256).nullable(),
  category: CandidateFindingSchema.shape.category,
  status: z.enum(['open', 'addressed', 'reopened', 'disputed']),
}).strict();
export type PriorFindingIdentity = z.infer<typeof priorSchema>;

const candidateSchema = z.object({
  candidateId: z.string().trim().min(1).max(256),
  finding: CandidateFindingSchema,
  symbol: z.string().trim().min(1).max(256).nullable(),
}).strict();
export type FindingIdentityCandidate = z.infer<typeof candidateSchema>;

export type IdentityDecision =
  | { kind: 'existing'; findingId: string }
  | { kind: 'new'; findingId: string }
  | { kind: 'uncertain'; findingId: null };

/** Shortlist by stable source context; line numbers and prose never form an identity key. */
@injectable()
export class FindingIdentityService {
  shortlist(candidateInput: FindingIdentityCandidate, priorsInput: readonly PriorFindingIdentity[], limit = 20): PriorFindingIdentity[] {
    const candidate = candidateSchema.parse(candidateInput);
    const priors = z.array(priorSchema).max(10000).parse(priorsInput);
    const cap = z.number().int().min(1).max(100).parse(limit);
    return priors.filter((prior) => prior.path === candidate.finding.path &&
      prior.category === candidate.finding.category &&
      (candidate.symbol === null || prior.symbol === null || prior.symbol === candidate.symbol))
      .slice(0, cap);
  }

  /** Call inside the caller's per-PR SQLite identity transaction. */
  decide(candidateInput: FindingIdentityCandidate, priorsInput: readonly PriorFindingIdentity[], verdictInput: unknown, now = Date.now()): IdentityDecision {
    const candidate = candidateSchema.parse(candidateInput);
    const shortlist = this.shortlist(candidate, priorsInput);
    const verdict = IdentityVerdictSchema.parse(verdictInput);
    if (verdict.candidateId !== candidate.candidateId || verdict.evidence.path !== candidate.finding.path ||
      (candidate.symbol !== null && verdict.evidence.symbol !== candidate.symbol)) {
      throw new Error('Identity verdict does not match candidate context');
    }
    if (verdict.priorFindingId !== null && !shortlist.some((prior) => prior.findingId === verdict.priorFindingId)) {
      throw new Error('Identity verdict refers to a finding outside the shortlist');
    }
    if (verdict.relation === 'same') return { kind: 'existing', findingId: verdict.priorFindingId! };
    if (verdict.relation === 'uncertain') return { kind: 'uncertain', findingId: null };
    if (shortlist.length > 0 && !verdict.evidence.reason) throw new Error('Distinct relation requires evidence');
    return { kind: 'new', findingId: ulid(z.number().int().nonnegative().parse(now)) };
  }
}
