/**
 * Session budget contracts (TASK_2026_597 N7, decision 13).
 *
 * One session's spend measured against a configured limit, staged as
 * `normal → tighten → handoff → limit`. The backend stage machine
 * (`SessionBudgetService`, agent-sdk) owns the state; the chat chip, the
 * budget banner and the settings card only render it. These types and the
 * bounds table below are the single source both sides read.
 *
 * Plain types and literals only: this file is exported from the zod-free
 * shared barrel.
 */

/** Budget stage, ordered from lowest to highest. `unknown` = no figure yet. */
export type SessionBudgetStage =
  'unknown' | 'normal' | 'tighten' | 'handoff' | 'limit';

/** The unit the user budgets in (`sessionBudget.unit`). */
export type SessionBudgetUnit = 'tokens' | 'cost';

/**
 * What `used` actually measures.
 * - `tokens`: the displayed session token count.
 * - `cost`: the session's full USD total.
 * - `cost-lower-bound`: the priced part of a partially priced session (render
 *   as `≥ $x`).
 * - `weighted-fallback`: no price at all; a weighted token estimate measured
 *   against `fallbackWeightedTokens` instead of the USD limit.
 */
export type SessionBudgetMeasure =
  'tokens' | 'cost' | 'cost-lower-bound' | 'weighted-fallback';

/**
 * Why a per-session auto-compact window was not applied as requested.
 * - `disabled`: `tightenWindowTokens` is unset (advisory only).
 * - `env-override`: an environment variable already pins the window.
 * - `already-lower`: the runtime threshold is already at or below the target.
 * - `not-honoured`: the read-back showed the runtime ignored the window.
 * - `failed`: the apply or the read-back threw or timed out.
 */
export type SessionBudgetWindowReason =
  'disabled' | 'env-override' | 'already-lower' | 'not-honoured' | 'failed';

/** The per-session auto-compact window override entered at `tighten`. */
export interface SessionBudgetWindow {
  /** Requested window in tokens. */
  readonly target: number;
  /** True when the runtime confirmed the window on read-back. */
  readonly applied: boolean;
  /** Present when `applied` is false. */
  readonly reason?: SessionBudgetWindowReason;
}

/** The latest deterministic handoff written for the session. */
export interface SessionBudgetHandoff {
  /** Absolute file path under `~/.ptah/handoffs/`; `null` when the write failed. */
  readonly path: string | null;
  /** Length of the handoff text in characters. */
  readonly chars: number;
  /** True when a section cap cut content. */
  readonly truncated: boolean;
  /** Epoch milliseconds of the build. */
  readonly writtenAt: number;
  /** Write failure message; the content is still kept in memory. */
  readonly writeError?: string;
}

/**
 * The session-rotation advisory (TASK_2026_597 A6): the session's context has
 * reached `compaction.rotationSuggestTokens`. Present from the upward crossing
 * until the context drops below the threshold again (for example after a
 * compaction). It is independent of the budget stage and is published even
 * while `sessionBudget.enabled` is off.
 */
export interface SessionBudgetRotation {
  /** The context size the advisory was raised on, in tokens. */
  readonly contextTokens: number;
  /** The `compaction.rotationSuggestTokens` value that was crossed. */
  readonly threshold: number;
}

/**
 * One session's budget state, published beside its stats snapshot.
 * Keyed by the real SDK session id, never a tab or tracking id.
 */
export interface SessionBudgetState {
  readonly sessionId: string;
  readonly stage: SessionBudgetStage;
  readonly unit: SessionBudgetUnit;
  readonly measure: SessionBudgetMeasure;
  /** Measured amount in the measure's unit; `null` when no figure exists. */
  readonly used: number | null;
  /** Effective limit in the measure's unit, extensions included. */
  readonly limit: number;
  /** `used / limit × 100`; `null` when `used` is `null`. */
  readonly percent: number | null;
  /** True when `used` is a lower bound of the real figure. */
  readonly lowerBound: boolean;
  /** Revision of the stats snapshot this state was computed from. */
  readonly revision: number | null;
  /** Main-loop compactions seen since the session (or the process) started. */
  readonly compactions: number;
  /** Times the user allowed 20% more at the limit. */
  readonly extensions: number;
  readonly window?: SessionBudgetWindow;
  readonly handoff?: SessionBudgetHandoff;
  /** True when sends are refused (`limit` with `blockAtLimit`). */
  readonly blocked: boolean;
  /** The stage whose banner the user dismissed; it reappears on a higher stage. */
  readonly dismissedStage?: SessionBudgetStage;
  /** Present while the session-rotation advisory is in force. */
  readonly rotation?: SessionBudgetRotation;
}

