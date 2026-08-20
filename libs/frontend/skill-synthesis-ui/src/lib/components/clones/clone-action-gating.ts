/**
 * Contextual action gating for Library clone cards.
 *
 * Pure, framework-free decision logic: given a {@link CloneSummary} and the
 * current wall clock, decide which actions may be OFFERED, which must be shown
 * DISABLED with an explanation, and what the card has to say about why.
 *
 * This exists as a standalone module (rather than as methods on the view) for
 * one reason: the rules are a correctness concern, not a presentation one. The
 * old Library table rendered the same four buttons on every row, so users could
 * press "Enhance now" on a skill with zero recorded invocations and "Rebase to
 * upstream" on a locally-authored agent that has no upstream at all — the
 * latter fails server-side with `Cannot resolve upstream source`. Deciding that
 * here makes it unit-testable without a DOM.
 *
 * UPSTREAM RULE. The backend resolves an upstream source directory from the
 * registry row's `originPluginId`
 * (`skills-synthesis-rpc.handlers.ts#resolveUpstreamSourceDir`); when that is
 * absent, `skillSynthesis:rebaseClone` throws. `originPluginId` is null exactly
 * when the entry was authored locally or synthesised from an accepted
 * recommendation (`skill-registry-catalog.service.ts#deriveStatus`: `clone`
 * requires `pluginId !== null`, `synth` requires `pluginId === null`). So
 * `authored` and `synth` entries can never be rebased and must never be offered
 * the action.
 */
import type { CloneSummary, SkillCloneStatus } from '@ptah-extension/shared';

/** Availability of one card action plus the reason when it is unavailable. */
export interface CloneActionState {
  readonly enabled: boolean;
  /** User-facing explanation, rendered as a tooltip. Null when enabled. */
  readonly reason: string | null;
}

/** Why auto-enhancement is or is not currently possible. */
export type CloneEnhanceEligibility = 'ready' | 'below-threshold' | 'cooldown';

/** The full contextual-action decision for one clone. */
export interface CloneActionModel {
  readonly enhance: CloneActionState;
  readonly revert: CloneActionState;
  /** Null when Rebase must NOT be rendered at all (no upstream / not diverged). */
  readonly rebase: CloneActionState | null;
  /** Null when Keep mine is not applicable (entry is not diverged). */
  readonly keep: CloneActionState | null;
  /**
   * Card-level sentence explaining why upstream reconciliation is impossible.
   * Null when the entry does have an upstream.
   */
  readonly upstreamNote: string | null;
  readonly eligibility: CloneEnhanceEligibility;
  /** Compact eligibility tag: `3/5 runs`, `cooldown 2h`, or `ready`. */
  readonly eligibilityLabel: string;
}

/**
 * The single sentence that has to be unmissable wherever "Keep mine" appears.
 *
 * Users pick this by accident because "Keep mine" reads like a merge choice.
 * It is not: no file content changes, the upstream edit is simply acknowledged
 * and never surfaced again.
 */
export const KEEP_MINE_EXPLANATION =
  'Keep mine changes no file content. It only marks this divergence resolved — ' +
  'your local copy stays exactly as it is, and you will not be notified about ' +
  'this upstream change again.';

/** What Rebase actually does, for the confirmation surface. */
export const REBASE_EXPLANATION =
  'Rebase replaces your local copy with the current upstream version. ' +
  'The pre-rebase body is snapshotted to history first, so it can be reverted.';

const NO_UPSTREAM_NOTE: Partial<Record<SkillCloneStatus, string>> = {
  authored:
    'Authored here — this entry has no upstream source, so there is nothing ' +
    'to rebase onto.',
  synth:
    'Created from an accepted recommendation — this entry has no upstream ' +
    'source, so there is nothing to rebase onto.',
};

/**
 * True when the entry was cloned from a plugin and therefore has an upstream
 * directory the backend can resolve.
 */
