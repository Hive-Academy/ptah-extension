/**
 * `~/.ptah/mcp-installed.json` — the record of which MCP servers the user asked
 * Ptah to install, for which targets, and for WHICH WORKSPACE.
 *
 * This file is the SOURCE OF TRUTH for the reconciler's MCP facet. Version 1
 * recorded every install user-globally, so a server added while working in
 * workspace A was written into every other workspace's config files at that
 * workspace's next reconcile. Version 2 (TASK_2026_853, D-1) records each install
 * against a scope:
 *
 * - `workspaces[workspaceKey]` — the default. Applies only when reconciling that
 *   workspace. `workspaceKey` is the canonical root from
 *   {@link resolveHarnessWorkspaceRoot}, the same normalization the reconciler
 *   keys its lock and manifest on, so a sub-directory cwd and the root agree.
 * - `global` — an explicit opt-in. Applies in every workspace.
 *
 * ## v1 retirement
 *
 * A v1 file cannot say which workspace an install belonged to. Guessing
 * "global" would keep today's leak alive, and guessing "the current workspace"
 * would be wrong for every other one, so every v1 server is mapped into
 * `retired` instead (D-D3). Retired servers are never desired anywhere; the
 * resolver reports their keys so the reconciler removes only proven copies.
 * The mapping happens on read, and the first write persists the v2 shape.
 *
 * ## Failure behaviour
 *
 * Validated with zod at the file boundary. A missing, corrupt or unknown-version
 * file reads as EMPTY — never as global intent, which is the one reading that
 * would widen an install to every workspace.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { z } from 'zod';
import type {
  CapabilityScope,
  McpInstallTarget,
  McpServerConfig,
} from '@ptah-extension/shared';
import { atomicWriteWithRetry } from '../fs/atomic-write';
import { resolveHarnessWorkspaceRoot } from '../workspace/workspace-root';

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

const McpIntentEntryV1Schema = z.object({
  registryName: z.string(),
  targets: z.array(z.string()),
  installedAt: z.string(),
  config: McpServerConfigSchema,
});

const McpIntentFileV1Schema = z.object({
  version: z.literal(1),
  servers: z.record(z.string(), McpIntentEntryV1Schema),
});

const TargetsBucketSchema = z.object({ targets: z.array(z.string()) });

const WorkspaceBucketSchema = z.object({
  /** The canonical root as resolved, kept for display and diagnostics. */
  root: z.string(),
  targets: z.array(z.string()),
});

const McpIntentServerV2Schema = z.object({
  /** Registry name, e.g. `io.github.user/server`. Diagnostic + display only. */
  registryName: z.string(),
  config: McpServerConfigSchema,
  installedAt: z.string(),
  global: TargetsBucketSchema.optional(),
  workspaces: z.record(z.string(), WorkspaceBucketSchema).optional(),
});

const McpRetiredServerSchema = z.object({
  registryName: z.string(),
  targets: z.array(z.string()),
  config: McpServerConfigSchema,
  retiredAt: z.string(),
});

const McpIntentFileV2Schema = z.object({
  version: z.literal(2),
  servers: z.record(z.string(), McpIntentServerV2Schema),
  retired: z.record(z.string(), McpRetiredServerSchema),
});

const McpIntentFileSchema = z.discriminatedUnion('version', [
  McpIntentFileV1Schema,
  McpIntentFileV2Schema,
]);

type McpIntentFileV2 = z.infer<typeof McpIntentFileV2Schema>;
type McpIntentServerV2 = z.infer<typeof McpIntentServerV2Schema>;

export const MCP_INTENT_VERSION = 2;

/** One server that applies to a workspace, and the targets it applies to. */
export interface HarnessMcpIntent {
  /** Config key, e.g. `github`. Unique across the store. */
  serverKey: string;
  registryName: string;
  config: McpServerConfig;
  targets: McpInstallTarget[];
}

/** A server carried over from a v1 file. Never desired; see the file header. */
export interface RetiredMcpIntent extends HarnessMcpIntent {
  retiredAt: string;
}

/** Input of {@link McpIntentStore.record}. */
export interface McpIntentRecordInput {
  serverKey: string;
  registryName: string;
  config: McpServerConfig;
  targets: McpInstallTarget[];
  scope: CapabilityScope;
  /** Required when `scope` is `'workspace'`. */
  workspaceRoot?: string;
}

/** Which record {@link McpIntentStore.forget} drops targets from. */
export interface McpIntentForgetInput {
  scope: CapabilityScope;
  /** Required when `scope` is `'workspace'`. */
  workspaceRoot?: string;
  /** Omitted or empty = every target in that record. */
  targets?: McpInstallTarget[];
}

export type McpIntentScopeErrorCode =
  | 'workspace-root-required'
  | 'not-recorded';

/**
 * A scoped call the store refuses: a workspace record with no workspace, or a
 * `makeGlobal` for a server this workspace never recorded. Thrown before any
 * write, so a refused call leaves the file untouched.
 */
export class McpIntentScopeError extends Error {
  constructor(
    readonly code: McpIntentScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'McpIntentScopeError';
  }
}

