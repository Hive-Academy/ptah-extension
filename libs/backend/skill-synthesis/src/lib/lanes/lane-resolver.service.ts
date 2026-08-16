/**
 * LaneResolverService — turns a `SkillLaneId` into "where do I run, on what
 * model, with whose credentials".
 *
 * It resolves; it does not run. `LaneRunner` (B1.5) owns timeouts, the
 * structured-output ladder, budget accounting and the other three failure
 * modes. Splitting them means the resolution chain can be asserted without an
 * LLM in the room, which is what makes the R1/R2 credential guarantees
 * testable at all.
 *
 * ## The chain is GENERALIZED, never duplicated
 *
 * A lane goes through the same `IProviderAuthResolver` the memory curator
 * already uses, differing only in the `scope` it passes (`'lane'`) and in what
 * it does when that resolver throws. There is deliberately no second resolver,
 * no lane-specific credential lookup, and no place where this file knows a
 * provider id. `requiresProxy` providers work here because the resolver routes
 * them through `CuratorProxyManager` — which is only true for as long as lanes
 * never bypass the resolver.
 *
 * ## Unresolvable auth STALLS; it does not fall back (Q2)
 *
 * When a lane names a provider that is configured but unusable, this returns
 * `{ok: false, kind: 'auth-unresolvable'}` and the caller re-queues with a
 * 30-minute backoff and a surfaced reason. It never quietly rides the active
 * provider. That is a deliberate divergence from the memory curator, which
 * DOES fall back (`sdk-internal-query.curator-llm.ts:84-91`): the curator runs
 * on behalf of a user who is present, whereas falling back here would move
 * background work onto the foreground quota — the exact defect phase 1 exists
 * to remove.
 *
 * ## A lane NEVER mutates global auth state
 *
 * The resolver hands back a snapshot, which travels as `input.auth` and is
 * read per call. Nothing here writes `process.env` or the injected `AuthEnv`,
 * and no lane may route through `ProviderModelsService.setModelTier` /
 * `applyPersistedTiers` — the latter writes both unconditionally with no scope
 * guard, which would repoint the user's live chat session mid-conversation
 * (risk R1).
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PROVIDER_AUTH_RESOLVER_TOKEN } from '../di/tokens';
import { resolveJudgeModel } from '../model-resolver';
import {
  PROVIDER_AUTH_ERROR_NAME,
  type ILaneAuthResolver,
} from './lane-auth-resolver.port';
import {
  LANE_AUTH_RETRY_MS,
  type SkillLaneConfig,
  type SkillLaneId,
  type SkillLaneResolution,
} from './lane.types';
import { readSkillLane, readSkillLanes } from './skill-lane-config';

/** The one tier scope every lane reads. Q1: one shared scope, not four. */
const LANE_TIER_SCOPE = 'lane' as const;

const JUDGE_MODEL_KEY = 'skillSynthesis.judgeModel';
const JUDGE_MODEL_DEFAULT = 'inherit';

/**
 * Three lines, no provider branching.
 *
 * Lines 2 and 3 answer the same question — "no model was pinned on this lane,
 * so what do we send?" — with different KINDS of value, and the difference is
 * not an inconsistency. It follows from the auth env each branch runs under:
 *
 *  - **Line 2, no lane provider.** The resolver returns `null` for a blank
 *    provider id, so the call rides the user's ambient chat auth env, where
 *    that provider's `ANTHROPIC_DEFAULT_<TIER>_MODEL` values are populated.
 *    `resolveJudgeModel` therefore inherits the ACTIVE PROVIDER'S selected
 *    model, and where the user pinned none it ships `JUDGE_DEFAULT_MODEL_ID` —
 *    a pinned dated Claude id, ON PURPOSE. `ModelResolver.resolve` detects the
 *    tier from that id and substitutes the ambient tier override
 *    (`auth-providers/.../model-resolver.ts:38-48`), so a non-Anthropic user
 *    gets their own haiku-tier model rather than this literal. See
 *    `resolveJudgeModel`'s docblock for why the pinned id is the deliberate
 *    answer to "no preference expressed anywhere" (TASK_2026_250, Decision 1).
 *
 *  - **Line 3, a lane provider is set.** That lane gets an override env whose
 *    chat `ANTHROPIC_DEFAULT_*_MODEL` keys are BLANKED by design (R2), so a
 *    pinned dated id has no tier mapping left to travel through and would
 *    reach a non-Anthropic endpoint verbatim and 404. Only a BARE TIER ALIAS
 *    resolves there, through the provider entry's `defaultTiers`. That is why
 *    this line returns the alias, and it is a correct value rather than a
 *    weakness.
 *
 * Line 2 is also the untouched-existing-installs guarantee: with both
 * `provider` and `model` empty — every install that has never opened the Lanes
 * panel — this returns exactly what `SkillJudgeService` and
 * `SkillSynthesizerService` pass today.
 */
