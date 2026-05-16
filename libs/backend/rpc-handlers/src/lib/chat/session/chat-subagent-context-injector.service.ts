/**
 * Subagent context injector.
 *
 * Owns the `[SYSTEM CONTEXT - INTERRUPTED AGENTS]` prompt prefix injection
 * + watcher pre-warming + registry mark/remove. Extracted from
 * `ChatSessionService.continueSession` so that the session service stays
 * under the 700 LOC budget and the side-effects (file watching, registry
 * mutation) are localised to a single collaborator.
 *
 * The prompt prefix string MUST stay byte-identical to the pre-extraction
 * version — including the header, numbered instructions list, agentId
 * placeholder, and `[END SYSTEM CONTEXT]\n\n` trailer.
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
   * Side effects (preserved verbatim from pre-extraction):
   *  1. Filters resumable subagents by transcript-file existence; agents
   *     without a transcript on disk are removed from the registry.
   *  2. Marks each injected subagent as injected, then removes it from the
   *     registry so the prefix is one-shot.
   */
  async injectInterruptedAgentsContext(
    prompt: string,
    sessionId: SessionId,
    workspacePath: string | undefined,
  ): Promise<SubagentContextInjectionResult> {
    const allResumable = this.subagentRegistry.getResumableBySession(sessionId);

    // DIAGNOSTIC: Log registry state for debugging context injection
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
      })),
      workspacePath,
    });

    // Filter to only agents whose transcript files exist on disk.
    // Without a transcript, the SDK can't resume — it reports "transcript was lost".
    const resumableSubagents: typeof allResumable = [];
    for (const s of allResumable) {
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
        // Remove from registry — can't resume without transcript
        this.subagentRegistry.remove(s.toolCallId);
      }
    }

    if (resumableSubagents.length === 0) {
      return { prompt, injected: false };
    }

    // Build detailed agent context with actionable instructions
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

    // Instructive context that tells Claude WHAT to do, not just what exists
    // Uses agentId (short hex) which the SDK uses to identify the subagent for resumption
    const contextPrefix = `[SYSTEM CONTEXT - INTERRUPTED AGENTS]
The following subagent(s) were interrupted and did not complete their work:
${agentDetails}

IMPORTANT INSTRUCTIONS:
1. Your FIRST action should be to resume these interrupted agents using the Task tool with the "resume" parameter set to the agentId shown above (e.g., resume: "${resumableSubagents[0].agentId}").
2. Resume agents in the order they were interrupted (continue their previous work).
3. After resuming completes, address the user's current message if it requires additional work.
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

    // Remove injected subagents from registry to prevent
    // re-injection on subsequent messages. The context is a one-shot injection;
    // once Claude receives the resumption instructions, we don't need to send them again.
    // Mark as injected BEFORE removing so that
    // registerFromHistoryEvents() skips these on session reload.
    for (const s of resumableSubagents) {
      this.subagentRegistry.markAsInjected(s.toolCallId);
      this.subagentRegistry.remove(s.toolCallId);
    }

    return { prompt: enhancedPrompt, injected: true };
  }
}
