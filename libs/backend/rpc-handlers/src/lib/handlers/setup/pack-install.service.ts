/**
 * PackInstallService — community agent pack plan and guarded install
 * (TASK_2026_701 B8; plan A14/D9, A22, A25, A26; decisions D13).
 *
 * - `wizard:plan-pack-install` ({@link PackInstallService.plan}) fetches the
 *   requested pack files into memory, compares each with the destination and
 *   records a plan under a random, server-held token. It writes nothing.
 * - `wizard:install-pack-agents` ({@link PackInstallService.install}) writes
 *   the files under per-file guards built from the token's record:
 *   create-only by default; `replace` only for a `differs` row whose echoed
 *   `revision` still matches; an `unreadable` row is always kept (a bulk
 *   Replace skips it). Without a valid token every file is create-only and
 *   any Replace is refused.
 * - A harness-root install with at least one non-failed file grants
 *   agent-sync consent (D9), forgets the wizard origin of each file the pack
 *   wrote (B4) and runs one Library pass (A25). An opened-folder install runs
 *   none of these and reports `libraryPass: 'not-applicable'`.
 *
 * Writes are serialized per target directory inside
 * {@link AgentPackDownloadService.installFiles}; this service only decides
 * the guards and the bytes.
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as path from 'path';
import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { RpcUserError, TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AgentPackDownloadService,
  PLATFORM_TOKENS,
  type AgentPackInfo,
  type AgentPackInstallItem,
  type AgentPackInstallOutcome,
  type IWorkspaceProvider,
  type PackFileGuard,
} from '@ptah-extension/platform-core';
import {
  AGENT_GENERATION_TOKENS,
  type WizardAgentOriginStore,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  type AgentSyncGate,
  type HarnessPropagationService,
  type UserLayerRefreshStatus,
} from '@ptah-extension/harness-sync';
import type {
  GenerationTargetChoice,
  GenerationTargetInfo,
  PackFileOutcome,
  PackFilePlan,
  PackFileState,
  WizardInstallPackAgentsParams,
  WizardInstallPackAgentsResult,
  WizardPlanPackInstallParams,
  WizardPlanPackInstallResult,
} from '@ptah-extension/shared';
import {
  findOpenWorkspaceRoot,
  sameWorkspaceRoot,
} from '../../utils/workspace-authorization';
import { resolveGenerationTarget } from '../wizard-generation/generation-preview.service';
import { libraryPassFor } from '../wizard-generation/generation-library-outcome';

/** Plan records kept at once; the oldest is evicted first. */
export const MAX_PACK_PLANS = 64;

/** Largest `incomingText` / `localText` returned for the diff disclosure. */
export const PACK_PLAN_TEXT_CAP_BYTES = 256 * 1024;

/**
 * How long a plan's fetched bytes are reused. Older plans keep their guards
 * but re-fetch the bytes, so a long-open prompt never installs stale content.
 */
export const PACK_PLAN_CONTENT_TTL_MS = 10 * 60 * 1000;

/** Reason recorded with every Library pass this service runs. */
export const PACK_INSTALL_PASS_REASON = 'wizard:install-pack-agents';

/** Message for a Replace that has no current plan behind it. */
export const PACK_REPLACE_NEEDS_PLAN =
  'Replacing a file needs a current install plan. Review the pack files again, then retry.';

/** The pack download operations this service drives. */
export type PackDownloader = Pick<
  AgentPackDownloadService,
  'listCuratedPacks' | 'planDownload' | 'installFiles'
>;

/** The one origin-store operation a pack install needs. */
export type AgentOriginForgetter = Pick<WizardAgentOriginStore, 'forget'>;

/** One planned destination file as the token remembers it. */
interface PlannedFile {
  state: PackFileState;
  content: string;
  /** Destination hash the user saw; present for `identical` and `differs`. */
  baselineHash?: string;
  revision: string;
}

interface PackPlanRecord {
  source: string;
  openedFolder: string;
  target: GenerationTargetChoice;
  targetDir: string;
  plannedAt: number;
  files: Map<string, PlannedFile>;
}

