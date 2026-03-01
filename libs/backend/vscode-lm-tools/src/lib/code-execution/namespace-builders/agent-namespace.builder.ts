/**
 * Agent Namespace Builder
 * TASK_2025_157: Async agent orchestration via CLI agents
 *
 * Provides spawn, status, read, steer, stop, list, waitFor methods
 * for managing headless CLI agents (Gemini, Codex) as background workers.
 *
 * Pattern: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts
 */

import type { AgentNamespace } from '../types';
import type {
  AgentProcessManager,
  CliDetectionService,
} from '@ptah-extension/llm-abstraction';
import type { AgentProcessInfo } from '@ptah-extension/shared';

/** Maximum waitFor timeout: 30 minutes */
const MAX_WAIT_TIMEOUT = 30 * 60 * 1000;

/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Function that returns the currently active SDK session ID. Called at spawn time to link CLI agents to their parent session. */
  getActiveSessionId?: () => string | undefined;
  /** Returns project-specific guidance from enhanced prompts (async). Called at spawn time to inject project context into CLI agents. */
  getProjectGuidance?: () => Promise<string | undefined>;
}

/**
 * Build the agent namespace for ptah.agent.*
 */
export function buildAgentNamespace(
  deps: AgentNamespaceDependencies
): AgentNamespace {
  const {
    agentProcessManager,
    cliDetectionService,
    getActiveSessionId,
    getProjectGuidance,
  } = deps;

  return {
    spawn: async (request) => {
      // Inject parentSessionId and projectGuidance at spawn time
      const activeSessionId = getActiveSessionId?.();
      const projectGuidance = await getProjectGuidance?.();

      const enrichedRequest = {
        ...request,
        ...(activeSessionId && { parentSessionId: activeSessionId }),
        ...(projectGuidance && { projectGuidance }),
      };
      return agentProcessManager.spawn(enrichedRequest);
    },

    status: async (agentId?) => {
      return agentProcessManager.getStatus(agentId);
    },

    read: async (agentId, tail?) => {
      return agentProcessManager.readOutput(agentId, tail);
    },

    steer: async (agentId, instruction) => {
      agentProcessManager.steer(agentId, instruction);
    },

    stop: async (agentId) => {
      return agentProcessManager.stop(agentId);
    },

    list: async () => {
      return cliDetectionService.detectAll();
    },

    waitFor: async (agentId, options?) => {
      const pollInterval = options?.pollInterval ?? 2000;
      const timeout = Math.min(
        options?.timeout ?? MAX_WAIT_TIMEOUT,
        MAX_WAIT_TIMEOUT
      );
      const startTime = Date.now();

      return new Promise<AgentProcessInfo>((resolve, reject) => {
        let pollHandle: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (pollHandle !== null) {
            clearTimeout(pollHandle);
            pollHandle = null;
          }
        };

        const check = () => {
          try {
            const status = agentProcessManager.getStatus(
              agentId
            ) as AgentProcessInfo;
            if (status.status !== 'running') {
              cleanup();
              resolve(status);
              return;
            }

            // Check timeout
            if (Date.now() - startTime > timeout) {
              cleanup();
              reject(
                new Error(
                  `waitFor timed out after ${timeout}ms for agent ${agentId}`
                )
              );
              return;
            }

            pollHandle = setTimeout(check, pollInterval);
          } catch (error) {
            cleanup();
            reject(error);
          }
        };

        check();
      });
    },
  };
}
