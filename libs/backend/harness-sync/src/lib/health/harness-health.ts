/**
 * Turns a plan + an apply result into the report a human can act on.
 *
 * Defect 16 of the TASK_2026_278 inventory is "no verification, no health
 * surface — every failure above is silent". Everything the reconciler learns
 * ends up here, including the boring parts: a target that was skipped, a
 * directory left alone because it was not ours, a copy that lost a race with an
 * antivirus scanner.
 */

import type {
  HarnessFacetMatrix,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import type {
  HarnessApplyResult,
  HarnessPlan,
} from '../targets/harness-target.port';

/**
 * Health for a target that does not apply to this workspace (E17).
 *
 * The facet matrix is still reported. "Codex is not installed" and "Codex
 * cannot take project commands" are different facts, and a user deciding
 * whether installing Codex would fix a gap needs both.
 */
export function undetectedTargetHealth(
  target: HarnessTargetId,
  facets: HarnessFacetMatrix,
  durationMs: number,
): HarnessTargetHealth {
  return {
    target,
    detected: false,
    facets,
    expected: 0,
    found: 0,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs,
  };
}

/**
 * Health for a plan that has NOT been applied — `verify()` and the preflight
 * fast path.
 *
 * Every desired entry the plan intends to write is `missing`, because a write
 * is planned exactly when the artifact is absent or stale; every desired entry
 * the plan is BLOCKED on is missing too, because a path occupied by somebody
 * else's file carries none of Ptah's content either. The blocked set is also
 * still `foreign`, and reporting it in both places is the point: `foreign`
 * answers "why", `missing` answers "is the harness whole".
 */
export function plannedTargetHealth(
  plan: HarnessPlan,
  facets: HarnessFacetMatrix,
  detected: boolean,
  durationMs: number,
): HarnessTargetHealth {
  return {
    target: plan.target,
    detected,
    facets,
    expected: plan.expected,
    found: plan.unchanged,
    missing: [...plan.writes.map((write) => write.relPath), ...plan.blocked],
    foreign: [...plan.foreign],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    adopted: [...plan.adopted],
    durationMs,
  };
}

/**
 * Health for a completed apply.
 *
 * `found` counts entries that were already correct plus entries written
 * successfully. `missing` is the set that failed to write PLUS the set the plan
 * refused to write because an unowned file occupies the path — the same
 * definition `plannedTargetHealth` uses, so a `reconcile` and the `verify` that
 * follows it report the same numbers over an unchanged tree.
 *
 * Leaving `blocked` out was the original defect: an apply that wrote nothing
 * because every desired path was occupied reported `missing: 0` and read as a
 * clean pass, while the next `verify` over the identical tree reported all of
 * them as gaps.
 */
export function appliedTargetHealth(
  plan: HarnessPlan,
  facets: HarnessFacetMatrix,
  result: HarnessApplyResult,
  durationMs: number,
): HarnessTargetHealth {
  const failedPaths = new Set(result.writeFailed.map((f) => f.relPath));
  const missing = plan.writes
    .map((w) => w.relPath)
    .filter((relPath) => failedPaths.has(relPath));

  return {
    target: plan.target,
    detected: true,
    facets,
    expected: plan.expected,
    found: plan.unchanged + Object.keys(result.written).length,
    missing: [...missing, ...plan.blocked],
    foreign: [...plan.foreign],
    writeFailed: [...result.writeFailed],
    overwrittenLocalEdit: [...result.overwrittenLocalEdit],
    removed: [...result.removed],
    adopted: [...plan.adopted],
    durationMs,
  };
}

/**
 * `blockedTargetPaths` — the `missing ∩ foreign` derivation — deliberately does
 * NOT live here. It is in `@ptah-extension/shared` beside
 * `summarizeHarnessHealth`, because the webview health card reads it too and a
 * frontend lib cannot import this one. Two consumers, one rule, one place.
 */