/** The validated settings the backend reader returns. */
export interface SessionBudgetConfig {
  readonly enabled: boolean;
  readonly unit: SessionBudgetUnit;
  /** Token limit for unit `tokens`. */
  readonly tokens: number;
  /** USD limit for unit `cost`. */
  readonly usd: number;
  /** Weighted-token limit used when no model in the session is priced. */
  readonly fallbackWeightedTokens: number;
  /** Percent of the limit that enters `tighten`; always below `handoffPercent`. */
  readonly tightenPercent: number;
  /** Percent of the limit that enters `handoff`. */
  readonly handoffPercent: number;
  /** Compaction count that enters `handoff` regardless of percent. */
  readonly handoffAfterCompactions: number;
  /** Auto-compact window applied at `tighten`; `null` = advisory only. */
  readonly tightenWindowTokens: number | null;
  /** Refuse sends at `limit` until the user acts. */
  readonly blockAtLimit: boolean;
}

/** A numeric setting; `integer` settings reject fractions. */
export interface SessionBudgetNumberSetting {
  readonly key: string;
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  /** True when `null` is a valid value (outside the min/max check). */
  readonly nullable: boolean;
  readonly default: number | null;
}

export interface SessionBudgetBooleanSetting {
  readonly key: string;
  readonly kind: 'boolean';
  readonly default: boolean;
}

export interface SessionBudgetEnumSetting {
  readonly key: string;
  readonly kind: 'enum';
  readonly values: readonly SessionBudgetUnit[];
  readonly default: SessionBudgetUnit;
}

/**
 * Settings keys, bounds and defaults for `sessionBudget.*` (file-based,
 * `~/.ptah/settings.json`). The backend reader treats any value outside these
 * bounds, of the wrong type, or breaking the tighten < handoff rule as the
 * default; the settings card validates inline against the same table.
 */
export const SESSION_BUDGET_SETTINGS = {
  enabled: {
    key: 'sessionBudget.enabled',
    kind: 'boolean',
    default: true,
  },
  unit: {
    key: 'sessionBudget.unit',
    kind: 'enum',
    values: ['tokens', 'cost'],
    default: 'tokens',
  },
  tokens: {
    key: 'sessionBudget.tokens',
    kind: 'number',
    min: 1_000_000,
    max: 2_000_000_000,
    integer: true,
    nullable: false,
    default: 50_000_000,
  },
  usd: {
    key: 'sessionBudget.usd',
    kind: 'number',
    min: 0.5,
    max: 10_000,
    integer: false,
    nullable: false,
    default: 30,
  },
  fallbackWeightedTokens: {
    key: 'sessionBudget.fallbackWeightedTokens',
    kind: 'number',
    min: 100_000,
    max: 500_000_000,
    integer: true,
    nullable: false,
    default: 9_000_000,
  },
  tightenPercent: {
    key: 'sessionBudget.tightenPercent',
    kind: 'number',
    min: 10,
    max: 95,
    integer: true,
    nullable: false,
    default: 50,
  },
  handoffPercent: {
    key: 'sessionBudget.handoffPercent',
    kind: 'number',
    min: 20,
    max: 99,
    integer: true,
    nullable: false,
    default: 80,
  },
  handoffAfterCompactions: {
    key: 'sessionBudget.handoffAfterCompactions',
    kind: 'number',
    min: 1,
    max: 20,
    integer: true,
    nullable: false,
    default: 3,
  },
  tightenWindowTokens: {
    key: 'sessionBudget.tightenWindowTokens',
    kind: 'number',
    min: 100_000,
    max: 1_000_000,
    integer: true,
    nullable: true,
    default: null,
  },
  blockAtLimit: {
    key: 'sessionBudget.blockAtLimit',
    kind: 'boolean',
    default: true,
  },
} as const satisfies {
  readonly [
    K in keyof SessionBudgetConfig
  ]: SessionBudgetConfig[K] extends boolean
    ? SessionBudgetBooleanSetting
    : SessionBudgetConfig[K] extends SessionBudgetUnit
      ? SessionBudgetEnumSetting
      : SessionBudgetNumberSetting;
};

/**
 * Cross-field rule: the tighten band must start below the handoff band.
 * A pair that breaks it is read as the two defaults.
 */
export function isSessionBudgetPercentOrderValid(
  tightenPercent: number,
  handoffPercent: number,
): boolean {
  return tightenPercent < handoffPercent;
}

/** User actions on a session's budget (banner buttons). */
export type SessionBudgetAction =
  'dismiss' | 'extend' | 'restore-window' | 'write-handoff' | 'preview-handoff';

export interface SessionBudgetActionParams {
  readonly sessionId: string;
  readonly action: SessionBudgetAction;
}

export interface SessionBudgetActionResult {
  readonly success: boolean;
  /** The session's state after the action. */
  readonly state?: SessionBudgetState;
  /** Present for `write-handoff` and `preview-handoff`. */
  readonly handoff?: {
    /** The handoff document text. */
    readonly content: string;
    /** Written file path; `null` when only the in-memory copy exists. */
    readonly path: string | null;
    /**
     * The backend-built first prompt for "Continue in new session" (at most
     * 8,200 characters). The webview sends it as-is and never assembles it.
     */
    readonly seed: string;
  };
  /** Failure text; `'unavailable'` when the host has no budget service. */
  readonly error?: string;
}
