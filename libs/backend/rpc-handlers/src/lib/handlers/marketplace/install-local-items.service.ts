/**
 * InstallLocalItemsService - apply the user's "replace" decisions for the
 * local items a marketplace install left in place (TASK_2026_701 B12, A21).
 *
 * The decisions name only server-issued `approvalId`s. Each one is taken from
 * {@link LocalItemApprovals} bound to the calling family and harness root, so
 * an id issued for one installer family (or one repository) can never replace
 * an item through another family's route. Every route re-checks the item
 * against the digest recorded at approval time, under the lock its own write
 * takes, before it mutates anything:
 *
 * - a destination file or skill directory → `HarnessBlockedRepairService
 *   .repair` with `expectedDigest`, which re-digests under the workspace lock;
 * - an edited Library clone → `CloneRebaseService.rebase` with the clone body
 *   digest, re-digested immediately before the rebase write;
 * - a workspace agent shadowing a plugin agent (`agent-source`) → the guarded
 *   agent writer, `replace-allowed` with the approval digest as its baseline,
 *   re-checked under the destination write lock it shares with the wizard and
 *   pack writers.
 *
 * Anything that changed since the approval (edited again, deleted, recreated,
 * now unreadable) is kept with `changed-since-approval`; a route failure is
 * kept with its error. Nothing here throws for a single item: one failing item
 * never blocks the others.
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
  type HarnessBlockedRepairService,
} from '@ptah-extension/harness-sync';
import {
  AGENT_GENERATION_TOKENS,
  type IAgentFileWriterService,
} from '@ptah-extension/agent-generation';
import { SDK_TOKENS, type PluginLoaderService } from '@ptah-extension/agent-sdk';
import type {
  ExternalLocalItemKind,
  HarnessRepairBlockedPath,
  KeptItem,
  KeptItemReason,
  LocalItemFamily,
} from '@ptah-extension/shared';
import {
  LocalItemApprovals,
  type LocalItemApproval,
} from './local-item-approvals';
import { CloneRebaseService } from '../skill-synthesis/clone-rebase.service';

export interface ApplyLocalItemsRequest {
  /** The family whose route is applying the decisions. */
  family: LocalItemFamily;
  /** Harness root the calling action resolved for the open workspace. */
  harnessRoot: string;
  /** Approval ids the user chose to replace. Duplicates are applied once. */
  approvalIds: readonly string[];
}

export interface ApplyLocalItemsReport {
  replaced: KeptItem[];
  /** Items still the user's; `error` is set when a replace attempt failed. */
  kept: Array<KeptItem & { error?: string }>;
  /**
   * Ids that named no live approval of this family and harness root (unknown,
   * expired, already used, or issued to another family). Nothing was done.
   */
  unknown: string[];
}

type KeptEntry = KeptItem & { error?: string };

/** One approval's result, in request order. */
type Slot =
  | { state: 'replaced'; item: KeptItem }
  | { state: 'kept'; item: KeptEntry };

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

