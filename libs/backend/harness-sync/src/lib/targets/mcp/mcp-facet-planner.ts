/**
 * Plan and apply for the MCP facet, shared by every target that has one.
 *
 * Split out of the targets because MCP is the one artifact family whose
 * "on disk" state is not a path: five servers live as five keys inside one JSON
 * object or one TOML document. The ownership reasoning is identical to a
 * skill's — desired vs. manifest vs. actual — but every read and write goes
 * through {@link IHarnessMcpFacet} instead of the filesystem.
 *
 * The invariant that makes E18 hold: a server key present in the config file
 * but absent from the manifest is never written, moved or deleted by any code
 * path here.
 *
 * It is only REPORTED when it collides — when the key is one the desired state
 * also wants. A user's other servers are not a finding: `.vscode/mcp.json`
 * holding four servers the user installed by hand is a normal config file, not
 * four foreign paths, and listing them made `ptah harness doctor` open with
 * four problems in a workspace that had none. `foreign` means "Ptah wanted this
 * name and refused to take it", which is actionable; "this file contains other
 * keys" is not.
 */

import type { HarnessDesiredMcpServer } from '../../manifest/desired-state.types';
import {
  entrySourceHash,
  managedEntry,
  type ManagedEntries,
} from '../../manifest-store/managed-manifest';
import type {
  HarnessApplyResult,
  HarnessPlanRemove,
  HarnessPlanWrite,
} from '../harness-target.port';
import { hashMcpConfig } from './mcp-json-format';
import { mcpEntryKey, type IHarnessMcpFacet } from './mcp-facet.port';

export interface McpFacetPlan {
  writes: HarnessPlanWrite[];
  removals: HarnessPlanRemove[];
  foreign: string[];
  /**
   * Desired server keys already occupied by an entry no manifest owns. Always
   * a subset of {@link foreign}, and — as everywhere else in this lib — also
   * counted as `missing`, because the server Ptah was asked to install is not
   * installed.
   */
  blocked: string[];
  unchanged: number;
  /** Manifest keys this facet is responsible for, for the removal sweep. */
  ownedKeys: Set<string>;
  expected: number;
}

export function emptyMcpFacetPlan(): McpFacetPlan {
  return {
    writes: [],
    removals: [],
    foreign: [],
    blocked: [],
    unchanged: 0,
    ownedKeys: new Set(),
    expected: 0,
  };
}

/**
 * Diff the desired MCP servers for one target against its config file.
 *
 * `desired` must already be filtered to the servers whose `targets` include
 * this target — a server the user installed for Cursor only must not appear in
 * Codex's config just because both targets were reconciled in one pass.
 */
export function planMcpFacet(
  facet: IHarnessMcpFacet,
  desired: HarnessDesiredMcpServer[],
  workspaceRoot: string,
  baseEntries: ManagedEntries,
): McpFacetPlan {
  const plan = emptyMcpFacetPlan();
  const configRel = facet.configRelPath();

  if (facet.configPath(workspaceRoot) === null) {
    // Workspace-scoped config with no workspace open. Nothing is desired and
    // nothing can be read, so this is a clean no-op rather than a failure.
    return plan;
  }

  const actual = readActual(facet, workspaceRoot);
  plan.expected = desired.length;

  for (const server of desired) {
    const relPath = mcpEntryKey(configRel, server.serverKey);
    plan.ownedKeys.add(relPath);

    const onDisk = actual.get(server.serverKey);
    const owned = baseEntries[relPath];

    if (onDisk === undefined) {
      plan.writes.push(
        writeFor(relPath, server, 'create', /* overwritesLocalEdit */ false),
      );
      continue;
    }
    if (owned === undefined) {
      // The user already has a server under the name Ptah wants. Not touched,
      // and reported in both places: the refusal, and the resulting gap.
      plan.foreign.push(relPath);
      plan.blocked.push(relPath);
      continue;
    }
    if (entrySourceHash(owned) !== server.contentHash) {
      plan.writes.push(writeFor(relPath, server, 'update', false));
      continue;
    }
    if (onDisk !== owned.hash) {
      plan.writes.push(writeFor(relPath, server, 'update', true));
      continue;
    }
    plan.unchanged++;
  }

  // Owned keys the user no longer wants here. Scoped to THIS config file, so a
  // partial reconcile of one target cannot reap another target's entries.
  for (const relPath of Object.keys(baseEntries)) {
    if (plan.ownedKeys.has(relPath)) continue;
    if (!relPath.startsWith(`${configRel}#`)) continue;
    plan.removals.push({
      relPath,
      kind: 'mcp',
      isDirectory: false,
      mcpServerKey: relPath.slice(configRel.length + 1),
    });
  }

  // Deliberately no sweep of the file's OTHER keys. They are the user's own
  // servers, they are not desired, nothing here can touch them, and naming them
  // in a health report turns an ordinary `.vscode/mcp.json` into four findings
  // a user cannot action. Only a collision — handled above — is worth saying.
  return plan;
}

/** Execute the MCP half of a plan, merging into the target's apply result. */
export async function applyMcpFacet(
  facet: IHarnessMcpFacet,
  writes: HarnessPlanWrite[],
  removals: HarnessPlanRemove[],
  workspaceRoot: string,
  result: HarnessApplyResult,
): Promise<void> {
  for (const removal of removals) {
    if (removal.mcpServerKey === undefined) continue;
    try {
      await facet.remove(workspaceRoot, removal.mcpServerKey);
      result.removed.push(removal.relPath);
    } catch (error: unknown) {
      result.writeFailed.push({
        relPath: removal.relPath,
        reason: `failed to remove MCP entry: ${describe(error)}`,
      });
    }
  }

  for (const write of writes) {
    if (write.mcp === undefined) continue;
    try {
      await facet.write(workspaceRoot, write.mcp.serverKey, write.mcp.config);
      result.written[write.relPath] = managedEntry(
        write.hash,
        write.source,
        'mcp',
      );
      if (write.overwritesLocalEdit) {
        result.overwrittenLocalEdit.push(write.relPath);
      }
    } catch (error: unknown) {
      result.writeFailed.push({
        relPath: write.relPath,
        reason: describe(error),
      });
    }
  }
}

/** Server key -> content hash of what is currently in the config file. */
function readActual(
  facet: IHarnessMcpFacet,
  workspaceRoot: string,
): Map<string, string> {
  const hashes = new Map<string, string>();
  try {
    for (const [serverKey, config] of facet.readAll(workspaceRoot)) {
      hashes.set(serverKey, hashMcpConfig(config));
    }
  } catch {
    // A config file too broken to read leaves `actual` empty, which makes every
    // desired entry a `create`. The facet's write is read-modify-write, so the
    // user's unparseable content is still what decides the outcome there.
  }
  return hashes;
}

function writeFor(
  relPath: string,
  server: HarnessDesiredMcpServer,
  reason: 'create' | 'update',
  overwritesLocalEdit: boolean,
): HarnessPlanWrite {
  return {
    relPath,
    kind: 'mcp',
    source: server.registryName,
    hash: server.contentHash,
    isDirectory: false,
    reason,
    overwritesLocalEdit,
    mcp: { serverKey: server.serverKey, config: server.config },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
