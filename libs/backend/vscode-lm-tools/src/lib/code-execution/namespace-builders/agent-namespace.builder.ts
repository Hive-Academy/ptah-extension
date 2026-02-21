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

/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
}

/**
 * Build the agent namespace for ptah.agent.*
 */
export function buildAgentNamespace(
  deps: AgentNamespaceDependencies
): AgentNamespace {
  const { agentProcessManager, cliDetectionService } = deps;

  return {
    spawn: async (request) => {
      return agentProcessManager.spawn(request);
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
      const timeout = options?.timeout;
      const startTime = Date.now();

      return new Promise<AgentProcessInfo>((resolve, reject) => {
        const check = () => {
          try {
            const status = agentProcessManager.getStatus(
              agentId
            ) as AgentProcessInfo;
            if (status.status !== 'running') {
              resolve(status);
              return;
            }

            // Check timeout
            if (timeout && Date.now() - startTime > timeout) {
              reject(
                new Error(
                  `waitFor timed out after ${timeout}ms for agent ${agentId}`
                )
              );
              return;
            }

            setTimeout(check, pollInterval);
          } catch (error) {
            reject(error);
          }
        };

        check();
      });
    },
  };
}
