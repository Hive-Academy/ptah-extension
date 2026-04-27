/**
 * `ptah provider` command — sub-dispatcher for status / set-key / remove-key /
 * default get / default set / models list / tier set / tier get / tier clear.
 *
 * TASK_2026_104 Batch 8d.
 *
 * Sub-commands (per task-description.md §3.1 lines 459-469):
 *
 *   status                        — Read-only. Calls `llm:getProviderStatus`,
 *                                    redacts API keys unless `--reveal`.
 *   set-key --provider --key      — Calls `llm:setApiKey`. Emits
 *                                    `provider.key.set` (key never echoed).
 *   remove-key --provider         — Calls `llm:removeApiKey`. Emits
 *                                    `provider.key.removed`.
 *   default get                   — Calls `llm:getDefaultProvider`. Emits
 *                                    `provider.default`.
 *   default set <id>              — Calls `llm:setDefaultProvider`. Emits
 *                                    `provider.default.updated`.
 *   models list [--provider]      — Calls `llm:listProviderModels`. Emits
 *                                    `provider.models`.
 *   tier set --model --tier       — Calls `provider:setModelTier`. Emits
 *                                    `provider.tier.updated`.
 *   tier get                      — Calls `provider:getModelTiers`. Emits
 *                                    `provider.tiers`.
 *   tier clear --model            — Calls `provider:clearModelTier`. Emits
 *                                    `provider.tier.cleared`.
 *
 * Every sub-command boots `withEngine({ mode: 'full' })` so the LLM and
 * provider RPC handlers are registered. No DI mocking in production code —
 * tests inject collaborators via `ProviderExecuteHooks`.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';

/** Sub-commands accepted by `ptah provider ...`. */
export type ProviderSubcommand =
  | 'status'
  | 'set-key'
  | 'remove-key'
  | 'default'
  | 'models'
  | 'tier';

/** Action argument for nested sub-commands (`default get/set`, `models list`, `tier set/get/clear`). */
export type ProviderAction = 'get' | 'set' | 'list' | 'clear';

/** Tier slot accepted by `provider:setModelTier` / `provider:clearModelTier`. */
export type ProviderTier = 'sonnet' | 'opus' | 'haiku' | string;

export interface ProviderOptions {
  subcommand: ProviderSubcommand;
  /** Action verb for nested sub-commands. */
  action?: ProviderAction;
  /** Provider id (for set-key, remove-key, default set, models list). */
  provider?: string;
  /** API key (for set-key — never logged or echoed back). */
  key?: string;
  /** Model id (for tier set --model, tier clear --model). */
  model?: string;
  /** Tier slot (for tier set --tier). */
  tier?: ProviderTier;
}

/** Stderr stream contract — narrowed for testability. */
export interface ProviderStderrLike {
  write(chunk: string): boolean;
}

/** Optional collaborators — tests inject; production omits. */
export interface ProviderExecuteHooks {
  /** Override the stderr sink. Defaults to `process.stderr`. */
  stderr?: ProviderStderrLike;
  /** Override the formatter. Defaults to one built from `globals`. */
  formatter?: Formatter;
  /** Override the engine bootstrapper. Tests pass a stub returning scripted ctx. */
  withEngine?: typeof withEngine;
}

/**
 * Execute the `ptah provider` command. Returns the process exit code.
 *
 * Each sub-command goes through `withEngine({ mode: 'full' })` so the full
 * RPC surface is registered. Validation (missing flags, unknown sub-commands)
 * resolves to `UsageError` (exit 2) before any DI bootstrap runs.
 */
