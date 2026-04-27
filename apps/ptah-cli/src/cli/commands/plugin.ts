/**
 * `ptah plugin` command — workspace plugin management.
 *
 * TASK_2026_104 Sub-batch B6c. Backed by the shared `PluginRpcHandlers`
 * (registered globally via `registerAllRpcHandlers()`), so VS Code, Electron,
 * and the CLI all dispatch identical RPC verbs.
 *
 * Sub-commands (per task-description.md §3.1 `plugin *` table):
 *
 *   list                              RPC `plugins:list-available`
 *   enable <id>                       RPC `plugins:save-config` (probe-first)
 *   disable <id>                      RPC `plugins:save-config` (probe-first)
 *   config get                        RPC `plugins:get-config`
 *   config set [--enabled <list>]
 *              [--disabled-skills <list>]
 *                                     RPC `plugins:save-config`
 *   skills list [--plugins <list>]    RPC `plugins:list-skills`
 *
 * **NO `install` sub-subcommand** (Discovery D8 — "install = enable").
 *
 * Idempotency contract (`plugin.config.updated` payload):
 *   - `changed: bool` — true on first effective enable/disable (or `config set`
 *     that mutates state), false when the requested state already matches the
 *     current `plugins:get-config` snapshot.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  PluginConfigState,
  PluginInfo,
  PluginSkillEntry,
} from '@ptah-extension/shared';

export type PluginSubcommand =
  | 'list'
  | 'enable'
  | 'disable'
  | 'config-get'
  | 'config-set'
  | 'skills-list';

export interface PluginOptions {
  subcommand: PluginSubcommand;
  /** For `enable` / `disable`. */
  id?: string;
  /** For `config set --enabled` — comma-separated plugin ids. */
  enabled?: string[];
  /** For `config set --disabled-skills` — comma-separated skill ids. */
  disabledSkills?: string[];
  /** For `skills list --plugins` — restrict to a subset of plugin ids. */
  plugins?: string[];
}

export interface PluginStderrLike {
  write(chunk: string): boolean;
}