export function resolveLaneModel(
  cfg: SkillLaneConfig,
  judgeModel: string,
  ws: IWorkspaceProvider,
): string {
  if (cfg.model.trim()) return cfg.model.trim();
  if (!cfg.provider.trim()) return resolveJudgeModel(judgeModel, ws);
  return cfg.defaultTier;
}

@injectable()
export class LaneResolverService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    /**
     * Optional for the same reason the curator adapter's is
     * (`sdk-internal-query.curator-llm.ts:47`): a CLI or e2e host that never
     * registers `auth-providers` must still resolve this service. Absent
     * resolver ⇒ every lane rides the active provider, which is the
     * pre-lane behaviour.
     */
    @inject(PROVIDER_AUTH_RESOLVER_TOKEN, { isOptional: true })
    private readonly authResolver: ILaneAuthResolver | null = null,
  ) {}

  /** This lane's persisted configuration. */
  readConfig(laneId: SkillLaneId): SkillLaneConfig {
    return readSkillLane(this.workspace, laneId);
  }

  /** All four lane configurations — B1.5 feeds these to the drain's TTL assertion. */
  readConfigs(): Record<SkillLaneId, SkillLaneConfig> {
    return readSkillLanes(this.workspace);
  }

  async resolve(laneId: SkillLaneId): Promise<SkillLaneResolution> {
    const config = this.readConfig(laneId);
    const model = resolveLaneModel(
      config,
      this.readJudgeModel(),
      this.workspace,
    );

    if (!this.authResolver) {
      return { ok: true, lane: { config, auth: undefined, model } };
    }

    try {
      const auth = await this.authResolver.resolve(
        config.provider,
        LANE_TIER_SCOPE,
      );
      // R7: log the resolved triple. The tier env values are set by the
      // resolver BEFORE any provider identification happens, so the known
      // port-blind hostname match downstream is never consulted on this path
      // — but when it misfires anyway, this line is what makes it legible.
      this.logger.debug('[skill-synthesis] lane resolved', {
        lane: laneId,
        providerId: config.provider || '(active)',
        model,
        baseUrl: auth?.env?.['ANTHROPIC_BASE_URL'] ?? auth?.baseUrl ?? null,
        tierModels: {
          haiku: auth?.env?.['ANTHROPIC_DEFAULT_HAIKU_MODEL'] ?? null,
          sonnet: auth?.env?.['ANTHROPIC_DEFAULT_SONNET_MODEL'] ?? null,
          opus: auth?.env?.['ANTHROPIC_DEFAULT_OPUS_MODEL'] ?? null,
        },
      });
      return { ok: true, lane: { config, auth: auth ?? undefined, model } };
    } catch (error: unknown) {
      // Only a provider-auth failure is a lane STALL. Anything else is a bug
      // in this process, and swallowing it here would bury it in a queue row's
      // `reason` field instead of surfacing it — the drain's own catch is
      // where a genuine defect belongs.
      if (
        !(error instanceof Error) ||
        error.name !== PROVIDER_AUTH_ERROR_NAME
      ) {
        throw error;
      }
      this.logger.warn(
        '[skill-synthesis] lane auth unresolvable; stalling rather than spending foreground quota',
        { lane: laneId, providerId: config.provider, error: error.message },
      );
      return {
        ok: false,
        failure: {
          kind: 'auth-unresolvable',
          reason: `Lane ${laneId}: ${error.message}`,
          retryAfterMs: LANE_AUTH_RETRY_MS,
        },
      };
    }
  }

  private readJudgeModel(): string {
    const raw = this.workspace.getConfiguration<string>(
      'ptah',
      JUDGE_MODEL_KEY,
      JUDGE_MODEL_DEFAULT,
    );
    return typeof raw === 'string' && raw.trim().length > 0
      ? raw
      : JUDGE_MODEL_DEFAULT;
  }
}
