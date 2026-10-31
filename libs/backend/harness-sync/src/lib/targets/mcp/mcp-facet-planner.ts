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

import {
  mcpRetiredItemId,
  type HarnessRetiredItemId,
  type HarnessRetiredKeptReason,
  type McpServerConfig,
} from '@ptah-extension/shared';
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
  /**
   * Owned server keys whose config entry no longer matches what Ptah wrote — a
   * hand edit. Kept as they are, never rewritten, and their manifest entry keeps
   * the old hash (D8). See `HarnessPlan.keptLocalEdit`.
   */
  keptLocalEdit: string[];
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
    keptLocalEdit: [],
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
  retiredServerKeys: readonly string[] = [],
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
    // What the file will read back as, not what was asked for: a dialect that
    // cannot spell `sse` must not make the same server an update every pass.
    const outputHash = hashMcpConfig(
      facet.canonicalize?.(server.config) ?? server.config,
    );

    if (onDisk === undefined) {
      plan.writes.push(writeFor(relPath, server, outputHash, 'create'));
      continue;
    }
    if (owned === undefined) {
      // The user already has a server under the name Ptah wants. Not touched,
      // and reported in both places: the refusal, and the resulting gap.
      plan.foreign.push(relPath);
      plan.blocked.push(relPath);
      continue;
    }
    // Drift is judged on the entry alone, BEFORE the source: an edited entry is
    // the user's whether or not the registry config also changed, and it is
    // kept until they choose to replace it (D8).
    if (onDisk !== owned.hash) {
      plan.keptLocalEdit.push(relPath);
      continue;
    }
    if (entrySourceHash(owned) !== server.contentHash) {
      plan.writes.push(writeFor(relPath, server, outputHash, 'update'));
      continue;
    }
    plan.unchanged++;
  }

  // Owned keys the user no longer wants here. Scoped to THIS config file, so a
  // partial reconcile of one target cannot reap another target's entries. A
  // retired key (D-2) is marked so apply runs the proof policy on it.
  const retired = new Set(retiredServerKeys);
  for (const relPath of Object.keys(baseEntries)) {
    if (plan.ownedKeys.has(relPath)) continue;
    if (!relPath.startsWith(`${configRel}#`)) continue;
    const mcpServerKey = relPath.slice(configRel.length + 1);
    plan.removals.push({
      relPath,
      kind: 'mcp',
      isDirectory: false,
      mcpServerKey,
      ...(retired.has(mcpServerKey)
        ? { retiredItemId: mcpRetiredItemId(mcpServerKey) }
        : {}),
    });
  }

  // Deliberately no sweep of the file's OTHER keys. They are the user's own
  // servers, they are not desired, nothing here can touch them, and naming them
  // in a health report turns an ordinary `.vscode/mcp.json` into four findings
  // a user cannot action. Only a collision — handled above — is worth saying.
  return plan;
}

/**
 * Whether git knows a workspace path (D-D7):
 * - `tracked`: `git ls-files --error-unmatch` exited 0;
 * - `untracked`: it exited 1 with git's "did not match any file(s)" message;
 * - `unverifiable`: anything else — git missing, timed out, not a repository
 *   (128), another exit or message, or a path that is not contained.
 */
export type GitTrackingState = 'tracked' | 'untracked' | 'unverifiable';

/** Answers {@link GitTrackingState} for a workspace-relative POSIX path. */
export type GitTrackingProbe = (
  workspaceRoot: string,
  relPath: string,
) => Promise<GitTrackingState>;

/**
 * What applying a retired MCP removal needs beyond the removal itself (D-2).
 *
 * `baseEntries` supplies the hash Ptah recorded for the key, because a removal
 * carries none; `probeGitTracking` answers rule 2 for a workspace config file.
 */
export interface McpRetirementContext {
  baseEntries: ManagedEntries;
  probeGitTracking: GitTrackingProbe;
}

/** A retired copy deleted on proof: in `removed` AND `removedRetired`. */
export function recordRetiredRemoved(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
): void {
  result.removed.push(relPath);
  (result.removedRetired ??= []).push({ relPath, itemId });
}

/**
 * A retired copy kept on disk and disowned: NOT in `removed`, never
 * snapshotted. The reconciler drops its manifest entry.
 */
export function recordRetiredKept(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
  reason: HarnessRetiredKeptReason,
): void {
  (result.keptRetired ??= []).push({ relPath, itemId, reason });
}

/**
 * A retired removal that hit an I/O failure. Out of `removed` and
 * `keptRetired`, so the entry stays owned and the next pass retries.
 */