/** Default location: `~/.ptah/mcp-installed.json`. */
export function defaultMcpIntentPath(homeDir: string = homedir()): string {
  return join(homeDir, '.ptah', 'mcp-installed.json');
}

/**
 * The key a workspace is recorded under: the canonical harness root, folded to
 * lower case on Windows where paths compare case-insensitively (`isSamePath`).
 */
export function mcpIntentWorkspaceKey(workspaceRoot: string): string {
  const root = resolveHarnessWorkspaceRoot(workspaceRoot);
  return process.platform === 'win32' ? root.toLowerCase() : root;
}

function emptyFile(): McpIntentFileV2 {
  return { version: 2, servers: {}, retired: {} };
}

function union(...lists: readonly string[][]): McpInstallTarget[] {
  return [...new Set(lists.flat())] as McpInstallTarget[];
}

function hasRoot(workspaceRoot: string | undefined): workspaceRoot is string {
  return workspaceRoot !== undefined && workspaceRoot.trim() !== '';
}

function requireRoot(
  workspaceRoot: string | undefined,
  action: string,
): string {
  if (!hasRoot(workspaceRoot)) {
    throw new McpIntentScopeError(
      'workspace-root-required',
      `A workspace-scoped MCP ${action} needs an open workspace folder.`,
    );
  }
  return workspaceRoot;
}

export class McpIntentStore {
  constructor(
    private readonly path: string = defaultMcpIntentPath(),
    private readonly warn: (message: string, detail?: unknown) => void = () =>
      undefined,
  ) {}

  /**
   * Every server that applies to this workspace: global targets merged with
   * this workspace's own, sorted by key so the desired state is stable. An
   * empty root yields only the global entries.
   */
  listFor(workspaceRoot: string): HarnessMcpIntent[] {
    const file = this.read();
    const key = hasRoot(workspaceRoot)
      ? mcpIntentWorkspaceKey(workspaceRoot)
      : undefined;
    const intents: HarnessMcpIntent[] = [];
    for (const serverKey of Object.keys(file.servers).sort()) {
      const entry = file.servers[serverKey];
      const local = key === undefined ? undefined : entry.workspaces?.[key];
      const targets = union(
        entry.global?.targets ?? [],
        local?.targets ?? [],
      );
      if (targets.length === 0) continue;
      intents.push({
        serverKey,
        registryName: entry.registryName,
        config: entry.config,
        targets,
      });
    }
    return intents;
  }

  /** Every retired (v1) server, sorted by key. */
  listRetired(): RetiredMcpIntent[] {
    const file = this.read();
    return Object.keys(file.retired)
      .sort()
      .map((serverKey) => {
        const entry = file.retired[serverKey];
        return {
          serverKey,
          registryName: entry.registryName,
          config: entry.config,
          targets: entry.targets as McpInstallTarget[],
          retiredAt: entry.retiredAt,
        };
      });
  }

  /**
   * True when Ptah recorded this key in any scope, or retired it from v1.
   * Either way its config entries are Ptah's, which is what `managedByPtah`
   * reports.
   */
  has(serverKey: string): boolean {
    const file = this.read();
    return serverKey in file.servers || serverKey in file.retired;
  }

  /**
   * How this workspace sees the key: `'global'` when a global record exists
   * (it applies here whatever else is recorded), `'workspace'` when only this
   * workspace recorded it, `undefined` when neither did.
   */
  scopeOf(
    serverKey: string,
    workspaceRoot: string,
  ): CapabilityScope | undefined {
    const entry = this.read().servers[serverKey];
    if (entry === undefined) return undefined;
    if (entry.global !== undefined) return 'global';
    if (!hasRoot(workspaceRoot)) return undefined;
    return entry.workspaces?.[mcpIntentWorkspaceKey(workspaceRoot)] ===
      undefined
      ? undefined
      : 'workspace';
  }

  /** The targets of exactly one record (global, or one workspace's). */
  targetsIn(
    serverKey: string,
    scope: CapabilityScope,
    workspaceRoot?: string,
  ): McpInstallTarget[] {
    const entry = this.read().servers[serverKey];
    if (entry === undefined) return [];
    if (scope === 'global') {
      return (entry.global?.targets ?? []) as McpInstallTarget[];
    }
    if (!hasRoot(workspaceRoot)) return [];
    return (entry.workspaces?.[mcpIntentWorkspaceKey(workspaceRoot)]?.targets ??
      []) as McpInstallTarget[];
  }

  /**
   * Record (or extend) an intent in one scope. Targets are merged within that
   * scope, never replaced, so installing the same server for a second CLI
   * keeps the first. Throws {@link McpIntentScopeError} for a workspace record
   * without a workspace root.
   *
   * A retired entry for the same key is left in place: retirement only guards
   * how stale v1 copies are removed elsewhere, and an active record wins
   * wherever it applies.
   */
  record(input: McpIntentRecordInput): void {
    const root =
      input.scope === 'workspace'
        ? requireRoot(input.workspaceRoot, 'install')
        : undefined;
    const file = this.read();
    const existing = file.servers[input.serverKey];
    const next: McpIntentServerV2 = {
      registryName: input.registryName,
      config: input.config,
      installedAt: new Date().toISOString(),
      ...(existing?.global === undefined ? {} : { global: existing.global }),
      ...(existing?.workspaces === undefined
        ? {}
        : { workspaces: { ...existing.workspaces } }),
    };

