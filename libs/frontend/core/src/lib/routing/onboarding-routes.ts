/**
 * URL builders and the URL parser for the onboarding surface
 * (TASK_2026_ONBOARDING).
 *
 * Onboarding carries its session identity (`tab`, `run`, ...) in the query,
 * never in a path segment, and never shows it as text. These helpers are the
 * one place the onboarding sub-paths and query keys are spelled, so every
 * entry point (generation launcher, harness request service, focus routing,
 * route persistence) addresses the same URLs the onboarding route table
 * declares.
 *
 * They live in `core`, not in the onboarding library, because eager message
 * handlers in `setup-wizard` and `harness-builder` build these URLs too, and
 * those libraries must never depend on onboarding.
 *
 * Pure functions only: no Angular, no Router. A target is handed to
 * `SurfaceRouterService.navigateToSurface('onboarding', subPath, { queryParams })`,
 * which serialises it through the Router (no string concatenation).
 */

import type { SetupGenerationWorkflow } from '@ptah-extension/shared';

/** Same values as `HarnessBuilderMode` in the harness-builder library. */
export type OnboardingHarnessMode = 'new-project' | 'configure-harness';

/** The query keys onboarding uses for hidden session identity. */
export const ONBOARDING_QUERY = {
  tab: 'tab',
  run: 'run',
  gen: 'gen',
  rev: 'rev',
  analysis: 'analysis',
  source: 'source',
  draft: 'draft',
} as const;

/** A navigation target under `/onboarding`. */
export interface OnboardingTarget {
  readonly subPath: readonly string[];
  readonly queryParams: Readonly<Record<string, string>>;
}

/** The settings area a "Get ready" settings page shows. */
export type OnboardingReadyArea = 'providers' | 'cli';

/** A drawer the "Get ready" settings page opens on arrival. */
export type OnboardingReadyOpen = 'claude-accounts';

/** The query keys of the "Get ready" settings page. */
export const ONBOARDING_READY_QUERY = { area: 'area', open: 'open' } as const;

/**
 * Where a "Get ready" pre-step is shown.
 *
 * - `'claude'` (default): the Claude Code check, `/onboarding/ready`, with no
 *   query;
 * - `'settings'`: `/onboarding/ready/settings`, carrying only the `area` and
 *   `open` keys that are given.
 */
export function onboardingReadyTarget(
  stage: 'claude' | 'settings' = 'claude',
  area?: OnboardingReadyArea,
  open?: OnboardingReadyOpen,
): OnboardingTarget {
  if (stage === 'claude') return { subPath: ['ready'], queryParams: {} };
  const queryParams: Record<string, string> = {};
  if (area) queryParams[ONBOARDING_READY_QUERY.area] = area;
  if (open) queryParams[ONBOARDING_READY_QUERY.open] = open;
  return { subPath: ['ready', 'settings'], queryParams };
}

/** The `area` read from a URL; anything unknown reads as `providers`. */
export function parseOnboardingReadyArea(value: unknown): OnboardingReadyArea {
  return value === 'cli' ? 'cli' : 'providers';
}

/** The `open` read from a URL; anything unknown reads as `null`. */
export function parseOnboardingReadyOpen(
  value: unknown,
): OnboardingReadyOpen | null {
  return value === 'claude-accounts' ? 'claude-accounts' : null;
}

/** The longest identity value accepted from a URL. */
const MAX_IDENTITY_LENGTH = 256;

/**
 * Whether `value` may be used as an identity value read from a URL: a
 * non-empty string of at most 256 characters with no `/`, `\` or `:`.
 *
 * A repeated query key arrives as an array and is rejected, as is any
 * non-string.
 */
export function isOnboardingIdentityValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_LENGTH &&
    !/[/\\:]/.test(value)
  );
}

/**
 * Where a generation workflow tab is shown.
 *
 * Agent generation opens on Choose agents, which forwards to Generate agents
 * itself when the tab already has a run. Project guidance opens on the
 * guidance-only entry.
 */
export function onboardingGenerationTarget(
  workflow: SetupGenerationWorkflow,
  tabId: string,
): OnboardingTarget {
  const subPath =
    workflow === 'setup-agent-generation' ? ['analyze', 'agents'] : ['guidance'];
  return { subPath, queryParams: { [ONBOARDING_QUERY.tab]: tabId } };
}

/**
 * Where a harness proposal session is shown: the mode's flow root, or one of
 * its steps when `step` is given.
 */
export function onboardingHarnessTarget(
  mode: OnboardingHarnessMode,
  tabId: string,
  step?: 'workspace' | 'review',
): OnboardingTarget {
  const flow = mode === 'new-project' ? 'new-project' : 'team-builder';
  return {
    subPath: step ? [flow, step] : [flow],
    queryParams: { [ONBOARDING_QUERY.tab]: tabId },
  };
}

/**
 * The generation tab a parsed onboarding URL is bound to, or `null` when the
 * URL is not a generation page or carries no valid `tab`.
 *
 * `segments` is the primary segment path (without matrix parameters) and
 * `queryParams` the parsed query, both as the Router parsed them.
 *
 * - `/onboarding/analyze/agents` and `/onboarding/analyze/generate` bind an
 *   agent generation tab;
 * - `/onboarding/analyze/guidance` and `/onboarding/guidance` bind a project
 *   guidance tab.
 */
export function onboardingGenerationBinding(
  segments: readonly string[],
  queryParams: Readonly<Record<string, unknown>>,
): { tabId: string; workflow: SetupGenerationWorkflow } | null {
  const workflow = generationWorkflowForPath(segments);
  if (!workflow) return null;
  const tabId = queryParams[ONBOARDING_QUERY.tab];
  return isOnboardingIdentityValue(tabId) ? { tabId, workflow } : null;
}

function generationWorkflowForPath(
  segments: readonly string[],
): SetupGenerationWorkflow | null {
  if (segments[0] !== 'onboarding') return null;
  const [, first, second] = segments;
  if (segments.length === 2 && first === 'guidance') {
    return 'setup-project-prompt';
  }
  if (segments.length !== 3 || first !== 'analyze') return null;
  if (second === 'agents' || second === 'generate') {
    return 'setup-agent-generation';
  }
  return second === 'guidance' ? 'setup-project-prompt' : null;
}