export interface PluginExecuteHooks {
  stderr?: PluginStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

export async function execute(
  opts: PluginOptions,
  globals: GlobalOptions,
  hooks: PluginExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: PluginStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'list':
        return await runList(globals, formatter, engine);
      case 'enable':
        return await runEnable(opts, globals, formatter, stderr, engine);
      case 'disable':
        return await runDisable(opts, globals, formatter, stderr, engine);
      case 'config-get':
        return await runConfigGet(globals, formatter, engine);
      case 'config-set':
        return await runConfigSet(opts, globals, formatter, stderr, engine);
      case 'skills-list':
        return await runSkillsList(opts, globals, formatter, engine);
      default:
        stderr.write(
          `ptah plugin: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// Sub-commands
// ---------------------------------------------------------------------------

async function runList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ plugins: PluginInfo[] }>(
      ctx.transport,
      'plugins:list-available',
      {},
    );
    await formatter.writeNotification('plugin.list', {
      plugins: result?.plugins ?? [],
    });
    return ExitCode.Success;
  });
}

async function runEnable(
  opts: PluginOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: PluginStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write(
      'ptah plugin enable: <id> is required (note: install = enable in Ptah)\n',
    );
    return ExitCode.UsageError;
  }
  const id = opts.id;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const before = await callRpc<PluginConfigState>(
      ctx.transport,
      'plugins:get-config',
      {},
    );
    const currentEnabled = before?.enabledPluginIds ?? [];
    const currentDisabledSkills = before?.disabledSkillIds ?? [];

    if (currentEnabled.includes(id)) {
      await formatter.writeNotification('plugin.config.updated', {
        action: 'enable',
        id,
        enabledPluginIds: currentEnabled,
        disabledSkillIds: currentDisabledSkills,
        changed: false,
      });
      return ExitCode.Success;
    }

    const nextEnabled = [...currentEnabled, id];
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'plugins:save-config',
      {
        enabledPluginIds: nextEnabled,
        disabledSkillIds: currentDisabledSkills,
      },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'plugins:save-config failed');
    }
    await formatter.writeNotification('plugin.config.updated', {
      action: 'enable',
      id,
      enabledPluginIds: nextEnabled,
      disabledSkillIds: currentDisabledSkills,
      changed: true,
    });
    return ExitCode.Success;
  });
}

async function runDisable(
  opts: PluginOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: PluginStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.id || opts.id.trim().length === 0) {
    stderr.write('ptah plugin disable: <id> is required\n');
    return ExitCode.UsageError;
  }
  const id = opts.id;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const before = await callRpc<PluginConfigState>(
      ctx.transport,
      'plugins:get-config',
      {},
    );
    const currentEnabled = before?.enabledPluginIds ?? [];
    const currentDisabledSkills = before?.disabledSkillIds ?? [];

    if (!currentEnabled.includes(id)) {
      await formatter.writeNotification('plugin.config.updated', {
        action: 'disable',
        id,
        enabledPluginIds: currentEnabled,
        disabledSkillIds: currentDisabledSkills,
        changed: false,
      });
      return ExitCode.Success;
    }

    const nextEnabled = currentEnabled.filter((p) => p !== id);
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'plugins:save-config',
      {
        enabledPluginIds: nextEnabled,
        disabledSkillIds: currentDisabledSkills,
      },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'plugins:save-config failed');
    }
    await formatter.writeNotification('plugin.config.updated', {
      action: 'disable',
      id,
      enabledPluginIds: nextEnabled,
      disabledSkillIds: currentDisabledSkills,
      changed: true,
    });
    return ExitCode.Success;
  });
}

async function runConfigGet(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<PluginConfigState>(
      ctx.transport,
      'plugins:get-config',
      {},
    );
    await formatter.writeNotification('plugin.config.value', {
      enabledPluginIds: result?.enabledPluginIds ?? [],
      disabledSkillIds: result?.disabledSkillIds ?? [],
      lastUpdated: result?.lastUpdated,
    });
    return ExitCode.Success;
  });
}

async function runConfigSet(
  opts: PluginOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: PluginStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (opts.enabled === undefined && opts.disabledSkills === undefined) {
    stderr.write(
      'ptah plugin config set: at least one of --enabled or --disabled-skills is required\n',
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const before = await callRpc<PluginConfigState>(
      ctx.transport,
      'plugins:get-config',
      {},
    );
    const currentEnabled = before?.enabledPluginIds ?? [];
    const currentDisabledSkills = before?.disabledSkillIds ?? [];

    const nextEnabled =
      opts.enabled !== undefined ? opts.enabled : currentEnabled;
    const nextDisabledSkills =
      opts.disabledSkills !== undefined
        ? opts.disabledSkills
        : currentDisabledSkills;

    const enabledChanged = !arraysEqualUnordered(currentEnabled, nextEnabled);
    const disabledChanged = !arraysEqualUnordered(
      currentDisabledSkills,
      nextDisabledSkills,
    );
    const changed = enabledChanged || disabledChanged;

    if (!changed) {
      await formatter.writeNotification('plugin.config.updated', {
        action: 'config-set',
        enabledPluginIds: currentEnabled,
        disabledSkillIds: currentDisabledSkills,
        changed: false,
      });
      return ExitCode.Success;
    }

    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'plugins:save-config',
      {
        enabledPluginIds: nextEnabled,
        disabledSkillIds: nextDisabledSkills,
      },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'plugins:save-config failed');
    }
    await formatter.writeNotification('plugin.config.updated', {
      action: 'config-set',
      enabledPluginIds: nextEnabled,
      disabledSkillIds: nextDisabledSkills,
      changed: true,
    });
    return ExitCode.Success;
  });
}

async function runSkillsList(
  opts: PluginOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    // Default: list skills for currently-enabled plugins. Caller may override
    // via --plugins to inspect a different subset.
    let pluginIds: string[];
    if (opts.plugins && opts.plugins.length > 0) {
      pluginIds = opts.plugins;
    } else {
      const config = await callRpc<PluginConfigState>(
        ctx.transport,
        'plugins:get-config',
        {},
      );
      pluginIds = config?.enabledPluginIds ?? [];
    }

    const result = await callRpc<{ skills: PluginSkillEntry[] }>(
      ctx.transport,
      'plugins:list-skills',
      { pluginIds },
    );
    await formatter.writeNotification('plugin.skills.list', {
      pluginIds,
      skills: result?.skills ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — kept module-private.
// ---------------------------------------------------------------------------

/**
 * Order-insensitive equality check for two string arrays. Used by
 * `runConfigSet` to determine whether the requested config differs from the
 * current snapshot before issuing a write — matches the idempotency contract
 * used by `mcp install` (configsEqual) and `skill install` (isAlreadyInstalled).
 */
function arraysEqualUnordered(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false;
  }
  return true;
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
