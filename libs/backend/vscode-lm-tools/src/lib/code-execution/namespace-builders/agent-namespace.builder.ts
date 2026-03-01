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
  SdkHandle,
} from '@ptah-extension/llm-abstraction';
import type {
  AgentProcessInfo,
  CliDetectionResult,
} from '@ptah-extension/shared';

/** Maximum waitFor timeout: 30 minutes */
const MAX_WAIT_TIMEOUT = 30 * 60 * 1000;

/**
 * Minimal summary returned by CustomAgentRegistry.listAgents().
 * Only includes fields needed by the agent namespace builder.
 *
 * @see CustomAgentSummary in libs/shared/src/lib/types/custom-agent.types.ts for the full type
 * @see CustomAgentRegistry.listAgents() in libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts
 * @warning Keep fields in sync with the canonical CustomAgentSummary type
 */
interface CustomAgentListEntry {
  id: string;
  name: string;
  providerName: string;
  hasApiKey: boolean;
  enabled: boolean;
}

/**
 * Discriminated union for spawnAgent() failure results.
 * Mirrors SpawnAgentFailure from @ptah-extension/agent-sdk -- duplicated
 * here to avoid circular dependency between vscode-lm-tools -> agent-sdk.
 *
 * @see SpawnAgentFailure in libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts
 * @warning Keep status values in sync with the canonical type
 */
interface SpawnAgentFailure {
  status: 'not_found' | 'disabled' | 'no_api_key' | 'unknown_provider';
  message: string;
}

/**
 * Minimal interface for CustomAgentRegistry to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Only includes methods used by the
 * agent namespace builder.
 *
 * @see CustomAgentRegistry in libs/backend/agent-sdk/src/lib/custom-agent/custom-agent-registry.ts
 * @warning If CustomAgentRegistry's public API changes, this interface MUST be updated
 */
interface CustomAgentRegistryLike {
  listAgents(): Promise<CustomAgentListEntry[]>;
  spawnAgent(
    id: string,
    task: string,
    projectGuidance?: string
  ): Promise<{ handle: SdkHandle; agentName: string } | SpawnAgentFailure>;
}

/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Workspace root path for working directory fallback. Preferred over process.cwd(). */
  workspaceRoot?: string;
  /** Function that returns the currently active SDK session ID. Called at spawn time to link CLI agents to their parent session. */
  getActiveSessionId?: () => string | undefined;
  /** Returns project-specific guidance from enhanced prompts (async). Called at spawn time to inject project context into CLI agents. */
  getProjectGuidance?: () => Promise<string | undefined>;
  /** Lazy resolver for CustomAgentRegistry (avoids hard dependency on agent-sdk) */
  getCustomAgentRegistry?: () => CustomAgentRegistryLike | undefined;
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
    workspaceRoot,
    getActiveSessionId,
    getProjectGuidance,
    getCustomAgentRegistry,
  } = deps;

  return {
    spawn: async (request) => {
      // Inject parentSessionId and projectGuidance at spawn time
      const activeSessionId = getActiveSessionId?.();
      const projectGuidance = await getProjectGuidance?.();

      // Route custom agent spawn through CustomAgentRegistry
      if (request.customAgentId) {
        const registry = getCustomAgentRegistry?.();
        if (!registry) {
          throw new Error(
            'Custom agent registry not available. Custom agents require the Agent SDK.'
          );
        }

        const result = await registry.spawnAgent(
          request.customAgentId,
          request.task,
          projectGuidance
        );
        if ('status' in result) {
          throw new Error(
            `Custom agent spawn failed: ${result.message}. ` +
              'Use ptah_agent_list to see available agents.'
          );
        }

        // Get workspace root for working directory (prefer injected workspace root over process.cwd())
        const workingDirectory =
          request.workingDirectory ?? workspaceRoot ?? process.cwd();

        return agentProcessManager.spawnFromSdkHandle(result.handle, {
          task: request.task,
          cli: 'custom',
          workingDirectory,
          taskFolder: request.taskFolder,
          parentSessionId: activeSessionId,
          customAgentName: result.agentName,
          timeout: request.timeout,
        });
      }

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
      // Merge CLI agents with custom agents
      const cliResults = await cliDetectionService.detectAll();

      const registry = getCustomAgentRegistry?.();
      if (!registry) {
        return cliResults;
      }

      try {
        const customAgents = await registry.listAgents();
        const customResults: CliDetectionResult[] = customAgents
          .filter((a) => a.enabled && a.hasApiKey)
          .map((a) => ({
            cli: 'custom' as const,
            installed: true,
            supportsSteer: false,
            customAgentId: a.id,
            customAgentName: a.name,
            providerName: a.providerName,
          }));

        return [...cliResults, ...customResults];
      } catch {
        // If listing custom agents fails, still return CLI agents
        return cliResults;
      }
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