/** The bytes one file will be installed with, or why there are none. */
type FileContent =
  | { ok: true; text: string; fromPlan: boolean }
  | { ok: false; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `{root}/.claude/agents` for the root the target choice selects. */
function agentsDirFor(target: GenerationTargetInfo): string {
  const root =
    target.chosen === 'opened-folder' ? target.openedFolder : target.harnessRoot;
  return path.join(root, '.claude', 'agents');
}

/** The text for the diff disclosure, or `undefined` when it is too large. */
function cappedText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  return Buffer.byteLength(text, 'utf8') <= PACK_PLAN_TEXT_CAP_BYTES
    ? text
    : undefined;
}

/** Agent slug of a pack file: its base name without `.md`. */
function slugOf(file: string): string {
  return path.basename(file, '.md');
}

@injectable()
export class PackInstallService {
  /** Per-process key for `revision` values; never leaves this process. */
  private readonly revisionSecret = randomBytes(32);
  private readonly plans = new Map<string, PackPlanRecord>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(AgentPackDownloadService)
    private readonly downloads: PackDownloader,
    @inject(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE)
    private readonly originStore: AgentOriginForgetter,
  ) {}

  /** The curated packs the wizard may list and install from. */
  listPacks(): Promise<AgentPackInfo[]> {
    return this.downloads.listCuratedPacks();
  }

  /**
   * Plan installing `agentFiles` (one file or the whole pack) and record the
   * plan under a new token. Writes nothing and records no consent.
   */
  async plan(
    params: WizardPlanPackInstallParams,
  ): Promise<WizardPlanPackInstallResult> {
    await this.assertCuratedSource(params.source);
    const openedFolder = this.resolveOpenedFolder(undefined);
    const target = resolveGenerationTarget(openedFolder, params.target);
    const targetDir = agentsDirFor(target);

    const result = await this.downloads.planDownload(
      params.source,
      params.agentFiles,
      targetDir,
    );
    if (!result.ok) {
      throw new Error(`Could not plan the pack install: ${result.error}`);
    }
    const failed = result.files.filter((file) => !file.fetched);
    if (failed.length > 0) {
      throw new Error(
        `Could not download ${failed.map((file) => file.file).join(', ')}. Try again.`,
      );
    }

    const files = new Map<string, PlannedFile>();
    const rows: PackFilePlan[] = [];
    for (const file of result.files) {
      if (!file.fetched) continue;
      const revision = this.revisionFor(
        targetDir,
        file.file,
        file.state,
        file.baselineHash,
      );
      files.set(file.file, {
        state: file.state,
        content: file.content,
        ...(file.baselineHash !== undefined
          ? { baselineHash: file.baselineHash }
          : {}),
        revision,
      });
      const incomingText =
        file.state === 'identical' ? undefined : cappedText(file.content);
      const localText =
        file.state === 'differs' ? cappedText(file.localText) : undefined;
      rows.push({
        file: file.file,
        state: file.state,
        revision,
        ...(incomingText !== undefined ? { incomingText } : {}),
        ...(localText !== undefined ? { localText } : {}),
      });
    }

    const planToken = randomUUID();
    this.store(planToken, {
      source: params.source,
      openedFolder: target.openedFolder,
      target: target.chosen,
      targetDir,
      plannedAt: Date.now(),
      files,
    });
    this.logger.debug('RPC: wizard:plan-pack-install', {
      files: rows.length,
      target: target.chosen,
      states: rows.map((row) => row.state),
    });
    return { planToken, target, files: rows };
  }

  /**
   * Install `agentFiles` under guards built from the plan token, then run the
   * Library pass when the harness root received at least one non-failed
   * file. `success` is false only when every requested file failed.
   */
  async install(
    params: WizardInstallPackAgentsParams,
  ): Promise<WizardInstallPackAgentsResult> {
    await this.assertCuratedSource(params.source);
    const openedFolder = this.resolveOpenedFolder(params.workspacePath);
    const target = resolveGenerationTarget(openedFolder, params.target);
    const targetDir = agentsDirFor(target);
    const agentFiles = [...new Set(params.agentFiles)];
    const record = this.matchingRecord(params, target, targetDir);
    const guards = this.guardsFor(agentFiles, params.decisions, record);

    const contents = await this.contentsFor(
      params.source,
      agentFiles,
      targetDir,
      record,
    );
    const items: AgentPackInstallItem[] = [];
    for (const file of agentFiles) {
      const content = contents.get(file);
      const guard = guards.get(file);
      if (content?.ok && guard !== undefined) {
        items.push({ file, content: content.text, guard });
      }
    }
    const installedByFile = new Map<string, AgentPackInstallOutcome>(
      (await this.downloads.installFiles(targetDir, items)).map((outcome) => [
        outcome.file,
        outcome,
      ]),
    );

    const outcomes: PackFileOutcome[] = [];
    const errors: string[] = [];
    for (const file of agentFiles) {
      const content = contents.get(file);
      const installed = installedByFile.get(file);
      if (installed !== undefined) {
        outcomes.push({ file, outcome: installed.outcome });
        if (installed.error !== undefined)
          errors.push(`${file}: ${installed.error}`);
      } else {
        outcomes.push({ file, outcome: 'failed' });
        errors.push(
          `${file}: ${content && !content.ok ? content.error : 'not installed'}`,
        );
      }
    }
    if (errors.length > 0) {
      this.logger.warn('Some community pack files failed to install', {
        source: params.source,
        errors,
      });
    }
    this.consumePlan(params.planToken, record, outcomes);

    const nonFailed = outcomes.filter((o) => o.outcome !== 'failed').length;
    const atHarnessRoot = target.chosen === 'harness-root';
    let userLayer: UserLayerRefreshStatus | null = null;
    if (atHarnessRoot && nonFailed > 0) {
      await this.forgetPackWritten(target.harnessRoot, outcomes);
      userLayer = await this.runLibraryPass(target.harnessRoot);
    }
    const libraryPass = libraryPassFor({
      atHarnessRoot,
      writtenCount: nonFailed,
      userLayer,
    });
    const failedCount = outcomes.length - nonFailed;
    this.logger.info('Community pack install finished', {
      target: target.chosen,
      outcomes: outcomes.map((o) => o.outcome),
      libraryPass,
    });
    return {
      success: nonFailed > 0,
      agentsDownloaded: nonFailed,
      // "From cache" now means the plan's in-memory bytes were installed with
      // no second download; there is no on-disk pack cache any more (A22).
      fromCache: agentFiles.every((file) => {
        const content = contents.get(file);
        return content?.ok === true && content.fromPlan;
      }),
      ...(failedCount > 0
        ? { error: `${failedCount} file(s) failed to install` }
        : {}),
      files: outcomes,
      libraryPass,
    };
  }

  // ---------------------------------------------------------------------------
  // Guards and bytes
  // ---------------------------------------------------------------------------

  /**
   * Per-file guards. Refuses (throws) a decision for a file that was not
   * requested, any Replace without a matching plan row, and a Replace on a
   * `differs` row whose revision no longer matches (A26). A Replace on an
   * `unreadable` row is kept (D13); on `new`/`identical` it is create-only.
   */
  private guardsFor(
    agentFiles: readonly string[],
    decisions: WizardInstallPackAgentsParams['decisions'],
    record: PackPlanRecord | undefined,
  ): Map<string, PackFileGuard> {
    const requested = new Set(agentFiles);
    for (const file of Object.keys(decisions ?? {})) {
      if (!requested.has(file)) {
        throw new RpcUserError(
          `A decision was sent for "${file}", which is not being installed.`,
          'INVALID_PARAMS',
        );
      }
    }

    const guards = new Map<string, PackFileGuard>();
    for (const file of agentFiles) {
      const decision = decisions?.[file];
      const planned = record?.files.get(file);
      if (decision?.decision === 'replace') {
        if (planned === undefined) {
          throw new RpcUserError(PACK_REPLACE_NEEDS_PLAN, 'INVALID_PARAMS');
        }
        guards.set(file, this.replaceGuard(planned, decision.revision));
      } else {
        guards.set(file, this.defaultGuard(planned));
      }
    }
    return guards;
  }

  private replaceGuard(
    planned: PlannedFile,
    revision: string | undefined,
  ): PackFileGuard {
    switch (planned.state) {
      case 'unreadable':
        return { mode: 'keep' };
      case 'new':
      case 'identical':
        return { mode: 'create-only' };
      case 'differs':
        if (
          revision === undefined ||
          revision !== planned.revision ||
          planned.baselineHash === undefined
        ) {
          throw new RpcUserError(PACK_REPLACE_NEEDS_PLAN, 'INVALID_PARAMS');
        }
        return { mode: 'replace', baselineHash: planned.baselineHash };
    }
  }

  /** Keep, or no decision: an existing or unreadable file is kept. */
  private defaultGuard(planned: PlannedFile | undefined): PackFileGuard {
    return planned?.state === 'differs' || planned?.state === 'unreadable'
      ? { mode: 'keep' }
      : { mode: 'create-only' };
  }

  /**
   * The bytes to install per file: the plan's bytes while they are fresh,
   * otherwise a fresh download (the guards stay as planned).
   */
  private async contentsFor(
    source: string,
    agentFiles: readonly string[],
    targetDir: string,
    record: PackPlanRecord | undefined,
  ): Promise<Map<string, FileContent>> {
    const contents = new Map<string, FileContent>();
    const fresh =
      record !== undefined &&
      Date.now() - record.plannedAt <= PACK_PLAN_CONTENT_TTL_MS;
    const toFetch: string[] = [];
    for (const file of agentFiles) {
      const planned = fresh ? record?.files.get(file) : undefined;
      if (planned !== undefined) {
        contents.set(file, { ok: true, text: planned.content, fromPlan: true });
      } else {
        toFetch.push(file);
      }
    }
    if (toFetch.length === 0) return contents;

    const fetched = await this.downloads.planDownload(
      source,
      toFetch,
      targetDir,
    );
    for (const file of toFetch) {
      if (!fetched.ok) {
        contents.set(file, { ok: false, error: fetched.error });
        continue;
      }
      const row = fetched.files.find((candidate) => candidate.file === file);
      if (row === undefined) {
        contents.set(file, { ok: false, error: 'not downloaded' });
      } else if (row.fetched) {
        contents.set(file, { ok: true, text: row.content, fromPlan: false });
      } else {
        contents.set(file, { ok: false, error: row.error });
      }
    }
    return contents;
  }

  // ---------------------------------------------------------------------------
  // Plan records
  // ---------------------------------------------------------------------------

  /**
   * The token's record when it was planned for this source, opened folder
   * and target; otherwise `undefined` (the install is then create-only).
   */
  private matchingRecord(
    params: WizardInstallPackAgentsParams,
    target: GenerationTargetInfo,
    targetDir: string,
  ): PackPlanRecord | undefined {
    if (params.planToken === undefined) return undefined;
    const record = this.plans.get(params.planToken);
    if (
      record === undefined ||
      record.source !== params.source ||
      record.target !== target.chosen ||
      !sameWorkspaceRoot(record.openedFolder, target.openedFolder) ||
      !sameWorkspaceRoot(record.targetDir, targetDir)
    ) {
      this.logger.debug('Pack plan token does not match this install', {
        known: record !== undefined,
      });
      return undefined;
    }
    return record;
  }

  /**
   * Drop the plan rows that reached a terminal non-failed outcome, so a token
   * cannot replay a decision; failed rows stay for a retry.
   */
  private consumePlan(
    token: string | undefined,
    record: PackPlanRecord | undefined,
    outcomes: readonly PackFileOutcome[],
  ): void {
    if (token === undefined || record === undefined) return;
    for (const { file, outcome } of outcomes) {
      if (outcome !== 'failed') record.files.delete(file);
    }
    if (record.files.size === 0) this.plans.delete(token);
  }

  private store(token: string, record: PackPlanRecord): void {
    this.plans.set(token, record);
    while (this.plans.size > MAX_PACK_PLANS) {
      const oldest = this.plans.keys().next().value;
      if (oldest === undefined) break;
      this.plans.delete(oldest);
    }
  }

  /** Opaque per-row revision: an HMAC of where, what state and which baseline. */
  private revisionFor(
    targetDir: string,
    file: string,
    state: PackFileState,
    baselineHash: string | undefined,
  ): string {
    return createHmac('sha256', this.revisionSecret)
      .update(
        [path.resolve(targetDir), file, state, baselineHash ?? ''].join('\0'),
      )
      .digest('hex')
      .slice(0, 32);
  }

  // ---------------------------------------------------------------------------
  // Boundary checks
  // ---------------------------------------------------------------------------

  private async assertCuratedSource(source: string): Promise<void> {
    const curated = await this.downloads.listCuratedPacks();
    if (!curated.some((pack) => pack.source === source)) {
      throw new Error(
        `Untrusted agent pack source: "${source}". Only curated sources are allowed.`,
      );
    }
  }

  /** The open folder the caller named (it must be open), or the active root. */
  private resolveOpenedFolder(workspacePath: string | undefined): string {
    if (workspacePath !== undefined) {
      const open = findOpenWorkspaceRoot(workspacePath, this.workspaceProvider);
      if (open === undefined) {
        throw new RpcUserError(
          'Access denied: workspace path is not an open folder.',
          'UNAUTHORIZED_WORKSPACE',
        );
      }
      return open;
    }
    const root = this.workspaceProvider.getWorkspaceRoot();
    if (!root) {
      throw new RpcUserError('No workspace folder open.', 'WORKSPACE_NOT_OPEN');
    }
    return root;
  }

  // ---------------------------------------------------------------------------
  // After a harness-root install
  // ---------------------------------------------------------------------------

  /**
   * A pack-written file is no longer the wizard's, so its origin record is
   * dropped. A failed forget only leaves a stale label; it is logged.
   */
  private async forgetPackWritten(
    harnessRoot: string,
    outcomes: readonly PackFileOutcome[],
  ): Promise<void> {
    const slugs = outcomes
      .filter((o) => o.outcome === 'written')
      .map((o) => slugOf(o.file));
    const results = await Promise.allSettled(
      slugs.map((slug) => this.originStore.forget(harnessRoot, slug)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected' || result.value === false) {
        this.logger.warn('Could not drop the wizard origin of a pack agent', {
          slug: slugs[index],
          error:
            result.status === 'rejected'
              ? errorMessage(result.reason)
              : 'record not updated',
        });
      }
    });
  }

  /**
   * Grant agent-sync consent (D9), then refresh the user layer and reconcile.
   * Returns the user-layer status, `null` when the host has no propagation
   * (and so no Library), or `failed` when the pass threw.
   */
  private async runLibraryPass(
    harnessRoot: string,
  ): Promise<UserLayerRefreshStatus | null> {
    try {
      if (this.container.isRegistered(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE)) {
        const gate = this.container.resolve<AgentSyncGate>(
          HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE,
        );
        if (!gate.enable(harnessRoot)) {
          this.logger.warn(
            'Could not record agent-sync consent; pack agents may not reach other CLIs',
            { harnessRoot },
          );
        }
      }
      if (!this.container.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION)) {
        return null;
      }
      const propagation = this.container.resolve<HarnessPropagationService>(
        HARNESS_SYNC_TOKENS.PROPAGATION,
      );
      const { userLayer } = await propagation.propagateWithReport(
        harnessRoot,
        PACK_INSTALL_PASS_REASON,
      );
      return userLayer;
    } catch (error: unknown) {
      // degradation-audit: reported - the caller returns this as
      // libraryPass 'failed'; the installed files are unaffected.
      this.logger.warn('Library pass after pack install failed', {
        error: errorMessage(error),
      });
      return 'failed';
    }
  }
}
