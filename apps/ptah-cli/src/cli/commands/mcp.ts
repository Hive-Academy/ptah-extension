/**
 * `ptah mcp` command — MCP Server Directory operations (search / details /
 * install / uninstall / list / popular).
 *
 * Backed by the **shared** `McpDirectoryRpcHandlers`
 * (`libs/backend/rpc-handlers`) so VS Code, Electron, and the CLI all
 * dispatch identical RPC verbs.
 *
 * Sub-commands (per task-description.md §3 `mcp *` table):
 *
 *   search <query>              RPC `mcpDirectory:search`
 *   details <name>              RPC `mcpDirectory:getDetails`
 *   install <name> --target X   RPC `mcpDirectory:getDetails` → `mcpDirectory:install`
 *                               (config derived from registry entry's
 *                                `version_detail.transports/packages`)
 *   uninstall <key> --target X  RPC `mcpDirectory:uninstall`
 *   list                        RPC `mcpDirectory:listInstalled`
 *   popular                     RPC `mcpDirectory:getPopular`
 *
 * Idempotency contract (`mcp.installed` / `mcp.uninstalled` payload):
 *   - `changed: bool` — true on first successful install per (key,target),
 *     false when the existing target config already matches the derived one
 *     (or when `mcpDirectory:listInstalled` shows the server is already there
 *     before we hit the install RPC).
 *
 * `--target` is constrained to the canonical 5-target enum
 * (`vscode|claude|cursor|gemini|copilot`) at the CLI layer; an invalid value
 * exits with `ExitCode.UsageError` BEFORE bootstrapping DI — matches the
 * "rejected fast" pattern used by `git discard --confirm`.
 */

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  InstalledMcpServer,
  McpDirectoryGetDetailsResult,
  McpDirectoryGetPopularResult,
  McpDirectoryInstallResult,
  McpDirectoryListInstalledResult,
  McpDirectorySearchResult,
  McpDirectoryUninstallResult,
  McpInstallTarget,
  McpRegistryEntry,
  McpServerConfig,
} from '@ptah-extension/shared';

export type McpSubcommand =
  | 'search'
  | 'details'
  | 'install'
  | 'uninstall'
  | 'list'
  | 'popular';

export interface McpOptions {
  subcommand: McpSubcommand;
  /** For `search` / `details` / `install`. */
  query?: string;
  /** For `details` / `install`: fully-qualified server name. */
  name?: string;
  /** For `uninstall`: server key as it appears in config files. */
  key?: string;
  /** For `install` / `uninstall`: target install location. */
  target?: string;
  /** For `search`: optional pagination limit. */
  limit?: number;
}

export interface McpStderrLike {
  write(chunk: string): boolean;
}

export interface McpExecuteHooks {
  stderr?: McpStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

/** Canonical install targets accepted by `--target`. */
const VALID_TARGETS: readonly McpInstallTarget[] = [
  'vscode',
  'claude',
  'cursor',
  'gemini',
  'copilot',
];

export async function execute(
  opts: McpOptions,
  globals: GlobalOptions,
  hooks: McpExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: McpStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'search':
        return await runSearch(opts, globals, formatter, stderr, engine);
      case 'details':
        return await runDetails(opts, globals, formatter, stderr, engine);
      case 'install':
        return await runInstall(opts, globals, formatter, stderr, engine);
      case 'uninstall':
        return await runUninstall(opts, globals, formatter, stderr, engine);
      case 'list':
        return await runList(globals, formatter, engine);
      case 'popular':
        return await runPopular(globals, formatter, engine);
      default:
        stderr.write(
          `ptah mcp: unknown sub-command '${String(opts.subcommand)}'\n`,
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

async function runSearch(
  opts: McpOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: McpStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.query || opts.query.trim().length === 0) {
    stderr.write('ptah mcp search: <query> is required\n');
    return ExitCode.UsageError;
  }
  const query = opts.query;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const params: { query: string; limit?: number } = { query };
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
      params.limit = opts.limit;
    }
    const result = await callRpc<McpDirectorySearchResult>(
      ctx.transport,
      'mcpDirectory:search',
      params,
    );
    await formatter.writeNotification('mcp.search', {
      query,
      servers: result?.servers ?? [],
      nextCursor: result?.nextCursor,
    });
    return ExitCode.Success;
  });
}

