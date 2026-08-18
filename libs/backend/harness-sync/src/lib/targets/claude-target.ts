/**
 * The Claude harness target: `{ws}/.claude/skills/**` and
 * `{ws}/.claude/commands/*.md`, as COPIES.
 *
 * Why copies and not junctions — the whole point of TASK_2026_278. NTFS
 * junctions worked, right up until they did not: they were torn down on host
 * deactivate (so `ptah tui`, the headless CLI, the gateway and a plain `claude`
 * invocation found nothing), `rm -r` on a junction follows it into the source,
 * and Windows commands had to be copies anyway, which left two mechanisms and
 * two manifests describing one directory. A copy survives host death, needs no
 * privilege, behaves identically on every OS, and can be hash-compared.
 *
 * **`.claude/agents` is never written.** It is a SOURCE: the user-layer mirror
 * reads hand-authored subagents FROM it. Writing generated agents back into it
 * would close a source→target→source loop in which every reconcile re-mirrors
 * its own output. Rival CLIs get agents in Batch 2, from the user layer, into
 * their own directories.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs';
import type { Stats } from 'fs';
import { rm, unlink } from 'fs/promises';
import { join } from 'path';
import type {
  HarnessFacetMatrix,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { hashDirSync, hashFileSync } from '../hash/content-hash';
import { plannedTargetHealth } from '../health/harness-health';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import {
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import {
  copyDirectory,
  copySingleFile,
  describeError,
  removeManaged,
  withWindowsRetry,
} from './copy-engine';
import type {
  HarnessApplyResult,
  HarnessMigration,
  HarnessPlan,
  HarnessPlanRemove,
  HarnessPlanWrite,
  IHarnessTarget,
} from './harness-target.port';
import { isMigratableLink } from './link-ownership';
import { createMcpFacet } from './mcp/mcp-facet.registry';
import type { IHarnessMcpFacet } from './mcp/mcp-facet.port';
import {
  applyMcpFacet,
  planMcpFacet,
  type McpFacetPlan,
} from './mcp/mcp-facet-planner';

const SKILLS_REL = '.claude/skills';
const COMMANDS_REL = '.claude/commands';

/**
 * The manifest `SkillJunctionService` wrote INSIDE `.claude/commands/`. Its
 * entries are adopted on first run so Ptah keeps ownership of command copies it
 * already made; without adoption every one of them would read as a user file
 * that must never be overwritten (defect 9).
 */
const LEGACY_COMMANDS_MANIFEST = '.ptah-managed.json';

/** Workspace-relative POSIX path -> absolute path. */
function toAbsolute(workspaceRoot: string, relPath: string): string {
  return join(workspaceRoot, ...relPath.split('/'));
}

/** `{ws}/.mcp.json` — read by Claude Code, the `claude` binary and ptah-cli. */
function defaultClaudeMcpFacet(): IHarnessMcpFacet {
  return createMcpFacet('claude');
}

export class ClaudeTarget implements IHarnessTarget {
  readonly id: HarnessTargetId = 'claude';

  /**
   * Agents are `unsupported` here on purpose, and it is not a gap.
   * `{ws}/.claude/agents` is a SOURCE — the user-layer mirror reads
   * hand-authored subagents FROM it — so writing generated agents back would
   * close a source→target→source loop in which every reconcile re-mirrors its
   * own output. Rival CLIs get agents from the user layer, into their own
   * directories.
   */
  readonly facets: HarnessFacetMatrix = {
    skills: 'supported',
    commands: 'supported',
    agents: 'unsupported',
    mcp: 'supported',
  };

  private readonly mcpFacet: IHarnessMcpFacet;

  constructor(
    private readonly manifestStore: ManagedManifestStore,
    mcpFacet: IHarnessMcpFacet = defaultClaudeMcpFacet(),
  ) {
    this.mcpFacet = mcpFacet;
  }

  /**
   * Always true. Claude Code reads `{ws}/.claude/` in any workspace, and the
   * SDK adapter, the `claude` binary and `ptah tui` all rely on it. There is no
   * "installed" signal to gate on, and gating on one would reintroduce the
   * empty-workspace failure this task exists to remove.
   */
  async detect(): Promise<boolean> {
    return true;
  }

