/**
 * Codex lane budgets as a lane may use them (TASK_2026_597, R4.1, R4.2, R4.4).
 *
 * The settings import path writes values without validation, so a settings
 * file can hold any JSON for `agentOrchestration.codexAutoCompactTokens`,
 * `agentOrchestration.codexToolOutputTokenLimit` or
 * `agentOrchestration.codexWebSearch`. The lane applies the same rule as
 * `agent:setConfig` / `agent:getConfig` (rpc-handlers `agent-rpc.handlers.ts`,
 * `isNonNegativeInteger`) so the UI and the lane never disagree:
 *
 * - a token budget is a safe integer >= 0 (`-0` counts as 0, which leaves
 *   Codex's own runtime default in place);
 * - web search is a boolean;
 * - anything else is replaced by the default, with one warning naming the key.
 *
 * An absent value is "not set" and takes the default silently.
 */

import type { CliLaneBudgets } from '../cli-adapter.interface';

/** Same values as `FILE_BASED_SETTINGS_DEFAULTS` (pinned by the spec). */
export const CODEX_DEFAULT_LANE_BUDGETS: CliLaneBudgets = {
  autoCompactTokens: 120000,
  toolOutputTokenLimit: 2500,
  webSearch: true,
};

/** Raw budget values, as read from settings or passed by a caller. */
export interface RawCodexLaneBudgets {
  readonly autoCompactTokens?: unknown;
  readonly toolOutputTokenLimit?: unknown;
  readonly webSearch?: unknown;
}

export interface ResolvedCodexLaneBudgets {
  readonly budgets: CliLaneBudgets;
  /** One line per invalid value; names the setting key. Never secrets. */
  readonly warnings: string[];
}

export function resolveCodexLaneBudgets(
  raw: RawCodexLaneBudgets | undefined,
): ResolvedCodexLaneBudgets {
  const warnings: string[] = [];
  const defaults = CODEX_DEFAULT_LANE_BUDGETS;
  return {
    budgets: {
      autoCompactTokens: tokenBudget(
        'agentOrchestration.codexAutoCompactTokens',
        raw?.autoCompactTokens,
        defaults.autoCompactTokens,
        warnings,
      ),
      toolOutputTokenLimit: tokenBudget(
        'agentOrchestration.codexToolOutputTokenLimit',
        raw?.toolOutputTokenLimit,
        defaults.toolOutputTokenLimit,
        warnings,
      ),
      webSearch: webSearch(raw?.webSearch, defaults.webSearch, warnings),
    },
    warnings,
  };
}

function tokenBudget(
  key: string,
  value: unknown,
  fallback: number,
  warnings: string[],
): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    // `-0` passes both checks; normalise it so no `-0` reaches a log or argv.
    return value === 0 ? 0 : value;
  }
  warnings.push(
    `Ignored ${key}=${describe(value)}: expected a whole number of 0 or more; using ${fallback}.`,
  );
  return fallback;
}

function webSearch(
  value: unknown,
  fallback: boolean,
  warnings: string[],
): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  warnings.push(
    `Ignored agentOrchestration.codexWebSearch=${describe(value)}: expected true or false; using ${String(fallback)}.`,
  );
  return fallback;
}

/** A short, bounded rendering of an invalid value for the log. */
function describe(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? JSON.stringify(value) : String(value);
  } catch {
    // degradation-audit: optional-capability - a value whose String()
    // throws (a hostile toString) is only described, never used.
    text = typeof value;
  }
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
