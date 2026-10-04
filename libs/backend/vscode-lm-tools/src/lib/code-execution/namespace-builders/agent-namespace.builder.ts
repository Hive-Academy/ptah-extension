/**
 * Agent Namespace Builder
 *
 * Async agent orchestration via CLI agents. Provides spawn, status, read,
 * message, report, stop, list, waitFor, waitForAgents methods for managing headless CLI
 * agents as background workers. Which agents exist is a runtime fact answered by `list`
 * (`SYSTEM_CLI_TYPES` for the shipped adapters, user config for Ptah CLI
 * providers) — this layer never names a vendor.
 *
 * Pattern: libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts
 */

import type { AgentNamespace } from '../types';
import { MAX_EFFORT_LENGTH } from '../mcp-core/agent-spawn-args.schema';
import {
  MAX_AGENT_WAIT_MS,
  PTAH_CLI_ROLE_DELIVERY,
  renderLaneCompletionContract,
  type AgentProcessManager,
  type AgentReportDelivery,
  type AgentReportInput,
  type CliDetectionService,
  type SdkHandle,
} from '@ptah-extension/cli-agent-runtime';
import type {
  AgentRoleDefinition,
  CliDetectionResult,
  SpawnAgentRequest,
} from '@ptah-extension/shared';

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
      workingDirectory?: string;
      resumeSessionId?: string;
      parentSessionId?: string;
      modelTier?: 'opus' | 'sonnet' | 'haiku';
      model?: string;
      /** Reserved agent id — rides the spawn's MCP URL as `/agent/{id}`. */
      agentId?: string;
      role?: AgentRoleDefinition;
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
  /**
   * Returns the capped project guidance from enhanced prompts (async). Called
   * at spawn time for system-CLI lanes, which receive this and never the full
   * generated system prompt (TASK_2026_597, R3.4). Ptah CLI lanes read their
   * guidance in the spawn-options service instead.
   */
  getProjectGuidance?: () => Promise<string | undefined>;
  /** Returns absolute paths to enabled plugin directories (async). */
  getPluginPaths?: () => Promise<string[] | undefined>;
  /** Lazy resolver for PtahCliRegistry (avoids hard dependency on agent-sdk) */
  getPtahCliRegistry?: () => PtahCliRegistryLike | undefined;
  /** Returns CLI types that are disabled by the user. Called at spawn/list time to filter out disabled agents. */
  getDisabledClis?: () => string[];
  /** Returns the user's preferred agent order for sorting list() results. */
  getPreferredAgentOrder?: () => string[];
  /** Resolves a tab ID to its real SDK session UUID. Used for MCP session threading. */
  resolveSessionId?: (tabIdOrSessionId: string) => string;
  /**
   * Deliver a child agent's or child session's report to the session that
   * started it (TASK_2026_402, Component 7; the `childSessionId` form is
   * TASK_2026_584). A structural FUNCTION rather than the
   * `AgentReportRouter` class, so this lib keeps depending on
   * `cli-agent-runtime`'s barrel for types only. `AgentReportDelivery` is
   * imported by name deliberately: the refusal reason is a closed union, and
   * widening it to `string` here would let a caller invent a reason no test
   * covers.
   *
   * Optional because a host that never registered `cli-agent-runtime`'s
   * container has no router to resolve. The resolver in
   * `ptah-api-builder.service.ts` supplies a function that throws a NAMED
   * error in that case — absent wiring must be a clear error, never a silent
   * no-op that reports a delivery nobody made.
   */
  deliverAgentReport?: (
    input: AgentReportInput,
  ) => Promise<AgentReportDelivery>;
  /**
   * Resolve a workspace role name to its definition. Throws `AgentRoleError`
   * for every resolution failure; a spawn never proceeds without the role it
   * asked for.
   */
  resolveAgentRole?: (
    workspaceRoot: string,
    role: string,
  ) => Promise<AgentRoleDefinition>;
  /** List the role names defined for a workspace. */
  listAgentRoles?: (workspaceRoot: string) => Promise<string[]>;
  /** Receives the one-line WARN for a spawn field this layer drops or a lane ignores. */
  logger: {
    warn(message: string, metadata?: Record<string, unknown>): void;
  };
}

