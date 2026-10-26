/**
 * GenerationPreviewService — the `wizard:preview-generation` read model and
 * the server-held record that binds a later submit's keep/replace decisions to
 * it (TASK_2026_701 B5; plan A1, A2, A26, R1-5).
 *
 * Responsibilities:
 * - Work out where generation writes (`harness-root` by default, the opened
 *   folder only on request) and which rival CLI copies follow.
 * - Probe each Claude agent file: `new` (ENOENT), `exists` (read OK, baseline
 *   `hashContent`), `unreadable` (any other error). Each probe carries an
 *   opaque `revision`: an HMAC of path, state and baseline under a secret that
 *   lives only in this process.
 * - Decorate each agent with its model line, Library edit flag and whether
 *   the file still holds what the wizard last wrote. Each decoration is
 *   best-effort: a failure omits that field and never fails the preview.
 * - Keep one token record per caller key (`tab:<tabId>` or `untabbed`) in a
 *   bounded map; a newer preview for the same key supersedes the older one.
 * - {@link GenerationPreviewService.validateDecisions} turns a submit's
 *   decisions into per-agent write guards, or refuses with `preview-required`.
 *
 * Read-only: building a preview writes nothing and records no consent.
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import { inject, injectable, type DependencyContainer } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AGENT_GENERATION_TOKENS,
  resolveClaudeAgentModel,
  type WizardAgentOriginStore,
  type AgentFileGuard,
  type AgentOrigins,
  type ITemplateStorageService,
  type UserLayerMirrorService,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  hashContent,
  isAgentSelectedForSync,
  isReservedSlug,
  resolveHarnessWorkspaceRoot,
  type HarnessReconcilerService,
  type IHarnessSourceResolver,
} from '@ptah-extension/harness-sync';
import {
  SETTINGS_TOKENS,
  type AgentModelSettings,
} from '@ptah-extension/settings-core';
import { harnessAgentRelPath } from '@ptah-extension/shared';
import type {
  AgentModelLayers,
  AgentModelPreview,
  FileDecisionEntry,
  GenerationPreviewAgent,
  GenerationPreviewFile,
  GenerationRivalStatus,
  GenerationTargetChoice,
  GenerationTargetInfo,
  HarnessTargetId,
  LocalFileState,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { GenerationCheckpointService } from '../wizard-generation-checkpoint.service';

export const PREVIEW_NO_HARNESS_WARNING =
  'Agent sync to other CLIs is not available on this host, so only the Claude agent files are listed.';
export const PREVIEW_VERIFY_FAILED_WARNING =
  'Could not check which other CLIs are installed, so only the Claude agent files are listed.';
export const PREVIEW_OPENED_FOLDER_WARNING =
  'Other CLIs sync agents from a different folder, so only the Claude agent files are listed.';
const PREVIEW_NO_AGENT_SYNC_CONDITION = 'agent sync not available on this host';
const PREVIEW_POLICY_UNKNOWN_CONDITION =
  'plugin and skill settings become readable again; agent sync is paused while they cannot be read';
const PREVIEW_WRITE_DEPENDENT_CONDITION =
  'generation changes at least one selected agent file; other CLIs are only synced when a file is written';

/** The read side of the wizard origin store; the preview never records. */
export type AgentOriginReader = Pick<
  WizardAgentOriginStore,
  'read' | 'hashWrittenFile'
>;

/** Token records kept at once; the oldest is evicted first. */
const MAX_PREVIEW_RECORDS = 64;

/** Key of the record a caller without a tab binding (legacy wizard, CLI) uses. */
export const UNTABBED_PREVIEW_KEY = 'untabbed';

/**
 * The rival-CLI half of a preview, decided once per request. `available`
 * lists the targets a fresh verify found, each with the agent paths that
 * verify reported in sync. `condition` is non-null when every rival copy
 * depends on something the preview cannot guarantee.
 */
