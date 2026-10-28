/**
 * CloneRebaseService - rebase one Library clone onto its upstream source
 * (TASK_2026_701 B12).
 *
 * Extracted from `skillSynthesis:rebaseClone` so the Library's own Rebase
 * button and the marketplace installers' replace step share one path: the
 * same upstream resolution, the same mirror write, the same registry update.
 *
 * The approval check (A21). A caller that replaces a clone on the user's
 * approval passes the clone body digest it recorded when the item was
 * offered. The digest is recomputed immediately before the rebase: an edit
 * made since the approval (edited again, deleted, recreated with other bytes,
 * now unreadable) answers `changed-since-approval` and nothing is written.
 *
 * Assumption A-rebase-lock: the mirror's rebase holds a per-slug lock, but it
 * is private to the mirror (only Ptah writers take it; the user's editor never
 * does), so the re-digest cannot run inside it. It runs directly before the
 * rebase call, the last point this layer can observe the clone, and the
 * rebase itself snapshots the replaced body into the clone's history, so the
 * remaining window cannot lose the user's text.
 */
import { join } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type ContentDownloadService,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  resolveSkillsRoot,
  type SkillRegistryKind,
  type SkillRegistryRow,
  type SkillRegistryStore,
} from '@ptah-extension/skill-synthesis';
import type {
  RebaseResult,
  UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS, type PluginLoaderService } from '@ptah-extension/agent-sdk';
import { resolveHarnessWorkspaceRoot } from '@ptah-extension/harness-sync';

export interface CloneRebaseOptions {
  /**
   * Harness root whose agent clones are addressed. Ignored for skills and
   * commands, whose Library roots are per-machine. Defaults to the harness
   * root of the open workspace.
   */
  scopeRoot?: string;
  /**
   * Clone body digest recorded when the user approved the replace. When set,
   * the rebase runs only while the clone still has exactly this digest.
   */
  expectedDigest?: string;
}

/**
 * - `unavailable`: this host has no skill registry or user-layer mirror.
 * - `not-found`: no Library clone is recorded for the slug.
 * - `source-unavailable`: no upstream source can be named for it.
 * - `changed-since-approval`: the clone no longer matches `expectedDigest`.
 * - `completed`: the mirror ran; `result.failed` reports its own failure.
 */
export type CloneRebaseOutcome =
  | { status: 'unavailable' }
  | { status: 'not-found' }
  | { status: 'source-unavailable' }
  | { status: 'changed-since-approval' }
  | { status: 'completed'; result: RebaseResult };

