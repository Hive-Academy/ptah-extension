/**
 * One engine for every rival-CLI harness target.
 *
 * Codex, Copilot, Cursor, Antigravity and VS Code differ in four values —
 * which directory holds skills, which holds commands, how an agent is
 * transformed, and which MCP config file they read — and in nothing else. The
 * three services this replaces (`CliPluginSyncService`,
 * `MultiCliAgentWriterService`, the `mcp-directory` installers) each
 * rediscovered ownership, drift and reaping for their own artifact family, with
 * three different manifests and three different ideas of what "already synced"
 * meant. Here it is decided once and configured five times.
 *
 * Three behaviours are worth knowing before changing anything:
 *
 * **Copies are transformed, so a copy never hashes equal to its source.** Rival
 * CLIs reject frontmatter Claude accepts (`skill-transform.ts`), so a manifest
 * entry records the OUTPUT hash in `hash` and the SOURCE hash in `sourceHash`.
 * A changed source and a hand-edited copy are then distinguishable, which is
 * what keeps E10 working for targets that rewrite.
 *
 * **Two targets can own one directory.** Codex and Antigravity both read
 * `{ws}/.agents/skills`. Each keeps its own manifest, and each treats a path
 * owned by a declared co-owner as owned rather than foreign — without that,
 * whichever CLI was installed second would find every skill "not ours" and
 * refuse to touch it forever.
 *
 * **The workspace root is already resolved.** Targets never walk up from a cwd;
 * the reconciler normalizes once (`workspace/workspace-root.ts`, E14) so two
 * targets cannot disagree about which tree they are writing into.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'fs';
import type { Stats } from 'fs';
import { rm, unlink, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import type {
  HarnessFacetMatrix,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';
import { hashContent, hashDirSync, hashFileSync } from '../hash/content-hash';
import { plannedTargetHealth } from '../health/harness-health';
import type {
  HarnessDesiredMcpServer,
  HarnessDesiredState,
} from '../manifest/desired-state.types';
import {
  entrySourceHash,
  managedEntry,
  ManagedManifestStore,
  type ManagedEntries,
  type ManagedManifest,
} from '../manifest-store/managed-manifest';
import type { IHarnessCliDetector } from '../sources/harness-source.port';
import {
  copyDirectoryTransformed,
  copySingleFile,
  describeError,
  hashTransformedDirSync,
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
import type { IHarnessMcpFacet } from './mcp/mcp-facet.port';
import {
  applyMcpFacet,
  emptyMcpFacetPlan,
  planMcpFacet,
  type McpFacetPlan,
} from './mcp/mcp-facet-planner';
import type { IHarnessAgentTransformer } from './transformers/agent-transformer.port';

/**
 * The manifest the deleted rival-CLI installers wrote INSIDE each target
 * directory: `{ "skills": [...], "commands": [...] }`. Adopted on first run so
 * copies Ptah already made stay Ptah's; without adoption every one of them
 * would read as a user file that must never be updated again (defect 9).
 */
const LEGACY_RIVAL_MANIFEST = '.ptah-managed.json';

export interface WorkspaceHarnessTargetOptions {
  id: HarnessTargetId;
  facets: HarnessFacetMatrix;
  manifestStore: ManagedManifestStore;
  detector: IHarnessCliDetector;
  /** Workspace-relative POSIX directory holding skill folders. */
  skillsDirRel?: string;
  /** Workspace-relative POSIX directory holding `<slug>.md` command files. */
  commandsDirRel?: string;
  agentTransformer?: IHarnessAgentTransformer;
  mcpFacet?: IHarnessMcpFacet;
  /**
   * Targets that write into the same directories as this one. Their manifests
   * count as proof of Ptah ownership here.
   */
  coOwners?: HarnessTargetId[];
  /**
   * A HOME directory swept of `ptah-`/`ptahsynth-` leftovers. Copilot resolves
   * agents home-first, so a stale home copy shadows the workspace copy (E19).
   */
  homeReap?: { dir: () => string; prefixes: readonly string[] };
}

