/**
 * Agent Namespace Builder
 *
 * Async agent orchestration via CLI agents. Provides spawn, status, read,
 * steer, stop, list, waitFor methods for managing headless CLI agents
 * (Gemini, Codex) as background workers.
 *
 * Pattern: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts
 */

import type { AgentNamespace } from '../types';
import type {
  AgentProcessManager,
  CliDetectionService,
  SdkHandle,
} from '@ptah-extension/agent-sdk';
import type {
  AgentProcessInfo,
  CliDetectionResult,
} from '@ptah-extension/shared';

/** Maximum waitFor timeout: 1 hour */
const MAX_WAIT_TIMEOUT = 60 * 60 * 1000;

/**
 * Minimal summary returned by PtahCliRegistry.listAgents().
 * Only includes fields needed by the agent namespace builder.
 *
 * @see PtahCliSummary in libs/shared/src/lib/types/ptah-cli.types.ts for the full type
 * @see PtahCliRegistry.listAgents() in libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts
 * @warning Keep fields in sync with the canonical PtahCliSummary type
 */
interface PtahCliListEntry {
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
 * @see SpawnAgentFailure in libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts
 * @warning Keep status values in sync with the canonical type
 */
interface SpawnAgentFailure {
  status: 'not_found' | 'disabled' | 'no_api_key' | 'unknown_provider';
  message: string;
}

/**
 * Minimal interface for PtahCliRegistry to avoid circular dependency
 * between vscode-lm-tools -> agent-sdk. Only includes methods used by the
 * agent namespace builder.
 *
 * @see PtahCliRegistry in libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts
 * @warning If PtahCliRegistry's public API changes, this interface MUST be updated
 */
interface PtahCliRegistryLike {
  listAgents(): Promise<PtahCliListEntry[]>;
  spawnAgent(
    id: string,
    task: string,
    options?: {
      projectGuidance?: string;
      workingDirectory?: string;
      resumeSessionId?: string;
      parentSessionId?: string;
      modelTier?: 'opus' | 'sonnet' | 'haiku';
    },
  ): Promise<
    | { handle: SdkHandle; agentName: string; setAgentId: (id: string) => void }
    | SpawnAgentFailure
  >;
}

/**
 * Dependencies for agent namespace
 */
export interface AgentNamespaceDependencies {
  agentProcessManager: AgentProcessManager;
  cliDetectionService: CliDetectionService;
  /** Lazy getter for workspace root path. Called at spawn time to get the current workspace root. */
  getWorkspaceRoot: () => string;
  /** Function that returns the currently active SDK session ID. Called at spawn time to link CLI agents to their parent session. */
  getActiveSessionId?: () => string | undefined;
  /** Returns project-specific guidance from enhanced prompts (async). Called at spawn time to inject project context into CLI agents. */
  getProjectGuidance?: () => Promise<string | undefined>;
  /** Returns full system prompt (prompt harness) for premium users (async). Replaces projectGuidance when available. */
  getSystemPrompt?: () => Promise<string | undefined>;
  /** Returns absolute paths to enabled plugin directories for premium users (async). */
  getPluginPaths?: () => Promise<string[] | undefined>;
  /** Lazy resolver for PtahCliRegistry (avoids hard dependency on agent-sdk) */
  getPtahCliRegistry?: () => PtahCliRegistryLike | undefined;
  /** Returns CLI types that are disabled by the user. Called at spawn/list time to filter out disabled agents. */
  getDisabledClis?: () => string[];
  /** Returns the user's preferred agent order for sorting list() results. */
  getPreferredAgentOrder?: () => string[];
  /** Resolves a tab ID to its real SDK session UUID. Used for MCP session threading. */
  resolveSessionId?: (tabIdOrSessionId: string) => string;
}

/**
 * Build the agent namespace for ptah.agent.*
 */
export function buildAgentNamespace(
  deps: AgentNamespaceDependencies,
): AgentNamespace {
  const {
    agentProcessManager,
    cliDetectionService,
    getWorkspaceRoot,
    getActiveSessionId,
    getProjectGuidance,
    getSystemPrompt,
    getPluginPaths,
    getPtahCliRegistry,
    getDisabledClis,
    getPreferredAgentOrder,
    resolveSessionId,
  } = deps;

  return {
    spawn: async (request) => {
      // Inject parentSessionId and projectGuidance at spawn time.
      // Prefer parentSessionId from the request (set by MCP URL path) over the global fallback.
      const rawSessionId = request.parentSessionId ?? getActiveSessionId?.();
      const activeSessionId = rawSessionId
        ? (resolveSessionId?.(rawSessionId) ?? rawSessionId)
        : undefined;
      const projectGuidance = await getProjectGuidance?.();

      // Route Ptah CLI agent spawn through PtahCliRegistry
      if (request.ptahCliId) {
        const registry = getPtahCliRegistry?.();
        if (!registry) {
          throw new Error(
            'Ptah CLI registry not available. Ptah CLI agents require the Agent SDK.',
          );
        }

        // Resolve working directory early — passed to both SDK (for cwd/sandbox)
        // and AgentProcessManager (for metadata tracking)
        const workingDirectory = request.workingDirectory ?? getWorkspaceRoot();

        const result = await registry.spawnAgent(
          request.ptahCliId,
          request.task,
          {
            projectGuidance,
            workingDirectory,
            resumeSessionId: request.resumeSessionId,
            parentSessionId: activeSessionId,
            modelTier: request.modelTier,
          },
        );
        if ('status' in result) {
          throw new Error(
            `Ptah CLI agent spawn failed: ${result.message}. ` +
              'Use ptah_agent_list to see available agents.',
          );
        }

        const spawnResult = await agentProcessManager.spawnFromSdkHandle(
          result.handle,
          {
            task: request.task,
            cli: 'ptah-cli',
            workingDirectory,
            taskFolder: request.taskFolder,
            parentSessionId: activeSessionId,
            ptahCliName: result.agentName,
            ptahCliId: request.ptahCliId,
            timeout: request.timeout,
            resumeSessionId: request.resumeSessionId,
          },
        );

        // Wire agentId so CLI permission requests route to agent monitor panel
        result.setAgentId(spawnResult.agentId);

        return spawnResult;
      }

      // Check if the requested CLI type is disabled by the user
      if (request.cli) {
        const disabledClis = getDisabledClis?.() ?? [];
        if (disabledClis.includes(request.cli)) {
          throw new Error(
            `CLI agent '${request.cli}' is disabled. ` +
              'Enable it in Agent Orchestration settings or use a different CLI. ' +
              'Use ptah_agent_list to see available agents.',
          );
        }
      }

      const [systemPrompt, pluginPaths] = await Promise.all([
        getSystemPrompt?.() ?? Promise.resolve(undefined),
        getPluginPaths?.() ?? Promise.resolve(undefined),
      ]);

      // Resolve workingDirectory at spawn time using the same lazy resolver
      // as the ptah-cli path. Without this, CLI agents (gemini, codex,
      // copilot) inherit the app install directory in VS Code/Electron
      // because AgentProcessManager.getWorkspaceRoot() returns '' when no
      // folder is provided.
      const workingDirectory = request.workingDirectory ?? getWorkspaceRoot();

      const enrichedRequest = {
        ...request,
        ...(workingDirectory && { workingDirectory }),
        ...(activeSessionId && { parentSessionId: activeSessionId }),
        ...(projectGuidance && { projectGuidance }),
        ...(systemPrompt && { systemPrompt }),
        ...(pluginPaths && pluginPaths.length > 0 && { pluginPaths }),
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
      // Merge CLI agents with Ptah CLI agents
      const cliResults = await cliDetectionService.detectAll();

      // Filter out disabled CLIs
      const disabledClis = getDisabledClis?.() ?? [];
      const enabledCliResults =
        disabledClis.length > 0
          ? cliResults.filter((c) => !disabledClis.includes(c.cli))
          : cliResults;

      const registry = getPtahCliRegistry?.();
      let merged: CliDetectionResult[];
      if (!registry) {
        merged = enabledCliResults;
      } else {
        try {
          const ptahCliAgents = await registry.listAgents();
          const ptahCliResults: CliDetectionResult[] = ptahCliAgents
            .filter((a) => a.enabled && a.hasApiKey)
            .map((a) => ({
              cli: 'ptah-cli' as const,
              installed: true,
              supportsSteer: false,
              ptahCliId: a.id,
              ptahCliName: a.name,
              providerName: a.providerName,
            }));

          merged = [...enabledCliResults, ...ptahCliResults];
        } catch {
          // If listing Ptah CLI agents fails, still return CLI agents
          merged = enabledCliResults;
        }
      }

      // Sort by preferred agent order and add preferredRank
      const preferredOrder = getPreferredAgentOrder?.() ?? [];
      if (preferredOrder.length > 0) {
        // Build a lookup: entry identifier -> 1-based rank
        const rankMap = new Map<string, number>();
        preferredOrder.forEach((entry, idx) => rankMap.set(entry, idx + 1));

        // Determine the identifier for a CLI result (ptahCliId for Ptah CLI agents, cli type for system CLIs)
        const getIdentifier = (r: CliDetectionResult): string =>
          r.cli === 'ptah-cli' && r.ptahCliId ? r.ptahCliId : r.cli;

        // Sort: preferred agents first (by rank), then unranked agents
        merged.sort((a, b) => {
          const rankA =
            rankMap.get(getIdentifier(a)) ?? Number.MAX_SAFE_INTEGER;
          const rankB =
            rankMap.get(getIdentifier(b)) ?? Number.MAX_SAFE_INTEGER;
          return rankA - rankB;
        });

        // Add preferredRank to each result
        return merged.map((r) => ({
          ...r,
          preferredRank: rankMap.get(getIdentifier(r)) ?? 0,
        }));
      }

      // No preferred order — return as-is with preferredRank: 0
      return merged.map((r) => ({ ...r, preferredRank: 0 }));
    },

    waitFor: async (agentId, options?) => {
      const pollInterval = options?.pollInterval ?? 2000;
      const timeout = Math.min(
        options?.timeout ?? MAX_WAIT_TIMEOUT,
        MAX_WAIT_TIMEOUT,
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
              agentId,
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
                  `waitFor timed out after ${timeout}ms for agent ${agentId}`,
                ),
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
