/**
 * The status line is *derived*, never tracked.
 *
 * The bar used to read its session label from a `sessions` array that is
 * fetched once at mount, so a session created during the run was never in it
 * and the label fell through to "No session" — while the same bar rendered the
 * accrued cost of the conversation two fields to the right. Deriving every
 * field from one input in one pure function is what makes that contradiction
 * unrepresentable, and the spec pins it.
 *
 * Ink-free on purpose so it is unit-testable.
 */

export interface StatusLineStats {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUSD: number;
  readonly contextUsagePercent: number;
  readonly model?: string | null;
}

export interface StatusLineInput {
  readonly activeSessionId: string | null;
  readonly sessionName?: string | null;
  /** True as soon as the transcript holds a single turn. */
  readonly hasConversation: boolean;
  readonly isStreaming: boolean;
  readonly fallbackModel?: string | null;
  readonly stats?: StatusLineStats | null;
  readonly mode: 'plan' | 'build';
  /** Milliseconds since the current turn started; null when idle. */
  readonly elapsedMs?: number | null;
}

export type Tone = 'ok' | 'warn' | 'error' | 'idle';

export interface StatusLineModel {
  readonly session: { readonly label: string; readonly active: boolean };
  readonly model: string | null;
  readonly tokens: string | null;
  readonly cost: { readonly label: string; readonly tone: Tone } | null;
  readonly context: {
    readonly percent: number;
    readonly tone: Tone;
    readonly full: boolean;
  } | null;
  readonly activity: {
    readonly label: string;
    readonly elapsed: string | null;
  } | null;
  readonly mode: { readonly label: string; readonly plan: boolean };
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * A conversation always has a session, even before the backend has told us its
 * id. "No session" is reserved for the genuine cold-start state.
 */
function deriveSessionLabel(input: StatusLineInput): {
  label: string;
  active: boolean;
} {
  if (input.sessionName !== undefined && input.sessionName !== null) {
    const trimmed = input.sessionName.trim();
    if (trimmed.length > 0) return { label: trimmed, active: true };
  }
  if (input.activeSessionId !== null && input.activeSessionId.length > 0) {
    return {
      label: `Session ${input.activeSessionId.slice(0, 8)}`,
      active: true,
    };
  }
  if (input.hasConversation || input.isStreaming) {
    return { label: 'New session', active: true };
  }
  return { label: 'No session', active: false };
}

export function deriveStatusLine(input: StatusLineInput): StatusLineModel {
  const stats = input.stats ?? null;

  const model = stats?.model ?? input.fallbackModel ?? null;

  const tokens =
    stats !== null && (stats.inputTokens > 0 || stats.outputTokens > 0)
      ? `${formatTokenCount(stats.inputTokens)}/${formatTokenCount(stats.outputTokens)}`
      : null;

  const costValue = stats?.costUSD ?? 0;
  const cost =
    stats !== null && costValue > 0
      ? {
          label: formatCost(costValue),
          tone: (costValue > 5
            ? 'error'
            : costValue >= 1
              ? 'warn'
              : 'ok') as Tone,
        }
      : null;

  const percent = stats?.contextUsagePercent ?? 0;
  const context =
    percent > 0
      ? {
          percent,
          tone: (percent > 80
            ? 'error'
            : percent >= 60
              ? 'warn'
              : 'ok') as Tone,
          full: percent > 90,
        }
      : null;

  const activity = input.isStreaming
    ? {
        label: 'working',
        elapsed:
          input.elapsedMs !== undefined && input.elapsedMs !== null
            ? formatElapsed(input.elapsedMs)
            : null,
      }
    : null;

  return {
    session: deriveSessionLabel(input),
    model: model !== null && model.length > 0 ? model : null,
    tokens,
    cost,
    context,
    activity,
    mode: {
      label: input.mode === 'plan' ? 'plan' : 'build',
      plan: input.mode === 'plan',
    },
  };
}
