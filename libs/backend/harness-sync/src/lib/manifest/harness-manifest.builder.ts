/**
 * Builds the desired state from the user layer plus the plugin overlay.
 *
 * Precedence, carried over verbatim from `SkillJunctionService.buildSkillsMap`
 * (agent-sdk, deleted in TASK_2026_278):
 *
 *   1. `~/.ptah/user/skills` is the BASE. The user-layer mirror has already
 *      unified bundled-plugin skills and synthesized skills there, so walking
 *      the synthesized root again would double-count.
 *   2. Enabled plugin directories are overlaid ADDITIVELY. This is the only
 *      route by which harness-authored `~/.ptah/plugins/ptah-harness-*` skills —
 *      which are not in `enabledPluginIds` and therefore never mirrored — reach
 *      a workspace.
 *   3. The user layer wins every collision. A plugin skill losing to its own
 *      mirrored copy is the expected case and is NOT reported; a plugin skill
 *      losing to a DIFFERENT plugin's skill is a real shadowing and is.
 *
 * One clause of (1) was wrong for skills and was corrected in TASK_2026_316:
 * the base is not admitted unconditionally. `~/.ptah/user/skills` is one
 * directory per MACHINE that only ever grows, so a workspace that enabled
 * nothing was inheriting the union of every plugin ever enabled anywhere on it.
 * Each clone's `.ptah-origin.json` names the plugin it came from, and
 * `plugin-origin-gate.ts` applies this workspace's plugin enablement to the base
 * loop as well as the overlay. Read that file before changing anything here:
 * every one of its rules exists to stop a plausible-looking filter from
 * deleting user data.
 *
 * Flat namespace, first-wins, no auto-namespacing. Renaming `run-tests` to
 * `dotnet-skills--run-tests` on copy would desynchronize the directory from the
 * frontmatter `name` that other skills reference in prose, and would invalidate
 * every saved per-skill toggle (`disabledSkillIds` is keyed by directory name)
 * with no derivable migration. The collision is surfaced instead.
 */

import { readdirSync, lstatSync, accessSync, constants } from 'fs';
import { basename, join, resolve } from 'path';
import type {
  HarnessCollision,
  HarnessSourcesStatus,
  HarnessTargetId,
} from '@ptah-extension/shared';
import {
  hashDirSync,
  hashFileSync,
  isIgnoredEntry,
} from '../hash/content-hash';
import type { HarnessSourceState } from '../sources/harness-source.port';
import { hashMcpConfig } from '../targets/mcp/mcp-json-format';
import type {
  HarnessDesiredAgent,
  HarnessDesiredCommand,
  HarnessDesiredMcpServer,
  HarnessDesiredSkill,
  HarnessDesiredState,
} from './desired-state.types';
import { createPluginOriginGate } from './plugin-origin-gate';
import { canonicalSlug, isReservedSlug } from './slug-rules';

/** Ids the reconciler knows how to route an MCP intent to. */
const HARNESS_TARGET_IDS: ReadonlySet<string> = new Set<HarnessTargetId>([
  'claude',
  'codex',
  'copilot',
  'cursor',
  'antigravity',
  'vscode',
]);

function isHarnessTargetId(value: string): value is HarnessTargetId {
  return HARNESS_TARGET_IDS.has(value);
}

/** Options that only tests and the preflight path need to vary. */
export interface HarnessManifestBuildOptions {
  /**
   * Set when the caller knows a content download is still in flight, so an
   * empty user layer is reported as `pending-download` rather than
   * `sources-missing`. Purely a reporting distinction — behaviour is identical.
   */
  downloadPending?: boolean;
  /**
   * The workspace-level consent gate for the `agents` facet, resolved by
   * `AgentSyncGate` (`state/agent-sync-gate.ts`). `false` makes the desired
   * agent list EMPTY, which — agents being manifest-owned — reaps whatever Ptah
   * previously wrote.
   *
   * Absent means enabled. The builder is not where the migration lives: the
   * gate resolves an unrecorded flag from manifest evidence and hands down a
   * boolean, so a caller that has no opinion (a spec, a preflight built by
   * hand) gets the pre-gate behaviour rather than an accidental reap.
   */
  agentSyncEnabled?: boolean;
}

