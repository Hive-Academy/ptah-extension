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
 * query, or a caller-prepared hand-off object) as an explicit, complete query.
 *
 * Never use `queryParamsHandling: 'merge'` for step links: merging would carry
 * one owner's `run` into another owner's page. Within one owner, that owner's
 * keys are copied. Cross-owner Analyze transitions follow the A2 table: agent
 * `run` is never written on the way to guidance; `gen` is always written when
 * an agent tab is known.
 */
export function onboardingStepLink(
  from: OnboardingStepId,
  to: OnboardingStepId,
  identity: Readonly<Record<string, unknown>>,
): OnboardingStepLink {
  return {
    commands: ['/onboarding', ...STEP_PATHS[to]],
    queryParams: queryForTransition(from, to, identity),
  };
}

function queryForTransition(
  from: OnboardingStepId,
  to: OnboardingStepId,
  identity: Readonly<Record<string, unknown>>,
): Record<string, string> {
  if (from === 'generate' && to === 'guidance') {
    return agentToGuidanceQuery(identity);
  }
  if (from === 'guidance' && to === 'done') {
    return pickKeys(identity, [ONBOARDING_QUERY.tab, ONBOARDING_QUERY.gen]);
  }
  if (from === 'guidance' && to === 'generate') {
    const tab = identityValue(identity, ONBOARDING_QUERY.gen);
    return tab ? { [ONBOARDING_QUERY.tab]: tab } : {};
  }
  const owner = ownerOf(from);
  if (owner && owner === ownerOf(to)) {
    return pickKeys(identity, OWNER_KEYS[owner]);
  }
  return {};
}

/**
 * A3 → A4. `tab` is the guidance tab when the caller already remapped it,
 * otherwise the current (agent) tab. `gen` is the agent tab: a prepared
 * `gen` wins, else the current `tab`. The agent `run` is never copied;
 * A4 rebinds a guidance run from `?run` only when a later owner writes it,
 * or from the handoff store / authoritative state.
 */
function agentToGuidanceQuery(
  identity: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const query: Record<string, string> = {};
  const tab = identityValue(identity, ONBOARDING_QUERY.tab);
  const gen =
    identityValue(identity, ONBOARDING_QUERY.gen) ?? tab;
  if (tab) query[ONBOARDING_QUERY.tab] = tab;
  if (gen) query[ONBOARDING_QUERY.gen] = gen;
  // A prepared handoff run belongs to guidance. The current agent run is
  // deliberately never copied across owners.
  const guidanceRun = identityValue(identity, 'guidanceRun');
  if (guidanceRun) query[ONBOARDING_QUERY.run] = guidanceRun;
  return query;
}

function pickKeys(
  identity: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const key of keys) {
    const value = identityValue(identity, key);
    if (value) query[key] = value;
  }
  return query;
}

function identityValue(
  identity: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = identity[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function ownerOf(step: OnboardingStepId): StepOwner | null {
  for (const owner of Object.keys(STEP_OWNERS) as StepOwner[]) {
    if ((STEP_OWNERS[owner] as readonly string[]).includes(step)) return owner;
  }
  return null;
}
