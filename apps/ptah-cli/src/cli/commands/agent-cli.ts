/**
 * `ptah agent-cli` command — agent CLI surface.
 *
 * Sub-commands per `task-description.md` §3 `agent-cli *` table:
 *
 *   detect                                          RPC `agent:detectClis`
 *                                                   emits `agent_cli.detection`
 *   config get                                      RPC `agent:getConfig`
 *                                                   emits `agent_cli.config`
 *   config set --key <k> --value <v>                RPC `agent:setConfig`
 *                                                   emits `agent_cli.config.updated`
 *   models list [--cli <id>]                        RPC `agent:listCliModels`
 *                                                   emits `agent_cli.models`
 *   stop <id> --cli <id>                            RPC `agent:stop`
 *                                                   emits `agent_cli.stopped`
 *   resume <id> --cli <id>                          RPC `agent:resumeCliSession`
 *                                                   emits `agent_cli.resumed`
 *
 * **Allowlist enforcement** (locked from architect section 3, user directive
 * 2026-04-25): every sub-subcommand that takes `--cli` validates the value
 * against the const+exhaustive switch `validateCliAgent`. The check is purely
 * on `opts.cli` — `process.env.PTAH_AGENT_CLI_OVERRIDE` is NEVER consulted.
 * Rejection emits `task.error` with `ptah_code: 'cli_agent_unavailable'` and
 * exits with `ExitCode.AuthRequired = 3`.
 *
 * Sub-subcommands gated by allowlist: `models list [--cli]` (optional),
 * `stop <id> --cli`, `resume <id> --cli`. NOT gated: `detect`, `config get`,
 * `config set` — these don't take `--cli`.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  AgentOrchestrationConfig,
  AgentSetConfigParams,
  AgentListCliModelsResult,
  CliDetectionResult,
  CliType,
} from '@ptah-extension/shared';

/**
 * Locked allowlist — only these CLI agent ids are permitted. NEVER bypassable
 * via env vars. Adding a new entry requires a separate, audited change.
 */
export const CLI_AGENT_ALLOWLIST = ['glm', 'gemini'] as const;
export type AllowlistedCli = (typeof CLI_AGENT_ALLOWLIST)[number];

export type AgentCliSubcommand =
  | 'detect'
  | 'config-get'
  | 'config-set'
  | 'models-list'
  | 'stop'
  | 'resume';

export interface AgentCliOptions {
  subcommand: AgentCliSubcommand;
  /** For `config set` — settings key. */
  key?: string;
  /** For `config set` — settings value (string; the command coerces booleans/numbers). */
  value?: string;
  /** For `models list [--cli]` (optional), `stop --cli`, `resume --cli`. */
  cli?: string;
  /** For `stop <id>`. */
  agentId?: string;
  /** For `resume <id>`. */
  cliSessionId?: string;
  /** For `resume` — optional task prompt. */
  task?: string;
}

export interface AgentCliStderrLike {
  write(chunk: string): boolean;
}

