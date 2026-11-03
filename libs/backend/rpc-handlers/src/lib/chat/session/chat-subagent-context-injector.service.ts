/**
 * Subagent context injector.
 *
 * Owns the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prompt prefix injection.
 * Extracted from `ChatSessionService.continueSession` so that the session
 * service stays under the 700 LOC budget.
 *
 * Resume contract (Claude Code 2.1.x / SDK 0.3.x): there is NO `resume`
 * parameter on the Agent/Task tool. Resumption works by continuing the same
 * session (`resume: sessionId`, which chat:continue already does) and
 * instructing the model in plain text to resume the agent by its agentId.
 *
 * Injection is one-shot: a record described to the model once is retired for
 * good, in the registry and in the session's durable resume snapshot, so
 * neither a session switch nor a restart offers it again. Records the user
 * dismissed are included — dismissing hides them from the webview but the
 * model still hears about them this one time.
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  computeSubagentCacheState,
  resolveSubagentPromptCacheTtl,
} from '@ptah-extension/shared';
import type {
  SessionId,
  SubagentCacheInfo,
  SubagentRecord,
} from '@ptah-extension/shared';

import {
  SDK_TOKENS,
  adviseSubagentResume,
  type SessionMetadataStore,
  type CompactionConfigProvider,
  type SubagentBudgetMonitor,
  type SubagentResumeAdvice,
  type SubagentResumeAdviceInput,
} from '@ptah-extension/agent-sdk';

import { CHAT_TOKENS } from '../tokens';
import type { ChatPtahCliService } from '../ptah-cli/chat-ptah-cli.service';

export interface SubagentContextInjectionResult {
  /**
   * Prompt with the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix prepended
   * if any resumable subagents were found, otherwise the original prompt
   * unchanged.
   */
  prompt: string;
  /**
   * Whether the prefix was injected (i.e. at least one resumable subagent
   * with an on-disk transcript was found and watchers were pre-warmed).
   */
  injected: boolean;
  /**
   * Retire the injected agents for good (registry and durable snapshot).
   * Call once the prompt was accepted by the session. Never throws.
   */
  commit(): Promise<void>;
  /**
   * Give the injected agents back, still resumable, when the prompt was not
   * sent. A no-op after {@link commit}.
   */
  release(): void;
}

const NOOP_INJECTION = {
  commit: async (): Promise<void> => undefined,
  release: (): void => undefined,
} as const;