/**
 * `execute_code` callers are untyped JavaScript, so a spawn request can carry
 * keys `SpawnAgentRequest` no longer has. `systemPrompt` is the one that
 * matters: system-CLI lanes stopped receiving a generated system prompt
 * (TASK_2026_597, R3.4), and a caller-supplied one is dropped here.
 */
type UntypedSpawnRequest = SpawnAgentRequest & {
  readonly systemPrompt?: unknown;
};

/**
 * `effort` at the `execute_code` boundary: the same string, 1..32 rule the
 * MCP spawn schema applies (`agent-spawn-args.schema.ts`), so the `Lane
 * policy` log line that echoes an ignored effort stays bounded. The value
 * itself is never echoed: it may be anything.
 */
function assertEffort(effort: unknown): void {
  if (effort === undefined) return;
  if (
    typeof effort !== 'string' ||
    effort.length < 1 ||
    effort.length > MAX_EFFORT_LENGTH
  ) {
    const got =
      typeof effort === 'string'
        ? `a ${effort.length}-char string`
        : typeof effort;
    throw new Error(
      `ptah.agent.spawn: "effort" must be a string of 1 to ${MAX_EFFORT_LENGTH} ` +
        `characters (got ${got}). The agent was not spawned.`,
    );
  }
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
    getPluginPaths,
    getPtahCliRegistry,
    getDisabledClis,
    getPreferredAgentOrder,
    resolveSessionId,
    deliverAgentReport,
    resolveAgentRole,
    listAgentRoles,
    logger,
  } = deps;

  return {
    spawn: async (request: UntypedSpawnRequest) => {
      assertEffort(request.effort);
      if (request.systemPrompt !== undefined) {
        logger.warn(
          'ptah.agent.spawn: "systemPrompt" is not a spawn field and was dropped; ' +
            'lanes receive the capped project guidance instead.',
        );
      }

      // An empty parentSessionId is absent, not supplied. `??` alone kept it,
      // which BOTH suppressed the active-session fallback AND was then
      // discarded by the truthiness check below — so the spawn was attributed
      // to no parent at all.
      const requestedSessionId = request.parentSessionId
        ? request.parentSessionId
        : undefined;
      const rawSessionId = requestedSessionId ?? getActiveSessionId?.();
      const activeSessionId = rawSessionId
        ? (resolveSessionId?.(rawSessionId) ?? rawSessionId)
        : undefined;
      let roleDefinition: AgentRoleDefinition | undefined;
      if (request.role !== undefined) {
        if (!resolveAgentRole) {
          throw new Error(
            'Agent roles are unavailable: no role resolver is wired into this ' +
              'host, so the agent was not spawned. Register the CLI agent ' +
              'runtime container before building the Ptah API, or spawn ' +
              'without "role".',
          );
        }
        roleDefinition = await resolveAgentRole(
          getWorkspaceRoot(),
          request.role,
        );
      }
      if (request.ptahCliId) {
        const registry = getPtahCliRegistry?.();
        if (!registry) {
          throw new Error(
            'Ptah CLI registry not available. Ptah CLI agents require the Agent SDK.',
          );
        }
        const workingDirectory = request.workingDirectory ?? getWorkspaceRoot();

        // The registry's spawn options have no effort field: a Ptah CLI lane
        // runs at its provider's default. Said once, rather than dropped
        // without notice (PR1-M1).
        if (request.effort !== undefined) {
          logger.warn(
            'ptah.agent.spawn: Ptah CLI lanes do not take "effort"; it is ignored for this lane.',
            { ptahCliId: request.ptahCliId, effort: request.effort },
          );
        }

        // ONE id, minted once, before the handle exists (TASK_2026_402).
        // `spawnFromSdkHandle` would otherwise mint it AFTER the handle — and
        // therefore after the MCP URL baked into that handle — so the URL could
        // never name the record. Reserving here and passing the same value to
        // both is what lets the child's `/agent/{id}` segment be true.
        const agentId = agentProcessManager.reserveAgentId();

        // A Ptah CLI lane's task string goes to the SDK verbatim and never
        // passes through `buildTaskPrompt`, so the completion contract is
        // rendered here from the SAME function the rival-CLI adapters use
        // (TASK_2026_515). Two call sites, one text.
        const ptahCliTask =
          `${request.task}\n\n` +
          renderLaneCompletionContract({
            taskFolder: request.taskFolder,
            deliverables: request.deliverables,
          });

        const result = await registry.spawnAgent(
          request.ptahCliId,
          ptahCliTask,
          {
            workingDirectory,
            resumeSessionId: request.resumeSessionId,
            parentSessionId: activeSessionId,
            modelTier: request.modelTier,
            model: request.model,
            agentId,
            role: roleDefinition,
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
            // The RECORD keeps the task the caller gave, not the prompt the
            // lane was handed: the tile, the persisted session reference and
            // the completion signal's headline all read this field, and the
            // appended contract is plumbing rather than the task.
            task: request.task,
            cli: 'ptah-cli',
            workingDirectory,
            taskFolder: request.taskFolder,
            deliverables: request.deliverables,
            parentSessionId: activeSessionId,
            ptahCliName: result.agentName,
            ptahCliId: request.ptahCliId,
            timeout: request.timeout,
            resumeSessionId: request.resumeSessionId,
            agentId,
            ...(roleDefinition
              ? {
                  roleStamp: {
                    role: roleDefinition.name,
                    ...PTAH_CLI_ROLE_DELIVERY,
                  },
                }
              : {}),
          },
        );
        result.setAgentId(spawnResult.agentId);

        return spawnResult;
      }
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

      // System-CLI lanes get the capped project guidance only. The full
      // generated system prompt is never fetched for them: `buildTaskPrompt`
      // preferred it over the guidance, which bypassed the guidance cap on
      // every lane (TASK_2026_597, R3.4).
      const [projectGuidance, pluginPaths] = await Promise.all([
        getProjectGuidance?.() ?? Promise.resolve(undefined),
        getPluginPaths?.() ?? Promise.resolve(undefined),
      ]);
      const workingDirectory = request.workingDirectory ?? getWorkspaceRoot();

      // Drop the raw parentSessionId before spreading: `...request` would
      // otherwise carry an unusable '' straight through, since the conditional
      // spread below only overwrites when a resolved id exists. A
      // caller-supplied roleDefinition is dropped too: only the resolver may
      // produce one. So is a caller-supplied systemPrompt (warned above).
      const {
        parentSessionId: _rawParentSessionId,
        roleDefinition: _callerRoleDefinition,
        systemPrompt: _callerSystemPrompt,
        ...requestFields
      } = request;

      const enrichedRequest = {
        ...requestFields,
        ...(workingDirectory && { workingDirectory }),
        ...(activeSessionId && { parentSessionId: activeSessionId }),
        ...(roleDefinition && { roleDefinition }),
        ...(projectGuidance && { projectGuidance }),
        ...(pluginPaths && pluginPaths.length > 0 && { pluginPaths }),
      };
      return agentProcessManager.spawn(enrichedRequest);
    },

    status: async (agentId?) => {
      return agentProcessManager.getStatus(agentId);
    },

    read: async (agentId, tail?, offset?) => {
      return agentProcessManager.readOutput(agentId, tail, offset);
    },

    message: async (agentId, message) => {
      // The outcome is RETURNED, not swallowed: `unsupported` means nothing
      // was delivered and `interrupt-resume` means a turn's partial work was
      // discarded. A `void` return would have made both look like a success.
      return agentProcessManager.sendToAgent(agentId, message);
    },

    report: async (input) => {
      if (!deliverAgentReport) {
        // Absent wiring is a clear error, never a silent no-op — the same rule
        // `harness-namespace.builder.ts` follows for its optional
        // collaborators. A `delivered: false` here would be indistinguishable
        // from a refusal the agent could act on.
        throw new Error(
          'Agent reporting is unavailable: no report router is wired into this ' +
            'host. Register the CLI agent runtime container before building the ' +
            'Ptah API.',
        );
      }
      return deliverAgentReport(input);
    },

    stop: async (agentId) => {
      return agentProcessManager.stop(agentId);
    },

    list: async () => {
      const cliResults = await cliDetectionService.detectAll();
      const disabledClis = getDisabledClis?.() ?? [];
      // Disabled CLIs are MARKED, not dropped. `spawn` rejects an explicit
      // `cli` that is disabled, so omitting them here left the caller
      // discovering the restriction only by failing a spawn.
      const enabledCliResults: CliDetectionResult[] =
        disabledClis.length > 0
          ? cliResults.map((c) =>
              disabledClis.includes(c.cli) ? { ...c, disabled: true } : c,
            )
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
              messagingMode: 'queue',
              ptahCliId: a.id,
              ptahCliName: a.name,
              providerName: a.providerName,
              ...PTAH_CLI_ROLE_DELIVERY,
            }));

          merged = [...enabledCliResults, ...ptahCliResults];
        } catch {
          merged = enabledCliResults;
        }
      }
      const preferredOrder = getPreferredAgentOrder?.() ?? [];
      if (preferredOrder.length > 0) {
        const rankMap = new Map<string, number>();
        preferredOrder.forEach((entry, idx) => rankMap.set(entry, idx + 1));
        const getIdentifier = (r: CliDetectionResult): string =>
          r.cli === 'ptah-cli' && r.ptahCliId ? r.ptahCliId : r.cli;
        merged.sort((a, b) => {
          const rankA =
            rankMap.get(getIdentifier(a)) ?? Number.MAX_SAFE_INTEGER;
          const rankB =
            rankMap.get(getIdentifier(b)) ?? Number.MAX_SAFE_INTEGER;
          return rankA - rankB;
        });
        return merged.map((r) => ({
          ...r,
          preferredRank: rankMap.get(getIdentifier(r)) ?? 0,
        }));
      }
      return merged.map((r) => ({ ...r, preferredRank: 0 }));
    },

    listRoles: async () => {
      return listAgentRoles ? listAgentRoles(getWorkspaceRoot()) : [];
    },

    // One event-driven wait (TASK_2026_597, D13): it settles on the lane's
    // `agent:exited` event, with no polling loop behind it.
    waitFor: async (agentId, options?) => {
      const timeoutMs = Math.min(
        options?.timeout ?? MAX_AGENT_WAIT_MS,
        MAX_AGENT_WAIT_MS,
      );
      const result = await agentProcessManager.waitForAgents(
        [agentId],
        'all',
        timeoutMs,
      );
      const entry = result.entries[0];
      if (entry?.state === 'exited') {
        return entry.info;
      }
      if (entry?.state === 'running') {
        throw new Error(
          `waitFor timed out after ${timeoutMs}ms for agent ${agentId}: it is ` +
            'still running. Call waitFor again to keep waiting.',
        );
      }
      // `not_found` or `other_workspace`: `getStatus` throws the established
      // message for each (the `Agent not found: <id>` prefix callers match
      // on, or the "exists but belongs to another workspace" one). The throw
      // below is reached only if the record appeared in between.
      agentProcessManager.getStatus(agentId);
      throw new Error(`Agent not found: ${agentId}`);
    },

    waitForAgents: async (agentIds, mode, timeoutMs) =>
      agentProcessManager.waitForAgents(agentIds, mode, timeoutMs),
  };
}
