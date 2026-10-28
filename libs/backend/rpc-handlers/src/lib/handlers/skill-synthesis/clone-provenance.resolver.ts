/**
 * CloneProvenanceResolver - where a Library clone came from, and why a
 * diverged one diverged (TASK_2026_701 B13, A11, A28).
 *
 * Provenance is decided only from recorded origin markers, never from names
 * or paths:
 *
 * - a clone whose sidecar records `sourceRef` resolves through the live plugin
 *   descriptors BY THAT REF. Two external plugins whose directories share a
 *   basename therefore keep their own names. `skills-sh:*` refs become
 *   `skills.sh: owner/repo`, read from the source root's `.ptah-skillssh.json`
 *   while the root exists;
 * - a source that is gone keeps the display name the mirror recorded while it
 *   existed (`sourceLabel`), so an uninstalled plugin whose name differs from
 *   its id still shows its name; with no recorded name the plugin id is shown;
 * - a legacy sidecar without `sourceRef` resolves through a live descriptor by
 *   plugin id only when exactly one source matches, else by the plugin id;
 * - a clone with no plugin (`pluginId: null`, or no sidecar) is the setup
 *   wizard's when the wizard's agent-origin store for the harness root records
 *   that agent (a hand edit keeps the label; a pack replace forgets the
 *   record), and a workspace file otherwise.
 *
 * Plugin state: no live descriptor → `uninstalled`; a descriptor whose plugin
 * is not in the workspace's current overlay → `turned-off`; else `active`.
 *
 * Failure: when the plugin sources cannot be read the whole resolution fails
 * and the caller omits `provenance`, which every surface renders as
 * "Workspace file" (3.9). Nothing here writes.
 */
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  type PluginLoaderService,
  type PluginSourceDescriptor,
} from '@ptah-extension/agent-sdk';
import {
  AGENT_GENERATION_TOKENS,
  type WizardAgentOriginStore,
} from '@ptah-extension/agent-generation';
import type {
  DivergedReason,
  LibraryPluginState,
  LibraryProvenance,
  SkillCloneKind,
} from '@ptah-extension/shared';
import {
  SKILLS_SH_METADATA_FILE,
  SKILLS_SH_PLUGIN_PREFIX,
  SkillsShRootMetadataSchema,
} from '../../skills-sh/skills-sh-source-root';

const SKILLS_SH_REF_PREFIX = 'skills-sh:';
const PTAH_REF_PREFIX = 'ptah:';
const HARNESS_REF_PREFIX = 'harness:';

/** What the resolver needs to know about one clone. */
export interface CloneOriginFacts {
  kind: SkillCloneKind;
  slug: string;
  /** Sidecar `pluginId`; `null` for a plugin-less clone or no sidecar. */
  pluginId: string | null;
  sourceRef?: string;
  sourceLabel?: string;
  diverged: boolean;
  pendingSourceHash: string | null;
}

export interface ResolvedCloneOrigin {
  provenance: LibraryProvenance;
  /** Present only for a diverged clone. */
  divergedReason?: DivergedReason;
}

/** The live sources and wizard records one listing resolves against. */
interface ResolutionContext {
  /** `[absolute plugin path, descriptor]` for every live source. */
  descriptors: ReadonlyArray<readonly [string, PluginSourceDescriptor]>;
  /** Resolved plugin paths in the workspace's current overlay. */
  activePaths: ReadonlySet<string>;
  /** Wizard-written agent slug → the hash the wizard wrote. */
  wizardAgents: ReadonlyMap<string, string>;
  /** skills.sh root path → its recorded `owner/repo`, read once. */
  skillsShSources: Map<string, Promise<string | null>>;
}

