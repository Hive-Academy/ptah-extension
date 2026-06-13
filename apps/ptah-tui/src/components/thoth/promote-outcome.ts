import type { SkillSynthesisPromoteResult } from '@ptah-extension/shared';

export type PromoteOutcomeKind = 'success' | 'warning' | 'error';

export interface PromoteOutcome {
  readonly kind: PromoteOutcomeKind;
  readonly text: string;
  readonly reason?: string;
}

export function mapPromoteOutcome(
  result: SkillSynthesisPromoteResult | null,
): PromoteOutcome {
  if (!result) {
    return { kind: 'error', text: 'Promotion failed' };
  }
  if (result.promoted) {
    return {
      kind: 'success',
      text: 'Promoted',
      reason: result.filePath ?? undefined,
    };
  }
  return {
    kind: 'warning',
    text: 'Not promoted',
    reason: result.reason ?? 'rejected by evaluation',
  };
}
