/**
 * The MCP facet for every target whose config file is JSON.
 *
 * Five of the six files differ only in four values — where they live, what
 * their root key is called, whether entries carry a `type` field, and how they
 * spell a remote endpoint — so one parameterised facet covers Claude
 * (`{ws}/.mcp.json`), Cursor (`{ws}/.cursor/mcp.json`), VS Code
 * (`{ws}/.vscode/mcp.json`), Copilot (`~/.copilot/mcp-config.json`) and
 * Antigravity (`~/.gemini/config/mcp_config.json`). Codex is the exception and
 * gets its own TOML facet.
 *
 * Read-modify-write, never wholesale replace: the file belongs to the user and
 * usually contains servers Ptah knows nothing about. Only the one key being
 * installed or removed is touched, and the write is atomic (temp + rename) with
 * a `.bak` of the previous contents, because a torn MCP config is a tool that
 * refuses to start.
 *
 * Atomic is not the same as exclusive, and both are required — see
 * `mcp-config-lock.ts` for the read-modify-write two writers would otherwise
 * interleave.
 */

import { copyFileSync, existsSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type {
  HarnessTargetId,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../../fs/atomic-write';
import {
  describeError,
  errorCode,
  withWindowsRetrySync,
} from '../../fs/windows-retry';
import { withMcpConfigLock } from './mcp-config-lock';
import type {
  IHarnessMcpFacet,
  McpFacetInspection,
  McpSourceStatus,
} from './mcp-facet.port';
import {
  configToJson,
  DEFAULT_URL_KEY,
  jsonToConfig,
  type McpJsonDialect,
} from './mcp-json-format';

export interface JsonMcpFacetOptions {
  target: HarnessTargetId;
  mcpTarget: McpInstallTarget;
  /**
   * Config location. A `workspace` scope resolves under the workspace root; a
   * `home` scope resolves under the user's home directory and is recorded in
   * the manifest with a leading `~/`.
   */
  scope: 'workspace' | 'home';
  /** Path segments below the scope root, e.g. `['.cursor', 'mcp.json']`. */
  segments: string[];
  /** Object key holding the server map: `mcpServers` everywhere but VS Code. */
  rootKey: string;
  /** Whether each entry carries an explicit `type` discriminant. */
  includeType: boolean;
  /**
   * Key a remote server's endpoint is written under. `url` everywhere but
   * Antigravity, which reads `serverUrl` and ignores `url` entirely.
   */
  urlKey?: string;
  /**
   * How entry fields are spelled. `opencode` renames the transport, the command
   * and the environment all at once — see {@link McpJsonDialect}.
   */
  dialect?: McpJsonDialect;
  /** Overridable so specs can point `home` at a temp directory. */
  homeDir?: string;
  /**
   * How {@link JsonMcpFacet.inspect} waits before re-reading an empty file
   * (see {@link readJsonStatus}). Defaults to a timer for the given
   * milliseconds, which never blocks the event loop. Overridable so specs can
   * change the file between the two reads without a real delay.
   */
  waitBeforeEmptyReread?: (ms: number) => Promise<void>;
}

/** How long `inspect` waits before re-reading a config file that read empty. */
export const EMPTY_CONFIG_REREAD_DELAY_MS = 50;

export class JsonMcpFacet implements IHarnessMcpFacet {
  readonly target: HarnessTargetId;
  readonly mcpTarget: McpInstallTarget;

  constructor(private readonly options: JsonMcpFacetOptions) {
    this.target = options.target;
    this.mcpTarget = options.mcpTarget;
  }

  configRelPath(): string {
    const joined = this.options.segments.join('/');
    return this.options.scope === 'home' ? `~/${joined}` : joined;
  }

  configPath(workspaceRoot: string): string | null {
    if (this.options.scope === 'home') {
      return join(this.options.homeDir ?? homedir(), ...this.options.segments);
    }
    if (workspaceRoot === '') return null;
    return join(workspaceRoot, ...this.options.segments);
  }

  canonicalize(config: McpServerConfig): McpServerConfig {
    return jsonToConfig(
      configToJson(
        config,
        this.options.includeType,
        this.options.urlKey ?? DEFAULT_URL_KEY,
        this.options.dialect ?? 'standard',
      ),
    );
  }

  readAll(workspaceRoot: string): Map<string, McpServerConfig> {
    const path = this.configPath(workspaceRoot);
    if (path === null) return new Map();
    return toServerMap(this.readServersObject(path));
  }

  async inspect(workspaceRoot: string): Promise<McpFacetInspection> {
    const path = this.configPath(workspaceRoot);
    if (path === null) return { status: 'missing', servers: new Map() };

    const read = await readJsonStatus(
      path,
      this.options.waitBeforeEmptyReread ?? delay,
    );
    if (read.status !== 'ok') {
      return {
        status: read.status,
        ...(read.error === undefined ? {} : { error: read.error }),
        servers: new Map(),
      };
    }

    const declared = read.json[this.options.rootKey];
    if (declared === undefined) return { status: 'ok', servers: new Map() };
    if (
      typeof declared !== 'object' ||
      declared === null ||
      Array.isArray(declared)
    ) {
      return {
        status: 'error',
        error: `"${this.options.rootKey}" in ${path} is not an object`,
        servers: new Map(),
      };
    }
    return {
      status: 'ok',
      servers: toServerMap(declared as Record<string, unknown>),
    };
  }

  write(
    workspaceRoot: string,
    serverKey: string,
    config: McpServerConfig,
  ): Promise<void> {
    return this.mutate(workspaceRoot, (servers) => {
      servers[serverKey] = configToJson(
        config,
        this.options.includeType,
        this.options.urlKey ?? DEFAULT_URL_KEY,
        this.options.dialect ?? 'standard',
      );
      return true;
    });
  }

  remove(workspaceRoot: string, serverKey: string): Promise<void> {
    return this.mutate(workspaceRoot, (servers) => {
      if (!(serverKey in servers)) return false;
      delete servers[serverKey];
      return true;
    });
  }

  /**
   * Read the whole file, hand the caller only the server map, and write back
   * only when the caller reports a change.
   *
   * Skipping the write on a no-op is what keeps `.mcp.json` out of the user's
   * git status after an idempotent reconcile.
   *
   * The read AND the write happen inside {@link withMcpConfigLock}. Reading
   * outside it would defeat the whole point: the lost update is a stale READ
   * being written back, not a torn write.
   */
  private mutate(
    workspaceRoot: string,
    change: (servers: Record<string, unknown>) => boolean,
  ): Promise<void> {
    const path = this.configPath(workspaceRoot);
    if (path === null) {
      return Promise.reject(
        new Error(
          `MCP config path for "${this.target}" needs an open workspace`,
        ),
      );
    }

    return withMcpConfigLock(path, () => {
      const fileConfig = this.readJson(path);
      const existing = fileConfig[this.options.rootKey];
      const servers: Record<string, unknown> =
        typeof existing === 'object' && existing !== null
          ? { ...(existing as Record<string, unknown>) }
          : {};

      if (!change(servers)) return Promise.resolve();

      fileConfig[this.options.rootKey] = servers;
      this.writeJson(path, fileConfig);
      return Promise.resolve();
    });
  }

  private readServersObject(path: string): Record<string, unknown> {
    const parsed = this.readJson(path)[this.options.rootKey];
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  }

  /**
   * The legacy read: every failure — absent, unreadable, malformed — is `{}`.
   * The reconciler and the write path depend on that; {@link inspect} is the
   * caller that needs to tell them apart, and reads through
   * {@link readJsonStatus} instead.
   */
  private readJson(path: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Back up, then write atomically with the Windows retry (`fs/atomic-write.ts`).
   *
   * The retry is the half that used to be missing here: a `renameSync` over an
   * `.mcp.json` an editor or a scanner holds open is EPERM on Windows, and the
   * unretried version surfaced that as a permanent `write-failed` for a server
   * the very next attempt would have installed (E21).
   */
  private writeJson(path: string, config: Record<string, unknown>): void {
    if (existsSync(path)) {
      try {
        withWindowsRetrySync(() => copyFileSync(path, `${path}.bak`));
      } catch {
        // A backup we could not take is not a reason to refuse the write; the
        // temp+rename below is what actually protects against a torn file.
      }
    }
    atomicWriteWithRetry(path, `${JSON.stringify(config, null, 2)}\n`);
  }
}

interface JsonConfigRead {
  status: McpSourceStatus;
  /** The parsed top-level object; `{}` unless `status` is `ok`. */
  json: Record<string, unknown>;
  error?: string;
}

/**
 * Read and parse one JSON config file, keeping the reason a read failed.
 *
 * Only ENOENT on the first read is `missing`. Anything that does not parse to
 * an object is `error`.
 *
 * **An empty file is read twice.** A non-atomic writer (an editor, a sync
 * client, opencode itself) truncates before it writes, so an empty read may be
 * a torn write rather than an empty config. The capability-toggle store calls
 * any 0-byte item file `error` outright (implementation-plan.md C2), because
 * Ptah writes those files itself, atomically, so an empty one can only be
 * damage. These MCP files belong to third-party tools, and an empty one is also
 * what a user's freshly created config looks like. Failing it closed forever
 * would mark a legitimate "declares nothing" as unknown. So after
 * {@link EMPTY_CONFIG_REREAD_DELAY_MS} the file is read again:
 *
 * - still empty → `ok` with no servers (a persistently empty file really does
 *   declare nothing);
 * - content now → that content is parsed like any first read;
 * - the re-read fails, ENOENT included → `error` (the file changed under us,
 *   so its contents are unknown).
 *
 * Whitespace-only counts as empty.
 */
async function readJsonStatus(
  path: string,
  wait: (ms: number) => Promise<void>,
): Promise<JsonConfigRead> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'missing', json: {} };
    return { status: 'error', json: {}, error: describeError(error) };
  }

  if (text.trim() === '') {
    await wait(EMPTY_CONFIG_REREAD_DELAY_MS);
    try {
      text = await readFile(path, 'utf-8');
    } catch (error) {
      return { status: 'error', json: {}, error: describeError(error) };
    }
    if (text.trim() === '') return { status: 'ok', json: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: 'error', json: {}, error: describeError(error) };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      status: 'error',
      json: {},
      error: `${path} does not contain a JSON object`,
    };
  }
  return { status: 'ok', json: parsed as Record<string, unknown> };
}

/**
 * Resolve after `ms`. `inspect` runs on the extension host and Electron main
 * thread, so the re-read wait is a timer and never blocks the event loop.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every entry of a server map that is an object, as a config. */
function toServerMap(
  declared: Record<string, unknown>,
): Map<string, McpServerConfig> {
  const servers = new Map<string, McpServerConfig>();
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value !== 'object' || value === null) continue;
    servers.set(key, jsonToConfig(value as Record<string, unknown>));
  }
  return servers;
}