export class HarnessManifestBuilder {
  build(
    sources: HarnessSourceState,
    options: HarnessManifestBuildOptions = {},
  ): HarnessDesiredState {
    const collisions: HarnessCollision[] = [];
    const skills = this.buildSkills(sources, collisions);
    const commands = this.buildCommands(sources, collisions);
    const agents = this.buildAgents(
      sources,
      collisions,
      options.agentSyncEnabled !== false,
    );

    return {
      skills,
      commands,
      agents,
      mcp: this.buildMcp(sources),
      collisions,
      // MCP is deliberately NOT counted. `sources` answers "did the user layer
      // have anything to offer", and MCP intents come from a different file
      // that is present on a cold offline first run when the user layer is not.
      sources: this.classifySources(
        skills.length + commands.length + agents.length,
        options.downloadPending === true,
      ),
      sourceRoots: this.deriveSourceRoots(sources),
    };
  }

  /**
   * Every absolute directory the sources for this pass live in.
   *
   * Deduplicated and sorted so two passes over an unchanged workspace produce
   * an identical list, and resolved so a relative root supplied by a host does
   * not silently fail the containment test in `ClaudeTarget`.
   */
  private deriveSourceRoots(sources: HarnessSourceState): string[] {
    const roots = new Set<string>();
    const add = (candidate: string): void => {
      if (candidate.trim() === '') return;
      roots.add(resolve(candidate));
    };

    add(sources.layout.skillsRoot);
    add(sources.layout.commandsRoot);
    add(sources.layout.agentsRoot);
    for (const root of sources.layout.legacyLinkRoots ?? []) add(root);
    for (const pluginPath of sources.overlayPluginPaths) add(pluginPath);

    return [...roots].sort();
  }

  // ------------------------------------------------------------------- mcp

  /**
   * MCP servers the user asked Ptah to install, from the intent store.
   *
   * The install target ids and the harness target ids are the same strings by
   * construction, so an intent maps to a target without a lookup table; an
   * unrecognised id is dropped rather than guessed at, which is what keeps a
   * hand-edited intent file from making a target write a server nobody asked
   * for.
   */
  private buildMcp(sources: HarnessSourceState): HarnessDesiredMcpServer[] {
    const servers: HarnessDesiredMcpServer[] = [];
    for (const intent of sources.mcpIntents ?? []) {
      const targets = intent.targets.filter(isHarnessTargetId);
      if (targets.length === 0) continue;
      servers.push({
        serverKey: intent.serverKey,
        registryName: intent.registryName,
        config: intent.config,
        targets,
        contentHash: hashMcpConfig(intent.config),
      });
    }
    return servers.sort((a, b) => a.serverKey.localeCompare(b.serverKey));
  }

  private classifySources(
    artifactCount: number,
    downloadPending: boolean,
  ): HarnessSourcesStatus {
    if (artifactCount > 0) return 'ok';
    return downloadPending ? 'pending-download' : 'sources-missing';
  }

  // ---------------------------------------------------------------- skills

