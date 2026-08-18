import type {
  HarnessFacet,
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