export function hasUpstreamSource(clone: CloneSummary): boolean {
  return clone.cloneStatus === 'clone' || clone.cloneStatus === 'diverged';
}

/** The status word shown on the card: divergence outranks the stored status. */
export function cloneStatusLabel(clone: CloneSummary): SkillCloneStatus {
  return clone.diverged ? 'diverged' : clone.cloneStatus;
}

/** Coarse duration for eligibility copy: minutes, then hours, then days. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Relative "x ago" for epoch-ms timestamps; `—` when never. */
export function formatRelative(epochMs: number | null): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '—';
  const deltaMs = Date.now() - epochMs;
  if (deltaMs < 0) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Render a `.history/` directory stamp (`20260101T093000`) as a readable local
 * date. Unrecognised stamps are passed through untouched rather than guessed
 * at — the timestamp is an opaque backend key, not a parsed contract.
 */
export function formatHistoryTimestamp(ts: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!match) return ts;
  const [, y, mo, d, h, mi] = match;
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/** Success rate as a percentage, or `—` when nothing has been recorded. */
export function formatSuccessRate(clone: CloneSummary): string | null {
  if (clone.invocationCount <= 0 || !Number.isFinite(clone.successRate)) {
    return null;
  }
  return `${Math.round(clone.successRate * 100)}%`;
}

function remainingCooldownMs(clone: CloneSummary, now: number): number {
  if (clone.enhanceCooldownUntil === null) return 0;
  return Math.max(0, clone.enhanceCooldownUntil - now);
}

/**
 * Decide every contextual action for one clone.
 *
 * @param clone the row model straight off `skillSynthesis:listClones`
 * @param now   epoch ms; injected so cooldown copy is deterministic in tests
 */
export function cloneActionModel(
  clone: CloneSummary,
  now: number = Date.now(),
): CloneActionModel {
  const belowThreshold = clone.invocationCount < clone.enhanceMinInvocations;
  const cooldownMs = remainingCooldownMs(clone, now);

  let eligibility: CloneEnhanceEligibility;
  let eligibilityLabel: string;
  let enhance: CloneActionState;

  if (belowThreshold) {
    eligibility = 'below-threshold';
    eligibilityLabel = `${clone.invocationCount}/${clone.enhanceMinInvocations} runs`;
    enhance = {
      enabled: false,
      reason:
        `Needs ${clone.enhanceMinInvocations} recorded runs before an ` +
        `enhancement can be proposed — this one has ${clone.invocationCount}. ` +
        'There is not enough usage evidence to improve it yet.',
    };
  } else if (cooldownMs > 0) {
    eligibility = 'cooldown';
    eligibilityLabel = `cooldown ${formatDuration(cooldownMs)}`;
    enhance = {
      enabled: false,
      reason: `Enhanced recently — available again in ${formatDuration(cooldownMs)}.`,
    };
  } else {
    eligibility = 'ready';
    eligibilityLabel = 'ready';
    enhance = { enabled: true, reason: null };
  }

  const revert: CloneActionState =
    clone.historyCount > 0
      ? { enabled: true, reason: null }
      : {
          enabled: false,
          reason:
            'No history snapshots yet — this entry has never been enhanced or ' +
            'rebased, so there is nothing to revert to.',
        };

  const upstream = hasUpstreamSource(clone);
  const upstreamNote = upstream
    ? null
    : (NO_UPSTREAM_NOTE[clone.cloneStatus] ??
      'This entry has no upstream source, so it cannot be rebased.');

  if (!clone.diverged) {
    return {
      enhance,
      revert,
      rebase: null,
      keep: null,
      upstreamNote: null,
      eligibility,
      eligibilityLabel,
    };
  }

  return {
    enhance,
    revert,
    // Offering a doomed Rebase is the bug — an entry with no upstream never
    // gets the button, only the explanation.
    rebase: upstream ? { enabled: true, reason: null } : null,
    keep: { enabled: true, reason: null },
    upstreamNote,
    eligibility,
    eligibilityLabel,
  };
}
