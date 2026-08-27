import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
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
import type { ChatSdkContextService } from '../session/chat-sdk-context.service';

interface PtahCliSessionEntry {
  readonly agentId: string;
  readonly agentName: string;
  /**
   * Key of this session's proxy lease in `PtahCliRegistry`. The entry object
   * is shared between the `tabId` and `realSessionId` map keys, so whichever
   * key an abort or delete arrives under, it releases the same lease
   * (TASK_2026_323 — a third session on one agent must not stop the proxy
   * sessions 1 and 2 are still using).
   */
  readonly leaseKey: string;
}

/**
 * Outcome of a subagent-transcript probe.
 *
 * `'indeterminate'` exists so callers can tell "the transcript is not on disk"
 * apart from "we could not look" — the two have opposite consequences for a
 * resumable registry record.
 */
export type SubagentTranscriptProbe = 'present' | 'absent' | 'indeterminate';

/**
 * Whether a value can be used as a single path segment.
 *
 * Rejects the empty string (which `path.join` silently swallows) and anything
 * carrying a separator or `..`, which would escape the intended directory.
 */
function isUsablePathSegment(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..'
  );
}

@injectable()
export class ChatPtahCliService {
  private readonly ptahCliSessions = new Map<string, PtahCliSessionEntry>();
  private readonly ptahCliSdkSessionIds = new Map<string, string>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.CODE_EXECUTION_MCP)
    private readonly codeExecutionMcp: CodeExecutionMCP,
    @inject(CLI_AGENT_RUNTIME_TOKENS.SDK_PTAH_CLI_REGISTRY)
    private readonly ptahCliRegistry: PtahCliRegistry,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly agentAdapter: SdkAgentAdapter,
    @inject(CHAT_TOKENS.SDK_CONTEXT)
    private readonly sdkContext: ChatSdkContextService,
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

    const leaseKey = tabId;
    const profile = await this.ptahCliRegistry.getProfile(agentId, leaseKey);
    if (!profile) {
      this.logger.error(`[RPC] Ptah CLI profile not found: ${agentId}`);
      return {
        result: {
          success: false,
          error: `Ptah CLI agent not found or not configured: ${agentId}`,
        },
      };
    }

    // Everything from here to the session entry runs under the lease taken by
    // `getProfile` above, and the lease is only ever given back from a session
    // entry (`handleAbort` / `deleteSession` read `entry.leaseKey`). So a throw
    // in between — `ensureRegisteredForSubagents` failing to write `.mcp.json`,
    // or the spawn itself — used to strand the reference forever: the proxy's
    // refCount never returned to zero, its listening socket stayed up for the
    // life of the host, and the next attempt on the same agent took a second
    // one. Release on the failure path, then rethrow untouched (TASK_2026_326).
    //
    // The guard starts at the FIRST fallible call after the lease, not at the
    // spawn. `listAgents()` reads the registry over the same transport the
    // proxy uses, so it is exactly as able to reject as the start it precedes,
    // and leaving it outside left the identical leak for that one caller.
    let stream: AsyncIterable<unknown>;
    let agentName = agentId;
    try {
      const summaries = await this.ptahCliRegistry.listAgents();
      const summary = summaries.find((s) => s.id === agentId);
      agentName = summary?.name ?? agentId;

      const mcpServerRunning = this.sdkContext.isMcpServerRunning();

      this.logger.info('[RPC] chat:start - Ptah CLI sdk config', {
        tabId,
        ptahCliId: agentId,
        mcpServerRunning,
      });

      if (mcpServerRunning) {
        // Awaited: the CLI spawned below reads `.mcp.json` to discover this
        // server, so the entry has to be on disk first (TASK_2026_318).
        await this.codeExecutionMcp.ensureRegisteredForSubagents();
      }

      const enhancedPromptsContent =
        await this.sdkContext.resolveEnhancedPromptsContent(workspacePath);

      stream = (await this.agentAdapter.startChatSession({
        tabId,
        workspaceId: workspacePath,
        systemPrompt: options?.systemPrompt,
        projectPath: workspacePath,
        name,
        prompt,
        files: options?.files,
        mcpServerRunning,
        enhancedPromptsContent,
        providerProfile: profile,
      })) as AsyncIterable<unknown>;
    } catch (error: unknown) {
      await this.releaseLeaseAfterFailedStart(leaseKey, error);
      throw error;
    }

    this.ptahCliSessions.set(tabId, { agentId, agentName, leaseKey });

    this.logger.info('[RPC] chat:start - Ptah CLI session started', {
      tabId,
      ptahCliId: agentId,
      agentName,
    });

    return {
      result: { success: true },
      stream,
      tabId,
    };
  }

  /**
   * Give back the lease taken for a start that never produced a session.
   *
   * Awaited but never allowed to throw: the caller is about to rethrow the
   * REAL failure, and a release problem replacing "the CLI would not spawn"
   * with "could not stop a proxy" would hide the thing the user needs to see.
   */
  private async releaseLeaseAfterFailedStart(
    leaseKey: string,
    cause: unknown,
  ): Promise<void> {
    try {
      await this.ptahCliRegistry.releaseProfile(leaseKey);
    } catch (releaseError: unknown) {
      this.logger.warn(
        '[RPC] Ptah CLI proxy lease release failed after a failed start',
        {
          leaseKey,
          cause: cause instanceof Error ? cause.message : String(cause),
          error:
            releaseError instanceof Error
              ? releaseError.message
              : String(releaseError),
        },
      );
    }
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

    if (this.sdkContext.isMcpServerRunning()) {
      await this.codeExecutionMcp.ensureRegisteredForSubagents();
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
    await this.ptahCliRegistry.releaseProfile(entry.leaseKey);

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
    const entry = this.ptahCliSessions.get(key);
    this.ptahCliSessions.delete(key);
    if (entry) {
      // Fire-and-forget: callers are synchronous, and `releaseProfile` is a
      // no-op on an unknown key, so a double release (abort then delete) is
      // harmless.
      void this.ptahCliRegistry
        .releaseProfile(entry.leaseKey)
        .catch((error: unknown) => {
          this.logger.warn('[RPC] Ptah CLI proxy lease release failed', {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  registerResumedSession(
    sessionId: string,
    ptahCliId: string,
    tabId: string | undefined,
  ): void {
    const entry: PtahCliSessionEntry = {
      agentId: ptahCliId,
      agentName: ptahCliId,
      leaseKey: tabId ?? sessionId,
    };
    this.ptahCliSessions.set(sessionId, entry);
    if (tabId) {
      this.ptahCliSessions.set(tabId, entry);
    }
  }

  /**
   * Probe whether a subagent transcript exists on disk.
   *
   * `'absent'` is a load-bearing answer: the only caller
   * ({@link ChatSubagentContextInjectorService}) permanently retires the
   * registry record when it hears it. So every case where we simply could not
   * look must answer `'indeterminate'` instead — an empty or separator-bearing
   * id segment, an unresolvable project directory, or an I/O failure.
   *
   * The empty-segment guard is the important one. `path.join(a, '', b)`
   * silently collapses to `a/b`, so an empty `parentSessionId` used to probe a
   * path that can never exist and reported a confident `'absent'`.
   */
  async probeSubagentTranscript(
    workspacePath: string,
    parentSessionId: string,
    agentId: string,
  ): Promise<SubagentTranscriptProbe> {
    if (!isUsablePathSegment(parentSessionId)) {
      this.logger.warn(
        '[ChatPtahCliService.probeSubagentTranscript] Unusable parentSessionId — cannot locate transcript',
        { parentSessionId, agentId },
      );
      return 'indeterminate';
    }
    if (!isUsablePathSegment(agentId)) {
      this.logger.warn(
        '[ChatPtahCliService.probeSubagentTranscript] Unusable agentId — cannot locate transcript',
        { parentSessionId, agentId },
      );
      return 'indeterminate';
    }

    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    const escapedPath = workspacePath.replace(/[:\\/]/g, '-');

    let dirs: string[];
    try {
      dirs = await fs.readdir(projectsDir);
    } catch (error: unknown) {
      this.logger.warn(
        '[ChatPtahCliService.probeSubagentTranscript] Could not read projects directory',
        {
          projectsDir,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 'indeterminate';
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, '-');
    const projectDir =
      dirs.find((d) => d === escapedPath) ??
      dirs.find((d) => d.toLowerCase() === escapedPath.toLowerCase()) ??
      dirs.find((d) => normalize(d) === normalize(escapedPath));

    // The workspace→directory mapping is a three-strategy heuristic. A miss
    // means we failed to locate the project root, not that the transcript is
    // gone — answering 'absent' here would destroy a recoverable record.
    if (!projectDir) {
      this.logger.warn(
        '[ChatPtahCliService.probeSubagentTranscript] No project directory matched workspace',
        { workspacePath, escapedPath },
      );
      return 'indeterminate';
    }

    const transcriptPath = path.join(
      projectsDir,
      projectDir,
      parentSessionId,
      'subagents',
      `agent-${agentId}.jsonl`,
    );

    try {
      await fs.access(transcriptPath);
      return 'present';
    } catch (error: unknown) {
      const code =
        error instanceof Error && 'code' in error
          ? (error as NodeJS.ErrnoException).code
          : undefined;
      if (code === 'ENOENT') {
        return 'absent';
      }
      this.logger.warn(
        '[ChatPtahCliService.probeSubagentTranscript] Transcript access failed for a reason other than absence',
        {
          transcriptPath,
          code,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return 'indeterminate';
    }
  }
}