  preflightKeys(desired: HarnessDesiredState): ReadonlyMap<string, string> {
    const keys = new Map<string, string>();
    for (const skill of desired.skills) {
      keys.set(`${SKILLS_REL}/${skill.slug}`, skill.contentHash);
    }
    for (const command of desired.commands) {
      keys.set(`${COMMANDS_REL}/${command.slug}.md`, command.contentHash);
    }
    for (const server of this.desiredMcp(desired)) {
      keys.set(
        `${this.mcpFacet.configRelPath()}#${server.serverKey}`,
        server.contentHash,
      );
    }
    return keys;
  }

  /** MCP servers the user asked for on THIS target. */
  private desiredMcp(desired: HarnessDesiredState) {
    return desired.mcp.filter((server) => server.targets.includes(this.id));
  }

  plan(
    desired: HarnessDesiredState,
    workspaceRoot: string,
    manifest: ManagedManifest,
  ): HarnessPlan {
    const migrations: HarnessMigration[] = [];
    const baseEntries: ManagedEntries = { ...manifest.entries };
    const adopted: string[] = [];
    this.adoptLegacyCommandManifest(
      workspaceRoot,
      baseEntries,
      migrations,
      adopted,
    );

    const desiredRel = new Map<string, 'skill' | 'command'>();
    for (const skill of desired.skills) {
      desiredRel.set(`${SKILLS_REL}/${skill.slug}`, 'skill');
    }
    for (const command of desired.commands) {
      desiredRel.set(`${COMMANDS_REL}/${command.slug}.md`, 'command');
    }

    const scanned: string[] = [];
    const removals: HarnessPlanRemove[] = [];
    this.scanTargetDirs(
      workspaceRoot,
      baseEntries,
      new Set(desiredRel.keys()),
      scanned,
      removals,
      desired.sourceRoots,
    );

    const writes: HarnessPlanWrite[] = [];
    let unchanged = 0;

    for (const skill of desired.skills) {
      const relPath = `${SKILLS_REL}/${skill.slug}`;
      const outcome = this.planEntry(
        workspaceRoot,
        relPath,
        baseEntries,
        migrations,
        skill.contentHash,
        (abs) => hashDirSync(abs),
        desired.sourceRoots,
      );
      if (outcome === 'foreign') {
        // A DESIRED path can be foreign now that a user's own symlink is not
        // migrated. `scanTargetDirs` deliberately skips desired paths, so
        // without this the refusal would be invisible in health.
        scanned.push(relPath);
        continue;
      }
      if (outcome === 'unchanged') {
        baseEntries[relPath] = managedEntry(
          skill.contentHash,
          skill.sourceDir,
          'skill',
        );
        unchanged++;
        continue;
      }
      writes.push({
        relPath,
        kind: 'skill',
        source: skill.sourceDir,
        hash: skill.contentHash,
        isDirectory: true,
        reason: outcome.reason,
        overwritesLocalEdit: outcome.overwritesLocalEdit,
      });
    }

    for (const command of desired.commands) {
      const relPath = `${COMMANDS_REL}/${command.slug}.md`;
      const outcome = this.planEntry(
        workspaceRoot,
        relPath,
        baseEntries,
        migrations,
        command.contentHash,
        (abs) => hashFileSync(abs),
        desired.sourceRoots,
      );
      if (outcome === 'foreign') {
        scanned.push(relPath);
        continue;
      }
      if (outcome === 'unchanged') {
        baseEntries[relPath] = managedEntry(
          command.contentHash,
          command.sourceFile,
          'command',
        );
        unchanged++;
        continue;
      }
      writes.push({
        relPath,
        kind: 'command',
        source: command.sourceFile,
        hash: command.contentHash,
        isDirectory: false,
        reason: outcome.reason,
        overwritesLocalEdit: outcome.overwritesLocalEdit,
      });
    }

    const mcpPlan = this.planMcp(desired, workspaceRoot, baseEntries);

    for (const relPath of Object.keys(baseEntries)) {
      if (desiredRel.has(relPath)) continue;
      const entry = baseEntries[relPath];
      // MCP entries live inside a shared config file and are swept by the facet
      // planner, which knows which config file each key belongs to.
      if (entry.kind === 'mcp' || mcpPlan.ownedKeys.has(relPath)) continue;
      removals.push({
        relPath,
        kind: entry.kind,
        isDirectory: relPath.startsWith(`${SKILLS_REL}/`),
      });
    }

    // Filtered LAST, against the post-adoption ownership map. `scanTargetDirs`
    // runs before the plan loops (it also produces the stray-symlink removals
    // those loops must not duplicate), so a path adopted below — one that is
    // byte-identical to what this pass would write — would otherwise be
    // reported foreign in the same breath as being claimed.
    const foreign = [...new Set(scanned)].filter(
      (relPath) => baseEntries[relPath] === undefined,
    );
    // Derived from `foreign` rather than collected alongside it, so "blocked is
    // a subset of foreign" holds structurally and survives the adoption filter
    // above: a path claimed by adoption leaves BOTH lists in one step.
    const blocked = foreign.filter((relPath) => desiredRel.has(relPath));

    return {
      target: this.id,
      writes: [...writes, ...mcpPlan.writes],
      removals: [...removals, ...mcpPlan.removals],
      foreign: [...foreign, ...mcpPlan.foreign],
      blocked: [...blocked, ...mcpPlan.blocked],
      collisions: desired.collisions,
      migrations,
      adopted,
      baseEntries,
      unchanged: unchanged + mcpPlan.unchanged,
      expected: desiredRel.size + mcpPlan.expected,
    };
  }

