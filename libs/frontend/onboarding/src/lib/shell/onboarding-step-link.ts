import { ONBOARDING_QUERY } from '@ptah-extension/core';

/**
 * The step pages of the onboarding flows, by the owner whose session identity
 * they share.
 */
const STEP_OWNERS = {
  // Analyze A1-A3: the saved analysis or catalog source, then the agent
  // generation tab and run.
  analyze: ['analyze', 'agents', 'generate'],
  'new-project': ['new-project', 'new-project-workspace', 'new-project-review'],
  'team-builder': [
    'team-builder',
    'team-builder-workspace',
    'team-builder-review',
  ],
} as const;

type StepOwner = keyof typeof STEP_OWNERS;

export type OnboardingStepId =
  | (typeof STEP_OWNERS)[StepOwner][number]
  | 'guidance'
  | 'done'
  | 'guidance-only';

/** Path below `/onboarding` of every step. */
const STEP_PATHS: Readonly<Record<OnboardingStepId, readonly string[]>> = {
  analyze: ['analyze'],
  agents: ['analyze', 'agents'],
  generate: ['analyze', 'generate'],
  guidance: ['analyze', 'guidance'],
  done: ['analyze', 'done'],
  'guidance-only': ['guidance'],
  'new-project': ['new-project'],
  'new-project-workspace': ['new-project', 'workspace'],
  'new-project-review': ['new-project', 'review'],
  'team-builder': ['team-builder'],
  'team-builder-workspace': ['team-builder', 'workspace'],
  'team-builder-review': ['team-builder', 'review'],
};

/** The identity keys each owner carries between its own steps. */
const OWNER_KEYS: Readonly<Record<StepOwner, readonly string[]>> = {
  analyze: [
    ONBOARDING_QUERY.analysis,
    ONBOARDING_QUERY.source,
    ONBOARDING_QUERY.tab,
    ONBOARDING_QUERY.run,
  ],
  'new-project': [ONBOARDING_QUERY.tab, ONBOARDING_QUERY.rev],
  'team-builder': [ONBOARDING_QUERY.tab, ONBOARDING_QUERY.rev],
};

/** A `routerLink` target: absolute commands plus the complete query. */
export interface OnboardingStepLink {
  readonly commands: readonly string[];
  readonly queryParams: Readonly<Record<string, string>>;
}

/**
 * The link from step `from` to step `to`, carrying `identity` (the current
 * query) as an explicit, complete query object.
 *
 * Never use `queryParamsHandling: 'merge'` for step links: merging would carry
 * one owner's `run` into another owner's page. Within one owner, that owner's
 * keys are copied. Any other transition carries no identity until its rule is
 * defined here (the agent-to-guidance hand-off rules are added with those
 * pages).
 */
export function onboardingStepLink(
  from: OnboardingStepId,
  to: OnboardingStepId,
  identity: Readonly<Record<string, unknown>>,
): OnboardingStepLink {
  const owner = ownerOf(from);
  const queryParams: Record<string, string> = {};
  if (owner && owner === ownerOf(to)) {
    for (const key of OWNER_KEYS[owner]) {
      const value = identity[key];
      if (typeof value === 'string' && value !== '') queryParams[key] = value;
    }
  }
  return { commands: ['/onboarding', ...STEP_PATHS[to]], queryParams };
}

function ownerOf(step: OnboardingStepId): StepOwner | null {
  for (const owner of Object.keys(STEP_OWNERS) as StepOwner[]) {
    if ((STEP_OWNERS[owner] as readonly string[]).includes(step)) return owner;
  }
  return null;
}
