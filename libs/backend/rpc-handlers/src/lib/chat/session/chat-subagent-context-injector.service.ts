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
import type { SessionId } from '@ptah-extension/shared';

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
  ) {}

  /**
   * Inject the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prefix into `prompt`
   * for any resumable subagents whose transcript files exist on disk.
   *
   * Side effects:
   *  1. Agents without a transcript on disk are removed from the registry
   *     (nothing to resume) and marked injected so history replay does not
   *     resurrect them.
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
      const hasTranscript = workspacePath
        ? await this.ptahCli.hasSubagentTranscript(
            workspacePath,
            sessionId,
            s.agentId,
          )
        : false;
      if (hasTranscript) {
        resumableSubagents.push(s);
      } else {
        this.logger.warn(
          'RPC: chat:continue - skipping agent without transcript on disk',
          { agentId: s.agentId, agentType: s.agentType, sessionId },
        );
        this.subagentRegistry.markAsInjected(s.toolCallId);
        this.subagentRegistry.remove(s.toolCallId);
      }
    }

    if (resumableSubagents.length === 0) {
      return { prompt, injected: false };
    }
    const agentDetails = resumableSubagents
      .map((s) => {
        const interruptedAgo = s.interruptedAt
          ? Math.round((Date.now() - s.interruptedAt) / 1000 / 60)
          : 0;
        return `  - ${s.agentType} agent (agentId: ${s.agentId})${
          interruptedAgo > 0 ? ` - interrupted ${interruptedAgo} min ago` : ''
        }`;
      })
      .join('\n');
    const contextPrefix = `[SYSTEM CONTEXT - INTERRUPTED AGENTS]
The following subagent(s) were interrupted and did not complete their work:
${agentDetails}

IMPORTANT INSTRUCTIONS:
1. Your FIRST action should be to resume these interrupted agents so they continue their previous work. To resume an agent, invoke the Agent tool with the same subagent type shown above and a prompt that begins exactly with "Resume agent ${resumableSubagents[0].agentId}" (use each agent's own agentId), followed by an instruction to continue from where it was interrupted. If a SendMessage tool is available, you may instead send a message addressed to the agent's ID asking it to continue. Do NOT pass a "resume" parameter to the Agent tool — no such parameter exists.
2. Resume agents in the order they are listed above.
3. After resumption completes, address the user's current message if it requires additional work.
4. If the user explicitly asks to start fresh or work on something completely unrelated, you may skip resumption and acknowledge the interrupted work was abandoned.

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
    });
    for (const s of resumableSubagents) {
      this.subagentRegistry.recordInjectionAttempt(s.toolCallId);
    }

    return { prompt: enhancedPrompt, injected: true };
  }
}