  private planMcp(
    desired: HarnessDesiredState,
    workspaceRoot: string,
    baseEntries: ManagedEntries,
  ): McpFacetPlan {
    return planMcpFacet(
      this.mcpFacet,
      this.desiredMcp(desired),
      workspaceRoot,
      baseEntries,
    );
  }

  async apply(
    plan: HarnessPlan,
    workspaceRoot: string,
  ): Promise<HarnessApplyResult> {
    const result: HarnessApplyResult = {
      written: {},
      removed: [],
      writeFailed: [],
      overwrittenLocalEdit: [],
    };

    // Junctions first: a desired slug whose copy is about to be written must
    // not still be a link, or the copy would land inside the SOURCE directory.
    // Recorded in `removed` because deleting something in the user's workspace
    // must never be invisible — `ptah harness doctor` and the health report are
    // where a user finds out a link they may have forgotten about is now a copy.
    for (const migration of plan.migrations) {
      if (migration.kind !== 'unlink-junction') continue;
      try {
        await withWindowsRetry(() => unlink(migration.path));
        result.removed.push(migration.path);
      } catch (error: unknown) {
        result.writeFailed.push({
          relPath: migration.path,
          reason: `failed to remove legacy junction: ${describeError(error)}`,
        });
      }
    }

    for (const removal of plan.removals) {
      if (removal.kind === 'mcp') continue;
      const absolute = toAbsolute(workspaceRoot, removal.relPath);
      try {
        await removeManaged(absolute, removal.isDirectory);
        result.removed.push(removal.relPath);
      } catch (error: unknown) {
        result.writeFailed.push({
          relPath: removal.relPath,
          reason: `failed to remove: ${describeError(error)}`,
        });
      }
    }

    for (const write of plan.writes) {
      if (write.kind === 'mcp') continue;
      const absolute = toAbsolute(workspaceRoot, write.relPath);
      try {
        if (write.isDirectory) {
          await copyDirectory(write.source, absolute);
        } else {
          await copySingleFile(
            write.source,
            absolute,
            join(workspaceRoot, ...COMMANDS_REL.split('/')),
          );
        }
        // Recorded ONLY after the write succeeded: a manifest entry for a file
        // that is not on disk is exactly the record corruption E21 forbids.
        result.written[write.relPath] = managedEntry(
          write.hash,
          write.source,
          write.kind,
        );
        if (write.overwritesLocalEdit) {
          result.overwrittenLocalEdit.push(write.relPath);
        }
      } catch (error: unknown) {
        result.writeFailed.push({
          relPath: write.relPath,
          reason: describeError(error),
        });
      }
    }

    await applyMcpFacet(
      this.mcpFacet,
      plan.writes.filter((write) => write.kind === 'mcp'),
      plan.removals.filter((removal) => removal.kind === 'mcp'),
      workspaceRoot,
      result,
    );

    // Last: the legacy manifest is the only proof of ownership for adopted
    // command copies until the new manifest lands, and the reconciler persists
    // the adoption BEFORE calling apply.
    for (const migration of plan.migrations) {
      if (migration.kind !== 'drop-legacy-manifest') continue;
      try {
        await withWindowsRetry(() => rm(migration.path, { force: true }));
      } catch {
        // Harmless if it survives: adoption already happened, and a second run
        // finds every key already owned and adopts nothing.
      }
    }

    return result;
  }

