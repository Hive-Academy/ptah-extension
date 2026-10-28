/**
 * MarketplaceLocalItemsService - find the local items a marketplace action
 * would affect, and record each one for approval (TASK_2026_701 B12, A21).
 *
 * Two questions, one per kind of installer:
 *
 * - **Consent plan** (external install, {@link planLocalItems}): before the
 *   user confirms, what local items stand where the plugin's skills, commands
 *   and agents would land? Destination files from the B9 scanner (`unowned`,
 *   `owned-edited`, `unreadable`), edited Library clones whose `sourceRef` is
 *   this plugin, and workspace agents that shadow a plugin agent
 *   (`agent-source`).
 * - **Kept report** (skills.sh install, plugin enable, {@link keptReport}):
 *   after a no-dialog action, which of its destinations did propagation leave
 *   as the user's? `blockedTargetPaths ∪ keptLocalEdit` from the returned
 *   health, narrowed to the action's slugs by the scanner, plus the workspace
 *   agents that shadow an enabled plugin's agents.
 *
 * Every item is registered in {@link LocalItemApprovals} with the digest it
 * has now; only the `approvalId` leaves the server. Nothing here writes, and
 * nothing here throws: a probe that fails drops (or downgrades) one item and
 * is logged, because a missing offer is safe — the item simply stays the
 * user's.
 */
import { join } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import {
  HARNESS_SYNC_TOKENS,
  hashContent,
  type HarnessDestination,
  type HarnessDestinationItem,
  type HarnessDestinationScanner,
} from '@ptah-extension/harness-sync';
import { USER_LAYER_MIRROR_SERVICE_TOKEN } from '@ptah-extension/skill-synthesis';
import type { UserLayerMirrorService } from '@ptah-extension/agent-generation';
import {
  blockedTargetPaths,
  type ExternalLocalItem,
  type ExternalLocalItemKind,
  type HarnessHealth,
  type KeptItem,
  type KeptItemReason,
  type LocalItemFamily,
  type SkillCloneKind,
} from '@ptah-extension/shared';
import {
  LocalItemApprovals,
  type LocalItemApprovalInput,
} from './local-item-approvals';

/** The slugs one plugin (or one skills.sh source) ships. */
export interface LocalItemSlugs {
  skills: readonly string[];
  commands: readonly string[];
  agents: readonly string[];
}

export interface PlanLocalItemsRequest {
  family: LocalItemFamily;
  harnessRoot: string;
  /** Durable identity of the source that would replace the items (A28). */
  sourceRef: string;
  slugs: LocalItemSlugs;
  /** Approval lifetime: the consent token's remaining lifetime. */
  ttlMs: number;
}

export interface KeptReportRequest {
  harnessRoot: string;
  sourceRef: string;
  slugs: LocalItemSlugs;
  /** Health of the pass the action ran; `null` reports no file items. */
  health: HarnessHealth | null;
  /** Family whose route replaces a kept destination file. */
  fileFamily: LocalItemFamily;
  /**
   * Family whose route replaces a workspace agent shadowing a plugin agent.
   * Absent: shadowing agents are not reported (a source with no agents).
   */
  agentFamily?: LocalItemFamily;
}

/** One item found, before it is registered. */
type FoundItem = Omit<LocalItemApprovalInput, 'harnessRoot' | 'sourceRef'>;