@injectable()
export class CloneRebaseService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN, { isOptional: true })
    private readonly mirror: UserLayerMirrorService | null,
    @inject(PLATFORM_TOKENS.CONTENT_DOWNLOAD, { isOptional: true })
    private readonly contentDownload: ContentDownloadService | null,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER, { isOptional: true })
    private readonly pluginLoader: PluginLoaderService | null,
  ) {}

  async rebase(
    kind: SkillRegistryKind,
    slug: string,
    options: CloneRebaseOptions = {},
  ): Promise<CloneRebaseOutcome> {
    const registry = this.registry;
    const mirror = this.mirror;
    if (!registry || !mirror) return { status: 'unavailable' };

    const row = registry.getBySlug(kind, slug);
    if (!row) return { status: 'not-found' };

    const scopeRoot = options.scopeRoot ?? this.openHarnessRoot();
    const identity = await this.readIdentity(mirror, kind, slug, scopeRoot);
    if (
      options.expectedDigest !== undefined &&
      (identity === 'unreadable' ||
        identity === null ||
        identity.contentDigest !== options.expectedDigest)
    ) {
      this.logger.info('[clone-rebase] clone changed since approval; kept', {
        kind,
        slug,
      });
      return { status: 'changed-since-approval' };
    }

    const sourceRef =
      identity !== null && identity !== 'unreadable'
        ? identity.sourceRef
        : undefined;
    const sourceDir = this.resolveUpstreamSourceDir(
      kind,
      slug,
      row,
      sourceRef,
      scopeRoot,
    );
    if (!sourceDir) return { status: 'source-unavailable' };

    const result = await mirror.rebaseClone({
      kind,
      slug,
      sourceDir,
      workspaceRoot: scopeRoot,
    });
    if (!result.failed) {
      registry.setDiverged(kind, slug, false);
      registry.setPending(kind, slug, null);
    }
    return { status: 'completed', result };
  }

  /** The harness root of the open workspace, or `undefined` with none open. */
  private openHarnessRoot(): string | undefined {
    const root = this.workspaceProvider.getWorkspaceRoot();
    return root && root.length > 0 ? resolveHarnessWorkspaceRoot(root) : undefined;
  }

  /**
   * The clone's live digest and source identity, `null` when it has no origin
   * sidecar, or `'unreadable'` when the sidecar cannot be read. Only the
   * approval check needs certainty; a plain rebase falls back to the
   * registry's plugin id when the identity is unknown.
   */
  private async readIdentity(
    mirror: UserLayerMirrorService,
    kind: SkillRegistryKind,
    slug: string,
    scopeRoot: string | undefined,
  ): Promise<{ contentDigest: string | null; sourceRef?: string } | null | 'unreadable'> {
    try {
      return await mirror.readCloneEditState(kind, slug, scopeRoot);
    } catch (error: unknown) {
      // degradation-audit: reported - an unreadable sidecar is logged and
      // answered as 'unreadable', which keeps an approved clone
      // (`changed-since-approval`) and lets a plain rebase fall back to the
      // registry's plugin id.
      this.logger.warn('[clone-rebase] clone origin unreadable', {
        kind,
        slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unreadable';
    }
  }

  /**
   * Where the rebase copies FROM, for every clone kind and both origins.
   *
   * A clone that records its source identity (`sourceRef`, A28) resolves to
   * that source's live plugin directory, so an external plugin under
   * `plugins/external/<owner>/<repo>/<plugin>` and a workspace harness plugin
   * are found by identity, never by directory basename. Otherwise:
   *
   *  - a plugin clone resolves under `<pluginsPath>/<originPluginId>`, to the
   *    skill directory or the command/agent `<slug>.md` FILE (`rebaseFileClone`
   *    probes a file);
   *  - a SYNTH skill resolves to `<skillsRoot>/<slug>/`;
   *  - a workspace agent resolves to `{harnessRoot}/.claude/agents/<slug>.md`,
   *    the folder the agent mirror reads;
   *  - a command with no plugin origin has no upstream: nothing writes a
   *    plugin-less command clone, so inventing a path would rebase from one
   *    that never existed.
   */
  private resolveUpstreamSourceDir(
    kind: SkillRegistryKind,
    slug: string,
    row: SkillRegistryRow,
    sourceRef: string | undefined,
    scopeRoot: string | undefined,
  ): string | null {
    if (isUnsafePathSegment(slug)) return null;

    const pluginRoot =
      sourceRef !== undefined ? this.pluginRootFor(sourceRef) : null;
    if (pluginRoot !== null) return upstreamIn(pluginRoot, kind, slug);

    if (row.originPluginId) {
      if (!this.contentDownload) return null;
      if (isUnsafePathSegment(row.originPluginId)) return null;
      const pluginsPath = this.contentDownload.getPluginsPath();
      return upstreamIn(join(pluginsPath, row.originPluginId), kind, slug);
    }

    if (kind === 'skill') {
      return join(resolveSkillsRoot(this.workspaceProvider), slug);
    }
    if (kind === 'agent') {
      return scopeRoot
        ? join(scopeRoot, '.claude', 'agents', `${slug}.md`)
        : null;
    }
    return null;
  }

  /** The live plugin directory whose descriptor carries `sourceRef`, or null. */
  private pluginRootFor(sourceRef: string): string | null {
    if (!this.pluginLoader) return null;
    try {
      const matches = Object.entries(
        this.pluginLoader.getPluginSourceDescriptors(),
      ).filter(([, descriptor]) => descriptor.sourceRef === sourceRef);
      return matches.length === 1 ? matches[0][0] : null;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without live descriptors the
      // rebase falls back to the registry's plugin id, the resolution it used
      // before source identity existed.
      this.logger.warn('[clone-rebase] plugin descriptors unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function upstreamIn(
  pluginRoot: string,
  kind: SkillRegistryKind,
  slug: string,
): string {
  if (kind === 'skill') return join(pluginRoot, 'skills', slug);
  if (kind === 'command') return join(pluginRoot, 'commands', `${slug}.md`);
  return join(pluginRoot, 'agents', `${slug}.md`);
}

/**
 * Reject anything that would let a stored id or slug escape the root it is
 * joined onto. Applied to BOTH halves of the join — the slug reaches here from
 * RPC params and the plugin id from a SQLite row, and either is enough.
 */
function isUnsafePathSegment(segment: string): boolean {
  return (
    segment.length === 0 ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('..')
  );
}
