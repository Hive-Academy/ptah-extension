/**
 * `ptah provider` command — sub-dispatcher for status / set-key / remove-key /
 * default get / default set / models list / tier set / tier get / tier clear.
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
 *   custom list                   — Calls `provider:listCustomEntries`. Emits
 *                                    `provider.custom.entries` (redacted).
 *   custom add <id>               — Calls `provider:addCustomEntry`. Emits
 *                                    `provider.custom.added`.
 *   custom update <id>            — Calls `provider:updateCustomEntry`. Emits
 *                                    `provider.custom.updated`.
 *   custom remove <id>            — Calls `provider:removeCustomEntry`. Emits
 *                                    `provider.custom.removed`.
 *   custom test <id>              — Calls `provider:testCustomEntry`. Emits
 *                                    `provider.custom.test`.
 *
 * Every sub-command boots `withEngine({ mode: 'full' })` so the LLM and
 * provider RPC handlers are registered. No DI mocking in production code —
 * tests inject collaborators via `ProviderExecuteHooks`.
 */

import * as clack from '@clack/prompts';

import type {
  CustomProviderEntry,
  CustomProviderLane,
  LlmGetProviderStatusEntry,
  LlmGetProviderStatusResponse,
} from '@ptah-extension/shared';
import {
  CUSTOM_PROVIDER_LANES,
  CustomProviderEntrySchema,
} from '@ptah-extension/shared';

import { withEngine } from '@ptah-extension/cli-engine';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
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
  | 'ollama'
  | 'custom';

/**
 * Action argument for nested sub-commands (`default get/set`, `models list`,
 * `tier set/get/clear`, `base-url set/get/clear`, `ollama
 * set-endpoint/get-endpoint/clear-endpoint`, `custom
 * list/add/update/remove/test`).
 */
export type ProviderAction =
  | 'get'
  | 'set'
  | 'list'
  | 'clear'
  | 'set-endpoint'
  | 'get-endpoint'
  | 'clear-endpoint'
  | 'add'
  | 'update'
  | 'remove'
  | 'test';

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

  // -- `provider custom add|update` fields ----------------------------------
  // All arrive as strings from commander. Numeric and enum coercion happens in
  // `resolveCustomAddInput` / `resolveCustomUpdateChanges`, never at the flag
  // layer, so a bad value fails with a usage message instead of a Zod error
  // surfacing from the RPC boundary.

  /** Display name for a custom entry. */
  name?: string;
  /**
   * Wire lane the endpoint speaks. ALWAYS explicit — never inferred from the
   * URL, because the lane decides whether the local translation proxy runs and
   * a wrong guess fails at the first tool call, not at save time.
   */
  lane?: string;
  /** Optional `/v1/models`-style discovery endpoint. */
  modelsEndpoint?: string;
  /** Optional expected key prefix, shown as an input hint. */
  keyPrefix?: string;
  /** Optional "where do I get a key" URL. */
  helpUrl?: string;
  /** Which env var carries the key (`ANTHROPIC_AUTH_TOKEN` by default). */
  authEnvVar?: string;
  /** Tier → model mapping. All three or none. */
  tierSonnet?: string;
  tierOpus?: string;
  tierHaiku?: string;
  /** Optional manual per-1M-token rates. Both or neither. */
  inputPrice?: string;
  outputPrice?: string;
}

/** Stderr stream contract — narrowed for testability. */
export interface ProviderStderrLike {
  write(chunk: string): boolean;
}

/**
 * The @clack surface `provider custom add` uses. Mirrors `init.ts` so both
 * interactive commands are stubbed the same way in tests.
 */
export type ProviderClackLike = Pick<
  typeof clack,
  'intro' | 'outro' | 'text' | 'password' | 'select' | 'isCancel' | 'cancel'
>;

