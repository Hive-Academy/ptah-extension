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
import { homedir } from 'os';
import { join } from 'path';
import type {
  HarnessTargetId,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../../fs/atomic-write';
import { withWindowsRetrySync } from '../../fs/windows-retry';
import { withMcpConfigLock } from './mcp-config-lock';
import type { IHarnessMcpFacet } from './mcp-facet.port';
import { configToJson, DEFAULT_URL_KEY, jsonToConfig } from './mcp-json-format';

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
  /** Overridable so specs can point `home` at a temp directory. */
  homeDir?: string;
}

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

  readAll(workspaceRoot: string): Map<string, McpServerConfig> {
    const servers = new Map<string, McpServerConfig>();
    const path = this.configPath(workspaceRoot);
    if (path === null) return servers;

    const root = this.readServersObject(path);
    for (const [key, value] of Object.entries(root)) {
      if (typeof value !== 'object' || value === null) continue;
      servers.set(key, jsonToConfig(value as Record<string, unknown>));
    }
    return servers;
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
