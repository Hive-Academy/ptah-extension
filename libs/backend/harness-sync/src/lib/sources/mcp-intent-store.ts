/**
 * `~/.ptah/mcp-installed.json` — the record of which MCP servers the user asked
 * Ptah to install, and for which targets.
 *
 * This file is the SOURCE OF TRUTH for the reconciler's MCP facet, and it
 * already existed: `McpInstallManifestTracker` (cli-agent-runtime, deleted in
 * TASK_2026_278 Batch 2) wrote exactly this shape so that an uninstall knew
 * which config files to visit. Batch 2 promotes it from bookkeeping to
 * INTENT — the same file, the same location, now read on every reconcile as
 * "these servers should exist in these configs".
 *
 * Two consequences of keeping the old path and format:
 *
 * - Users upgrading do not lose their install records, so nothing has to be
 *   reinstalled and nothing already written becomes foreign.
 * - The store is user-global while manifests are per-workspace. That is the
 *   correct asymmetry: `~/.copilot/mcp-config.json` and `~/.codex/config.toml`
 *   are user-global too, and every workspace therefore agrees on the same
 *   desired MCP set instead of fighting over one file.
 *
 * Validated with zod at the file boundary; a malformed file reads as empty
 * rather than throwing, matching how a corrupt managed manifest is handled.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import type { McpInstallTarget, McpServerConfig } from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../fs/atomic-write';

const McpServerConfigSchema = z.union([
  z.object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.enum(['http', 'sse']),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
]);

const McpIntentEntrySchema = z.object({
  /** Registry name, e.g. `io.github.user/server`. Diagnostic + display only. */
  registryName: z.string(),
  targets: z.array(z.string()),
  installedAt: z.string(),
  config: McpServerConfigSchema,
});

const McpIntentFileSchema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), McpIntentEntrySchema),
});

export const MCP_INTENT_VERSION = 1;

/** One server the user wants installed, and where. */
export interface HarnessMcpIntent {
  /** Config key, e.g. `github`. Unique across the store. */
  serverKey: string;
  registryName: string;
  config: McpServerConfig;
  targets: McpInstallTarget[];
}

/** Default location: `~/.ptah/mcp-installed.json`. */
export function defaultMcpIntentPath(homeDir: string = homedir()): string {
  return join(homeDir, '.ptah', 'mcp-installed.json');
}

export class McpIntentStore {
  constructor(
    private readonly path: string = defaultMcpIntentPath(),
    private readonly warn: (message: string, detail?: unknown) => void = () =>
      undefined,
  ) {}

  /** Every recorded intent, sorted by key so the desired state is stable. */
  list(): HarnessMcpIntent[] {
    const file = this.read();
    return Object.keys(file.servers)
      .sort()
      .map((serverKey) => {
        const entry = file.servers[serverKey];
        return {
          serverKey,
          registryName: entry.registryName,
          config: entry.config,
          targets: entry.targets as McpInstallTarget[],
        };
      });
  }

  /** True when Ptah recorded an intent for this key (drives `managedByPtah`). */
  has(serverKey: string): boolean {
    return serverKey in this.read().servers;
  }

  targetsFor(serverKey: string): McpInstallTarget[] {
    const entry = this.read().servers[serverKey];
    return entry === undefined ? [] : (entry.targets as McpInstallTarget[]);
  }

  /**
   * Record (or extend) an intent. Targets are merged, never replaced, so
   * installing the same server for a second CLI keeps the first.
   */
  record(
    serverKey: string,
    registryName: string,
    targets: McpInstallTarget[],
    config: McpServerConfig,
  ): void {
    const file = this.read();
    const existing = file.servers[serverKey];
    const merged =
      existing === undefined
        ? [...targets]
        : [...new Set([...existing.targets, ...targets])];

    file.servers[serverKey] = {
      registryName,
      targets: merged,
      installedAt: new Date().toISOString(),
      config,
    };
    this.write(file);
  }

  /**
   * Drop targets from an intent, deleting the entry when none remain. Omitting
   * `targets` means "everywhere", which is what a bare uninstall asks for.
   */
  forget(serverKey: string, targets?: McpInstallTarget[]): void {
    const file = this.read();
    const existing = file.servers[serverKey];
    if (existing === undefined) return;

    if (targets === undefined || targets.length === 0) {
      delete file.servers[serverKey];
    } else {
      const remaining = existing.targets.filter(
        (target) => !targets.includes(target as McpInstallTarget),
      );
      if (remaining.length === 0) delete file.servers[serverKey];
      else file.servers[serverKey] = { ...existing, targets: remaining };
    }
    this.write(file);
  }

  private read(): z.infer<typeof McpIntentFileSchema> {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf-8');
    } catch {
      return { version: MCP_INTENT_VERSION, servers: {} };
    }
    try {
      return McpIntentFileSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      this.warn(
        '[harness-sync] MCP intent store unreadable, treating as empty',
        {
          path: this.path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return { version: MCP_INTENT_VERSION, servers: {} };
    }
  }

  /**
   * Atomic + retried (`fs/atomic-write.ts`).
   *
   * Losing this file is losing the DESIRED STATE for every MCP server the user
   * installed, so a transient Windows sharing violation must not be the end of
   * the attempt. Failure stays a warning rather than a throw: the config file
   * the facet writes is the thing the CLI actually reads, and an install whose
   * bookkeeping failed is better than an install that threw halfway.
   */
  private write(file: z.infer<typeof McpIntentFileSchema>): void {
    try {
      atomicWriteWithRetry(this.path, `${JSON.stringify(file, null, 2)}\n`);
    } catch (error: unknown) {
      this.warn('[harness-sync] Failed to persist the MCP intent store', {
        path: this.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
