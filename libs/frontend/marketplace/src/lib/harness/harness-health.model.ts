import { blockedTargetPaths } from '@ptah-extension/shared';
import type {
  HarnessFacet,
  HarnessHealth,
  HarnessHealthLevel,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';

/**
 * Presentation helpers for the harness health badge.
 *
 * DELIBERATELY NOT A SECOND REDUCER. `summarizeHarnessHealth` lives in
 * `@ptah-extension/shared` next to the report it reduces, because three
 * consumers depend on it agreeing with itself: this badge, `ptah harness
 * doctor`'s exit code, and the `harness:healthChanged` push. Everything here is
 * pure rendering — how a level looks, what a target is called, what order the
 * facet chips appear in — and nothing here decides what "healthy" means.
 */

/** DaisyUI semantic colour for a health level. */
export type HarnessBadgeTone = 'success' | 'warning' | 'error' | 'neutral';

/**
 * Map severity to a colour.
 *
 * `unknown` is neutral grey rather than amber: no reconcile has run yet (or no
 * workspace is open), which is an absence of information and not a fault. An
 * amber badge on a freshly opened window would be a false alarm on every
 * cold start.
 *
 * Note `sources-missing` renders AMBER, not red, because the shared reducer
 * classifies it `degraded`. That is intentional and documented on
 * `HarnessSourcesStatus`: a cold offline first run heals itself on the next
 * online activation, so it is a "not whole yet" state rather than a failure.
 * Red is reserved for `writeFailed` — Ptah tried and the filesystem refused,
 * which is the only case a human must act on.
 */
export function harnessBadgeTone(level: HarnessHealthLevel): HarnessBadgeTone {
  switch (level) {
    case 'ok':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'error':
      return 'error';
    case 'unknown':
      return 'neutral';
  }
}

/**
 * Facet chip order. Fixed rather than read off `Object.keys(facets)` so the row
 * reads identically for every target regardless of how the backend built the
 * matrix.
 */
export const HARNESS_FACET_ORDER: readonly HarnessFacet[] = [
  'skills',
  'commands',
  'agents',
  'mcp',
] as const;

/** Short chip labels. The wire keys are plural nouns; these are the same, shortened. */
const FACET_LABELS: Readonly<Record<HarnessFacet, string>> = {
  skills: 'skills',
  commands: 'commands',
  agents: 'agents',
  mcp: 'mcp',
};

export function harnessFacetLabel(facet: HarnessFacet): string {
  return FACET_LABELS[facet];
}

/** Human names for target ids. The wire ids are slugs, not display names. */
const TARGET_LABELS: Readonly<Record<HarnessTargetId, string>> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'Copilot',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  vscode: 'VS Code',
};

/** Display name for a target id, falling back to the raw id. */
export function harnessTargetLabel(target: HarnessTargetId): string {
  return TARGET_LABELS[target] ?? target;
}

/**
 * Whether one target row should render as attention-needing.
 *
 * Row-level only — it tints a row, it does not feed the overall badge. Unlike
 * the shared reducer this DOES include `overwrittenLocalEdit`, because at row
 * level it is actionable information ("your edit here was replaced; edit the
 * user layer instead", E10) rather than a defect in the reconcile.
 */
export function harnessTargetNeedsAttention(
  target: HarnessTargetHealth,
): boolean {
  if (!target.detected) {
    return false;
  }
  return (
    target.missing.length > 0 ||
    target.writeFailed.length > 0 ||
    target.overwrittenLocalEdit.length > 0
  );
}

/** One target's blocked paths, ready to render. */
export interface HarnessBlockedGroup {
  target: HarnessTargetId;
  /** Display name, so the template never re-derives it. */
  label: string;
  paths: readonly string[];
}

/** Flattened blocked set across a whole report. */
export interface HarnessBlockedDisclosure {
  /** Total blocked paths across every detected target. */
  count: number;
  /** Non-empty groups only, in the order the backend reported its targets. */
  groups: readonly HarnessBlockedGroup[];
}

const NO_BLOCKED: HarnessBlockedDisclosure = { count: 0, groups: [] };

/**
 * Group the blocked set for the panel — flattening only, no set logic.
 *
 * The intersection itself comes from {@link blockedTargetPaths} in
 * `@ptah-extension/shared`, which is the same function the reconciler's
 * blocked-path WARN is built from. It is imported rather than reimplemented
 * on purpose: a frontend lib cannot import `harness-sync`, so writing
 * `missing.filter(p => foreign.includes(p))` here would put a second producer
 * of one set on the other side of the wire, free to drift from the log the
 * user is comparing this card against. Everything below is presentation —
 * which groups exist, what they are called, how many there are.
 *
 * UNDETECTED TARGETS ARE EXCLUDED, matching `summarizeHarnessHealth`. That
 * reducer drops them from `missing` because an uninstalled Codex is not a gap
 * (E17), so counting their blocked paths here would let the disclosure claim a
 * larger shortfall than the badge above it reports — the one arithmetic the
 * user is guaranteed to check.
 */
export function harnessBlockedPaths(
  health: HarnessHealth | null,
): HarnessBlockedDisclosure {
  if (health === null) {
    return NO_BLOCKED;
  }

  const groups: HarnessBlockedGroup[] = [];
  let count = 0;
  for (const target of health.targets) {
    if (!target.detected) {
      continue;
    }
    const paths = blockedTargetPaths(target);
    if (paths.length === 0) {
      continue;
    }
    count += paths.length;
    groups.push({
      target: target.target,
      label: harnessTargetLabel(target.target),
      paths,
    });
  }

  return count === 0 ? NO_BLOCKED : { count, groups };
}