  /**
   * Skills, gated twice over.
   *
   * 1. `disabledSkillIds` drops individual slugs — the per-skill toggle, keyed
   *    by directory name, unchanged since this lib was written.
   * 2. Plugin enablement is the OUTER gate, and until TASK_2026_316 it applied
   *    only to the overlay loop below. The user layer is the BASE, and it is one
   *    directory per MACHINE that accumulates a clone the first time any
   *    workspace enables a plugin — so unchecking that plugin removed it from
   *    the overlay and changed nothing, because the clone underneath still
   *    claimed the slug. `createPluginOriginGate` reads each clone's
   *    `.ptah-origin.json` and applies the same enablement question to it.
   *
   * A slug the gate rejects is NOT recorded in `userLayerSlugs`, deliberately.
   * That set exists to stop an overlay plugin's own mirrored copy being reported
   * as a collision; a rejected clone has vacated the slot, so a DIFFERENT
   * enabled plugin shipping the same slug should be free to claim it.
   *
   * Dropping a slug here is a REAP, not a skip — skills are manifest-owned, so
   * the removal sweep deletes the per-workspace copies. That is the intended fix
   * (the user unchecked the plugin), and it is why the gate fails open in every
   * case where it cannot prove enablement. The user-layer CLONE is untouched by
   * any of this: this lib never writes under `~/.ptah/user`, and the mirror's
   * reaper keeps a disabled plugin's clones on purpose, which is what makes
   * re-checking the box instant and offline.
   */
  private buildSkills(
    sources: HarnessSourceState,
    collisions: HarnessCollision[],
  ): HarnessDesiredSkill[] {
    const disabled = new Set(sources.disabledSkillIds);
    const pluginGate = createPluginOriginGate(sources);
    const claimed = new Map<string, HarnessDesiredSkill>();
    const userLayerSlugs = new Set<string>();

    for (const slug of this.listSkillSlugs(sources.layout.skillsRoot)) {
      if (disabled.has(slug)) continue;
      const cloneDir = join(sources.layout.skillsRoot, slug);
      if (!pluginGate(cloneDir)) continue;
      userLayerSlugs.add(canonicalSlug(slug));
      this.claimSkill(claimed, collisions, slug, cloneDir, undefined);
    }

    const disabledPlugins = new Set(sources.disabledPluginIds);
    for (const pluginPath of sources.overlayPluginPaths) {
      const pluginId = basename(pluginPath);
      if (disabledPlugins.has(pluginId)) continue;
      const pluginSkillsDir = join(pluginPath, 'skills');
      for (const slug of this.listSkillSlugs(pluginSkillsDir)) {
        if (disabled.has(slug)) continue;
        // Expected, not a conflict: the mirror already published this plugin's
        // skill into the user layer. Reporting it would drown the real cases.
        if (userLayerSlugs.has(canonicalSlug(slug))) continue;
        this.claimSkill(
          claimed,
          collisions,
          slug,
          join(pluginSkillsDir, slug),
          pluginId,
        );
      }
    }

    return [...claimed.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private claimSkill(
    claimed: Map<string, HarnessDesiredSkill>,
    collisions: HarnessCollision[],
    slug: string,
    sourceDir: string,
    pluginId: string | undefined,
  ): void {
    const collision = this.rejectSlug(claimed, slug, sourceDir, pluginId);
    if (collision !== null) {
      collisions.push(collision);
      return;
    }
    const contentHash = hashDirSync(sourceDir);
    if (contentHash === null) return;
    claimed.set(canonicalSlug(slug), { slug, sourceDir, contentHash });
  }

  /**
   * Shared admission check for skills and commands: returns the collision to
   * report, or `null` when the slug may be claimed.
   */
  private rejectSlug(
    claimed: Map<string, { slug: string }>,
    slug: string,
    source: string,
    pluginId: string | undefined,
  ): HarnessCollision | null {
    if (isReservedSlug(slug)) {
      return {
        slug,
        shadowedSource: source,
        ...(pluginId === undefined ? {} : { shadowedPluginId: pluginId }),
        reason: 'reserved-name',
      };
    }
    const existing = claimed.get(canonicalSlug(slug));
    if (existing === undefined) return null;
    return {
      slug,
      shadowedSource: source,
      ...(pluginId === undefined ? {} : { shadowedPluginId: pluginId }),
      reason: existing.slug === slug ? 'duplicate-slug' : 'case-collision',
    };
  }

  /** Directory entries under `root` that are real directories with a SKILL.md. */
  private listSkillSlugs(root: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return [];
    }
    const slugs: string[] = [];
    for (const entry of entries) {
      if (isIgnoredEntry(entry)) continue;
      const dir = join(root, entry);
      try {
        const stat = lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        accessSync(join(dir, 'SKILL.md'), constants.R_OK);
      } catch {
        continue;
      }
      slugs.push(entry);
    }
    return slugs.sort();
  }

  // -------------------------------------------------------------- commands

  private buildCommands(
    sources: HarnessSourceState,
    collisions: HarnessCollision[],
  ): HarnessDesiredCommand[] {
    const claimed = new Map<string, HarnessDesiredCommand>();
    const userLayerSlugs = new Set<string>();

    for (const file of this.listMarkdownFiles(sources.layout.commandsRoot)) {
      const slug = file.replace(/\.md$/i, '');
      userLayerSlugs.add(canonicalSlug(slug));
      this.claimCommand(
        claimed,
        collisions,
        slug,
        join(sources.layout.commandsRoot, file),
        undefined,
      );
    }

    const disabledPlugins = new Set(sources.disabledPluginIds);
    for (const pluginPath of sources.overlayPluginPaths) {
      const pluginId = basename(pluginPath);
      if (disabledPlugins.has(pluginId)) continue;
      const pluginCommandsDir = join(pluginPath, 'commands');
      for (const file of this.listMarkdownFiles(pluginCommandsDir)) {
        const slug = file.replace(/\.md$/i, '');
        if (userLayerSlugs.has(canonicalSlug(slug))) continue;
        this.claimCommand(
          claimed,
          collisions,
          slug,
          join(pluginCommandsDir, file),
          pluginId,
        );
      }
    }

    return [...claimed.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private claimCommand(
    claimed: Map<string, HarnessDesiredCommand>,
    collisions: HarnessCollision[],
    slug: string,
    sourceFile: string,
    pluginId: string | undefined,
  ): void {
    const collision = this.rejectSlug(claimed, slug, sourceFile, pluginId);
    if (collision !== null) {
      collisions.push(collision);
      return;
    }
    const contentHash = hashFileSync(sourceFile);
    if (contentHash === null) return;
    claimed.set(canonicalSlug(slug), { slug, sourceFile, contentHash });
  }

  // ---------------------------------------------------------------- agents

  /**
   * Agents, gated twice over — and both gates were missing until TASK_2026_286.
   *
   * 1. `agentSyncEnabled === false` makes the whole facet empty. That is the
   *    WORKSPACE-level consent: until the setup wizard has run (or the
   *    migration found evidence of a previous propagation), Ptah does not
   *    scatter subagents into `.codex/agents`, `.github/agents` and
   *    `.cursor/agents` for a project the user never asked it to.
   * 2. `disabledAgentIds` drops individual slugs, exactly as
   *    `disabledSkillIds` does in {@link buildSkills} — same key shape (the
   *    filename minus `.md`), same raw membership test, so one saved config can
   *    key both without a second canonicalisation rule to keep in step.
   *
   * Returning `[]` is a REAP, not a skip: agents are manifest-owned, so the
   * removal sweep deletes whatever this pass stopped asking for. That is the
   * behaviour we want when the user turns an agent off, and it is precisely why
   * the absent-flag case must never resolve to a bare `false` — see
   * `state/agent-sync-gate.ts`.
   */
  private buildAgents(
    sources: HarnessSourceState,
    collisions: HarnessCollision[],
    syncEnabled: boolean,
  ): HarnessDesiredAgent[] {
    if (!syncEnabled) return [];

    const disabled = new Set(sources.disabledAgentIds ?? []);
    const claimed = new Map<string, HarnessDesiredAgent>();
    for (const file of this.listMarkdownFiles(sources.layout.agentsRoot)) {
      const slug = file.replace(/\.md$/i, '');
      if (disabled.has(slug)) continue;
      const collision = this.rejectSlug(
        claimed,
        slug,
        join(sources.layout.agentsRoot, file),
        undefined,
      );
      if (collision !== null) {
        collisions.push(collision);
        continue;
      }
      const sourceFile = join(sources.layout.agentsRoot, file);
      const contentHash = hashFileSync(sourceFile);
      if (contentHash === null) continue;
      claimed.set(canonicalSlug(slug), { slug, sourceFile, contentHash });
    }
    return [...claimed.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  private listMarkdownFiles(root: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      if (isIgnoredEntry(entry)) continue;
      if (!entry.toLowerCase().endsWith('.md')) continue;
      try {
        const stat = lstatSync(join(root, entry));
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      files.push(entry);
    }
    return files.sort();
  }
}
