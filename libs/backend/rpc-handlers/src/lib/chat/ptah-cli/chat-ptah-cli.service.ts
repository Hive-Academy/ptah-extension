/**
 * Chat Ptah-CLI dispatch + tracking service.
 *
 * Owns the Ptah CLI adapter routing for chat:start / chat:continue /
 * chat:abort plus the two private maps that previously lived on
 * `ChatRpcHandlers`:
 *
 *   - `ptahCliSessions`: sessionId|tabId → ptahCliId for dispatch.
 *   - `ptahCliSdkSessionIds`: tabId|agentId → real SDK session UUID.
 *
 * Also owns the on-disk subagent transcript probe (the only fs/path/os
 * consumer in chat-rpc), invoked from `ChatSessionService.continueSession`
 * to gate subagent context injection.
 *
 * Body extracted byte-identically from `chat-rpc.handlers.ts`. The
 * `streamEventsToWebview` path in `ChatStreamBroadcaster` mutates the
 * maps via the small accessor surface (`hasSession`, `getAgentId`,
 * `setSdkSessionId`, `deleteSession`) — the maps stay encapsulated here.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  LicenseService,
  isPremiumTier,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, PtahCliRegistry } from '@ptah-extension/agent-sdk';
import { CodeExecutionMCP } from '@ptah-extension/vscode-lm-tools';
import type {
  ChatStartParams,
  ChatStartResult,
  ChatContinueParams,
  ChatContinueResult,
  ChatAbortParams,
  ChatAbortResult,
} from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatPremiumContextService } from '../session/chat-premium-context.service';

@injectable()
export class ChatPtahCliService {
  /**
   * Track which sessions are owned by Ptah CLI adapters.
   * Maps sessionId (or tabId used as sessionId) -> ptahCliId.
   * Used by chat:continue and chat:abort to delegate to the correct adapter.
   */
  private readonly ptahCliSessions = new Map<string, string>();

  /**
   * Maps tabId -> real SDK session UUID for Ptah CLI sessions.
   * Populated in streamExecutionNodesToWebview when the SDK UUID is resolved.
   * Used to set sdkSessionId on CliSessionReference for cross-referencing
   * in SessionImporterService.
   */
  private readonly ptahCliSdkSessionIds = new Map<string, string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(SDK_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(CHAT_TOKENS.PREMIUM_CONTEXT)
    private readonly premiumContext: ChatPremiumContextService,
  ) {}

  // ============================================================================
  // PTAH CLI DISPATCH METHODS
  // ============================================================================

  /**
   * Handle chat:start for Ptah CLI sessions.
   *
   * Gets the adapter from PtahCliRegistry, starts a chat session.
   * Stream broadcasting is performed by the caller using ChatStreamBroadcaster.
   * Returns the resulting stream so the caller can hand it to the broadcaster.
   */
  async handleStart(params: ChatStartParams): Promise<{
    result: ChatStartResult;
    stream?: AsyncIterable<unknown>;
    tabId?: string;
  }> {
    const { prompt, tabId, workspacePath, options, name } = params;
    const agentId = params.ptahCliId as string; // Guaranteed non-null by caller

    this.logger.info('[RPC] chat:start - Ptah CLI dispatch', {
      tabId,
      ptahCliId: agentId,
      workspacePath,
    });

    // Get the adapter from the registry
    const adapter = await this.ptahCliRegistry.getAdapter(agentId);
    if (!adapter) {
      this.logger.error(`[RPC] Ptah CLI adapter not found: ${agentId}`);
      return {
        result: {
          success: false,
          error: `Ptah CLI agent not found or not configured: ${agentId}`,
        },
      };
    }

    // Resolve premium capabilities (same as main SDK adapter path)
    const licenseStatus = await this.licenseService.verifyLicense();
    const isPremium = isPremiumTier(licenseStatus);
    const mcpServerRunning = this.premiumContext.isMcpServerRunning();

    this.logger.info('[RPC] chat:start - Ptah CLI premium config', {
      tabId,
      ptahCliId: agentId,
      isPremium,
      mcpServerRunning,
    });

    // Register MCP server for subagent discovery (premium only)
    if (isPremium && mcpServerRunning) {
      this.codeExecutionMcp.ensureRegisteredForSubagents();
    }

    // Resolve enhanced prompts and plugins for premium users
    const enhancedPromptsContent =
      await this.premiumContext.resolveEnhancedPromptsContent(
        workspacePath,
        isPremium,
      );
    const pluginPaths = this.premiumContext.resolvePluginPaths(isPremium);

    // Start the Ptah CLI session with full premium capabilities
    // NOTE: Don't pass options.model here — it comes from the main Claude model
    // selector (e.g. "claude-sonnet-4-5-20250929") which is irrelevant for custom
    // agents. The adapter's resolveModel() will use its own config:
    // selectedModel → tierMappings → provider defaults.
    const stream = await adapter.startChatSession({
      tabId,
      workspaceId: workspacePath,
      systemPrompt: options?.systemPrompt,
      projectPath: workspacePath,
      name,
      prompt,
      files: options?.files,
      isPremium,
      mcpServerRunning,
      enhancedPromptsContent,
      pluginPaths,
      thinking: options?.thinking, // Reasoning configuration
      effort: options?.effort, // Effort level
    });

    // Track this session as belonging to the Ptah CLI agent
    // Use tabId as the initial session key (real sessionId comes later via stream events)
    this.ptahCliSessions.set(tabId, agentId);

    this.logger.info('[RPC] chat:start - Ptah CLI session started', {
      tabId,
      ptahCliId: agentId,
      agentName: adapter.info.name,
    });

    return {
      result: { success: true },
      stream: stream as AsyncIterable<unknown>,
      tabId,
    };
  }

  /**
   * Handle chat:continue for Ptah CLI sessions.
   *
   * Checks if the session belongs to a Ptah CLI agent and delegates
   * message sending to the correct adapter.
   */
  async handleContinue(
    params: ChatContinueParams,
  ): Promise<ChatContinueResult> {
    const { prompt, sessionId, tabId } = params;
    const ptahCliAgentId =
      this.ptahCliSessions.get(sessionId as string) ||
      this.ptahCliSessions.get(tabId);

    if (!ptahCliAgentId) {
      // Not a Ptah CLI session - caller should fall through to main adapter
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:continue - Ptah CLI dispatch', {
      sessionId,
      tabId,
      ptahCliAgentId,
    });

    const adapter = await this.ptahCliRegistry.getAdapter(ptahCliAgentId);
    if (!adapter) {
      this.logger.error(
        `[RPC] Ptah CLI adapter not found for continue: ${ptahCliAgentId}`,
      );
      return {
        success: false,
        error: `Ptah CLI agent not found: ${ptahCliAgentId}`,
      };
    }

    // Ensure MCP server is registered for subagent discovery (premium only)
    if (this.premiumContext.isMcpServerRunning()) {
      const licenseCheck = await this.licenseService.verifyLicense();
      if (isPremiumTier(licenseCheck)) {
        this.codeExecutionMcp.ensureRegisteredForSubagents();
      }
    }

    // Check if the session needs to be resumed first
    const health = adapter.getHealth();
    if (health.status !== 'available') {
      this.logger.warn(
        `[RPC] Ptah CLI adapter not available for continue: ${ptahCliAgentId}`,
        { status: health.status },
      );
      return {
        success: false,
        error: `Ptah CLI agent not available: ${
          health.errorMessage || health.status
        }`,
      };
    }

    // Send message to the existing session
    const files = params.files ?? [];
    await adapter.sendMessageToSession(sessionId, prompt, { files });

    return { success: true, sessionId };
  }

  /**
   * Handle chat:abort for Ptah CLI sessions.
   */
  async handleAbort(params: ChatAbortParams): Promise<ChatAbortResult> {
    const { sessionId } = params;
    const ptahCliAgentId = this.ptahCliSessions.get(sessionId as string);

    if (!ptahCliAgentId) {
      // Not a Ptah CLI session
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:abort - Ptah CLI dispatch', {
      sessionId,
      ptahCliAgentId,
    });

    const adapter = await this.ptahCliRegistry.getAdapter(ptahCliAgentId);
    if (adapter) {
      adapter.endSession(sessionId);
    }

    // Clean up tracking
    this.ptahCliSessions.delete(sessionId as string);

    return { success: true };
  }

  /**
   * Get the resolved SDK session UUID for a Ptah CLI session.
   * Used by persistCliSessionReference to set sdkSessionId on CliSessionReference.
   */
  getSdkSessionId(tabId: string): string | undefined {
    return this.ptahCliSdkSessionIds.get(tabId);
  }

  /**
   * Track a Ptah CLI session by its real session ID.
   * Called when SESSION_ID_RESOLVED is received for a Ptah CLI session.
   */
  trackSession(tabId: string, realSessionId: string): void {
    const ptahCliAgentId = this.ptahCliSessions.get(tabId);
    if (ptahCliAgentId) {
      // Also map the real session ID to the Ptah CLI agent
      this.ptahCliSessions.set(realSessionId, ptahCliAgentId);
      this.logger.debug('[RPC] Ptah CLI session ID tracked', {
        tabId,
        realSessionId,
        ptahCliAgentId,
      });
    }
  }

  // ============================================================================
  // MAP PROBES — used by ChatStreamBroadcaster + ChatSessionService
  // ============================================================================

  /** Whether a session/tab is currently mapped to a Ptah CLI agent. */
  hasSession(key: string): boolean {
    return this.ptahCliSessions.has(key);
  }

  /** Resolve the Ptah CLI agent ID for a session/tab key, if any. */
  getAgentId(key: string): string | undefined {
    return this.ptahCliSessions.get(key);
  }

  /** Record the resolved SDK UUID for a tab/agent key. */
  setSdkSessionId(key: string, sdkSessionId: string): void {
    this.ptahCliSdkSessionIds.set(key, sdkSessionId);
  }

  /** Drop a session-key → agent mapping (called from stream finally block). */
  deleteSession(key: string): void {
    this.ptahCliSessions.delete(key);
  }

  /**
   * Track a session that is being resumed via chat:resume into the Ptah CLI
   * map so subsequent chat:continue / chat:abort dispatches route correctly.
   */
  registerResumedSession(
    sessionId: string,
    ptahCliId: string,
    tabId: string | undefined,
  ): void {
    this.ptahCliSessions.set(sessionId, ptahCliId);
    if (tabId) {
      this.ptahCliSessions.set(tabId, ptahCliId);
    }
  }

  /**
   * Check if a subagent's transcript file exists on disk.
   * Without a transcript, the SDK cannot resume the subagent.
   *
   * Looks in: {projectDir}/{parentSessionId}/subagents/agent-{agentId}.jsonl
   */
  async hasSubagentTranscript(
    workspacePath: string,
    parentSessionId: string,
    agentId: string,
  ): Promise<boolean> {
    try {
      const homeDir = os.homedir();
      const projectsDir = path.join(homeDir, '.claude', 'projects');
      const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

      // Try exact match, lowercase match, and normalized match for project dir.
      // Claude CLI may normalize path separators differently (e.g., replacing _ with -)
      // so "d--projects-brand_force" should match "d--projects-brand-force" on disk.
      // Must match the same logic as JsonlReaderService.findSessionsDirectory().
      const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
      const dirs = await fs.readdir(projectsDir);
      const projectDir =
        dirs.find((d) => d === escapedPath) ??
        dirs.find((d) => d.toLowerCase() === escapedPath.toLowerCase()) ??
        dirs.find((d) => normalize(d) === normalize(escapedPath));

      if (!projectDir) return false;

      const transcriptPath = path.join(
        projectsDir,
        projectDir,
        parentSessionId,
        'subagents',
        `agent-${agentId}.jsonl`,
      );

      await fs.access(transcriptPath);
      return true;
    } catch {
      return false;
    }
  }
}