export class WorkspaceHarnessTarget implements IHarnessTarget {
  readonly id: HarnessTargetId;
  readonly facets: HarnessFacetMatrix;

  constructor(private readonly options: WorkspaceHarnessTargetOptions) {
    this.id = options.id;
    this.facets = options.facets;
  }

  /**
   * Installed-or-not, answered by the host's CLI detector.
   *
   * An absent CLI yields `detected: false` and the reconciler skips the target
   * entirely — no directories created, no health noise. Installing it later and
   * reconciling populates everything from scratch, because nothing about the
   * desired state was conditional on detection (E17).
   */
  detect(): Promise<boolean> {
    return this.options.detector.isInstalled(this.id);
  }

  preflightKeys(desired: HarnessDesiredState): ReadonlyMap<string, string> {
    const keys = new Map<string, string>();
    for (const [relPath, entry] of this.desiredEntries(desired)) {
      keys.set(relPath, entry.sourceHash);
    }
    return keys;
  }

  plan(
    desired: HarnessDesiredState,
    workspaceRoot: string,
    manifest: ManagedManifest,
  ): HarnessPlan {
    const migrations: HarnessMigration[] = [];
    const baseEntries: ManagedEntries = { ...manifest.entries };
    const adopted: string[] = [];
    this.adoptLegacyManifests(workspaceRoot, baseEntries, migrations, adopted);
    this.planHomeReap(migrations, desired, baseEntries);

    const ownership = this.ownershipOracle(workspaceRoot, baseEntries);
    const desiredEntries = this.desiredEntries(desired);

    const writes: HarnessPlanWrite[] = [];
    const foreign: string[] = [];
    const blocked: string[] = [];
    let unchanged = 0;

    for (const [relPath, entry] of desiredEntries) {
      const outcome = this.planEntry(workspaceRoot, relPath, entry, ownership);
      if (outcome.kind === 'foreign') {
        // Both lists, always. `foreign` says why this pass wrote nothing here;
        // `blocked` is what makes health call it a gap, so a reconcile cannot
        // report "in sync" over a path the next verify calls missing.
        foreign.push(relPath);
        blocked.push(relPath);
        continue;
      }
      if (outcome.kind === 'unchanged') {
        // Claim it in THIS target's manifest even though nothing was written.
        // On a shared directory the artifact may be correct only because a
        // co-owner wrote it, and borrowed ownership is not ownership: drop the
        // sibling from a partial reconcile, or reset its manifest, and this
        // target would find a perfectly good copy it can no longer prove it
        // wrote — and freeze, treating it as foreign forever.
        baseEntries[relPath] = managedEntry(
          outcome.recordHash,
          entry.source,
          entry.kind,
          entry.sourceHash,
        );
        unchanged++;
        continue;
      }
      if (outcome.adopted) adopted.push(relPath);
      writes.push({
        relPath,
        kind: entry.kind,
        source: entry.source,
        hash: entry.outputHash,
        sourceHash: entry.sourceHash,
        isDirectory: entry.isDirectory,
        reason: outcome.reason,
        overwritesLocalEdit: outcome.overwritesLocalEdit,
      });
    }

    const mcpPlan = this.planMcp(desired, workspaceRoot, baseEntries);
    const removals = this.planRemovals(baseEntries, desiredEntries, mcpPlan);
    this.scanForeignDirs(workspaceRoot, desiredEntries, ownership, foreign);

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
      expected: desiredEntries.size + mcpPlan.expected,
    };
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

