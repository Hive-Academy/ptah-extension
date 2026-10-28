import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PTAH_UI_HINT, presentCodexApproval } from '@ptah-extension/agent-sdk';
import type {
  CodexChatAdapterPorts,
  HostAttentionCoordinator,
  RuntimeAdmissionPort,
} from '@ptah-extension/agent-sdk';
import type { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import {
  buildCodexExecutionProfile,
  normalizeCodexWorkspaceKey,
  type CodexExecutionProfileInput,
  type CodexThreadIdentity,
  type CodexApprovalRequest,
} from '@ptah-extension/codex-runtime';
import type {
  IWorkspaceProvider,
  IPlatformInfo,
} from '@ptah-extension/platform-core';
import {
  MESSAGE_TYPES,
  attentionRequestKey,
  type PermissionRequest,
  type PermissionResponse,
  type RuntimeHostCapabilities,
  type SessionId,
} from '@ptah-extension/shared';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';
import {
  classifyCodexChatOptions,
  CodexChatOptionError,
} from './codex-chat-profile-options';
import type {
  ChatStreamBroadcaster,
  WebviewManager,
} from '../streaming/chat-stream-broadcaster.service';

export interface CodexRuntimeAdmissionDeps {
  resolver: Pick<WorkspaceProviderProfileResolver, 'resolveExecutionProfile'>;
  workspaceProvider: IWorkspaceProvider;
  platformInfo: Pick<IPlatformInfo, 'extensionPath' | 'globalStoragePath'>;
  hostCapabilities: RuntimeHostCapabilities;
  webviewManager: Pick<WebviewManager, 'broadcastMessage'>;
}

export interface CodexChatHostPortsDeps
  extends
    CodexRuntimeAdmissionDeps,
    Pick<
      CodexChatAdapterPorts,
      | 'logger'
      | 'platform'
      | 'info'
      | 'createScope'
      | 'metadata'
      | 'approvals'
      | 'callbacks'
    > {
  /** Resolve by chat session id; the runtime identity store itself is keyed by context id. */
  readResumeIdentity(
    sessionId: SessionId,
  ): Promise<CodexThreadIdentity | undefined>;
  broadcaster: Pick<ChatStreamBroadcaster, 'streamEventsToWebview'>;
  tabId(sessionId: SessionId): string;
  /** Releases the host notice the webview attention observer raised for a request. */
  hostAttention?: Pick<HostAttentionCoordinator, 'resolve'>;
}

export interface CodexChatHostPorts extends CodexChatAdapterPorts {
  /** Host permission bridge must try this before the Claude permission handler. */
  handlePermissionResponse(response: PermissionResponse): boolean;
}

function profiles(deps: CodexRuntimeAdmissionDeps) {
  return new ChatRuntimeProfileService(
    deps.resolver,
    deps.workspaceProvider,
    deps.platformInfo,
    deps.webviewManager,
    deps.hostCapabilities,
  );
}

export function createCodexRuntimeAdmission(
  deps: CodexRuntimeAdmissionDeps,
): RuntimeAdmissionPort {
  const service = profiles(deps);
  return {
    servingProviderId: async (config) => {
      const execution = await service.prepare(config);
      return execution.runtime === 'codex-app-server'
        ? execution.seed.providerId
        : execution.providerProfile?.providerId;
    },
  };
}

export function createCodexChatHostPorts(
  deps: CodexChatHostPortsDeps,
): CodexChatHostPorts {
  const service = profiles(deps);
  const pending = new Map<
    string,
    {
      sessionId: SessionId;
      request: CodexApprovalRequest;
      timestamp: number;
      correlationKey: string;
    }
  >();
  const wireIds = new Map<string, string>();
  const failed = (reason: unknown) => {
    deps.logger.error(
      'Codex chat presentation failed.',
      reason instanceof Error ? reason : new Error(String(reason)),
    );
  };
  const send = (type: string, payload: unknown) => {
    void deps.webviewManager.broadcastMessage(type, payload).catch(failed);
  };
  // Every terminal path of an approval releases its host notice with the kind
  // and generation (payload timestamp) the attention observer claimed it under.
  const release = (id: string, timestamp: number) =>
    deps.hostAttention?.resolve(
      attentionRequestKey('permission', id),
      timestamp,
    );
  const settle = (id: string) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    wireIds.delete(entry.correlationKey);
    release(id, entry.timestamp);
  };
  // Keep native correlation separate from the renderer's UUID wire identity.
  const key = (sessionId: SessionId, request: CodexApprovalRequest) =>
    JSON.stringify([
      sessionId,
      request.contextId,
      request.processGeneration,
      request.threadId,
      request.turnId,
      request.requestId,
    ]);
  return {
    logger: deps.logger,
    platform: deps.platform,
    info: deps.info,
    createScope: deps.createScope,
    metadata: deps.metadata,
    approvals: deps.approvals,
    callbacks: (id, turn) => deps.callbacks(id, turn),
    checkOptions(config) {
      const { rejected } = classifyCodexChatOptions(config);
      if (rejected.length > 0) throw new CodexChatOptionError(rejected[0]);
      // Classification strips ambient inputs; active turns consume only the prompt.
      // Profile notices belong to session preparation and must not repeat per turn.
    },
    async profile(input, sessionId) {
      const { supported: config, rejected, stripped, mcpServerNames } = classifyCodexChatOptions(input);
      if (input.mcpServerRunning === true) {
        deps.logger.info('Ptah MCP is not attached to Codex chat.', {
          code: 'ptah-mcp-not-attached',
        });
      }
      if (mcpServerNames.length > 0) {
        deps.logger.info('User MCP servers are not attached to Codex chat.', {
          code: 'codex-user-mcp-not-attached',
          serverNames: mcpServerNames,
        });
      }
      if (stripped.includes('thinking')) {
        deps.logger.info('Thinking is not applied to Codex chat; Codex uses native effort.', {
          code: 'codex-thinking-not-applied',
        });
      }
      if (stripped.includes('outputStyleName')) {
        deps.logger.info('Output style by name is not applied to Codex chat.', {
          code: 'codex-output-style-not-applied',
        });
      }
      if (rejected.length > 0) throw new CodexChatOptionError(rejected[0]);
      const resume = sessionId
        ? await deps.readResumeIdentity(sessionId)
        : undefined;
      if (sessionId && !resume)
        throw new Error('Native resume identity unavailable');
      if (resume && resume.threadId !== sessionId)
        throw new Error('Native resume identity mismatch');
      const identity =
        resume && sessionId
          ? {
              version: 1 as const,
              sessionId,
              runtime: 'codex-app-server' as const,
              providerId: resume.providerId,
              workspaceId: resume.workspaceId,
              codex: { normalizedHome: resume.normalizedHome },
            }
          : undefined;
      const execution = await service.prepare(config, identity);
      if (execution.runtime !== 'codex-app-server')
        throw new Error('Native provider required');
      const { seed, cwd, workspacePath } = execution;
      const entries: CodexExecutionProfileInput['paths']['entries'] = {};
      const paths = [
        cwd,
        seed.home,
        ...('files' in config ? (config.files ?? []) : []),
      ];
      for (const path of paths) {
        const absolute = resolve(cwd, path);
        try {
          const [info, canonical] = await Promise.all([
            stat(absolute),
            realpath(absolute),
          ]);
          entries[absolute] = {
            kind: info.isDirectory() ? 'directory' : 'file',
            realpath: canonical,
          };
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            error.code !== 'ENOENT'
          )
            throw error;
          entries[absolute] = { kind: 'missing' };
        }
      }
      const profileInput: CodexExecutionProfileInput = {
        paths: {
          platform: process.platform === 'win32' ? 'win32' : 'posix',
          baseDirectory: cwd,
          entries,
        },
        session: {
          contextId: resume?.contextId ?? randomUUID(),
          consumer: 'chat',
          normalizedHome: seed.home,
          providerId: seed.providerId,
          workspaceId: workspacePath,
          cwd,
          model: seed.model,
          effort: config.effort,
          permissionLevel: config.permissionLevel ?? 'ask',
          systemPrompt: config.systemPrompt,
          enhancedPrompt: config.enhancedPromptsContent,
          outputStyle: config.outputStyleBody,
          attachments: [
            ...('files' in config ? (config.files ?? []) : []).map((path) => ({
              type: 'file' as const,
              path,
            })),
            ...('images' in config ? (config.images ?? []) : []).map(
              (image) => ({ type: 'image' as const, ...image }),
            ),
          ],
        },
      };
      let developerPrompt = profileInput.session.developerPrompt;
      if (
        config.ptahUiFence === true &&
        (config.mcpToolProfile ?? 'coding') === 'coding'
      ) {
        developerPrompt = [
          developerPrompt,
          PTAH_UI_HINT,
        ].filter((part) => part !== undefined).join('\n\n');
      }
      const profile = buildCodexExecutionProfile({
        ...profileInput,
        session: { ...profileInput.session, developerPrompt },
      });
      if (
        resume &&
        (resume.normalizedHome !== profile.normalizedHome ||
          normalizeCodexWorkspaceKey(resume.workspaceId, process.platform) !==
            normalizeCodexWorkspaceKey(profile.workspaceId, process.platform) ||
          resume.providerId !== profile.providerId)
      )
        throw new Error('Native resume identity mismatch');
      return { profile, resume };
    },
    presentation: {
      present(sessionId, request) {
        const correlationKey = key(sessionId, request);
        const previousId = wireIds.get(correlationKey);
        if (previousId) settle(previousId);
        const id = randomUUID();
        const timestamp = Date.now();
        pending.set(id, { sessionId, request, timestamp, correlationKey });
        wireIds.set(correlationKey, id);
        const tabId = deps.tabId(sessionId);
        const payload: PermissionRequest = {
          id,
          sessionId,
          ...(tabId === sessionId ? {} : { tabId }),
          ...presentCodexApproval(request),
          toolUseId: request.toolId,
          timestamp,
          timeoutAt: request.expiresAt ?? 0,
          allowedDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        };
        // Direct manager call: its attention observer raises the host notice.
        void deps.webviewManager
          .broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, payload)
          .catch((error: unknown) => {
            failed(error);
            if (pending.get(id)?.request !== request) return;
            try {
              deps.approvals.respond(
                { sessionId, threadId: request.threadId, requestId: String(request.requestId) },
                { kind: 'codex', response: {
                  sessionId, contextId: request.contextId,
                  processGeneration: request.processGeneration,
                  threadId: request.threadId, turnId: request.turnId,
                  requestId: request.requestId, decision: 'decline',
                } },
              );
            } catch {
              // degradation-audit: reported - coded warning omits request contents.
              deps.logger.warn('Codex approval delivery decline failed.', { code: 'approval-delivery-decline-failed' });
            } finally {
              settle(id);
            }
          });
      },
      dismiss(sessionId, request) {
        const id = wireIds.get(key(sessionId, request));
        if (!id) return;
        settle(id);
        send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
          id,
          sessionId,
          toolName: request.toolName ?? request.kind,
        });
      },
      cancelPrompt(payload) {
        for (const [id, entry] of [...pending]) {
          if (
            entry.sessionId === payload.sessionId &&
            String(entry.request.requestId) === payload.requestId
          ) {
            settle(id);
            send(MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED, {
              ...payload,
              requestId: id,
            });
          }
        }
      },
    },
    handlePermissionResponse(response) {
      const entry = pending.get(response.id);
      if (!entry) return false;
      const { sessionId, request } = entry;
      const decision = {
        allow: 'accept',
        always_allow: 'acceptForSession',
        deny_with_message: 'decline',
        deny: 'cancel',
      } as const;
      try {
        const accepted = deps.approvals.respond(
          {
            sessionId,
            threadId: request.threadId,
            requestId: String(request.requestId),
          },
          {
            kind: 'codex',
            response: {
              sessionId,
              contextId: request.contextId,
              processGeneration: request.processGeneration,
              threadId: request.threadId,
              turnId: request.turnId,
              requestId: request.requestId,
              decision: decision[response.decision],
              reason: response.reason,
              modifiedInput: response.modifiedInput,
            },
          },
        );
        if (accepted) {
          settle(response.id);
          return true;
        }
        deps.logger.warn('Codex approval response rejected.', {
          code: 'approval-response-rejected',
        });
      } catch {
        // degradation-audit: reported - coded warning without request content (the
        // sink error may carry it). The renderer has already dismissed the prompt;
        // settle this Codex entry and consume its reply instead of falling through.
        deps.logger.warn('Codex approval response failed.', {
          code: 'approval-response-failed',
        });
      }
      settle(response.id);
      send(MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
        id: response.id,
        sessionId,
        toolName: request.toolName ?? request.kind,
      });
      return true;
    },
    replacement: {
      validateReplacement(request, input) {
        if (
          request.kind !== 'command' ||
          Object.keys(input).some((name) => name !== 'command')
        )
          return undefined;
        const command = input['command'];
        return typeof command === 'string' && command.trim()
          ? command
          : undefined;
      },
      failed() {
        deps.logger.error('Codex approval follow-up failed.');
      },
    },
    publish: (id, stream) =>
      deps.broadcaster.streamEventsToWebview(id, stream, deps.tabId(id)),
  };
}