export function recordRetiredFailed(
  result: HarnessApplyResult,
  relPath: string,
  itemId: HarnessRetiredItemId,
  reason: string,
): void {
  result.writeFailed.push({ relPath, reason, itemId });
}

/**
 * Execute the MCP half of a plan, merging into the target's apply result.
 *
 * A removal carrying `retiredItemId` goes through
 * {@link applyRetiredMcpRemoval} instead of a plain delete; `retirement` is
 * required for it, and without one such a removal fails and stays owned.
 */
export async function applyMcpFacet(
  facet: IHarnessMcpFacet,
  writes: HarnessPlanWrite[],
  removals: HarnessPlanRemove[],
  workspaceRoot: string,
  result: HarnessApplyResult,
  retirement?: McpRetirementContext,
): Promise<void> {
  for (const removal of removals) {
    if (removal.mcpServerKey === undefined) continue;
    if (removal.retiredItemId !== undefined) {
      await applyRetiredMcpRemoval(
        facet,
        { ...removal, mcpServerKey: removal.mcpServerKey },
        removal.retiredItemId,
        workspaceRoot,
        result,
        retirement,
      );
      continue;
    }
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
        write.sourceHash,
      );
    } catch (error: unknown) {
      result.writeFailed.push({
        relPath: write.relPath,
        reason: describe(error),
      });
    }
  }
}

/**
 * Remove one retired, manifest-owned server key only on proof (D-2):
 *
 * 1. the key's current entry hashes to the manifest hash — else kept `edited`;
 *    a key already gone is removed (nothing of it remains);
 * 2. a workspace config file is provably untracked by git — else kept
 *    `git-tracked` / `unverifiable`. A `~/` home config sits outside any
 *    repository and skips this check (rule 3 covers it);
 * 3. only then the key is deleted; the facet rewrites the file, so sibling
 *    keys — owned or hand-added — are left as they are.
 *
 * Reading the config or deleting the key failing is an I/O failure: it lands in
 * `writeFailed` with the item id and the key stays owned for the next pass.
 */
async function applyRetiredMcpRemoval(
  facet: IHarnessMcpFacet,
  removal: HarnessPlanRemove & { mcpServerKey: string },
  itemId: HarnessRetiredItemId,
  workspaceRoot: string,
  result: HarnessApplyResult,
  retirement: McpRetirementContext | undefined,
): Promise<void> {
  const { relPath, mcpServerKey } = removal;
  const owned = retirement?.baseEntries[relPath];
  if (retirement === undefined || owned === undefined) {
    recordRetiredFailed(
      result,
      relPath,
      itemId,
      'cannot prove a retired MCP entry unchanged: no owned manifest hash was supplied',
    );
    return;
  }

  let current: McpServerConfig | undefined;
  try {
    current = facet.readAll(workspaceRoot).get(mcpServerKey);
  } catch (error: unknown) {
    recordRetiredFailed(
      result,
      relPath,
      itemId,
      `failed to read MCP config: ${describe(error)}`,
    );
    return;
  }
  if (current === undefined) {
    recordRetiredRemoved(result, relPath, itemId);
    return;
  }
  if (hashMcpConfig(current) !== owned.hash) {
    recordRetiredKept(result, relPath, itemId, 'edited');
    return;
  }

  const configRel = facet.configRelPath();
  if (!configRel.startsWith('~/')) {
    const tracking = await retirement.probeGitTracking(
      workspaceRoot,
      configRel,
    );
    if (tracking !== 'untracked') {
      recordRetiredKept(
        result,
        relPath,
        itemId,
        tracking === 'tracked' ? 'git-tracked' : 'unverifiable',
      );
      return;
    }
  }

  try {
    await facet.remove(workspaceRoot, mcpServerKey);
    recordRetiredRemoved(result, relPath, itemId);
  } catch (error: unknown) {
    recordRetiredFailed(
      result,
      relPath,
      itemId,
      `failed to remove MCP entry: ${describe(error)}`,
    );
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
  outputHash: string,
  reason: 'create' | 'update',
): HarnessPlanWrite {
  return {
    relPath,
    kind: 'mcp',
    source: server.registryName,
    hash: outputHash,
    // The desired config's own hash, kept apart from the on-disk hash for the
    // same reason skills keep theirs: a changed source must read as an update
    // even when the dialect round trip made `hash` differ from it.
    sourceHash: server.contentHash,
    isDirectory: false,
    reason,
    mcp: { serverKey: server.serverKey, config: server.config },
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
