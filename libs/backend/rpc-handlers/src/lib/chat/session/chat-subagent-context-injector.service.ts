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
 * Injection is non-destructive: records stay in the registry until a resume
 * is observed (SubagentStart with the same agentId supersedes the record) or
 * MAX_INJECTION_ATTEMPTS unconsumed injections pass, after which the record
 * is dropped as abandoned.
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
import type { SessionId, SubagentCacheInfo } from '@ptah-extension/shared';

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
}

/**
 * Maximum number of chat:continue prompts a record's context is injected
 * into before the record is treated as abandoned and removed.
 */
export const MAX_INJECTION_ATTEMPTS = 3;

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
  ) {}

  /**
   * Inject the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix into `prompt`
   * for any resumable subagents whose transcript files exist on disk.
   *
   * Side effects:
   *  1. Agents whose transcript is confirmed ABSENT on disk are removed from
   *     the registry (nothing to resume) and marked injected so history replay
   *     does not resurrect them. Agents whose transcript state could not be
   *     determined are left untouched — removal is permanent here, because
   *     markAsInjected() also blocks re-registration from history.
   *  2. Each injected agent's attempt counter is incremented; records that
   *     reach MAX_INJECTION_ATTEMPTS without being resumed are removed.
   *  3. Records are otherwise KEPT in the registry — successful resumes are
   *     detected by SubagentRegistryService.register() (same agentId), which
   *     removes the superseded interrupted record.
   */
  async injectInterruptedAgentsContext(
    prompt: string,
    sessionId: SessionId,
    workspacePath: string | undefined,
  ): Promise<SubagentContextInjectionResult> {
    const allResumable = this.subagentRegistry.getResumableBySession(sessionId);
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
        injectionAttempts: this.subagentRegistry.getInjectionAttempts(
          s.toolCallId,
        ),
      })),
      workspacePath,
    });
    const resumableSubagents: typeof allResumable = [];
    for (const s of allResumable) {
      if (
        this.subagentRegistry.getInjectionAttempts(s.toolCallId) >=
        MAX_INJECTION_ATTEMPTS
      ) {
        this.logger.warn(
          'RPC: chat:continue - dropping interrupted agent after max injection attempts',
          {
            agentId: s.agentId,
            agentType: s.agentType,
            sessionId,
            maxAttempts: MAX_INJECTION_ATTEMPTS,
          },
        );
        this.subagentRegistry.markAsInjected(s.toolCallId);
        this.subagentRegistry.remove(s.toolCallId);
        continue;
      }
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
        resumableSubagents.push(s);
        continue;
      }

      if (probe === 'indeterminate') {
        // Keep the record: a later chat:continue with a resolved session id
        // can still probe successfully. Skip injection this round rather than
        // instruct the model to resume an agent we could not verify. No
        // attempt is counted, so an unverifiable record ages out via TTL
        // instead of being burned by the attempt cap.
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
      this.subagentRegistry.markAsInjected(s.toolCallId);
      this.subagentRegistry.remove(s.toolCallId);
    }

    if (resumableSubagents.length === 0) {
      return { prompt, injected: false };
    }
    const effectiveTtl = this.resolveEffectiveTtl();
    const now = Date.now();
    const agents = resumableSubagents.map((s) => ({
      record: s,
      cache: computeSubagentCacheState(s.lastActivityAt, effectiveTtl, now),
    }));
    const agentDetails = agents
      .map(({ record: s, cache }) => {
        const interruptedAgo = s.interruptedAt
          ? Math.round((now - s.interruptedAt) / 1000 / 60)
          : 0;
        return `  - ${s.agentType} agent (agentId: ${s.agentId})${
          interruptedAgo > 0 ? ` - interrupted ${interruptedAgo} min ago` : ''
        } - ${formatCacheState(cache, hasActivity(s.lastActivityAt))}`;
      })
      .join('\n');
    const firstWarm = agents.find((a) => a.cache.cacheState === 'warm');
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
    for (const s of resumableSubagents) {
      this.subagentRegistry.recordInjectionAttempt(s.toolCallId);
    }

    return { prompt: enhancedPrompt, injected: true };
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