async function runDetails(
  opts: McpOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: McpStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.name || opts.name.trim().length === 0) {
    stderr.write('ptah mcp details: <name> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<McpDirectoryGetDetailsResult>(
      ctx.transport,
      'mcpDirectory:getDetails',
      { name: opts.name },
    );
    await formatter.writeNotification('mcp.details', toRecord(result));
    return ExitCode.Success;
  });
}

async function runInstall(
  opts: McpOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: McpStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.name || opts.name.trim().length === 0) {
    stderr.write('ptah mcp install: <name> is required\n');
    return ExitCode.UsageError;
  }
  const name = opts.name;
  const target = parseTarget(opts.target);
  if (target === null) {
    stderr.write(
      `ptah mcp install: --target is required and must be one of ${VALID_TARGETS.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const serverKey = deriveServerKey(name);

    // 1. Pull current installed list to compute idempotency.
    const before = await callRpc<McpDirectoryListInstalledResult>(
      ctx.transport,
      'mcpDirectory:listInstalled',
      {},
    );
    const beforeMatch = findInstalled(before?.servers ?? [], serverKey, target);

    // 2. Resolve registry details so we can derive a McpServerConfig.
    const entry = await callRpc<McpDirectoryGetDetailsResult>(
      ctx.transport,
      'mcpDirectory:getDetails',
      { name },
    );
    if (!entry || !entry.version_detail) {
      throw new Error(
        `mcpDirectory:getDetails returned no version_detail for "${name}"`,
      );
    }
    const config = generateConfig(entry);
    if (!config) {
      throw new Error(
        `Cannot derive an MCP server config for "${name}" — no usable transport found in version_detail`,
      );
    }

    // 3. If an entry already exists at the target with the same config,
    //    short-circuit and emit `changed: false`.
    if (beforeMatch && configsEqual(beforeMatch.config, config)) {
      await formatter.writeNotification('mcp.installed', {
        serverName: name,
        serverKey,
        target,
        changed: false,
        results: [
          {
            target,
            success: true,
            configPath: beforeMatch.configPath,
          },
        ],
      });
      return ExitCode.Success;
    }

    // 4. Run the install.
    const result = await callRpc<McpDirectoryInstallResult>(
      ctx.transport,
      'mcpDirectory:install',
      {
        serverName: name,
        serverKey,
        config,
        targets: [target],
      },
    );
    const results = result?.results ?? [];
    const failure = results.find((r) => !r.success);
    if (failure) {
      throw new Error(
        failure.error ?? `mcpDirectory:install failed for target ${target}`,
      );
    }

    // 5. Determine `changed` — false only if registry entry was already there
    //    AND configs differed (re-install with new config still counts as
    //    `changed: true`). When `beforeMatch` was null we always changed.
    const changed =
      beforeMatch === null ? true : !configsEqual(beforeMatch.config, config);

    await formatter.writeNotification('mcp.installed', {
      serverName: name,
      serverKey,
      target,
      changed,
      results,
    });
    return ExitCode.Success;
  });
}

async function runUninstall(
  opts: McpOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: McpStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.key || opts.key.trim().length === 0) {
    stderr.write('ptah mcp uninstall: <key> is required\n');
    return ExitCode.UsageError;
  }
  const key = opts.key;
  const target = parseTarget(opts.target);
  if (target === null) {
    stderr.write(
      `ptah mcp uninstall: --target is required and must be one of ${VALID_TARGETS.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    // Idempotency: if the server isn't installed at the target, return
    // `changed: false` without hitting the install service.
    const before = await callRpc<McpDirectoryListInstalledResult>(
      ctx.transport,
      'mcpDirectory:listInstalled',
      {},
    );
    const present = findInstalled(before?.servers ?? [], key, target);
    if (!present) {
      await formatter.writeNotification('mcp.uninstalled', {
        serverKey: key,
        target,
        changed: false,
        results: [],
      });
      return ExitCode.Success;
    }

    const result = await callRpc<McpDirectoryUninstallResult>(
      ctx.transport,
      'mcpDirectory:uninstall',
      { serverKey: key, targets: [target] },
    );
    const results = result?.results ?? [];
    const failure = results.find((r) => !r.success);
    if (failure) {
      throw new Error(
        failure.error ?? `mcpDirectory:uninstall failed for target ${target}`,
      );
    }
    await formatter.writeNotification('mcp.uninstalled', {
      serverKey: key,
      target,
      changed: true,
      results,
    });
    return ExitCode.Success;
  });
}