    if (root === undefined) {
      next.global = {
        targets: union(existing?.global?.targets ?? [], input.targets),
      };
    } else {
      const key = mcpIntentWorkspaceKey(root);
      const workspaces = next.workspaces ?? {};
      workspaces[key] = {
        root: resolveHarnessWorkspaceRoot(root),
        targets: union(workspaces[key]?.targets ?? [], input.targets),
      };
      next.workspaces = workspaces;
    }

    file.servers[input.serverKey] = next;
    this.write(file);
  }

  /**
   * Drop targets from one scope's record, deleting that record when none
   * remain and the server when no record remains. Other workspaces' records
   * and the global record are untouched unless named.
   */
  forget(serverKey: string, input: McpIntentForgetInput): void {
    const root =
      input.scope === 'workspace'
        ? requireRoot(input.workspaceRoot, 'uninstall')
        : undefined;
    const file = this.read();
    const existing = file.servers[serverKey];
    if (existing === undefined) return;

    const drop = (targets: string[]): string[] =>
      input.targets === undefined || input.targets.length === 0
        ? []
        : targets.filter(
            (target) => !input.targets?.includes(target as McpInstallTarget),
          );

    const next: McpIntentServerV2 = { ...existing };
    if (root === undefined) {
      if (existing.global === undefined) return;
      const remaining = drop(existing.global.targets);
      if (remaining.length === 0) delete next.global;
      else next.global = { targets: remaining };
    } else {
      const key = mcpIntentWorkspaceKey(root);
      const bucket = existing.workspaces?.[key];
      if (bucket === undefined) return;
      const workspaces = { ...existing.workspaces };
      const remaining = drop(bucket.targets);
      if (remaining.length === 0) delete workspaces[key];
      else workspaces[key] = { ...bucket, targets: remaining };
      if (Object.keys(workspaces).length === 0) delete next.workspaces;
      else next.workspaces = workspaces;
    }

    if (next.global === undefined && next.workspaces === undefined) {
      delete file.servers[serverKey];
    } else {
      file.servers[serverKey] = next;
    }
    this.write(file);
  }

  /**
   * Promote this workspace's record to global, adding the opt-in home targets
   * (#19). The workspace record is folded into the global one and removed;
   * other workspaces' records stay, so forgetting the global record later
   * leaves them as they were. Returns the global targets after the change.
   *
   * Throws {@link McpIntentScopeError} without a root, and when neither this
   * workspace nor the global scope recorded the key.
   */
  makeGlobal(
    serverKey: string,
    workspaceRoot: string,
    extraHomeTargets: readonly McpInstallTarget[],
  ): McpInstallTarget[] {
    const root = requireRoot(workspaceRoot, 'make-global');
    const file = this.read();
    const existing = file.servers[serverKey];
    const key = mcpIntentWorkspaceKey(root);
    const local = existing?.workspaces?.[key];
    if (
      existing === undefined ||
      (local === undefined && existing.global === undefined)
    ) {
      throw new McpIntentScopeError(
        'not-recorded',
        `MCP server "${serverKey}" is not installed in this workspace.`,
      );
    }

    const targets = union(
      existing.global?.targets ?? [],
      local?.targets ?? [],
      [...extraHomeTargets],
    );
    const workspaces = { ...existing.workspaces };
    delete workspaces[key];
    const next: McpIntentServerV2 = {
      registryName: existing.registryName,
      config: existing.config,
      installedAt: existing.installedAt,
      global: { targets },
    };
    if (Object.keys(workspaces).length > 0) next.workspaces = workspaces;
    file.servers[serverKey] = next;
    this.write(file);
    return targets;
  }

  private read(): McpIntentFileV2 {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf-8');
    } catch {
      // Missing file: nothing recorded yet. Not a degradation.
      return emptyFile();
    }
    let parsed: z.infer<typeof McpIntentFileSchema>;
    try {
      parsed = McpIntentFileSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      // Corrupt or unknown-version file: empty, never global (see header).
      this.warn(
        '[harness-sync] MCP intent store unreadable, treating as empty',
        {
          path: this.path,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return emptyFile();
    }
    return parsed.version === 2 ? parsed : retireV1(parsed.servers);
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
  private write(file: McpIntentFileV2): void {
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

/** Every v1 server becomes retired; no v1 server is active anywhere (D-D3). */
function retireV1(
  servers: z.infer<typeof McpIntentFileV1Schema>['servers'],
): McpIntentFileV2 {
  const retiredAt = new Date().toISOString();
  const file = emptyFile();
  for (const [serverKey, entry] of Object.entries(servers)) {
    file.retired[serverKey] = {
      registryName: entry.registryName,
      targets: entry.targets,
      config: entry.config,
      retiredAt,
    };
  }
  return file;
}