export interface AgentCliExecuteHooks {
  stderr?: AgentCliStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  hooks: AgentCliExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: AgentCliStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'detect':
        return await runDetect(globals, formatter, engine);
      case 'config-get':
        return await runConfigGet(globals, formatter, engine);
      case 'config-set':
        return await runConfigSet(opts, globals, formatter, stderr, engine);
      case 'models-list':
        return await runModelsList(opts, globals, formatter, engine);
      case 'stop':
        return await runStop(opts, globals, formatter, stderr, engine);
      case 'resume':
        return await runResume(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah agent-cli: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// Allowlist enforcement (locked).
// ---------------------------------------------------------------------------

/**
 * Returns the requested CLI id when it is in the allowlist, otherwise `null`.
 *
 * NEVER reads `process.env.PTAH_AGENT_CLI_OVERRIDE` or any other env var —
 * the allowlist is a hard contract. Tests verify rejection still happens
 * even when the override env var is set.
 */
export function validateCliAgent(
  cli: string | undefined,
): AllowlistedCli | null {
  if (!cli) return null;
  switch (cli) {
    case 'glm':
    case 'gemini':
      return cli;
    default:
      return null;
  }
}

/**
 * Emit a `task.error` notification carrying `ptah_code: 'cli_agent_unavailable'`.
 * Returns `ExitCode.AuthRequired` per spec §4.4 + verification spec line 408.
 */
async function emitCliAgentUnavailable(
  formatter: Formatter,
  requestedCli: string,
): Promise<number> {
  await formatter.writeNotification('task.error', {
    ptah_code: 'cli_agent_unavailable',
    message: `CLI agent '${requestedCli}' is not in the allowlist. Only 'glm' and 'gemini' are supported.`,
    data: {
      requested_cli: requestedCli,
      allowed: [...CLI_AGENT_ALLOWLIST],
    },
  });
  return ExitCode.AuthRequired;
}

// ---------------------------------------------------------------------------
// detect — RPC `agent:detectClis`
// ---------------------------------------------------------------------------

async function runDetect(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ clis: CliDetectionResult[] }>(
      ctx.transport,
      'agent:detectClis',
      undefined,
    );
    await formatter.writeNotification('agent_cli.detection', {
      clis: result?.clis ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// config get — RPC `agent:getConfig`
// ---------------------------------------------------------------------------

async function runConfigGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<AgentOrchestrationConfig>(
      ctx.transport,
      'agent:getConfig',
      undefined,
    );
    await formatter.writeNotification('agent_cli.config', {
      config: result,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// config set — RPC `agent:setConfig`
// ---------------------------------------------------------------------------

async function runConfigSet(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key || opts.key.trim().length === 0) {
    stderr.write('ptah agent-cli config set: --key is required\n');
    return ExitCode.UsageError;
  }
  if (opts.value === undefined) {
    stderr.write('ptah agent-cli config set: --value is required\n');
    return ExitCode.UsageError;
  }

  // Coerce string → typed value for the small set of known boolean/number
  // keys. Unknown keys pass through as strings; the backend handler will
  // ignore unknown keys silently.
  const params = buildSetConfigParams(opts.key, opts.value);

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'agent:setConfig',
      params,
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:setConfig failed');
    }
    await formatter.writeNotification('agent_cli.config.updated', {
      key: opts.key,
      value: params[opts.key as keyof AgentSetConfigParams],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// models list [--cli] — RPC `agent:listCliModels`
// ---------------------------------------------------------------------------

async function runModelsList(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  // Allowlist is OPTIONAL here — `--cli` is optional. Only enforce when set.
  let scoped: AllowlistedCli | null = null;
  if (opts.cli !== undefined) {
    scoped = validateCliAgent(opts.cli);
    if (scoped === null) {
      return await emitCliAgentUnavailable(formatter, opts.cli);
    }
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<AgentListCliModelsResult>(
      ctx.transport,
      'agent:listCliModels',
      undefined,
    );

    if (scoped === null) {
      // No --cli filter — return all curated lists.
      await formatter.writeNotification('agent_cli.models', {
        gemini: result?.gemini ?? [],
        codex: result?.codex ?? [],
        copilot: result?.copilot ?? [],
      });
      return ExitCode.Success;
    }

    // Scope to a single allowlisted CLI. `glm` is not present in the curated
    // `agent:listCliModels` payload (which carries gemini/codex/copilot),
    // so we emit an empty list for glm — the contract is preserved without
    // surfacing models from other providers.
    if (scoped === 'gemini') {
      await formatter.writeNotification('agent_cli.models', {
        cli: 'gemini',
        models: result?.gemini ?? [],
      });
    } else {
      await formatter.writeNotification('agent_cli.models', {
        cli: 'glm',
        models: [],
      });
    }
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// stop <id> --cli — RPC `agent:stop` (allowlist enforced)
// ---------------------------------------------------------------------------

async function runStop(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.agentId || opts.agentId.trim().length === 0) {
    stderr.write('ptah agent-cli stop: <id> is required\n');
    return ExitCode.UsageError;
  }
  const allowed = validateCliAgent(opts.cli);
  if (allowed === null) {
    return await emitCliAgentUnavailable(formatter, opts.cli ?? '');
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'agent:stop',
      { agentId: opts.agentId },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:stop failed');
    }
    await formatter.writeNotification('agent_cli.stopped', {
      agentId: opts.agentId,
      cli: allowed,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// resume <id> --cli — RPC `agent:resumeCliSession` (allowlist enforced)
// ---------------------------------------------------------------------------

async function runResume(
  opts: AgentCliOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: AgentCliStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.cliSessionId || opts.cliSessionId.trim().length === 0) {
    stderr.write('ptah agent-cli resume: <id> is required\n');
    return ExitCode.UsageError;
  }
  const allowed = validateCliAgent(opts.cli);
  if (allowed === null) {
    return await emitCliAgentUnavailable(formatter, opts.cli ?? '');
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      success: boolean;
      agentId?: string;
      error?: string;
    }>(ctx.transport, 'agent:resumeCliSession', {
      cliSessionId: opts.cliSessionId,
      cli: allowed as unknown as CliType,
      task: opts.task ?? '',
    });
    if (!result?.success) {
      throw new Error(result?.error ?? 'agent:resumeCliSession failed');
    }
    await formatter.writeNotification('agent_cli.resumed', {
      cliSessionId: opts.cliSessionId,
      cli: allowed,
      agentId: result.agentId,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

/**
 * Build the `AgentSetConfigParams` payload for a single key/value pair.
 *
 * Coerces:
 *   - `*AutoApprove` keys → boolean (true/false strings only).
 *   - `maxConcurrentAgents`, `mcpPort` → number.
 *   - `preferredAgentOrder`, `disabledClis`, `disabledMcpNamespaces` →
 *     CSV-split string array.
 *   - everything else (model ids, reasoning effort tiers) → string passthrough.
 */
function buildSetConfigParams(
  key: string,
  rawValue: string,
): AgentSetConfigParams {
  const params: AgentSetConfigParams = {};
  switch (key) {
    case 'codexAutoApprove':
    case 'copilotAutoApprove':
    case 'browserAllowLocalhost': {
      const v = rawValue.toLowerCase();
      params[
        key as
          | 'codexAutoApprove'
          | 'copilotAutoApprove'
          | 'browserAllowLocalhost'
      ] = v === 'true' || v === '1';
      break;
    }
    case 'maxConcurrentAgents':
    case 'mcpPort': {
      const n = Number.parseInt(rawValue, 10);
      if (Number.isFinite(n)) {
        params[key as 'maxConcurrentAgents' | 'mcpPort'] = n;
      }
      break;
    }
    case 'preferredAgentOrder':
    case 'disabledClis':
    case 'disabledMcpNamespaces': {
      params[
        key as 'preferredAgentOrder' | 'disabledClis' | 'disabledMcpNamespaces'
      ] = rawValue
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      break;
    }
    default:
      // Pass through as string for model/effort keys.
      (params as unknown as Record<string, string>)[key] = rawValue;
  }
  return params;
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
