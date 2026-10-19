/**
 * Skill Synthesis RPC Handlers.
 *
 * Bridges the frontend Skill Synthesis UI to the retained backend stores and
 * services (clones, history, specs, scorecards, and agent models). The full
 * method set is the `static METHODS` tuple below, compile-asserted to equal the
 * `skillSynthesis:*` slice of `RpcMethodName`.
 *
 * Class is named `SkillsSynthesisRpcHandlers` (plural) to avoid colliding
 * with the existing `SkillsShRpcHandlers` (shell skills).
 */
import * as fs from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  inject,
  injectable,
  type DependencyContainer,
  type InjectionToken,
} from 'tsyringe';
import { Logger, RpcHandler, TOKENS } from '@ptah-extension/vscode-core';
import type { SentryService } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  FILE_BASED_SETTINGS_DEFAULTS,
  type IWorkspaceProvider,
  type ContentDownloadService,
} from '@ptah-extension/platform-core';
import {
  SKILL_SYNTHESIS_TOKENS,
  SKILL_REPROPAGATION_TOKEN,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
  MIN_INVOCATIONS_TO_ENHANCE,
  ENHANCE_COOLDOWN_MS,
  ProposalNotFoundError,
  resolveSkillsRoot,
  MANUAL_PREVIEW_JUDGE_SETTINGS,
  type SkillEnhancerService,
  type SkillRegistryStore,
  type SkillRegistryRow,
  type SkillRegistryKind,
  type SpecHarvesterService,
  type SkillScorecardService,
  type SkillRepropagationPort,
} from '@ptah-extension/skill-synthesis';
import type {
  UserLayerMirrorService,
  QuarantinedAgentItem,
  QuarantineRestoreResult,
} from '@ptah-extension/agent-generation';
import {
  HARNESS_SYNC_TOKENS,
  resolveHarnessWorkspaceRoot,
  type AgentConsentReader,
} from '@ptah-extension/harness-sync';
import {
  SETTINGS_TOKENS,
  type AgentModelSettings,
} from '@ptah-extension/settings-core';
import { CliModelListService } from '../services/cli-model-list.service';
import type {
  RpcMethodName,
  SkillSynthesisListClonesParams,
  SkillSynthesisListClonesResult,
  SkillSynthesisGetCloneParams,
  SkillSynthesisGetCloneResult,
  SkillSynthesisPreviewEnhancementParams,
  SkillSynthesisPreviewEnhancementResult,
  SkillSynthesisApplyProposalParams,
  SkillSynthesisApplyProposalResult,
  SkillSynthesisGetHistoryBodyParams,
  SkillSynthesisGetHistoryBodyResult,
  SkillSynthesisRevertEnhancementParams,
  SkillSynthesisRevertEnhancementResult,
  SkillSynthesisRebaseCloneParams,
  SkillSynthesisRebaseCloneResult,
  SkillSynthesisKeepCloneParams,
  SkillSynthesisKeepCloneResult,
  SkillSynthesisSaveCloneBodyParams,
  SkillSynthesisSaveCloneBodyResult,
  SkillSynthesisInvocationStatsParams,
  SkillSynthesisInvocationStatsResult,
  SkillSynthesisGetScorecardsParams,
  SkillSynthesisGetScorecardsResult,
  SkillSynthesisGetScorecardDetailParams,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisListQuarantinedAgentsParams,
  SkillSynthesisListQuarantinedAgentsResult,
  SkillSynthesisRestoreQuarantinedAgentParams,
  SkillSynthesisRestoreQuarantinedAgentResult,
  QuarantinedAgentEntry,
  QuarantineAgentSyncState,
  SkillSynthesisListSpecsParams,
  SkillSynthesisListSpecsResult,
  SkillSynthesisHarvestSpecsParams,
  SkillSynthesisHarvestSpecsResult,
  SkillSynthesisClearStaleSpecsParams,
  SkillSynthesisClearStaleSpecsResult,
  CloneSummary,
  SkillCloneKind,
  AgentScorecard,
  AgentModelClass,
  AgentModelEntry,
  AgentModelLayerClassification,
  AgentModelProvider,
  AgentModelSettingsValue,
  SkillSynthesisGetAgentModelsParams,
  SkillSynthesisGetAgentModelsResult,
  SkillSynthesisSetAgentModelParams,
  SkillSynthesisSetAgentModelResult,
} from '@ptah-extension/shared';
import {
  AGENT_MODEL_PROVIDERS,
  classifyAgentModelValue,
} from '@ptah-extension/shared';
import { RpcUserError } from '@ptah-extension/vscode-core';
import {
  SkillGetCloneParamsSchema,
  SkillPreviewEnhancementParamsSchema,
  SkillApplyProposalParamsSchema,
  SkillGetHistoryBodyParamsSchema,
  SkillRevertEnhancementParamsSchema,
  SkillRebaseCloneParamsSchema,
  SkillKeepCloneParamsSchema,
  SkillSaveCloneBodyParamsSchema,
  SkillInvocationStatsParamsSchema,
  SkillListQuarantinedAgentsParamsSchema,
  SkillRestoreQuarantinedAgentParamsSchema,
  SkillGetAgentModelsParamsSchema,
  SkillSetAgentModelParamsSchema,
  ClearStaleSpecsParamsSchema,
  getScorecardsParamsSchema,
  getScorecardDetailParamsSchema,
} from './skills-synthesis-rpc.schema';

/**
 * Providers whose agent format cannot carry a per-agent model. Empty: every
 * transformer emits `model` (B-5e). Kept as data so a provider that loses
 * support is refused up front and the editor disables its row.
 */
const UNSUPPORTED_AGENT_MODEL_PROVIDERS: readonly AgentModelProvider[] = [];

/**
 * Upper bound on reading the classification lists (CLI detection plus the
 * Codex/Copilot live queries). Past it the save proceeds with no list, so
 * values classify `unverifiable` rather than the editor hanging.
 */
const AGENT_MODEL_LIST_TIMEOUT_MS = 15_000;

