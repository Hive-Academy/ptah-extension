import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { inject, injectable } from 'tsyringe';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  type ResolvedExecutionProfile,
  type WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import {
  PLATFORM_TOKENS,
  isUnsafeWorkspacePath,
  type IPlatformInfo,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  type AgentSessionStartConfig,
  type AgentSessionResumeConfig,
  type FlatStreamEventUnion,
  type RuntimeHostCapabilities,
  type SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import { isAuthorizedWorkspace } from '../../utils/workspace-authorization';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

export type ChatRuntimeConfig =
  AgentSessionStartConfig | AgentSessionResumeConfig;

export type ResolvedChatExecution =
  | Extract<ResolvedExecutionProfile, { runtime: 'claude-sdk' }>
  | (Extract<ResolvedExecutionProfile, { runtime: 'codex-app-server' }> & {
      readonly workspacePath: string;
      readonly cwd: string;
      /** Complete chat inputs for the host's validated Codex profile builder. */
      readonly config: ChatRuntimeConfig;
    });

@injectable()
export class ChatRuntimeProfileService {
  constructor(
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly resolver: Pick<
      WorkspaceProviderProfileResolver,
      'resolveExecutionProfile'
    >,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.PLATFORM_INFO)
    private readonly platformInfo: Pick<
      IPlatformInfo,
      'extensionPath' | 'globalStoragePath'
    >,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: Pick<WebviewManager, 'broadcastMessage'>,
    @inject(SDK_TOKENS.RUNTIME_HOST_CAPABILITIES, { isOptional: true })
    private readonly hostCapabilities: RuntimeHostCapabilities = {
      nativeCodex: false,
    },
  ) {}

  /**
   * Call with the session's resolved workspace/cwd, including the existing resume
   * cwd helper's result. Never consult the focused workspace or global auth.
   * Native profile validation and process creation remain the adapter port's job.
   */
  async prepare(
    config: ChatRuntimeConfig,
    identity?: SessionRuntimeIdentity,
  ): Promise<ResolvedChatExecution> {
    const workspacePath =
      config.workspaceId ?? identity?.workspaceId ?? config.projectPath;
    const cwd = config.projectPath ?? workspacePath;
    this.authorize(workspacePath);
    this.authorize(cwd);
    const resolved = await this.resolver.resolveExecutionProfile({
      workspacePath,
      requestedModel: config.model ?? 'default',
      existingIdentity: identity,
      consumer: 'chat',
      hostCapabilities: this.hostCapabilities,
    });
    if (resolved.runtime === 'claude-sdk') return resolved;
    return { ...resolved, workspacePath, cwd, config };
  }

  /**
   * 7b calls once after preparation, before attaching the runtime stream. 8a's
   * profile port must not publish again. A notice is one ordinary chat message,
   * carried by the same CHAT_CHUNK start/text/complete protocol as the broadcaster.
   * It does not mark the turn idle or invent model usage.
   */
  async publishModelSubstitution(
    execution: ResolvedChatExecution,
    target: { readonly tabId: string; readonly sessionId?: string },
  ): Promise<void> {
    if (
      execution.runtime !== 'codex-app-server' ||
      !execution.modelSubstitution
    )
      return;
    const { requested, used } = execution.modelSubstitution;
    const messageId = randomUUID();
    const base = {
      messageId,
      timestamp: Date.now(),
      sessionId: target.sessionId,
      source: 'complete' as const,
    };
    const events: FlatStreamEventUnion[] = [
      {
        ...base,
        id: randomUUID(),
        eventType: 'message_start',
        role: 'assistant',
      },
      {
        ...base,
        id: randomUUID(),
        eventType: 'text_delta',
        blockIndex: 0,
        delta: `Model notice: requested "${requested}"; using "${used}".`,
      },
      { ...base, id: randomUUID(), eventType: 'message_complete' },
    ];
    for (const event of events) {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_CHUNK, {
        ...target,
        event,
      });
    }
  }

  private authorize(
    candidate: string | undefined,
  ): asserts candidate is string {
    if (
      !candidate ||
      !isAbsolute(candidate) ||
      !isAuthorizedWorkspace(candidate, this.workspaceProvider)
    ) {
      throw new Error(
        'Access denied: session workspace must be an absolute path inside an open folder.',
      );
    }
    const safety = isUnsafeWorkspacePath(candidate, this.platformInfo);
    if (!safety.ok) {
      throw new Error('Cannot start a session in an unsafe workspace folder.');
    }
  }
}
