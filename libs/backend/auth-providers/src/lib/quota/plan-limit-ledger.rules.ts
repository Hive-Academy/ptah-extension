/**
 * Plan-limit ledger rules (TASK_2026_596, Decision 4).
 *
 * The pure half of `PlanLimitLedgerService`: allowance identity, precedence
 * stamps for the shared `supersedes`, the clearing rules for successes and
 * full-table reads, expiry, and the mapping of a Claude stream window. No
 * clock, no I/O: every function takes `now` from the ledger.
 */
import {
  activeEstimatedExhaustion,
  activeWindowExhaustion,
  usedPercent,
  windowModelScope,
  windowObservedAt,
  type OwnerLimitEvidence,
  type PlanLimitCooldown,
  type PlanLimitEvidenceStamp,
  type PlanLimitWindow,
  type PlanWindowKey,
  type PlanWindowKind,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { ClaudePlanLimitEvidence } from '@ptah-extension/agent-sdk';

type ClaudeWindowEvidence = Extract<
  ClaudePlanLimitEvidence,
  { kind: 'window' }
>;

const DAY_MS = 86_400_000;
const DEFAULT_LONGEST_WINDOW_MS = 7 * DAY_MS;
const OPENCODE_LONGEST_WINDOW_MS = 30 * DAY_MS;
const WEEKLY_MODEL_PREFIX = 'weekly_model:';
export const ALL_MODELS = '';

export interface WindowEntry {
  readonly window: PlanLimitWindow;
  readonly stale: boolean;
}

export interface OwnerState {
  readonly owner: QuotaOwnerRef;
  /** Keyed by allowance id (window key + model scope). */
  readonly windows: Map<string, WindowEntry>;
  /** Keyed by model scope; {@link ALL_MODELS} for evidence covering every model. */
  readonly ownerEvidence: Map<string, OwnerLimitEvidence>;
  cooldown?: PlanLimitCooldown;
}

export function normaliseScope(scope: string | undefined): string | undefined {
  const trimmed = scope?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function allowanceId(window: {
  readonly key: PlanWindowKey;
  readonly modelScope?: string;
}): string {
  return `${window.key}|${windowModelScope(window) ?? ALL_MODELS}`;
}

export function windowStamp(entry: WindowEntry): PlanLimitEvidenceStamp {
  const { window } = entry;
  const exhaustion = window.exhaustion;
  return {
    observedAt: Math.max(
      window.observedAt,
      exhaustion?.observedAt ?? Number.NEGATIVE_INFINITY,
    ),
    source:
      exhaustion?.source ??
      window.usedSource ??
      window.resetSource ??
      'provider-api',
    stale: entry.stale,
    exhausted: exhaustion !== undefined,
  };
}

export function evidenceStamp(
  evidence: OwnerLimitEvidence,
): PlanLimitEvidenceStamp {
  return {
    observedAt: evidence.observedAt,
    source: evidence.source,
    exhausted: true,
  };
}

/**
 * The window's exhaustion as the engine sees it at `now` (its effective reset
 * included), estimated or not; `undefined` once expired.
 */
export function heldExhaustion(
  window: PlanLimitWindow,
  now: number,
): OwnerLimitEvidence | undefined {
  return (
    activeWindowExhaustion(window, now) ??
    activeEstimatedExhaustion(window, now)
  );
}

/** `next`'s window, keeping a held exhaustion the reading does not clear. */
export function carryExhaustion(
  prev: WindowEntry | undefined,
  next: WindowEntry,
  now: number,
): PlanLimitWindow {
  if (!prev || next.window.exhaustion !== undefined) return next.window;
  const held = heldExhaustion(prev.window, now);
  if (!held || readingClears(next, held)) return next.window;
  return { ...next.window, exhaustion: held };
}

/**
 * Decision 4: a full-table reading clears unknown-reset exhaustion of the
 * same allowance when it is fresh, not estimated, below the limit, and
 * observed after the exhaustion.
 */
function readingClears(next: WindowEntry, held: OwnerLimitEvidence): boolean {
  if (held.resetsAt !== undefined || next.stale) return false;
  if (next.window.usedSource === 'estimated') return false;
  const percent = usedPercent(next.window.used);
  return (
    percent !== undefined &&
    percent < 100 &&
    windowObservedAt(next.window) > held.observedAt
  );
}

function isPlanClearedWindow(
  window: PlanLimitWindow,
  scopes: ReadonlySet<string>,
): boolean {
  if (window.key === 'five_hour' || window.key === 'weekly') return true;
  if (!window.key.startsWith(WEEKLY_MODEL_PREFIX)) return false;
  const scope = windowModelScope(window);
  return scope !== undefined && scopes.has(scope);
}

export function clearUnknownResetEvidence(
  state: OwnerState,
  scopes: ReadonlySet<string>,
  successAt: number,
  now: number,
): boolean {
  let changed = false;
  for (const [id, entry] of [...state.windows]) {
    if (!isPlanClearedWindow(entry.window, scopes)) continue;
    const held = heldExhaustion(entry.window, now);
    if (!held || held.resetsAt !== undefined || held.observedAt > successAt) {
      continue;
    }
    const { exhaustion: _cleared, ...window } = entry.window;
    state.windows.set(id, { window, stale: entry.stale });
    changed = true;
  }
  for (const [scope, evidence] of [...state.ownerEvidence]) {
    const applies = scope === ALL_MODELS || scopes.has(scope);
    if (
      applies &&
      evidence.resetsAt === undefined &&
      evidence.observedAt <= successAt
    ) {
      state.ownerEvidence.delete(scope);
      changed = true;
    }
  }
  return changed;
}

/**
 * Decision 4: `opencode` 30 d; `openai-codex` its largest declared window,
 * else 7 d; every other provider 7 d.
 */
export function longestWindowMs(state: OwnerState): number {
  const providerId = state.owner.providerId;
  if (providerId === 'opencode' || providerId.startsWith('opencode-')) {
    return OPENCODE_LONGEST_WINDOW_MS;
  }
  if (providerId === 'openai-codex') {
    let largest = 0;
    for (const { window } of state.windows.values()) {
      const minutes = window.durationMins;
      if (
        minutes !== undefined &&
        Number.isFinite(minutes) &&
        minutes > largest
      ) {
        largest = minutes;
      }
    }
    if (largest > 0) return largest * 60_000;
  }
  return DEFAULT_LONGEST_WINDOW_MS;
}

export function withoutExpiredExhaustion(
  window: PlanLimitWindow,
  now: number,
  longestMs: number,
): PlanLimitWindow {
  if (window.exhaustion === undefined) return window;
  const held = heldExhaustion(window, now);
  const lapsed =
    held === undefined ||
    (held.resetsAt === undefined && now - held.observedAt >= longestMs);
  if (!lapsed) return window;
  const { exhaustion: _expired, ...rest } = window;
  return rest;
}

export function windowExpired(
  window: PlanLimitWindow,
  now: number,
  longestMs: number,
): boolean {
  return window.resetsAt !== undefined
    ? window.resetsAt <= now
    : now - windowObservedAt(window) >= longestMs;
}

export function evidenceExpired(
  evidence: OwnerLimitEvidence,
  now: number,
  longestMs: number,
): boolean {
  return evidence.resetsAt !== undefined
    ? evidence.resetsAt <= now
    : now - evidence.observedAt >= longestMs;
}

/** A cooldown lasts until the later of the gate and the provider's own deadline. */
export function cooldownEnd(cooldown: PlanLimitCooldown): number {
  return Math.max(cooldown.until, cooldown.rawUntil ?? cooldown.until);
}

const FIXED_WINDOW_LABELS: Readonly<Record<string, string>> = {
  five_hour: '5-hour session',
  weekly: 'Weekly',
  monthly: 'Monthly',
  overage: 'Overage',
};

function windowKindOf(key: PlanWindowKey): PlanWindowKind {
  switch (key) {
    case 'five_hour':
    case 'weekly':
    case 'monthly':
    case 'overage':
      return key;
    default:
      return key.startsWith(WEEKLY_MODEL_PREFIX) ? 'weekly_model' : 'other';
  }
}

function windowLabel(key: PlanWindowKey, modelScope?: string): string {
  const fixed = FIXED_WINDOW_LABELS[key];
  if (fixed) return fixed;
  if (!key.startsWith(WEEKLY_MODEL_PREFIX)) return 'Other';
  const scope = modelScope ?? key.slice(WEEKLY_MODEL_PREFIX.length);
  return `Weekly · ${scope.charAt(0).toUpperCase()}${scope.slice(1)}`;
}

/** A Claude `rate_limit_event` as a window; a rejected one carries exhaustion. */
export function windowFromClaudeEvidence(
  evidence: ClaudeWindowEvidence,
): PlanLimitWindow {
  const reset =
    evidence.resetsAt !== undefined
      ? { resetsAt: evidence.resetsAt, resetSource: evidence.source }
      : {};
  const scope =
    evidence.modelScope !== undefined
      ? { modelScope: evidence.modelScope }
      : {};
  return {
    key: evidence.windowKey,
    kind: windowKindOf(evidence.windowKey),
    label: windowLabel(evidence.windowKey, evidence.modelScope),
    ...scope,
    ...reset,
    ...(evidence.exhausted && {
      exhaustion: {
        observedAt: evidence.observedAt,
        source: evidence.source,
        ...reset,
        ...scope,
      },
    }),
    observedAt: evidence.observedAt,
  };
}