/** Optional collaborators — tests inject; production omits. */
export interface ProviderExecuteHooks {
  /** Override the stderr sink. Defaults to `process.stderr`. */
  stderr?: ProviderStderrLike;
  /** Override the formatter. Defaults to one built from `globals`. */
  formatter?: Formatter;
  /** Override the engine bootstrapper. Tests pass a stub returning scripted ctx. */
  withEngine?: typeof withEngine;
  /** Override the prompt surface used by `custom add` on a TTY. */
  clack?: ProviderClackLike;
  /** Override interactivity detection (tests force either mode). */
  isInteractive?: (globals: GlobalOptions) => boolean;
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
      case 'custom':
        return await runCustom(opts, formatter, globals, stderr, engine, hooks);
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

async function runStatus(
  formatter: Formatter,
  globals: GlobalOptions,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
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
    const result = await callRpc<{
      success: boolean;
      verified?: boolean;
      error?: string;
    }>(ctx.transport, 'llm:setApiKey', { provider, apiKey });
    if (!result.success) {
      await formatter.writeNotification('task.error', {
        provider,
        verified: false,
        ptah_code: 'auth_required',
        message: result.error ?? 'llm:setApiKey returned success=false',
      });
      return ExitCode.AuthRequired;
    }
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
    await formatter.writeNotification('provider.key.set', {
      provider,
      success: true,
      verified: result.verified === true,
    });
    return result.verified === true ? ExitCode.Success : ExitCode.AuthRequired;
  });
}

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
        { tier, modelId, scope: 'mainAgent' },
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
        { scope: 'mainAgent' },
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
        { tier, scope: 'mainAgent' },
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
// `provider custom …` — user-defined provider entries
// ---------------------------------------------------------------------------

/** Exit code for a prompt the user cancelled (SIGINT convention, as `init`). */
const CUSTOM_CANCEL_EXIT_CODE = 130;

/**
 * Machine mode never prompts. `--json`, `--quiet` and a non-TTY stdout all mean
 * "a script is driving this", and a script that hits a prompt hangs forever —
 * so in that mode a missing required flag is a usage error instead.
 */
function defaultIsInteractive(globals: GlobalOptions): boolean {
  if (globals.json === true) return false;
  if (globals.quiet === true) return false;
  return process.stdout.isTTY === true;
}