type RivalPreview =
  | {
      kind: 'unavailable';
      status: Exclude<GenerationRivalStatus, 'listed'>;
      warning: string;
    }
  | {
      kind: 'available';
      harnessRoot: string;
      targets: { target: HarnessTargetId; inSync: ReadonlySet<string> }[];
      disabledAgentIds: readonly string[];
      condition: string | null;
    };

/** What the preview found at one Claude agent path. */
interface ClaudeFileProbe {
  absPath: string;
  state: LocalFileState;
  /** `hashContent` of the bytes read; present exactly when `state` is `exists`. */
  hash?: string;
  revision: string;
}

/** The file rows of one agent plus the probe its decisions are checked against. */
interface AgentFiles {
  agentId: string;
  files: GenerationPreviewFile[];
  claude: ClaudeFileProbe;
}

/** The parts of a preview that a decision is bound to. */
interface PreviewCore {
  target: GenerationTargetInfo;
  targetRoot: string;
  rivals: RivalPreview;
  agents: AgentFiles[];
  signature: string;
}

/** Server-side record of one preview; the client only ever sees `token`. */
interface PreviewRecord {
  token: string;
  canonicalWorkspace: string;
  target: GenerationTargetChoice;
  /** Unique selected ids, sorted. */
  agentIds: readonly string[];
  signature: string;
  baselines: Readonly<
    Record<string, Pick<ClaudeFileProbe, 'state' | 'hash' | 'revision'>>
  >;
}

export interface PreviewRequest {
  /** Record key: {@link UNTABBED_PREVIEW_KEY} or `tab:<tabId>`. */
  key: string;
  /** Folder that is open in the host; paths are reported relative to it. */
  openedFolder: string;
  /** Workspace identity the record is bound to (the canonical tab path). */
  canonicalWorkspace: string;
  agentIds: readonly string[];
  target?: GenerationTargetChoice;
}

export interface DecisionRequest {
  key: string;
  /** Canonical workspace of the submit; must equal the record's. */
  workspace: string;
  agentIds: readonly string[];
  target?: GenerationTargetChoice;
  previewToken?: string;
  decisions?: Readonly<Record<string, FileDecisionEntry>>;
  /**
   * A tab-bound fresh submit needs a confirmed preview for its key even when
   * it replaces nothing (the mandatory preview of the chat-tab flow).
   */
  requirePreview: boolean;
}

export type DecisionValidation =
  | {
      ok: true;
      /** One guard per requested agent id. */
      guards: Readonly<Record<string, AgentFileGuard>>;
      target: GenerationTargetInfo;
      /** True when a valid token bound the decisions (else create-only). */
      tokenBound: boolean;
    }
  | { ok: false; reason: 'preview-required'; detail: string };

/**
 * The roots a wizard run can write to, and the one that applies. When the
 * opened folder is the harness root there is nothing to choose, so the choice
 * is always `harness-root`.
 */
export function resolveGenerationTarget(
  openedFolder: string,
  choice: GenerationTargetChoice | undefined,
): GenerationTargetInfo {
  const opened = path.resolve(openedFolder);
  const harnessRoot = resolveHarnessWorkspaceRoot(opened);
  const openedIsHarnessRoot = harnessRoot === opened;
  return {
    harnessRoot,
    openedFolder: opened,
    chosen:
      choice === 'opened-folder' && !openedIsHarnessRoot
        ? 'opened-folder'
        : 'harness-root',
    openedIsHarnessRoot,
  };
}

/** Record key for a caller: one per chat tab, one shared by untabbed callers. */
export function previewKeyFor(tabId: string | undefined): string {
  return tabId === undefined ? UNTABBED_PREVIEW_KEY : `tab:${tabId}`;
}

/**
 * The `code` of a Node system error. Structural, not `instanceof Error`: an
 * fs error can come from another realm (a test sandbox, a worker).
 */
function errnoCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