  /**
   * The two directories Claude Code reads that this target OWNS (E23).
   *
   * `.claude/agents` is absent, and that absence is the same decision made
   * everywhere else in this file: it is a SOURCE the user-layer mirror reads
   * FROM, so it holds files the user authored and must stay tracked.
   * `{ws}/.mcp.json` is absent because it is a config file teams commit.
   */
  managedDirs(): readonly string[] {
    return [SKILLS_REL, COMMANDS_REL];
  }

  /**
   * Read-only health, derived from a PLAN rather than from a second disk walk.
   *
   * The walk this replaces re-implemented ownership with subtly different rules
   * — it compared on-disk bytes to the desired hash and never consulted the
   * manifest at all — so it and `plan` could not help but disagree about the
   * same path. `plan` never writes (this port's contract), so calling it here
   * costs the same hashing the walk did and removes the second opinion.
   */
  async verify(
    desired: HarnessDesiredState,
    workspaceRoot: string,
  ): Promise<HarnessTargetHealth> {
    const startedAt = Date.now();
    const manifest = this.manifestStore.load(workspaceRoot, this.id);
    return plannedTargetHealth(
      this.plan(desired, workspaceRoot, manifest),
      this.facets,
      // `detect()` is unconditionally true here — Claude Code reads
      // `{ws}/.claude` in any workspace — so there is nothing to await.
      true,
      Date.now() - startedAt,
    );
  }

  // ----------------------------------------------------------------- plan

  /**
   * Ownership + drift decision for one entry.
   *
   * Returns `'foreign'` when the path exists and Ptah cannot prove it wrote it,
   * `'unchanged'` when the on-disk hash already equals the desired hash, and a
   * write descriptor otherwise.
   *
   * Two rules here are about NOT destroying the user's work:
   *
   * - **A symlink is unlinked only when it points into a declared source root.**
   *   A leftover `SkillJunctionService` junction resolves inside `~/.ptah/**`
   *   and is migrated to a copy; a link the user made at the same path to their
   *   own checkout resolves somewhere else, and is reported `foreign` exactly as
   *   `workspace-target.ts` reports one. See `link-ownership.ts`.
   * - **An unowned path that is byte-identical to what we would write is
   *   ADOPTED**, not frozen as foreign. This is the recovery half of a manifest
   *   write that failed: the copies landed, the ownership record did not, and
   *   without adoption the very next pass would refuse to touch Ptah's own files
   *   forever. Adopting is safe precisely because the content already equals the
   *   desired content — the alternative action would have produced these bytes.
   */
  private planEntry(
    workspaceRoot: string,
    relPath: string,
    baseEntries: ManagedEntries,
    migrations: HarnessMigration[],
    desiredHash: string,
    hashOnDisk: (absolute: string) => string | null,
    sourceRoots: readonly string[],
  ):
    | 'foreign'
    | 'unchanged'
    | { reason: 'create' | 'update'; overwritesLocalEdit: boolean } {
    const absolute = toAbsolute(workspaceRoot, relPath);
    const stat = lstatSyncOrNull(absolute);

    if (stat !== null && stat.isSymbolicLink()) {
      if (!isMigratableLink(absolute, sourceRoots)) return 'foreign';
      if (!migrations.some((m) => m.path === absolute)) {
        migrations.push({ kind: 'unlink-junction', path: absolute });
      }
      return { reason: 'create', overwritesLocalEdit: false };
    }

    if (stat === null) {
      return { reason: 'create', overwritesLocalEdit: false };
    }

    const actual = hashOnDisk(absolute);
    const owned = baseEntries[relPath];
    if (owned === undefined) {
      return actual !== null && actual === desiredHash
        ? 'unchanged'
        : 'foreign';
    }

    if (actual === desiredHash) return 'unchanged';

    return {
      reason: 'update',
      overwritesLocalEdit: actual !== null && actual !== owned.hash,
    };
  }

