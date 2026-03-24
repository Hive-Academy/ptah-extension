import { injectable, inject } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  AgentDiscoveryService,
  AgentSearchRequest,
} from '@ptah-extension/workspace-intelligence';

/**
 * Agent setup status information
 */
export interface SetupStatus {
  readonly isConfigured: boolean; // True if any agents exist
  readonly agentCount: number; // Total project + user agents
  readonly lastModified: string | null; // ISO 8601 timestamp of last .claude/agents/ modification
  readonly projectAgents: string[]; // Agent names from .claude/agents/
  readonly userAgents: string[]; // Agent names from ~/.claude/agents/
}

/**
 * Cached status entry
 */
interface CachedStatus {
  status: SetupStatus;
  timestamp: number;
}

/**
 * SetupStatusService - Agent configuration status detection
 *
 * RESPONSIBILITIES:
 * - Detect agent existence via AgentDiscoveryService
 * - Count total agents (project + user scope)
 * - Return last modified timestamp of .claude/agents/ directory
 * - Cache status for 5 seconds to reduce file system calls
 * - Handle missing workspace gracefully
 *
 * ARCHITECTURE:
 * - Uses AgentDiscoveryService for agent discovery (workspace-intelligence library)
 * - Returns Result<T, Error> pattern for all public methods
 * - Implements 5-second TTL cache to avoid excessive file system checks
 * - Distinguishes between project scope and user scope agents
 *
 * @see libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts for agent discovery
 * @see implementation-plan.md:94-173 for complete specifications
 */
@injectable()
export class SetupStatusService {
  /**
   * Cache duration in milliseconds (5 seconds)
   */
  private readonly CACHE_TTL_MS = 5000;

  /**
   * Cached status with timestamp
   */
  private cachedStatus: CachedStatus | null = null;

  /**
   * Last workspace URI checked (cache invalidation on workspace change)
   */
  private lastWorkspaceUri: string | null = null;

  constructor(
    @inject(TOKENS.AGENT_DISCOVERY_SERVICE)
    private readonly agentDiscovery: AgentDiscoveryService,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger
  ) {
    this.logger.debug('SetupStatusService initialized');
  }

  /**
   * Get current agent setup status for workspace
   *
   * IMPLEMENTATION:
   * 1. Validate workspace exists
   * 2. Check cache validity (5 second TTL)
   * 3. Use AgentDiscoveryService.searchAgents() to discover agents
   * 4. Group agents by scope (project vs user)
   * 5. Get last modified timestamp of .claude/agents/ directory
   * 6. Cache result with timestamp
   *
   * @param workspacePath - Workspace root path
   * @returns Result with SetupStatus or Error
   */
  async getStatus(workspacePath: string): Promise<Result<SetupStatus, Error>> {
    try {
      // Check cache validity
      if (this.isCacheValid(workspacePath)) {
        this.logger.debug('Returning cached setup status');
        return Result.ok(this.cachedStatus!.status);
      }

      this.logger.debug(`Fetching fresh setup status for ${workspacePath}`);

      // Discover all agents using AgentDiscoveryService
      const discoveryResult = await this.agentDiscovery.searchAgents({
        query: '',
        maxResults: 1000,
      } as AgentSearchRequest);

      if (!discoveryResult.success || !discoveryResult.agents) {
        const errorMessage =
          discoveryResult.error || 'Failed to discover agents';
        this.logger.error(`Agent discovery failed: ${errorMessage}`);
        return Result.err(new Error(errorMessage));
      }

      // Filter to only user-created agents using whitelist approach (excludes builtin/system/undefined)
      const agents = discoveryResult.agents.filter(
        (agent) =>
          (agent.scope === 'project' || agent.scope === 'user') &&
          agent.name?.trim()
      );

      const projectAgents = agents
        .filter((agent) => agent.scope === 'project')
        .map((agent) => agent.name);

      const userAgents = agents
        .filter((agent) => agent.scope === 'user')
        .map((agent) => agent.name);

      const agentCount = projectAgents.length + userAgents.length;
      const isConfigured = agentCount > 0;

      // Get last modified timestamp of .claude/agents/ directory
      const lastModified = await this.getLastModifiedDate(workspacePath);

      const status: SetupStatus = {
        isConfigured,
        agentCount,
        lastModified: lastModified ? lastModified.toISOString() : null,
        projectAgents,
        userAgents,
      };

      // Update cache
      this.cachedStatus = {
        status,
        timestamp: Date.now(),
      };
      this.lastWorkspaceUri = workspacePath;

      this.logger.debug(
        `Setup status: ${agentCount} agents (${projectAgents.length} project, ${userAgents.length} user)`
      );

      return Result.ok(status);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get setup status: ${errorMessage}`);
      return Result.err(
        new Error(`Failed to get agent setup status: ${errorMessage}`)
      );
    }
  }

  /**
   * Check if cached status is still valid
   *
   * Cache is invalid if:
   * - No cache exists
   * - Workspace URI changed
   * - Cache TTL expired (5 seconds)
   *
   * @param workspacePath - Current workspace path
   * @returns True if cache is valid
   */
  private isCacheValid(workspacePath: string): boolean {
    if (!this.cachedStatus) {
      return false;
    }

    if (this.lastWorkspaceUri !== workspacePath) {
      this.logger.debug('Cache invalidated: workspace changed');
      return false;
    }

    const age = Date.now() - this.cachedStatus.timestamp;
    if (age > this.CACHE_TTL_MS) {
      this.logger.debug(`Cache invalidated: TTL expired (${age}ms)`);
      return false;
    }

    return true;
  }

  /**
   * Get last modified date of .claude/agents/ directory
   *
   * Returns null if directory doesn't exist or cannot be accessed.
   *
   * @param workspacePath - Workspace root path
   * @returns Last modified Date or null
   */
  private async getLastModifiedDate(
    workspacePath: string
  ): Promise<Date | null> {
    try {
      const agentsDir = path.join(workspacePath, '.claude', 'agents');
      const stats = await fs.stat(agentsDir);
      return stats.mtime;
    } catch (error) {
      // Directory doesn't exist or not accessible
      this.logger.debug(
        `.claude/agents/ directory not found or not accessible`
      );
      return null;
    }
  }

  /**
   * Invalidate cached status
   *
   * Useful for testing or when external changes are known.
   */
  invalidateCache(): void {
    this.logger.debug('Cache invalidated manually');
    this.cachedStatus = null;
    this.lastWorkspaceUri = null;
  }
}