@injectable()
export class InstallLocalItemsService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(LocalItemApprovals) private readonly approvals: LocalItemApprovals,
    @inject(HARNESS_SYNC_TOKENS.BLOCKED_REPAIR)
    private readonly repairService: HarnessBlockedRepairService,
    @inject(CloneRebaseService)
    private readonly cloneRebase: CloneRebaseService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER_SERVICE)
    private readonly agentWriter: IAgentFileWriterService,
    @inject(SDK_TOKENS.SDK_PLUGIN_LOADER)
    private readonly pluginLoader: PluginLoaderService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  async apply(request: ApplyLocalItemsRequest): Promise<ApplyLocalItemsReport> {
    const unknown: string[] = [];
    const approved: LocalItemApproval[] = [];
    for (const approvalId of new Set(request.approvalIds)) {
      const approval = this.approvals.take(
        approvalId,
        request.family,
        request.harnessRoot,
      );
      if (approval === null) unknown.push(approvalId);
      else approved.push(approval);
    }

    const slots = new Array<Slot>(approved.length);
    const repairs: Array<{ index: number; path: HarnessRepairBlockedPath }> = [];
    const pending: Array<Promise<void>> = [];

    approved.forEach((approval, index) => {
      if (approval.kind === 'unreadable' || approval.digest === null) {
        slots[index] = kept(approval, 'unreadable');
        return;
      }
      switch (approval.kind) {
        case 'unowned':
        case 'owned-edited':
          if (approval.target === undefined) {
            slots[index] = kept(approval, reasonFor(approval.kind), 'No target recorded for this item.');
            return;
          }
          repairs.push({
            index,
            path: {
              target: approval.target,
              relPath: approval.relPath,
              expectedDigest: approval.digest,
            },
          });
          return;
        case 'library-clone':
          pending.push(
            this.rebaseClone(approval, approval.digest).then((slot) => {
              slots[index] = slot;
            }),
          );
          return;
        case 'agent-source':
          pending.push(
            this.replaceAgentSource(approval, approval.digest).then((slot) => {
              slots[index] = slot;
            }),
          );
          return;
      }
    });

    pending.push(this.repairFiles(request.harnessRoot, approved, repairs, slots));
    await Promise.all(pending);

    const replaced: KeptItem[] = [];
    const keptItems: KeptEntry[] = [];
    for (const slot of slots) {
      if (slot.state === 'replaced') replaced.push(slot.item);
      else keptItems.push(slot.item);
    }
    return { replaced, kept: keptItems, unknown };
  }

  /** One digest-checked repair for every destination item, in one lock. */
  private async repairFiles(
    harnessRoot: string,
    approved: readonly LocalItemApproval[],
    repairs: ReadonlyArray<{ index: number; path: HarnessRepairBlockedPath }>,
    slots: Slot[],
  ): Promise<void> {
    if (repairs.length === 0) return;
    try {
      const report = await this.repairService.repair(
        harnessRoot,
        repairs.map((entry) => entry.path),
      );
      repairs.forEach(({ index }, position) => {
        const approval = approved[index];
        const result = report.paths[position];
        if (result?.outcome === 'repaired') {
          slots[index] = replaced(approval);
        } else if (result?.outcome === 'changed-since-approval') {
          slots[index] = kept(approval, 'changed-since-approval');
        } else {
          slots[index] = kept(
            approval,
            reasonFor(approval.kind),
            result?.reason ?? result?.outcome ?? 'The replace did not run.',
          );
        }
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('[install-local-items] repair failed', err);
      for (const { index } of repairs) {
        const approval = approved[index];
        slots[index] = kept(approval, reasonFor(approval.kind), err.message);
      }
    }
  }

  private async rebaseClone(
    approval: LocalItemApproval,
    digest: string,
  ): Promise<Slot> {
    if (approval.cloneKind === undefined || approval.slug === undefined) {
      return kept(approval, 'owned-edited', 'No Library copy recorded for this item.');
    }
    try {
      const outcome = await this.cloneRebase.rebase(
        approval.cloneKind,
        approval.slug,
        { scopeRoot: approval.harnessRoot, expectedDigest: digest },
      );
      switch (outcome.status) {
        case 'completed':
          return outcome.result.failed
            ? kept(
                approval,
                'owned-edited',
                outcome.result.reason ?? 'The Library copy could not be updated.',
              )
            : replaced(approval);
        case 'changed-since-approval':
          return kept(approval, 'changed-since-approval');
        case 'not-found':
          // The approved clone is gone: deleted since the approval.
          return kept(approval, 'changed-since-approval');
        case 'source-unavailable':
          return kept(approval, 'owned-edited', 'The plugin source for this copy is not available.');
        case 'unavailable':
          return kept(approval, 'owned-edited', 'The Library is not available in this app.');
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('[install-local-items] clone rebase failed', err);
      return kept(approval, 'owned-edited', err.message);
    }
  }

  /**
   * Replace `{harnessRoot}/.claude/agents/<slug>.md` with the plugin agent's
   * bytes, while it still hashes to the approval digest.
   *
   * The writer re-checks the digest under the destination lock, but it treats
   * a deleted file as "nothing to lose" and writes. A21 keeps a deleted item
   * instead, so a target that is gone is reported `changed-since-approval`
   * before the writer runs. A deletion racing past this check only lets the
   * plugin agent land where nothing was, which loses nothing.
   */
  private async replaceAgentSource(
    approval: LocalItemApproval,
    digest: string,
  ): Promise<Slot> {
    const slug = approval.slug;
    if (approval.cloneKind !== 'agent' || slug === undefined || !SLUG_PATTERN.test(slug)) {
      return kept(approval, 'shadowed', 'No agent recorded for this item.');
    }
    const pluginRoot = this.pluginRootFor(approval.sourceRef);
    if (pluginRoot === null) {
      return kept(approval, 'shadowed', 'The plugin providing this agent is not installed.');
    }
    const targetPath = join(approval.harnessRoot, '.claude', 'agents', `${slug}.md`);
    let content: string;
    try {
      if (!(await this.fileSystem.exists(targetPath))) {
        return kept(approval, 'changed-since-approval');
      }
      content = await this.fileSystem.readFile(join(pluginRoot, 'agents', `${slug}.md`));
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn('[install-local-items] plugin agent unreadable', {
        sourceRef: approval.sourceRef,
        slug,
        error: err.message,
      });
      return kept(approval, 'shadowed', 'The plugin agent could not be read.');
    }

    const written = await this.agentWriter.writeAgent(
      {
        sourceTemplateId: `${approval.sourceRef}#${slug}`,
        sourceTemplateVersion: '',
        content,
        variables: {},
        customizations: [],
        generatedAt: new Date(),
        filePath: targetPath,
      },
      { mode: 'replace-allowed', baseline: { state: 'present', hash: digest } },
    );
    if (written.isErr()) {
      return kept(
        approval,
        'shadowed',
        written.error?.message ?? 'The agent could not be written.',
      );
    }
    const status = written.value?.status;
    if (status === 'written' || status === 'unchanged') return replaced(approval);
    // `changed-since-preview` (baseline mismatch or deleted) and `kept` (now
    // unreadable) both mean the file is no longer what the user approved.
    return kept(approval, 'changed-since-approval');
  }

  /** The live plugin directory whose descriptor carries `sourceRef`. */
  private pluginRootFor(sourceRef: string): string | null {
    try {
      const matches = Object.entries(
        this.pluginLoader.getPluginSourceDescriptors(),
      ).filter(([, descriptor]) => descriptor.sourceRef === sourceRef);
      return matches.length === 1 ? matches[0][0] : null;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without descriptors the
      // plugin agent cannot be located, so the workspace agent is kept and the
      // item reports why; nothing is written.
      this.logger.warn('[install-local-items] plugin descriptors unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

/** The reason an item of `kind` is the user's when nothing replaced it. */
function reasonFor(kind: ExternalLocalItemKind): KeptItemReason {
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

function toKeptItem(approval: LocalItemApproval, reason: KeptItemReason): KeptItem {
  return {
    approvalId: approval.approvalId,
    family: approval.family,
    ...(approval.target !== undefined ? { target: approval.target } : {}),
    relPath: approval.relPath,
    reason,
  };
}

function replaced(approval: LocalItemApproval): Slot {
  return { state: 'replaced', item: toKeptItem(approval, reasonFor(approval.kind)) };
}

function kept(
  approval: LocalItemApproval,
  reason: KeptItemReason,
  error?: string,
): Slot {
  return {
    state: 'kept',
    item: {
      ...toKeptItem(approval, reason),
      ...(error !== undefined ? { error } : {}),
    },
  };
}