  /**
   * Walk `.claude/skills` and `.claude/commands` once, classifying every entry
   * that is NOT accounted for by the desired state:
   *
   * - a symlink INTO a declared source root → a `SkillJunctionService`
   *   leftover. Desired ones are migrated in `planEntry`; the rest become
   *   removals with `isDirectory: false`, so they are `unlink`ed and never
   *   `rm -r`ed into their source.
   * - a symlink pointing anywhere else → the user's own link, reported foreign
   *   and never unlinked (`link-ownership.ts`).
   * - manifest-owned → left to `planEntry` / the removal sweep.
   * - anything else → foreign. The user's own `.claude/skills/foo` (E9).
   */
  private scanTargetDirs(
    workspaceRoot: string,
    ownedEntries: ManagedEntries,
    desiredRel: ReadonlySet<string>,
    foreign: string[],
    removals: HarnessPlanRemove[],
    sourceRoots: readonly string[],
  ): void {
    for (const [dirRel, onlyMarkdown] of [
      [SKILLS_REL, false],
      [COMMANDS_REL, true],
    ] as const) {
      const dirAbsolute = join(workspaceRoot, ...dirRel.split('/'));
      let entries: string[];
      try {
        entries = readdirSync(dirAbsolute);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry === LEGACY_COMMANDS_MANIFEST) continue;
        if (onlyMarkdown && !entry.toLowerCase().endsWith('.md')) continue;

        const relPath = `${dirRel}/${entry}`;
        const stat = lstatSyncOrNull(join(dirAbsolute, entry));
        if (stat === null) continue;

        if (stat.isSymbolicLink()) {
          if (desiredRel.has(relPath)) continue; // planEntry decides its fate
          if (!isMigratableLink(join(dirAbsolute, entry), sourceRoots)) {
            foreign.push(relPath);
            continue;
          }
          removals.push({
            relPath,
            kind: dirRel === SKILLS_REL ? 'skill' : 'command',
            isDirectory: false,
          });
          continue;
        }

        if (ownedEntries[relPath] !== undefined) continue;
        foreign.push(relPath);
      }
    }
  }

  /**
   * Adopt `.claude/commands/.ptah-managed.json` written by the deleted
   * `SkillJunctionService`, then queue it for deletion.
   *
   * Adoption hashes what is on disk NOW rather than trusting the legacy
   * size/mtime record: the point is to establish ownership, and the very next
   * plan step compares that hash against the desired one and rewrites if they
   * differ.
   */
  private adoptLegacyCommandManifest(
    workspaceRoot: string,
    baseEntries: ManagedEntries,
    migrations: HarnessMigration[],
    adopted: string[],
  ): void {
    const legacyPath = join(
      workspaceRoot,
      ...COMMANDS_REL.split('/'),
      LEGACY_COMMANDS_MANIFEST,
    );
    if (!existsSync(legacyPath)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(legacyPath, 'utf-8'));
    } catch {
      parsed = null;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      for (const filename of Object.keys(parsed as Record<string, unknown>)) {
        if (!filename.toLowerCase().endsWith('.md')) continue;
        const relPath = `${COMMANDS_REL}/${filename}`;
        if (baseEntries[relPath] !== undefined) continue;
        const hash = hashFileSync(toAbsolute(workspaceRoot, relPath));
        if (hash === null) continue;
        baseEntries[relPath] = managedEntry(hash, '', 'command');
        adopted.push(relPath);
      }
    }

    migrations.push({ kind: 'drop-legacy-manifest', path: legacyPath });
  }
}

/** `lstatSync` that answers `null` instead of throwing on a missing path. */
function lstatSyncOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Factory used by DI so `ClaudeTarget` needs no decorators of its own. */
export function createClaudeTarget(store: ManagedManifestStore): ClaudeTarget {
  return new ClaudeTarget(store);
}
