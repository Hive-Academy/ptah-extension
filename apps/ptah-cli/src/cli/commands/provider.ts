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

import type {
  LlmGetProviderStatusEntry,
  LlmGetProviderStatusResponse,
} from '@ptah-extension/shared';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { suggestClosest } from './_string-distance.js';

/** Sub-commands accepted by `ptah provider ...`. */
export type ProviderSubcommand =
  | 'status'
  | 'set-key'
  | 'remove-key'
  | 'default'
  | 'models'
  | 'tier'
  | 'base-url'
  | 'ollama';

/**
 * Action argument for nested sub-commands (`default get/set`, `models list`,
 * `tier set/get/clear`, `base-url set/get/clear`, `ollama
 * set-endpoint/get-endpoint/clear-endpoint`).
 */
export type ProviderAction =
  | 'get'
  | 'set'
  | 'list'
  | 'clear'
  | 'set-endpoint'
  | 'get-endpoint'
  | 'clear-endpoint';

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
  /**
   * Base URL override (for `set-key --base-url`, `base-url set <provider>
   * <url>`, and `ollama set-endpoint <url>`). When supplied via `set-key` the
   * value is persisted after the API key write succeeds.
   */
  baseUrl?: string;
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
      case 'base-url':
        return await runBaseUrl(opts, formatter, globals, stderr, engine);
      case 'ollama':
        return await runOllama(opts, formatter, globals, stderr, engine);
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
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    // Cast through unknown — the RPC handler now returns the rich shape
    // (LlmGetProviderStatusResponse) including authType / requiresProxy /
    // isLocal / baseUrl / baseUrlOverridden for every registered provider
    // plus the virtual `anthropic` direct entry. The notification payload
    // forwards all fields verbatim so JSON-RPC consumers can render auth-mode
    // columns without extra round-trips.
    const status = await callRpc<LlmGetProviderStatusResponse>(
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

/**
 * Resolve the available provider id set for `provider default set` validation.
 * Calls `llm:getProviderStatus` to use the same registry the RPC layer sees,
 * so virtual providers (`anthropic`) and registry-driven providers stay in
 * lockstep with the suggestion list.
 */
async function fetchAvailableProviderIds(
  transport: CliMessageTransport,
): Promise<string[]> {
  const status = await callRpc<LlmGetProviderStatusResponse>(
    transport,
    'llm:getProviderStatus',
    undefined,
  );
  const providers = (status.providers ?? []) as LlmGetProviderStatusEntry[];
  return providers.map((p) => p.name);
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
  const rawKey = Array.isArray(opts.key) ? opts.key[0] : opts.key;
  const apiKey = rawKey ?? '';
  if (!provider) {
    stderr.write('ptah provider set-key: --provider is required\n');
    return ExitCode.UsageError;
  }
  if (!apiKey) {
    stderr.write('ptah provider set-key: --key is required\n');
    return ExitCode.UsageError;
  }

  const baseUrlOverride =
    typeof opts.baseUrl === 'string' && opts.baseUrl.trim().length > 0
      ? opts.baseUrl.trim()
      : undefined;

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    // Optionally persist the base URL override AFTER the api key write
    // succeeds. Failure here surfaces as a separate task.error so the user
    // can re-run `provider base-url set` without re-supplying the key.
    if (baseUrlOverride !== undefined) {
      const baseResult = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:setProviderBaseUrl',
        { provider, baseUrl: baseUrlOverride },
      );
      if (!baseResult.success) {
        await formatter.writeNotification('task.error', {
          provider,
          ptah_code: 'internal_failure',
          message:
            baseResult.error ?? 'llm:setProviderBaseUrl returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.base_url.set', {
        provider,
        baseUrl: baseUrlOverride,
        success: true,
      });
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
// `provider base-url {set|get|clear}`
// ---------------------------------------------------------------------------

async function runBaseUrl(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const action = opts.action;
  const provider = (opts.provider ?? '').trim();

  if (action === 'get') {
    if (!provider) {
      stderr.write('ptah provider base-url get: --provider is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{
        baseUrl: string | null;
        defaultBaseUrl: string | null;
      }>(ctx.transport, 'llm:getProviderBaseUrl', { provider });
      await formatter.writeNotification('provider.base_url', {
        provider,
        baseUrl: result.baseUrl,
        defaultBaseUrl: result.defaultBaseUrl,
      });
      return ExitCode.Success;
    });
  }

  if (action === 'set') {
    const baseUrl = (opts.baseUrl ?? '').trim();
    if (!provider) {
      stderr.write('ptah provider base-url set: --provider is required\n');
      return ExitCode.UsageError;
    }
    if (!baseUrl) {
      stderr.write('ptah provider base-url set: <url> is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:setProviderBaseUrl',
        { provider, baseUrl },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          provider,
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'llm:setProviderBaseUrl returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.base_url.set', {
        provider,
        baseUrl,
        success: true,
      });
      return ExitCode.Success;
    });
  }

  if (action === 'clear') {
    if (!provider) {
      stderr.write('ptah provider base-url clear: --provider is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:clearProviderBaseUrl',
        { provider },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          provider,
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'llm:clearProviderBaseUrl returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.base_url.cleared', {
        provider,
        success: true,
      });
      return ExitCode.Success;
    });
  }

  stderr.write(
    `ptah provider base-url: unknown action '${String(action)}' (expected get|set|clear)\n`,
  );
  return ExitCode.UsageError;
}

// ---------------------------------------------------------------------------
// `provider ollama {set-endpoint <url>|get-endpoint|clear-endpoint}`
//
// Convenience facade over `provider base-url ...` with `provider: 'ollama'`
// hardcoded. Routes through the same `llm:*ProviderBaseUrl` RPCs so users
// pointing at a remote Ollama instance get the same override resolution as
// every other provider.
// ---------------------------------------------------------------------------

const OLLAMA_PROVIDER_ID = 'ollama';

async function runOllama(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const action = opts.action;

  if (action === 'set-endpoint') {
    const baseUrl = (opts.baseUrl ?? '').trim();
    if (!baseUrl) {
      stderr.write('ptah provider ollama set-endpoint: <url> is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:setProviderBaseUrl',
        { provider: OLLAMA_PROVIDER_ID, baseUrl },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          provider: OLLAMA_PROVIDER_ID,
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'llm:setProviderBaseUrl returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.ollama.endpoint.set', {
        provider: OLLAMA_PROVIDER_ID,
        baseUrl,
        success: true,
      });
      return ExitCode.Success;
    });
  }

  if (action === 'get-endpoint') {
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{
        baseUrl: string | null;
        defaultBaseUrl: string | null;
      }>(ctx.transport, 'llm:getProviderBaseUrl', {
        provider: OLLAMA_PROVIDER_ID,
      });
      await formatter.writeNotification('provider.ollama.endpoint', {
        provider: OLLAMA_PROVIDER_ID,
        baseUrl: result.baseUrl,
        defaultBaseUrl: result.defaultBaseUrl,
      });
      return ExitCode.Success;
    });
  }

  if (action === 'clear-endpoint') {
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ success: boolean; error?: string }>(
        ctx.transport,
        'llm:clearProviderBaseUrl',
        { provider: OLLAMA_PROVIDER_ID },
      );
      if (!result.success) {
        await formatter.writeNotification('task.error', {
          provider: OLLAMA_PROVIDER_ID,
          ptah_code: 'internal_failure',
          message:
            result.error ?? 'llm:clearProviderBaseUrl returned success=false',
        });
        return ExitCode.InternalFailure;
      }
      await formatter.writeNotification('provider.ollama.endpoint.cleared', {
        provider: OLLAMA_PROVIDER_ID,
        success: true,
      });
      return ExitCode.Success;
    });
  }

  stderr.write(
    `ptah provider ollama: unknown action '${String(action)}' (expected set-endpoint|get-endpoint|clear-endpoint)\n`,
  );
  return ExitCode.UsageError;
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

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      // Validate against the live registry before issuing the write. Catches
      // typos like `openroute` and surfaces a "did you mean…?" hint. We use
      // the same RPC the user can call themselves so the suggestion list
      // matches what `provider status` shows.
      const available = await fetchAvailableProviderIds(ctx.transport);
      if (!available.includes(provider)) {
        const hint = suggestClosest(provider, available, 2);
        const list = available.join(', ');
        const suggestion = hint ? ` Did you mean '${hint}'?` : '';
        stderr.write(
          `ptah provider default set: unknown provider '${provider}'.${suggestion}\n` +
            `Available providers: ${list}\n`,
        );
        return ExitCode.UsageError;
      }

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

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
