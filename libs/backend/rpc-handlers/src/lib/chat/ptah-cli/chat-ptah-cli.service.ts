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
import {
  CLI_AGENT_RUNTIME_TOKENS,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import { SDK_TOKENS, SdkAgentAdapter } from '@ptah-extension/agent-sdk';
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

interface PtahCliSessionEntry {
  readonly agentId: string;
  readonly agentName: string;
}

@injectable()
export class ChatPtahCliService {
  private readonly ptahCliSessions = new Map<string, PtahCliSessionEntry>();
  private readonly ptahCliSdkSessionIds = new Map<string, string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.LICENSE_SERVICE)
    private readonly licenseService: LicenseService,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly agentAdapter: SdkAgentAdapter,
    @inject(CHAT_TOKENS.PREMIUM_CONTEXT)
    private readonly premiumContext: ChatPremiumContextService,
  ) {}

  async handleStart(params: ChatStartParams): Promise<{
    result: ChatStartResult;
    stream?: AsyncIterable<unknown>;
    tabId?: string;
  }> {
    const { prompt, tabId, workspacePath, options, name } = params;
    const agentId = params.ptahCliId as string;

    this.logger.info('[RPC] chat:start - Ptah CLI dispatch', {
      tabId,
      ptahCliId: agentId,
      workspacePath,
    });

    const profile = await this.ptahCliRegistry.getProfile(agentId);
    if (!profile) {
      this.logger.error(`[RPC] Ptah CLI profile not found: ${agentId}`);
      return {
        result: {
          success: false,
          error: `Ptah CLI agent not found or not configured: ${agentId}`,
        },
      };
    }

    const summaries = await this.ptahCliRegistry.listAgents();
    const summary = summaries.find((s) => s.id === agentId);
    const agentName = summary?.name ?? agentId;

    const licenseStatus = await this.licenseService.verifyLicense();
    const isPremium = isPremiumTier(licenseStatus);
    const mcpServerRunning = this.premiumContext.isMcpServerRunning();

    this.logger.info('[RPC] chat:start - Ptah CLI premium config', {
      tabId,
      ptahCliId: agentId,
      isPremium,
      mcpServerRunning,
    });

    if (isPremium && mcpServerRunning) {
      this.codeExecutionMcp.ensureRegisteredForSubagents();
    }

    const enhancedPromptsContent =
      await this.premiumContext.resolveEnhancedPromptsContent(
        workspacePath,
        isPremium,
      );
    const pluginPaths = this.premiumContext.resolvePluginPaths(isPremium);

    const stream = await this.agentAdapter.startChatSession({
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
      providerProfile: profile,
    });

    this.ptahCliSessions.set(tabId, { agentId, agentName });

    this.logger.info('[RPC] chat:start - Ptah CLI session started', {
      tabId,
      ptahCliId: agentId,
      agentName,
    });

    return {
      result: { success: true },
      stream: stream as AsyncIterable<unknown>,
      tabId,
    };
  }

  async handleContinue(
    params: ChatContinueParams,
  ): Promise<ChatContinueResult> {
    const { prompt, sessionId, tabId } = params;
    const entry =
      this.ptahCliSessions.get(sessionId as string) ||
      this.ptahCliSessions.get(tabId);

    if (!entry) {
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:continue - Ptah CLI dispatch', {
      sessionId,
      tabId,
      ptahCliAgentId: entry.agentId,
    });

    if (this.premiumContext.isMcpServerRunning()) {
      const licenseCheck = await this.licenseService.verifyLicense();
      if (isPremiumTier(licenseCheck)) {
        this.codeExecutionMcp.ensureRegisteredForSubagents();
      }
    }

    if (!this.agentAdapter.isSessionActive(sessionId)) {
      this.logger.warn(
        `[RPC] Ptah CLI session not active for continue: ${entry.agentId}`,
        { sessionId },
      );
      return {
        success: false,
        error: `Ptah CLI session not active: ${entry.agentId}`,
      };
    }

    const files = params.files ?? [];
    await this.agentAdapter.sendMessageToSession(sessionId, prompt, { files });

    return { success: true, sessionId };
  }

  async handleAbort(params: ChatAbortParams): Promise<ChatAbortResult> {
    const { sessionId } = params;
    const entry = this.ptahCliSessions.get(sessionId as string);

    if (!entry) {
      return { success: false, error: '__NOT_PTAH_CLI__' };
    }

    this.logger.info('[RPC] chat:abort - Ptah CLI dispatch', {
      sessionId,
      ptahCliAgentId: entry.agentId,
    });

    this.agentAdapter.endSession(sessionId);

    this.ptahCliSessions.delete(sessionId as string);

    return { success: true };
  }

  getSdkSessionId(tabId: string): string | undefined {
    return this.ptahCliSdkSessionIds.get(tabId);
  }

  trackSession(tabId: string, realSessionId: string): void {
    const entry = this.ptahCliSessions.get(tabId);
    if (entry) {
      this.ptahCliSessions.set(realSessionId, entry);
      this.logger.debug('[RPC] Ptah CLI session ID tracked', {
        tabId,
        realSessionId,
        ptahCliAgentId: entry.agentId,
      });
    }
  }

  hasSession(key: string): boolean {
    return this.ptahCliSessions.has(key);
  }

  getAgentId(key: string): string | undefined {
    return this.ptahCliSessions.get(key)?.agentId;
  }

  setSdkSessionId(key: string, sdkSessionId: string): void {
    this.ptahCliSdkSessionIds.set(key, sdkSessionId);
  }

  deleteSession(key: string): void {
    this.ptahCliSessions.delete(key);
  }

  registerResumedSession(
    sessionId: string,
    ptahCliId: string,
    tabId: string | undefined,
  ): void {
    const entry: PtahCliSessionEntry = {
      agentId: ptahCliId,
      agentName: ptahCliId,
    };
    this.ptahCliSessions.set(sessionId, entry);
    if (tabId) {
      this.ptahCliSessions.set(tabId, entry);
    }
  }

  async hasSubagentTranscript(
    workspacePath: string,
    parentSessionId: string,
    agentId: string,
  ): Promise<boolean> {
    try {
      const homeDir = os.homedir();
      const projectsDir = path.join(homeDir, '.claude', 'projects');
      const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

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