@injectable()
export class GenerationPreviewService {
  /** Per-process key for `revision` values; never leaves this process. */
  private readonly revisionSecret = randomBytes(32);
  private readonly records = new Map<string, PreviewRecord>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.DI_CONTAINER)
    private readonly container: DependencyContainer,
    @inject(GenerationCheckpointService)
    private readonly checkpoints: GenerationCheckpointService,
    @inject(AGENT_GENERATION_TOKENS.AGENT_ORIGIN_STORE)
    private readonly originStore: AgentOriginReader,
  ) {}

  /**
   * Build the preview for `agentIds` and record its token under `key`,
   * superseding the key's previous record.
   */
  async preview(
    request: PreviewRequest,
  ): Promise<WizardPreviewGenerationResponse> {
    const core = await this.buildCore(
      request.openedFolder,
      request.agentIds,
      request.target,
    );
    const agents = await this.decorate(core);
    const token = randomUUID();
    this.store(request.key, {
      token,
      canonicalWorkspace: request.canonicalWorkspace,
      target: core.target.chosen,
      agentIds: uniqueSorted(request.agentIds),
      signature: core.signature,
      baselines: Object.fromEntries(
        core.agents.map(({ agentId, claude }) => [
          agentId,
          {
            state: claude.state,
            ...(claude.hash !== undefined ? { hash: claude.hash } : {}),
            revision: claude.revision,
          },
        ]),
      ),
    });
    const rivalStatus: GenerationRivalStatus =
      core.rivals.kind === 'available' ? 'listed' : core.rivals.status;
    this.logger.debug('RPC: wizard:preview-generation', {
      agents: agents.length,
      target: core.target.chosen,
      rivalStatus,
      rivalTargets:
        core.rivals.kind === 'available'
          ? core.rivals.targets.map(({ target }) => target)
          : [],
      allRivalsConditional:
        core.rivals.kind === 'available' && core.rivals.condition !== null,
    });
    return {
      agents,
      ...(core.rivals.kind === 'unavailable'
        ? { warning: core.rivals.warning }
        : {}),
      previewToken: token,
      target: core.target,
      rivalStatus,
    };
  }

  /**
   * Turn a fresh submit's decisions into write guards.
   *
   * Without a valid token every agent is create-only (A2). With one, `keep`
   * (or no decision) keeps an existing or unreadable file without generating
   * it, and `replace` is allowed only for an `exists` row whose echoed
   * `revision` equals the recorded one. Refused with `preview-required`:
   * any replace without a valid token; a replace on `new`/`unreadable`; a
   * revision mismatch; a decision for an id that was not selected; selection
   * or target different from the token's; a preview whose definite files
   * changed since; and, when `requirePreview`, no preview for the key.
   */
  async validateDecisions(
    request: DecisionRequest,
  ): Promise<DecisionValidation> {
    const agentIds = uniqueSorted(request.agentIds);
    const decisions = request.decisions ?? {};
    const record = this.records.get(request.key);
    const boundRecord =
      record && record.canonicalWorkspace === request.workspace
        ? record
        : undefined;
    const tokenValid =
      request.previewToken !== undefined &&
      boundRecord?.token === request.previewToken;
    const requested = new Set(agentIds);
    const stray = Object.keys(decisions).filter((id) => !requested.has(id));
    if (stray.length > 0)
      return this.refuse('decision for an agent that is not selected', {
        stray,
      });
    const replaces = Object.entries(decisions)
      .filter(([, entry]) => entry.decision === 'replace')
      .map(([agentId]) => agentId);
    if (replaces.length > 0 && !tokenValid)
      return this.refuse('replace without a current preview token', {
        replaces,
        tokenPresented: request.previewToken !== undefined,
      });
    if (request.requirePreview && !boundRecord)
      return this.refuse('no confirmed preview for this tab');

    const target = resolveGenerationTarget(request.workspace, request.target);
    if (boundRecord && (tokenValid || request.requirePreview)) {
      if (
        tokenValid &&
        (boundRecord.target !== target.chosen ||
          boundRecord.agentIds.join('\0') !== agentIds.join('\0'))
      )
        return this.refuse('selection or target differs from the preview');
      const current = await this.buildCore(
        request.workspace,
        agentIds,
        request.target,
      );
      if (current.signature !== boundRecord.signature)
        return this.refuse('generation targets changed since the preview');
    }
    if (!tokenValid || !boundRecord) {
      return {
        ok: true,
        guards: Object.fromEntries(
          agentIds.map((id) => [id, { mode: 'create-only' } as const]),
        ),
        target,
        tokenBound: false,
      };
    }

    const guards: Record<string, AgentFileGuard> = {};
    for (const agentId of agentIds) {
      const baseline = boundRecord.baselines[agentId];
      if (!baseline)
        return this.refuse('no recorded baseline for a selected agent', {
          agentId,
        });
      const entry = decisions[agentId];
      if (entry?.decision === 'replace') {
        if (baseline.state !== 'exists' || baseline.hash === undefined)
          return this.refuse(`replace on a ${baseline.state} file`, {
            agentId,
          });
        if (entry.revision !== baseline.revision)
          return this.refuse('replace with a stale revision', { agentId });
        guards[agentId] = {
          mode: 'replace-allowed',
          baseline: { state: 'present', hash: baseline.hash },
        };
      } else {
        guards[agentId] =
          baseline.state === 'new' ? { mode: 'create-only' } : { mode: 'keep' };
      }
    }
    return { ok: true, guards, target, tokenBound: true };
  }

  /** Drop the record of `key` once a submit bound to it has launched. */
  release(key: string): void {
    this.records.delete(key);
  }

  private refuse(
    detail: string,
    context: Record<string, unknown> = {},
  ): DecisionValidation {
    this.logger.warn('RPC: wizard:submit-selection needs a fresh preview', {
      detail,
      ...context,
    });
    return { ok: false, reason: 'preview-required', detail };
  }

  private store(key: string, record: PreviewRecord): void {
    // Re-insert so a superseding preview also becomes the newest entry.
    this.records.delete(key);
    if (this.records.size >= MAX_PREVIEW_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.records.set(key, record);
  }

  // ---------------------------------------------------------------------------
  // Preview core: target, rivals, per-file rows and the signature
  // ---------------------------------------------------------------------------

  private async buildCore(
    openedFolder: string,
    agentIds: readonly string[],
    choice: GenerationTargetChoice | undefined,
  ): Promise<PreviewCore> {
    const target = resolveGenerationTarget(openedFolder, choice);
    const targetRoot =
      target.chosen === 'harness-root'
        ? target.harnessRoot
        : target.openedFolder;
    const rivals = await this.previewRivals(target);
    const agents = await Promise.all(
      [...new Set(agentIds)].map((agentId) =>
        this.previewAgentFiles(openedFolder, targetRoot, agentId, rivals),
      ),
    );
    // Order-independent: a submit lists the same ids in any order.
    const signature = JSON.stringify([
      target.chosen,
      ...agents
        .flatMap((agent) =>
          agent.files
            .filter((file) => file.certainty === 'definite')
            .map((file) =>
              JSON.stringify([file.target, file.relPath, file.willOverwrite]),
            ),
        )
        .sort(),
    ]);
    return { target, targetRoot, rivals, agents, signature };
  }

  /**
   * Rival status (R1-5), in order: no harness → `harness-unavailable`; the
   * opened-folder target away from the harness root → `opened-folder-elsewhere`
   * (no CLI reads it); a failed verify → `cli-detection-failed`; else `listed`.
   */
  private async previewRivals(
    target: GenerationTargetInfo,
  ): Promise<RivalPreview> {
    if (
      !this.isRegistered(HARNESS_SYNC_TOKENS.RECONCILER) ||
      !this.isRegistered(HARNESS_SYNC_TOKENS.SOURCE_RESOLVER)
    ) {
      return {
        kind: 'unavailable',
        status: 'harness-unavailable',
        warning: PREVIEW_NO_HARNESS_WARNING,
      };
    }
    if (target.chosen === 'opened-folder') {
      // Generation writes this folder's `.claude/agents`; the mirror syncs the
      // harness root's, so nothing generated here reaches another CLI.
      return {
        kind: 'unavailable',
        status: 'opened-folder-elsewhere',
        warning: PREVIEW_OPENED_FOLDER_WARNING,
      };
    }
    const { harnessRoot } = target;
    try {
      const reconciler = this.container.resolve<HarnessReconcilerService>(
        HARNESS_SYNC_TOKENS.RECONCILER,
      );
      const sourceResolver = this.container.resolve<IHarnessSourceResolver>(
        HARNESS_SYNC_TOKENS.SOURCE_RESOLVER,
      );
      // Fresh, not `getLastHealth()`: a CLI installed since the last pass must
      // be listed, and one uninstalled since must not be promised.
      const health = await reconciler.verify(
        harnessRoot,
        'wizard:preview-generation',
      );
      const source = await sourceResolver.resolve(harnessRoot);
      const syncAvailable =
        this.isRegistered(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE) &&
        this.isRegistered(HARNESS_SYNC_TOKENS.PROPAGATION);
      return {
        kind: 'available',
        harnessRoot,
        targets: health.targets
          .filter(
            (rival) => rival.detected && rival.facets.agents === 'supported',
          )
          .map((rival) => ({
            target: rival.target,
            inSync: new Set(rival.agentsInSync ?? []),
          })),
        disabledAgentIds: source.disabledAgentIds ?? [],
        // A frozen policy makes the reconciler write no agent at all this pass.
        condition: !syncAvailable
          ? PREVIEW_NO_AGENT_SYNC_CONDITION
          : source.policyUnknown === true
            ? PREVIEW_POLICY_UNKNOWN_CONDITION
            : null,
      };
    } catch (error: unknown) {
      this.logger.warn(
        'RPC: wizard:preview-generation could not verify harness targets',
        { error: errorMessage(error) },
      );
      return {
        kind: 'unavailable',
        status: 'cli-detection-failed',
        warning: PREVIEW_VERIFY_FAILED_WARNING,
      };
    }
  }

  private async previewAgentFiles(
    openedFolder: string,
    targetRoot: string,
    agentId: string,
    rivals: RivalPreview,
  ): Promise<AgentFiles> {
    const claudePath = path.join(
      this.checkpoints.outputDirectoryFor(targetRoot),
      `${agentId}.md`,
    );
    const rivalPaths =
      rivals.kind === 'available' &&
      // The builder rejects a reserved slug before it claims it.
      !isReservedSlug(agentId) &&
      isAgentSelectedForSync(
        { agentSyncEnabled: true, disabledAgentIds: rivals.disabledAgentIds },
        agentId,
      )
        ? rivals.targets.flatMap(({ target, inSync }) => {
            const relPath = harnessAgentRelPath(target, agentId);
            return relPath === null
              ? []
              : [
                  {
                    target,
                    absPath: path.join(rivals.harnessRoot, relPath),
                    condition:
                      rivals.condition ??
                      (inSync.has(relPath)
                        ? null
                        : PREVIEW_WRITE_DEPENDENT_CONDITION),
                  },
                ];
          })
        : [];
    const [claude, ...rivalFiles] = await Promise.all([
      this.probeClaudeFile(claudePath),
      ...rivalPaths.map(({ target, absPath, condition }) =>
        this.previewRivalFile(openedFolder, target, absPath, condition),
      ),
    ]);
    const claudeFile: GenerationPreviewFile = {
      relPath: relativeTo(openedFolder, claudePath),
      target: 'claude',
      certainty: 'definite',
      willOverwrite: claude.state !== 'new',
      localState: claude.state,
      revision: claude.revision,
    };
    return { agentId, files: [claudeFile, ...rivalFiles], claude };
  }

  /**
   * `ENOENT` → `new`; a successful read → `exists` with its baseline hash;
   * anything else (EACCES, EISDIR, ENOTDIR, …) → `unreadable`, which is always
   * kept. Same read rule as the guarded writer, so both agree on the bytes.
   */
  private async probeClaudeFile(absPath: string): Promise<ClaudeFileProbe> {
    let state: LocalFileState;
    let hash: string | undefined;
    try {
      hash = hashContent(await fsPromises.readFile(absPath, 'utf8'));
      state = 'exists';
    } catch (error: unknown) {
      state = errnoCode(error) === 'ENOENT' ? 'new' : 'unreadable';
      if (state === 'unreadable') {
        this.logger.warn(
          'RPC: wizard:preview-generation could not read an agent file; it will be kept',
          { path: absPath, code: errnoCode(error), error: errorMessage(error) },
        );
      }
    }
    return {
      absPath,
      state,
      ...(hash !== undefined ? { hash } : {}),
      revision: this.revisionOf(absPath, state, hash),
    };
  }

  private async previewRivalFile(
    openedFolder: string,
    target: HarnessTargetId,
    absPath: string,
    condition: string | null,
  ): Promise<GenerationPreviewFile> {
    let willOverwrite: boolean;
    try {
      await fsPromises.lstat(absPath);
      willOverwrite = true;
    } catch (error: unknown) {
      // A rival copy this host cannot stat is reported as not yet present;
      // the reconciler decides what it writes, the preview only the path.
      willOverwrite = false;
      if (errnoCode(error) !== 'ENOENT') {
        this.logger.debug('RPC: wizard:preview-generation could not stat', {
          path: absPath,
          code: errnoCode(error),
        });
      }
    }
    return {
      relPath: relativeTo(openedFolder, absPath),
      target,
      ...(condition === null
        ? { certainty: 'definite' as const }
        : { certainty: 'conditional' as const, condition }),
      willOverwrite,
    };
  }

  /** HMAC of path, state and baseline under this process's secret (A26). */
  private revisionOf(
    absPath: string,
    state: LocalFileState,
    hash: string | undefined,
  ): string {
    return createHmac('sha256', this.revisionSecret)
      .update(`${absPath}\0${state}\0${hash ?? ''}`)
      .digest('base64url');
  }

  // ---------------------------------------------------------------------------
  // Decorations: model line, Library edit flag, unchanged-since-wizard
  // ---------------------------------------------------------------------------

  private async decorate(core: PreviewCore): Promise<GenerationPreviewAgent[]> {
    const { harnessRoot } = core.target;
    const atHarnessRoot = core.target.chosen === 'harness-root';
    const layers = this.readModelLayers(harnessRoot);
    const templates = this.lookup<ITemplateStorageService>(
      AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE_SERVICE,
    );
    // Both records describe the harness root; an opened-folder target writes
    // a file neither the Library nor the origin record reads.
    const mirror = atHarnessRoot
      ? this.lookup<UserLayerMirrorService>(
          AGENT_GENERATION_TOKENS.USER_LAYER_MIRROR_SERVICE,
        )
      : null;
    const origins = atHarnessRoot
      ? await this.originStore.read(harnessRoot)
      : null;
    return Promise.all(
      core.agents.map(async ({ agentId, files, claude }) => {
        const [agentModel, libraryCopyEdited, unchangedSinceWizardWrite] =
          await Promise.all([
            this.previewModel(templates, layers, agentId),
            this.libraryCopyEdited(mirror, agentId, harnessRoot),
            this.unchangedSinceWizardWrite(origins, agentId, claude),
          ]);
        return {
          agentId,
          files,
          ...(agentModel !== undefined ? { agentModel } : {}),
          ...(libraryCopyEdited !== undefined ? { libraryCopyEdited } : {}),
          ...(unchangedSinceWizardWrite !== undefined
            ? { unchangedSinceWizardWrite }
            : {}),
        };
      }),
    );
  }

  /** Same rule the orchestrator applies when it writes the file. */
  private async previewModel(
    templates: ITemplateStorageService | null,
    layers: AgentModelLayers | null,
    agentId: string,
  ): Promise<AgentModelPreview | undefined> {
    if (!templates) return undefined;
    try {
      const template = await templates.loadTemplate(agentId);
      const loaded = template.isOk() ? template.value : undefined;
      if (!loaded) {
        this.logger.debug('RPC: wizard:preview-generation has no template', {
          agentId,
          error: template.error?.message,
        });
        return undefined;
      }
      return resolveClaudeAgentModel(layers, loaded.id, loaded.model);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the model line is a preview
      // decoration; the warn records the failure and the row omits it.
      this.logger.warn(
        'RPC: wizard:preview-generation could not resolve an agent model',
        { agentId, error: errorMessage(error) },
      );
      return undefined;
    }
  }

  /**
   * The `agentGeneration.models` layers for the harness root, or null when the
   * host has none or they cannot be read (every agent then shows its template
   * model, exactly as generation falls back).
   */
  private readModelLayers(harnessRoot: string): AgentModelLayers | null {
    const settings = this.lookup<AgentModelSettings>(
      SETTINGS_TOKENS.AGENT_MODEL_SETTINGS,
    );
    if (!settings) return null;
    try {
      return settings.layersForPath(harnessRoot);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - overrides are optional; the
      // warn records the read failure and generation falls back the same way.
      this.logger.warn(
        'RPC: wizard:preview-generation could not read agentGeneration.models; showing template models',
        { error: errorMessage(error) },
      );
      return null;
    }
  }

  private async libraryCopyEdited(
    mirror: UserLayerMirrorService | null,
    agentId: string,
    harnessRoot: string,
  ): Promise<boolean | undefined> {
    if (!mirror) return undefined;
    try {
      const state = await mirror.readCloneEditState(
        'agent',
        agentId,
        harnessRoot,
      );
      return state ? state.edited : undefined;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the Library flag is a preview
      // decoration; the warn records the failure and the row omits it.
      this.logger.warn(
        'RPC: wizard:preview-generation could not read the Library copy state',
        { agentId, error: errorMessage(error) },
      );
      return undefined;
    }
  }

  /**
   * D10: the file still hashes to what the wizard recorded when it last wrote
   * it. Absent when nothing was recorded or the file is not `exists`.
   */
  private async unchangedSinceWizardWrite(
    origins: AgentOrigins | null,
    agentId: string,
    claude: ClaudeFileProbe,
  ): Promise<boolean | undefined> {
    const entry = origins?.[agentId];
    if (!entry || claude.state !== 'exists') return undefined;
    try {
      return (
        (await this.originStore.hashWrittenFile(claude.absPath)) === entry.hash
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without a hash the row only
      // loses its "unchanged since the wizard wrote it" label (D10).
      this.logger.warn(
        'RPC: wizard:preview-generation could not hash an agent file',
        { agentId, error: errorMessage(error) },
      );
      return undefined;
    }
  }

  private isRegistered(token: symbol): boolean {
    return this.container.isRegistered(token, true);
  }

  /** A registered optional collaborator, or null when this host has none. */
  private lookup<T>(token: symbol): T | null {
    if (!this.isRegistered(token)) return null;
    try {
      return this.container.resolve<T>(token);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - every lookup here feeds an
      // optional preview decoration; the warn records the failed resolution.
      this.logger.warn(
        'RPC: wizard:preview-generation could not resolve a collaborator',
        { token: token.toString(), error: errorMessage(error) },
      );
      return null;
    }
  }
}

/** POSIX path relative to the opened folder; above it reads `../…`. */
function relativeTo(openedFolder: string, absPath: string): string {
  return path.relative(openedFolder, absPath).split(path.sep).join('/');
}