@injectable()
export class SkillsSynthesisRpcHandlers {
  static readonly METHODS = [
    'skillSynthesis:listClones',
    'skillSynthesis:getClone',
    'skillSynthesis:previewEnhancement',
    'skillSynthesis:applyProposal',
    'skillSynthesis:getHistoryBody',
    'skillSynthesis:revertEnhancement',
    'skillSynthesis:rebaseClone',
    'skillSynthesis:keepClone',
    'skillSynthesis:saveCloneBody',
    'skillSynthesis:listQuarantinedAgents',
    'skillSynthesis:restoreQuarantinedAgent',
    'skillSynthesis:getAgentModels',
    'skillSynthesis:setAgentModel',
    'skillSynthesis:invocationStats',
    'skillSynthesis:getScorecards',
    'skillSynthesis:getScorecardDetail',
    'skillSynthesis:listSpecs',
    'skillSynthesis:harvestSpecs',
    'skillSynthesis:clearStaleSpecs',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(TOKENS.SENTRY_SERVICE)
    private readonly sentryService: SentryService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_ENHANCER_SERVICE, { isOptional: true })
    private readonly enhancer: SkillEnhancerService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE, { isOptional: true })
    private readonly registry: SkillRegistryStore | null,
    @inject(USER_LAYER_MIRROR_SERVICE_TOKEN, { isOptional: true })
    private readonly mirror: UserLayerMirrorService | null,
    @inject(PLATFORM_TOKENS.CONTENT_DOWNLOAD, { isOptional: true })
    private readonly contentDownload: ContentDownloadService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE, { isOptional: true })
    private readonly specHarvester: SpecHarvesterService | null,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SCORECARD_SERVICE, {
      isOptional: true,
    })
    private readonly scorecard: SkillScorecardService | null,
    // Optional because the quarantine surface only reads
    // agent-sync consent, it never grants it (Restore must not turn agent sync
    // on). Typed as the read-only `AgentConsentReader`, so `enable` is not
    // reachable from this class. Absent means `agentSync: 'unknown'`.
    @inject(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, { isOptional: true })
    private readonly agentSyncGate: AgentConsentReader | null,
    // The agent model RPCs resolve `SETTINGS_TOKENS.AGENT_MODEL_SETTINGS` and
    // `CliModelListService` from here at call time. Not injected directly:
    // `CliModelListService` is a class token, which tsyringe constructs even
    // under `isOptional`, so a direct injection would break every existing
    // construction site that does not register its CLI dependencies. Call-time
    // lookup also makes "this host has no agent model settings" a refusal of
    // those two methods instead of a failure to build the whole class.
    @inject(PLATFORM_TOKENS.DI_CONTAINER, { isOptional: true })
    private readonly runtimeContainer: DependencyContainer | null,
    @inject(SKILL_REPROPAGATION_TOKEN, { isOptional: true })
    private readonly repropagation: SkillRepropagationPort | null,
  ) {}

  register(): void {
    this.registerListClones();
    this.registerGetClone();
    this.registerPreviewEnhancement();
    this.registerApplyProposal();
    this.registerGetHistoryBody();
    this.registerRevertEnhancement();
    this.registerRebaseClone();
    this.registerKeepClone();
    this.registerSaveCloneBody();
    this.registerListQuarantinedAgents();
    this.registerRestoreQuarantinedAgent();
    this.registerGetAgentModels();
    this.registerSetAgentModel();
    this.registerInvocationStats();
    this.registerGetScorecards();
    this.registerGetScorecardDetail();
    this.registerListSpecs();
    this.registerHarvestSpecs();
    this.registerClearStaleSpecs();

    this.logger.debug('Skill Synthesis RPC handlers registered', {
      methods: [...SkillsSynthesisRpcHandlers.METHODS],
    });
  }

  private registerListClones(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListClonesParams,
      SkillSynthesisListClonesResult
    >('skillSynthesis:listClones', async () => {
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const rows = registry.listAll();
        const orphanFlags = await this.readOrphanFlags(mirror);
        const clones = await Promise.all(
          rows.map((row) =>
            this.toCloneSummary(
              row,
              mirror,
              orphanFlags.get(`${row.kind}/${row.slug}`) === true,
            ),
          ),
        );
        return { clones };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerListClones');
        throw this.toUserError('skillSynthesis:listClones');
      }
    });
  }

  private registerGetClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetCloneParams,
      SkillSynthesisGetCloneResult
    >('skillSynthesis:getClone', async (params) => {
      const parsed = this.parseParams(
        SkillGetCloneParamsSchema,
        params,
        'skillSynthesis:getClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          return { clone: null, body: null, history: [] };
        }
        const body = this.readCloneBody(mirror, kind, parsed.slug);
        const historyEntries = await mirror.listHistory(
          kind,
          parsed.slug,
          this.agentScope(),
        );
        const history = historyEntries.map((h) => ({
          ts: h.ts,
          hasBody: h.hasSkillMd,
        }));
        const clone = await this.toCloneSummary(
          row,
          mirror,
          await this.readOrphanFlag(mirror, kind, parsed.slug),
        );
        return { clone, body, history };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetClone');
        throw this.toUserError('skillSynthesis:getClone');
      }
    });
  }


  /**
   * Generate a review draft without writing a clone. A user edit is saved
   * separately through `saveCloneBody` with the draft's source hash.
   */
  private registerPreviewEnhancement(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisPreviewEnhancementParams,
      SkillSynthesisPreviewEnhancementResult
    >('skillSynthesis:previewEnhancement', async (params) => {
      const parsed = this.parseParams(
        SkillPreviewEnhancementParamsSchema,
        params,
        'skillSynthesis:previewEnhancement',
      );
      this.assertSkillsNotPaused('skillSynthesis:previewEnhancement');
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const registry = this.requireDesktop(this.registry);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        // manual: a user-initiated preview bypasses the auto-enhance cooldown
        // and invocation floor.
        const result = await enhancer.generateProposal(
          parsed.slug,
          MANUAL_PREVIEW_JUDGE_SETTINGS,
          {
            manual: true,
            kind,
            // Skips the background-work governor (C14, Batch 16b).
            userInitiated: true,
          },
        );
        return {
          proposed: result.proposed,
          skipReason: result.skipReason ?? null,
          currentBody: result.currentBody,
          proposedBody: result.proposedBody,
          judgeScore: result.judgeScore,
          judgeReason: result.judgeReason,
          proposalId: result.proposalId,
          draft: result.draft ?? null,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerPreviewEnhancement',
        );
        throw this.toUserError('skillSynthesis:previewEnhancement');
      }
    });
  }

  /**
   * Write half of enhancement: commit the exact body previously returned by
   * `skillSynthesis:previewEnhancement`. An unknown or expired `proposalId`
   * is a clean INVALID_PARAMS — never a silent regeneration.
   */
  private registerApplyProposal(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisApplyProposalParams,
      SkillSynthesisApplyProposalResult
    >('skillSynthesis:applyProposal', async (params) => {
      const parsed = this.parseParams(
        SkillApplyProposalParamsSchema,
        params,
        'skillSynthesis:applyProposal',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const kind = parsed.kind as SkillRegistryKind;
        const result = await enhancer.applyProposal(
          kind,
          parsed.slug,
          parsed.proposalId,
          // The harness refresh after the write skips the governor (FU-17b).
          { userInitiated: true },
        );
        return { applied: result.applied, historyTs: result.historyTs };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        if (error instanceof ProposalNotFoundError) {
          this.logger.warn(
            '[skill-synthesis] applyProposal — proposal unavailable',
            { kind: parsed.kind, slug: parsed.slug, code: error.code },
          );
          throw new RpcUserError(
            'This enhancement preview is no longer available. Preview again, then apply.',
            'INVALID_PARAMS',
          );
        }
        this.report(error, 'SkillsSynthesisRpcHandlers.registerApplyProposal');
        throw this.toUserError('skillSynthesis:applyProposal');
      }
    });
  }

  /**
   * Body of one `.history/<ts>/` snapshot, so a past enhancement can be
   * diffed before reverting.
   *
   * `ts` is never interpolated into a path directly: it must match an entry
   * actually enumerated by `mirror.listHistory`, and the resolved file is
   * re-checked to live under the clone's user-layer root.
   */
  private registerGetHistoryBody(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetHistoryBodyParams,
      SkillSynthesisGetHistoryBodyResult
    >('skillSynthesis:getHistoryBody', async (params) => {
      const parsed = this.parseParams(
        SkillGetHistoryBodyParamsSchema,
        params,
        'skillSynthesis:getHistoryBody',
      );
      try {
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const entries = await mirror.listHistory(
          kind,
          parsed.slug,
          this.agentScope(),
        );
        const entry = entries.find((e) => e.ts === parsed.ts);
        if (!entry || !entry.hasSkillMd) {
          return { body: null, ts: parsed.ts };
        }
        const fileName = kind === 'skill' ? 'SKILL.md' : `${parsed.slug}.md`;
        const filePath = join(entry.path, fileName);
        const roots = mirror.getUserLayerRoots(this.agentScope());
        const root =
          kind === 'skill'
            ? roots.skills
            : kind === 'agent'
              ? roots.agents
              : roots.commands;
        if (!this.isUnder(root, filePath)) {
          return { body: null, ts: parsed.ts };
        }
        if (!fs.existsSync(filePath)) {
          return { body: null, ts: parsed.ts };
        }
        return { body: fs.readFileSync(filePath, 'utf8'), ts: parsed.ts };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetHistoryBody');
        throw this.toUserError('skillSynthesis:getHistoryBody');
      }
    });
  }

  private registerRevertEnhancement(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRevertEnhancementParams,
      SkillSynthesisRevertEnhancementResult
    >('skillSynthesis:revertEnhancement', async (params) => {
      const parsed = this.parseParams(
        SkillRevertEnhancementParamsSchema,
        params,
        'skillSynthesis:revertEnhancement',
      );
      try {
        const enhancer = this.requireDesktop(this.enhancer);
        const result = await enhancer.revert(
          parsed.slug,
          parsed.historyTs,
          parsed.kind as SkillRegistryKind,
          // The harness refresh after the restore skips the governor (FU-17b).
          { userInitiated: true },
        );
        return {
          reverted: result.reverted,
          slug: result.slug,
          revertedFrom: result.revertedFrom,
          newHistoryTs: result.newHistoryTs,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerRevertEnhancement',
        );
        throw this.toUserError('skillSynthesis:revertEnhancement');
      }
    });
  }

  private registerRebaseClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRebaseCloneParams,
      SkillSynthesisRebaseCloneResult
    >('skillSynthesis:rebaseClone', async (params) => {
      const parsed = this.parseParams(
        SkillRebaseCloneParamsSchema,
        params,
        'skillSynthesis:rebaseClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        const sourceDir = this.resolveUpstreamSourceDir(kind, parsed.slug, row);
        if (!sourceDir) {
          throw new RpcUserError(
            `Cannot resolve upstream source for "${parsed.slug}"; rebase unavailable.`,
            'PERSISTENCE_UNAVAILABLE',
          );
        }
        const result = await mirror.rebaseClone({
          kind,
          slug: parsed.slug,
          sourceDir,
          workspaceRoot: this.agentScope(),
        });
        if (!result.failed) {
          registry.setDiverged(kind, parsed.slug, false);
          registry.setPending(kind, parsed.slug, null);
        }
        return {
          kind: result.kind as SkillCloneKind,
          slug: result.slug,
          sourceHash: result.sourceHash,
          snapshotPath: result.snapshotPath,
          failed: result.failed ?? false,
          reason: result.reason ?? null,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerRebaseClone');
        throw this.toUserError('skillSynthesis:rebaseClone');
      }
    });
  }

  private registerKeepClone(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisKeepCloneParams,
      SkillSynthesisKeepCloneResult
    >('skillSynthesis:keepClone', async (params) => {
      const parsed = this.parseParams(
        SkillKeepCloneParamsSchema,
        params,
        'skillSynthesis:keepClone',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const result = await mirror.keepClone({
          kind,
          slug: parsed.slug,
          workspaceRoot: this.agentScope(),
        });
        registry.setDiverged(kind, parsed.slug, false);
        registry.setPending(kind, parsed.slug, null);
        return {
          kind: result.kind as SkillCloneKind,
          slug: result.slug,
          sourceHash: result.sourceHash,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerKeepClone');
        throw this.toUserError('skillSynthesis:keepClone');
      }
    });
  }

  /**
   * Replace a clone body with content the user typed in the drawer.
   *
   * The Zod schema is the FIRST gate and runs before any path is built;
   * `assertUnderUserLayer`, inside the mirror, is the second. A registry row
   * that has no file on disk comes back as `written: false` and is reported as
   * a user error rather than creating the file — the save never mints a clone.
   *
   * No registry write. The mirror leaves `diverged` and `pendingSourceHash`
   * alone, so the columns `listClones` reads from are still correct.
   *
   * Only a write that did NOT happen becomes an error. `metadataIncomplete`
   * and `reconcileProtected: false` are both committed writes with a caveat,
   * and they travel on the successful result for the surface to state — a
   * committed edit reported as a failure is the one outcome worse than an
   * unqualified success.
   */
  private registerSaveCloneBody(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisSaveCloneBodyParams,
      SkillSynthesisSaveCloneBodyResult
    >('skillSynthesis:saveCloneBody', async (params) => {
      const parsed = this.parseParams(
        SkillSaveCloneBodyParamsSchema,
        params,
        'skillSynthesis:saveCloneBody',
      );
      try {
        const registry = this.requireDesktop(this.registry);
        const mirror = this.requireDesktop(this.mirror);
        const kind = parsed.kind as SkillRegistryKind;
        const row = registry.getBySlug(kind, parsed.slug);
        if (!row) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        const result = await mirror.saveCloneBody({
          kind,
          slug: parsed.slug,
          body: parsed.body,
          workspaceRoot: this.agentScope(),
          ...(parsed.expectedSourceHash === undefined
            ? {}
            : { expectedSourceHash: parsed.expectedSourceHash }),
        });
        if (result.reason === 'stale-source') {
          throw new RpcUserError(
            'This clone changed since the draft was created. Preview it again before saving.',
            'INVALID_PARAMS',
          );
        }
        if (!result.written || result.historyTs === null) {
          throw new RpcUserError(
            `No cloned ${parsed.kind} found for slug "${parsed.slug}".`,
            'INVALID_PARAMS',
          );
        }
        let enhancementMetadataIncomplete = false;
        if (parsed.origin === 'enhancement') {
          if (result.currentContentHash === null) {
            enhancementMetadataIncomplete = true;
            this.logger.warn('[skill-synthesis] enhancement registry update skipped: clone hash unavailable', {
              kind,
              slug: parsed.slug,
            });
          } else {
            try {
              registry.markEnhanced(kind, parsed.slug, Date.now(), result.currentContentHash);
            } catch (error: unknown) {
              enhancementMetadataIncomplete = true;
              this.logger.warn('[skill-synthesis] enhancement registry update failed', {
                kind,
                slug: parsed.slug,
                error,
              });
            }
          }
          if (this.repropagation) {
            try {
              await this.repropagation.repropagate(
                kind,
                parsed.slug,
                this.agentScope() ?? homedir(),
                { userInitiated: true },
              );
            } catch (error: unknown) {
              enhancementMetadataIncomplete = true;
              this.logger.warn('[skill-synthesis] enhancement re-propagation failed', {
                kind,
                slug: parsed.slug,
                error,
              });
            }
          }
        }
        // `metadataIncomplete` is NOT an error branch. The body is committed;
        // mapping it to an RpcUserError would tell the user their save failed
        // while their edit sits on disk. It travels on the result so the
        // surface can qualify the success it reports.
        if (result.metadataIncomplete) {
          this.logger.warn(
            '[skill-synthesis] clone body saved with incomplete metadata',
            { kind: result.kind, slug: result.slug },
          );
        }
        this.logger.info('[skill-synthesis] clone body saved', {
          kind: result.kind,
          slug: result.slug,
          historyTs: result.historyTs,
          metadataIncomplete: result.metadataIncomplete || enhancementMetadataIncomplete,
          reconcileProtected: result.reconcileProtected,
        });
        return {
          kind: result.kind as SkillCloneKind,
          slug: result.slug,
          historyTs: result.historyTs,
          metadataIncomplete: result.metadataIncomplete || enhancementMetadataIncomplete,
          reconcileProtected: result.reconcileProtected,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerSaveCloneBody');
        throw this.toUserError('skillSynthesis:saveCloneBody');
      }
    });
  }

  /**
   * The agents the one-time seed quarantine moved out of this workspace's
   * scoped clone root, with their derived state. Read-only.
   *
   * No mirror service is an explicit error rather than an empty list: an empty
   * list would tell the user nothing was quarantined when this host simply
   * cannot tell. No open folder IS a real answer (nothing can be quarantined
   * for no workspace) and comes back empty with `workspaceRoot: null`.
   */
  private registerListQuarantinedAgents(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListQuarantinedAgentsParams,
      SkillSynthesisListQuarantinedAgentsResult
    >('skillSynthesis:listQuarantinedAgents', async (params) => {
      this.parseParams(
        SkillListQuarantinedAgentsParamsSchema,
        params,
        'skillSynthesis:listQuarantinedAgents',
      );
      try {
        const mirror = this.requireDesktop(this.mirror);
        const workspaceRoot = this.quarantineWorkspaceRoot();
        if (workspaceRoot === null) {
          return {
            workspaceRoot: null,
            agentSync: 'unknown',
            quarantined: [],
            notOwned: [],
          };
        }
        const listing = await mirror.listQuarantinedAgents(workspaceRoot);
        return {
          workspaceRoot,
          agentSync: this.readAgentSync(workspaceRoot),
          ...(listing.recordUnreadable
            ? { recordUnreadable: true as const }
            : {}),
          quarantined: listing.quarantined.map(toQuarantinedAgentEntry),
          notOwned: [...listing.notOwned],
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerListQuarantinedAgents',
        );
        throw this.toUserError('skillSynthesis:listQuarantinedAgents');
      }
    });
  }

  /**
   * Restore one quarantined agent's workspace source file from its snapshot.
   *
   * The schema's `SlugSchema` is the first gate on the slug (no `..`, no
   * separators); the mirror re-checks it before any path join. Every refusal
   * (`conflict`, `not-quarantined`, `no-snapshot`, `copy-failed`) is a result
   * the surface renders, not an error. A THROWN failure is never mapped to a
   * success outcome. `agentSync` is read after the restore and never changed:
   * with consent off the source is back but no clone is re-created, which the
   * list then reports as `source-restored`.
   */
  private registerRestoreQuarantinedAgent(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisRestoreQuarantinedAgentParams,
      SkillSynthesisRestoreQuarantinedAgentResult
    >('skillSynthesis:restoreQuarantinedAgent', async (params) => {
      const parsed = this.parseParams(
        SkillRestoreQuarantinedAgentParamsSchema,
        params,
        'skillSynthesis:restoreQuarantinedAgent',
      );
      try {
        const mirror = this.requireDesktop(this.mirror);
        const workspaceRoot = this.quarantineWorkspaceRoot();
        if (workspaceRoot === null) {
          throw new RpcUserError(
            'Open a workspace folder to restore a quarantined agent.',
            'INVALID_PARAMS',
          );
        }
        const result: QuarantineRestoreResult =
          await mirror.restoreQuarantinedAgent(workspaceRoot, parsed.slug);
        return {
          outcome: result.outcome,
          path: result.path,
          ...(result.reason !== undefined ? { reason: result.reason } : {}),
          agentSync: this.readAgentSync(workspaceRoot),
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerRestoreQuarantinedAgent',
        );
        throw this.toUserError('skillSynthesis:restoreQuarantinedAgent');
      }
    });
  }

  /**
   * Both `agentGeneration.models` layers for the active workspace, with every
   * stored value classified against the server's lists
   * (`CliModelListService.listForClassification`, provider-reported entries
   * only make a value `listed`). The editor labels rows from this result and
   * never classifies from `agent:listCliModels`.
   *
   * No folder open is a real answer (`workspaceRoot: null`, nothing to edit).
   * A `workspaceRoot` that is not the active workspace is refused.
   */
  private registerGetAgentModels(): void {
    const method = 'skillSynthesis:getAgentModels';
    this.rpcHandler.registerMethod<
      SkillSynthesisGetAgentModelsParams,
      SkillSynthesisGetAgentModelsResult
    >(method, async (params) => {
      const parsed = this.parseParams(
        SkillGetAgentModelsParamsSchema,
        params,
        method,
      );
      const settings = this.requireAgentModelSettings();
      const workspaceRoot =
        parsed?.workspaceRoot !== undefined
          ? this.requireActiveWorkspace(parsed.workspaceRoot)
          : this.quarantineWorkspaceRoot();
      const unsupportedProviders = [...UNSUPPORTED_AGENT_MODEL_PROVIDERS];
      if (workspaceRoot === null) {
        return {
          workspaceRoot: null,
          machine: null,
          workspace: null,
          lists: null,
          classification: { machine: {}, workspace: {} },
          unsupportedProviders,
        };
      }
      try {
        const layers = settings.layersForPath(workspaceRoot);
        const machine = toStoredAgentModelLayer(layers.machine);
        const workspace = toStoredAgentModelLayer(layers.workspace);
        const lists = await this.loadAgentModelLists();
        return {
          workspaceRoot,
          machine,
          workspace,
          lists,
          classification: {
            machine: classifyAgentModelLayer(machine, lists),
            workspace: classifyAgentModelLayer(workspace, lists),
          },
          unsupportedProviders,
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetAgentModels');
        throw this.toUserError(method);
      }
    });
  }

  /**
   * Set or clear one `[slug][provider]` model in one layer.
   *
   * Every refusal happens before the write, so a refused call changes neither
   * layer. `workspaceRoot` is required even for the machine scope (whose
   * physical key does not depend on it) and must be the active workspace, both
   * on entry and again after the list read, so a folder switch between load
   * and save is refused. The server's classification wins over the editor's.
   * Reconcile is never started here; the editor runs it after a save.
   */
  private registerSetAgentModel(): void {
    const method = 'skillSynthesis:setAgentModel';
    this.rpcHandler.registerMethod<
      SkillSynthesisSetAgentModelParams,
      SkillSynthesisSetAgentModelResult
    >(method, async (params) => {
      const parsed = this.parseParams(
        SkillSetAgentModelParamsSchema,
        params,
        method,
      );
      const settings = this.requireAgentModelSettings();
      const workspaceRoot = this.requireActiveWorkspace(parsed.workspaceRoot);
      const { provider } = parsed;
      if (UNSUPPORTED_AGENT_MODEL_PROVIDERS.includes(provider)) {
        throw new RpcUserError(
          `Per-agent models are not supported for ${provider}.`,
          'INVALID_PARAMS',
        );
      }

      const value =
        parsed.value === null || parsed.value.trim() === ''
          ? null
          : parsed.value;
      let classification: AgentModelClass = 'empty';
      if (value !== null) {
        const lists = await this.loadAgentModelLists();
        classification = classifyAgentModelValue(
          provider,
          value,
          lists?.[provider] ?? null,
        );
        if (classification === 'malformed') {
          throw new RpcUserError(
            `That model id cannot be written for ${provider}.${agentModelSyntaxHint(provider)}`,
            'INVALID_PARAMS',
          );
        }
        if (classification === 'unlisted' && parsed.confirmUnlisted !== true) {
          throw new RpcUserError(
            `That model is not in ${provider}'s model list; it needs confirmation before it is saved.`,
            'MODEL_NOT_AVAILABLE',
          );
        }
        // The list read can take seconds; a folder switch during it must not
        // land this value in another workspace's settings.
        this.requireActiveWorkspace(parsed.workspaceRoot);
      }

      try {
        await settings.update(
          workspaceRoot,
          parsed.slug,
          provider,
          value,
          parsed.scope,
        );
        const layers = settings.layersForPath(workspaceRoot);
        return {
          classification,
          machine: toStoredAgentModelLayer(layers.machine),
          workspace: toStoredAgentModelLayer(layers.workspace),
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerSetAgentModel');
        throw this.toUserError(method);
      }
    });
  }

  private registerInvocationStats(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisInvocationStatsParams,
      SkillSynthesisInvocationStatsResult
    >('skillSynthesis:invocationStats', async (params) => {
      const parsed = this.parseParams(
        SkillInvocationStatsParamsSchema,
        params,
        'skillSynthesis:invocationStats',
      );
      try {
        const graded = this.scorecard?.getInvocationStats(parsed.kind, parsed.slug, this.agentScope() ?? null);
        return {
          slug: parsed.slug,
          stats: {
            total: graded?.invocationCount ?? 0,
            succeeded: graded?.succeeded ?? 0,
            failed: graded?.failed ?? 0,
            distinctContexts: graded?.distinctContexts ?? 0,
            graded: graded?.total ?? 0,
            passed: graded?.succeeded ?? 0,
            successRate: graded?.successRate ?? null,
          },
        };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerInvocationStats',
        );
        throw this.toUserError('skillSynthesis:invocationStats');
      }
    });
  }

  private registerGetScorecards(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetScorecardsParams,
      SkillSynthesisGetScorecardsResult
    >('skillSynthesis:getScorecards', async (params) => {
      const parsed = this.parseParams(
        getScorecardsParamsSchema,
        params,
        'skillSynthesis:getScorecards',
      );
      try {
        if (!this.scorecard) {
          // Scorecard service unavailable (non-skill-synthesis runtime): return
          // a typed empty map rather than throwing.
          return { scorecards: {} };
        }
        // Two passes on purpose: the aggregate and the win rate answer
        // different questions from different joins, and `getWinRates`' `null`
        // is a value the aggregate query has no room for (B4.3's own header).
        // Merging them here is what makes the number reachable by a UI at all
        // — B4.3 left it as a backend-only signal.
        const workspaceRoot = this.agentScope() ?? null;
        const scorecards = this.scorecard.getScorecards(parsed.slugs, workspaceRoot);
        const winRates = this.scorecard.getWinRates(parsed.slugs, workspaceRoot);
        const merged: Record<string, AgentScorecard> = {};
        for (const [slug, card] of Object.entries(scorecards)) {
          const measured = winRates[slug];
          // Explicit `=== undefined`, not `?.winRate ?? null` and never `||`:
          // an absent ROW ("this slug has no invocation events") and a present
          // row carrying `null` ("invoked, nothing settled") are both
          // unmeasured, but a present row carrying `0` is a measured LOSS and
          // must survive as `0`.
          merged[slug] = {
            ...card,
            winRate: measured === undefined ? null : measured.winRate,
          };
        }
        return { scorecards: merged };
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(error, 'SkillsSynthesisRpcHandlers.registerGetScorecards');
        throw this.toUserError('skillSynthesis:getScorecards');
      }
    });
  }

  private registerGetScorecardDetail(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisGetScorecardDetailParams,
      SkillSynthesisGetScorecardDetailResult
    >('skillSynthesis:getScorecardDetail', async (params) => {
      const parsed = this.parseParams(
        getScorecardDetailParamsSchema,
        params,
        'skillSynthesis:getScorecardDetail',
      );
      try {
        if (!this.scorecard) {
          return { slug: parsed.slug, rows: [], findingsExcerpt: null };
        }
        return await this.scorecard.getScorecardDetail(
          parsed.slug,
          this.agentScope() ?? null,
          parsed.limit,
        );
      } catch (error: unknown) {
        if (error instanceof RpcUserError) throw error;
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerGetScorecardDetail',
        );
        throw this.toUserError('skillSynthesis:getScorecardDetail');
      }
    });
  }

  private registerListSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisListSpecsParams,
      SkillSynthesisListSpecsResult
    >('skillSynthesis:listSpecs', async () => {
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        const specs = await harvester.listSpecs();
        return { specs };
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerListSpecs');
        throw error;
      }
    });
  }

  private registerHarvestSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisHarvestSpecsParams,
      SkillSynthesisHarvestSpecsResult
    >('skillSynthesis:harvestSpecs', async () => {
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        return await harvester.harvest();
      } catch (error) {
        this.report(error, 'SkillsSynthesisRpcHandlers.registerHarvestSpecs');
        throw error;
      }
    });
  }

  private registerClearStaleSpecs(): void {
    this.rpcHandler.registerMethod<
      SkillSynthesisClearStaleSpecsParams,
      SkillSynthesisClearStaleSpecsResult
    >('skillSynthesis:clearStaleSpecs', async (params) => {
      const parsed = this.parseParams(
        ClearStaleSpecsParamsSchema,
        params,
        'skillSynthesis:clearStaleSpecs',
      );
      try {
        const harvester = this.requireDesktop(this.specHarvester);
        const result = await harvester.clearStaleSpecs(undefined, {
          retentionDays: parsed.retentionDays,
          mode: parsed.mode,
        });
        return {
          cleared: result.cleared,
          mode: result.mode,
          taskIds: [...result.taskIds],
        };
      } catch (error) {
        this.report(
          error,
          'SkillsSynthesisRpcHandlers.registerClearStaleSpecs',
        );
        throw error;
      }
    });
  }

  private parseParams<T>(
    schema: { parse: (input: unknown) => T },
    params: unknown,
    method: string,
  ): T {
    try {
      return schema.parse(params);
    } catch (err: unknown) {
      this.logger.warn(`[skill-synthesis] ${method} — invalid params`, {
        err: String(err),
      });
      throw new RpcUserError(
        `Invalid parameters for ${method}`,
        'INVALID_PARAMS',
      );
    }
  }

  private requireDesktop<T>(value: T | null): T {
    if (value === null || value === undefined) {
      throw new RpcUserError(
        'This feature is available in the Ptah desktop app only.',
        'PERSISTENCE_UNAVAILABLE',
      );
    }
    return value;
  }

  private toUserError(method: string): RpcUserError {
    return new RpcUserError(
      `${method} failed; please try again.`,
      'PERSISTENCE_UNAVAILABLE',
    );
  }

  private async toCloneSummary(
    row: SkillRegistryRow,
    mirror: UserLayerMirrorService,
    orphaned: boolean,
  ): Promise<CloneSummary> {
    let stats: ReturnType<SkillScorecardService['getInvocationStats']> | undefined;
    try {
      stats = this.scorecard?.getInvocationStats(row.kind, row.slug, this.agentScope() ?? null);
    } catch (error: unknown) {
      this.logger.warn('[skill-synthesis] clone invocation stats unavailable', {
        kind: row.kind,
        slug: row.slug,
        error,
      });
    }
    const successRate = stats?.successRate ?? null;
    let historyCount = 0;
    try {
      const history = await mirror.listHistory(
        row.kind,
        row.slug,
        this.agentScope(),
      );
      historyCount = history.length;
    } catch {
      historyCount = 0;
    }
    return {
      slug: row.slug,
      kind: row.kind as SkillCloneKind,
      cloneStatus: row.cloneStatus,
      diverged: row.diverged,
      invocationCount: stats?.invocationCount ?? 0,
      successRate,
      lastEnhancedAt: row.lastEnhancedAt,
      historyCount,
      pendingSourceHash: row.pendingSourceHash,
      enhanceMinInvocations: MIN_INVOCATIONS_TO_ENHANCE,
      enhanceCooldownUntil:
        row.lastEnhancedAt !== null
          ? row.lastEnhancedAt + ENHANCE_COOLDOWN_MS
          : null,
      orphaned,
    };
  }

  /**
   * `kind/slug` → orphaned, read once from the user-layer sidecars.
   *
   * The registry has no `orphaned` column (that would be a migration for a flag
   * the sidecar already owns), so the list path joins the two. A failure here
   * degrades to "nothing is orphaned" rather than failing the whole listing —
   * an un-flagged clone renders exactly as it did before this field existed.
   */
  /**
   * The workspace whose AGENT clones this surface addresses, or `undefined`.
   *
   * Agent clones are keyed by workspace (TASK_2026_365) because the setup
   * wizard tailors an agent per project and names it after the role, so two
   * projects write two different `backend-developer.md`. Skills and commands are
   * per-machine and ignore this. A host with no folder open passes `undefined`
   * and reads the unscoped base, which holds the pre-key clones.
   */
  private agentScope(): string | undefined {
    try {
      const root = this.workspaceProvider.getWorkspaceRoot();
      return root && root.length > 0 ? root : undefined;
    } catch {
      // degradation-audit: optional-capability - the workspace root is
      // optional for this surface; undefined reads the unscoped agent clone
      // base, which is what a host with no folder open gets anyway.
      return undefined;
    }
  }

  /**
   * The root the quarantine is keyed by: the harness-resolved workspace root,
   * the same one the mirror pass and the agent-sync gate use
   * (`resolveAgentMirrorSource`). Absolute by construction (`path.resolve`),
   * which the mirror facade requires. `null` when no folder is open.
   */
  private quarantineWorkspaceRoot(): string | null {
    const raw = this.agentScope();
    return raw === undefined ? null : resolveHarnessWorkspaceRoot(raw);
  }

  /**
   * Agent-sync consent for `harnessRoot`, read through `resolve` only.
   * `'unknown'` when the gate is not registered on this host or the read
   * throws, never guessed as enabled or disabled.
   */
  private readAgentSync(harnessRoot: string): QuarantineAgentSyncState {
    if (!this.agentSyncGate) return 'unknown';
    try {
      return this.agentSyncGate.resolve(harnessRoot).enabled
        ? 'enabled'
        : 'disabled';
    } catch (error: unknown) {
      // degradation-audit: optional-capability - consent is reported, not
      // acted on, by this surface; an unreadable gate is stated as 'unknown'
      // rather than failing the listing or the completed restore.
      this.logger.warn('[skill-synthesis] could not read agent-sync consent', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unknown';
    }
  }

  /**
   * The harness-resolved form of `requested`, which must equal the active
   * workspace root exactly. Exact, not case-folded: the settings key is a hash
   * of the path, so a path that differs only in case would address another
   * workspace's key. The editor sends back the root `getAgentModels` returned.
   */
  private requireActiveWorkspace(requested: string): string {
    const active = this.quarantineWorkspaceRoot();
    if (active === null) {
      throw new RpcUserError(
        'Open a workspace folder to change agent models.',
        'WORKSPACE_NOT_OPEN',
      );
    }
    if (resolveHarnessWorkspaceRoot(requested) !== active) {
      throw new RpcUserError(
        'The workspace changed; reload the agent models and try again.',
        'UNAUTHORIZED_WORKSPACE',
      );
    }
    return active;
  }

  /** The host's one `AgentModelSettings`, or a refusal when it has none. */
  private requireAgentModelSettings(): AgentModelSettings {
    const settings = this.lookupRuntime<AgentModelSettings>(
      SETTINGS_TOKENS.AGENT_MODEL_SETTINGS,
    );
    if (settings === null) {
      throw new RpcUserError(
        'Per-agent model settings are not available in this host.',
        'PERSISTENCE_UNAVAILABLE',
      );
    }
    return settings;
  }

  /**
   * The classification lists, or `null` when they cannot be read in time.
   * `null` makes every value `unverifiable` (never `listed`), the B-5c safe
   * default; it never blocks a save.
   */
  private async loadAgentModelLists(): Promise<Record<
    AgentModelProvider,
    AgentModelEntry[]
  > | null> {
    const service =
      this.lookupRuntime<CliModelListService>(CliModelListService);
    if (service === null) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const lists = await Promise.race([
        service.listForClassification(),
        new Promise<null>((resolveTimeout) => {
          timer = setTimeout(
            () => resolveTimeout(null),
            AGENT_MODEL_LIST_TIMEOUT_MS,
          );
        }),
      ]);
      if (lists === null) {
        this.logger.warn(
          '[skill-synthesis] agent model lists timed out; values are unverifiable',
          { timeoutMs: AGENT_MODEL_LIST_TIMEOUT_MS },
        );
      }
      return lists;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - without lists a value is
      // classified `unverifiable`, which the editor labels; failing the read
      // or the save instead would hide every stored model from the user.
      this.logger.warn('[skill-synthesis] could not read agent model lists', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** `token` from the host container, or `null` when absent or unbuildable. */
  private lookupRuntime<T>(token: InjectionToken<T>): T | null {
    const runtime = this.runtimeContainer;
    if (!runtime) return null;
    try {
      return runtime.isRegistered(token, true)
        ? runtime.resolve<T>(token)
        : null;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - callers turn `null` into a
      // refusal (settings) or an unverifiable classification (lists).
      this.logger.warn('[skill-synthesis] could not resolve a dependency', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async readOrphanFlags(
    mirror: UserLayerMirrorService,
  ): Promise<ReadonlyMap<string, boolean>> {
    try {
      const entries = await mirror.listClones(this.agentScope());
      return new Map(
        entries.map((entry) => [`${entry.kind}/${entry.slug}`, entry.orphaned]),
      );
    } catch (error: unknown) {
      this.logger.warn(
        '[skill-synthesis] could not read clone origin sidecars for orphan flags',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return new Map<string, boolean>();
    }
  }

  private async readOrphanFlag(
    mirror: UserLayerMirrorService,
    kind: SkillRegistryKind,
    slug: string,
  ): Promise<boolean> {
    try {
      const entry = await mirror.readCloneOrigin(kind, slug, this.agentScope());
      return entry?.orphaned === true;
    } catch {
      // degradation-audit: optional-capability - the origin sidecar is
      // optional provenance metadata; false renders the clone as not
      // orphaned, exactly as it rendered before the field existed.
      return false;
    }
  }

  private readCloneBody(
    mirror: UserLayerMirrorService,
    kind: SkillRegistryKind,
    slug: string,
  ): string | null {
    try {
      const roots = mirror.getUserLayerRoots(this.agentScope());
      const root =
        kind === 'skill'
          ? roots.skills
          : kind === 'agent'
            ? roots.agents
            : roots.commands;
      const filePath =
        kind === 'skill'
          ? join(root, slug, 'SKILL.md')
          : join(root, `${slug}.md`);
      if (!this.isUnder(root, filePath)) return null;
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      // degradation-audit: optional-capability - the clone body is optional
      // detail content; null renders the entry with no body preview.
      return null;
    }
  }

  private isUnder(rootDir: string, targetPath: string): boolean {
    const root = resolve(rootDir);
    const resolved = resolve(targetPath);
    return resolved === root || resolved.startsWith(root + sep);
  }

  /**
   * Where `rebaseClone` should copy FROM, for every clone kind and both origins.
   *
   * Two things were wrong here before TASK_2026_278:
   *
   *  - A clone with no `originPluginId` returned `null`, so a SYNTH skill and a
   *    workspace-authored AGENT could be flagged diverged and then never
   *    rebased — the UI offered a button that always failed (defect 8). Their
   *    upstreams are `<skillsRoot>/<slug>/` and `{ws}/.claude/agents/<slug>.md`.
   *  - The plugin branch returned the commands/agents DIRECTORY, while
   *    `rebaseFileClone` probes it with `fileExists`. That is always false, so
   *    every plugin command/agent rebase answered `source-missing` regardless of
   *    what was on disk. Both now resolve to the `<slug>.md` FILE.
   *
   * A command with no plugin origin still returns `null`: nothing in the tree
   * writes a plugin-less command clone, so there is no upstream to name and
   * inventing one would rebase from a path that never existed.
   */
  private resolveUpstreamSourceDir(
    kind: SkillRegistryKind,
    slug: string,
    row: SkillRegistryRow,
  ): string | null {
    if (isUnsafePathSegment(slug)) return null;

    if (row.originPluginId) {
      if (!this.contentDownload) return null;
      if (isUnsafePathSegment(row.originPluginId)) return null;
      const pluginsPath = this.contentDownload.getPluginsPath();
      if (kind === 'skill') {
        return join(pluginsPath, row.originPluginId, 'skills', slug);
      }
      if (kind === 'command') {
        return join(pluginsPath, row.originPluginId, 'commands', `${slug}.md`);
      }
      return join(pluginsPath, row.originPluginId, 'agents', `${slug}.md`);
    }

    if (kind === 'skill') {
      return join(resolveSkillsRoot(this.workspaceProvider), slug);
    }
    if (kind === 'agent') {
      const workspaceRoot = this.workspaceProvider.getWorkspaceRoot();
      return workspaceRoot
        ? join(workspaceRoot, '.claude', 'agents', `${slug}.md`)
        : null;
    }
    return null;
  }

  private assertSkillsNotPaused(method: RpcMethodName): void {
    const enabled = this.workspaceProvider.getConfiguration<unknown>(
      'ptah',
      'skillSynthesis.enabled',
      FILE_BASED_SETTINGS_DEFAULTS['skillSynthesis.enabled'],
    );
    if (enabled !== false) return;
    this.logger.info('[skill-synthesis] manual run refused — skills paused', {
      method,
    });
    throw new RpcUserError('Skill synthesis is paused', 'PAUSED');
  }

  private report(error: unknown, errorSource: string): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`RPC ${errorSource} failed`, err);

    this.sentryService.captureException(err, { errorSource });
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A panel entry's scorecard, read out of untyped JSON.
 *
 * Each criterion is taken only when it is a finite number; anything else reads
 * as "not scored" (`null`) rather than being coerced. An all-null card
 * collapses to `null` through {@link toJudgeCriteria}, so a panellist who
 * produced no breakdown renders as no scorecard instead of five blanks.
 */
function toQuarantinedAgentEntry(
  item: QuarantinedAgentItem,
): QuarantinedAgentEntry {
  return {
    slug: item.slug,
    state: item.state,
    quarantinedAt: item.quarantinedAt,
    hasSnapshot: item.hasSnapshot,
    sourcePath: item.sourcePath,
  };
}

/**
 * Own-property define, so a hand-edited `__proto__` slug in the settings file
 * stays an ordinary key instead of replacing the result's prototype.
 */
function defineOwnEntry<T>(
  target: Record<string, T>,
  key: string,
  value: T,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Own-property read of one provider leaf from an untyped slug entry. */
function readProviderLeaf(
  entry: Record<string, unknown>,
  provider: AgentModelProvider,
): unknown {
  return Object.prototype.hasOwnProperty.call(entry, provider)
    ? entry[provider]
    : undefined;
}

/**
 * A stored layer as the wire shape: slug entries that are objects, and within
 * them string values of known providers. Anything else (a hand-edited
 * non-object layer, entry or leaf) carries nothing emission would use.
 */
function toStoredAgentModelLayer(raw: unknown): AgentModelSettingsValue | null {
  if (!isRecord(raw)) return null;
  const layer: AgentModelSettingsValue = {};
  for (const [slug, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) continue;
    const kept: Partial<Record<AgentModelProvider, string>> = {};
    for (const provider of AGENT_MODEL_PROVIDERS) {
      const leaf = readProviderLeaf(entry, provider);
      if (typeof leaf === 'string') kept[provider] = leaf;
    }
    if (Object.keys(kept).length > 0) defineOwnEntry(layer, slug, kept);
  }
  return layer;
}

function classifyAgentModelLayer(
  layer: AgentModelSettingsValue | null,
  lists: Record<AgentModelProvider, AgentModelEntry[]> | null,
): AgentModelLayerClassification {
  const result: AgentModelLayerClassification = {};
  if (layer === null) return result;
  for (const [slug, entry] of Object.entries(layer)) {
    const classes: Partial<Record<AgentModelProvider, AgentModelClass>> = {};
    for (const provider of AGENT_MODEL_PROVIDERS) {
      const value = entry[provider];
      if (value === undefined) continue;
      classes[provider] = classifyAgentModelValue(
        provider,
        value,
        lists?.[provider] ?? null,
      );
    }
    defineOwnEntry(result, slug, classes);
  }
  return result;
}

/** The provider's documented id format, for a malformed-value refusal. */
function agentModelSyntaxHint(provider: AgentModelProvider): string {
  switch (provider) {
    case 'opencode':
      return ' OpenCode expects "provider/model" with no spaces.';
    case 'claude':
      return ' Claude accepts opus, sonnet, haiku or inherit.';
    default:
      return ' Model ids cannot contain spaces or control characters.';
  }
}
