/**
 * Subagent prompt-cache TTL resolution.
 *
 * Combines the `agentOrchestration.subagentPromptCacheTtl` setting with the
 * host's `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` env var. The env var, when it
 * holds a valid TTL, wins inside the SDK; the value Ptah passes (`sdkValue`)
 * still follows the setting so clearing the env var restores it.
 */

import type {
  SubagentPromptCacheTtl,
  SubagentPromptCacheTtlEnvOverride,
} from '../types/rpc/rpc-agents.types';

export interface SubagentPromptCacheTtlInput {
  /** Raw setting value. Anything other than `'5m'` / `'1h'` is treated as `'auto'`. */
  readonly setting: unknown;
  /** Raw value of the host env var; `undefined` or blank means unset. */
  readonly envValue: string | undefined;
  /** Whether the session can spawn subagents (the `'auto'` gate). */
  readonly canSpawnSubagents: boolean;
}

export interface SubagentPromptCacheTtlResolution {
  /** TTL Ptah passes to the SDK; `undefined` leaves it unset (SDK default). */
  readonly sdkValue: SubagentPromptCacheTtl | undefined;
  /** TTL the SDK ends up using. */
  readonly effective: SubagentPromptCacheTtl;
  /** What decided `effective`. */
  readonly source: 'env' | 'setting' | 'auto' | 'sdk-default';
  /** Present only when the env var is set. */
  readonly envOverride?: SubagentPromptCacheTtlEnvOverride;
}

/** TTL the SDK uses when nothing sets one. */
const SDK_DEFAULT_TTL: SubagentPromptCacheTtl = '5m';

function asTtl(value: unknown): SubagentPromptCacheTtl | undefined {
  return value === '5m' || value === '1h' ? value : undefined;
}

export function resolveSubagentPromptCacheTtl(
  input: SubagentPromptCacheTtlInput,
): SubagentPromptCacheTtlResolution {
  const { setting, envValue, canSpawnSubagents } = input;

  const explicit = asTtl(setting);
  const sdkValue: SubagentPromptCacheTtl | undefined =
    explicit ?? (canSpawnSubagents ? '1h' : undefined);
  const settingSource: SubagentPromptCacheTtlResolution['source'] = explicit
    ? 'setting'
    : canSpawnSubagents
      ? 'auto'
      : 'sdk-default';

  const envSet = envValue !== undefined && envValue.trim() !== '';
  if (!envSet) {
    return {
      sdkValue,
      effective: sdkValue ?? SDK_DEFAULT_TTL,
      source: settingSource,
    };
  }

  const envTtl = asTtl(envValue);
  if (envTtl) {
    return { sdkValue, effective: envTtl, source: 'env', envOverride: envTtl };
  }
  return {
    sdkValue,
    effective: sdkValue ?? SDK_DEFAULT_TTL,
    source: settingSource,
    envOverride: 'invalid',
  };
}
