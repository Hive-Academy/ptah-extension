/**
 * `ptah config` command — file-backed reads/writes + RPC sub-subcommands for
 * model / autopilot / effort.
 *
 * TASK_2026_104 Sub-batch B5d.
 *
 * Sub-commands (per task-description.md §3.1):
 *
 *   get <key>                  Read a value via IWorkspaceProvider.getConfiguration
 *   set <key> <value>          Write via IWorkspaceProvider.setConfiguration
 *   list                       Snapshot of FILE_BASED_SETTINGS (redacted unless --reveal)
 *   reset <key>                Restore the file-backed default for <key>
 *   model-switch <model>       RPC `config:model-switch`
 *   model-get                  RPC `config:model-get`
 *   models list                RPC `config:models-list`
 *   autopilot get              RPC `config:autopilot-get`
 *   autopilot set <bool>       RPC `config:autopilot-toggle`
 *   effort get                 RPC `config:effort-get`
 *   effort set <minimal|low|medium|high>   RPC `config:effort-set`
 *
 * The file-backed sub-commands (get / set / list / reset) operate directly on
 * the platform's IWorkspaceProvider (which the CLI's CliWorkspaceProvider
 * delegates to PtahFileSettingsManager + workspace state storage). The RPC
 * sub-subcommands flow through `transport.call(...)` so the in-process
 * dispatcher hits the same shared ConfigRpcHandlers Electron uses.
 *
 * No DI mocking in production; tests inject hooks via {@link ConfigExecuteHooks}.
 */

import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
} from '@ptah-extension/platform-core';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { redact } from '../output/redactor.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { EngineContext } from '../bootstrap/with-engine.js';

/** Sub-commands accepted by `ptah config ...`. */
export type ConfigSubcommand =
  | 'get'
  | 'set'
  | 'list'
  | 'reset'
  | 'model-switch'
  | 'model-get'
  | 'models-list'
  | 'autopilot-get'
  | 'autopilot-set'
  | 'effort-get'
  | 'effort-set';

export interface ConfigOptions {
  subcommand: ConfigSubcommand;
  /** For get / set / reset: the dotted settings key. */
  key?: string;
  /** For set / autopilot-set / effort-set / model-switch: the new value. */
  value?: string;
}

/** Stderr stream contract — narrowed for testability. */
export interface ConfigStderrLike {
  write(chunk: string): boolean;
}

/** Optional collaborators — tests inject; production omits. */
export interface ConfigExecuteHooks {
  stderr?: ConfigStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

/**
 * Execute the `ptah config` command. Returns the process exit code.
 */
export async function execute(
  opts: ConfigOptions,
  globals: GlobalOptions,
  hooks: ConfigExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: ConfigStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'get':
        return await runGet(opts, globals, formatter, stderr, engine);
      case 'set':
        return await runSet(opts, globals, formatter, stderr, engine);
      case 'list':
        return await runList(globals, formatter, engine);
      case 'reset':
        return await runReset(opts, globals, formatter, stderr, engine);
      case 'model-switch':
        return await runModelSwitch(opts, globals, formatter, stderr, engine);
      case 'model-get':
        return await runModelGet(globals, formatter, engine);
      case 'models-list':
        return await runModelsList(globals, formatter, engine);
      case 'autopilot-get':
        return await runAutopilotGet(globals, formatter, engine);
      case 'autopilot-set':
        return await runAutopilotSet(opts, globals, formatter, stderr, engine);
      case 'effort-get':
        return await runEffortGet(globals, formatter, engine);
      case 'effort-set':
        return await runEffortSet(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah config: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// File-backed sub-commands (get / set / list / reset)
// ---------------------------------------------------------------------------

/**
 * Resolve the workspace provider from the engine context.
 */
function resolveWorkspaceProvider(ctx: EngineContext): {
  getConfiguration<T>(
    section: string,
    key: string,
    defaultValue?: T,
  ): T | undefined;
  setConfiguration?(
    section: string,
    key: string,
    value: unknown,
  ): Promise<void>;
} {
  return ctx.container.resolve(PLATFORM_TOKENS.WORKSPACE_PROVIDER);
}

async function runGet(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key) {
    stderr.write('ptah config get: <key> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const provider = resolveWorkspaceProvider(ctx);
    const key = opts.key as string;
    const value = provider.getConfiguration<unknown>('ptah', key);
    const redacted = redact({ [key]: value }, { reveal: globals.reveal }) as
      | Record<string, unknown>
      | undefined;
    await formatter.writeNotification('config.value', {
      key,
      value: redacted ? redacted[key] : value,
    });
    return ExitCode.Success;
  });
}

async function runSet(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key) {
    stderr.write('ptah config set: <key> is required\n');
    return ExitCode.UsageError;
  }
  if (opts.value === undefined) {
    stderr.write('ptah config set: <value> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const provider = resolveWorkspaceProvider(ctx);
    if (typeof provider.setConfiguration !== 'function') {
      throw new Error(
        'IWorkspaceProvider.setConfiguration is not available on this platform',
      );
    }
    const parsed = parseValue(opts.value as string);
    await provider.setConfiguration('ptah', opts.key as string, parsed);
    await formatter.writeNotification('config.updated', {
      key: opts.key,
      value: parsed,
    });
    return ExitCode.Success;
  });
}

async function runList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const provider = resolveWorkspaceProvider(ctx);
    const snapshot: Record<string, unknown> = {};
    for (const key of FILE_BASED_SETTINGS_KEYS) {
      snapshot[key] = provider.getConfiguration<unknown>('ptah', key);
    }
    await formatter.writeNotification(
      'config.list',
      redact({ settings: snapshot }, { reveal: globals.reveal }),
    );
    return ExitCode.Success;
  });
}