    await this.applyMigrations(plan.migrations, result);

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
      await this.applyWrite(write, workspaceRoot, result);
    }

    const facet = this.options.mcpFacet;
    if (facet !== undefined) {
      await applyMcpFacet(
        facet,
        plan.writes.filter((write) => write.kind === 'mcp'),
        plan.removals.filter((removal) => removal.kind === 'mcp'),
        workspaceRoot,
        result,
      );
    }

    return result;
  }

  /**
   * The directories this target fills, for the `.gitignore` block (E23).
   *
   * Derived from the same three option fields the plan is built from, so a
   * target that gains a facet cannot forget to declare it. The MCP facet is
   * absent by design — it writes into a config FILE the user commits.
   */
  managedDirs(): readonly string[] {
    const dirs: string[] = [];
    if (this.options.skillsDirRel !== undefined)
      dirs.push(this.options.skillsDirRel);
    if (this.options.commandsDirRel !== undefined)
      dirs.push(this.options.commandsDirRel);
    if (this.options.agentTransformer !== undefined) {
      dirs.push(this.options.agentTransformer.dirRel);
    }
    return dirs;
  }

  /**
   * Read-only health, derived from a PLAN rather than from a second disk walk.
   *
   * The second walk is what this method used to be, and it is what made
   * `reconcile` and `verify` contradict each other: it asked "does the manifest
   * own this path and do the hashes match", which classified every unowned
   * desired path `missing`, while `plan` classified the identical path
   * `foreign` and counted no gap. Fifteen `.codex/agents/*.toml` were reported
   * as 15 missing by one and 15 foreign by the other, forever.
   *
   * `plan` never writes — that is this port's contract — so running it here is
   * free of side effects, costs the same directory hashing the old walk did,
   * and makes the two answers the same answer by construction.
   */
  async verify(
    desired: HarnessDesiredState,
    workspaceRoot: string,
  ): Promise<HarnessTargetHealth> {
    const startedAt = Date.now();
    const detected = await this.detect();
    const manifest = this.options.manifestStore.load(workspaceRoot, this.id);
    return plannedTargetHealth(
      this.plan(desired, workspaceRoot, manifest),
      this.facets,
      detected,
      Date.now() - startedAt,
    );
  }

  // ------------------------------------------------------------ desired state

  /**
   * Every non-MCP artifact this target is responsible for, keyed by its
   * workspace-relative path.
   *
   * Facets the target does not support contribute nothing — that is the whole
   * mechanism behind `commands: 'unsupported'` for Codex and Copilot, and
   * `agents: 'unsupported'` for Antigravity. Nothing is planned, nothing is
   * reported missing, and the capability is stated in health instead.
   */
  private desiredEntries(
    desired: HarnessDesiredState,
  ): Map<string, DesiredEntry> {
    const entries = new Map<string, DesiredEntry>();

    const skillsDir = this.options.skillsDirRel;
    if (skillsDir !== undefined) {
      for (const skill of desired.skills) {
        entries.set(`${skillsDir}/${skill.slug}`, {
          kind: 'skill',
          source: skill.sourceDir,
          sourceHash: skill.contentHash,
          // Provisional: the copy is transformed, so `apply` re-hashes the
          // written tree and records THAT as the entry's output hash.
          outputHash: skill.contentHash,
          isDirectory: true,
          transformed: true,
        });
      }
    }

    const commandsDir = this.options.commandsDirRel;
    if (commandsDir !== undefined) {
      for (const command of desired.commands) {
        entries.set(`${commandsDir}/${command.slug}.md`, {
          kind: 'command',
          source: command.sourceFile,
          sourceHash: command.contentHash,
          outputHash: command.contentHash,
          isDirectory: false,
          transformed: false,
        });
      }
    }

    const transformer = this.options.agentTransformer;
    if (transformer !== undefined) {
      for (const agent of desired.agents) {
        const rendered = this.renderAgent(
          transformer,
          agent.slug,
          agent.sourceFile,
        );
        if (rendered === null) continue;
        entries.set(transformer.relPathFor(agent.slug), {
          kind: 'agent',
          source: agent.sourceFile,
          sourceHash: agent.contentHash,
          outputHash: hashContent(rendered),
          isDirectory: false,
          transformed: true,
        });
      }
    }

    return entries;
  }

  /** Read + transform one agent. `null` when the source cannot be read. */
  private renderAgent(
    transformer: IHarnessAgentTransformer,
    agentId: string,
    sourceFile: string,
  ): string | null {
    try {
      return transformer.transform({
        agentId,
        content: readFileSync(sourceFile, 'utf-8'),
      });
    } catch {
      return null;
    }
  }

  private planMcp(
    desired: HarnessDesiredState,
    workspaceRoot: string,
    baseEntries: ManagedEntries,
  ): McpFacetPlan {
    const facet = this.options.mcpFacet;
    if (facet === undefined) return emptyMcpFacetPlan();
    return planMcpFacet(
      facet,
      desired.mcp.filter((server: HarnessDesiredMcpServer) =>
        server.targets.includes(this.id),
      ),
      workspaceRoot,
      baseEntries,
    );
  }

  // -------------------------------------------------------------------- plan

  /**
   * Ownership + drift decision for one artifact.
   *
   * Order matters. A path that does not exist is a `create` regardless of the
   * manifest — that is what heals a workspace whose target directory the user
   * deleted. A path that exists but nobody can prove Ptah wrote is FOREIGN and
   * is never touched (E9). Only then do the two hashes get compared: the source
   * hash decides whether the upstream changed, and the output hash decides
   * whether someone edited the copy.
   *
   * The one exception to "unproven means foreign" is an unowned path whose
   * content is BYTE-IDENTICAL to what this pass would write. That is the
   * signature of a manifest write that failed after a successful apply: the
   * copies landed, the ownership record did not. Freezing on them would leave
   * the harness permanently stuck on files Ptah itself produced, so they are
   * adopted instead — and adopting is safe precisely because writing would have
   * produced these exact bytes.
   *
   * `'unchanged'` carries the hash to RECORD rather than letting the caller
   * guess it. For a rival skill the on-disk bytes are the TRANSFORMED copy,
   * whose hash equals neither the source hash nor `entry.outputHash` (which is
   * provisional for transformed directories) — recording the wrong one would
   * make the very next pass report a hand-edited copy that nobody edited.
   */
  private planEntry(
    workspaceRoot: string,
    relPath: string,
    entry: DesiredEntry,
    ownership: OwnershipOracle,
  ): PlanEntryOutcome {
    const absolute = toAbsolute(workspaceRoot, relPath);
    const stat = lstatSyncOrNull(absolute);

    if (stat === null) {
      return {
        kind: 'write',
        reason: 'create',
        overwritesLocalEdit: false,
        adopted: false,
      };
    }

    if (stat.isSymbolicLink()) {
      // A rival dir should never hold a link, but a hand-made one would make
      // `rm -r` follow it out of the workspace. Treated as not-ours.
      return { kind: 'foreign' };
    }

    const actual = entry.isDirectory
      ? hashDirSync(absolute)
      : hashFileSync(absolute);

    const owned = ownership.entryFor(relPath);
    if (owned === undefined) {
      if (
        actual !== null &&
        actual === this.expectedOutputHash(relPath, entry)
      ) {
        return { kind: 'unchanged', recordHash: actual };
      }
      // Content differs and no manifest claims it — so the byte-identity
      // recovery above cannot help. An agent file can still PROVE it came out
      // of a Ptah writer, and one that does is a copy whose ownership record
      // was lost, not the user's work. Adopt it and rewrite with current
      // output; anything that cannot prove it stays foreign (E9).
      return this.carriesWriterSignature(absolute, entry)
        ? {
            kind: 'write',
            reason: 'update',
            overwritesLocalEdit: false,
            adopted: true,
          }
        : { kind: 'foreign' };
    }

    if (entrySourceHash(owned) !== entry.sourceHash) {
      return {
        kind: 'write',
        reason: 'update',
        overwritesLocalEdit: false,
        adopted: false,
      };
    }

    if (actual === owned.hash) return { kind: 'unchanged', recordHash: actual };

    return {
      kind: 'write',
      reason: 'update',
      overwritesLocalEdit: true,
      adopted: false,
    };
  }

  /**
   * Can this target prove the file at `absolute` came out of a Ptah writer?
   *
   * Agents only, and the transformer answers — it is the one thing that knows
   * what its own format's signature looks like, and what its deleted
   * predecessor's looked like. Skills and commands have no signature to carry:
   * they are copies of user-layer markdown, so a stale copy is
   * indistinguishable from a file the user authored, and staying foreign is the
   * safe answer there. Legacy skill and command copies are adopted instead
   * through their `.ptah-managed.json`, which IS a record of ownership.
   */
  private carriesWriterSignature(
    absolute: string,
    entry: DesiredEntry,
  ): boolean {
    const transformer = this.options.agentTransformer;
    if (entry.kind !== 'agent' || transformer === undefined) return false;
    try {
      return transformer.isPtahOutput(readFileSync(absolute, 'utf-8'));
    } catch {
      return false;
    }
  }

  /**
   * The hash the copy on disk WOULD have if this target had just written it.
   *
   * A transformed skill directory is the only case that needs work:
   * `entry.outputHash` is provisionally the SOURCE hash there (the real one is
   * only known after `copyDirectoryTransformed` runs), so the transform has to
   * be replayed in memory — `hashTransformedDirSync`, which lives next to the
   * copy it mirrors. Agents already carry a real output hash and byte-copied
   * commands hash equal to their source.
   */
  private expectedOutputHash(
    relPath: string,
    entry: DesiredEntry,
  ): string | null {
    if (!entry.isDirectory || !entry.transformed) return entry.outputHash;
    const slug = relPath.slice(relPath.lastIndexOf('/') + 1);
    return hashTransformedDirSync(entry.source, slug);
  }

  /** Manifest-owned paths that are no longer desired. MCP is handled separately. */
  private planRemovals(
    baseEntries: ManagedEntries,
    desiredEntries: Map<string, DesiredEntry>,
    mcpPlan: McpFacetPlan,
  ): HarnessPlanRemove[] {
    const removals: HarnessPlanRemove[] = [];
    for (const relPath of Object.keys(baseEntries)) {
      if (desiredEntries.has(relPath)) continue;
      const entry = baseEntries[relPath];
      if (entry.kind === 'mcp') continue; // owned by the facet planner
      if (mcpPlan.ownedKeys.has(relPath)) continue;
      removals.push({
        relPath,
        kind: entry.kind,
        isDirectory: entry.kind === 'skill',
      });
    }
    return removals;
  }

  /**
   * Report entries in this target's directories that are neither desired nor
   * manifest-owned. The user's own `.cursor/skills/my-thing` (E9).
   */
  private scanForeignDirs(
    workspaceRoot: string,
    desiredEntries: Map<string, DesiredEntry>,
    ownership: OwnershipOracle,
    foreign: string[],
  ): void {
    const dirs: Array<{ dirRel: string; onlyMarkdown: boolean }> = [];
    if (this.options.skillsDirRel !== undefined) {
      dirs.push({ dirRel: this.options.skillsDirRel, onlyMarkdown: false });
    }
    if (this.options.commandsDirRel !== undefined) {
      dirs.push({ dirRel: this.options.commandsDirRel, onlyMarkdown: true });
    }
    const transformer = this.options.agentTransformer;
    if (transformer !== undefined) {
      dirs.push({
        dirRel: dirOf(transformer.relPathFor('probe')),
        onlyMarkdown: false,
      });
    }

    const seen = new Set(foreign);
    for (const { dirRel, onlyMarkdown } of dirs) {
      let names: string[];
      try {
        names = readdirSync(join(workspaceRoot, ...dirRel.split('/')));
      } catch {
        continue;
      }
      for (const name of names) {
        if (name === LEGACY_RIVAL_MANIFEST) continue;
        if (onlyMarkdown && !name.toLowerCase().endsWith('.md')) continue;
        const relPath = `${dirRel}/${name}`;
        if (desiredEntries.has(relPath)) continue;
        if (ownership.entryFor(relPath) !== undefined) continue;
        if (seen.has(relPath)) continue;
        seen.add(relPath);
        foreign.push(relPath);
      }
    }
  }

  /**
   * Ownership lookup that also consults co-owning targets' manifests.
   *
   * Codex and Antigravity share `{ws}/.agents/skills`. Whichever reconciles
   * first records the copies in its own manifest; the second must recognise
   * them as Ptah's rather than as a stranger's files, or it would classify the
   * whole directory foreign and never write again.
   */
  private ownershipOracle(
    workspaceRoot: string,
    baseEntries: ManagedEntries,
  ): OwnershipOracle {
    const coOwners = this.options.coOwners ?? [];
    const sibling: ManagedEntries[] = coOwners.map(
      (target) =>
        this.options.manifestStore.load(workspaceRoot, target).entries,
    );

    return {
      entryFor: (relPath) => {
        const own = baseEntries[relPath];
        if (own !== undefined) return own;
        for (const entries of sibling) {
          const found = entries[relPath];
          if (found !== undefined) return found;
        }
        return undefined;
      },
    };
  }

  // -------------------------------------------------------------- migrations

  /**
   * Adopt every `.ptah-managed.json` the deleted rival installers left inside
   * this target's directories, then queue the files for deletion.
   *
   * Adoption hashes what is on disk NOW rather than trusting the legacy list:
   * the point is only to establish ownership. The very next plan step compares
   * that hash against the desired one and rewrites when they differ, so an
   * adopted copy written by the old pipeline is refreshed on the first pass.
   */
  private adoptLegacyManifests(
    workspaceRoot: string,
    baseEntries: ManagedEntries,
    migrations: HarnessMigration[],
    adopted: string[],
  ): void {
    const dirs: Array<{ dirRel: string; key: 'skills' | 'commands' }> = [];
    if (this.options.skillsDirRel !== undefined) {
      dirs.push({ dirRel: this.options.skillsDirRel, key: 'skills' });
    }
    if (this.options.commandsDirRel !== undefined) {
      dirs.push({ dirRel: this.options.commandsDirRel, key: 'commands' });
    }

    for (const { dirRel, key } of dirs) {
      const legacyPath = join(
        workspaceRoot,
        ...dirRel.split('/'),
        LEGACY_RIVAL_MANIFEST,
      );
      if (!existsSync(legacyPath)) continue;

      for (const name of readLegacyNames(legacyPath, key)) {
        const relPath = `${dirRel}/${name}`;
        if (baseEntries[relPath] !== undefined) continue;
        const absolute = toAbsolute(workspaceRoot, relPath);
        const hash =
          key === 'skills' ? hashDirSync(absolute) : hashFileSync(absolute);
        if (hash === null) continue;
        // No `sourceHash`: the legacy pipeline recorded none, so the first plan
        // sees a source mismatch and rewrites — which is the correct outcome,
        // because the old transform pipeline differed from this one.
        baseEntries[relPath] = managedEntry(
          hash,
          '',
          key === 'skills' ? 'skill' : 'command',
        );
        adopted.push(relPath);
      }
      migrations.push({ kind: 'drop-legacy-manifest', path: legacyPath });
    }
  }

  /**
   * Queue leftovers in the CLI's home directory that Ptah can PROVE it wrote
   * (E19).
   *
   * Copilot resolves agents home-first, so a stale `~/.copilot/agents/ptah-x.md`
   * silently shadows the workspace copy this pass just wrote. Reaping it is
   * necessary — but the original rule, "delete anything whose name starts with
   * `ptah-` or `ptahsynth-`", was a name-prefix heuristic aimed at a directory
   * Ptah does not own, applied to files it may never have written, with no
   * report. A user with `~/.copilot/agents/ptah-notes.agent.md` lost it silently
   * on the next activation.
   *
   * Two independent proofs, either of which is enough:
   *
   * - **The writer signature.** The deleted `MultiCliAgentWriterService` emitted
   *   `source: ptah` in the frontmatter of every agent it produced, via the same
   *   `rewriteFrontmatter` this lib now uses (`transformers/transform-rules.ts`).
   *   A file carrying it came out of that pipeline, whatever it is called.
   * - **A known agent id.** `<prefix><id>` where `id` is an agent the desired
   *   state carries or the manifest already records. Covers a legacy file whose
   *   frontmatter a user hand-edited away, without covering names Ptah never had
   *   a reason to produce.
   *
   * Everything reaped lands in `result.removed` (see `applyMigrations`), because
   * deleting a file in the user's home directory must never be invisible.
   */
  private planHomeReap(
    migrations: HarnessMigration[],
    desired: HarnessDesiredState,
    baseEntries: ManagedEntries,
  ): void {
    const reap = this.options.homeReap;
    if (reap === undefined) return;

    let dir: string;
    try {
      dir = reap.dir();
    } catch {
      return;
    }

    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }

    const knownAgentIds = this.knownAgentIds(desired, baseEntries);
    for (const name of names) {
      const prefix = reap.prefixes.find((candidate) =>
        name.startsWith(candidate),
      );
      if (prefix === undefined) continue;
      const path = join(dir, name);
      const owned =
        hasPtahWriterSignature(path) ||
        knownAgentIds.has(this.homeEntryAgentId(name, prefix));
      if (!owned) continue;
      migrations.push({ kind: 'reap-home-entry', path });
    }
  }

  /**
   * Agent ids this target has EVER been asked to write: the ones desired now,
   * plus the ones its manifest still records.
   *
   * The manifest half is what makes a reap of a just-disabled agent work — the
   * home copy has to go on the same pass that removes the workspace copy, and by
   * then the id is no longer in the desired state.
   */
  private knownAgentIds(
    desired: HarnessDesiredState,
    baseEntries: ManagedEntries,
  ): ReadonlySet<string> {
    const ids = new Set<string>(desired.agents.map((agent) => agent.slug));
    const transformer = this.options.agentTransformer;
    if (transformer !== undefined) {
      for (const [relPath, entry] of Object.entries(baseEntries)) {
        if (entry.kind !== 'agent') continue;
        ids.add(basenameWithoutSuffix(relPath, transformer));
      }
    }
    return ids;
  }

  /** `ptah-backend-developer.agent.md` -> `backend-developer`. */
  private homeEntryAgentId(name: string, prefix: string): string {
    const withoutPrefix = name.slice(prefix.length);
    const transformer = this.options.agentTransformer;
    const suffix = transformer?.relPathFor('').split('/').pop() ?? '.md';
    return withoutPrefix.endsWith(suffix) && suffix !== ''
      ? withoutPrefix.slice(0, withoutPrefix.length - suffix.length)
      : withoutPrefix.replace(/\.md$/i, '');
  }

  // ------------------------------------------------------------------- apply

  private async applyMigrations(
    migrations: HarnessMigration[],
    result: HarnessApplyResult,
  ): Promise<void> {
    for (const migration of migrations) {
      try {
        if (migration.kind === 'unlink-junction') {
          await withWindowsRetry(() => unlink(migration.path));
        } else if (migration.kind === 'reap-home-entry') {
          await withWindowsRetry(() =>
            rm(migration.path, { recursive: true, force: true }),
          );
          result.removed.push(migration.path);
        } else {
          await withWindowsRetry(() => rm(migration.path, { force: true }));
        }
      } catch (error: unknown) {
        // Non-fatal by design: a legacy file that survives is adopted again on
        // the next pass and changes nothing, and a home leftover that resists
        // deletion shadows one agent rather than breaking the whole target.
        result.writeFailed.push({
          relPath: migration.path,
          reason: `migration ${migration.kind} failed: ${describeError(error)}`,
        });
      }
    }
  }

  private async applyWrite(
    write: HarnessPlanWrite,
    workspaceRoot: string,
    result: HarnessApplyResult,
  ): Promise<void> {
    const absolute = toAbsolute(workspaceRoot, write.relPath);
    try {
      const outputHash = await this.writeArtifact(write, absolute);
      // Recorded ONLY after the write succeeded: a manifest entry for a file
      // that is not on disk is exactly the record corruption E21 forbids.
      result.written[write.relPath] = managedEntry(
        outputHash,
        write.source,
        write.kind,
        write.sourceHash,
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

  /** Perform one write and answer the hash of what actually landed on disk. */
  private async writeArtifact(
    write: HarnessPlanWrite,
    absolute: string,
  ): Promise<string> {
    if (write.kind === 'skill') {
      const slug = write.relPath.slice(write.relPath.lastIndexOf('/') + 1);
      await copyDirectoryTransformed(write.source, absolute, slug);
      // Re-hashed rather than trusted: the copy was rewritten on the way out,
      // so only the result knows its own hash.
      return hashDirSync(absolute) ?? write.hash;
    }

    if (write.kind === 'agent') {
      const transformer = this.options.agentTransformer;
      if (transformer === undefined) {
        throw new Error(`Target "${this.id}" has no agent transformer`);
      }
      const content = transformer.transform({
        agentId: basenameWithoutSuffix(write.relPath, transformer),
        content: readFileSync(write.source, 'utf-8'),
      });
      await withWindowsRetry(() =>
        mkdir(dirname(absolute), { recursive: true }),
      );
      await withWindowsRetry(() => writeFile(absolute, content, 'utf-8'));
      return hashContent(content);
    }

    await copySingleFile(write.source, absolute, dirname(absolute));
    return write.hash;
  }
}

// ------------------------------------------------------------------- helpers

/**
 * What `planEntry` decided for one artifact.
 *
 * A union rather than three string literals because `unchanged` has to carry
 * the hash to record: the caller cannot re-derive it without repeating the
 * directory walk `planEntry` just did.
 */
type PlanEntryOutcome =
  | { kind: 'foreign' }
  | { kind: 'unchanged'; recordHash: string }
  | {
      kind: 'write';
      reason: 'create' | 'update';
      overwritesLocalEdit: boolean;
      /** The write is taking over an unowned file that proved it was ours. */
      adopted: boolean;
    };

/** One desired non-MCP artifact, already resolved to paths and hashes. */
interface DesiredEntry {
  kind: 'skill' | 'command' | 'agent';
  source: string;
  /** Hash of the user-layer source. */
  sourceHash: string;
  /** Hash of what should land on disk. Provisional for transformed directories. */
  outputHash: string;
  isDirectory: boolean;
  transformed: boolean;
}

interface OwnershipOracle {
  entryFor(relPath: string): ManagedEntries[string] | undefined;
}

function toAbsolute(workspaceRoot: string, relPath: string): string {
  return join(workspaceRoot, ...relPath.split('/'));
}

function dirOf(relPath: string): string {
  return relPath.slice(0, relPath.lastIndexOf('/'));
}

/**
 * Recover an agent id from its target path.
 *
 * Derived from the transformer's own `relPathFor` rather than assumed, so a
 * suffix like Copilot's `.agent.md` is stripped correctly without this engine
 * knowing any target's naming rule.
 */
function basenameWithoutSuffix(
  relPath: string,
  transformer: IHarnessAgentTransformer,
): string {
  const probe = transformer.relPathFor(' ');
  const marker = probe.indexOf(' ');
  const prefix = probe.slice(0, marker);
  const suffix = probe.slice(marker + 1);
  return relPath.slice(prefix.length, relPath.length - suffix.length);
}

function lstatSyncOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * `source: ptah` inside the leading YAML frontmatter — the marker every agent
 * the Ptah pipeline has ever emitted carries.
 *
 * `rewriteFrontmatter` (`transformers/transform-rules.ts`) writes it today and
 * wrote it in `agent-generation` before this lib absorbed the transformers
 * verbatim, so it identifies both the current output and the home-directory
 * leftovers of the deleted `MultiCliAgentWriterService`.
 *
 * Scoped to the frontmatter block on purpose: the same two words appearing in
 * the prose of an agent a user wrote must not authorise deleting it. A
 * directory, an unreadable path, or a file with no frontmatter all answer
 * `false` — the safe direction.
 */
function hasPtahWriterSignature(path: string): boolean {
  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return false;
  }
  const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (frontmatter === null) return false;
  return /^source:\s*ptah\s*$/m.test(frontmatter[1]);
}

/** Names recorded under `key` in a legacy `.ptah-managed.json`. */
function readLegacyNames(path: string, key: 'skills' | 'commands'): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const list = (parsed as Record<string, unknown>)[key];
    if (!Array.isArray(list)) return [];
    return list.filter((name): name is string => typeof name === 'string');
  } catch {
    return [];
  }
}