async function runList(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<McpDirectoryListInstalledResult>(
      ctx.transport,
      'mcpDirectory:listInstalled',
      {},
    );
    await formatter.writeNotification('mcp.list', {
      servers: result?.servers ?? [],
    });
    return ExitCode.Success;
  });
}

async function runPopular(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<McpDirectoryGetPopularResult>(
      ctx.transport,
      'mcpDirectory:getPopular',
      {},
    );
    await formatter.writeNotification('mcp.popular', {
      servers: result?.servers ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — kept module-private. Mirrors webview `mcp-directory-browser` so
// the derivation is identical regardless of which surface drives the install.
// ---------------------------------------------------------------------------

/**
 * Coerce a raw `--target` string into a strongly-typed `McpInstallTarget`,
 * returning `null` for any unrecognized value.
 */
function parseTarget(raw: string | undefined): McpInstallTarget | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return (VALID_TARGETS as readonly string[]).includes(trimmed)
    ? (trimmed as McpInstallTarget)
    : null;
}

/**
 * Last-segment-after-`/` (e.g. `"io.github.user/server-name"` → `"server-name"`).
 * Matches `mcp-directory-browser.component.ts#deriveServerKey`.
 */
function deriveServerKey(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] || name;
}

/**
 * Translate a registry entry's `version_detail` into a concrete `McpServerConfig`.
 * Mirrors `mcp-directory-browser.component.ts#generateConfig` — npm → npx,
 * pypi → uvx, docker → docker run, then http/sse fallback.
 */
function generateConfig(entry: McpRegistryEntry): McpServerConfig | null {
  const vd = entry.version_detail;
  if (!vd) return null;

  const stdioTransport = vd.transports.find((t) => t.type === 'stdio');
  const httpTransport = vd.transports.find((t) => t.type === 'http');
  const sseTransport = vd.transports.find((t) => t.type === 'sse');

  if (stdioTransport) {
    const npmPkg = vd.packages.find((p) => p.registry_name === 'npm');
    const pypiPkg = vd.packages.find((p) => p.registry_name === 'pypi');
    const dockerPkg = vd.packages.find((p) => p.registry_name === 'docker');

    if (npmPkg) {
      return { type: 'stdio', command: 'npx', args: ['-y', npmPkg.name] };
    }
    if (pypiPkg) {
      return { type: 'stdio', command: 'uvx', args: [pypiPkg.name] };
    }
    if (dockerPkg) {
      return {
        type: 'stdio',
        command: 'docker',
        args: ['run', '-i', '--rm', dockerPkg.name],
      };
    }
  }

  if (httpTransport?.url) {
    return { type: 'http', url: httpTransport.url };
  }

  if (sseTransport?.url) {
    return { type: 'sse', url: sseTransport.url };
  }

  return null;
}

function findInstalled(
  servers: readonly InstalledMcpServer[],
  serverKey: string,
  target: McpInstallTarget,
): InstalledMcpServer | null {
  for (const s of servers) {
    if (s.serverKey === serverKey && s.target === target) return s;
  }
  return null;
}

/**
 * Stable structural equality check for two `McpServerConfig` values. Two
 * configs match when their `type`, command/url, args, headers, and env
 * collections agree byte-for-byte — sufficient to suppress an idempotent
 * write that would otherwise rewrite the same JSON.
 */
function configsEqual(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.type !== b.type) return false;
  if (!recordsEqual(a.env, b.env)) return false;
  if (a.type === 'stdio' && b.type === 'stdio') {
    if (a.command !== b.command) return false;
    return arraysEqual(a.args, b.args);
  }
  if (
    (a.type === 'http' && b.type === 'http') ||
    (a.type === 'sse' && b.type === 'sse')
  ) {
    if (a.url !== b.url) return false;
    return recordsEqual(a.headers, b.headers);
  }
  return false;
}

function arraysEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  const aa = a ?? [];
  const bb = b ?? [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== bb[i]) return false;
  }
  return true;
}

function recordsEqual(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
): boolean {
  const aKeys = a ? Object.keys(a).sort() : [];
  const bKeys = b ? Object.keys(b).sort() : [];
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i];
    if ((a ?? {})[k] !== (b ?? {})[k]) return false;
  }
  return true;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
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