async function runReset(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key) {
    stderr.write('ptah config reset: <key> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const provider = resolveWorkspaceProvider(ctx);
    if (typeof provider.setConfiguration !== 'function') {
      throw new Error(
        'IWorkspaceProvider.setConfiguration is not available on this platform',
      );
    }
    const defaults = FILE_BASED_SETTINGS_DEFAULTS as Record<string, unknown>;
    const defaultValue = defaults[opts.key as string];
    await provider.setConfiguration('ptah', opts.key as string, defaultValue);
    await formatter.writeNotification('config.updated', {
      key: opts.key,
      value: defaultValue,
      reset: true,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// RPC sub-subcommands (model / autopilot / effort)
// ---------------------------------------------------------------------------

async function runModelSwitch(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.value) {
    stderr.write('ptah config model-switch: <model> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'config:model-switch',
      {
        model: opts.value,
      },
    );
    await formatter.writeNotification('config.model', {
      model: opts.value,
      ...wrapResult(result),
    });
    return ExitCode.Success;
  });
}

async function runModelGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'config:model-get',
      undefined,
    );
    await formatter.writeNotification('config.model', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runModelsList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'config:models-list',
      undefined,
    );
    await formatter.writeNotification('config.models', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runAutopilotGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'config:autopilot-get',
      undefined,
    );
    await formatter.writeNotification('config.autopilot', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runAutopilotSet(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.value === undefined) {
    stderr.write(
      'ptah config autopilot set: <enabled> (true|false) is required\n',
    );
    return ExitCode.UsageError;
  }
  const enabled = parseBoolean(opts.value);
  if (enabled === null) {
    stderr.write(
      `ptah config autopilot set: invalid boolean '${opts.value}' (use true|false)\n`,
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const permissionLevel = enabled ? 'yolo' : 'ask';
    try {
      const result = await callRpc<unknown>(
        ctx.transport,
        'config:autopilot-toggle',
        { enabled, permissionLevel },
      );
      await formatter.writeNotification('config.autopilot', {
        enabled,
        permissionLevel,
        ...wrapResult(result),
      });
      return ExitCode.Success;
    } catch (error) {
      // `config:autopilot-toggle` rejects YOLO unless the active license is
      // Pro. In headless / unlicensed runs the operator can still set the
      // *intent* — the Pro gate is enforced at session-start time when the
      // permission handler actually consults the level. Surface the
      // requested level as a notification with `proRequired: true` so JSON-RPC
      // clients see the intent (the gate becomes informational, not fatal).
      const message = error instanceof Error ? error.message : String(error);
      const isProGate =
        enabled &&
        permissionLevel === 'yolo' &&
        /pro subscription|pro tier|pro-?required/i.test(message);
      if (isProGate) {
        await formatter.writeNotification('config.autopilot', {
          enabled,
          permissionLevel,
          proRequired: true,
          message,
        });
        return ExitCode.Success;
      }
      throw error;
    }
  });
}

async function runEffortGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(
      ctx.transport,
      'config:effort-get',
      undefined,
    );
    await formatter.writeNotification('config.effort', wrapResult(result));
    return ExitCode.Success;
  });
}

async function runEffortSet(
  opts: ConfigOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: ConfigStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.value === undefined) {
    stderr.write(
      'ptah config effort set: <effort> (minimal|low|medium|high) is required\n',
    );
    return ExitCode.UsageError;
  }
  const allowed = new Set(['minimal', 'low', 'medium', 'high']);
  if (!allowed.has(opts.value)) {
    stderr.write(
      `ptah config effort set: invalid effort '${opts.value}' (use minimal|low|medium|high)\n`,
    );
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<unknown>(ctx.transport, 'config:effort-set', {
      effort: opts.value,
    });
    await formatter.writeNotification('config.effort', {
      effort: opts.value,
      ...wrapResult(result),
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a CLI string value into a JSON-compatible scalar. Honours
 * `true`/`false`, integer/float numbers, JSON literals (`null`, arrays,
 * objects), and falls back to the raw string.
 */
function parseValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed);
  // Try JSON for arrays / objects / quoted strings.
  if (
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through to raw string */
    }
  }
  return raw;
}

function parseBoolean(raw: string): boolean | null {
  const lower = raw.trim().toLowerCase();
  if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
    return true;
  }
  if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') {
    return false;
  }
  return null;
}

function wrapResult(result: unknown): Record<string, unknown> {
  if (result === null || result === undefined) return {};
  if (typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { result };
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
