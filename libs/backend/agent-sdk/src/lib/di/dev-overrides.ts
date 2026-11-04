import type { Logger } from '@ptah-extension/vscode-core';

export interface DevOverrides {
  readonly idleCacheTtlMs?: number;
  readonly idleMinTokens?: number;
  readonly sessionBudgetTokens?: number;
}

function bounded(raw: string | undefined, max: number): number | undefined {
  if (raw === undefined || !/^[1-9]\d*$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : undefined;
}

/** The host explicitly decides whether overrides are allowed. */
export function readDevOverrides(
  devHost: boolean,
  env: NodeJS.ProcessEnv,
  logger: Pick<Logger, 'warn'>,
): DevOverrides {
  if (!devHost) return {};
  const values: DevOverrides = {
    idleCacheTtlMs: bounded(env['PTAH_DEV_IDLE_CACHE_TTL_MS'], 3_600_000),
    idleMinTokens: bounded(env['PTAH_DEV_IDLE_MIN_TOKENS'], 2_000_000_000),
    sessionBudgetTokens: bounded(env['PTAH_DEV_SESSION_BUDGET_TOKENS'], 2_000_000_000),
  };
  if (Object.values(values).some((value) => value !== undefined)) {
    logger.warn('[AgentSDK] Development overrides active', values);
  }
  return values;
}