@injectable()
export class CloneProvenanceResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER, { isOptional: true })
    private readonly pluginLoader: PluginLoaderService | null,
    @inject(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE, { isOptional: true })
    private readonly wizardOrigins: WizardAgentOriginStore | null,
  ) {}

  /**
   * Resolve every clone in `clones` against one read of the live sources.
   *
   * @param scopeRoot Harness root of the open workspace (the agent scope), or
   *   `undefined` with no folder open.
   * @returns One entry per clone, in order, or `null` when the sources could
   *   not be read (the caller then omits provenance).
   */
  async resolveAll(
    scopeRoot: string | undefined,
    clones: readonly CloneOriginFacts[],
  ): Promise<ResolvedCloneOrigin[] | null> {
    const context = await this.loadContext(scopeRoot);
    if (context === null) return null;
    return Promise.all(clones.map((clone) => this.resolveOne(context, clone)));
  }

  private async loadContext(
    scopeRoot: string | undefined,
  ): Promise<ResolutionContext | null> {
    const loader = this.pluginLoader;
    if (!loader) return null;
    let descriptors: Array<[string, PluginSourceDescriptor]>;
    let activePaths: Set<string>;
    try {
      descriptors = Object.entries(loader.getPluginSourceDescriptors()).map(
        ([pluginPath, descriptor]) => [resolve(pluginPath), descriptor],
      );
      activePaths = new Set(
        loader.resolveCurrentPluginPaths(scopeRoot).map((p) => resolve(p)),
      );
    } catch (error: unknown) {
      // degradation-audit: reported - logged; `null` makes the caller omit
      // provenance, which every surface renders as "Workspace file" (3.9).
      this.logger.warn(
        '[clone-provenance] plugin sources unreadable; provenance omitted',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }

    const wizardAgents = new Map<string, string>();
    if (scopeRoot !== undefined && this.wizardOrigins) {
      // `read` never throws: a missing or damaged record reads as empty, which
      // can only drop the setup-wizard label, never invent it.
      const origins = await this.wizardOrigins.read(scopeRoot);
      for (const [slug, entry] of Object.entries(origins)) {
        wizardAgents.set(slug, entry.hash);
      }
    }
    return {
      descriptors,
      activePaths,
      wizardAgents,
      skillsShSources: new Map(),
    };
  }

  private async resolveOne(
    context: ResolutionContext,
    clone: CloneOriginFacts,
  ): Promise<ResolvedCloneOrigin> {
    const provenance = await this.provenanceOf(context, clone);
    if (!clone.diverged) return { provenance };
    return { provenance, divergedReason: this.divergedReasonOf(context, clone, provenance) };
  }

  private async provenanceOf(
    context: ResolutionContext,
    clone: CloneOriginFacts,
  ): Promise<LibraryProvenance> {
    if (clone.pluginId === null && clone.sourceRef === undefined) {
      return clone.kind === 'agent' && context.wizardAgents.has(clone.slug)
        ? { kind: 'setup-wizard' }
        : { kind: 'workspace' };
    }

    let sourceRef = clone.sourceRef;
    let candidates: ReadonlyArray<readonly [string, PluginSourceDescriptor]> = [];
    if (sourceRef !== undefined) {
      const ref = sourceRef;
      candidates = context.descriptors.filter(([, d]) => d.sourceRef === ref);
    } else if (clone.pluginId !== null) {
      // Legacy sidecar: the directory basename is the only key it recorded,
      // so it names a source only while exactly one live source has it.
      const pluginId = clone.pluginId;
      candidates = context.descriptors.filter(([p]) => basename(p) === pluginId);
    }
    const match = candidates.length === 1 ? candidates[0] : null;
    if (sourceRef === undefined) sourceRef = match?.[1].sourceRef;

    if (sourceRef?.startsWith(SKILLS_SH_REF_PREFIX) || isSkillsShId(clone.pluginId)) {
      return {
        kind: 'skills-sh',
        source: await this.skillsShSource(context, clone, match, sourceRef),
      };
    }

    const pluginId = pluginIdOf(sourceRef, clone.pluginId);
    const name = match?.[1].label ?? clone.sourceLabel ?? pluginId;
    return {
      kind: 'plugin',
      pluginId,
      name,
      state: stateOf(context, candidates),
    };
  }

  /**
   * A11: the wizard when the pending source hash is the one the wizard last
   * wrote for the agent; the plugin when the clone has a plugin source; else
   * a source change with no specific wording.
   */
  private divergedReasonOf(
    context: ResolutionContext,
    clone: CloneOriginFacts,
    provenance: LibraryProvenance,
  ): DivergedReason {
    const wizardHash =
      clone.kind === 'agent' ? context.wizardAgents.get(clone.slug) : undefined;
    if (
      wizardHash !== undefined &&
      clone.pendingSourceHash !== null &&
      clone.pendingSourceHash === wizardHash
    ) {
      return { kind: 'setup-wizard' };
    }
    if (provenance.kind === 'plugin') {
      return { kind: 'plugin', pluginName: provenance.name };
    }
    if (provenance.kind === 'skills-sh') {
      return { kind: 'plugin', pluginName: provenance.source };
    }
    return { kind: 'source-changed' };
  }

  /**
   * `owner/repo` for a skills.sh clone: the live root's metadata, else the
   * recorded label, else the directory name without its prefix.
   */
  private async skillsShSource(
    context: ResolutionContext,
    clone: CloneOriginFacts,
    match: readonly [string, PluginSourceDescriptor] | null,
    sourceRef: string | undefined,
  ): Promise<string> {
    if (match !== null) {
      const rootPath = match[0];
      let pending = context.skillsShSources.get(rootPath);
      if (pending === undefined) {
        pending = this.readSkillsShSource(rootPath);
        context.skillsShSources.set(rootPath, pending);
      }
      const recorded = await pending;
      if (recorded !== null) return recorded;
    }
    if (clone.sourceLabel !== undefined) return clone.sourceLabel;
    const dir =
      sourceRef?.startsWith(SKILLS_SH_REF_PREFIX) === true
        ? sourceRef.slice(SKILLS_SH_REF_PREFIX.length)
        : (clone.pluginId ?? '');
    return dir.startsWith(SKILLS_SH_PLUGIN_PREFIX)
      ? dir.slice(SKILLS_SH_PLUGIN_PREFIX.length)
      : dir;
  }

  private async readSkillsShSource(rootPath: string): Promise<string | null> {
    try {
      const raw = await readFile(join(rootPath, SKILLS_SH_METADATA_FILE), 'utf8');
      const parsed = SkillsShRootMetadataSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data.source : null;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the metadata only words the
      // label; without it the clone shows the source name recorded by the
      // mirror, which is the same `owner/repo` written at install time.
      this.logger.debug('[clone-provenance] skills.sh metadata unreadable', {
        rootPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function isSkillsShId(pluginId: string | null): boolean {
  return pluginId?.startsWith(SKILLS_SH_PLUGIN_PREFIX) === true;
}

/** The id the Marketplace shows for a plugin source. */
function pluginIdOf(sourceRef: string | undefined, pluginId: string | null): string {
  if (sourceRef?.startsWith(PTAH_REF_PREFIX)) {
    return sourceRef.slice(PTAH_REF_PREFIX.length);
  }
  if (sourceRef?.startsWith(HARNESS_REF_PREFIX)) {
    return sourceRef.slice(HARNESS_REF_PREFIX.length);
  }
  // An external ref already is the plugin id (`external:<owner>/<repo>/<plugin>`).
  return sourceRef ?? pluginId ?? '';
}

/**
 * No live source → uninstalled. Otherwise active when a matching source is in
 * the workspace's current overlay (an ambiguous legacy id counts as active
 * when any of its candidates is), else turned off.
 */
function stateOf(
  context: ResolutionContext,
  candidates: ReadonlyArray<readonly [string, PluginSourceDescriptor]>,
): LibraryPluginState {
  if (candidates.length === 0) return 'uninstalled';
  return candidates.some(([p]) => context.activePaths.has(p))
    ? 'active'
    : 'turned-off';
}