function trimOrUndefined(value: string | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Partial custom-entry mutation accepted by `provider:updateCustomEntry`. */
interface CustomEntryChanges {
  name?: string;
  baseUrl?: string;
  lane?: CustomProviderLane;
  keyPrefix?: string;
  helpUrl?: string;
  authEnvVar?: 'ANTHROPIC_AUTH_TOKEN' | 'ANTHROPIC_API_KEY';
  modelsEndpoint?: string | null;
  defaultTiers?: { sonnet: string; opus: string; haiku: string } | null;
  pricing?: { inputPerMillion: number; outputPerMillion: number } | null;
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * The lane is an explicit, constrained flag — never derived from the URL.
 * `lane` decides whether the OpenAI→Anthropic translation proxy runs, and a
 * URL-shape guess is wrong often enough that the failure would surface as a
 * broken first tool call rather than a rejected save.
 */
function parseLane(
  raw: string | undefined,
): ParseResult<CustomProviderLane | undefined> {
  const value = trimOrUndefined(raw);
  if (value === undefined) return { ok: true, value: undefined };
  const match = CUSTOM_PROVIDER_LANES.find((lane) => lane === value);
  if (!match) {
    return {
      ok: false,
      message: `--lane must be one of ${CUSTOM_PROVIDER_LANES.join('|')} (got '${value}')`,
    };
  }
  return { ok: true, value: match };
}

const AUTH_ENV_VARS = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'] as const;

function parseAuthEnvVar(
  raw: string | undefined,
): ParseResult<(typeof AUTH_ENV_VARS)[number] | undefined> {
  const value = trimOrUndefined(raw);
  if (value === undefined) return { ok: true, value: undefined };
  const match = AUTH_ENV_VARS.find((name) => name === value);
  if (!match) {
    return {
      ok: false,
      message: `--auth-env-var must be one of ${AUTH_ENV_VARS.join('|')} (got '${value}')`,
    };
  }
  return { ok: true, value: match };
}

/** Tier mapping is all-three-or-none — a partial map cannot resolve a tier. */
function parseTiers(
  opts: ProviderOptions,
): ParseResult<{ sonnet: string; opus: string; haiku: string } | undefined> {
  const sonnet = trimOrUndefined(opts.tierSonnet);
  const opus = trimOrUndefined(opts.tierOpus);
  const haiku = trimOrUndefined(opts.tierHaiku);
  const supplied = [sonnet, opus, haiku].filter(
    (value) => value !== undefined,
  ).length;
  if (supplied === 0) return { ok: true, value: undefined };
  if (supplied !== 3 || !sonnet || !opus || !haiku) {
    return {
      ok: false,
      message:
        '--tier-sonnet, --tier-opus and --tier-haiku must be supplied together',
    };
  }
  return { ok: true, value: { sonnet, opus, haiku } };
}

/** Manual per-1M rates are both-or-neither; absent means "cost unavailable". */
function parsePricing(
  opts: ProviderOptions,
): ParseResult<
  { inputPerMillion: number; outputPerMillion: number } | undefined
> {
  const input = trimOrUndefined(opts.inputPrice);
  const output = trimOrUndefined(opts.outputPrice);
  if (input === undefined && output === undefined) {
    return { ok: true, value: undefined };
  }
  if (input === undefined || output === undefined) {
    return {
      ok: false,
      message: '--input-price and --output-price must be supplied together',
    };
  }
  const inputPerMillion = Number(input);
  const outputPerMillion = Number(output);
  if (!Number.isFinite(inputPerMillion) || inputPerMillion < 0) {
    return {
      ok: false,
      message: `--input-price must be a non-negative number (got '${input}')`,
    };
  }
  if (!Number.isFinite(outputPerMillion) || outputPerMillion < 0) {
    return {
      ok: false,
      message: `--output-price must be a non-negative number (got '${output}')`,
    };
  }
  return { ok: true, value: { inputPerMillion, outputPerMillion } };
}

/** Flatten Zod issues into one line the terminal can show without wrapping. */
function formatEntryIssues(
  issues: ReadonlyArray<{
    readonly path: ReadonlyArray<PropertyKey>;
    readonly message: string;
  }>,
): string {
  return issues
    .map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`)
    .join('; ');
}

type CustomAddInput =
  | { kind: 'ok'; entry: CustomProviderEntry; apiKey?: string }
  | { kind: 'usage'; message: string }
  | { kind: 'cancelled' };

/**
 * Resolve the full field set for `provider custom add`.
 *
 * Flags always win. On a TTY the four required fields (id, name, base URL,
 * lane) and the API key fall back to prompts; in machine mode a missing
 * required field is a usage error, never a prompt.
 */
async function resolveCustomAddInput(
  opts: ProviderOptions,
  interactive: boolean,
  prompts: ProviderClackLike,
): Promise<CustomAddInput> {
  const lane = parseLane(opts.lane);
  if (!lane.ok) return { kind: 'usage', message: lane.message };
  const authEnvVar = parseAuthEnvVar(opts.authEnvVar);
  if (!authEnvVar.ok) return { kind: 'usage', message: authEnvVar.message };
  const tiers = parseTiers(opts);
  if (!tiers.ok) return { kind: 'usage', message: tiers.message };
  const pricing = parsePricing(opts);
  if (!pricing.ok) return { kind: 'usage', message: pricing.message };

  let id = trimOrUndefined(opts.provider);
  let name = trimOrUndefined(opts.name);
  let baseUrl = trimOrUndefined(opts.baseUrl);
  let laneValue = lane.value;
  let apiKey = trimOrUndefined(opts.key);
  let modelsEndpoint = trimOrUndefined(opts.modelsEndpoint);

  if (!interactive) {
    if (!id) return { kind: 'usage', message: '<id> is required' };
    if (!name) return { kind: 'usage', message: '--name is required' };
    if (!baseUrl) return { kind: 'usage', message: '--base-url is required' };
    if (!laneValue) {
      return {
        kind: 'usage',
        message: `--lane is required (${CUSTOM_PROVIDER_LANES.join('|')})`,
      };
    }
  } else {
    if (!id) {
      const answer = await prompts.text({
        message: 'Provider id (lower-case, dashes allowed)',
        placeholder: 'my-gateway',
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      id = trimOrUndefined(String(answer));
    }
    if (!name) {
      const answer = await prompts.text({
        message: 'Display name',
        placeholder: 'My Gateway',
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      name = trimOrUndefined(String(answer));
    }
    if (!baseUrl) {
      const answer = await prompts.text({
        message: 'Base URL (http:// or https://)',
        placeholder: 'https://gateway.example.com',
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      baseUrl = trimOrUndefined(String(answer));
    }
    if (!laneValue) {
      const answer = await prompts.select({
        message: 'Which wire protocol does the endpoint speak?',
        options: [
          { value: 'anthropic', label: 'Anthropic-compatible (passthrough)' },
          {
            value: 'openai',
            label: 'OpenAI-compatible (local translation proxy)',
          },
        ],
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      const picked = parseLane(String(answer));
      if (!picked.ok) return { kind: 'usage', message: picked.message };
      laneValue = picked.value;
    }
    if (!apiKey) {
      const answer = await prompts.password({
        message: 'API key (leave blank if the endpoint needs none)',
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      apiKey = trimOrUndefined(String(answer));
    }
    if (!modelsEndpoint) {
      const answer = await prompts.text({
        message: 'Models endpoint (optional — press Enter to skip)',
        placeholder: '',
      });
      if (prompts.isCancel(answer)) return { kind: 'cancelled' };
      modelsEndpoint = trimOrUndefined(String(answer));
    }
  }

  // One validation authority: the same schema the settings store and the RPC
  // handler parse with, so the CLI can never accept a shape they would reject.
  const parsed = CustomProviderEntrySchema.safeParse({
    id,
    name,
    baseUrl,
    lane: laneValue,
    ...(authEnvVar.value ? { authEnvVar: authEnvVar.value } : {}),
    ...(trimOrUndefined(opts.keyPrefix)
      ? { keyPrefix: trimOrUndefined(opts.keyPrefix) }
      : {}),
    ...(trimOrUndefined(opts.helpUrl)
      ? { helpUrl: trimOrUndefined(opts.helpUrl) }
      : {}),
    ...(modelsEndpoint ? { modelsEndpoint } : {}),
    ...(tiers.value ? { defaultTiers: tiers.value } : {}),
    ...(pricing.value ? { pricing: pricing.value } : {}),
  });
  if (!parsed.success) {
    return { kind: 'usage', message: formatEntryIssues(parsed.error.issues) };
  }

  return {
    kind: 'ok',
    entry: parsed.data,
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Collect only the fields the user actually passed to `custom update`. */
function resolveCustomUpdateChanges(
  opts: ProviderOptions,
): ParseResult<CustomEntryChanges> {
  const lane = parseLane(opts.lane);
  if (!lane.ok) return lane;
  const authEnvVar = parseAuthEnvVar(opts.authEnvVar);
  if (!authEnvVar.ok) return authEnvVar;
  const tiers = parseTiers(opts);
  if (!tiers.ok) return tiers;
  const pricing = parsePricing(opts);
  if (!pricing.ok) return pricing;

  const baseUrl = trimOrUndefined(opts.baseUrl);
  if (baseUrl !== undefined) {
    const check = CustomProviderEntrySchema.shape.baseUrl.safeParse(baseUrl);
    if (!check.success) {
      return {
        ok: false,
        message: `--base-url: ${check.error.issues.map((issue) => issue.message).join('; ')}`,
      };
    }
  }

  const changes: CustomEntryChanges = {
    ...(trimOrUndefined(opts.name) ? { name: trimOrUndefined(opts.name) } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(lane.value ? { lane: lane.value } : {}),
    ...(authEnvVar.value ? { authEnvVar: authEnvVar.value } : {}),
    ...(trimOrUndefined(opts.keyPrefix)
      ? { keyPrefix: trimOrUndefined(opts.keyPrefix) }
      : {}),
    ...(trimOrUndefined(opts.helpUrl)
      ? { helpUrl: trimOrUndefined(opts.helpUrl) }
      : {}),
    ...(trimOrUndefined(opts.modelsEndpoint)
      ? { modelsEndpoint: trimOrUndefined(opts.modelsEndpoint) }
      : {}),
    ...(tiers.value ? { defaultTiers: tiers.value } : {}),
    ...(pricing.value ? { pricing: pricing.value } : {}),
  };

  return { ok: true, value: changes };
}

async function runCustom(
  opts: ProviderOptions,
  formatter: Formatter,
  globals: GlobalOptions,
  stderr: ProviderStderrLike,
  engine: typeof withEngine,
  hooks: ProviderExecuteHooks,
): Promise<number> {
  const action = opts.action;

  if (action === 'list') {
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ entries: CustomProviderEntry[] }>(
        ctx.transport,
        'provider:listCustomEntries',
        undefined,
      );
      // Entries are non-secret metadata by contract, but this payload is the
      // one place a stored key could leak if that contract ever slipped, so it
      // goes through the same redactor `provider status` uses.
      await formatter.writeNotification(
        'provider.custom.entries',
        redact({ entries: result.entries ?? [] }, { reveal: false }),
      );
      return ExitCode.Success;
    });
  }

  if (action === 'add') {
    const interactive = (hooks.isInteractive ?? defaultIsInteractive)(globals);
    const prompts = hooks.clack ?? clack;
    const resolved = await resolveCustomAddInput(opts, interactive, prompts);
    if (resolved.kind === 'cancelled') {
      prompts.cancel('Cancelled — nothing was saved.');
      return CUSTOM_CANCEL_EXIT_CODE;
    }
    if (resolved.kind === 'usage') {
      stderr.write(`ptah provider custom add: ${resolved.message}\n`);
      return ExitCode.UsageError;
    }

    const { entry, apiKey } = resolved;
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ entry: CustomProviderEntry }>(
        ctx.transport,
        'provider:addCustomEntry',
        { entry, ...(apiKey ? { apiKey } : {}) },
      );
      // The key is never echoed back — only the stored metadata is reported.
      await formatter.writeNotification(
        'provider.custom.added',
        redact(
          { entry: result.entry ?? entry, keyStored: apiKey !== undefined },
          { reveal: false },
        ),
      );
      return ExitCode.Success;
    });
  }

  if (action === 'update') {
    const id = trimOrUndefined(opts.provider);
    if (!id) {
      stderr.write('ptah provider custom update: <id> is required\n');
      return ExitCode.UsageError;
    }
    const changes = resolveCustomUpdateChanges(opts);
    if (!changes.ok) {
      stderr.write(`ptah provider custom update: ${changes.message}\n`);
      return ExitCode.UsageError;
    }
    const apiKey = trimOrUndefined(opts.key);
    if (Object.keys(changes.value).length === 0 && apiKey === undefined) {
      stderr.write(
        'ptah provider custom update: nothing to update — pass at least one field flag or --key\n',
      );
      return ExitCode.UsageError;
    }

    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ entry: CustomProviderEntry }>(
        ctx.transport,
        'provider:updateCustomEntry',
        { id, changes: changes.value, ...(apiKey ? { apiKey } : {}) },
      );
      await formatter.writeNotification(
        'provider.custom.updated',
        redact(
          { entry: result.entry, keyStored: apiKey !== undefined },
          { reveal: false },
        ),
      );
      return ExitCode.Success;
    });
  }

  if (action === 'remove') {
    const id = trimOrUndefined(opts.provider);
    if (!id) {
      stderr.write('ptah provider custom remove: <id> is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{ removed: boolean }>(
        ctx.transport,
        'provider:removeCustomEntry',
        { id },
      );
      if (result.removed !== true) {
        stderr.write(
          `ptah provider custom remove: no custom provider with id '${id}'\n`,
        );
        return ExitCode.UsageError;
      }
      await formatter.writeNotification('provider.custom.removed', {
        id,
        removed: true,
      });
      return ExitCode.Success;
    });
  }

  if (action === 'test') {
    const id = trimOrUndefined(opts.provider);
    if (!id) {
      stderr.write('ptah provider custom test: <id> is required\n');
      return ExitCode.UsageError;
    }
    return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
      const result = await callRpc<{
        ok: boolean;
        message: string;
        latencyMs?: number;
      }>(ctx.transport, 'provider:testCustomEntry', { id });
      // A failed probe is a RESULT, not a crash: the notification is emitted
      // either way (with the backend's message verbatim) so a script can read
      // why, and only the exit code distinguishes the two.
      await formatter.writeNotification('provider.custom.test', {
        id,
        ok: result.ok === true,
        message: result.message,
        ...(result.latencyMs !== undefined
          ? { latencyMs: result.latencyMs }
          : {}),
      });
      return result.ok === true ? ExitCode.Success : ExitCode.GeneralError;
    });
  }

  stderr.write(
    `ptah provider custom: unknown action '${String(action)}' (expected list|add|update|remove|test)\n`,
  );
  return ExitCode.UsageError;
}

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