@injectable()
export class ChatSubagentContextInjectorService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(CHAT_TOKENS.PTAH_CLI)
    private readonly ptahCli: ChatPtahCliService,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadataStore: SessionMetadataStore,
    @inject(SDK_TOKENS.SDK_SUBAGENT_BUDGET_MONITOR, { isOptional: true })
    private readonly budgetMonitor?: SubagentBudgetMonitor,
    @inject(SDK_TOKENS.SDK_COMPACTION_CONFIG_PROVIDER, { isOptional: true })
    private readonly compactionConfig?: CompactionConfigProvider,
  ) {}

  /**
   * toolCallIds an in-flight chat:continue has put into its prompt but not
   * yet committed. A concurrent continue skips them, so two follow-ups cannot
   * both describe the same agent. Taken synchronously, before the first
   * await; dropped by commit() or release().
   */
  private readonly claimedToolCallIds = new Set<string>();

  /**
   * Inject the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix into `prompt`
   * for any resumable subagents whose transcript files exist on disk.
   *
   * Side effects:
   *  1. Agents whose transcript is confirmed ABSENT on disk are retired
   *     (nothing to resume). Agents whose transcript state could not be
   *     determined are left untouched — retirement is permanent, because it
   *     also blocks re-registration from history.
   *  2. Every agent injected into the prompt is claimed; the caller retires
   *     it with `commit()` once the prompt was sent (the model has been told
   *     once, which is all it is owed), or hands it back with `release()`.
   *  3. Retirement is recorded in the session's durable resume snapshot so a
   *     restart does not resurrect the record from metadata or history.
   */
  async injectInterruptedAgentsContext(
    prompt: string,
    sessionId: SessionId,
    workspacePath: string | undefined,
  ): Promise<SubagentContextInjectionResult> {
    // Claim before the first await so a concurrent continue skips these.
    const allResumable = this.subagentRegistry
      .getInterruptedBySession(sessionId)
      .filter((s) => !this.claimedToolCallIds.has(s.toolCallId));
    for (const s of allResumable) this.claimedToolCallIds.add(s.toolCallId);
    this.logger.info('RPC: chat:continue - subagent context injection check', {
      sessionId,
      registrySize: this.subagentRegistry.size,
      allResumableCount: allResumable.length,
      allResumableAgents: allResumable.map((s) => ({
        toolCallId: s.toolCallId,
        agentId: s.agentId,
        agentType: s.agentType,
        status: s.status,
        parentSessionId: s.parentSessionId,
        dismissed: s.dismissed === true,
      })),
      workspacePath,
    });
    try {
      return await this.buildInjection(
        prompt,
        sessionId,
        workspacePath,
        allResumable,
      );
    } catch (error) {
      // Not swallowed: rethrown after handing the claims back.
      for (const s of allResumable) {
        this.claimedToolCallIds.delete(s.toolCallId);
      }
      throw error;
    }
  }

  /**
   * Probe, retire absent transcripts and build the prefix for the records
   * {@link injectInterruptedAgentsContext} claimed. Releases the claims of
   * every record it does not inject.
   */
  private async buildInjection(
    prompt: string,
    sessionId: SessionId,
    workspacePath: string | undefined,
    allResumable: readonly SubagentRecord[],
  ): Promise<SubagentContextInjectionResult> {
    const resumableSubagents: SubagentRecord[] = [];
    const retiredWithoutTranscript: string[] = [];
    await this.probeTranscripts(
      allResumable,
      sessionId,
      workspacePath,
      resumableSubagents,
      retiredWithoutTranscript,
    );

    const injectedIds = resumableSubagents.map((s) => s.toolCallId);
    for (const s of allResumable) {
      if (!injectedIds.includes(s.toolCallId)) {
        this.claimedToolCallIds.delete(s.toolCallId);
      }
    }
    // Nothing to resume from these, whether or not the prompt goes out.
    await this.retire(sessionId, retiredWithoutTranscript);

    if (resumableSubagents.length === 0) {
      return { prompt, injected: false, ...NOOP_INJECTION };
    }
    const effectiveTtl = this.resolveEffectiveTtl();
    const now = Date.now();
    const agents = resumableSubagents.map((s) => {
      const cache = computeSubagentCacheState(
        s.lastActivityAt,
        effectiveTtl,
        now,
      );
      return {
        record: s,
        cache,
        advice: this.adviseResume(sessionId, s.toolCallId, cache.cacheState),
      };
    });
    const hasFreshAdvice = agents.some((a) => a.advice?.advice === 'fresh');
    const agentDetails = agents
      .map(({ record: s, cache, advice }) => {
        const interruptedAgo = s.interruptedAt
          ? Math.round((now - s.interruptedAt) / 1000 / 60)
          : 0;
        return `  - ${s.agentType} agent (agentId: ${s.agentId})${
          interruptedAgo > 0 ? ` - interrupted ${interruptedAgo} min ago` : ''
        } - ${formatCacheState(cache, hasActivity(s.lastActivityAt))}${
          advice ? ` - advice: ${advice.advice} (${advice.reason})` : ''
        }`;
      })
      .join('\n');
    const firstWarm = agents.find(
      (a) => a.cache.cacheState === 'warm' && a.advice?.advice !== 'fresh',
    );
    const hasCold = agents.some((a) => a.cache.cacheState === 'cold');
    const instructions: string[] = [];
    if (firstWarm) {
      instructions.push(
        `Your FIRST action should be to resume the agents marked "cache: warm" so they continue their previous work. To resume an agent, invoke the Agent tool with the same subagent type shown above and a prompt that begins exactly with "Resume agent <agentId>", where <agentId> is that agent's own agentId listed above, followed by an instruction to continue from where it was interrupted. If a SendMessage tool is available, you may instead send a message addressed to the agent's ID asking it to continue. Do NOT pass a "resume" parameter to the Agent tool — no such parameter exists.`,
      );
    }
    if (hasCold) {
      instructions.push(
        `Do NOT resume the agents marked "cache: cold". For each of them, start a fresh subagent of the same type with a short brief of the work that remains.`,
      );
    }
    if (hasFreshAdvice) {
      instructions.push(
        'Where an agent is marked "advice: fresh", start a fresh subagent of the same type with a short brief instead of resuming it, even if its cache is warm.',
      );
    }
    instructions.push(
      'Handle the agents in the order they are listed above.',
      "After that, address the user's current message if it requires additional work.",
      'If the user explicitly asks to start fresh or work on something completely unrelated, you may skip this and acknowledge the interrupted work was abandoned.',
    );
    const contextPrefix = `[SYSTEM CONTEXT - INTERRUPTED AGENTS]
The following subagent(s) were interrupted and did not complete their work:
${agentDetails}

${SUBAGENT_CACHE_GUIDANCE}
${SUBAGENT_CACHE_ESTIMATE_NOTE}

IMPORTANT INSTRUCTIONS:
${instructions.map((line, i) => `${i + 1}. ${line}`).join('\n')}

[END SYSTEM CONTEXT]

`;
    const enhancedPrompt = contextPrefix + prompt;

    this.logger.info('RPC: chat:continue - injected subagent context', {
      sessionId,
      resumableCount: resumableSubagents.length,
      agents: resumableSubagents.map((s) => ({
        agentId: s.agentId,
        agentType: s.agentType,
        parentSessionId: s.parentSessionId,
      })),
      effectiveTtl,
      cacheStates: agents.map((a) => a.cache.cacheState),
    });
    let settled = false;
    const dropClaims = (): void => {
      for (const id of injectedIds) this.claimedToolCallIds.delete(id);
    };
    return {
      prompt: enhancedPrompt,
      injected: true,
      commit: async () => {
        if (settled) return;
        settled = true;
        // retire() removes the records synchronously before its first await,
        // so no concurrent continue can see them between the two steps.
        const retiring = this.retire(sessionId, injectedIds);
        dropClaims();
        await retiring;
      },
      release: () => {
        if (settled) return;
        settled = true;
        dropClaims();
      },
    };
  }

  /**
   * Sort claimed records by transcript probe: `present` ones go to
   * `resumable`, confirmed `absent` ones to `absent`; `indeterminate` ones go
   * nowhere and stay resumable.
   */
  private async probeTranscripts(
    records: readonly SubagentRecord[],
    sessionId: SessionId,
    workspacePath: string | undefined,
    resumable: SubagentRecord[],
    absent: string[],
  ): Promise<void> {
    for (const s of records) {
      // No workspace path means we cannot locate any transcript — that is
      // "could not determine", not "absent", and must not retire the record.
      const probe = workspacePath
        ? await this.ptahCli.probeSubagentTranscript(
            workspacePath,
            sessionId,
            s.agentId,
          )
        : 'indeterminate';

      if (probe === 'present') {
        resumable.push(s);
        continue;
      }

      if (probe === 'indeterminate') {
        // Keep the record: a later chat:continue with a resolved session id
        // can still probe successfully. Skip injection this round rather than
        // instruct the model to resume an agent we could not verify. It is
        // not retired, so an unverifiable record ages out via TTL instead of
        // being dropped unseen.
        this.logger.warn(
          'RPC: chat:continue - could not determine transcript state; keeping interrupted agent',
          { agentId: s.agentId, agentType: s.agentType, sessionId },
        );
        continue;
      }

      this.logger.warn(
        'RPC: chat:continue - skipping agent without transcript on disk',
        { agentId: s.agentId, agentType: s.agentType, sessionId },
      );
      absent.push(s.toolCallId);
    }
  }

  /**
   * Retire records in the registry and in the durable resume snapshot.
   *
   * The registry part runs first and cannot fail, so this process never
   * offers the records again. A failed metadata write is logged and does NOT
   * fail chat:continue: the prompt is already built and the user's message
   * must still go out. The cost of that failure is bounded — after a restart
   * the records could be offered (and injected) one more time.
   */
  private async retire(
    sessionId: SessionId,
    toolCallIds: readonly string[],
  ): Promise<void> {
    if (toolCallIds.length === 0) return;
    this.subagentRegistry.retire(toolCallIds);
    try {
      await this.sessionMetadataStore.retireResumableSubagents(
        sessionId,
        toolCallIds,
      );
    } catch (error) {
      this.logger.error(
        'RPC: chat:continue - failed to persist retired interrupted agents',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /**
   * Resume-or-fresh advice for one subagent from the budget monitor's
   * snapshot. `undefined` when the monitor (or its config) is not registered,
   * which leaves the prompt text as it was before the monitor existed.
   */
  private adviseResume(
    sessionId: SessionId,
    toolCallId: string,
    cacheState: SubagentCacheInfo['cacheState'],
  ): { advice: SubagentResumeAdvice; reason: string } | undefined {
    if (!this.budgetMonitor || !this.compactionConfig) {
      return undefined;
    }
    const snapshot = this.budgetMonitor.getSnapshot(sessionId, toolCallId);
    const input: SubagentResumeAdviceInput = {
      stopped: snapshot?.stopped ?? false,
      cacheState,
      contextTokens: snapshot?.contextTokens,
      handoffTokens: this.compactionConfig.getConfig().subagentHandoffTokens,
      budgetReached: snapshot?.budgetReached ?? false,
    };
    const advice = adviseSubagentResume(input);
    if (advice === 'resume') {
      return { advice, reason: 'cache warm, context within budget' };
    }
    // Same precedence as adviseSubagentResume.
    const reason = input.stopped
      ? 'stopped'
      : input.budgetReached
        ? 'budget reached'
        : input.cacheState === 'cold'
          ? 'cold'
          : 'context at handoff size';
    return { advice, reason };
  }

  /**
   * TTL the SDK uses for subagent prompt caching: the setting plus the host
   * env override. The session that produced these records could spawn
   * subagents, so the `'auto'` setting resolves as for such a session.
   */
  private resolveEffectiveTtl(): SubagentCacheInfo['effectiveTtl'] {
    return resolveSubagentPromptCacheTtl({
      setting: this.workspace.getConfiguration<unknown>(
        'ptah',
        'agentOrchestration.subagentPromptCacheTtl',
        'auto',
      ),
      envValue: process.env['CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL'],
      canSpawnSubagents: true,
    }).effective;
  }
}

/** Resume guidance shown above the numbered instructions. */
const SUBAGENT_CACHE_GUIDANCE =
  'Resume a subagent only when its cache is warm. When it is cold, start a fresh subagent with a short brief.';

/**
 * Activity is stamped only at lifecycle events (start, stop, move to the
 * background), not per message, so a long foreground run reads older than it
 * is. Say so rather than present the estimate as exact.
 */
const SUBAGENT_CACHE_ESTIMATE_NOTE =
  'Idle time counts from the last lifecycle event Ptah recorded for the agent (start, stop or move to the background), so an agent that ran a long time in the foreground can show cold while its cache is still warm.';

function hasActivity(lastActivityAt: number | undefined): boolean {
  return lastActivityAt !== undefined && Number.isFinite(lastActivityAt);
}

/**
 * `cache: warm (TTL 1h, idle 12 min)`. A record with no recorded activity is
 * cold with an unknown idle time, so it never prints "idle 0 min".
 */
function formatCacheState(
  cache: SubagentCacheInfo,
  activityRecorded: boolean,
): string {
  const idle = activityRecorded
    ? `idle ${Math.floor(cache.idleMs / 60_000)} min`
    : 'idle unknown';
  return `cache: ${cache.cacheState} (TTL ${cache.effectiveTtl}, ${idle})`;
}