export async function execute(
  opts: ProviderOptions,
  globals: GlobalOptions,
  hooks: ProviderExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: ProviderStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'status':
        return await runStatus(formatter, globals, engine);
      case 'set-key':
        return await runSetKey(opts, formatter, globals, stderr, engine);
      case 'remove-key':
        return await runRemoveKey(opts, formatter, globals, stderr, engine);
      case 'default':
        return await runDefault(opts, formatter, globals, stderr, engine);
      case 'models':
        return await runModels(opts, formatter, globals, stderr, engine);
      case 'tier':
        return await runTier(opts, formatter, globals, stderr, engine);
      default:
        stderr.write(
          `ptah provider: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// `provider status`
// ---------------------------------------------------------------------------

async function runStatus(
  formatter: Formatter,
  globals: GlobalOptions,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const status = await callRpc(
      ctx.transport,
      'llm:getProviderStatus',
      undefined,
    );
    const reveal = globals.reveal === true;
    await formatter.writeNotification(
      'provider.status',
      redact(status, { reveal }),
    );
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `provider set-key --provider --key`
// ---------------------------------------------------------------------------

async function runSetKey(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const provider = (opts.provider ?? '').trim();
  const apiKey = opts.key ?? '';
  if (!provider) {
    stderr.write('ptah provider set-key: --provider is required\n');
    return ExitCode.UsageError;
  }
  if (!apiKey) {
    stderr.write('ptah provider set-key: --key is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'llm:setApiKey',
      { provider, apiKey },
    );
    if (!result.success) {
      await formatter.writeNotification('task.error', {
        provider,
        ptah_code: 'internal_failure',
        message: result.error ?? 'llm:setApiKey returned success=false',
      });
      return ExitCode.InternalFailure;
    }
    // SECURITY: never echo the api key back — only the provider name.
    await formatter.writeNotification('provider.key.set', {
      provider,
      success: true,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `provider remove-key --provider`
// ---------------------------------------------------------------------------

async function runRemoveKey(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const provider = (opts.provider ?? '').trim();
  if (!provider) {
    stderr.write('ptah provider remove-key: --provider is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'llm:removeApiKey',
      { provider },
    );
    if (!result.success) {
      await formatter.writeNotification('task.error', {
        provider,
        ptah_code: 'internal_failure',
        message: result.error ?? 'llm:removeApiKey returned success=false',
      });
      return ExitCode.InternalFailure;
    }
    await formatter.writeNotification('provider.key.removed', {
      provider,
      success: true,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `provider default {get|set <id>}`
// ---------------------------------------------------------------------------

async function runDefault(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const action = opts.action;
  if (action === 'get') {
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const result = await callRpc<{ provider: string }>(
        ctx.transport,
        'llm:getDefaultProvider',
        undefined,
      );
      await formatter.writeNotification('provider.default', {
        provider: result.provider,
      });
      return ExitCode.Success;
    });
  }
  if (action === 'set') {
    const provider = (opts.provider ?? '').trim();
    if (!provider) {
      stderr.write('ptah provider default set: provider id is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:setDefaultProvider',
        { provider },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          provider,
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'llm:setDefaultProvider returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.default.updated', {
        provider,
        success: true,
      });
      return ExitCode.Success;
    });
  }
  stderr.write(
    `ptah provider default: unknown action '${String(action)}' (expected get|set)\n`,
  );
  return ExitCode.UsageError;
}

// ---------------------------------------------------------------------------
// `provider models list [--provider]`
// ---------------------------------------------------------------------------

async function runModels(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.action !== 'list') {
    stderr.write(
      `ptah provider models: unknown action '${String(opts.action)}' (expected list)\n`,
    );
    return ExitCode.UsageError;
  }
  const provider = (opts.provider ?? '').trim();
  if (!provider) {
    stderr.write('ptah provider models list: --provider is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      models: Array<{ id: string; displayName?: string }>;
      error?: string;
    }>(ctx.transport, 'llm:listProviderModels', { provider });
    if (result.error) {
      await formatter.writeNotification('task.error', {
        provider,
        ptah_code: 'internal_failure',
        message: result.error,
      });
      return ExitCode.InternalFailure;
    }
    await formatter.writeNotification('provider.models', {
      provider,
      models: result.models,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// `provider tier {set|get|clear}`
// ---------------------------------------------------------------------------

async function runTier(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const action = opts.action;
  if (action === 'set') {
    const tier = (opts.tier ?? '').trim();
    const modelId = (opts.model ?? '').trim();
    if (!tier) {
      stderr.write('ptah provider tier set: --tier is required\n');
      return ExitCode.UsageError;
    }
    if (!modelId) {
      stderr.write('ptah provider tier set: --model is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'provider:setModelTier',
        { tier, modelId },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'provider:setModelTier returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.tier.updated', {
        tier,
        model: modelId,
        success: true,
      });
      return ExitCode.Success;
    });
  }
  if (action === 'get') {
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const tiers = await callRpc<unknown>(
        ctx.transport,
        'provider:getModelTiers',
        {},
      );
      await formatter.writeNotification('provider.tiers', {
        tiers,
      });
      return ExitCode.Success;
    });
  }
  if (action === 'clear') {
    const tier = (opts.tier ?? '').trim();
    if (!tier) {
      stderr.write('ptah provider tier clear: --tier is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full' }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'provider:clearModelTier',
        { tier },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'provider:clearModelTier returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.tier.cleared', {
        tier,
        success: true,
      });
      return ExitCode.Success;
    });
  }
  stderr.write(
    `ptah provider tier: unknown action '${String(action)}' (expected set|get|clear)\n`,
  );
  return ExitCode.UsageError;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Thin wrapper around `transport.call` that throws on RPC error (so the outer
 * try/catch in `execute` can convert to an exit code) and returns the
 * unwrapped `data` payload on success.
 */
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