@injectable()
export class MarketplaceLocalItemsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(LocalItemApprovals) private readonly approvals: LocalItemApprovals,
    @inject(HARNESS_SYNC_TOKENS.DESTINATION_SCANNER)
    private readonly scanner: HarnessDestinationScanner,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN, { isOptional: true })
    private readonly mirror: UserLayerMirrorService | null,
  ) {}

  /** The consent plan's local items, each registered for `ttlMs`. */
  async planLocalItems(
    request: PlanLocalItemsRequest,
  ): Promise<ExternalLocalItem[]> {
    const destinations = await this.scan(request.harnessRoot, request.slugs);
    const found: FoundItem[] = [];
    for (const destination of destinations) {
      const kind = localKindOf(destination.state);
      if (kind === null) continue;
      if (isClaudeAgentPath(destination)) {
        found.push(
          await this.agentSourceItem(
            request.harnessRoot,
            destination,
            request.family,
          ),
        );
        continue;
      }
      found.push(fileItem(destination, kind, request.family));
    }
    found.push(
      ...(await this.editedClones(
        request.harnessRoot,
        request.sourceRef,
        request.slugs,
        request.family,
      )),
    );

    return found.map((item) => {
      const approvalId = this.register(request, item, request.ttlMs);
      return {
        approvalId,
        ...(item.target !== undefined ? { target: item.target } : {}),
        relPath: item.relPath,
        family: item.family,
        kind: item.kind,
      };
    });
  }

  /** The items a no-dialog action left as the user's, each registered. */
  async keptReport(request: KeptReportRequest): Promise<KeptItem[]> {
    const destinations = await this.scan(request.harnessRoot, request.slugs);
    const keptPaths = keptPathsOf(request.health);
    const found: FoundItem[] = [];
    for (const destination of destinations) {
      const kind = localKindOf(destination.state);
      if (kind === null) continue;
      if (isClaudeAgentPath(destination)) {
        if (request.agentFamily === undefined) continue;
        found.push(
          await this.agentSourceItem(
            request.harnessRoot,
            destination,
            request.agentFamily,
          ),
        );
        continue;
      }
      if (!keptPaths.has(pathKey(destination.target, destination.relPath))) {
        continue;
      }
      found.push(fileItem(destination, kind, request.fileFamily));
    }

    return found.map((item) => ({
      approvalId: this.register(request, item),
      family: item.family,
      ...(item.target !== undefined ? { target: item.target } : {}),
      relPath: item.relPath,
      reason: keptReasonFor(item.kind),
    }));
  }

  private register(
    request: { harnessRoot: string; sourceRef: string },
    item: FoundItem,
    ttlMs?: number,
  ): string {
    return this.approvals.register(
      {
        ...item,
        harnessRoot: request.harnessRoot,
        sourceRef: request.sourceRef,
      },
      ttlMs !== undefined ? { ttlMs } : {},
    );
  }

  private async scan(
    harnessRoot: string,
    slugs: LocalItemSlugs,
  ): Promise<HarnessDestination[]> {
    const items: HarnessDestinationItem[] = [
      ...slugs.skills.map((slug) => ({ kind: 'skill' as const, slug })),
      ...slugs.commands.map((slug) => ({ kind: 'command' as const, slug })),
      ...slugs.agents.map((slug) => ({ kind: 'agent' as const, slug })),
    ];
    if (items.length === 0) return [];
    try {
      return await this.scanner.scan(harnessRoot, items);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the scanner is documented as
      // never throwing; if it does, no item is offered and every destination
      // stays as it is (the reconciler's own keep rule still applies).
      this.logger.warn('[marketplace-local-items] destination scan failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * A workspace agent at `{harnessRoot}/.claude/agents/<slug>.md` that would
   * shadow the plugin agent of the same slug. Its digest is the text hash the
   * guarded agent writer compares under its lock; an unreadable file is an
   * `unreadable` item that can never be replaced.
   */
  private async agentSourceItem(
    harnessRoot: string,
    destination: HarnessDestination,
    family: LocalItemFamily,
  ): Promise<FoundItem> {
    const base = {
      family,
      target: destination.target,
      relPath: destination.relPath,
      cloneKind: 'agent' as const,
      slug: destination.slug,
    };
    if (destination.state === 'unreadable') {
      return { ...base, kind: 'unreadable', digest: null };
    }
    try {
      const text = await this.fileSystem.readFile(
        join(harnessRoot, '.claude', 'agents', `${destination.slug}.md`),
      );
      return { ...base, kind: 'agent-source', digest: hashContent(text) };
    } catch (error: unknown) {
      // Logged and kept: the agent is offered as unreadable,
      // which keeps it; the read error is logged here.
      this.logger.warn('[marketplace-local-items] workspace agent unreadable', {
        slug: destination.slug,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...base, kind: 'unreadable', digest: null };
    }
  }

  /**
   * Library clones of the source's slugs that carry local edits and were made
   * from THIS source (`sourceRef`, never a basename match). A host without the
   * user-layer mirror has no Library and offers none.
   */
  private async editedClones(
    harnessRoot: string,
    sourceRef: string,
    slugs: LocalItemSlugs,
    family: LocalItemFamily,
  ): Promise<FoundItem[]> {
    const mirror = this.mirror;
    if (mirror === null) return [];
    const wanted: Array<{ kind: SkillCloneKind; slug: string }> = [
      ...slugs.skills.map((slug) => ({ kind: 'skill' as const, slug })),
      ...slugs.commands.map((slug) => ({ kind: 'command' as const, slug })),
      ...slugs.agents.map((slug) => ({ kind: 'agent' as const, slug })),
    ];
    const found: FoundItem[] = [];
    for (const { kind, slug } of wanted) {
      try {
        const state = await mirror.readCloneEditState(kind, slug, harnessRoot);
        if (state === null || !state.exists || !state.edited) continue;
        if (state.sourceRef !== sourceRef) continue;
        found.push({
          family,
          kind: 'library-clone',
          relPath: cloneRelPath(kind, slug),
          cloneKind: kind,
          slug,
          digest: state.contentDigest,
        });
      } catch (error: unknown) {
        // Logged and kept: an unreadable clone origin is not
        // offered for replace, so the clone stays the user's; logged here.
        this.logger.warn('[marketplace-local-items] clone state unreadable', {
          kind,
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return found;
  }
}

/** The Claude agent path is where a workspace agent (a source) lives. */
function isClaudeAgentPath(destination: HarnessDestination): boolean {
  return (
    destination.kind === 'agent' &&
    destination.target === 'claude' &&
    destination.relPath === `.claude/agents/${destination.slug}.md`
  );
}

/** The local-item kind of a destination state; `null` when Ptah may write it. */
function localKindOf(
  state: HarnessDestination['state'],
): ExternalLocalItemKind | null {
  switch (state) {
    case 'unowned':
    case 'owned-edited':
    case 'unreadable':
      return state;
    case 'absent':
    case 'owned-unmodified':
      return null;
  }
}

function fileItem(
  destination: HarnessDestination,
  kind: ExternalLocalItemKind,
  family: LocalItemFamily,
): FoundItem {
  return {
    family,
    kind,
    target: destination.target,
    relPath: destination.relPath,
    digest: kind === 'unreadable' ? null : destination.digest,
  };
}

function cloneRelPath(kind: SkillCloneKind, slug: string): string {
  switch (kind) {
    case 'skill':
      return `skills/${slug}`;
    case 'command':
      return `commands/${slug}.md`;
    case 'agent':
      return `agents/${slug}.md`;
  }
}

/**
 * Why a local item that stays in place is kept: the one kind -> reason map,
 * shared with the external confirm's plan report.
 */
export function keptReasonFor(kind: ExternalLocalItemKind): KeptItemReason {
  switch (kind) {
    case 'unowned':
      return 'unowned';
    case 'unreadable':
      return 'unreadable';
    case 'agent-source':
      return 'shadowed';
    case 'owned-edited':
    case 'library-clone':
      return 'owned-edited';
  }
}

function pathKey(target: string, relPath: string): string {
  return `${target}\n${relPath}`;
}

/** Every `blockedTargetPaths ∪ keptLocalEdit` path in `health`, per target. */
function keptPathsOf(health: HarnessHealth | null): ReadonlySet<string> {
  const keys = new Set<string>();
  if (health === null) return keys;
  for (const target of health.targets) {
    for (const relPath of blockedTargetPaths(target)) {
      keys.add(pathKey(target.target, relPath));
    }
    for (const relPath of target.keptLocalEdit) {
      keys.add(pathKey(target.target, relPath));
    }
  }
  return keys;
}
